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
  // Across-the-width sample points (fractions of the half width) used to
  // trace the fretboard radius curve on faces, walls, frets and the nut.
  var CHAIN_FRACS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];

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

  // Fret layouts: which semitone classes (0 = the octave) get a fret
  // ridge. null = chromatic (every semitone). Diatonic and pentatonic
  // boards are a cigar box staple — fewer frets, all of them in key.
  // 'pentatonic-plus' is Del Puckett's design: his site defines it as
  // the blues scale — the minor pentatonic plus the flat-5 blue note.
  var FRET_MODES = {
    chromatic: null,
    diatonic: [0, 2, 4, 5, 7, 9, 11],
    pentatonic: [0, 3, 5, 7, 10],
    'pentatonic-plus': [0, 3, 5, 6, 7, 10]
  };

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
        return [sec.x, cy + (p[0] - cy) * sec.s, zBase + (p[1] - zBase) * sec.s + (sec.dz || 0)];
      });
    });
    var i, j;
    // end caps (fan) — wound to match the bands: cap normals point AWAY
    // from the solid (the original order pointed them inward, which
    // silently under-counted loft volumes and inverted the STL normals
    // on every fret end face)
    var first = secs[0], last = secs[secs.length - 1];
    for (j = 1; j < n - 1; j++) {
      pushTri(t, first[0], first[j], first[j + 1]);
      pushTri(t, last[0], last[j + 1], last[j]);
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
    var chainKind = []; // 'station' | 'arc', parallel to chains
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

    // Densify the stations: no band longer than ~12mm. Short bands keep
    // the face triangles small and local, which the preview's painter
    // sort needs to draw frets and holes correctly at glancing angles.
    // Stations inside a screw hole's span are dropped afterwards (the
    // midpoint of a fret gap is exactly where a marker hole sits) — a
    // chain crossing the hole circle corrupts the bands around it.
    var denseYs = [];
    var sortedYs = stationYs.slice().sort(function (a, b) { return a - b; });
    sortedYs.forEach(function (y) {
      if (denseYs.length) {
        var prev = denseYs[denseYs.length - 1];
        var parts = Math.ceil((y - prev) / 12);
        for (var dp = 1; dp < parts; dp++) denseYs.push(prev + ((y - prev) * dp) / parts);
      }
      denseYs.push(y);
    });
    denseYs = denseYs.filter(function (y, idx) {
      if (idx === 0 || idx === denseYs.length - 1) return true;
      return !sorted.some(function (h) { return Math.abs(y - h.y) <= radius + 0.6; });
    });

    var events = [];
    denseYs.forEach(function (y) { events.push({ y: y, hole: null }); });
    sorted.forEach(function (h) { events.push({ y: h.y, hole: h }); });
    events.sort(function (a, b) { return a.y - b.y; });

    // z may be a function of (x, y) — the radiused top face. Station
    // chains then sample across the width so the triangulation follows
    // the curve instead of chord-cutting it.
    function zOf(x, y) { return typeof z === 'function' ? z(x, y) : z; }

    events.forEach(function (ev) {
      if (!ev.hole) {
        if (typeof z === 'function') {
          var halfW = widthAt(ev.y) / 2, chain = [], fi;
          for (fi = 0; fi < CHAIN_FRACS.length; fi++) chain.push([CHAIN_FRACS[fi] * halfW, ev.y]);
          chains.push(chain);
        } else {
          chains.push([edgePt(ev.y, -1), edgePt(ev.y, 1)]);
        }
        chainKind.push('station');
      } else {
        skipBand[chains.length] = true; // band between this hole's two chains
        chains.push(arcChain(ev.hole, false));
        chains.push(arcChain(ev.hole, true));
        chainKind.push('arc', 'arc');
      }
    });

    var tris = [];
    for (var c = 0; c < chains.length - 1; c++) {
      if (skipBand[c]) continue;
      // Two station chains with matching samples form a grid: triangulate
      // cell by cell so the diagonals stay inside one across-width cell.
      // A free earcut of the whole band picks long diagonals that drag
      // the curved surface off the true cylinder between stations.
      if (chainKind[c] === 'station' && chainKind[c + 1] === 'station' &&
          chains[c].length === chains[c + 1].length && chains[c].length > 2) {
        var A = chains[c], B = chains[c + 1], gk;
        for (gk = 0; gk < A.length - 1; gk++) {
          var a0 = A[gk], a1 = A[gk + 1], b0 = B[gk], b1 = B[gk + 1];
          pushTri(tris,
            [a0[0], a0[1], zOf(a0[0], a0[1])], [b0[0], b0[1], zOf(b0[0], b0[1])], [b1[0], b1[1], zOf(b1[0], b1[1])]);
          pushTri(tris,
            [a0[0], a0[1], zOf(a0[0], a0[1])], [b1[0], b1[1], zOf(b1[0], b1[1])], [a1[0], a1[1], zOf(a1[0], a1[1])]);
        }
        continue;
      }
      var poly = chains[c].concat(chains[c + 1].slice().reverse());
      var coords = [];
      poly.forEach(function (p) { coords.push(p[0], p[1]); });
      var idx = earcut(coords, null, 2);
      for (var i = 0; i < idx.length; i += 3) {
        pushTri(tris,
          [coords[idx[i] * 2], coords[idx[i] * 2 + 1], zOf(coords[idx[i] * 2], coords[idx[i] * 2 + 1])],
          [coords[idx[i + 1] * 2], coords[idx[i + 1] * 2 + 1], zOf(coords[idx[i + 1] * 2], coords[idx[i + 1] * 2 + 1])],
          [coords[idx[i + 2] * 2], coords[idx[i + 2] * 2 + 1], zOf(coords[idx[i + 2] * 2], coords[idx[i + 2] * 2 + 1])]);
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
      // zTop may be a function of (x, y) so a rim can follow the
      // fretboard radius curve (used for the countersink cone's top rim)
      var pT = function (r, a) {
        var px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
        return [px, py, typeof zTop === 'function' ? zTop(px, py) : zTop];
      };
      pushTri(t, pT(rTop, a0), pT(rTop, a1), p(rBot, zBot, a1));
      pushTri(t, pT(rTop, a0), p(rBot, zBot, a1), p(rBot, zBot, a0));
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
  function boardBody(p, holes, widthAt, y0, y1, stations, earcut, outline, zTopAt) {
    var T = p.thicknessMm;
    var curved = !!(p.radiusMm || 0);
    var tris = [];

    // top + bottom faces (top follows the radius curve when radiused;
    // the bottom stays flat for printing and neck contact)
    tris = tris.concat(flatFace(holes, SCREW.headRadius, zTopAt, true, widthAt, y1, stations, earcut));
    tris = tris.concat(flatFace(holes, SCREW.clearanceRadius, 0, false, widthAt, y1, stations, earcut));

    // side walls (outline is a closed perimeter polyline; the last point
    // wraps back to the first). Wall tops follow zTopAt; end edges
    // (constant y) are subdivided at the face-chain sample points so
    // the wall top and the face edge trace the same curve. End walls
    // are returned separately: at a split seam the two pieces' end
    // walls are coincident and internal, and the preview must paint
    // them UNDER the top faces or they leak through as dark shards.
    var endWalls = [];
    for (var e = 0; e < outline.length; e++) {
      var A = outline[e], B = outline[(e + 1) % outline.length];
      var pts = [A];
      if (curved && A[1] === B[1]) {
        for (var fi = 1; fi < CHAIN_FRACS.length - 1; fi++) {
          var f = (CHAIN_FRACS[fi] + 1) / 2;
          pts.push([A[0] + (B[0] - A[0]) * f, A[1]]);
        }
      }
      pts.push(B);
      for (var sg = 0; sg < pts.length - 1; sg++) {
        var P0 = pts[sg], P1 = pts[sg + 1];
        var wall = [];
        pushTri(wall, [P0[0], P0[1], 0], [P1[0], P1[1], 0], [P1[0], P1[1], zTopAt(P1[0])]);
        pushTri(wall, [P0[0], P0[1], 0], [P1[0], P1[1], zTopAt(P1[0])], [P0[0], P0[1], zTopAt(P0[0])]);
        forceNormals(wall, function (n, gx, gy) {
          // outward = away from the piece centre (0, (y0+y1)/2)
          return n[0] * gx + n[1] * (gy - (y0 + y1) / 2) > 0;
        });
        if (A[1] === B[1]) endWalls = endWalls.concat(wall);
        else tris = tris.concat(wall);
      }
    }

    // countersink cone + straight hole wall for each screw hole —
    // returned separately ('recess') so the preview can paint them as
    // their own layer between the board body and the raised features
    var coneDepth = Math.min(
      (SCREW.headRadius - SCREW.clearanceRadius) / Math.tan((SCREW.headAngleDeg / 2) * Math.PI / 180),
      T - 1.2
    );
    var recess = [];
    holes.forEach(function (h) {
      recess = recess.concat(ringStrip(h.x, h.y, SCREW.headRadius, curved ? zTopAt : T, SCREW.clearanceRadius, T - coneDepth));
      recess = recess.concat(ringStrip(h.x, h.y, SCREW.clearanceRadius, T - coneDepth, SCREW.clearanceRadius, 0));
    });
    return { tris: tris, endWalls: endWalls, recess: recess, coneDepth: coneDepth };
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
   *   headstockExtMm (flat extension past the nut toward the headstock,
   *   then a 45-degree taper down the full thickness to the tip — total
   *   reach is this plus the board thickness; 0 = board ends at the nut),
   *   radiusMm (fretboard radius across the width; 0 = flat. The bottom
   *   stays flat; frets, nut and the headstock extension follow the
   *   curve; thickness is measured at the centerline),
   *   nutHeightMm, nutDepthMm, stringGaugesIn (nut slot gauges, low->high),
   *   leftHanded (bool: mirror the nut slot order for a left-handed build),
   *   splitAfterFret (0 = one piece; N = two pieces, split just past fret N),
   *   fretSteps (semitone classes that get a ridge; null = chromatic),
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
      headstockExtMm: 0,
      radiusMm: 0,
      leftHanded: false,
      nutHeightMm: 2.0,
      nutDepthMm: 5,
      stringGaugesIn: null,
      fretBaseWidthMm: 2.4,
      splitAfterFret: 0,
      fretSteps: null,
      skipMarkers: [17]
    }, params);

    var warnings = [];
    var distances = [];
    var n;
    for (n = 0; n <= p.frets; n++) distances.push(fretDistance(p.scaleMm, n));
    // Which fret numbers actually get a ridge (all of them when chromatic)
    var keptFrets = [];
    for (n = 1; n <= p.frets; n++) {
      if (!p.fretSteps || p.fretSteps.indexOf(n % 12) !== -1) keptFrets.push(n);
    }
    var lastFretY = distances[p.frets];
    var length = lastFretY + p.tailMm;

    function widthAt(y) {
      return p.nutWidthMm + (p.heelWidthMm - p.nutWidthMm) * (y / lastFretY);
    }

    // --- fretboard radius ------------------------------------------------
    // Cylindrical curve across the width, crowned at the centerline:
    // sagAt(x) is how far the surface drops below the center height at
    // offset x; zTopAt(x) is the top surface height there. Flat (the
    // default) makes both constant.
    var radiusR = p.radiusMm || 0;
    function sagAt(x) {
      if (!radiusR) return 0;
      var q = radiusR * radiusR - x * x;
      return q <= 0 ? radiusR : radiusR - Math.sqrt(q);
    }
    function zTopAt(x) { return p.thicknessMm - sagAt(x); }
    if (radiusR) {
      var edgeT = p.thicknessMm - sagAt(Math.max(widthAt(length), p.nutWidthMm) / 2);
      if (edgeT < 3.3) {
        warnings.push('Fretboard edges get thin (≈' + (edgeT / 25.4).toFixed(2) +
          '″) with this radius at this width — consider a flatter radius or a thicker board.');
      }
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
    var groupBody = [], groupEndWalls = [], groupRecess = [], groupFeatures = [];
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

      var body = boardBody(p, pieceHoles, wFn, y0, y1, stations, earcut, outline, zTopAt);
      coneDepth = body.coneDepth;
      var ptris = body.tris.concat(body.endWalls, body.recess);
      groupBody = groupBody.concat(body.tris);
      groupEndWalls = groupEndWalls.concat(body.endWalls);
      groupRecess = groupRecess.concat(body.recess);

      // --- integrated frets whose ridge falls inside this piece --------
      // The fret profile is a half-ellipse crown (like real fret wire):
      // rounded over the top instead of a flat-topped trapezoid, so the
      // string rolls over it and there's no sharp edge to wear or chip.
      for (n = 1; n <= p.frets; n++) {
        if (keptFrets.indexOf(n) === -1) continue; // not in this fret mode
        var y = distances[n];
        if (y < y0 + 0.01 || y > y1 - 0.01) continue;
        var half = widthAt(y) / 2 - 0.4;
        var halfBase = p.fretBaseWidthMm / 2;
        var rise = p.fretHeightMm + embed; // ellipse semi-axis, base -> crown
        var profile = [
          [y - halfBase, p.thicknessMm - embed],
          [y + halfBase, p.thicknessMm - embed]
        ];
        var CSEG = 16, k, ang;
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
        var full = half - endLen; // half-width of the full-height zone
        var sections = [
          { x: -half, s: 0.5 },
          { x: -half + endLen * 0.5, s: 0.8 },
          { x: -full, s: 1 }
        ];
        [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75].forEach(function (fr) {
          sections.push({ x: fr * full, s: 1 });
        });
        sections.push(
          { x: full, s: 1 },
          { x: half - endLen * 0.5, s: 0.8 },
          { x: half, s: 0.5 }
        );
        // Each section drops by the radius sag at its x, so the crown
        // stands fretHeightMm proud of the LOCAL surface everywhere.
        sections.forEach(function (sec) { sec.dz = -sagAt(sec.x); });
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
          // 3-string CBG nuts use fixed spacing: center slot on the
          // centerline, the outer two 1/2" away on each side (clamped
          // on very narrow nuts so the slots stay on the board).
          if (p.strings === 3) {
            var s3 = Math.min(12.7, spread / 2);
            stringX = [-s3, 0, s3];
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
        } else {
          segs = [{ x0: -wn / 2, x1: wn / 2, top: nutTop }];
        }
        // Emit the nut segments as boxes. The two END segments get a
        // round-over at their outer face — a 1.2mm radius stepped in
        // 0.3mm slabs — so the nut's left and right ends can't catch
        // or cut a hand sliding up the neck. The long front/back edges
        // stay square, and slot floors are exact. On a radiused board
        // each segment is sliced into <=3mm sub-boxes whose tops follow
        // the curve (so slot depth is constant at every string), and
        // the nut's base reaches deeper so its corners stay buried.
        var nutBottom = p.thicknessMm - embed - sagAt(wn / 2);
        var ROLL_R = 1.2, ROLL_STEP = 0.3;
        function emitBox(x0, x1, top, roll) {
          if (!roll || x1 - x0 < ROLL_R + 0.6) {
            ptris = ptris.concat(box(x0, x1, 0, p.nutDepthMm, nutBottom, top));
            return;
          }
          var n = Math.round(ROLL_R / ROLL_STEP);
          var from = roll === 'L' ? x0 : x1 - ROLL_R;
          for (var i = 0; i < n; i++) {
            var sx0 = from + (ROLL_R * i) / n, sx1 = from + (ROLL_R * (i + 1)) / n;
            var d = roll === 'L' ? (sx0 + sx1) / 2 - x0 : x1 - (sx0 + sx1) / 2;
            var sz = top - ROLL_R + Math.sqrt(Math.max(0, ROLL_R * ROLL_R - (ROLL_R - d) * (ROLL_R - d)));
            ptris = ptris.concat(box(sx0, sx1, 0, p.nutDepthMm, nutBottom, sz));
          }
          if (roll === 'L') ptris = ptris.concat(box(x0 + ROLL_R, x1, 0, p.nutDepthMm, nutBottom, top));
          else ptris = ptris.concat(box(x0, x1 - ROLL_R, 0, p.nutDepthMm, nutBottom, top));
        }
        segs.forEach(function (s, si) {
          if (s.x1 - s.x0 <= 0.01) return;
          var roll = si === 0 ? 'L' : si === segs.length - 1 ? 'R' : null;
          if (!radiusR) {
            emitBox(s.x0, s.x1, s.top, roll);
            return;
          }
          var steps = Math.max(1, Math.ceil((s.x1 - s.x0) / 3));
          for (var st = 0; st < steps; st++) {
            var bx0 = s.x0 + ((s.x1 - s.x0) * st) / steps;
            var bx1 = s.x0 + ((s.x1 - s.x0) * (st + 1)) / steps;
            var bTop = s.top - sagAt((bx0 + bx1) / 2);
            emitBox(bx0, bx1, bTop,
              st === 0 && roll === 'L' ? 'L' : st === steps - 1 && roll === 'R' ? 'R' : null);
          }
        });
      }

      // --- headstock extension (first piece only) ----------------------
      // A Strat-style tongue past the nut: a FLAT portion at full
      // thickness extends headstockExtMm past the nut, then a 45-degree
      // taper runs down the full board thickness to the tip — so the
      // total reach past the nut is headstockExtMm + thicknessMm.
      if (pieceIdx === 0 && p.headstockExtMm > 0) {
        var ext = p.headstockExtMm;
        var wProfile = [[0, 0], [-(ext + p.thicknessMm), 0], [-ext, p.thicknessMm], [0, p.thicknessMm]];
        var wSecs = [-1, -0.5, 0, 0.5, 1].map(function (fr) {
          var wx = (fr * wn) / 2;
          return { x: wx, s: 1, dz: -sagAt(wx) };
        });
        ptris = ptris.concat(loftProfileX(wProfile, 0, 0, wSecs));
      }

      groupFeatures = groupFeatures.concat(ptris.slice(body.tris.length + body.endWalls.length + body.recess.length));
      var extReach = (p.headstockExtMm || 0) > 0 ? p.headstockExtMm + p.thicknessMm : 0;
      var pieceY0 = pieceIdx === 0 ? y0 - extReach : y0;
      pieces.push({ y0: pieceY0, y1: y1, lengthMm: y1 - pieceY0, triangles: ptris });
      tris = tris.concat(ptris);
    });

    return {
      triangles: tris,
      // Preview layers, painted in this order (the camera always looks
      // from above the board): body, then the recessed hole walls, then
      // the raised features. Same triangles as 'pieces', grouped so the
      // painter sort never has to order a fret against the face under it.
      groups: { endWalls: groupEndWalls, body: groupBody, recess: groupRecess, features: groupFeatures },
      pieces: pieces,
      meta: {
        lengthMm: length + ((p.headstockExtMm || 0) > 0 ? p.headstockExtMm + p.thicknessMm : 0),
        lastFretYMm: lastFretY,
        nutWidthMm: wn,
        tailWidthMm: widthAt(length),
        fretDistancesMm: distances,
        holes: holes,
        skippedMarkers: skippedMarkers,
        coneDepthMm: coneDepth,
        splitYMm: splitY,
        keptFrets: keptFrets,
        radiusMm: radiusR,
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
    FRET_MODES: FRET_MODES,
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
