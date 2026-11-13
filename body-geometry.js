/*
 * body-geometry.js — parametric clamshell guitar body ("body builder").
 *
 * A small acoustic-style body for 3- and 4-string guitars, made of:
 *   - a printed rim (ring) split down the centre line into two mirror
 *     halves (left and right) that clamp together with bolts through a
 *     solid neck block and a solid tail block;
 *   - a flat 1/8" (3.175 mm) plywood top and back that slide into
 *     grooves (tracks) cut into the inside of the rim near its top and
 *     bottom edges, and are trapped there when the halves bolt up;
 *   - a neck pocket in the neck block for a bolt-on wooden neck, held by
 *     four wood screws through a back plate (or through counterbored
 *     screw wells with washers / ferrules).
 *
 * Coordinates, millimetres: x across the body (the halves split at
 * x = 0), y along the body (tail tip y = 0, neck end y = L), z up from
 * the back face (z = 0, the face that lies on the print bed).
 *
 * The rim is "2.5D": it is built as a stack of horizontal slabs, each
 * slab a 2D region computed with polygon booleans (Clipper), then
 * meshed into one closed (watertight) triangle mesh per half.
 * Every overhang is a 45-degree staircase, so the halves print back-face
 * down with no supports.
 *
 * Outlines may be asymmetric (the T-Style single cutaway): each side
 * has its own width function, the halves are simply what lies left and
 * right of x = 0, so they need not be mirror images.
 *
 * Pure math, no DOM. In the browser it attaches `window.BodyBuilder`;
 * in Node it uses module.exports so the geometry can be unit-tested.
 */
