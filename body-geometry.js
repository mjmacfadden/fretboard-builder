/*
 * body-geometry.js — parametric one-piece guitar body ("body builder").
 *
 * A small guitar body for 3- and 4-string necks, printed as ONE part:
 *   - a perimeter rim (wall) and a solid back floor, printed floor down
 *     on the bed with the open side on top;
 *   - an inner glue shelf running round the inside of the rim, just
 *     below its top edge, with a 45-degree tapered underside (no
 *     supports). A 1/8" (3.175 mm) plywood top drops into the rim and is
 *     glued onto the shelf, sitting flush (or a hair below) the rim edge;
 *   - an integral neck block rising from the floor: a stiff shell round
 *     the neck pocket (2.75" x 1.5", 1/4" corner radius, floor 0.9" below
 *     the top surface) with ribs, side ties and screw bosses, for a
 *     screw-on wooden neck, held by four wood screws up through the back
 *     floor and the block (through a back plate, or from counterbored
 *     wells with washers / ferrules);
 *   - optionally, an access opening in the back floor with a 45-degree
 *     tapered (countersunk) recess for a flush printed cover plate.
 *
 * Coordinates, millimetres: x across the body, y along the body (tail
 * tip y = 0, neck end y = L), z up from the back face (z = 0, the face
 * that lies on the print bed).
 *
 * The body is "2.5D": a stack of horizontal slabs, each slab a 2D region
 * computed with polygon booleans (Clipper), meshed into one closed
 * (watertight) triangle mesh. Every overhang is a 45-degree staircase
 * (steps of STEP mm) except the flat roofs of the screw wells (short,
 * round bridges).
 *
 * If an outline is bigger than the print bed allows (bed minus a small
 * margin), only the OUTLINE is scaled down uniformly until it fits; the
 * neck pocket, wall, floor, shelf and screw holes stay true size.
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
  var STEP = 0.4;        // staircase step (mm) for every printed overhang
  var ARC_TOL = 0.03 * S;
  var FLOOR_MIN = 15;    // mm of printed block kept under the neck pocket floor
  var WALL_MIN = 2.0;    // thinnest rim wall (five 0.4 mm perimeters)
  var FLOOR_MIN_MM = 2.0; // thinnest back floor

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
    depthIn: 3.25,           // overall body depth: back face to rim edge
    wallMm: 3.0,             // rim wall thickness
    floorMm: 3.0,            // back floor thickness
    panelThicknessMm: 3.175, // 1/8" plywood top
    shelfAllowanceMm: 0.25,  // shelf drop below the rim edge = panel thickness + this (0 = top dead flush)
    shelfWidthMm: 7.0,       // how far the glue shelf reaches in from the wall's inside face
    shelfLipMm: 1.6,         // straight (vertical) edge of the shelf under the glue surface, above the 45-degree taper
    topFitMm: 0.3,           // top panel cut this much inside the rim's inside face (drop-in fit)
    pocketLengthIn: 2.75,
    pocketWidthIn: 1.5,
    pocketDepthIn: 0.9,      // pocket floor below the top surface of the top panel
    pocketFitMm: 0.15,       // added to each side of the pocket width
    pocketCornerMm: 6.35,    // 1/4" radius on the pocket's two inner corners
    pocketWallMm: 6.0,       // neck block shell: the pocket's side walls
    pocketEndWallMm: 8.0,    // ... and its inner-end wall (a little thicker: nothing braces it from behind)
    pocketFloorMm: 6.0,      // solid plate under the pocket floor, over the cells
    ribMm: 3.0,              // ribs under the pocket and the side ties
    bossWallMm: 3.0,         // wall round each neck screw hole (or well)
    neckBlockRibs: false,    // one brace across the body at the neck block, ladder-brace profile, the pocket shell cutting through it (off: the walls stand alone)
    neckScrewMode: 'plate',  // 'plate' (back plate on the back face) or 'wells' (washers / ferrules)
    neckScrewSpanXIn: 0.875, // hole spacing across the neck
    neckScrewSpanYIn: 1.75,  // hole spacing along the neck
    neckScrewHoleMm: 4.6,    // clearance for a #8 wood screw
    wellDiameterMm: 16.0,
    wellFloorMm: 25.4,       // printed block kept between the wells and the pocket floor
    plateThicknessMm: 3.0,
    screwBiteMm: 19.0,       // thread length wanted in the wooden neck
    accessPanel: false,      // cut an access opening (with a cover recess) in the back
    accessLengthMm: 110,     // clear opening, along the body
    accessWidthMm: 75,       // clear opening, across the body
    accessCornerMm: 20,      // corner radius of the opening
    accessPos: 0.33,         // opening centre, fraction of the body length from the tail
    coverThicknessMm: 4.0,   // cover plate = depth of the tapered recess (the seat is a 45-degree bevel this wide)
    coverFitMm: 0.2,         // cover cut this much smaller than the recess all round
    accessRingMm: 5.0,       // raised ring round the recess, inside the body (wall thickness beyond the recess)
    accessRingHeightMm: 4.0, // ring height above the top of the recess
    coverScrews: 4,          // small screws holding the cover (0 = none: glue / tape / friction)
    coverScrewHoleMm: 2.0,   // pilot hole in the body ring (#2 / M2.5 self-tapping)
    coverScrewClearMm: 2.8,  // clearance hole in the cover
    ladderBraces: true,      // ladder braces across the inside of the back floor
    braceCount: 3,           // how many (spread evenly from the tail to the neck block) ...
    bracePositions: '',      // ... or their centres as % of the body length from the tail, e.g. '25, 45, 65'
    braceWidthMm: 7.0,
    braceHeightMm: 12.0,     // at the centre (the profile is a parabola, with a rounded crown)
    braceEndHeightMm: 4.5,   // where each brace meets the rim (or stops short of the access ring)
    screwTop: false,         // screw the top on (tabs round the rim under the shelf) instead of gluing it
    topScrewCount: 0,        // 0 = automatic (6-10 by the size of the body)
    topScrewSize: '#4',      // '#4', '#6' or '#8' coarse-thread wood / thread-forming screws
    topScrewHead: 'pan',     // 'pan' (clearance hole + head circle marked) or 'flat' (countersunk)
    tabBossMm: 11.0,         // screw tab boss diameter: room to re-drill #4 -> #6 -> #8
    tabDepthMm: 12.0,        // full-size tab below the glue surface, before its 45-degree underside
    bedMm: 327.66,           // 12.9"
    bedMarginMm: 5.0,        // the body must be this much shorter / narrower than the bed
    fitBed: true,            // scale the outline (only) down to fit the bed
    leftHanded: false        // mirror asymmetric outlines (cutaway on the other side)
  };

  // Top screws (coarse-thread wood / plastic thread-forming, no inserts):
  // pilot in the printed tab, clearance in the ply top, head diameters.
  var TOP_SCREWS = {
    '#4': { pilotMm: 2.3, clearanceMm: 3.2, panHeadMm: 5.6, flatHeadMm: 5.7, lengthIn: 0.5 },
    '#6': { pilotMm: 2.8, clearanceMm: 3.8, panHeadMm: 6.9, flatHeadMm: 7.1, lengthIn: 0.5 },
    '#8': { pilotMm: 3.3, clearanceMm: 4.5, panHeadMm: 8.2, flatHeadMm: 8.4, lengthIn: 0.625 }
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
    // A standard US license plate: 12" x 6" with 1/4" corners (fits the
    // bed at full size: 304.8 mm + the 5 mm margin < 327.66 mm). The neck
    // goes on one short end; the 12" axis is the body length.
    'license-plate': {
      label: 'License plate',
      values: { shape: 'box', lengthIn: 12.0, widthIn: 6.0, cornerRadiusIn: 0.25, depthIn: 2.5 }
    },
    // Single-cutaway slab body traced from t-style-body-outline.svg at
    // 12.9" long (10.52" wide). That is the whole bed, so the builder
    // scales the outline down to fit (bed minus the margin).
    't-style': {
      label: 'T-Style',
      values: { shape: 'tstyle', lengthIn: 12.9, widthIn: 10.52, depthIn: 1.85 }
    }
  };
  var STYLE_KEYS = ['parlor', 'small-dread', 'round', 'cigar-box', 'license-plate', 't-style'];
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
    //    pocket + wall + the glue shelf's reach (so the top panel still
    //    has a glue seat there); the cutaway curve is unchanged outside it.
    //  The pocket, wall and shelf are true size: when the outline is
    //  scaled down to fit the bed this closure is not.
    var pocketHalf = (p.pocketWidthIn !== undefined ? p.pocketWidthIn : DEFAULTS.pocketWidthIn) * IN / 2 +
      (p.pocketFitMm !== undefined ? p.pocketFitMm : DEFAULTS.pocketFitMm);
    var pl = (p.pocketLengthIn !== undefined ? p.pocketLengthIn : DEFAULTS.pocketLengthIn) * IN;
    var wallT = p.wallMm !== undefined ? p.wallMm : DEFAULTS.wallMm;
    var shelfW = p.shelfWidthMm !== undefined ? p.shelfWidthMm : DEFAULTS.shelfWidthMm;
    var side = pocketHalf + wallT + Math.max(6.7, shelfW);
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
  // edges, block edges) then meets the
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
    // cap points: a boolean can return a wall vertex a micron or two off
    // (its rounding); use the wall's own vertex then
    var snapFace = function (q) {
      if (reps.has(q.X + ',' + q.Y)) return reps.get(q.X + ',' + q.Y);
      for (var d = 1; d <= 2; d++) for (var dx = -d; dx <= d; dx++) for (var dy = -d; dy <= d; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        var r = reps.get((q.X + dx) + ',' + (q.Y + dy));
        if (r) return r;
      }
      return snap(q);
    };

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
  // Small helpers for the one-piece build
  // ------------------------------------------------------------------
  // Only these scale when the outline is shrunk to fit the bed.
  var OUTLINE_KEYS = ['lengthIn', 'lowerWidthIn', 'waistWidthIn', 'upperWidthIn', 'widthIn', 'cornerRadiusIn'];
  function scaledParams(p, s) {
    var q = {};
    Object.keys(p).forEach(function (k) { q[k] = p[k]; });
    OUTLINE_KEYS.forEach(function (k) { q[k] = p[k] * s; });
    return q;
  }
  // [width across (x), length along (y)] of a point list
  function outlineSize(pts) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
    return [x1 - x0, y1 - y0];
  }
  // counter-clockwise rounded rectangle centred on (cx, cy), w across, l along
  function roundedRect(cx, cy, w, l, r, n) {
    n = n || 10;
    r = clamp(r, 0.5, Math.min(w, l) / 2 - 0.01);
    var pts = [], corners = [[cx + w / 2 - r, cy - l / 2 + r, -90], [cx + w / 2 - r, cy + l / 2 - r, 0],
      [cx - w / 2 + r, cy + l / 2 - r, 90], [cx - w / 2 + r, cy - l / 2 + r, 180]];
    corners.forEach(function (c) {
      for (var i = 0; i <= n; i++) {
        var ang = (c[2] + 90 * i / n) * Math.PI / 180;
        pts.push([c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]);
      }
    });
    return pts;
  }
  // n points evenly spaced (by length) round a closed path (mm points)
  function pointsAlong(path, n) {
    if (n <= 0) return [];
    var segs = [], total = 0, i;
    for (i = 0; i < path.length; i++) {
      var a = path[i], b = path[(i + 1) % path.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push([a, b, l]); total += l;
    }
    var out = [];
    for (var k = 0; k < n; k++) {
      var s = total * (k + 0.5) / n, acc = 0;
      for (i = 0; i < segs.length; i++) {
        if (acc + segs[i][2] >= s) {
          var u = segs[i][2] ? (s - acc) / segs[i][2] : 0;
          out.push([segs[i][0][0] + (segs[i][1][0] - segs[i][0][0]) * u, segs[i][0][1] + (segs[i][1][1] - segs[i][0][1]) * u]);
          break;
        }
        acc += segs[i][2];
      }
    }
    return out;
  }
  function screwLengthIn(mm) { return Math.ceil(mm / IN * 4 - 1e-6) / 4; }

  // Booleans where an offset curve grazes a straight cut can land a
  // vertex a micron or two off the cut line, or two vertices a micron
  // apart, differently in neighbouring slabs (a T-junction the mesher
  // can't close). Across all slabs of one part: snap such vertices onto
  // the split lines and merge near-twins into the one more slabs share.
  function tidy(regs, SXs, SYs, tol) {
    var TOL = tol || 2;
    function snapTo(v, lines) {
      var lo = 0, hi = lines.length - 1;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (lines[mid] < v - TOL) lo = mid + 1; else hi = mid; }
      return lines.length && Math.abs(lines[lo] - v) <= TOL ? lines[lo] : v;
    }
    var cnt = new Map();
    regs = regs.map(function (paths) {
      return paths.map(function (path) {
        return path.map(function (q) {
          var v = { X: snapTo(q.X, SXs), Y: snapTo(q.Y, SYs) };
          var key = v.X + ',' + v.Y;
          cnt.set(key, (cnt.get(key) || 0) + 1);
          return v;
        });
      });
    });
    // near-twins: cluster every vertex within TOL of another (chains
    // too) and use one point per cluster, the one most slabs share
    var keys = Array.from(cnt.keys()), parent = new Map();
    function find(k) { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; }
    keys.forEach(function (k) { parent.set(k, k); });
    keys.forEach(function (k) {
      var xy = k.split(',').map(Number);
      for (var dx = -TOL; dx <= TOL; dx++) for (var dy = -TOL; dy <= TOL; dy++) {
        if (!dx && !dy) continue;
        var k2 = (xy[0] + dx) + ',' + (xy[1] + dy);
        if (parent.has(k2)) { var r1 = find(k), r2 = find(k2); if (r1 !== r2) parent.set(r1, r2); }
      }
    });
    var best = new Map();
    keys.forEach(function (k) {
      var r = find(k), b = best.get(r);
      if (!b || cnt.get(k) > cnt.get(b) || (cnt.get(k) === cnt.get(b) && k < b)) best.set(r, k);
    });
    return regs.map(function (paths) {
      return cleanSpikes(paths.map(function (path) {
        var res = [];
        path.forEach(function (v) {
          var xy = best.get(find(v.X + ',' + v.Y)).split(',').map(Number), w = { X: xy[0], Y: xy[1] };
          var last = res[res.length - 1];
          if (!last || last.X !== w.X || last.Y !== w.Y) res.push(w);
        });
        while (res.length > 1 && res[0].X === res[res.length - 1].X && res[0].Y === res[res.length - 1].Y) res.pop();
        return res;
      }));
    });
  }

  // Insert the crossing points of every edge of `a` with every edge of
  // `b` (paths, integer microns) into both, rounded once, so later
  // booleans meet at shared vertices instead of inventing (and rounding)
  // their own crossings differently in each slab. Mutates nothing.
  function mutualSplit(a, b) {
    var addA = a.map(function () { return []; }), addB = b.map(function () { return []; });
    var bb = b.map(function (pb) {
      var r = [Infinity, Infinity, -Infinity, -Infinity];
      pb.forEach(function (q) { if (q.X < r[0]) r[0] = q.X; if (q.Y < r[1]) r[1] = q.Y; if (q.X > r[2]) r[2] = q.X; if (q.Y > r[3]) r[3] = q.Y; });
      return r;
    });
    a.forEach(function (pa, ia) {
      var na = pa.length;
      for (var i = 0; i < na; i++) {
        var p1 = pa[i], p2 = pa[(i + 1) % na];
        var ex0 = Math.min(p1.X, p2.X), ex1 = Math.max(p1.X, p2.X), ey0 = Math.min(p1.Y, p2.Y), ey1 = Math.max(p1.Y, p2.Y);
        b.forEach(function (pb, ib) {
          var r = bb[ib];
          if (ex1 < r[0] || ex0 > r[2] || ey1 < r[1] || ey0 > r[3]) return;
          var nb = pb.length;
          for (var j = 0; j < nb; j++) {
            var q1 = pb[j], q2 = pb[(j + 1) % nb];
            var rx = p2.X - p1.X, ry = p2.Y - p1.Y, sx = q2.X - q1.X, sy = q2.Y - q1.Y;
            var den = rx * sy - ry * sx;
            if (den === 0) continue;
            var t = ((q1.X - p1.X) * sy - (q1.Y - p1.Y) * sx) / den;
            var u = ((q1.X - p1.X) * ry - (q1.Y - p1.Y) * rx) / den;
            if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) continue;
            var X = { X: Math.round(p1.X + rx * t), Y: Math.round(p1.Y + ry * t) };
            addA[ia].push([i, t, X]); addB[ib].push([j, u, X]);
          }
        });
      }
    });
    function apply(paths, adds) {
      return paths.map(function (path, ip) {
        if (!adds[ip].length) return path.slice();
        var by = {};
        adds[ip].forEach(function (c) { (by[c[0]] = by[c[0]] || []).push(c); });
        var out = [];
        path.forEach(function (q, i) {
          out.push(q);
          (by[i] || []).sort(function (m, n) { return m[1] - n[1]; }).forEach(function (c) {
            var last = out[out.length - 1];
            if (last.X !== c[2].X || last.Y !== c[2].Y) out.push(c[2]);
          });
        });
        return out;
      });
    }
    return [apply(a, addA), apply(b, addB)];
  }

  // Stack of z-ranged solids minus z-ranged voids -> slab levels (microns)
  // and one region per slab.
  function stack(solids, voids) {
    var zs = [];
    solids.concat(voids).forEach(function (f) { f.a = Math.round(f.z0 * S); f.b = Math.round(f.z1 * S); zs.push(f.a, f.b); });
    var lo = Infinity, hi = -Infinity;
    solids.forEach(function (f) { lo = Math.min(lo, f.a); hi = Math.max(hi, f.b); });
    zs = zs.filter(function (z) { return z >= lo && z <= hi; }).sort(function (a, b) { return a - b; });
    var levels = [];
    zs.forEach(function (z) { if (!levels.length || z > levels[levels.length - 1]) levels.push(z); });
    var regions = [];
    for (var k = 0; k + 1 < levels.length; k++) {
      var z0 = levels[k], z1 = levels[k + 1], base = [], vv = [];
      solids.forEach(function (f) { if (f.a <= z0 && f.b >= z1) base = base.concat(f.reg); });
      voids.forEach(function (f) { if (f.a <= z0 && f.b >= z1) vv = vv.concat(f.reg); });
      regions.push(cleanSpikes(vv.length ? diff(union(base), union(vv)) : union(base)));
    }
    return { levels: levels, regions: regions };
  }
  // merge consecutive slabs whose regions are identical (fewer levels)
  function mergeSame(st) {
    var lv = [st.levels[0]], rg = [];
    function key(r) { return JSON.stringify(r); }
    st.regions.forEach(function (r, k) {
      if (rg.length && key(rg[rg.length - 1]) === key(r)) lv[lv.length - 1] = st.levels[k + 1];
      else { rg.push(r); lv.push(st.levels[k + 1]); }
    });
    return { levels: lv, regions: rg };
  }

  // ------------------------------------------------------------------
  // Build everything
  // ------------------------------------------------------------------
  function build(input) {
    var p = withDefaults(input);
    p.accessPanel = p.accessPanel === true || p.accessPanel === 'true' || p.accessPanel === 1;
    p.fitBed = !(p.fitBed === false || p.fitBed === 'false' || p.fitBed === 0);
    p.leftHanded = p.leftHanded === true || p.leftHanded === 'true' || p.leftHanded === 1;
    function bool(v) { return v === true || v === 'true' || v === 1; }
    p.neckBlockRibs = bool(p.neckBlockRibs);
    p.ladderBraces = !(p.ladderBraces === false || p.ladderBraces === 'false' || p.ladderBraces === 0);
    p.screwTop = bool(p.screwTop);
    if (!TOP_SCREWS[p.topScrewSize]) p.topScrewSize = '#4';
    if (p.topScrewHead !== 'flat') p.topScrewHead = 'pan';
    var warnings = [];
    if (!(p.wallMm >= WALL_MIN)) { warnings.push('Walls thinner than ' + WALL_MIN + ' mm are too weak; using ' + WALL_MIN + ' mm.'); p.wallMm = WALL_MIN; }
    if (!(p.floorMm >= FLOOR_MIN_MM)) { warnings.push('Back floor thinner than ' + FLOOR_MIN_MM + ' mm is too weak; using ' + FLOOR_MIN_MM + ' mm.'); p.floorMm = FLOOR_MIN_MM; }
    p.shelfWidthMm = clamp(p.shelfWidthMm, 3, 20);
    p.shelfLipMm = clamp(p.shelfLipMm, 0.8, 6);
    p.shelfAllowanceMm = clamp(p.shelfAllowanceMm, 0, 2);
    p.topFitMm = clamp(p.topFitMm, 0, 1.5);

    // ---- outline, scaled (outline only) to fit the bed
    var bedLimit = p.bedMm - p.bedMarginMm;
    var scale = 1, sh = shapeOf(p), pts = outlinePoints(sh), size = outlineSize(pts);
    var natural = size.slice();
    if (p.fitBed) {
      for (var it = 0; it < 8 && Math.max(size[0], size[1]) > bedLimit; it++) {
        scale *= bedLimit / Math.max(size[0], size[1]) * (1 - 1e-6);
        sh = shapeOf(scaledParams(p, scale)); pts = outlinePoints(sh); size = outlineSize(pts);
      }
    }
    var fitsBed = Math.max(size[0], size[1]) <= bedLimit + 1e-6;
    if (!fitsBed) {
      warnings.push('The body (' + (size[1] / IN).toFixed(2) + '″ × ' + (size[0] / IN).toFixed(2) + '″) does not fit the ' +
        (p.bedMm / IN).toFixed(2) + '″ bed with a ' + p.bedMarginMm + ' mm margin' + (p.fitBed ? '.' : ': turn on "scale to fit the bed".'));
    }
    var L = sh.L;

    // ---- heights (z up from the back face)
    var t = p.panelThicknessMm, al = p.shelfAllowanceMm, sw = p.shelfWidthMm, lip = p.shelfLipMm;
    var pocketDepth = p.pocketDepthIn * IN;
    var D = p.depthIn * IN;
    var minD = Math.max(al + pocketDepth + FLOOR_MIN, t + al + lip + sw + p.floorMm + 2);
    if (D < minD - 1e-9) {
      warnings.push('Body depth raised to ' + (minD / IN).toFixed(2) + '″ (' + minD.toFixed(1) + ' mm): the pocket needs ' + FLOOR_MIN +
        ' mm of block under its floor and the shelf needs room above the back.');
      D = minD;
    }
    var topSurf = D - al;              // top face of the glued-on top panel
    var zShelf = D - t - al;           // glue surface of the shelf
    var zTaper0 = zShelf - lip - sw;   // where the 45-degree taper meets the wall
    var zF = topSurf - pocketDepth;    // pocket floor

    // ---- neck pocket and block (true size, never scaled)
    var ph = p.pocketWidthIn * IN / 2 + p.pocketFitMm, pl = p.pocketLengthIn * IN;
    var pr = clamp(p.pocketCornerMm, 0, ph - 0.5);
    if (pr < 0.5) pr = 0;                   // a sub-0.5 mm radius is a square corner
    ['pocketWallMm', 'pocketEndWallMm', 'ribMm', 'bossWallMm', 'pocketFloorMm'].forEach(function (key) {
      if (!(p[key] >= 2)) { warnings.push('Neck block walls thinner than 2 mm are too weak; ' + key + ' set to 2 mm.'); p[key] = 2; }
    });
    var tw = p.pocketWallMm, ew = p.pocketEndWallMm, rib = p.ribMm;
    var yP0 = L - pl;                       // inner end of the pocket
    var yS0 = yP0 - ew;                     // outer face of the shell's end wall
    var xs = ph + tw;                       // outer face of the shell's side walls
    var prO = pr > 0 ? pr + tw : 0;         // radius of the shell's outer corners
    if (yS0 < L * 0.4) warnings.push('The neck block reaches past 60% of the body length; check the pocket length.');
    var sxs = p.neckScrewSpanXIn * IN / 2, sys = p.neckScrewSpanYIn * IN / 2, yc = L - pl / 2, hr = p.neckScrewHoleMm / 2;
    var holes = [[-sxs, yc - sys], [sxs, yc - sys], [-sxs, yc + sys], [sxs, yc + sys]];
    if (sxs + hr > ph - 1 || sys + hr > pl / 2 - 1) warnings.push('The neck screw holes come within 1 mm of the pocket walls; tighten the hole spacing.');
    var wells = p.neckScrewMode === 'wells', zWell = zF - p.wellFloorMm;
    if (wells && zWell < 3) {
      warnings.push('No room for screw wells (the block under the pocket is only ' + zF.toFixed(1) + ' mm and the wells keep ' +
        p.wellFloorMm + ' mm of it); using a back plate instead.');
      wells = false;
    }
    if (wells && 2 * sxs < p.wellDiameterMm + 1) warnings.push('The screw wells overlap across the neck; use a smaller well or wider hole spacing.');
    var bossR = (wells ? p.wellDiameterMm : p.neckScrewHoleMm) / 2 + p.bossWallMm;
    // side ties: where the shell's corner round meets its straight side, and mid-pocket
    var yT0 = Math.min(yS0 + prO, yc - 1.5 * rib);
    var tieBands = [[yT0, yT0 + rib], [yc - rib / 2, yc + rib / 2]];

    // ---- 2D regions (microns). Curves are presplit at every straight
    // cut line so booleans never invent crossing points.
    var SX = [], SY = [yP0, yS0, yT0, yT0 + rib, yc - rib / 2, yc + rib / 2];

    // ---- screw-on top: tab sizes (placed further down, once the braces are known)
    var tScrew = TOP_SCREWS[p.topScrewSize], tabR = clamp(p.tabBossMm, 8, 16) / 2;
    var tabC = tabR + 0.5;                 // hole centre in from the rim's inside face
    var tabDepth = clamp(p.tabDepthMm, 6, 30), tabHole = tabDepth - 1;
    var tabOn = p.screwTop;
    if (tabOn && zShelf - tabDepth - tabC - tabR < p.floorMm + 2) {
      tabDepth = zShelf - tabC - tabR - p.floorMm - 2; tabHole = tabDepth - 1;
      if (tabHole < 6) { warnings.push('The body is too shallow for screw-on top tabs; glue the top instead.'); tabOn = false; }
    }
    var tabBottom = zShelf - tabDepth - Math.ceil((tabC + tabR - 0.2) / STEP) * STEP;

    // ---- ladder braces: straight across the back floor, parabolic
    // profile (highest mid-span), rounded crown, built as 0.5 mm slabs
    // that only ever narrow going up (support-free)
    var bOn = p.ladderBraces, ribsOn = p.neckBlockRibs, profOn = bOn || ribsOn, bw = clamp(p.braceWidthMm, 3, 15), br = bw / 2;
    var bH = Math.min(clamp(p.braceHeightMm, 3, 40), zTaper0 - p.floorMm - 10);
    if (tabOn) bH = Math.min(bH, tabBottom - p.floorMm - 3);
    if (profOn && bH < br + 1.5) { warnings.push('No room for ' + (bOn ? 'ladder braces' : 'the neck block brace') + ' under the shelf; left out.'); bOn = ribsOn = profOn = false; }
    var bEnd = profOn ? clamp(p.braceEndHeightMm, br + 0.5, bH - 0.5) : 0;
    var bs = profOn ? bH / Math.ceil(bH / 0.5 - 1e-9) : 0.5;
    var bTiers = [];                       // crown: half width by depth below the local top
    // neck block brace (the "ribs" option): one brace straight across the
    // body at mid-pocket, the ladder-brace profile over the full width
    var yNB = yc;
    if (profOn) {
      var mT = Math.ceil(br / bs - 1e-9);
      for (var jT = 0; jT < mT; jT++) {
        var tm = Math.min(br, jT * bs + bs / 2);
        bTiers.push({ tau: jT * bs, hw: Math.sqrt(Math.max(0, br * br - (br - tm) * (br - tm))) });
      }
      bTiers.push({ tau: br, hw: br });
    }
    var braceYs = [];
    if (bOn) {
      var listed = String(p.bracePositions || '').split(/[ ,;]+/).map(parseFloat).filter(function (v) { return isFinite(v) && v > 2 && v < 98; });
      if (listed.length) braceYs = listed.map(function (v) { return v / 100 * L; });
      else {
        var nB = Math.max(0, Math.min(8, Math.round(p.braceCount))), yb0 = 0.12 * L, yb1 = yS0 - 12 - br;
        for (var iB = 0; iB < nB; iB++) braceYs.push(yb0 + (iB + 0.5) * (yb1 - yb0) / nB);
      }
      braceYs = braceYs.filter(function (y) { return y - br > p.wallMm + 5 && y + br < yS0 - 3; });
      braceYs.forEach(function (y) { bTiers.forEach(function (t) { SY.push(y - t.hw, y + t.hw); }); });
    }
    if (ribsOn) bTiers.forEach(function (t) { SY.push(yNB - t.hw, yNB + t.hw); });
    var xF = xs + 4 + p.wallMm;             // furthest a gap fill reaches (only where the rim is within 4 mm)
    [ph, xs, rib / 2, xs - rib, xs - 0.5, xF].forEach(function (v) { SX.push(v, -v); });
    SX = SX.map(function (v) { return Math.round(v * S); });
    SY = SY.map(function (v) { return Math.round(v * S); });
    function P(paths) { return presplit(paths, SX, SY); }
    var O0 = toPath(pts);
    if (ClipperLib.Clipper.Area(O0) < 0) O0.reverse();
    var O = P(union([O0]));
    var I = P(offset(O, -p.wallMm));
    if (!I.length) throw new Error('the outline is too small for the wall thickness');
    var nT = Math.max(1, Math.ceil(sw / STEP - 1e-9)), hT = sw / nT, cav = [];
    for (var k = 0; k < nT; k++) cav.push(P(offset(I, -(k + 1) * hT)));

    // pocket outline: straight sides, the inner end's two corners rounded
    // (open through the neck end, so its top runs past the outline)
    function pocketShape(hw, yStart, r) {
      var q = [[-hw, L + 10]], n = 12, i;
      if (r > 0) {
        for (i = 0; i <= n; i++) { var a1 = Math.PI * (1 + 0.5 * i / n); q.push([-hw + r + r * Math.cos(a1), yStart + r + r * Math.sin(a1)]); }
        for (i = 0; i <= n; i++) { var a2 = Math.PI * (1.5 + 0.5 * i / n); q.push([hw - r + r * Math.cos(a2), yStart + r + r * Math.sin(a2)]); }
      } else q.push([-hw, yStart], [hw, yStart]);
      q.push([hw, L + 10]);
      return [toPath(q)];
    }
    var pocket = pocketShape(ph, yP0, pr);
    function pieceAt(paths, x, y) {
      var pt = { X: Math.round(x * S), Y: Math.round(y * S) };
      return paths.filter(function (pp) { return ClipperLib.Clipper.Area(pp) > 0 && ClipperLib.Clipper.PointInPolygon(pt, pp) !== 0; });
    }
    // The neck block is a shell, not a lump: walls tw thick round the
    // pocket (rising from the floor to the shelf, so the top is glued to
    // them; the inner-end wall ew thick), tied into the rim at the neck
    // end, with low ties out to the rim each side. Under the pocket a
    // solid floor plate (pocketFloorMm) carries the neck; below it, ribs
    // and four screw bosses run down to the back floor, and the cells
    // between them close at 45 degrees under the plate (sealed, no supports).
    var shellOuter = inter(pocketShape(xs, yS0, pr > 0 ? pr + tw : 0), O);
    var blockFoot = shellOuter;
    var ties = [], filled = [];
    [-1, 1].forEach(function (sg) {
      // where the rim comes within 4 mm of the shell (the T-Style treble
      // side), fill the gap solid rather than leave a thin slot
      // (measured across the pocket at a quarter and half its length; a
      // rounded neck end closing in at the very end doesn't count)
      var Imm = pathsToMm(I), gap = Infinity;
      [yP0 + pl * 0.25, yc].forEach(function (yy) {
        Imm.forEach(function (pp) {
          for (var i = 0; i < pp.length; i++) {
            var a = pp[i], b = pp[(i + 1) % pp.length];
            if ((a[1] - yy) * (b[1] - yy) > 0 || a[1] === b[1]) continue;
            var x = (a[0] + (yy - a[1]) / (b[1] - a[1]) * (b[0] - a[0])) * sg;
            if (x > xs - 1e-6) gap = Math.min(gap, x - xs);
          }
        });
      });
      if (gap < 4) {
        var fill = pieceAt(inter(rect(Math.min(sg * ph, sg * xF), yS0, Math.max(sg * ph, sg * xF), L + 10), O), sg * (ph + tw / 2), (yS0 + yP0) / 2 + pl / 2);
        blockFoot = union(blockFoot, fill);
        filled.push(sg > 0 ? 'right' : 'left');
        return;
      }
    });
    blockFoot = P(blockFoot);
    // the shell's rounded outer corners can cross the rim and the shelf
    // steps: put the crossing points on both curves
    (function () {
      var m = mutualSplit(I, blockFoot); I = m[0]; blockFoot = m[1];
      for (var q = 0; q < cav.length; q++) { m = mutualSplit(cav[q], blockFoot); cav[q] = m[0]; blockFoot = m[1]; }
    })();
    // ---- keep-outs for braces and tabs: neck block, ties, access ring
    var ringEarly = [];
    if (p.accessPanel) ringEarly = offset([toPath(roundedRect(0, clamp(p.accessPos, 0.1, 0.9) * L, p.accessWidthMm, p.accessLengthMm, p.accessCornerMm, 10))],
      p.coverThicknessMm + p.accessRingMm);
    function inside(paths, x, y) {
      var pt = { X: Math.round(x * S), Y: Math.round(y * S) }, w = 0;
      paths.forEach(function (pp) { if (ClipperLib.Clipper.PointInPolygon(pt, pp) !== 0) w += ClipperLib.Clipper.Area(pp) > 0 ? 1 : -1; });
      return w > 0;
    }
    // x intervals of a horizontal line inside a region (mm paths, even-odd)
    function lineIntervals(pathsMm, y) {
      var xs = [];
      pathsMm.forEach(function (pp) {
        for (var i = 0; i < pp.length; i++) {
          var a = pp[i], b = pp[(i + 1) % pp.length];
          if ((a[1] > y) === (b[1] > y)) continue;
          xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
      });
      xs.sort(function (m, n) { return m - n; });
      var out = [];
      for (var i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
      return out;
    }
    function interIntervals(A, B) {
      var out = [];
      A.forEach(function (a) { B.forEach(function (b) { var lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]); if (hi > lo) out.push([lo, hi]); }); });
      return out;
    }

    // ---- neck block brace: the arc spans the full inside width at yNB
    // (tallest on the centreline, each side tapering to the end height at
    // its own rim); the pocket shell is solid through the middle, so each
    // half meets the shell wall at the height the full arc has there. It
    // stops short of the access ring if that is in the way.
    var neckSegs = [], neckInfo = null, ImmNB = null;
    if (ribsOn) {
      ImmNB = pathsToMm(I);
      var spanNB = lineIntervals(ImmNB, yNB).filter(function (r) { return r[0] < 0 && r[1] > 0; })[0];
      if (spanNB) {
        var KbN = ringEarly.length ? offset(ringEarly, 3) : [], freeN = pathsToMm(diff(I, KbN)), ivN = null;
        for (var qN = 0; qN <= 8; qN++) { var liN = lineIntervals(freeN, yNB - br + bw * qN / 8); ivN = ivN === null ? liN : interIntervals(ivN, liN); }
        // (only the main span through the centreline: not a separate horn)
        var clearN = function (x) { if (!KbN.length) return true; for (var q2 = 0; q2 <= 8; q2++) if (inside(KbN, x, yNB - br + bw * q2 / 8)) return false; return true; };
        (ivN || []).forEach(function (r) {
          if (r[1] - r[0] < 5 || r[1] < spanNB[0] || r[0] > spanNB[1]) return;
          neckSegs.push({ y: yNB, x0: r[0], x1: r[1], rim0: clearN(r[0] - 2), rim1: clearN(r[1] + 2), neck: true, X0: spanNB[0], X1: spanNB[1], rimAt: {} });
        });
        var hAt = function (x) { var a = x < 0 ? -spanNB[0] : spanNB[1], u = Math.min(1, Math.abs(x) / a); return bEnd + (bH - bEnd) * (1 - u * u); };
        neckInfo = { y: yNB, yPct: 100 * yNB / L, spanMm: spanNB[1] - spanNB[0], heightCentreMm: bH, heightAtShellMm: [hAt(-xs), hAt(xs)], endHeightMm: bEnd,
          widthMm: bw, segments: neckSegs.map(function (g) { return { x0: g.x0, x1: g.x1, ends: [g.rim0 ? 'rim' : 'stops short', g.rim1 ? 'rim' : 'stops short'] }; }) };
        if (neckSegs.some(function (g) { return !g.rim0 || !g.rim1; })) warnings.push('The neck block brace stops short of the access panel ring.');
      }
    }

    // ---- ladder braces: segments between the rim and any keep-out
    var braceSegs = [], braceShort = [], braceGone = [];
    if (bOn && braceYs.length) {
      var Kb = offset(union(blockFoot, ties, ringEarly), 3);
      var freeMm = pathsToMm(diff(I, Kb));
      braceYs.forEach(function (yb) {
        var iv = null;
        for (var q = 0; q <= 8; q++) {
          var li = lineIntervals(freeMm, yb - br + bw * q / 8);
          iv = iv === null ? li : interIntervals(iv, li);
        }
        var kept = 0;
        (iv || []).forEach(function (r) {
          if (r[1] - r[0] < 30) { braceShort.push({ y: yb, lengthMm: r[1] - r[0] }); return; }
          kept++;
          // an end is at the rim unless a keep-out (neck block, ties, access
          // ring) is just past it anywhere across the brace's width
          function clearOfKeep(x) { for (var q2 = 0; q2 <= 8; q2++) if (inside(Kb, x, yb - br + bw * q2 / 8)) return false; return true; }
          braceSegs.push({ y: yb, x0: r[0], x1: r[1], rim0: clearOfKeep(r[0] - 2), rim1: clearOfKeep(r[1] + 2) });
        });
        if (!kept) braceGone.push(yb);
      });
      braceYs = braceYs.filter(function (y) { return braceGone.indexOf(y) < 0; });
    }

    // ---- fit check: is the body wide enough for the neck block, the
    // braces and the access panel? (clearances in mm, for the readout)
    var fit = (function () {
      var Imm0 = pathsToMm(I);
      function widthAt(y) { var iv = lineIntervals(Imm0, y), w = 0; iv.forEach(function (r) { w = Math.max(w, r[1] - r[0]); }); return { w: w, iv: iv }; }
      var atBlock = widthAt(yc), f = { innerWidthMm: widthAt(L * 0.5).w, blockWidthMm: 2 * xs, blockSideClearMm: null, access: null, bracesDropped: [], bracesShort: braceShort.slice() };
      atBlock.iv.forEach(function (r) { if (r[0] < -xs && r[1] > xs) f.blockSideClearMm = Math.min(-xs - r[0], r[1] - xs); });
      if (p.accessPanel) {
        var cyA = clamp(p.accessPos, 0.1, 0.9) * L, ringHalfW = p.accessWidthMm / 2 + p.coverThicknessMm + p.accessRingMm;
        var ringHalfL = p.accessLengthMm / 2 + p.coverThicknessMm + p.accessRingMm, wA = widthAt(cyA).w;
        f.access = { ringWidthMm: 2 * ringHalfW, innerWidthMm: wA, sideClearMm: (wA - 2 * ringHalfW) / 2,
          y0Pct: 100 * (cyA - ringHalfL - 3 - br) / L, y1Pct: 100 * (cyA + ringHalfL + 3 + br) / L,
          maxOpeningForBracesMm: wA - 2 * (30 + 3 + p.coverThicknessMm + p.accessRingMm) };
      }
      f.bracesDropped = braceGone.map(function (y) { return { y: y, pct: 100 * y / L }; });
      return f;
    })();
    if (fit.bracesDropped.length) {
      var why = fit.access ? 'beside the access panel ring (' + fit.access.ringWidthMm.toFixed(0) + ' mm wide in a ' + fit.access.innerWidthMm.toFixed(1) + ' mm wide inside) there is only ' +
        fit.access.sideClearMm.toFixed(1) + ' mm to the rim each side, and a brace needs about 33 mm (30 mm of brace + 3 mm clearance)' : 'the neck block and its ties leave no 30 mm run to the rim';
      warnings.push('Fit check: ' + fit.bracesDropped.length + ' ladder brace' + (fit.bracesDropped.length > 1 ? 's' : '') + ' (at ' + fit.bracesDropped.map(function (b) { return b.pct.toFixed(0) + '%'; }).join(', ') +
        ' of the length) left out: ' + why + '. Options: ' + (fit.access ? (fit.access.maxOpeningForBracesMm >= 30 ? 'an access opening no wider than ' + Math.floor(fit.access.maxOpeningForBracesMm) + ' mm, ' : '') +
        'list brace positions outside ' + Math.max(0, fit.access.y0Pct).toFixed(0) + '–' + Math.min(100, fit.access.y1Pct).toFixed(0) + '% (the ring), move the opening, or turn the access panel off.' : 'move the braces towards the tail.'));
    }
    // brace footprint at height d above the floor
    function braceAt(d, segs) {
      var parts = [];
      (segs || braceSegs).forEach(function (g) {
        var xm = (g.x0 + g.x1) / 2, a = (g.x1 - g.x0) / 2;
        bTiers.forEach(function (t) {
          var q = d + t.tau, x0, x1;
          if (q > bH) return;
          if (q <= bEnd) { x0 = g.rim0 ? g.x0 - 20 : g.x0; x1 = g.rim1 ? g.x1 + 20 : g.x1; }
          else if (g.neck) {
            var fq = Math.sqrt(Math.max(0, 1 - (q - bEnd) / (bH - bEnd)));
            // the inside face across this tier's band (narrower edge), so a
            // tier end either stays clear of the rim or runs into it
            var rl = g.rimAt[t.hw] || (g.rimAt[t.hw] = (function () {
              var lo = -Infinity, hi = Infinity;
              [g.y - t.hw, g.y + t.hw].forEach(function (yy) {
                lineIntervals(ImmNB, yy).forEach(function (r) { if (r[0] < 0 && r[1] > 0) { lo = Math.max(lo, r[0]); hi = Math.min(hi, r[1]); } });
              });
              return [lo, hi];
            })());
            x0 = g.X0 * fq; x1 = g.X1 * fq;
            x0 = g.rim0 && x0 < rl[0] + 0.3 ? rl[0] - 20 : Math.max(g.x0, x0);
            x1 = g.rim1 && x1 > rl[1] - 0.3 ? rl[1] + 20 : Math.min(g.x1, x1);
            if (x1 - x0 < 0.3) return;
          }
          else { var X = a * Math.sqrt(Math.max(0, 1 - (q - bEnd) / (bH - bEnd))); if (X < 0.3) return; x0 = xm - X; x1 = xm + X; }
          parts = parts.concat(rect(x0, g.y - t.hw, x1, g.y + t.hw));
        });
      });
      return parts.length ? inter(union(parts), I) : [];
    }

    if (neckSegs.length) ties = braceAt(bs / 2, neckSegs);   // the neck brace's footprint (keep-outs, volumes)

    // ---- screw-on top: tabs round the rim, under the glue shelf
    var tabs = [], tabShapes = [];
    var nTaperAll = Math.max(1, Math.ceil((tabC + tabR - 0.2) / STEP)); // the last level reaches <= 0.2 mm past the rim face
    if (tabOn) {
      var Imain = pathsToMm(I).filter(function (pp) { var a = 0; for (var i = 0; i < pp.length; i++) { var u = pp[i], v = pp[(i + 1) % pp.length]; a += u[0] * v[1] - v[0] * u[1]; } return a > 0; })
        .sort(function (m, n) { return n.length - m.length; })[0];
      var keep = [].concat(blockFoot, ties, ringEarly);
      braceSegs.concat(neckSegs).forEach(function (g) { keep = keep.concat(rect(g.x0 - 25, g.y - br, g.x1 + 25, g.y + br)); });
      var Kt = offset(union(keep), 2);
      // arc-length samples of the rim's inside face
      var cum = [0];
      for (var i = 1; i <= Imain.length; i++) { var u = Imain[i - 1], v = Imain[i % Imain.length]; cum.push(cum[i - 1] + Math.hypot(v[0] - u[0], v[1] - u[1])); }
      var per = cum[Imain.length];
      function at(sv) {
        sv = ((sv % per) + per) % per;
        var j = 0; while (j + 1 < cum.length && cum[j + 1] < sv) j++;
        var u = Imain[j], v = Imain[(j + 1) % Imain.length], f = (sv - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
        return [u[0] + (v[0] - u[0]) * f, u[1] + (v[1] - u[1]) * f];
      }
      // tab at arc length sv, in the rim's local frame (t along the
      // inside face, n in from it): a pad from inside the wall to a round
      // end round the hole. Its vertices sit at the trim distances
      // n_k = tabC + tabR - k * STEP, so trimming it for the 45-degree
      // underside (level k keeps n <= n_k) reuses exactly the same points
      // at every level (no booleans, no rounding differences).
      function tabShape(sv, k) {
        var F = at(sv), A = at(sv - 4), B2 = at(sv + 4), tx = B2[0] - A[0], ty = B2[1] - A[1], tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        var nx = -ty, ny = tx, E = Math.min(1.5, p.wallMm / 2), R = tabR;
        var C = [F[0] + tabC * nx, F[1] + tabC * ny];
        var ns = [];
        for (var j = nTaperAll; j >= 0; j--) { var nv = tabC + R - j * STEP; if (nv > -E + 0.2) ns.push(nv); }
        ns = ns.filter(function (nv) { return nv <= tabC + R - k * STEP + 1e-9; });
        function w(nv) { return nv <= tabC ? R : Math.sqrt(Math.max(0, R * R - (nv - tabC) * (nv - tabC))); }
        function pt(nv, tv) { return [F[0] + nv * nx + tv * tx, F[1] + nv * ny + tv * ty]; }
        var q = [pt(-E, -R), pt(-E, R)];
        ns.forEach(function (nv) { q.push(pt(nv, w(nv))); });
        for (var i = ns.length - 1; i >= 0; i--) if (w(ns[i]) > 1e-9) q.push(pt(ns[i], -w(ns[i])));
        var rp = toPath(q); if (ClipperLib.Clipper.Area(rp) < 0) rp.reverse();
        return { C: C, reg: [rp] };
      }
      function okAt(sv) {
        var t0 = tabShape(sv, 0);
        if (areaMm2(inter(t0.reg, Kt)) > 0.01) return null;
        if (areaMm2(diff(t0.reg, offset(O, -0.3))) > 0.01) return null;
        if (areaMm2(diff(circle(t0.C[0], t0.C[1], tabR + 0.3, 32), I)) > 0.01) return null;
        // its lowest level must sit on the rim wall (a tight curve can leave it hanging)
        if (areaMm2(diff(tabShape(sv, nTaperAll).reg, ringGrown)) > 0.005) return null;
        return t0;
      }
      var ringGrown = offset(diff(O, I), STEP - 0.05);
      var nTab = Math.round(p.topScrewCount) > 0 ? Math.min(24, Math.round(p.topScrewCount)) : clamp(Math.round(per / 110), 6, 10);
      var stepS = 2, valid = [];
      for (var sv = 0; sv < per; sv += stepS) valid.push(okAt(sv) ? sv : null);
      var best = null;
      for (var off = 0; off < per / nTab; off += per / nTab / 24) {
        var pick = [], cost = 0;
        for (var k2 = 0; k2 < nTab; k2++) {
          var target = off + k2 * per / nTab, got = null;
          for (var dlt = 0; dlt <= per / nTab / 2 && got === null; dlt += stepS) {
            [target + dlt, target - dlt].forEach(function (cand) {
              if (got !== null) return;
              var ci = Math.round((((cand % per) + per) % per) / stepS) % valid.length;
              if (valid[ci] !== null && pick.every(function (q) { var dd = Math.abs(q - valid[ci]); return Math.min(dd, per - dd) > 2 * tabR + 12; })) got = valid[ci];
            });
            cost += 1;
          }
          if (got !== null) pick.push(got); else cost += 1000;
        }
        if (!best || pick.length > best.pick.length || (pick.length === best.pick.length && cost < best.cost)) best = { pick: pick, cost: cost };
      }
      tabs = best ? best.pick.sort(function (m, n) { return m - n; }) : [];
      if (tabs.length < nTab) warnings.push('Only ' + tabs.length + ' of ' + nTab + ' top screw tabs fit round the rim (the neck block, braces and access ring are in the way).');
      // one shape per level: full size, then reaching 0.4 mm less far in
      // from the rim each step down (45 degrees); tabs are spaced apart,
      // so each level is just their paths side by side
      var nTaper = nTaperAll, tabSv = tabs;
      for (var kk = 0; kk <= nTaper; kk++) {
        var regs = [];
        tabSv.forEach(function (sv) { regs = regs.concat(tabShape(sv, kk).reg); });
        tabShapes.push(regs);
      }
      tabs = tabSv.map(function (sv) { var c = tabShape(sv, 0).C; return { s: sv, x: c[0], y: c[1] }; });
      // the tabs cross the rim's inside face and the shelf steps: split
      // all levels in one go, so the shared edges get the same points
      var allT = [].concat.apply([], tabShapes), m2 = mutualSplit(I, allT);
      I = m2[0]; allT = m2[1];
      for (var q2 = 0; q2 < cav.length; q2++) { m2 = mutualSplit(cav[q2], allT); cav[q2] = m2[0]; allT = m2[1]; }
      var at0 = 0;
      tabShapes = tabShapes.map(function (ts) { var r = allT.slice(at0, at0 + ts.length); at0 += ts.length; return r; });
    }

    // cells under the pocket floor plate
    var U = inter(pocket, I);
    var bosses = [];
    holes.forEach(function (h) { bosses = bosses.concat(circle(h[0], h[1], bossR, 48)); });
    var ribsU = union(rect(-rib / 2, yP0 - 1, rib / 2, L + 10), rect(-ph - 1, yc - rib / 2, ph + 1, yc + rib / 2));
    // (opened by 10 microns so no band is left pinched to a zero-width neck)
    function opened(r, d) { return offset(offset(r, -d - 0.01), 0.01); }
    var V0 = opened(diff(U, union(ribsU, bosses)), 0);
    var cellBands = [V0];
    for (k = 1; k < 400; k++) { var vk = opened(V0, k * STEP); if (!vk.length || areaMm2(vk) < 0.01) break; cellBands.push(vk); }
    var zCellTop = zF - p.pocketFloorMm, zR0 = zCellTop - (cellBands.length) * STEP;
    var cellsOn = V0.length > 0 && zR0 >= p.floorMm + 2;

    // screw holes / wells: their circles may cross the outline or block
    // edges (a short pocket near a rounded neck end): split both
    var holeR = [], wellR = [];
    holes.forEach(function (h) {
      holeR = holeR.concat(circle(h[0], h[1], hr, 24));
      if (wells) wellR = wellR.concat(circle(h[0], h[1], p.wellDiameterMm / 2, 48));
    });
    function splitWith(cir) {
      if (!cir.length) return cir;
      var m;
      m = mutualSplit(O, cir); O = m[0]; cir = m[1];
      m = mutualSplit(I, cir); I = m[0]; cir = m[1];
      m = mutualSplit(blockFoot, cir); blockFoot = m[0]; cir = m[1];
      m = mutualSplit(pocket, cir); pocket = m[0]; cir = m[1];
      for (var q = 0; q < cav.length; q++) { m = mutualSplit(cav[q], cir); cav[q] = m[0]; cir = m[1]; }
      return cir;
    }
    holeR = splitWith(holeR);
    wellR = splitWith(wellR);
    holeR = splitWith(holeR); // pick up points the wells added
    if (areaMm2(diff(wells ? wellR : holeR, O)) > 0.05) warnings.push('The neck screw ' + (wells ? 'wells' : 'holes') + ' break out through the neck end; move them in (hole spacing along the neck).');
    if (Math.abs(areaMm2(inter(rect(-ph, yP0, ph, L + 10), O)) - 2 * ph * Math.min(pl, L)) > 0.02 * 2 * ph * pl + 1) {
      warnings.push('The neck pocket is wider than the neck end of this outline; it breaks out through the sides.');
    }

    var solids = [], voids = [];
    function S_(z0, z1, reg) { if (z1 - z0 > 1e-6 && reg.length) solids.push({ z0: z0, z1: z1, reg: reg }); }
    function V_(z0, z1, reg) { if (z1 - z0 > 1e-6 && reg.length) voids.push({ z0: z0, z1: z1, reg: reg }); }
    var ring = diff(O, I);
    S_(0, p.floorMm, O);                                   // back floor
    S_(p.floorMm, zTaper0, ring);                          // plain wall
    for (k = 0; k < nT; k++) S_(zTaper0 + k * hT, zTaper0 + (k + 1) * hT, diff(O, cav[k])); // 45-degree taper
    S_(zShelf - lip, zShelf, diff(O, cav[nT - 1]));        // shelf's straight edge, glue surface on top
    S_(zShelf, D, ring);                                   // wall round the top panel
    S_(0, zShelf, blockFoot);                              // neck block shell
    var allSegs = braceSegs.concat(neckSegs);
    var nBL = profOn ? Math.round(bH / bs) : 0;
    for (k = 0; k < nBL && allSegs.length; k++) S_(p.floorMm + k * bs, p.floorMm + (k + 1) * bs, braceAt((k + 0.5) * bs, allSegs));
    if (tabOn && tabs.length) {
      S_(zShelf - tabDepth, zShelf, tabShapes[0]);
      for (k = 1; k < tabShapes.length; k++) S_(zShelf - tabDepth - k * STEP, zShelf - tabDepth - (k - 1) * STEP, tabShapes[k]);
      var pil = [];
      tabs.forEach(function (tb) { pil = pil.concat(circle(tb.x, tb.y, tScrew.pilotMm / 2, 20)); });
      V_(zShelf - tabHole, D + 1, pil);
    }
    V_(zF, D + 1, pocket);
    if (cellsOn) {
      V_(p.floorMm, zR0, V0);
      for (k = 1; k < cellBands.length; k++) V_(zR0 + (k - 1) * STEP, zR0 + k * STEP, cellBands[k]);
      // last band: the remaining sliver closes at zCellTop
      V_(zR0 + (cellBands.length - 1) * STEP, zCellTop, opened(V0, (cellBands.length - 0.5) * STEP));
    }
    V_(-1, zF, holeR);
    if (wells) V_(-1, zWell, wellR);

    // ---- optional back access opening with a 45-degree tapered recess
    var acc = null, cover = null, coverSt = null;
    if (p.accessPanel) {
      var cw = p.coverThicknessMm, ringTop = Math.max(cw + p.accessRingHeightMm, p.floorMm + 1);
      var cy = clamp(p.accessPos, 0.1, 0.9) * L;
      var opPts = roundedRect(0, cy, p.accessWidthMm, p.accessLengthMm, p.accessCornerMm, 10);
      var Op = [toPath(opPts)];
      var ringOuter = offset(Op, cw + p.accessRingMm);
      var why = null;
      if (areaMm2(diff(ringOuter, offset(I, -1))) > 0.05) why = 'its ring runs into the wall';
      else if (areaMm2(inter(ringOuter, offset(union(blockFoot, ties), 2))) > 0.05) why = 'it runs into the neck block';
      else if (ringTop > zTaper0 - 1) why = 'the body is too shallow for its ring under the shelf';
      if (why) {
        warnings.push('Access opening left out: ' + why + '. Make it smaller or move it (position along the body).');
      } else {
        var nC = Math.max(1, Math.ceil(cw / STEP - 1e-9)), hC = cw / nC;
        // screw circle: about half way across the bevel, nudged so no hole
        // edge grazes a bevel step (that would pinch the mesh)
        var dBest = cw / 2, gapBest = -1;
        for (var dd = cw * 0.35; dd <= cw * 0.65; dd += 0.01) {
          var gap = Infinity;
          for (k = 0; k <= nC; k++) {
            [cw - k * hC, cw - k * hC - p.coverFitMm].forEach(function (o) {
              [p.coverScrewHoleMm / 2, p.coverScrewClearMm / 2].forEach(function (r) {
                gap = Math.min(gap, Math.abs(dd + r - o), Math.abs(dd - r - o));
              });
            });
          }
          if (gap > gapBest + 1e-9) { gapBest = gap; dBest = dd; }
        }
        var mid = pathsToMm(offset(Op, dBest))[0];
        var screwPts = pointsAlong(mid, Math.max(0, Math.round(p.coverScrews)));
        // the screw holes cross the bevel steps: split both at the crossings
        function splitAll(bands, r) {
          var hole = [];
          screwPts.forEach(function (q) { hole = hole.concat(circle(q[0], q[1], r, 16)); });
          bands = bands.map(function (b) { var m = mutualSplit(b, hole); hole = m[1]; return m[0]; });
          bands = bands.map(function (b) { return mutualSplit(b, hole)[0]; });
          return { bands: bands, hole: hole };
        }
        var cone = [];
        for (k = 0; k < nC; k++) cone.push(offset(Op, cw - k * hC));
        var sp = splitAll(cone, p.coverScrewHoleMm / 2);
        S_(0, ringTop, ringOuter);
        V_(-1, ringTop + 1, Op);
        for (k = 0; k < nC; k++) V_(k === 0 ? -1 : k * hC, (k + 1) * hC, sp.bands[k]);
        V_(-1, ringTop + 1, sp.hole);
        // the cover: the same staircase bevel, coverFit smaller all round,
        // printed outer (back) face down: it only narrows going up
        var cBands = [];
        for (k = 0; k < nC; k++) cBands.push(offset(Op, cw - k * hC - p.coverFitMm));
        var cs = splitAll(cBands, p.coverScrewClearMm / 2);
        var cSolids = [], cVoids = [];
        for (k = 0; k < nC; k++) cSolids.push({ z0: k * hC, z1: (k + 1) * hC, reg: cs.bands[k] });
        if (cs.hole.length) cVoids.push({ z0: -1, z1: cw + 1, reg: cs.hole });
        coverSt = stack(cSolids, cVoids);
        coverSt.regions = tidy(coverSt.regions, [], [], 4);
        cover = meshSlabs(coverSt.levels, coverSt.regions);
        var outer = pathsToMm(offset(Op, cw - p.coverFitMm));
        var obx = bbox(offset(Op, cw - p.coverFitMm));
        acc = {
          opening: pathsToMm(Op), openingMm: [p.accessWidthMm, p.accessLengthMm], cornerMm: p.accessCornerMm, centerY: cy,
          recessDepthMm: cw, seatWidthMm: cw, taperDeg: 45, steps: nC, stepMm: hC, ringTop: ringTop, ringWidthMm: p.accessRingMm,
          screws: screwPts.map(function (q) { return { x: q[0], y: q[1] }; }), screwHoleMm: p.coverScrewHoleMm, screwClearMm: p.coverScrewClearMm,
          cover: { thicknessMm: cw, fitMm: p.coverFitMm, outline: outer, topOutline: pathsToMm(offset(Op, hC - p.coverFitMm)),
            sizeMm: [obx[2] - obx[0], obx[3] - obx[1]], thicknessAtScrewsMm: cw - dBest, screwInsetMm: dBest }
        };
      }
    }

    // ---- slabs -> one watertight mesh
    var st = mergeSame(stack(solids, voids));
    var SXs = SX.slice().sort(function (a, b) { return a - b; }), SYs = SY.slice().sort(function (a, b) { return a - b; });
    var regions = tidy(st.regions, SXs, SYs);
    var body = meshSlabs(st.levels, regions);

    // ---- top panel (ply): the rim's inside face less the fit, with the pocket notch
    var topReg = diff(offset(I, -p.topFitMm), pocket);
    // plastic volumes from the slab stack (the neck block: everything
    // inside the rim's inner face, above the back floor, in its footprint)
    var blockZone = inter(union(blockFoot, ties), I), volTot = 0, volBlock = 0;
    for (k = 0; k + 1 < st.levels.length; k++) {
      var dz = (st.levels[k + 1] - st.levels[k]) / S;
      volTot += areaMm2(regions[k]) * dz;
      if (st.levels[k] >= Math.round(p.floorMm * S)) volBlock += areaMm2(inter(regions[k], blockZone)) * dz;
    }
    var tbx = bbox(topReg), obb = bbox(O);
    var glueW = sw - p.topFitMm;

    // ---- neck screws
    var stackMm = wells ? { washerMm: 1.5, blockMm: p.wellFloorMm, biteMm: p.screwBiteMm }
      : { plateMm: p.plateThicknessMm, blockMm: zF, biteMm: p.screwBiteMm };
    var screwMm = (stackMm.washerMm || 0) + (stackMm.plateMm || 0) + stackMm.blockMm + stackMm.biteMm;
    var screwIn = screwLengthIn(screwMm);

    var meta = {
      style: p.style, shape: sh.kind, lengthMm: size[1], widthMm: size[0], depthMm: D, L: L,
      naturalLengthMm: natural[1], naturalWidthMm: natural[0], outlineScale: scale, scaled: scale < 1 - 1e-9,
      bedMm: p.bedMm, bedMarginMm: p.bedMarginMm, bedLimitMm: bedLimit, fitsBed: fitsBed,
      wallMm: p.wallMm, floorMm: p.floorMm,
      shelf: { zTop: zShelf, dropMm: t + al, allowanceMm: al, widthMm: sw, glueWidthMm: glueW, lipMm: lip,
        taperBottomZ: zTaper0, taperHeightMm: sw, taperDeg: 45, steps: nT, stepMm: hT, thicknessAtWallMm: lip + sw },
      topPanel: { outline: pathsToMm(topReg), sizeMm: [tbx[2] - tbx[0], tbx[3] - tbx[1]], thicknessMm: t, z0: zShelf, z1: zShelf + t,
        topSurfaceZ: topSurf, belowRimMm: al, fitMm: p.topFitMm, areaMm2: areaMm2(topReg),
        // for the soundboard: the opening it presses into (the rim's inside
        // face), the glue land on the shelf, and the neck block's top
        opening: pathsToMm(union(I)), blockFootprint: pathsToMm(union(blockFoot)) },
      pocket: { lengthMm: pl, widthMm: 2 * ph, depthMm: pocketDepth, floorZ: zF, y0: yP0, y1: L, cornerRadiusMm: pr, outline: pathsToMm(pocket) },
      neckBlock: { x0: -xs, x1: xs, y0: yS0, y1: L, heightMm: zShelf, footprintMm: [2 * xs, L - yS0], plasticUnderPocketMm: zF,
        pocketWallMm: tw, pocketEndWallMm: ew, ribMm: rib, bossWallMm: p.bossWallMm, bossDiameterMm: 2 * bossR, pocketFloorMm: p.pocketFloorMm,
        ribs: !!neckInfo, neckBrace: neckInfo, filledSides: filled,
        footprintPieces: union(blockFoot, ties).filter(function (pp) { return ClipperLib.Clipper.Area(pp) > 0; }).length,
        cells: cellsOn ? { count: V0.filter(function (pp) { return ClipperLib.Clipper.Area(pp) > 0; }).length, bottomZ: p.floorMm, roofStartZ: zR0, topZ: zCellTop } : null },
      volume: { totalCm3: volTot / 1000, neckBlockCm3: volBlock / 1000 },
      fit: fit,
      braces: bOn && braceSegs.length ? { count: braceYs.length, positionsMm: braceYs, positionsPct: braceYs.map(function (y) { return 100 * y / L; }),
        widthMm: bw, heightMm: bH, endHeightMm: bEnd, crownRadiusMm: br, stepMm: bs, profile: 'parabolic, rounded crown',
        segments: braceSegs.map(function (g) { return { y: g.y, x0: g.x0, x1: g.x1, ends: [g.rim0 ? 'rim' : 'stops short', g.rim1 ? 'rim' : 'stops short'] }; }) } : null,
      screwTop: tabOn && tabs.length ? { count: tabs.length, screws: tabs.map(function (tb) { return { x: tb.x, y: tb.y }; }), size: p.topScrewSize, head: p.topScrewHead,
        pilotMm: tScrew.pilotMm, clearanceMm: tScrew.clearanceMm, headMm: p.topScrewHead === 'flat' ? tScrew.flatHeadMm : tScrew.panHeadMm,
        lengthIn: tScrew.lengthIn, bossMm: 2 * tabR, holeCentreInMm: tabC, holeDepthMm: tabHole, tabDepthMm: tabDepth, tabBottomZ: tabBottom,
        sizes: TOP_SCREWS } : null,
      neckScrews: { holes: holes.map(function (h) { return { x: h[0], y: h[1] }; }), holeMm: p.neckScrewHoleMm, wells: wells,
        wellTopZ: wells ? zWell : null, wellDiameterMm: p.wellDiameterMm, stack: stackMm, lengthMm: screwMm, lengthIn: screwIn,
        note: wells ? 'Washers or ferrules sit at the top of each well, ' + p.wellFloorMm + ' mm of block under the pocket floor.'
          : 'The plate goes on the back face; the screws pass the ' + p.floorMm + ' mm floor and the solid block (' + zF.toFixed(1) + ' mm in all).' },
      access: acc,
      overhang: { stairStepMm: Math.max(hT, acc ? acc.stepMm : 0), bridges: wells ? 'flat round roofs of the ' + p.wellDiameterMm + ' mm screw wells' : 'none' },
      outlineBox: obb,
      triangles: { body: body.length / 9, cover: cover ? cover.length / 9 : 0 }
    };
    return {
      body: body, cover: cover, meta: meta, warnings: warnings,
      slabs: { levels: st.levels, body: regions, coverLevels: coverSt ? coverSt.levels : null, cover: coverSt ? coverSt.regions : null }
    };
  }

  // Is (x, y, z) (mm) inside the printed material? part = 'body' | 'cover'.
  function solidAt(result, part, x, y, z) {
    part = part || 'body';
    var lv = part === 'cover' ? result.slabs.coverLevels : result.slabs.levels, regs = result.slabs[part], zi = z * S, k;
    if (!lv || !regs) return false;
    for (k = 0; k + 1 < lv.length; k++) if (zi >= lv[k] && zi < lv[k + 1]) break; // on a level: the slab above
    if (k + 1 >= lv.length) return false;
    var pt = { X: Math.round(x * S), Y: Math.round(y * S) }, wind = 0;
    regs[k].forEach(function (path) {
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
  function panelSVG(outlineMm, title, marksMm) {
    marksMm = marksMm || [];
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
      (marksMm.length ? '  <path d="' + marksMm.map(function (pp) { return 'M' + pp.map(function (q) { return (q[0] - b[0] + m).toFixed(3) + ' ' + (b[3] - q[1] + m).toFixed(3); }).join(' L') + ' Z'; }).join(' ') + '" fill="none" stroke="#06c" stroke-width="0.2"/>\n' : '') +
      '  <path d="M' + bar + '" fill="none" stroke="#c00" stroke-width="0.4"/>\n' +
      '  <text x="' + m + '" y="' + (h - 8) + '" font-size="4" font-family="sans-serif" fill="#c00">100 mm check bar — ' + (title || '') + ' — ' + (b[2] - b[0]).toFixed(1) + ' × ' + (b[3] - b[1]).toFixed(1) + ' mm</text>\n' +
      '</svg>\n';
  }

  function panelDXF(outlineMm, marksMm) {
    var s = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
    outlineMm.map(function (pp) { return [pp, 'CUT']; }).concat((marksMm || []).map(function (pp) { return [pp, 'ENGRAVE']; })).forEach(function (e) {
      var pp = e[0];
      for (var i = 0; i < pp.length; i++) {
        var a = pp[i], b = pp[(i + 1) % pp.length];
        s.push('0', 'LINE', '8', e[1], '10', a[0].toFixed(4), '20', a[1].toFixed(4), '30', '0', '11', b[0].toFixed(4), '21', b[1].toFixed(4), '31', '0');
      }
    });
    s.push('0', 'ENDSEC', '0', 'EOF');
    return s.join('\n') + '\n';
  }


  var api = {
    IN: IN, DEFAULTS: DEFAULTS, TOP_SCREWS: TOP_SCREWS, STYLES: STYLES, STYLE_KEYS: STYLE_KEYS, STYLE_FIELDS: STYLE_FIELDS,
    STEP_MM: STEP, WALL_MIN_MM: WALL_MIN, FLOOR_MIN_MM: FLOOR_MIN_MM, OUTLINE_KEYS: OUTLINE_KEYS,
    styleParams: styleParams, matchStyle: matchStyle, withDefaults: withDefaults,
    shapeOf: shapeOf, halfWidth: halfWidth, outlinePoints: outlinePoints, tstyleProportions: tstyleProportions, flipZ: flipZ,
    build: build, solidAt: solidAt, panelMesh: panelMesh, panelSVG: panelSVG, panelDXF: panelDXF,
    _meshSlabs: meshSlabs, _toPath: toPath
  };
  if (isNode) module.exports = api;
  else global.BodyBuilder = api;
})(typeof window !== 'undefined' ? window : this);
