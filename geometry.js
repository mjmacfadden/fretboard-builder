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

  /**
   * Same loft, transposed: a convex profile in the (x, z) plane lofted
   * along y through sections [{y, s, dz}], scaled about (cx, zBase).
   * Used for the nut's end segments, whose side profile carries the
   * rounded-over end as a true arc.
   */
  function loftProfileY(profile, cx, zBase, sections) {
    var t = [];
    var n = profile.length;
    var secs = sections.map(function (sec) {
      return profile.map(function (p) {
        return [cx + (p[0] - cx) * sec.s, sec.y, zBase + (p[1] - zBase) * sec.s + (sec.dz || 0)];
      });
    });
    var i, j;
    var first = secs[0], last = secs[secs.length - 1];
    for (j = 1; j < n - 1; j++) {
      pushTri(t, first[0], first[j], first[j + 1]);
      pushTri(t, last[0], last[j + 1], last[j]);
    }
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
      // NOTE: the span uses the head radius (the larger of the two face
      // radii) regardless of which face is being built, so the top and
      // bottom faces end up with IDENTICAL station lists — their
      // boundaries must match vertex for vertex for the walls to share
      // edges with both (watertightness).
      return !sorted.some(function (h) { return Math.abs(y - h.y) <= SCREW.headRadius + 0.6; });
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

    // The face's boundary, in order: the side sequences are the chains'
    // endpoints, the end sequences are the first/last chains. The side
    // and end walls are built from THESE points, so every wall edge is
    // shared with a face edge — no T-junctions, no open edges.
    function withZ(chain) {
      return chain.map(function (pt) { return [pt[0], pt[1], zOf(pt[0], pt[1])]; });
    }
    var boundary = {
      left: withZ(chains.map(function (ch) { return ch[0]; })),
      right: withZ(chains.map(function (ch) { return ch[ch.length - 1]; })),
      first: withZ(chains[0]),
      last: withZ(chains[chains.length - 1])
    };

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
    return {
      tris: forceNormals(tris, function (n) { return up ? n[2] > 0 : n[2] < 0; }),
      boundary: boundary
    };
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
  function boardBody(p, holes, widthAt, y0, y1, stations, earcut, zTopAt) {
    var T = p.thicknessMm;
    var curved = !!(p.radiusMm || 0);
    var tris = [];

    // top + bottom faces (top follows the radius curve when radiused;
    // the bottom stays flat for printing and neck contact)
    var topFace = flatFace(holes, SCREW.headRadius, zTopAt, true, widthAt, y1, stations, earcut);
    // the bottom z is a function too (returning 0) so its station
    // chains sample across the width exactly like the top face's —
    // the end walls are built from those chain points, and a 2-point
    // bottom chain would leave the walls' subdivided bottom edges
    // unmatched (open edges at every piece end)
    var botFace = flatFace(holes, SCREW.clearanceRadius, function () { return 0; }, false, widthAt, y1, stations, earcut);
    tris = tris.concat(topFace.tris, botFace.tris);

    // Side and end walls, built from the top face's OWN boundary
    // vertices (returned by flatFace), so every wall edge coincides
    // with a face edge: the mesh is watertight — no T-junctions where
    // a long wall edge passes a face vertex. End walls are returned
    // separately: at a split seam the two pieces' end walls are
    // coincident and internal, and the preview must paint them UNDER
    // the top faces or they leak through as dark shards.
    function outward(n, gx, gy) {
      // outward = away from the piece centre (0, (y0+y1)/2)
      return n[0] * gx + n[1] * (gy - (y0 + y1) / 2) > 0;
    }
    function wallStrip(pts) {
      var w = [];
      for (var sg = 0; sg < pts.length - 1; sg++) {
        var P0 = pts[sg], P1 = pts[sg + 1];
        if (P0[0] === P1[0] && P0[1] === P1[1]) continue; // degenerate
        pushTri(w, [P0[0], P0[1], 0], [P1[0], P1[1], 0], [P1[0], P1[1], P1[2]]);
        pushTri(w, [P0[0], P0[1], 0], [P1[0], P1[1], P1[2]], [P0[0], P0[1], P0[2]]);
      }
      return forceNormals(w, outward);
    }
    tris = tris.concat(wallStrip(topFace.boundary.left), wallStrip(topFace.boundary.right));
    var endWalls = wallStrip(topFace.boundary.first).concat(wallStrip(topFace.boundary.last));

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
   *   nutHeightMm (minimum nut height), nutDepthMm, slotHeightMm (target
   *   height of the treble string's underside above the 1st fret crown at
   *   the nut face; bass strings ramp up to +0.2mm, capped at 0.5mm),
   *   slotSlopeDeg (slot floors slope down toward the headstock at this
   *   angle from their high point at the fret-side face; default 7.5),
   *   stringGaugesIn (nut slot gauges, low->high),
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
  /**
   * Reject parameters the geometry can't honour, with a clear error —
   * better to fail loudly here than to emit NaN coordinates and a
   * broken STL. Ranges are generous (well past the UI's limits); the
   * UI surfaces the message instead of downloading anything.
   */
  function validateParams(p) {
    function num(name, v) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error('Invalid ' + name + ': expected a finite number, got ' + String(v));
      }
    }
    function range(name, v, lo, hi) {
      num(name, v);
      if (v < lo || v > hi) {
        throw new Error('Invalid ' + name + ': ' + v + ' is outside the supported range ' + lo + '–' + hi);
      }
    }
    function intRange(name, v, lo, hi) {
      num(name, v);
      if (!Number.isInteger(v) || v < lo || v > hi) {
        throw new Error('Invalid ' + name + ': expected a whole number from ' + lo + ' to ' + hi + ', got ' + v);
      }
    }
    range('scaleMm', p.scaleMm, 100, 2000);
    intRange('strings', p.strings, 1, 6);
    intRange('frets', p.frets, 1, 36);
    range('nutWidthMm', p.nutWidthMm, 10, 150);
    range('heelWidthMm', p.heelWidthMm, 10, 200);
    range('thicknessMm', p.thicknessMm, 1, 25);
    range('fretHeightMm', p.fretHeightMm, 0, 3);
    range('tailMm', p.tailMm, 0, 300);
    range('nutHeightMm', p.nutHeightMm, 0.5, 10);
    range('nutDepthMm', p.nutDepthMm, 2, 15);
    range('slotHeightMm', p.slotHeightMm, 0.05, 1);
    range('slotSlopeDeg', p.slotSlopeDeg, 0, 20);
    range('tailCornerRadiusMm', p.tailCornerRadiusMm, 0, 25);
    range('headstockExtMm', p.headstockExtMm, 0, 100);
    range('radiusMm', p.radiusMm, 0, 5000);
    if (p.radiusMm > 0 && p.radiusMm < 75) {
      throw new Error('Invalid radiusMm: ' + p.radiusMm + ' is too tight — minimum 75, or 0 for a flat board');
    }
    range('fretBaseWidthMm', p.fretBaseWidthMm, 0.5, 8);
    intRange('splitAfterFret', p.splitAfterFret, 0, 36);
    if (p.stringGaugesIn != null) {
      if (!Array.isArray(p.stringGaugesIn) || p.stringGaugesIn.length === 0) {
        throw new Error('Invalid stringGaugesIn: expected a non-empty array of string gauges (inches)');
      }
      p.stringGaugesIn.forEach(function (g, i) { range('stringGaugesIn[' + i + ']', g, 0.005, 0.1); });
    }
    if (p.fretSteps != null && !Array.isArray(p.fretSteps)) {
      throw new Error('Invalid fretSteps: expected an array of semitone classes, or null for chromatic');
    }
    if (p.skipMarkers != null && !Array.isArray(p.skipMarkers)) {
      throw new Error('Invalid skipMarkers: expected an array of fret numbers');
    }
  }

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
      slotHeightMm: 0.3,
      slotSlopeDeg: 7.5,
      nutDepthMm: 5,
      stringGaugesIn: null,
      fretBaseWidthMm: 2.4,
      splitAfterFret: 0,
      fretSteps: null,
      skipMarkers: [17]
    }, params);
    validateParams(p);

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
      // y < 0 is the board's extension under the nut (headstock side of
      // the scale zero): the width stays at the nut width there rather
      // than extrapolating the taper past the nut.
      return p.nutWidthMm + (p.heelWidthMm - p.nutWidthMm) * (Math.max(y, 0) / lastFretY);
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
    // The board blank starts nutDepthMm BEFORE the scale zero: the nut
    // sits on the headstock side of y=0, so its fret-side face — the
    // point the strings actually leave from — is exactly at y=0 and
    // every fret distance is measured from the true break point.
    var boardStart = -p.nutDepthMm;
    var ranges = splitY === null ? [[boardStart, length]] : [[boardStart, splitY], [splitY, length]];

    var embed = 0.6;
    var groupBody = [], groupEndWalls = [], groupRecess = [], groupFeatures = [];
    var wn = p.nutWidthMm;
    var gauges = p.stringGaugesIn || STRING_GAUGES[p.strings] || STRING_GAUGES[3];
    var coneDepth = 0;
    var nutInfo = null;
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
      }

      var body = boardBody(p, pieceHoles, wFn, y0, y1, stations, earcut, zTopAt);
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
        // Cosine-eased scale steps so the end dome blends smoothly
        // instead of terracing in two big jumps (0.5 -> 0.8 -> 1).
        var sections = [];
        var ek, efr;
        for (ek = 0; ek <= 5; ek++) {
          efr = ek / 5;
          sections.push({ x: -half + endLen * efr, s: 1 - 0.5 * Math.cos(efr * Math.PI / 2) });
        }
        [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75].forEach(function (fr) {
          sections.push({ x: fr * full, s: 1 });
        });
        for (ek = 5; ek >= 0; ek--) {
          efr = ek / 5;
          sections.push({ x: half - endLen * efr, s: 1 - 0.5 * Math.cos(efr * Math.PI / 2) });
        }
        // Each section drops by the radius sag at its x, so the crown
        // stands fretHeightMm proud of the LOCAL surface everywhere.
        sections.forEach(function (sec) { sec.dz = -sagAt(sec.x); });
        ptris = ptris.concat(loftProfileX(profile, y, p.thicknessMm - embed, sections));
      }

      // --- integrated nut with string slots (first piece only) ---------
      // Each slot is sized for its string: width = gauge + a hair of
      // clearance. The slot FLOOR is set from a target action: how high
      // the string's underside sits above the first fret's crown,
      // measured at the nut's fret-side face. Bass strings sit highest,
      // treble strings lowest — slotHeightMm is the treble target and
      // the bass target runs up to 0.2mm higher (capped at 0.5mm). The
      // nut top then follows from the floors: each string sits ~60% of
      // its diameter down in its slot, and the nut is never shorter
      // than nutHeightMm. The nut is built as a row of segment boxes
      // alternating raised material and slot floors.
      if (pieceIdx === 0) {
        var nStr = p.strings;
        var trebleTarget = p.slotHeightMm;
        var bassTarget = Math.min(0.5, p.slotHeightMm + 0.2);
        function slotTarget(j) { // j: string index, low -> high
          if (nStr <= 1) return trebleTarget;
          return bassTarget + (trebleTarget - bassTarget) * (j / (nStr - 1));
        }
        function slotFloor(j) {
          // never below the first fret's crown (+ a hair for safety)
          return Math.max(p.thicknessMm + p.fretHeightMm + slotTarget(j),
            p.thicknessMm + p.fretHeightMm + 0.02);
        }
        var nutTop = p.thicknessMm + p.nutHeightMm;
        var nutTargets = [], nutFloors = [];
        if (nStr > 0) {
          for (var gi = 0; gi < nStr; gi++) {
            var gDia = (gauges[gi] || 0.024) * 25.4;
            nutTargets.push(slotTarget(gi));
            nutFloors.push(slotFloor(gi));
            nutTop = Math.max(nutTop, slotFloor(gi) + 0.6 * gDia);
          }
        }
        nutInfo = { topMm: nutTop, targetsMm: nutTargets, floorsMm: nutFloors };
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
            // reversed; the left-handed option restores low-at--x. The
            // gauge index j follows the STRING (not the slot position),
            // so the slot-floor target ramp tracks pitch.
            var j = p.leftHanded ? si : p.strings - 1 - si;
            var g = gauges[j];
            var diaMm = (g || 0.024) * 25.4;
            var w = diaMm + 0.1;
            segs.push({ x0: cursor, x1: x - w / 2, top: nutTop });
            segs.push({ x0: x - w / 2, x1: x + w / 2, top: slotFloor(j), slot: true, j: j });
            cursor = x + w / 2;
          });
          segs.push({ x0: cursor, x1: wn / 2, top: nutTop });
        } else {
          segs = [{ x0: -wn / 2, x1: wn / 2, top: nutTop }];
        }
        // Emit the nut segments. The two END segments get a round-over
        // at their outer face — a true 1.2mm radius carried in the
        // segment's side profile and lofted along the nut's depth — so
        // the nut's left and right ends can't catch or cut a hand
        // sliding up the neck. The long front/back edges stay square,
        // and slot floors are exact boxes. On a radiused board each
        // segment is sliced into <=3mm sub-boxes whose tops follow the
        // curve (so slot depth is constant at every string), and the
        // nut's base reaches deeper so its corners stay buried.
        var nutBottom = p.thicknessMm - embed - sagAt(wn / 2);
        var ROLL_R = 1.2;
        function rolledProfile(x0, x1, top, roll) {
          var prof = [[x0, nutBottom], [x1, nutBottom]];
          var a, th;
          if (roll === 'R' || roll === 'LR') {
            prof.push([x1, top - ROLL_R]);
            for (a = 15; a < 90; a += 15) {
              th = (a * Math.PI) / 180;
              prof.push([x1 - ROLL_R + ROLL_R * Math.cos(th), top - ROLL_R + ROLL_R * Math.sin(th)]);
            }
            prof.push([x1 - ROLL_R, top]);
          } else {
            prof.push([x1, top]);
          }
          if (roll === 'L' || roll === 'LR') {
            prof.push([x0 + ROLL_R, top]);
            for (a = 105; a < 180; a += 15) {
              th = (a * Math.PI) / 180;
              prof.push([x0 + ROLL_R + ROLL_R * Math.cos(th), top - ROLL_R + ROLL_R * Math.sin(th)]);
            }
            prof.push([x0, top - ROLL_R]);
          } else if (roll === 'R') {
            prof.push([x0, top]); // close the top edge (the L block does it otherwise)
          }
          return prof;
        }
        function emitBox(x0, x1, top, roll) {
          var need = roll === 'LR' ? 2 * ROLL_R + 0.6 : ROLL_R + 0.6;
          if (!roll || x1 - x0 < need) {
            ptris = ptris.concat(box(x0, x1, -p.nutDepthMm, 0, nutBottom, top));
            return;
          }
          ptris = ptris.concat(loftProfileY(
            rolledProfile(x0, x1, top, roll), (x0 + x1) / 2, nutBottom,
            [{ y: -p.nutDepthMm, s: 1 }, { y: 0, s: 1 }]));
        }
        // Emit one slot as a prism whose top — the slot floor — slopes
        // DOWN toward the headstock: highest exactly at the fret-side
        // face (y=0, the scale zero), so the string's only contact
        // point, its break point, is pinned to the face. The drop over
        // the nut depth is tan(slope) x depth, clamped so at least
        // 0.3mm of nut always remains under the slot. Floors are
        // lofted with shared vertices, keeping the mesh watertight.
        var nutFloorsBack = [];
        function emitSlot(x0, x1, floor) {
          var drop = Math.min(
            Math.tan((p.slotSlopeDeg * Math.PI) / 180) * p.nutDepthMm,
            floor - (nutBottom + 0.3));
          if (drop < 0) drop = 0;
          var profile = [
            [-p.nutDepthMm, nutBottom], [0, nutBottom],
            [0, floor], [-p.nutDepthMm, floor - drop]
          ];
          var steps = Math.max(1, Math.ceil((x1 - x0) / 3));
          for (var st = 0; st < steps; st++) {
            var bx0 = x0 + ((x1 - x0) * st) / steps;
            var bx1 = x0 + ((x1 - x0) * (st + 1)) / steps;
            var dz = -sagAt((bx0 + bx1) / 2);
            ptris = ptris.concat(loftProfileX(profile, 0, 0, [
              { x: bx0, s: 1, dz: dz }, { x: bx1, s: 1, dz: dz }
            ]));
          }
          return floor - drop;
        }
        segs.forEach(function (s, si) {
          if (s.x1 - s.x0 <= 0.01) return;
          if (s.slot) {
            nutFloorsBack[s.j] = emitSlot(s.x0, s.x1, s.top);
            return;
          }
          var roll = segs.length === 1 ? 'LR' : si === 0 ? 'L' : si === segs.length - 1 ? 'R' : null;
          if (!radiusR) {
            emitBox(s.x0, s.x1, s.top, roll);
            return;
          }
          var steps = Math.max(1, Math.ceil((s.x1 - s.x0) / 3));
          for (var st = 0; st < steps; st++) {
            var bx0 = s.x0 + ((s.x1 - s.x0) * st) / steps;
            var bx1 = s.x0 + ((s.x1 - s.x0) * (st + 1)) / steps;
            var bTop = s.top - sagAt((bx0 + bx1) / 2);
            var subRoll = null;
            if (st === 0 && (roll === 'L' || roll === 'LR')) subRoll = steps === 1 ? 'LR' : 'L';
            if (st === steps - 1 && (roll === 'R' || roll === 'LR')) subRoll = steps === 1 ? 'LR' : 'R';
            emitBox(bx0, bx1, bTop, subRoll);
          }
        });
        if (nutInfo) nutInfo.floorsBackMm = nutFloorsBack;
      }

      // --- headstock extension (first piece only) ----------------------
      // A Strat-style tongue past the nut: a FLAT portion at full
      // thickness extends headstockExtMm past the nut, then a 45-degree
      // taper runs down the full board thickness to the tip — so the
      // total reach past the nut is headstockExtMm + thicknessMm.
      if (pieceIdx === 0 && p.headstockExtMm > 0) {
        var ext = p.headstockExtMm;
        var nd = p.nutDepthMm; // the wedge starts at the nut's headstock face
        var wProfile = [[-nd, 0], [-(nd + ext + p.thicknessMm), 0], [-(nd + ext), p.thicknessMm], [-nd, p.thicknessMm]];
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
        lengthMm: p.nutDepthMm + length + ((p.headstockExtMm || 0) > 0 ? p.headstockExtMm + p.thicknessMm : 0),
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
        nut: nutInfo,
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