(function (global) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var ClipperLib = isNode ? require('./vendor/clipper.js') : global.ClipperLib;
  var earcut = isNode ? require('./vendor/earcut.min.js') : global.earcut;

  var IN = 25.4;
  var S = 1000;          // Clipper works in integers: 1 unit = 1 micron
  var BIG = 2000 * S;    // "infinity" for half-planes and strips
  var STEP = 0.4;        // staircase step (mm) for every printed overhang
  var ARC_TOL = 0.03 * S;
  var FLOOR_MIN = 15;
  // Thinnest plain wall: 2 mm is five 0.4 mm perimeters. Behind each
  // channel the wall alone joins the upper and lower lips, and a panel
  // pried up levers on it over the 7 mm lip; thinner than this it cracks
  // along a layer line.
  var WALL_MIN = 2.0;    // mm of printed block kept under the neck pocket floor

  // Clearance holes / washers for the clamshell bolts.
  var BOLTS = {
    // nomMm: thread size; nutAFMm: nut across flats; insertHoleMm /
    // insertLenMm: hole for a common heat-set insert of that thread.
    M3: { label: 'M3', holeMm: 3.4, washerMm: 7.0, nutMm: 2.4, washerTMm: 0.5, nomMm: 3.0, nutAFMm: 5.5, insertHoleMm: 4.0, insertLenMm: 5.7 },
    M4: { label: 'M4', holeMm: 4.5, washerMm: 9.0, nutMm: 3.2, washerTMm: 0.8, nomMm: 4.0, nutAFMm: 7.0, insertHoleMm: 5.6, insertLenMm: 8.1 },
    '#6': { label: '#6', holeMm: 3.8, washerMm: 9.5, nutMm: 2.8, washerTMm: 1.2, nomMm: 3.5, nutAFMm: 7.94, insertHoleMm: 4.8, insertLenMm: 7.1 }
  };
  var METRIC_LENGTHS = [8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100];

  // Every user-adjustable value with its default. Big dimensions are in
  // inches (like the fretboard builder), fine clearances in millimetres.
  var DEFAULTS = {
    style: 'parlor',
    shape: 'bouts',          // 'bouts' (lower bout / waist / upper bout), 'box', or 'tstyle' (single cutaway)
    lengthIn: 12.5,
    lowerWidthIn: 9.5,
    waistWidthIn: 5.75,
    upperWidthIn: 7.0,
    lowerPos: 0.30,          // widest point of the lower bout, fraction of length from the tail
    waistPos: 0.57,
    upperPos: 0.80,
    widthIn: 7.0,            // box and T-Style shapes
    cornerRadiusIn: 0.5,     // box shape only
    depthIn: 3.25,           // rim height = overall body depth
    wallMm: 3.0,             // plain rim wall thickness (outside to inside face); the channel flanges add to it at each panel level
    panelThicknessMm: 3.175, // 1/8" plywood
    panelFitMm: 0.4,         // extra channel height over the panel thickness (0.1 of it absorbs roof sag)
    // Panel channels: an inward flange ring at each panel level, with a lip
    // on each face of the panel (see build()).
    channelDepthMm: 7.5,     // lip reach inward from the channel back (panel engages this minus the edge gap)
    channelRoofFlatMm: 3.0,  // flat (unsupported) part of each channel roof next to the wall; 45 deg beyond
    innerLipMm: 3.0,         // thickness at the edge of the two lips on the inside of the body
    panelEdgeGapMm: 0.5,     // gap left at the back of the channel (panel is cut this much smaller)
    topLipMm: 3.0,           // thickness of the top channel's upper lip at its edge
    bottomLipMm: 3.0,        // thickness of the back channel's lower lip (on the bed)
    pocketLengthIn: 3.0,
    pocketWidthIn: 1.5,
    pocketDepthIn: 0.9,      // pocket floor below the top surface of the top panel
    pocketFitMm: 0.15,       // added to each side of the pocket width
    neckBlockSideMm: 19.0,   // solid wall each side of the pocket
    neckBlockEndMm: 19.0,    // solid wall past the inner end of the pocket
    baseBlockMm: 18.0,       // full-width slab height at both ends (carries the bolts)
    tailBlockLengthMm: 30.0,
    tailBlockWidthMm: 50.0,
    neckScrewMode: 'plate',  // 'plate' (back plate on the back face) or 'wells' (washers / ferrules)
    neckScrewSpanXIn: 0.875, // hole spacing across the neck
    neckScrewSpanYIn: 1.75,  // hole spacing along the neck
    neckScrewHoleMm: 4.6,    // clearance for a #8 wood screw
    wellDiameterMm: 16.0,
    wellFloorMm: 25.4,       // printed floor kept between the wells and the pocket
    plateThicknessMm: 3.0,
    screwBiteMm: 19.0,       // thread length wanted in the wooden neck
    boltSize: 'M4',
    neckBolts: 0,            // sideways bolts through the neck block (0 with the neck collar)
    tailBolts: 2,            // 1 = low bolt in the end slab; 2 = plus an upper bolt just under the top channel
    neckCollar: true,        // print the upper neck block (pocket walls) as its own part, bolted down vertically
    collarFastener: 'nut',   // 'nut' (hex nut traps, dropped in from the top) or 'insert' (heat-set inserts)
    collarClearanceMm: 0.25, // gap between the collar and the rim's inside wall
    collarNutFloorMm: 8.0,   // collar plastic between the nut and the collar's underside
    bedMm: 327.66,           // 12.9"
    leftHanded: false        // mirror asymmetric outlines (cutaway on the other side)
  };

  // Body style presets (generic names). Values not listed keep defaults.
  var STYLES = {
    parlor: {
      label: 'Parlor',
      values: { shape: 'bouts', lengthIn: 12.5, lowerWidthIn: 9.5, waistWidthIn: 5.75, upperWidthIn: 7.0,
        lowerPos: 0.30, waistPos: 0.57, upperPos: 0.80, depthIn: 3.25 }
    },
    'small-dread': {
      label: 'Small dreadnought style',
      values: { shape: 'bouts', lengthIn: 12.75, lowerWidthIn: 10.0, waistWidthIn: 7.25, upperWidthIn: 8.25,
        lowerPos: 0.31, waistPos: 0.56, upperPos: 0.78, depthIn: 3.5 }
    },
    round: {
      label: 'Round',
      values: { shape: 'bouts', lengthIn: 11.5, lowerWidthIn: 11.5, waistWidthIn: 11.5, upperWidthIn: 11.5,
        lowerPos: 0.5, waistPos: 0.5, upperPos: 0.5, depthIn: 3.0 }
    },
    'cigar-box': {
      label: 'Cigar-box style',
      values: { shape: 'box', lengthIn: 12.0, widthIn: 7.0, cornerRadiusIn: 0.5, depthIn: 3.0 }
    },
    // Single-cutaway slab body traced from t-style-body-outline.svg and
    // scaled uniformly to 12.9" long (10.52" wide). 12.9" is the whole
    // bed, so the bed warning stays on: print diagonally, or see README.
    't-style': {
      label: 'T-Style',
      values: { shape: 'tstyle', lengthIn: 12.9, widthIn: 10.52, depthIn: 1.85 }
    }
  };
  var STYLE_KEYS = ['parlor', 'small-dread', 'round', 'cigar-box', 't-style'];
  var STYLE_FIELDS = ['shape', 'lengthIn', 'lowerWidthIn', 'waistWidthIn', 'upperWidthIn',
    'lowerPos', 'waistPos', 'upperPos', 'widthIn', 'cornerRadiusIn', 'depthIn'];

  function styleParams(key) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = DEFAULTS[k]; });
    var st = STYLES[key];
    if (st) Object.keys(st.values).forEach(function (k) { out[k] = st.values[k]; });
    out.style = st ? key : 'custom';
    return out;
  }

  // Which preset (if any) the given values match; 'custom' otherwise.
  function matchStyle(p) {
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      var v = STYLES[STYLE_KEYS[i]].values, ok = true;
      for (var k in v) {
        if (typeof v[k] === 'number' ? Math.abs(Number(p[k]) - v[k]) > 1e-9 : p[k] !== v[k]) { ok = false; break; }
      }
      if (ok) return STYLE_KEYS[i];
    }
    return 'custom';
  }

  function withDefaults(p) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = (p && p[k] !== undefined && p[k] !== null && p[k] !== '') ? p[k] : DEFAULTS[k];
      if (typeof DEFAULTS[k] === 'number') out[k] = Number(out[k]);
    });
    return out;
  }

  // ------------------------------------------------------------------
  // Outline: half width hw(y) of the body, symmetric about x = 0.
  // ------------------------------------------------------------------
  function shapeOf(p) {
    var L = p.lengthIn * IN;
    if (p.shape === 'tstyle') return tstyleShape(p, L);
    if (p.shape === 'box') {
      var hwb = p.widthIn * IN / 2;
      var r = Math.max(0.5, Math.min(p.cornerRadiusIn * IN, hwb - 0.5, L / 2 - 0.5));
      return { kind: 'box', L: L, hw: hwb, r: r };
    }
    var c1 = clamp(p.lowerPos, 0.05, 0.95) * L;
    var c2 = clamp(p.upperPos, 0.05, 0.95) * L;
    if (c2 < c1) c2 = c1;
    var yw = clamp(p.waistPos * L, c1, c2);
    return { kind: 'bouts', L: L, c1: c1, c2: c2, yw: yw,
      h1: p.lowerWidthIn * IN / 2, hw: p.waistWidthIn * IN / 2, h2: p.upperWidthIn * IN / 2 };
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Distance from the centre line (x = 0) to the outline at y, on the
  // 'right' (+x, default) or 'left' (-x) side.
  function halfWidth(sh, y, side) {
    var L = sh.L;
    if (sh.kind === 'tstyle') return polyHalfWidth(sh.poly, y, side === 'left' ? 'left' : 'right');
    if (y <= 0 || y >= L) return 0;
    if (sh.kind === 'box') {
      var r = sh.r, d = 0;
      if (y < r) d = r - Math.sqrt(Math.max(0, r * r - (r - y) * (r - y)));
      else if (y > L - r) d = r - Math.sqrt(Math.max(0, r * r - (y - (L - r)) * (y - (L - r))));
      return sh.hw - d;
    }
    if (y <= sh.c1) {
      var u = (sh.c1 - y) / sh.c1;
      return sh.h1 * Math.sqrt(Math.max(0, 1 - u * u));
    }
    if (y >= sh.c2) {
      var w = (y - sh.c2) / (L - sh.c2);
      return sh.h2 * Math.sqrt(Math.max(0, 1 - w * w));
    }
    // smooth (cosine) blends lower bout -> waist -> upper bout
    if (y <= sh.yw) {
      var t = sh.yw > sh.c1 ? (y - sh.c1) / (sh.yw - sh.c1) : 1;
      return sh.h1 + (sh.hw - sh.h1) * (1 - Math.cos(Math.PI * t)) / 2;
    }
    var t2 = sh.c2 > sh.yw ? (y - sh.yw) / (sh.c2 - sh.yw) : 1;
    return sh.hw + (sh.h2 - sh.hw) * (1 - Math.cos(Math.PI * t2)) / 2;
  }

  // ------------------------------------------------------------------
  // T-Style: outline traced from a drawing of the single-cutaway slab
  // body (t-style-body-outline.svg, path cls-1), neck end on the right.
  // TSTYLE_POCKET is the drawing's neck pocket marker (cls-2): its right
  // end is the neck end and its centre line is the body's centre line.
  // ------------------------------------------------------------------
  var TSTYLE_PATH = 'M814.57,506.07c-13.33,15.22-34.93,69.28,38.53,115.61,42.39,26.73,97.73,24.06,97.73,72.12,0,37.82-48.46,60.81-106.19,60.81-114.58-7.26-153.26-57.69-213.83-60.07-45.27-1.78-114.72,28.21-174.6,60.73-110.3,50.85-190.81,55.59-253.99,43.02-20.92-4.16-49.38-20.42-75.46-40.38-61.61-47.13-81.46-168.17-87.85-241.27-.02-.15-.03-.3-.04-.45v-177.63c.05-.63.11-1.27.16-1.92,5.2-60.3,18.96-150.47,55.37-205.37,57.51-79.17,160.36-122.54,361.81-29.68,59.88,32.52,129.33,62.51,174.6,60.73,60.57-2.38,99.25-52.82,213.83-60.07,139.08-2.37,114.68,120.45,75.54,178.14-45.65,67.29,44.49,77.21,44.49,91.04v108h-17.26l-5.22.1s-31.97-.1-64.14-.1-53.78,15.56-63.48,26.64Z';
  var TSTYLE_POCKET = { x0: 748.67, x1: 964.67, y0: 371.43, y1: 479.43 };

  // SVG path (M/L/H/V/C/S/Z, absolute or relative) -> points, curves
  // flattened to n segments each
  function flattenPath(d, n) {
    var tok = d.match(/[MmLlHhVvCcSsZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g), i = 0, cmd = null;
    var cx = 0, cy = 0, sx = 0, sy = 0, lc = null, pts = [];
    function num() { return parseFloat(tok[i++]); }
    while (i < tok.length) {
      if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
      var rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      var ox = rel ? cx : 0, oy = rel ? cy : 0;
      if (C === 'M') { cx = num() + ox; cy = num() + oy; sx = cx; sy = cy; pts.push([cx, cy]); cmd = rel ? 'l' : 'L'; lc = null; }
      else if (C === 'Z') { cx = sx; cy = sy; lc = null; }
      else if (C === 'L') { cx = num() + ox; cy = num() + oy; pts.push([cx, cy]); lc = null; }
      else if (C === 'H') { cx = num() + ox; pts.push([cx, cy]); lc = null; }
      else if (C === 'V') { cy = num() + oy; pts.push([cx, cy]); lc = null; }
      else {
        var c1;
        if (C === 'C') c1 = [num() + ox, num() + oy];
        else c1 = lc ? [2 * cx - lc[0], 2 * cy - lc[1]] : [cx, cy];
        var c2 = [num() + ox, num() + oy], e = [num() + ox, num() + oy];
        for (var k = 1; k <= n; k++) {
          var t = k / n, u = 1 - t;
          pts.push([u * u * u * cx + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0],
                    u * u * u * cy + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1]]);
        }
        lc = c2; cx = e[0]; cy = e[1];
      }
    }
    var a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) pts.pop();
    return pts;
  }
  var tstyleRaw = null;
  function tstyleDrawing() {
    if (tstyleRaw) return tstyleRaw;
    var pts = flattenPath(TSTYLE_PATH, 16), x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
    tstyleRaw = { pts: pts, x0: x0, x1: x1, y0: y0, y1: y1 };
    return tstyleRaw;
  }
  // natural width / length of the drawing, and the pocket marker's size
  // in units of the body length
  function tstyleProportions() {
    var r = tstyleDrawing(), len = r.x1 - r.x0, P = TSTYLE_POCKET;
    return { widthPerLength: (r.y1 - r.y0) / len, pocketLength: (P.x1 - P.x0) / len, pocketWidth: (P.y1 - P.y0) / len,
      pocketEndGap: (r.x1 - P.x1) / len };
  }
  function convexHull(pts) {
    var a = pts.slice().sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
    function cr(o, p, q) { return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]); }
    var lo = [], hi = [];
    a.forEach(function (p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    for (var i = a.length - 1; i >= 0; i--) { var p = a[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    lo.pop(); hi.pop();
    return lo.concat(hi);
  }
  function tstyleShape(p, L) {
    var r = tstyleDrawing(), P = TSTYLE_POCKET;
    var sy = L / (r.x1 - r.x0);                                   // uniform scale from the length
    var natW = (r.y1 - r.y0) * sy;
    var W = p.widthIn ? p.widthIn * IN : natW;
    var sx = Math.abs(W - natW) < 0.15 ? sy : W / (r.y1 - r.y0);  // optional width stretch
    var yc = (P.y0 + P.y1) / 2, mir = p.leftHanded ? -1 : 1;
    // builder axes: y = along the body from the tail, x = across, +x = treble
    // (the drawing's +y, below the pocket, is the cutaway side)
    var raw = r.pts.map(function (q) { return [mir * (q[1] - yc) * sx, (q[0] - r.x0) * sy]; });
    // Close the neck end. The drawing's neck end is the 1.5"-wide tongue the
    // neck sits on (the pocket marker's end); a printed rim needs a wall
    // round the pocket, so:
    //  - bass side: a straight edge from the bass horn to the neck end
    //    (convex hull of the outline near the neck end, bass side only),
    //  - treble side: a wall beside the pocket, straight along it, as wide
    //    as the old preset kept (pocket + wall + channel reach); the
    //    cutaway curve itself is unchanged outside it.
    var pocketHalf = (p.pocketWidthIn !== undefined ? p.pocketWidthIn : DEFAULTS.pocketWidthIn) * IN / 2 +
      (p.pocketFitMm !== undefined ? p.pocketFitMm : DEFAULTS.pocketFitMm);
    var pl = (p.pocketLengthIn !== undefined ? p.pocketLengthIn : DEFAULTS.pocketLengthIn) * IN;
    var wallT = p.wallMm !== undefined ? p.wallMm : DEFAULTS.wallMm;
    var chan = p.channelDepthMm !== undefined ? p.channelDepthMm : DEFAULTS.channelDepthMm;
    var side = pocketHalf + wallT + Math.max(6.7, chan);
    var bassS = -mir;                                              // sign of x on the bass side
    var near = raw.filter(function (q) { return q[1] >= L - 0.2 * L && q[0] * bassS >= -side; });
    near.push([0, L], [-bassS * side, L], [0, L - 0.2 * L]);
    var hull = convexHull(near.map(function (q) { return [q[0] * bassS < 0 ? -bassS * Math.min(side, Math.abs(q[0])) : q[0], q[1]]; }));
    var wallRect = [[-side, L - pl - side], [side, L - pl - side], [side, L], [-side, L]];
    var poly = tstyleUnion([raw, hull, wallRect]);
    // c1: where the lower bout is widest (the sides run straight there)
    var c1 = 0, wBest = 0;
    for (var yy = 0.1 * L; yy < 0.6 * L; yy += 0.5) {
      var ww = polyHalfWidth(poly, yy, 'left') + polyHalfWidth(poly, yy, 'right');
      if (ww > wBest) { wBest = ww; c1 = yy; }
    }
    return { kind: 'tstyle', L: L, W: W, poly: poly, c1: c1, side: side, raw: raw, scale: [sx, sy],
      cutawaySide: p.leftHanded ? 'left' : 'right' };
  }
  function tstyleUnion(paths) {
    var c = new ClipperLib.Clipper(), sol = new ClipperLib.Paths();
    paths.forEach(function (pp) {
      var ar = pp.map(function (q) { return { X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }; });
      if (ClipperLib.Clipper.Area(ar) < 0) ar.reverse();
      c.AddPath(ar, ClipperLib.PolyType.ptSubject, true);
    });
    c.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    var best = sol[0];
    sol.forEach(function (q) { if (Math.abs(ClipperLib.Clipper.Area(q)) > Math.abs(ClipperLib.Clipper.Area(best))) best = q; });
    ClipperLib.Clipper.CleanPolygon(best, 20);
    if (ClipperLib.Clipper.Area(best) < 0) best.reverse();
    return best.map(function (q) { return [q.X / 1000, q.Y / 1000]; });
  }
  // first outline crossing met going out from |x| = x0 along the line y
  // (for a T-Style horn that is the cutaway, not the horn beyond it)
  function nearEdge(sh, y, side, x0) {
    if (sh.kind !== 'tstyle') return halfWidth(sh, y, side);
    var best = Infinity, poly = sh.poly, n = poly.length;
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n];
      if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
      var x = a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
      x = side === 'left' ? -x : x;
      if (x > x0) best = Math.min(best, x);
    }
    return best === Infinity ? 0 : best;
  }
  // furthest extent of a polygon on one side of x = 0 along the line y
  function polyHalfWidth(poly, y, side) {
    var best = 0, n = poly.length;
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n];
      if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
      var x = a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
      best = Math.max(best, side === 'left' ? -x : x);
    }
    return best;
  }

  // Closed outline, counter-clockwise, in mm: [[x, y], ...]
  function outlinePoints(sh) {
    var L = sh.L, ys = [], i;
    if (sh.kind === 'tstyle') {
      return sh.poly.slice();
    }
    if (sh.kind === 'box') {
      var n = 12;
      for (i = 0; i <= n; i++) ys.push(sh.r * (1 - Math.cos(Math.PI / 2 * i / n)));
      var m = Math.max(1, Math.ceil((L - 2 * sh.r) / 20));
      for (i = 1; i < m; i++) ys.push(sh.r + (L - 2 * sh.r) * i / m);
      for (i = 0; i <= n; i++) ys.push(L - sh.r + sh.r * Math.sin(Math.PI / 2 * i / n));
      // box ends are flat: corners only, the end edge is a straight line
      var right = [], left = [];
      ys = dedupe(ys);
      ys.forEach(function (y) {
        var hw = y <= 0 || y >= L ? sh.hw - sh.r : halfWidth(sh, y);
        right.push([hw, y]);
      });
      for (i = right.length - 1; i >= 0; i--) left.push([-right[i][0], right[i][1]]);
      return right.concat(left);
    }
    var N = 28;
    for (i = 0; i <= N; i++) ys.push(sh.c1 * (1 - Math.cos(Math.PI / 2 * i / N)));
    var mid = Math.max(1, Math.ceil((sh.c2 - sh.c1) / 4));
    for (i = 1; i < mid; i++) ys.push(sh.c1 + (sh.c2 - sh.c1) * i / mid);
    for (i = 0; i <= N; i++) ys.push(sh.c2 + (L - sh.c2) * Math.sin(Math.PI / 2 * i / N));
    ys = dedupe(ys);
    var pts = [[0, 0]];
    ys.forEach(function (y) { if (y > 0 && y < L) pts.push([halfWidth(sh, y), y]); });
    pts.push([0, L]);
    for (i = ys.length - 1; i >= 0; i--) {
      var yy = ys[i];
      if (yy > 0 && yy < L) pts.push([-halfWidth(sh, yy), yy]);
    }
    return pts;
  }

  function dedupe(ys) {
    ys.sort(function (a, b) { return a - b; });
    var out = [];
    ys.forEach(function (y) { if (!out.length || y - out[out.length - 1] > 1e-6) out.push(y); });
    return out;
  }

  // ------------------------------------------------------------------
  // Clipper helpers (integer microns)
  // ------------------------------------------------------------------
  function toPath(pts) {
    return pts.map(function (q) { return { X: Math.round(q[0] * S), Y: Math.round(q[1] * S) }; });
  }
  function rect(x0, y0, x1, y1) { // mm
    return [toPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])];
  }
  function circle(cx, cy, r, n) {
    n = n || 24;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = 2 * Math.PI * i / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return [toPath(pts)];
  }
  function boolOp(type, a, b) {
    var c = new ClipperLib.Clipper();
    c.PreserveCollinear = true;
    if (a && a.length) c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
    if (b && b.length) c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
    var out = new ClipperLib.Paths();
    c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return cleanTiny(out);
  }
  function boolTree(type, a, b) {
    var c = new ClipperLib.Clipper();
    c.PreserveCollinear = true;
    if (a && a.length) c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
    if (b && b.length) c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
    var tree = new ClipperLib.PolyTree();
    c.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return tree;
  }
  function union() {
    var all = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) all = all.concat(arguments[i]);
    return boolOp(ClipperLib.ClipType.ctUnion, all, []);
  }
  function diff(a, b) { return boolOp(ClipperLib.ClipType.ctDifference, a, b); }
  function inter(a, b) { return boolOp(ClipperLib.ClipType.ctIntersection, a, b); }
  function offset(paths, dMm) {
    if (!paths.length) return [];
    if (Math.abs(dMm) < 1e-9) return paths.slice();
    var co = new ClipperLib.ClipperOffset(2, ARC_TOL);
    co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    var out = new ClipperLib.Paths();
    co.Execute(out, dMm * S);
    return union(out);
  }
  // drop slivers (|area| < 0.01 mm^2) that booleans of shared edges can leave
  function cleanTiny(paths) {
    return paths.filter(function (p) { return p.length >= 3 && Math.abs(ClipperLib.Clipper.Area(p)) > 0.01 * S * S; });
  }
  // Remove spikes: a vertex where the outline doubles back on itself
  // (turn of nearly 180 degrees), which offsets/booleans with collinear
  // points kept can leave behind. Their walls would have no inside.
  function cleanSpikes(paths) {
    return paths.map(function (path) {
      var pts = path.slice(), changed = true;
      while (changed && pts.length >= 3) {
        changed = false;
        // micro-loops: the outline comes back to (within 2 microns of) a
        // vertex a few steps later; drop the loop
        for (var i0 = 0; i0 < pts.length; i0++) {
          for (var j0 = i0 + 2; j0 <= i0 + 8 && j0 < pts.length; j0++) {
            if (Math.abs(pts[j0].X - pts[i0].X) <= 2 && Math.abs(pts[j0].Y - pts[i0].Y) <= 2) {
              pts.splice(i0 + 1, j0 - i0); changed = true; break;
            }
          }
        }
        for (var i = 0; i < pts.length && pts.length >= 3; i++) {
          var a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
          var ux = b.X - a.X, uy = b.Y - a.Y, vx = c.X - b.X, vy = c.Y - b.Y;
          if ((ux === 0 && uy === 0) || (vx === 0 && vy === 0)) { pts.splice(i, 1); changed = true; i--; continue; }
          var dot = ux * vx + uy * vy, cr = ux * vy - uy * vx;
          if (dot < 0 && Math.abs(cr) < 0.03 * Math.abs(dot)) { pts.splice(i, 1); changed = true; i--; }
        }
      }
      return pts;
    }).filter(function (p) { return p.length >= 3 && ClipperLib.Clipper.Area(p) !== 0; });
  }
  function leftHPFn() { return rect(-BIG / S, -BIG / S, 0, BIG / S); }
  function rightHPFn() { return rect(0, -BIG / S, BIG / S, BIG / S); }
  // region swept by paths moving along x (dir +1 or -1) to infinity
  function sweepX(paths, dir) {
    var seg = [{ X: 0, Y: 0 }, { X: dir * BIG, Y: 0 }, { X: dir * BIG, Y: 1 }, { X: 0, Y: 1 }];
    var all = [];
    paths.forEach(function (pp) { all = all.concat(ClipperLib.Clipper.MinkowskiSum(seg, pp, true)); all.push(pp); });
    return union(all);
  }
  function areaMm2(paths) {
    var a = 0;
    paths.forEach(function (p) { a += ClipperLib.Clipper.Area(p); });
    return a / (S * S);
  }
  function pathsToMm(paths) {
    return paths.map(function (p) { return p.map(function (q) { return [q.X / S, q.Y / S]; }); });
  }

  // Insert a vertex wherever an edge crosses one of the given vertical
  // (x = const) or horizontal (y = const) lines (integer microns). Every
  // straight cut later made along those lines (pocket sides, block
  // edges, bolt holes, the split between the halves) then meets the
  // curve exactly at an existing vertex, so no boolean ever has to
  // invent (and round) a crossing point — that keeps neighbouring slabs
  // exactly consistent and the mesh watertight.
  function presplit(paths, xs, ys) {
    return paths.map(function (path) {
      var out = [], n = path.length;
      for (var i = 0; i < n; i++) {
        var a = path[i], b = path[(i + 1) % n];
        out.push(a);
        var cuts = [];
        xs.forEach(function (x) {
          if ((a.X - x) * (b.X - x) < 0) {
            var t = (x - a.X) / (b.X - a.X);
            cuts.push([t, { X: x, Y: Math.round(a.Y + (b.Y - a.Y) * t) }]);
          }
        });
        ys.forEach(function (y) {
          if ((a.Y - y) * (b.Y - y) < 0) {
            var t = (y - a.Y) / (b.Y - a.Y);
            cuts.push([t, { X: Math.round(a.X + (b.X - a.X) * t), Y: y }]);
          }
        });
        cuts.sort(function (u, v) { return u[0] - v[0]; });
        cuts.forEach(function (c) {
          var last = out[out.length - 1];
          if (last.X !== c[1].X || last.Y !== c[1].Y) out.push(c[1]);
        });
      }
      return out;
    });
  }

  // ------------------------------------------------------------------
  // Slab mesher: levels[k]..levels[k+1] holds region regions[k].
  // Returns a closed triangle mesh (flat array, mm).
  // ------------------------------------------------------------------
  function meshSlabs(levels, regions) {
    var tris = []; // integer microns, 9 per triangle
    var n = regions.length, k, i;

    // Canonical vertex objects (exactly equal coordinates only) and no
    // repeated points in a path.
    var reps = new Map();
    function snap(q) {
      var key = q.X + ',' + q.Y, r = reps.get(key);
      if (!r) { r = { X: q.X, Y: q.Y }; reps.set(key, r); }
      return r;
    }
    regions = regions.map(function (paths) {
      var out = [];
      paths.forEach(function (path) {
        var np = [];
        path.forEach(function (q) {
          var r = snap(q);
          if (!np.length || np[np.length - 1] !== r) np.push(r);
        });
        while (np.length > 1 && np[0] === np[np.length - 1]) np.pop();
        if (np.length >= 3) out.push(np.map(function (r) { return { X: r.X, Y: r.Y }; }));
      });
      return out;
    });
    var snapFace = snap;

    // walls: merge identical edges in consecutive slabs into one tall quad
    var runs = new Map();
    for (k = 0; k < n; k++) {
      regions[k].forEach(function (path) {
        var m = path.length;
        for (var j = 0; j < m; j++) {
          var a = path[j], b = path[(j + 1) % m];
          if (a.X === b.X && a.Y === b.Y) continue;
          var key = a.X + ',' + a.Y + ',' + b.X + ',' + b.Y;
          var r = runs.get(key);
          if (!r) { r = []; runs.set(key, r); }
          r.push(k);
        }
      });
    }
    runs.forEach(function (ks, key) {
      var c = key.split(',').map(Number);
      var s = 0;
      while (s < ks.length) {
        var e = s;
        while (e + 1 < ks.length && ks[e + 1] === ks[e] + 1) e++;
        var z0 = levels[ks[s]], z1 = levels[ks[e] + 1];
        tris.push(c[0], c[1], z0, c[2], c[3], z0, c[2], c[3], z1);
        tris.push(c[0], c[1], z0, c[2], c[3], z1, c[0], c[1], z1);
        s = e + 1;
      }
    });

    // horizontal faces at every level
    for (k = 0; k <= n; k++) {
      var below = k > 0 ? regions[k - 1] : [];
      var above = k < n ? regions[k] : [];
      var z = levels[k];
      faceTris(boolTree(ClipperLib.ClipType.ctDifference, below, above), z, true, tris, snapFace);
      faceTris(boolTree(ClipperLib.ClipType.ctDifference, above, below), z, false, tris, snapFace);
    }

    tris = repairTJunctions(tris);
    var out = new Float32Array(tris.length);
    for (i = 0; i < tris.length; i++) out[i] = tris[i] / S;
    return out;
  }

  function faceTris(tree, z, up, out, snap) {
    function addNode(node) {
      var contour = node.Contour();
      var holes = node.Childs();
      if (ClipperLib.Clipper.Area(contour) !== 0) {
        var coords = [], holeIdx = [], pts = [];
        contour.forEach(function (q) { coords.push(q.X, q.Y); pts.push(q); });
        holes.forEach(function (h) {
          holeIdx.push(pts.length);
          h.Contour().forEach(function (q) { coords.push(q.X, q.Y); pts.push(q); });
        });
        var idx = earcut(coords, holeIdx, 2);
        for (var t = 0; t < idx.length; t += 3) {
          var a = pts[idx[t]], b = pts[idx[t + 1]], c = pts[idx[t + 2]];
          if (snap) { a = snap(a); b = snap(b); c = snap(c); }
          if (a === b || b === c || c === a) continue;
          var cr = (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);
          if (cr === 0) continue; // exactly degenerate: the T-junction pass closes the gap
          if ((cr > 0) !== up) { var tmp = b; b = c; c = tmp; }
          out.push(a.X, a.Y, z, b.X, b.Y, z, c.X, c.Y, z);
        }
      }
      holes.forEach(function (h) { h.Childs().forEach(addNode); });
    }
    tree.Childs().forEach(addNode);
  }

  // Split triangle edges that have another mesh vertex lying exactly on them, so
  // every edge is shared by exactly two triangles. All edges that can
  // carry such a vertex are horizontal (in one level) or vertical (wall
  // corners), so the search is a 2D grid per level plus a z-list per
  // (x, y) column.
  function repairTJunctions(t) {
    var CELL = 3000;
    var byZ = new Map(), byXY = new Map(), seen = new Set(), i;
    for (i = 0; i < t.length; i += 3) {
      var x = t[i], y = t[i + 1], z = t[i + 2];
      var key = x + ',' + y + ',' + z;
      if (seen.has(key)) continue;
      seen.add(key);
      var g = byZ.get(z);
      if (!g) { g = new Map(); byZ.set(z, g); }
      var ck = Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
      var cell = g.get(ck);
      if (!cell) { cell = []; g.set(ck, cell); }
      cell.push(x, y);
      var xy = x + ',' + y;
      var col = byXY.get(xy);
      if (!col) { col = []; byXY.set(xy, col); }
      col.push(z);
    }
    byXY.forEach(function (col) { col.sort(function (a, b) { return a - b; }); });

    function pointsOnEdge(ax, ay, az, bx, by, bz) {
      var res = [];
      if (az === bz) {
        var g = byZ.get(az);
        var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        if (!len2) return res;
        var len = Math.sqrt(len2);
        var steps = Math.ceil(len / CELL) + 1, visited = new Set();
        for (var s = 0; s <= steps; s++) {
          var px = ax + dx * s / steps, py = ay + dy * s / steps;
          var cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
          for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
            var ck = (cx + ox) + ',' + (cy + oy);
            if (visited.has(ck)) continue;
            visited.add(ck);
            var cell = g.get(ck);
            if (!cell) continue;
            for (var j = 0; j < cell.length; j += 2) {
              var qx = cell[j] - ax, qy = cell[j + 1] - ay;
              // exactly on the segment (integer coordinates: exact test)
              if (qx * dy - qy * dx !== 0) continue;
              var dot = qx * dx + qy * dy;
              if (dot <= 0 || dot >= len2) continue;
              var along = dot / len;
              res.push([along, cell[j], cell[j + 1], az]);
            }
          }
        }
      } else if (ax === bx && ay === by) {
        var col = byXY.get(ax + ',' + ay);
        var lo = Math.min(az, bz), hi = Math.max(az, bz);
        for (var c = 0; c < col.length; c++) {
          if (col[c] > lo && col[c] < hi) res.push([Math.abs(col[c] - az), ax, ay, col[c]]);
        }
      }
      res.sort(function (p, q) { return p[0] - q[0]; });
      return res;
    }

    function same(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
    var out = [];
    for (i = 0; i < t.length; i += 9) {
      var v = [[t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]]];
      var extra = [], nExtra = 0, which = -1;
      for (var e = 0; e < 3; e++) {
        var a = v[e], b = v[(e + 1) % 3];
        var pts = pointsOnEdge(a[0], a[1], a[2], b[0], b[1], b[2]);
        extra.push(pts);
        if (pts.length) { nExtra++; which = e; }
      }
      if (!nExtra) { out.push(t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 4], t[i + 5], t[i + 6], t[i + 7], t[i + 8]); continue; }
      var loop = [];
      for (e = 0; e < 3; e++) {
        loop.push(v[e]);
        extra[e].forEach(function (p) { loop.push([p[1], p[2], p[3]]); });
      }
      if (nExtra === 1) {
        // fan from the vertex opposite the split edge
        var apex = v[(which + 2) % 3];
        var chain = [v[which]].concat(extra[which].map(function (p) { return [p[1], p[2], p[3]]; }), [v[(which + 1) % 3]]);
        for (var q = 0; q + 1 < chain.length; q++) {
          if (same(apex, chain[q]) || same(apex, chain[q + 1])) continue; // a sliver collapsing onto its own edge
          out.push(apex[0], apex[1], apex[2], chain[q][0], chain[q][1], chain[q][2], chain[q + 1][0], chain[q + 1][1], chain[q + 1][2]);
        }
      } else {
        var cxm = (v[0][0] + v[1][0] + v[2][0]) / 3, cym = (v[0][1] + v[1][1] + v[2][1]) / 3, czm = (v[0][2] + v[1][2] + v[2][2]) / 3;
        for (q = 0; q < loop.length; q++) {
          var p0 = loop[q], p1 = loop[(q + 1) % loop.length];
          if (p0[0] === p1[0] && p0[1] === p1[1] && p0[2] === p1[2]) continue;
          out.push(cxm, cym, czm, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Teardrop / staircase helpers for horizontal bolt holes
  // ------------------------------------------------------------------
  // Half-width of a teardrop hole of radius r centred at zc, at height z:
  // round below the centre, 45-degree flanks to a point above it, so the
  // roof prints without support.
  function teardropHalf(r, zc, z) {
    var d = z - zc;
    if (d <= r / Math.SQRT2) return Math.sqrt(Math.max(0, r * r - d * d));
    return Math.max(0, r * Math.SQRT2 - d);
  }
  // Split [z0, z1] into STEP-high bands on a global grid (multiples of STEP).
  function gridBands(z0, z1) {
    var out = [], a = z0;
    var g = Math.floor(z0 / STEP + 1e-9) * STEP + STEP;
    while (a < z1 - 1e-9) {
      var b = Math.min(z1, g);
      if (b - a > 1e-6) out.push([a, b]);
      a = b; g += STEP;
    }
    // no sliver bands (a few microns tall): fold them into a neighbour
    if (out.length > 1 && out[0][1] - out[0][0] < 0.1) { out[1][0] = out[0][0]; out.shift(); }
    var n = out.length;
    if (n > 1 && out[n - 1][1] - out[n - 1][0] < 0.1) { out[n - 2][1] = out[n - 1][1]; out.pop(); }
    return out;
  }
  function teardropBands(r, zc) {
    var top = zc + r * Math.SQRT2;
    return gridBands(zc - r, top).map(function (band) {
      var zm = clamp(zc, band[0], band[1]);
      // quantised to 0.2 mm so neighbouring bands never differ by a
      // few microns (sub-printable slivers)
      // (rounded up through the round part, down on the 45-degree flanks
      // so the tip stays narrow)
      var hq = teardropHalf(r, zc, zm) / 0.2;
      return { z0: band[0], z1: band[1], half: (zm <= zc + r / Math.SQRT2 ? Math.ceil(hq - 1e-6) : Math.floor(hq + 1e-6)) * 0.2 };
    }).filter(function (b) { return b.half > 0.05; });
  }

  var BED_MARGIN = 2;
  // one half's footprint (side 1 = +x, -1 = -x) as a point list
  function halfPoly(outline, sg) {
    var pts = outline.filter(function (q) { return q[0] * sg >= 0; });
    pts.push([0, 0]);
    outline.forEach(function (q) { pts.push([0, q[1]]); });
    return pts;
  }
  // side of the smallest square holding the points at the best rotation
  function squareFit(pts) {
    var best = Infinity;
    for (var a = 0; a < 90; a += 0.25) {
      var c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
      var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      pts.forEach(function (q) { var u = q[0] * c - q[1] * s, v = q[0] * s + q[1] * c;
        x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); });
      best = Math.min(best, Math.max(x1 - x0, y1 - y0));
    }
    return best;
  }

  // ------------------------------------------------------------------
  // Build everything
  // ------------------------------------------------------------------
  function build(input) {
    var p = withDefaults(input);
    var warnings = [];
    if (p.wallMm < WALL_MIN) {
      warnings.push('Wall raised to the ' + WALL_MIN.toFixed(1) + ' mm minimum: thinner walls crack behind the panel channels.');
      p.wallMm = WALL_MIN;
    }
    var sh = shapeOf(p);
    var L = sh.L, Dreq = p.depthIn * IN;
    var bolt = BOLTS[p.boltSize] || BOLTS.M4;
    var t = p.panelThicknessMm, fit = p.panelFitMm, ec = p.panelEdgeGapMm;
    var cD = Math.max(1, p.channelDepthMm), cA = clamp(p.channelRoofFlatMm, 0, cD), lipIn = p.innerLipMm;
    var topRim = (cD - cA) + p.topLipMm;                 // rim above the top panel's channel

    // Minimum depth: the pocket floor needs at least FLOOR_MIN mm of block
    // under it and must stay 3 mm above the teardrop of the neck bolt that
    // runs under the pocket; the middle zone needs 5 mm between the end
    // slabs and the top track. Shallower requests are raised to it.
    var baseTop0 = Math.max(p.baseBlockMm, p.bottomLipMm + t + fit + (cD - cA) + lipIn + 0.4);
    var collarOn = !!p.neckCollar && p.neckCollar !== 'false';
    if (collarOn && p.neckBolts >= 2) {
      warnings.push('With the neck collar, only one sideways neck bolt fits (the rear one would cross the collar bolts); using 1.');
      p.neckBolts = 1;
    }
    if (!collarOn && p.neckBolts < 1) warnings.push('No neck collar and no neck bolt: only the neck screws and back plate hold the halves together at the neck. Turn the collar on or add a neck bolt.');
    var floorReq = Math.max(FLOOR_MIN, p.neckBolts >= 1 ? baseTop0 / 2 + (BOLTS[p.boltSize] || BOLTS.M4).holeMm / 2 * Math.SQRT2 + 3 : 0);
    var Dmin = Math.max(floorReq + p.pocketDepthIn * IN + topRim + fit, baseTop0 + lipIn + cD + t + fit + topRim);
    var D = Math.max(Dreq, Dmin);
    if (Dreq < Dmin - 1e-9) {
      warnings.push('Body depth raised to the minimum ' + (Dmin / IN).toFixed(2) + '″ (' + Dmin.toFixed(1) + ' mm): the ' +
        p.pocketDepthIn.toFixed(2) + '″ pocket needs ' + floorReq.toFixed(1) + ' mm of block under its floor, and the panel channels need room above the end slabs.');
    }
    var pl = p.pocketLengthIn * IN, pw2 = p.pocketWidthIn * IN / 2 + p.pocketFitMm;
    var bl = pl + p.neckBlockEndMm;                 // neck block length (from the neck end)
    var kw = pw2 + p.neckBlockSideMm;               // neck block half width
    var tbl = p.tailBlockLengthMm, tw = p.tailBlockWidthMm / 2;

    var outline = outlinePoints(sh);
    var maxR = 0, maxL = 0;
    outline.forEach(function (q) { if (q[0] > 0) maxR = Math.max(maxR, q[0]); else maxL = Math.max(maxL, -q[0]); });
    var maxHw = Math.max(maxR, maxL);

    // heights
    var zBL = p.bottomLipMm, zBS = zBL + t + fit;          // back panel channel
    var zBU = zBS + (cD - cA) + lipIn;                     // top of the back channel's upper lip
    var zTS1 = D - topRim, zTS0 = zTS1 - t - fit;          // top panel channel
    var zTA = zTS0 - lipIn - cD;                           // foot of the top channel's lower-lip corbel
    var panelTopZ = zTS0 + t;                              // top surface of the top panel
    var zF = panelTopZ - p.pocketDepthIn * IN;             // pocket floor
    var baseTop = Math.max(p.baseBlockMm, zBU + 0.4);

    // clamshell bolts: horizontal holes across the full-width end slabs
    var boltZ = baseTop / 2;
    var rSpot = bolt.washerMm / 2 + 0.5, rHole = bolt.holeMm / 2;
    var boltYs = [];
    if (p.neckBolts >= 1) boltYs.push({ name: 'neck', y: L - pl / 2 });
    if (p.neckBolts >= 2) boltYs.push({ name: 'neck (rear)', y: L - bl + Math.max(9, rSpot + 4) });
    var tailY = Math.max(rSpot + 3, tbl / 2);
    if (p.tailBolts >= 1) boltYs.push({ name: 'tail', y: tailY, z: boltZ });
    // upper tail bolt: as high in the tail block as its spot face allows,
    // so the top of the tail seam is clamped too
    var zUp = zTS0 - rSpot * Math.SQRT2 - 2;
    if (p.tailBolts >= 2) {
      if (zUp - rSpot < boltZ + rSpot * Math.SQRT2 + 2) warnings.push('The body is too shallow for an upper tail bolt; only the low one was used.');
      else boltYs.push({ name: 'tail (upper)', y: tailY, z: zUp });
    }
    boltYs.forEach(function (b) {
      var minR = Infinity, minL = Infinity;
      for (var s2 = -1; s2 <= 1.0001; s2 += 0.05) {
        minR = Math.min(minR, halfWidth(sh, b.y + s2 * rSpot, 'right'));
        minL = Math.min(minL, halfWidth(sh, b.y + s2 * rSpot, 'left'));
      }
      b.xs = minR - 1.0;  // flat washer seats, just inside each wall
      b.xsL = minL - 1.0;
      if (b.z === undefined) b.z = boltZ;
      b.hole = teardropBands(rHole, b.z);
      b.spot = teardropBands(rSpot, b.z);
    });

    // lines that straight cuts will follow (see presplit)
    var SX = [0, pw2, -pw2, kw, -kw, tw, -tw].map(function (v) { return Math.round(v * S); });
    // tail web: the whole tail end, full width, from y = 0 to just past the
    // bolts (no thin cavity sliver against the curved tail wall), from the
    // end slab up to the top channel, so the upper tail bolt clamps solid
    // material from one washer seat to the other
    var webH = rSpot + 3;
    var web0 = -50, web1 = Math.min(tbl, tailY + webH);
    var SY = [tbl, L - bl, L - pl, web0, web1];
    // ---- cutaway cap. The halves close sideways over the panels, so
    // nothing of a half may lie, at the top panel's level, on the far side
    // of a piece of that panel (it would have to pass through the ply).
    // A horn that curls back towards the neck (the T-Style's cutaway)
    // breaks that: the cutaway's walls sit between the neck and the horn's
    // part of the top panel. Those walls, from the top panel's seat up,
    // become a separate cap with their top lip, lowered on from above once
    // the body is closed and glued down onto the half's flat seat. Its
    // footprint is the rim ring inside an axis-aligned box (straight cuts
    // that presplit can share with every slab, so the parts stay closed).
    var capBox = null;
    (function () {
      var O0 = [toPath(outline)], I0 = offset(O0, -p.wallMm);
      var tp0 = diff(offset(I0, -p.panelEdgeGapMm), rect(-pw2, L - pl, pw2, L + 50));
      [['left', 1, leftHPFn()], ['right', -1, rightHPFn()]].forEach(function (h) {
        var hit = inter(inter(diff(O0, I0), sweepX(offset(tp0, 0.3), h[1])), h[2]);
        if (areaMm2(hit) <= 0.5) return;
        var hb = bbox(hit), reach = cD + 1.5;
        var xo = h[0] === 'right' ? Math.ceil(hb[2] + reach) : Math.floor(hb[0] - reach);
        capBox = { side: h[0], x: xo, y: Math.floor(hb[1] - reach), hit: hit };
      });
    })();
    if (capBox) { SX.push(Math.round(capBox.x * S)); SY.push(capBox.y); }
    boltYs.forEach(function (b) {
      b.hole.concat(b.spot).forEach(function (band) { SY.push(b.y - band.half, b.y + band.half); });
    });
    SY = SY.map(function (v) { return Math.round(v * S); });
    function P(paths) { return presplit(paths, SX, SY); }

    var O = P([toPath(outline)]);
    var I = P(offset(O, -p.wallMm));


    // 2D zones
    var strip = rect(-BIG / S, tbl, BIG / S, L - bl);
    var cavB = inter(I, strip);                            // under the base slabs
    var K = rect(-kw, L - bl, kw, L + 50);
    var Kt = rect(-tw, -50, tw, tbl);
    var Kw = p.tailBolts >= 2 ? rect(-BIG / S, web0, BIG / S, web1) : [];
    var cavM = diff(I, union(K, Kt, Kw));                  // between the slabs and the top slot
    var pocket = rect(-pw2, L - pl, pw2, L + 50);

    // features: { z0, z1, void }
    var F = [];
    function addF(z0, z1, v) { if (z1 - z0 > 1e-6 && v.length) F.push({ z0: z0, z1: z1, v: v }); }
    // Panel channels. Each panel edge sits in a channel formed by an
    // inward flange ring: the channel back is the old opening (the wall's
    // inside face; the block faces for the back panel), and a lip reaches
    // cD inward on each face of the panel. Printed back face down, every
    // lip is a corbel: the lip under a panel is flat on top with a 45-degree
    // staircase underneath; the lip over a panel has a flat roof only cA
    // wide next to the wall (a short unsupported ledge), then climbs at 45
    // degrees to the lip edge. void(r) = the opening with the lips reaching r.
    var memo = {};
    function shrink(base, key, r) {
      r = Math.round(r * 1000) / 1000;
      var k2 = key + r;
      if (!memo[k2]) memo[k2] = r > 0 ? P(offset(base, -r)) : base;
      return memo[k2];
    }
    // roof over a panel: flat cA, then 45 degrees up to the full reach
    function roof(base, key, z0, sub) {
      var zr = z0 + (cD - cA);
      gridBands(z0, zr).forEach(function (band) {
        var v = shrink(base, key, cA + (band[0] - z0));
        addF(band[0], band[1], sub ? diff(v, sub) : v);
      });
      return zr;
    }
    // base zone: bottom lip on the bed, channel, roof, inner lip, slab
    addF(0, zBL, shrink(cavB, 'B', cD));
    addF(zBL, zBS, cavB);
    var zr0 = roof(cavB, 'B', zBS);
    addF(zr0, zBU, shrink(cavB, 'B', cD));
    addF(zBU, baseTop, cavB);
    // middle zone
    var blocks = union(K, Kt, Kw);
    addF(baseTop, zTA, cavM);
    // under the top panel: 45-degree corbel, then the flat inner lip
    // (none inside the neck and tail blocks, whose tops carry the panel)
    gridBands(zTA, zTS0 - lipIn).forEach(function (band) {
      addF(band[0], band[1], diff(shrink(I, 'I', Math.min(cD, band[1] - zTA)), blocks));
    });
    addF(zTS0 - lipIn, zTS0, diff(shrink(I, 'I', cD), blocks));
    // top channel, its roof and the top lip
    addF(zTS0, zTS1, I);
    var zr1 = roof(I, 'I', zTS1);
    addF(zr1, D, shrink(I, 'I', cD));
    // neck pocket
    addF(zF, D, pocket);

    // neck screws
    var yc = L - pl / 2;
    var sx = p.neckScrewSpanXIn * IN / 2, sy = p.neckScrewSpanYIn * IN / 2;
    var screws = [[-sx, yc - sy], [sx, yc - sy], [-sx, yc + sy], [sx, yc + sy]];
    var rs = p.neckScrewHoleMm / 2, rw = p.wellDiameterMm / 2;
    var screwHoles = union.apply(null, screws.map(function (q) { return circle(q[0], q[1], rs, 32); }));
    var wellTop = 0, plasticUnderPocket;
    if (p.neckScrewMode === 'wells') {
      var zW = zF - p.wellFloorMm;
      if (zW < 4) { warnings.push('Screw wells need at least ' + (p.wellFloorMm + 4).toFixed(0) + ' mm under the pocket floor; this body has ' + zF.toFixed(1) + ' mm, so the wells were left out.'); zW = 0; }
      if (zW > 0) {
        addF(0, zW, union.apply(null, screws.map(function (q) { return circle(q[0], q[1], rw, 32); })));
        // 45-degree staircase roof from the well down to the screw hole
        var zc = zW;
        gridBands(zW, zW + (rw - rs)).forEach(function (band) {
          var r = rw - (band[1] - zW);
          if (r < rs + 0.05) r = rs;
          addF(band[0], band[1], union.apply(null, screws.map(function (q) { return circle(q[0], q[1], r, 32); })));
          zc = band[1];
        });
        wellTop = zc;
      }
      plasticUnderPocket = zW > 0 ? zF - zW : zF;
    } else {
      plasticUnderPocket = zF;
    }
    addF(wellTop, zF, screwHoles);

    // ---- neck collar: the neck block above the pocket floor (the pocket's
    // side and end walls) as a separate U-shaped part that bridges the
    // left/right split. Vertical bolts come up from the back face through
    // each half's lower block into nut traps (or heat-set inserts) in the
    // collar, so the collar ties the halves together at the neck and the
    // neck screws still clamp only the solid lower block.
    var collar = null, collarRegions = null, collarLevels = null, collarBase = null, collarInfo = null;
    if (collarOn) {
      var KI = P(inter(K, I));
      addF(zF, zTS0, KI);                         // the halves stop at the pocket floor here
      var clr = p.collarClearanceMm;
      collarBase = diff(inter(rect(-kw + clr, L - bl + clr, kw - clr, L + 50), P(offset(I, -clr))), pocket);
      var rSnug = (bolt.nomMm + 0.2) / 2;
      var hexR = (bolt.nutAFMm + 0.4) / Math.sqrt(3);   // corner radius of the nut trap
      var rSpotN = bolt.washerMm / 2 + 0.5;
      var needR = p.collarFastener === 'insert' ? bolt.insertHoleMm / 2 + 2.0 : hexR + 1.6;
      var inner = offset(collarBase, -needR);
      var cands = [];
      var endY = L - pl - p.neckBlockEndMm / 2;
      function inside(paths, x, y) {
        var pt = { X: Math.round(x * S), Y: Math.round(y * S) }, wind = 0;
        paths.forEach(function (path) {
          if (ClipperLib.Clipper.PointInPolygon(pt, path) !== 0) wind += ClipperLib.Clipper.Area(path) > 0 ? 1 : -1;
        });
        return wind > 0;
      }
      ['left', 'right'].forEach(function (side) {
        var sg = side === 'right' ? 1 : -1;
        // beside the pocket: start 30% of the pocket in from the neck end
        // and move towards the body until the wall is wide enough (a
        // cutaway narrows the treble wall near the neck end), keeping
        // clear of a sideways neck bolt
        var best = null;
        var fyMax = Math.max(0.85, (bl - needR - clr - 1) / pl);
        for (var fy = 0.3; fy <= fyMax + 1e-9 && !best; fy += 0.05) {
          var y = L - fy * pl;
          if (p.neckBolts >= 1 && Math.abs(y - (L - pl / 2)) < rSpotN + needR + 1.5) continue;
          var edge = kw;
          for (var s3 = -1; s3 <= 1.0001; s3 += 0.1) edge = Math.min(edge, nearEdge(sh, y + s3 * needR, side, pw2) - p.wallMm - p.collarClearanceMm);
          var x = sg * (pw2 + edge) / 2;
          // keep its counterbore well clear of the neck screws' holes/wells
          var rScr = p.neckScrewMode === 'wells' ? rw : rs, rBw = bolt.washerMm / 2 + 1;
          if (screws.some(function (q) { return Math.hypot(q[0] - x, q[1] - y) < rScr + rBw + 2; })) continue;
          if (inside(inner, x, y)) best = { x: x, y: y };
        }
        cands.push({ side: side, where: 'beside the pocket', x: best ? best.x : sg * (pw2 + kw) / 2, y: best ? best.y : L - 0.3 * pl });
        cands.push({ side: side, where: 'behind the pocket', x: sg * Math.max(pw2 * 0.55, needR + 1), y: endY });
      });
      var cb = cands.filter(function (c) { return inside(inner, c.x, c.y); });
      cands.forEach(function (c) {
        if (cb.indexOf(c) < 0) warnings.push('No room for the ' + c.side + ' collar bolt ' + c.where + '; it was left out.');
      });
      ['left', 'right'].forEach(function (side) {
        if (!cb.some(function (c) { return c.side === side; })) warnings.push('The neck collar has no bolt into the ' + side + ' half; widen the neck block.');
      });
      var cHoles = cb.length ? union.apply(null, cb.map(function (c) { return circle(c.x, c.y, rSnug, 32); })) : [];
      // in the halves: snug holes from the back face (or from counterbored
      // wells) up to the pocket floor
      var floorC = Math.min(12, zF - 6), seatZ = 0;
      if (floorC >= 8 && cb.length) {
        var rWc = bolt.washerMm / 2 + 1;
        var zWc = zF - floorC;
        addF(0, zWc, union.apply(null, cb.map(function (c) { return circle(c.x, c.y, rWc, 32); })));
        seatZ = zWc;
        gridBands(zWc, zWc + (rWc - rSnug)).forEach(function (band) {
          var r = rWc - (band[1] - zWc);
          if (r < rSnug + 0.05) r = rSnug;
          addF(band[0], band[1], union.apply(null, cb.map(function (c) { return circle(c.x, c.y, r, 32); })));
        });
      }
      addF(seatZ, zF, cHoles);
      // in the collar
      var CF = [];
      function addC(z0, z1, v) { if (z1 - z0 > 1e-6 && v.length) CF.push({ z0: z0, z1: z1, v: v }); }
      var H = zTS0 - zF, boltMin, boltMax, collarTop = zTS0;
      if (p.collarFastener === 'insert') {
        var rI = bolt.insertHoleMm / 2, zI = zF + Math.min(bolt.insertLenMm + 1.5, H - 4);
        addC(zF, zI, union.apply(null, cb.map(function (c) { return circle(c.x, c.y, rI, 32); })));
        var zz = zI;
        gridBands(zI, zI + rI).forEach(function (band) {
          var r = rI - (band[1] - zI);
          if (r <= 0.05) return;
          addC(band[0], band[1], union.apply(null, cb.map(function (c) { return circle(c.x, c.y, r, 24); })));
          zz = band[1];
        });
        boltMin = (zF - seatZ) + bolt.washerTMm + 0.6 * bolt.insertLenMm;
        boltMax = (zF - seatZ) + bolt.washerTMm + (zI - zF) - 0.3;
      } else {
        var zN = zF + Math.min(p.collarNutFloorMm, H - bolt.nutMm - 2);
        addC(zF, zN, cHoles);
        addC(zN, zTS0, union.apply(null, cb.map(function (c) {
          var hp = [];
          for (var h = 0; h < 6; h++) hp.push([c.x + hexR * Math.cos(h * Math.PI / 3), c.y + hexR * Math.sin(h * Math.PI / 3)]);
          return [toPath(hp)];
        })));
        boltMin = (zF - seatZ) + bolt.washerTMm + (zN - zF) + bolt.nutMm + 1;
        boltMax = (zF - seatZ) + bolt.washerTMm + H - 0.5;   // must stay under the top panel
      }
      var boltLen = null;
      for (var bi = 0; bi < METRIC_LENGTHS.length; bi++) if (METRIC_LENGTHS[bi] >= boltMin - 1e-9) { boltLen = METRIC_LENGTHS[bi]; break; }
      var boltNote = '';
      if (boltLen === null || boltLen > boltMax + 1e-9) {
        boltNote = 'No stock length fits between ' + boltMin.toFixed(1) + ' and ' + boltMax.toFixed(1) + ' mm; cut a longer bolt to ' + Math.ceil(boltMin) + ' mm.';
      }
      // collar slabs (its own part; z kept in body coordinates here)
      var clv = [zF, zTS0];
      CF.forEach(function (f) { clv.push(f.z0, f.z1); });
      clv = clv.map(function (z) { return Math.round(z * S); }).sort(function (a, b) { return a - b; });
      collarLevels = [];
      clv.forEach(function (z) { if (!collarLevels.length || z > collarLevels[collarLevels.length - 1]) collarLevels.push(z); });
      var CFi = CF.map(function (f) { return { z0: Math.round(f.z0 * S), z1: Math.round(f.z1 * S), v: f.v }; });
      collarRegions = [];
      for (var ck = 0; ck + 1 < collarLevels.length; ck++) {
        var cv = [];
        CFi.forEach(function (f) { if (f.z0 <= collarLevels[ck] && f.z1 >= collarLevels[ck + 1]) cv = cv.concat(f.v); });
        collarRegions.push(cleanSpikes(cv.length ? diff(collarBase, union(cv)) : collarBase));
      }
      collar = meshSlabs(collarLevels, collarRegions);
      var cbb = bbox(collarBase);
      collarInfo = {
        fastener: p.collarFastener === 'insert' ? 'insert' : 'nut',
        bolts: cb.map(function (c) { return { side: c.side, where: c.where, x: c.x, y: c.y }; }),
        heightMm: H, bottomZ: zF, topZ: zTS0, footprintMm: [cbb[2] - cbb[0], cbb[3] - cbb[1]],
        sizeXYMm: cbb, holeMm: 2 * rSnug, nutTrapAFMm: bolt.nutAFMm + 0.4,
        seatZ: seatZ, wells: seatZ > 0, boltLengthMm: boltLen, boltMinMm: boltMin, boltMaxMm: boltMax, boltNote: boltNote,
        clearanceMm: p.collarClearanceMm, areaMm2: areaMm2(collarBase)
      };
    }

    if (boltZ - rSpot < 0.8 || boltZ + rSpot * Math.SQRT2 > baseTop - 0.8) {
      warnings.push('The end slabs (' + baseTop.toFixed(1) + ' mm) are too thin for ' + bolt.label + ' bolt spot-faces; raise "End slab height".');
    }
    if (p.tailBolts < 1) warnings.push('No tail bolt: nothing holds the two halves together at the tail, so the tail joint can open under string tension. Keep at least one tail bolt.');
    var boltInfo = [];
    boltYs.forEach(function (b) {
      b.hole.forEach(function (hb) {
        addF(hb.z0, hb.z1, rect(-BIG / S, b.y - hb.half, BIG / S, b.y + hb.half));
      });
      b.spot.forEach(function (sb) {
        addF(sb.z0, sb.z1, union(rect(b.xs, b.y - sb.half, BIG / S, b.y + sb.half), rect(-BIG / S, b.y - sb.half, -b.xsL, b.y + sb.half)));
      });
      var grip = b.xs + b.xsL;
      var len = grip + 2 * bolt.washerTMm + bolt.nutMm + 2;
      boltInfo.push({ name: b.name, yMm: b.y, zMm: b.z, gripMm: grip, minLengthMm: len });
    });

    // ---- slab levels and regions
    var lv = [0, D];
    F.forEach(function (f) { lv.push(f.z0, f.z1); });
    lv = lv.map(function (z) { return Math.round(z * S); });
    lv.sort(function (a, b) { return a - b; });
    var levels = [];
    lv.forEach(function (z) { if (z >= 0 && z <= Math.round(D * S) && (!levels.length || z > levels[levels.length - 1])) levels.push(z); });
    var Fi = F.map(function (f) { return { z0: Math.round(f.z0 * S), z1: Math.round(f.z1 * S), v: f.v }; });
    var solid = [];
    for (var k = 0; k + 1 < levels.length; k++) {
      var a0 = levels[k], a1 = levels[k + 1], voids = [];
      Fi.forEach(function (f) { if (f.z0 <= a0 && f.z1 >= a1) voids = voids.concat(f.v); });
      solid.push(diff(O, union(voids)));
    }

    var topPanel0 = diff(offset(I, -ec), pocket);
    var capFoot = [], capSide = null, capRegions = null, capLevels = null, cap = null, capInfo = null;
    if (capBox) {
      capSide = capBox.side;
      var ring = diff(O, shrink(I, 'I', cD));
      capFoot = inter(ring, capSide === 'right' ? rect(0, capBox.y, capBox.x, L + 50) : rect(capBox.x, capBox.y, 0, L + 50));
      // only the piece(s) carrying the walls in the way (the box can clip
      // a corner of some other part of the ring)
      capFoot = capFoot.filter(function (pp) { return ClipperLib.Clipper.Area(pp) > 0 && areaMm2(inter([pp], capBox.hit)) > 0.01; });
    }
    if (capFoot.length) {
      var zc0 = Math.round(zTS0 * S);
      capLevels = []; capRegions = [];
      for (k = 0; k + 1 < levels.length; k++) {
        if (levels[k] < zc0) continue;
        if (!capLevels.length) capLevels.push(levels[k]);
        capLevels.push(levels[k + 1]);
        capRegions.push(cleanSpikes(inter(solid[k], capFoot)));
        solid[k] = diff(solid[k], capFoot);
      }
      // print it upside down (its top face on the bed): flip z
      cap = meshSlabs(capLevels, capRegions);
      var cbx = bbox(capFoot);
      capInfo = { side: capSide, bottomZ: zTS0, topZ: D, heightMm: D - zTS0, footprintMm: [cbx[2] - cbx[0], cbx[3] - cbx[1]],
        sizeXYMm: cbx, areaMm2: areaMm2(capFoot), seatAreaMm2: areaMm2(capRegions[0]), wallSeatMm: p.wallMm, lipOnPanelMm: cD };
    }

    // ---- halves
    var leftHP = leftHPFn(), rightHP = rightHPFn();
    var leftRegions = solid.map(function (r) { return cleanSpikes(inter(r, leftHP)); });
    var rightRegions = solid.map(function (r) { return cleanSpikes(inter(r, rightHP)); });
    var left = meshSlabs(levels, leftRegions);
    var right = meshSlabs(levels, rightRegions);

    // ---- overhang audit: downward faces above the bed. The two channel
    // roofs are the only intended flat ledges (cA wide); everything else
    // is a 45-degree staircase.
    var maxLedge = 0, downArea = 0, roofLedge = 0;
    var roofZ = [Math.round(zBS * S), Math.round(zTS1 * S)];
    function ledgeOf(dn) {
      // widest ledge: grow an inward offset until the region vanishes
      var w = 0;
      while (w < 50 && offset(dn, -(w + 0.05)).length) w += 0.05;
      return 2 * w;
    }
    [leftRegions, rightRegions].forEach(function (regs) {
      for (k = 1; k < levels.length - 1; k++) {
        var dn = diff(regs[k], regs[k - 1]);
        if (!dn.length) continue;
        downArea += areaMm2(dn) / 2;
        var lw = ledgeOf(dn);
        if (roofZ.indexOf(levels[k]) >= 0) roofLedge = Math.max(roofLedge, lw);
        else maxLedge = Math.max(maxLedge, lw);
      }
    });
    if (capRegions) {
      // printed upside down: a downward face is where a slab sticks out
      // past the one above it (in body coordinates)
      for (k = capRegions.length - 2; k >= 0; k--) {
        var dnp = diff(capRegions[k], capRegions[k + 1]);
        if (!dnp.length) continue;
        downArea += areaMm2(dnp);
        maxLedge = Math.max(maxLedge, ledgeOf(dnp));
      }
    }
    if (collarRegions) {
      for (k = 1; k < collarRegions.length; k++) {
        var dnc = diff(collarRegions[k], collarRegions[k - 1]);
        if (!dnc.length) continue;
        downArea += areaMm2(dnc);
        maxLedge = Math.max(maxLedge, ledgeOf(dnc));
      }
    }

    // ---- panels (1:1 outlines, mm)
    var topPanel = topPanel0;
    var backPanel = offset(cavB, -ec);

    // ---- checks and warnings
    var bed = p.bedMm;
    // a part needs ~2 mm of bed to spare (skirt / first-layer squish)
    var bedFit = L <= bed - BED_MARGIN && maxHw <= bed - BED_MARGIN;
    var diag = null;
    if (L > bed - BED_MARGIN) {
      // will each half fit corner to corner? (best rotation of its footprint)
      diag = Math.max(squareFit(halfPoly(outline, 1)), squareFit(halfPoly(outline, -1)));
      warnings.push('Body length ' + (L / IN).toFixed(2) + '″ leaves under ' + BED_MARGIN + ' mm to spare on the ' + (bed / IN).toFixed(2) + '″ print bed. ' +
        (diag <= bed - BED_MARGIN ? 'Each half fits turned corner to corner (needs a ' + (diag / IN).toFixed(2) + '″ square); ' : 'Each half needs a ' + (diag / IN).toFixed(2) + '″ square even turned diagonally; ') +
        'otherwise use a bigger bed, cut each half in two, or scale the body down.');
    }
    if (maxHw >= bed) warnings.push('A half is ' + (maxHw / IN).toFixed(2) + '″ wide, more than the print bed.');
    if (p.neckScrewMode === 'wells' && plasticUnderPocket < 19) warnings.push('Only ' + plasticUnderPocket.toFixed(1) + ' mm of printed floor between the screw wells and the pocket; 19 mm or more recommended.');
    var backLen = (L - bl) - tbl;
    if (backLen < 60) warnings.push('The neck and tail blocks leave only ' + backLen.toFixed(0) + ' mm for the back panel; shorten the pocket or the blocks, or lengthen the body.');
    if (zTA < baseTop - 1e-6) warnings.push('The body is too shallow for the end slabs and the top channel; increase the depth.');
    if (sx + rs > pw2 - 2 || sy + rs > pl / 2 - 2) warnings.push('The neck screw pattern does not fit inside the neck pocket.');
    if (cA > 4) warnings.push('A ' + cA.toFixed(1) + ' mm flat channel roof is a long unsupported ledge; 3 mm (4 mm at most) prints cleanly.');
    if (cD - ec < 4) warnings.push('Only ' + (cD - ec).toFixed(1) + ' mm of each panel edge is held; a channel of 7 mm or more holds the panels firmly.');
    if (Math.min(lipIn, p.topLipMm, p.bottomLipMm) < 2) warnings.push('Channel lips under 2 mm thick are fragile; use 3 mm.');

    // screws: plate mode = through the whole block; wells = through the floor
    var wellsUsed = p.neckScrewMode === 'wells' && wellTop > 0;
    var throughMm = wellsUsed ? plasticUnderPocket : zF;
    var underHead = throughMm + (wellsUsed ? 1.5 : p.plateThicknessMm); // washer or plate under the head
    var screwMm = underHead + p.screwBiteMm;
    // the shortest common wood-screw length that gives the wanted bite
    var STD = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5, 4, 4.5, 5, 6];
    var minBite = Math.max(10, p.screwBiteMm - 6), maxBite = p.screwBiteMm + 3;
    var screwIn = STD[STD.length - 1];
    for (var si = 0; si < STD.length; si++) if (STD[si] * IN - underHead >= minBite) { screwIn = STD[si]; break; }
    var biteMm = screwIn * IN - underHead;
    var screwNote = '';
    if (biteMm > maxBite) {
      screwNote = 'Add ' + Math.ceil(biteMm - p.screwBiteMm) + ' mm of washers under the ' + (wellsUsed ? 'screw heads' : 'plate') +
        ' (or shorten the screws) so they reach only ' + p.screwBiteMm.toFixed(0) + ' mm into the neck.';
    }

    var lpanelBox = bbox(topPanel), bpanelBox = bbox(backPanel);

    var groups = { left: left, right: right };
    if (collar) groups.collar = collar;
    if (cap) groups.cap = cap;
    var meta = {
      params: p,
      lengthMm: L, widthMm: maxL + maxR, depthMm: D, requestedDepthMm: Dreq, minDepthMm: Dmin,
      halfFootprintMm: [maxHw, L], leftFootprintMm: [maxL, L], rightFootprintMm: [maxR, L],
      symmetric: sh.kind !== 'tstyle', cutawaySide: sh.cutawaySide || null,
      halfHeightMm: D, fitsBed: bedFit, diagonalSquareMm: diag, bedMm: bed,
      panelTopZ: panelTopZ, pocketFloorZ: zF, topSlot: [zTS0, zTS1], bottomSlot: [zBL, zBS],
      baseTopMm: baseTop, neckBlock: { lengthMm: bl, widthMm: 2 * kw, heightMm: zTS0 },
      tailBlock: { lengthMm: tbl, widthMm: 2 * tw, heightMm: zTS0, web: p.tailBolts >= 2 ? [0, web1] : null },
      pocket: { lengthMm: pl, widthMm: 2 * pw2, depthMm: panelTopZ - zF, floorZ: zF },
      plasticUnderPocketMm: plasticUnderPocket,
      neckScrews: screws.map(function (q) { return { x: q[0], y: q[1] }; }),
      neckScrewThroughMm: throughMm, neckScrewLengthIn: screwIn, neckScrewNeedMm: screwMm, neckScrewBiteMm: biteMm, neckScrewWells: wellsUsed, neckScrewNote: screwNote,
      bolts: boltInfo, boltSize: bolt.label, collar: collarInfo, cap: capInfo,
      panels: {
        top: { outline: pathsToMm(topPanel), sizeMm: [lpanelBox[2] - lpanelBox[0], lpanelBox[3] - lpanelBox[1]], areaMm2: areaMm2(topPanel) },
        back: { outline: pathsToMm(backPanel), sizeMm: [bpanelBox[2] - bpanelBox[0], bpanelBox[3] - bpanelBox[1]], areaMm2: areaMm2(backPanel) },
        topZ: [zTS0, zTS0 + t], backZ: [zBL, zBL + t]
      },
      overhang: { downFacingAreaMm2: downArea, widestLedgeMm: Math.max(maxLedge, roofLedge), stairLedgeMm: maxLedge, channelRoofLedgeMm: roofLedge },
      channel: { depthMm: cD, engagementMm: cD - ec, roofFlatMm: cA, heightMm: t + fit, innerLipMm: lipIn, topLipMm: p.topLipMm,
        bottomLipMm: p.bottomLipMm, topRimMm: topRim, topCorbelFootZ: zTA, backLipTopZ: zBU },
      levels: levels.length, outline: outline,
      triangles: { left: left.length / 9, right: right.length / 9, collar: collar ? collar.length / 9 : 0, cap: cap ? cap.length / 9 : 0 }
    };
    return { groups: groups, meta: meta, warnings: warnings,
      slabs: { levels: levels, left: leftRegions, right: rightRegions, collar: collarRegions, collarLevels: collarLevels, cap: capRegions, capLevels: capLevels } };
  }

  // Is (x, y, z) (mm) inside the printed material of one half?
  // half = 'left' | 'right'. Used by the tests and handy for debugging.
  // half = 'collar' for the neck collar (body coordinates).
  function solidAt(result, half, x, y, z) {
    var lv = half === 'collar' ? result.slabs.collarLevels : result.slabs.levels, zi = z * S, k;
    if (!lv) return false;
    for (k = 0; k + 1 < lv.length; k++) if (zi >= lv[k] && zi < lv[k + 1]) break; // on a level: the slab above
    if (k + 1 >= lv.length) return false;
    var pt = { X: Math.round(x * S), Y: Math.round(y * S) }, wind = 0;
    result.slabs[half][k].forEach(function (path) {
      if (ClipperLib.Clipper.PointInPolygon(pt, path) !== 0) wind += ClipperLib.Clipper.Area(path) > 0 ? 1 : -1;
    });
    return wind > 0;
  }

  // turn a part upside down for printing: z -> zTop - z, triangles
  // re-wound so they still face outwards
  function flipZ(tris, zTop) {
    var out = new Float32Array(tris.length);
    for (var i = 0; i < tris.length; i += 9) {
      for (var v = 0; v < 3; v++) {
        var src = i + [0, 2, 1][v] * 3, dst = i + v * 3;
        out[dst] = tris[src]; out[dst + 1] = tris[src + 1]; out[dst + 2] = zTop - tris[src + 2];
      }
    }
    return out;
  }
  function bbox(paths) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    paths.forEach(function (pp) {
      pp.forEach(function (q) {
        b[0] = Math.min(b[0], q.X / S); b[1] = Math.min(b[1], q.Y / S);
        b[2] = Math.max(b[2], q.X / S); b[3] = Math.max(b[3], q.Y / S);
      });
    });
    return b;
  }

  // ------------------------------------------------------------------
  // Panel mesh (for the preview): extruded outline, big triangles split
  // so the painter's sort in the preview stays tidy.
  // ------------------------------------------------------------------
  function panelMesh(outlineMm, z0, z1) {
    var paths = outlineMm.map(function (pp) { return toPath(pp); });
    var regions = [union(paths)];
    var m = meshSlabs([Math.round(z0 * S), Math.round(z1 * S)], regions);
    var out = [];
    function split(a, b, c, depth) {
      var l = Math.max(dist(a, b), dist(b, c), dist(c, a));
      if (l < 10 || depth > 9) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); return; }
      var ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      // only flat faces get here with long edges; split all three edges
      split(a, ab, ca, depth + 1); split(ab, b, bc, depth + 1); split(ca, bc, c, depth + 1); split(ab, bc, ca, depth + 1);
    }
    for (var i = 0; i < m.length; i += 9) {
      var a = [m[i], m[i + 1], m[i + 2]], b = [m[i + 3], m[i + 4], m[i + 5]], c = [m[i + 6], m[i + 7], m[i + 8]];
      if (a[2] === b[2] && b[2] === c[2]) split(a, b, c, 0);
      else out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    }
    return new Float32Array(out);
  }
  function dist(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2])); }
  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }

  // ------------------------------------------------------------------
  // 1:1 SVG / DXF of a panel outline (mm). Outer edges and the pocket
  // notch are one closed cut path.
  // ------------------------------------------------------------------
  function panelSVG(outlineMm, title) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    outlineMm.forEach(function (pp) { pp.forEach(function (q) {
      b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]);
    }); });
    var m = 10, w = b[2] - b[0] + 2 * m, h = b[3] - b[1] + 2 * m + 12;
    var d = outlineMm.map(function (pp) {
      return 'M' + pp.map(function (q) {
        return (q[0] - b[0] + m).toFixed(3) + ' ' + (b[3] - q[1] + m).toFixed(3);
      }).join(' L') + ' Z';
    }).join(' ');
    var bar = m + ' ' + (h - 6) + ' h 100';
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w.toFixed(3) + 'mm" height="' + h.toFixed(3) + 'mm" viewBox="0 0 ' + w.toFixed(3) + ' ' + h.toFixed(3) + '">\n' +
      '  <title>' + (title || 'panel') + ' — 1:1, millimetres</title>\n' +
      '  <path d="' + d + '" fill="none" stroke="#000" stroke-width="0.2"/>\n' +
      '  <path d="M' + bar + '" fill="none" stroke="#c00" stroke-width="0.4"/>\n' +
      '  <text x="' + m + '" y="' + (h - 8) + '" font-size="4" font-family="sans-serif" fill="#c00">100 mm check bar — ' + (title || '') + ' — ' + (b[2] - b[0]).toFixed(1) + ' × ' + (b[3] - b[1]).toFixed(1) + ' mm</text>\n' +
      '</svg>\n';
  }

  function panelDXF(outlineMm) {
    var s = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
    outlineMm.forEach(function (pp) {
      for (var i = 0; i < pp.length; i++) {
        var a = pp[i], b = pp[(i + 1) % pp.length];
        s.push('0', 'LINE', '8', 'CUT', '10', a[0].toFixed(4), '20', a[1].toFixed(4), '30', '0', '11', b[0].toFixed(4), '21', b[1].toFixed(4), '31', '0');
      }
    });
    s.push('0', 'ENDSEC', '0', 'EOF');
    return s.join('\n') + '\n';
  }

  var api = {
    IN: IN, DEFAULTS: DEFAULTS, STYLES: STYLES, STYLE_KEYS: STYLE_KEYS, STYLE_FIELDS: STYLE_FIELDS, BOLTS: BOLTS,
    STEP_MM: STEP, WALL_MIN_MM: WALL_MIN,
    styleParams: styleParams, matchStyle: matchStyle, withDefaults: withDefaults,
    shapeOf: shapeOf, halfWidth: halfWidth, outlinePoints: outlinePoints, tstyleProportions: tstyleProportions, flipZ: flipZ,
    build: build, solidAt: solidAt, panelMesh: panelMesh, panelSVG: panelSVG, panelDXF: panelDXF,
    _meshSlabs: meshSlabs, _toPath: toPath
  };
  if (isNode) module.exports = api;
  else global.BodyBuilder = api;
})(typeof window !== 'undefined' ? window : this);
