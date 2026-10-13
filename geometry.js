/*
 * geometry.js — parametric cigar box guitar fretboard geometry.
 *
 * Builds a triangle-soup mesh (millimetres) for a 3D-printable fretboard:
 *   - tapered board (wider at the heel than at the nut)
 *   - integrated raised frets (printed as part of the board, so a worn
 *     board is simply reprinted — a "fret job" for a few cents of PLA)
 *   - integrated nut with a string slot per string
 *   - countersunk holes for #6 flat-head wood screws, placed at the
 *     traditional fret-marker positions so the screw heads double as
 *     fret markers and the board can be screwed to a wooden neck
 *
 * Pure math, no DOM. In the browser it attaches `window.Fretboard`;
 * in Node it uses module.exports so the geometry can be unit-tested.
 */
(function (global) {
  'use strict';

  // #6 flat-head wood screw: shank ~3.5 mm, head ~8 mm, 82 deg head angle.
  var SCREW = {
    clearanceRadius: 2.1, // 4.2 mm through-hole
    headRadius: 4.1,      // 8.2 mm countersink opening
    headAngleDeg: 82
  };

  var MARKER_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
  var CIRCLE_SEGMENTS = 24;

  // String gauges (inches, low to high) used to size the nut slots.
  // 3- and 4-string sets are the classic cigar box tunings; 6 is a
  // standard light EADGBE set (.046–.010).
  var STRING_GAUGES = {
    1: [0.032],
    2: [0.042, 0.024],
    3: [0.042, 0.032, 0.024],
    4: [0.042, 0.032, 0.024, 0.017],
    5: [0.042, 0.032, 0.024, 0.017, 0.013],
    6: [0.046, 0.036, 0.026, 0.017, 0.013, 0.010]
  };
  var TUNING_LABELS = { 3: 'GDg', 4: 'GDgB', 6: 'EADGBE' };

  /** Distance from the nut to fret n (n = 0 is the nut itself). */
  function fretDistance(scaleMm, n) {
    return scaleMm * (1 - Math.pow(2, -n / 12));
  }

  // ---------------------------------------------------------------------
  // Triangle helpers. Triangles are flat [x0,y0,z0, x1,y1,z1, x2,y2,z2].
  // ---------------------------------------------------------------------

  function pushTri(tris, a, b, c) {
    tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }

  function triNormal(t, i) {
    var ax = t[i], ay = t[i + 1], az = t[i + 2];
    var bx = t[i + 3], by = t[i + 4], bz = t[i + 5];
    var cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
    var ux = bx - ax, uy = by - ay, uz = bz - az;
    var vx = cx - ax, vy = cy - ay, vz = cz - az;
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  }

  /** Flip any triangle in `tris` whose normal fails the test function. */
  function forceNormals(tris, test) {
    for (var i = 0; i < tris.length; i += 9) {
      var n = triNormal(tris, i);
      var cx = (tris[i] + tris[i + 3] + tris[i + 6]) / 3;
      var cy = (tris[i + 1] + tris[i + 4] + tris[i + 7]) / 3;
      var cz = (tris[i + 2] + tris[i + 5] + tris[i + 8]) / 3;
      if (!test(n, cx, cy, cz)) {
        // swap vertices 2 and 3
        for (var k = 0; k < 3; k++) {
          var tmp = tris[i + 3 + k];
          tris[i + 3 + k] = tris[i + 6 + k];
          tris[i + 6 + k] = tmp;
        }
      }
    }
    return tris;
  }

  function signedVolume(tris) {
    var v = 0;
    for (var i = 0; i < tris.length; i += 9) {
      var ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
      var bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
      var cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return v / 6;
  }

  /** Orient a closed solid so its signed volume is positive (outward normals). */
  function orientClosed(tris) {
    if (signedVolume(tris) < 0) {
      for (var i = 0; i < tris.length; i += 9) {
        for (var k = 0; k < 3; k++) {
          var tmp = tris[i + 3 + k];
          tris[i + 3 + k] = tris[i + 6 + k];
          tris[i + 6 + k] = tmp;
        }
      }
    }
    return tris;
  }

  /** Closed axis-aligned box. */
  function box(x0, x1, y0, y1, z0, z1) {
    var t = [];
    var c = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
    ];
    var faces = [
      [0, 3, 2, 1], [4, 5, 6, 7], // bottom, top
      [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7] // sides
    ];
    faces.forEach(function (f) {
      pushTri(t, c[f[0]], c[f[1]], c[f[2]]);
      pushTri(t, c[f[0]], c[f[2]], c[f[3]]);
    });
    return orientClosed(t);
  }

  /**
   * Loft a convex profile given in the (y, z) plane along x through a set
   * of sections [{x, s}]: at each section the profile is scaled by s about
   * the point (cy, zBase). Scaling down toward the ends rounds a prism
   * over — used for the fret ends. End caps are fanned (profile must be
   * convex) and the solid is oriented outward.
   */
  function loftProfileX(profile, cy, zBase, sections) {
    var t = [];
    var n = profile.length;
    var secs = sections.map(function (sec) {
      return profile.map(function (p) {
        return [sec.x, cy + (p[0] - cy) * sec.s, zBase + (p[1] - zBase) * sec.s];
      });
    });
    var i, j;
    // end caps (fan)
    var first = secs[0], last = secs[secs.length - 1];
    for (j = 1; j < n - 1; j++) {
      pushTri(t, first[0], first[j + 1], first[j]);
      pushTri(t, last[0], last[j], last[j + 1]);
    }
    // bands between consecutive sections
    for (i = 0; i < secs.length - 1; i++) {
      for (j = 0; j < n; j++) {
        var a0 = secs[i][j], a1 = secs[i][(j + 1) % n];
        var b0 = secs[i + 1][j], b1 = secs[i + 1][(j + 1) % n];
        pushTri(t, a0, b0, b1);
        pushTri(t, a0, b1, a1);
      }
    }
    return orientClosed(t);
  }

  // ---------------------------------------------------------------------
  // Board body (with screw holes)
  // ---------------------------------------------------------------------

  /**
   * Flat face (the board's top or bottom), triangulated in horizontal
   * bands between "chains" — left-to-right polylines that partition the
   * face: one at the nut edge, one at every fret line, two hugging each
   * screw hole (below and above the circle), one at the tail edge.
   * Each band is a simple polygon triangulated on its own, so triangles
   * stay small and local instead of webbing across the whole board.
   */
  function flatFace(holes, radius, z, up, widthAt, length, stationYs, earcut) {
    var sorted = holes.slice().sort(function (a, b) { return a.y - b.y; });
    var chains = [];
    var skipBand = {}; // chain index i -> band (i, i+1) is a hole interior

    function edgePt(y, side) { return [side * widthAt(y) / 2, y]; }
    function arcChain(h, over) {
      var pts = [edgePt(h.y, -1)];
      var half = CIRCLE_SEGMENTS / 2, i, a;
      for (i = 0; i <= half; i++) {
        a = over ? Math.PI - (i * Math.PI) / half : Math.PI + (i * Math.PI) / half;
        pts.push([h.x + radius * Math.cos(a), h.y + radius * Math.sin(a)]);
      }
      pts.push(edgePt(h.y, 1));
      return pts;
    }

    var events = [];
    stationYs.forEach(function (y) { events.push({ y: y, hole: null }); });
    sorted.forEach(function (h) { events.push({ y: h.y, hole: h }); });
    events.sort(function (a, b) { return a.y - b.y; });

    events.forEach(function (ev) {
      if (!ev.hole) {
        chains.push([edgePt(ev.y, -1), edgePt(ev.y, 1)]);
      } else {
        skipBand[chains.length] = true; // band between this hole's two chains
        chains.push(arcChain(ev.hole, false));
        chains.push(arcChain(ev.hole, true));
      }
    });

    var tris = [];
    for (var c = 0; c < chains.length - 1; c++) {
      if (skipBand[c]) continue;
      var poly = chains[c].concat(chains[c + 1].slice().reverse());
      var coords = [];
      poly.forEach(function (p) { coords.push(p[0], p[1]); });
      var idx = earcut(coords, null, 2);
      for (var i = 0; i < idx.length; i += 3) {
        pushTri(tris,
          [coords[idx[i] * 2], coords[idx[i] * 2 + 1], z],
          [coords[idx[i + 1] * 2], coords[idx[i + 1] * 2 + 1], z],
          [coords[idx[i + 2] * 2], coords[idx[i + 2] * 2 + 1], z]);
      }
    }
    return forceNormals(tris, function (n) { return up ? n[2] > 0 : n[2] < 0; });
  }

  /** Ring strip between two circles (used for countersink cone + hole wall). */
  function ringStrip(cx, cy, rTop, zTop, rBot, zBot) {
    var t = [];
    for (var i = 0; i < CIRCLE_SEGMENTS; i++) {
      var a0 = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      var a1 = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
      var p = function (r, z, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a), z]; };
      pushTri(t, p(rTop, zTop, a0), p(rTop, zTop, a1), p(rBot, zBot, a1));
      pushTri(t, p(rTop, zTop, a0), p(rBot, zBot, a1), p(rBot, zBot, a0));
    }
    // Normals must point INTO the hole void (toward the axis): the solid
    // material lives outside the cylinder.
    return forceNormals(t, function (n, gx, gy) {
      var rx = gx - cx, ry = gy - cy;
      return n[0] * rx + n[1] * ry < 0;
    });
  }

  /**
   * One printable piece of the board, spanning y in [y0, y1]: flat faces,
   * four side walls (the two cut faces become the piece's end walls), and
   * the cone + hole wall for each screw hole inside the range.
   */
  function boardBody(p, holes, widthAt, y0, y1, stations, earcut, outline) {
    var T = p.thicknessMm;
    var tris = [];

    // top + bottom faces
    tris = tris.concat(flatFace(holes, SCREW.headRadius, T, true, widthAt, y1, stations, earcut));
    tris = tris.concat(flatFace(holes, SCREW.clearanceRadius, 0, false, widthAt, y1, stations, earcut));

    // side walls (outline is a closed perimeter polyline; the last point
    // wraps back to the first)
    for (var e = 0; e < outline.length; e++) {
      var A = outline[e], B = outline[(e + 1) % outline.length];
      var wall = [];
      pushTri(wall, [A[0], A[1], 0], [B[0], B[1], 0], [B[0], B[1], T]);
      pushTri(wall, [A[0], A[1], 0], [B[0], B[1], T], [A[0], A[1], T]);
      forceNormals(wall, function (n, gx, gy) {
        // outward = away from the piece centre (0, (y0+y1)/2)
        return n[0] * gx + n[1] * (gy - (y0 + y1) / 2) > 0;
      });
      tris = tris.concat(wall);
    }

    // countersink cone + straight hole wall for each screw hole
    var coneDepth = Math.min(
      (SCREW.headRadius - SCREW.clearanceRadius) / Math.tan((SCREW.headAngleDeg / 2) * Math.PI / 180),
      T - 1.2
    );
    holes.forEach(function (h) {
      tris = tris.concat(ringStrip(h.x, h.y, SCREW.headRadius, T, SCREW.clearanceRadius, T - coneDepth));
      tris = tris.concat(ringStrip(h.x, h.y, SCREW.clearanceRadius, T - coneDepth, SCREW.clearanceRadius, 0));
    });
    return { tris: tris, coneDepth: coneDepth };
  }

  // ---------------------------------------------------------------------
  // Main builder
  // ---------------------------------------------------------------------

  /**
   * params (all mm):
   *   scaleMm, strings, frets, nutWidthMm, heelWidthMm (width at last fret),
   *   thicknessMm, fretHeightMm, tailMm (board length past the last fret),
   *   nutScrew / tailScrew (extra holes at the ends; nut on, tail off),
   *   tailCornerRadiusMm (rounded tail corners for a routed neck pocket;
   *   6.35 = 1/4", matching a router bit; 0 = square corners),
   *   nutHeightMm, nutDepthMm, stringGaugesIn (nut slot gauges, low->high),
   *   leftHanded (bool: mirror the nut slot order for a left-handed build),
   *   splitAfterFret (0 = one piece; N = two pieces, split just past fret N),
   *   skipMarkers (fret numbers whose marker screw hole is omitted;
   *   default [17] — the spacing up there earns its keep better as wood)
   * earcut: the earcut function (vendored in the browser, required in Node).
   *
   * Returns { triangles (all pieces combined), pieces: [{y0, y1, lengthMm,
   * triangles}], meta }.
   */
  function buildFretboard(params, earcut) {
    var p = Object.assign({
      thicknessMm: 5,
      fretHeightMm: 0.9,
      tailMm: 20,
      nutScrew: true,
      tailScrew: false,
      tailCornerRadiusMm: 6.35,
      leftHanded: false,
      nutHeightMm: 2.0,
      nutDepthMm: 5,
      stringGaugesIn: null,
      fretBaseWidthMm: 2.4,
      splitAfterFret: 0,
      skipMarkers: [17]
    }, params);

    var warnings = [];
    var distances = [];
    var n;
    for (n = 0; n <= p.frets; n++) distances.push(fretDistance(p.scaleMm, n));
    var lastFretY = distances[p.frets];
    var length = lastFretY + p.tailMm;

    function widthAt(y) {
      return p.nutWidthMm + (p.heelWidthMm - p.nutWidthMm) * (y / lastFretY);
    }

    // --- screw holes ---------------------------------------------------
    var holes = [];
    var skippedMarkers = [];
    MARKER_FRETS.forEach(function (m) {
      if (m > p.frets) return;
      if (p.skipMarkers.indexOf(m) !== -1) return;
      var gap = distances[m] - distances[m - 1];
      var y = (distances[m] + distances[m - 1]) / 2;
      if (gap < SCREW.headRadius * 2 + 2.5) {
        skippedMarkers.push(m);
        return;
      }
      holes.push({ x: 0, y: y, label: 'fret ' + m });
    });
    if (p.nutScrew) {
      var yNut = distances[1] / 2;
      if (yNut - SCREW.headRadius > p.nutDepthMm + 1) {
        holes.push({ x: 0, y: yNut, label: 'nut end' });
      }
    }
    if (p.tailScrew) {
      var yTail = length - 9;
      if (yTail > lastFretY + SCREW.headRadius + 1) {
        holes.push({ x: 0, y: yTail, label: 'tail end' });
      }
    }
    if (skippedMarkers.length) {
      warnings.push('No room for a screw at fret marker(s) ' +
        skippedMarkers.join(', ') + ' — the fret spacing there is narrower than the screw head.');
    }

    // --- split into printable pieces ------------------------------------
    // The seam sits just past the split fret's ridge (on its tail side),
    // so the ridge itself hides the joint line and every fret stays whole
    // on one piece. Both pieces screw to the same neck, which is what
    // registers them to each other.
    var splitY = null;
    if (p.splitAfterFret > 0) {
      if (p.splitAfterFret < p.frets) {
        splitY = distances[p.splitAfterFret] + p.fretBaseWidthMm / 2;
      } else {
        warnings.push('Split not applied: with ' + p.frets + ' frets there is no fret ' +
          p.splitAfterFret + ' to split after.');
      }
    }
    var ranges = splitY === null ? [[0, length]] : [[0, splitY], [splitY, length]];

    var embed = 0.6;
    var wn = p.nutWidthMm;
    var gauges = p.stringGaugesIn || STRING_GAUGES[p.strings] || STRING_GAUGES[3];
    var coneDepth = 0;
    var tris = [];
    var pieces = [];
    // Rounded tail corners (last piece only), clamped to fit the board.
    var cornerR = Math.min(p.tailCornerRadiusMm || 0, widthAt(length) / 2 - 2, length / 4);
    if (cornerR < 0.5) cornerR = 0;

    ranges.forEach(function (range, pieceIdx) {
      var y0 = range[0], y1 = range[1];
      var pieceHoles = holes.filter(function (h) {
        return h.y > y0 + 0.01 && h.y < y1 - 0.01;
      });
      var stations = [y0];
      distances.forEach(function (d) {
        if (d > y0 + 0.001 && d < y1 - 0.001) stations.push(d);
      });
      stations.push(y1);

      // --- outline + face width function for this piece ----------------
      // The board's tail end can have rounded corners so it drops into a
      // routed neck pocket (a router bit leaves radiused corners). The
      // face triangulation gets extra stations in the corner zone and a
      // width function that follows the arcs, so faces and walls share
      // the same boundary points.
      var r = pieceIdx === ranges.length - 1 ? cornerR : 0;
      var wFn = widthAt;
      var outline;
      if (r > 0) {
        var cx = widthAt(length) / 2 - r;
        wFn = function (y) {
          if (y <= length - r) return widthAt(y);
          var dy = y - (length - r);
          var arcHalf = cx + Math.sqrt(Math.max(0, r * r - dy * dy));
          return Math.min(widthAt(y), arcHalf * 2);
        };
        [1, 2, 3].forEach(function (k) {
          stations.push(length - r + r * Math.sin((k * Math.PI) / 8));
        });
        stations.push(length - r);
        outline = [
          [-widthAt(y0) / 2, y0], [widthAt(y0) / 2, y0],
          [widthAt(length - r) / 2, length - r]
        ];
        [1, 2, 3, 4].forEach(function (k) {
          var a = (k * Math.PI) / 8;
          outline.push([cx + r * Math.cos(a), length - r + r * Math.sin(a)]);
        });
        outline.push([-cx, length]);
        [3, 2, 1].forEach(function (k) {
          var a2 = (k * Math.PI) / 8;
          outline.push([-(cx + r * Math.cos(a2)), length - r + r * Math.sin(a2)]);
        });
        outline.push([-widthAt(length - r) / 2, length - r]);
      } else {
        outline = [
          [-widthAt(y0) / 2, y0], [widthAt(y0) / 2, y0],
          [widthAt(y1) / 2, y1], [-widthAt(y1) / 2, y1]
        ];
      }

      var body = boardBody(p, pieceHoles, wFn, y0, y1, stations, earcut, outline);
      coneDepth = body.coneDepth;
      var ptris = body.tris.slice();

      // --- integrated frets whose ridge falls inside this piece --------
      // The fret profile is a half-ellipse crown (like real fret wire):
      // rounded over the top instead of a flat-topped trapezoid, so the
      // string rolls over it and there's no sharp edge to wear or chip.
      for (n = 1; n <= p.frets; n++) {
        var y = distances[n];
        if (y < y0 + 0.01 || y > y1 - 0.01) continue;
        var half = widthAt(y) / 2 - 0.4;
        var halfBase = p.fretBaseWidthMm / 2;
        var rise = p.fretHeightMm + embed; // ellipse semi-axis, base -> crown
        var profile = [
          [y - halfBase, p.thicknessMm - embed],
          [y + halfBase, p.thicknessMm - embed]
        ];
        var CSEG = 8, k, ang;
        for (k = 1; k < CSEG; k++) {
          ang = (k / CSEG) * Math.PI;
          profile.push([
            y + halfBase * Math.cos(ang),
            p.thicknessMm - embed + rise * Math.sin(ang)
          ]);
        }
        // Round the fret ends over: loft the profile along x, scaling it
        // down toward each end — but bluntly: the end face keeps about
        // half the fret's size, a small dome like a filed fret end, and
        // does NOT taper away to a point.
        var endLen = Math.min(1.0, half * 0.5);
        var sections = [
          { x: -half, s: 0.5 },
          { x: -half + endLen * 0.5, s: 0.8 },
          { x: -half + endLen, s: 1 },
          { x: half - endLen, s: 1 },
          { x: half - endLen * 0.5, s: 0.8 },
          { x: half, s: 0.5 }
        ];
        ptris = ptris.concat(loftProfileX(profile, y, p.thicknessMm - embed, sections));
      }

      // --- integrated nut with string slots (first piece only) ---------
      // Each slot is sized for its string: width = gauge + a hair of
      // clearance, floor ~60% of the string's diameter below the nut top
      // (so roughly half the string sits in the slot, like a filed nut).
      // The nut is built as a row of segment boxes alternating raised
      // material and slot floors.
      if (pieceIdx === 0) {
        var nutTop = p.thicknessMm + p.nutHeightMm;
        if (p.strings > 0) {
          var margin = Math.max(3.2, wn * 0.09);
          var spread = wn - margin * 2;
          var stringX = [];
          var i;
          for (i = 0; i < p.strings; i++) {
            stringX.push(p.strings === 1 ? 0 : -spread / 2 + (spread * i) / (p.strings - 1));
          }
          var segs = [];
          var cursor = -wn / 2;
          stringX.forEach(function (x, si) {
            // Gauges run low->high. On a right-handed board the thick
            // strings sit at the +x side of the nut, so the slot order is
            // reversed; the left-handed option restores low-at--x.
            var g = p.leftHanded ? gauges[si] : gauges[p.strings - 1 - si];
            var diaMm = (g || 0.024) * 25.4;
            var w = diaMm + 0.1;
            var depth = Math.min(Math.max(0.6 * diaMm, 0.35), p.nutHeightMm - 0.3);
            segs.push({ x0: cursor, x1: x - w / 2, top: nutTop });
            segs.push({ x0: x - w / 2, x1: x + w / 2, top: nutTop - depth });
            cursor = x + w / 2;
          });
          segs.push({ x0: cursor, x1: wn / 2, top: nutTop });
          segs.forEach(function (s) {
            if (s.x1 - s.x0 > 0.01) {
              ptris = ptris.concat(box(s.x0, s.x1, 0, p.nutDepthMm, p.thicknessMm - embed, s.top));
            }
          });
        } else {
          ptris = ptris.concat(box(-wn / 2, wn / 2, 0, p.nutDepthMm, p.thicknessMm - embed, nutTop));
        }
      }

      pieces.push({ y0: y0, y1: y1, lengthMm: y1 - y0, triangles: ptris });
      tris = tris.concat(ptris);
    });

    return {
      triangles: tris,
      pieces: pieces,
      meta: {
        lengthMm: length,
        lastFretYMm: lastFretY,
        nutWidthMm: wn,
        tailWidthMm: widthAt(length),
        fretDistancesMm: distances,
        holes: holes,
        skippedMarkers: skippedMarkers,
        coneDepthMm: coneDepth,
        splitYMm: splitY,
        stringGaugesIn: gauges,
        tuningLabel: TUNING_LABELS[p.strings] || '',
        triangleCount: tris.length / 9,
        warnings: warnings
      }
    };
  }

  var api = {
    SCREW: SCREW,
    MARKER_FRETS: MARKER_FRETS,
    STRING_GAUGES: STRING_GAUGES,
    fretDistance: fretDistance,
    buildFretboard: buildFretboard,
    signedVolume: signedVolume
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Fretboard = api;
  }
})(typeof window !== 'undefined' ? window : this);
