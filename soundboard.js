/*
 * soundboard.js — the laser-cut ply top ("soundboard") for the body builder.
 *
 * Takes a body build (BodyBuilder.build(...).meta) and soundboard settings,
 * and returns the top as 2D vector geometry in millimetres:
 *   - the outer cut (presses into the rim above the glue shelf),
 *   - inner cuts (sound holes, screw clearance holes),
 *   - engrave marks (screw head circles, optional plate bolt slots),
 *   - a 100 mm calibration square with a label (its own layer),
 * with laser kerf and press-fit compensation, clearance checks (thin
 * bridges of wood, holes over the glue shelf / neck block / screws), and
 * exact-size SVG (mm, viewBox in mm: 1 unit = 1 mm), DXF (mm) and PDF (1:1).
 *
 * Compensation: the finished outer edge is the rim's inside face plus the
 * press-fit interference; the cut path runs kerf/2 outside that. The notch
 * round the neck pocket is part of the outer path but has no interference
 * (it fits the neck, not the rim): kerf/2 only. Inner cuts run kerf/2
 * inside the finished hole. So the finished part comes out true to size.
 *
 * Coordinates as the body: x across, y along (tail 0, neck end L). Files
 * are drawn neck up.
 *
 * Pure math, no DOM: window.SoundBoard in the browser, module.exports in
 * Node.
 */
(function (global) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var ClipperLib = isNode ? require('./vendor/clipper.js') : global.ClipperLib;
  var IN = 25.4, S = 1000;

  // Wood narrower than this between two cuts (or between a hole and a
  // screw head / the glue land) is flagged: about twice the 1/8" ply.
  var MIN_BRIDGE_MM = 6;
  // Holes keep this much clear of the glue shelf's inner edge and of the
  // neck block's top (where the top is glued).
  var GLUE_MARGIN_MM = 3;

  var DEFAULTS = {
    soundHole: 'round',      // see HOLE_STYLES
    fVariant: 'classic',     // f-hole variant: classic | violin | ornamental
    holeSizeMm: 0,           // main size (diameter / length); 0 = automatic for the body
    holeXMm: null,           // centre across the body (mm from the centreline); null = automatic
    holeYPct: 0,             // centre along the body (% of the length from the tail); 0 = automatic
    holeCount: 0,            // ports / rays / petals / slashes; 0 = automatic
    holeSpacingMm: 0,        // between the two f-holes, or between ports; 0 = automatic
    holeAngleDeg: null,      // tilt; null = automatic
    kerfMm: 0.18,            // laser kerf (cut width), CO2 on 1/8" ply: about 0.15-0.2
    pressFitMm: 0.05,        // interference per side at the rim (finished top this much bigger)
    pickup: 'none',          // none | single | humbucker | mini | custom (see PICKUPS)
    pickupCount: 1,          // 1-3, side by side along the body
    pickupYPct: 0,           // centre of the group, % of the length from the tail; 0 = automatic
    pickupXMm: 0,            // across, mm from the centreline
    pickupSpacingMm: 0,      // centre to centre; 0 = automatic (cutout width + 22 mm)
    pickupAngleDeg: 0,       // slant (e.g. a slanted bridge pickup)
    pickupLengthMm: 70,      // custom rectangle: across the strings
    pickupWidthMm: 30,       // custom rectangle: along the strings
    pickupCornerMm: 3,       // custom rectangle: corner radius
    pickupScrews: false,     // mounting-screw holes (clearance) at both ends of each cutout
    calibration: true,       // 100 mm square + label layer
    plateMarks: false        // the four license-plate bolt slots, engraved
  };

  var HOLE_STYLES = [
    ['none', 'None'],
    ['round', 'Round'],
    ['f-single', 'Single f-hole'],
    ['f-double', 'Two f-holes'],
    ['slash', 'Slash (cat\u2019s-eye)'],
    ['starburst', 'Starburst cluster'],
    ['ports', 'Small ports'],
    ['rosette', 'Filigree rosette'],
    ['crescent', 'Crescent'],
    ['wave', 'Wave slot']
  ];
  var F_VARIANTS = [['classic', 'Classic (electric)'], ['violin', 'Violin'], ['ornamental', 'Ornamental']];

  // Pickup cutouts in the top (length across the strings x width along
  // them, corner radius), typical routes / ring openings; depth = what a
  // typical pickup of the kind needs below the top surface.
  var PICKUPS = {
    single: { label: 'Single-coil style', lengthMm: 85, widthMm: 19, cornerMm: 6, depthMm: 18, screwMm: 3.0 },
    humbucker: { label: 'Humbucker style', lengthMm: 71, widthMm: 39, cornerMm: 3, depthMm: 20, screwMm: 3.0 },
    mini: { label: 'Mini-humbucker / lipstick style', lengthMm: 68, widthMm: 28, cornerMm: 5, depthMm: 16, screwMm: 3.0 },
    custom: { label: 'Custom rectangle', lengthMm: 70, widthMm: 30, cornerMm: 3, depthMm: 18, screwMm: 3.0 }
  };

  // US passenger plate (SAE J686): bolt holes 7" apart along the 12" side,
  // 4 3/4" apart along the 6" side, slots 1/2" x 0.28" (long way along
  // the 12" side). On the body the 12" side is the length (y).
  var PLATE = { spanAlongMm: 7 * IN, spanAcrossMm: 4.75 * IN, slotLongMm: 0.5 * IN, slotShortMm: 0.28 * IN };

  // ------------------------------------------------------------------
  // Clipper helpers (mm in, mm out)
  // ------------------------------------------------------------------
  function P(pts) { return pts.map(function (q) { return { X: Math.round(q[0] * S), Y: Math.round(q[1] * S) }; }); }
  function M(paths) { return paths.map(function (p) { return p.map(function (q) { return [q.X / S, q.Y / S]; }); }); }
  function op(type, a, b) {
    var c = new ClipperLib.Clipper();
    if (a.length) c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
    if (b && b.length) c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
    var out = new ClipperLib.Paths();
    c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return out.filter(function (p) { return p.length >= 3 && Math.abs(ClipperLib.Clipper.Area(p)) > 0.0005 * S * S; });
  }
  function union(a) { return op(ClipperLib.ClipType.ctUnion, a, []); }
  function diff(a, b) { return op(ClipperLib.ClipType.ctDifference, a, b); }
  function inter(a, b) { return op(ClipperLib.ClipType.ctIntersection, a, b); }
  function grow(paths, d) {
    if (!paths.length || Math.abs(d) < 1e-9) return paths.slice();
    var co = new ClipperLib.ClipperOffset(2, 0.01 * S);
    co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    var out = new ClipperLib.Paths();
    co.Execute(out, d * S);
    return union(out);
  }
  // a thick open stroke along a polyline (round ends)
  function stroke(pts, w) {
    var co = new ClipperLib.ClipperOffset(2, 0.01 * S);
    co.AddPath(P(pts), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound);
    var out = new ClipperLib.Paths();
    co.Execute(out, w / 2 * S);
    return union(out);
  }
  function ccw(paths) { return paths.map(function (p) { return ClipperLib.Clipper.Area(p) < 0 ? p.slice().reverse() : p; }); }
  function area(paths) { var a = 0; paths.forEach(function (p) { a += ClipperLib.Clipper.Area(p); }); return a / (S * S); }
  function circ(cx, cy, r, n) {
    n = n || Math.max(40, Math.min(120, Math.round(r * 5)));
    var pts = [];
    for (var i = 0; i < n; i++) { var a = 2 * Math.PI * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return P(pts);
  }
  // pointed lens (cat's-eye) along x, centred on the origin
  function lensPts(len, wid, n) {   // counter-clockwise
    n = n || 36;
    var top = [], bot = [];
    for (var i = 0; i <= n; i++) {
      var t = -1 + 2 * i / n, h = wid / 2 * Math.pow(Math.max(0, 1 - t * t), 0.85);
      top.push([t * len / 2, h]); if (i > 0 && i < n) bot.unshift([t * len / 2, -h]);
    }
    return top.concat(bot).reverse();
  }
  // stadium (slot) along y
  function slotPts(cx, cy, along, across) {
    var r = across / 2, h = along / 2 - r, pts = [], i;
    for (i = 0; i <= 12; i++) { var a = Math.PI * i / 12; pts.push([cx + r * Math.cos(a), cy + h + r * Math.sin(a)]); }
    for (i = 0; i <= 12; i++) { var b = Math.PI + Math.PI * i / 12; pts.push([cx + r * Math.cos(b), cy - h + r * Math.sin(b)]); }
    return pts;
  }
  function rrectPts(len, wid, r) {   // centred, length along x, counter-clockwise
    r = Math.max(0, Math.min(r, len / 2 - 0.01, wid / 2 - 0.01));
    var pts = [], c = [[len / 2 - r, -wid / 2 + r, -90], [len / 2 - r, wid / 2 - r, 0], [-len / 2 + r, wid / 2 - r, 90], [-len / 2 + r, -wid / 2 + r, 180]];
    c.forEach(function (q) { for (var i = 0; i <= 10; i++) { var a = (q[2] + 9 * i) * Math.PI / 180; pts.push([q[0] + r * Math.cos(a), q[1] + r * Math.sin(a)]); } });
    return pts;
  }
  function xform(pts, cx, cy, deg, mirror) {
    var a = (deg || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var out = pts.map(function (q) { var x = mirror ? -q[0] : q[0], y = q[1]; return [cx + x * c - y * s, cy + x * s + y * c]; });
    if (mirror) out.reverse();
    return out;
  }
  function T(paths, cx, cy, deg, mirror) { return paths.map(function (p) { return P(xform(M([p])[0], cx, cy, deg, mirror)); }); }

  // ------------------------------------------------------------------
  // Sound-hole shapes, local coordinates (mm), centred on the origin
  // ------------------------------------------------------------------
  // f-hole: length along y. A stem along an S curve, an eye at each end
  // (the lower one bigger), variants differ in stem, eyes and nicks.
  function fHole(variant, len) {
    var v = { classic: { w: 0.085, r1: 0.075, r2: 0.09, amp: 0.085, nick: false, tear: false },
      violin: { w: 0.055, r1: 0.075, r2: 0.09, amp: 0.10, nick: true, tear: false },
      ornamental: { w: 0.065, r1: 0.07, r2: 0.085, amp: 0.11, nick: true, tear: true } }[variant] || null;
    if (!v) v = { w: 0.085, r1: 0.075, r2: 0.09, amp: 0.085, nick: false, tear: false };
    var w = Math.max(4, v.w * len), r1 = Math.max(w * 0.75, v.r1 * len), r2 = Math.max(w * 0.85, v.r2 * len), A = v.amp * len;
    var y0 = -len / 2 + r2, y1 = len / 2 - r1, pts = [];
    for (var i = 0; i <= 48; i++) { var s = -1 + 2 * i / 48; pts.push([A * Math.sin(Math.PI * s) * 0.5, (y0 + y1) / 2 + s * (y1 - y0) / 2]); }
    var parts = stroke(pts, w);
    // the eyes curl off the ends of the stem
    var e1 = [pts[48][0] + r1 * 0.55, y1], e2 = [pts[0][0] - r2 * 0.55, y0];
    parts = parts.concat([circ(e1[0], e1[1], r1, 48)], [circ(e2[0], e2[1], r2, 48)]);
    if (v.tear) { // ornamental: each eye trails a pointed tail, a diamond at the waist
      [[e1, r1, -60], [e2, r2, 120]].forEach(function (e) {
        var tl = 2.4 * e[1], c = Math.cos(e[2] * Math.PI / 180), sn = Math.sin(e[2] * Math.PI / 180), dc = e[1] * 0.55 + tl * 0.4;
        parts.push(P(xform(lensPts(tl, 0.9 * e[1]), e[0][0] + dc * c, e[0][1] + dc * sn, e[2])));
      });
      parts = parts.concat([P(xform(lensPts(w * 3.2, w * 1.7), 0, (y0 + y1) / 2, 0))]);
    }
    if (v.nick) { // the two little notches at the middle of the stem
      var nl = w * 0.9, nw = Math.max(1.6, w * 0.28), ym = (y0 + y1) / 2;
      parts = parts.concat([P([[-w / 2 - nl, ym - nw / 2], [w / 2 + nl, ym - nw / 2], [w / 2 + nl, ym + nw / 2], [-w / 2 - nl, ym + nw / 2]])]);
    }
    var out = union(ccw(parts));
    if (v.tear) { // two small dots either side of the waist diamond, a full bridge away
      var d = Math.max(3.5, w * 0.6), xd = w * 1.6 + MIN_BRIDGE_MM + 1.5 + d / 2, ymid = (y0 + y1) / 2;
      out = out.concat([circ(-xd, ymid, d / 2, 32)], [circ(xd, ymid, d / 2, 32)]);
    }
    return out;
  }

  // one design -> hole paths in body coordinates, plus the parameters used
  function holes(o, ctx) {
    var st = o.soundHole, L = ctx.L, Y = o.holeYPct > 0 ? o.holeYPct / 100 * L : null;
    var used = { style: st };
    function W(y) { return ctx.widthAt(y); }
    function num(v, d) { return v === null || v === undefined || v === '' || !isFinite(Number(v)) ? d : Number(v); }
    var size, cx, cy, ang, n, sp, out = [];
    var roundSize = Math.max(28, Math.min(90, 0.32 * ctx.maxWidth));
    function centreRound(sz) { var y = ctx.blockY0 - sz / 2 - 18; return y; }
    if (st === 'none') return { paths: [], used: used };
    if (st === 'round' || st === 'rosette' || st === 'starburst' || st === 'crescent') {
      size = o.holeSizeMm > 0 ? o.holeSizeMm : (st === 'round' ? roundSize : st === 'crescent' ? roundSize * 1.05 : Math.max(70, roundSize * 1.2));
      cy = Y !== null ? Y : centreRound(size);
      cx = num(o.holeXMm, 0); ang = num(o.holeAngleDeg, st === 'crescent' ? 90 : 0);
      if (st === 'round') out = [circ(cx, cy, size / 2)];
      if (st === 'crescent') {
        var R = size / 2, k = [circ(0, 0, R)], bite = [circ(R * 0.38, 0, R * 0.86)];
        out = T(diff(k, bite), cx, cy, ang);
      }
      if (st === 'starburst') {
        n = o.holeCount > 0 ? Math.round(o.holeCount) : 8;
        var r0 = size * 0.17, rl = size * 0.30, rw = Math.max(5, size * 0.085), gap = Math.max(MIN_BRIDGE_MM + 1, size * 0.08);
        out = [circ(cx, cy, r0)];
        for (var i = 0; i < n; i++) {
          var a = ang + 360 * i / n;
          out = out.concat([P(xform(lensPts(rl, rw), 0, 0, 0).map(function (q) { return [q[0] + r0 + gap + rl / 2, q[1]]; }))].map(function (p) { return P(xform(M([p])[0], cx, cy, a)); }));
        }
        n = n; used.count = n;
      }
      if (st === 'rosette') {
        // from the outside in: a ring of small dots, a ring of petals, a
        // centre hole, with MIN_BRIDGE + 1 mm of wood between the rings
        var g = MIN_BRIDGE_MM + 1, Ro = size / 2, dd = Math.max(3.5, size * 0.05), pl = Math.max(6, size * 0.14), pw = Math.max(4, size * 0.07);
        var rdot = Ro - dd / 2, pOut = rdot - dd / 2 - g, c0 = Math.max(3, pOut - pl - g);
        n = o.holeCount > 0 ? Math.round(o.holeCount) : Math.max(6, Math.min(16, Math.floor(2 * Math.PI * rdot / (dd + 2 * g)), Math.floor(2 * Math.PI * (pOut - pl / 2) / (pw + g + 1))));
        out = [circ(cx, cy, c0)];
        for (var j = 0; j < n; j++) {
          var aj = ang + 360 * j / n;
          out.push(P(xform(lensPts(pl, pw).map(function (q) { return [q[0] + pOut - pl / 2, q[1]]; }), cx, cy, aj)));
          var ad = (aj + 180 / n) * Math.PI / 180;
          out.push(circ(cx + rdot * Math.cos(ad), cy + rdot * Math.sin(ad), dd / 2));
        }
        used.count = n;
      }
    } else if (st === 'f-single' || st === 'f-double') {
      size = o.holeSizeMm > 0 ? o.holeSizeMm : Math.max(60, Math.min(150, 0.36 * L));
      cy = Y !== null ? Y : 0.42 * L;
      ang = num(o.holeAngleDeg, 0);
      var f = fHole(o.fVariant, size);
      if (st === 'f-single') {
        cx = num(o.holeXMm, -0.25 * W(cy));
        out = T(f, cx, cy, ang);
      } else {
        sp = o.holeSpacingMm > 0 ? o.holeSpacingMm : 0.5 * W(cy);
        cx = num(o.holeXMm, 0);
        out = T(f, cx - sp / 2, cy, ang, false).concat(T(f, cx + sp / 2, cy, -ang, true));
        used.spacingMm = sp;
      }
      used.variant = o.fVariant;
    } else if (st === 'slash') {
      size = o.holeSizeMm > 0 ? o.holeSizeMm : Math.max(45, Math.min(120, 0.3 * L));
      cy = Y !== null ? Y : 0.58 * L;
      ang = num(o.holeAngleDeg, 60);
      n = o.holeCount > 0 ? Math.min(2, Math.round(o.holeCount)) : 1;
      cx = num(o.holeXMm, n === 2 ? 0 : -0.24 * W(cy));
      var ln = [P(lensPts(size, Math.max(8, size * 0.2)))];
      if (n === 1) out = T(ln, cx, cy, ang);
      else { sp = o.holeSpacingMm > 0 ? o.holeSpacingMm : 0.5 * W(cy); out = T(ln, cx - sp / 2, cy, ang).concat(T(ln, cx + sp / 2, cy, 180 - ang)); used.spacingMm = sp; }
      used.count = n;
    } else if (st === 'ports') {
      size = o.holeSizeMm > 0 ? o.holeSizeMm : 12;
      n = o.holeCount > 0 ? Math.round(o.holeCount) : 5;
      sp = o.holeSpacingMm > 0 ? o.holeSpacingMm : size + 9;
      cy = Y !== null ? Y : 0.6 * L;
      cx = num(o.holeXMm, -0.24 * W(cy));
      ang = num(o.holeAngleDeg, 90);
      // on a gentle arc
      var Rarc = Math.max(3 * n * sp / Math.PI, 80);
      for (var q = 0; q < n; q++) {
        var t = (q - (n - 1) / 2) * sp, th = t / Rarc;
        var lx = Rarc * Math.sin(th), ly = Rarc * (1 - Math.cos(th));
        var pp = xform([[lx, ly]], cx, cy, ang)[0];
        out.push(circ(pp[0], pp[1], size / 2));
      }
      used.count = n; used.spacingMm = sp;
    } else if (st === 'wave') {
      size = o.holeSizeMm > 0 ? o.holeSizeMm : Math.max(50, Math.min(130, 0.34 * L));
      cy = Y !== null ? Y : 0.5 * L;
      cx = num(o.holeXMm, -0.24 * W(cy));
      ang = num(o.holeAngleDeg, 90);
      var ww = Math.max(6, size * 0.08), amp = size * 0.09, pts = [];
      for (var m = 0; m <= 80; m++) { var s = -1 + 2 * m / 80; pts.push([s * (size / 2 - ww / 2), amp * Math.sin(Math.PI * 1.5 * (s + 1))]); }
      out = T(stroke(pts, ww), cx, cy, ang);
    }
    used.sizeMm = size; used.x = cx; used.y = cy; used.yPct = 100 * cy / L; used.angleDeg = ang;
    return { paths: union(ccw(out)), used: used };
  }

  // ------------------------------------------------------------------
  // distances (mm) between two sets of paths: min over vertex-segment
  // ------------------------------------------------------------------
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    var x = ax + t * dx - px, y = ay + t * dy - py;
    return Math.sqrt(x * x + y * y);
  }
  function minDist(A, B) {
    var best = { d: Infinity, at: null };
    function one(X, Y) {
      X.forEach(function (pa) {
        pa.forEach(function (q) {
          Y.forEach(function (pb) {
            for (var i = 0; i < pb.length; i++) {
              var a = pb[i], b = pb[(i + 1) % pb.length], d = segDist(q[0], q[1], a[0], a[1], b[0], b[1]);
              if (d < best.d) best = { d: d, at: q };
            }
          });
        });
      });
    }
    one(A, B); one(B, A);
    return best;
  }

  // ------------------------------------------------------------------
  // Build the soundboard
  // ------------------------------------------------------------------
  function withDefaults(o) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = (o && o[k] !== undefined && o[k] !== '') ? o[k] : DEFAULTS[k]; });
    ['holeSizeMm', 'holeYPct', 'holeCount', 'holeSpacingMm', 'kerfMm', 'pressFitMm', 'pickupCount', 'pickupYPct', 'pickupXMm', 'pickupSpacingMm',
      'pickupAngleDeg', 'pickupLengthMm', 'pickupWidthMm', 'pickupCornerMm'].forEach(function (k) { out[k] = Number(out[k]) || 0; });
    out.pickupScrews = out.pickupScrews === true || out.pickupScrews === 'true';
    if (!PICKUPS[out.pickup]) out.pickup = 'none';
    out.pickupCount = Math.max(1, Math.min(3, Math.round(out.pickupCount) || 1));
    out.calibration = !(out.calibration === false || out.calibration === 'false');
    out.plateMarks = out.plateMarks === true || out.plateMarks === 'true';
    if (!HOLE_STYLES.some(function (h) { return h[0] === out.soundHole; })) out.soundHole = 'none';
    if (!F_VARIANTS.some(function (h) { return h[0] === out.fVariant; })) out.fVariant = 'classic';
    out.kerfMm = Math.max(0, Math.min(1, out.kerfMm));
    out.pressFitMm = Math.max(-0.5, Math.min(0.5, out.pressFitMm));
    return out;
  }

  function build(meta, opts) {
    var o = withDefaults(opts), warnings = [], tp = meta.topPanel, L = meta.L;
    var opening = union(tp.opening.map(P));
    var pocket = union(meta.pocket.outline.map(P));
    var block = union(tp.blockFootprint.map(P));
    var shelfW = meta.shelf.widthMm;
    // finished top: the opening plus the interference, less the pocket notch (true size)
    var finished = diff(grow(opening, o.pressFitMm), pocket);
    var openMm = M(opening);
    function widthAt(y) {
      var xs = [];
      openMm.forEach(function (pp) { for (var i = 0; i < pp.length; i++) { var a = pp[i], b = pp[(i + 1) % pp.length]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); } });
      if (xs.length < 2) return 0;
      return Math.max.apply(null, xs) - Math.min.apply(null, xs);
    }
    var bb = bounds(M(finished)), blockY0 = bounds(M(block))[1];
    var ctx = { L: L, widthAt: widthAt, maxWidth: bb[2] - bb[0], blockY0: blockY0 };

    // screws (screw-on top) and plate marks
    var screws = meta.screwTop ? meta.screwTop.screws.map(function (s) { return { x: s.x, y: s.y }; }) : [];
    var sc = meta.screwTop;
    var screwHoles = screws.map(function (s) { return circ(s.x, s.y, sc.clearanceMm / 2, 40); });
    var screwHeads = screws.map(function (s) { return circ(s.x, s.y, sc.headMm / 2, 48); });
    var plate = [];
    if (o.plateMarks) {
      var yc = L / 2;
      [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sy) {
        plate.push({ x: sx * PLATE.spanAcrossMm / 2, y: yc + sy * PLATE.spanAlongMm / 2 });
      }); });
    }
    var plateSlots = plate.map(function (q) { return P(slotPts(q.x, q.y, PLATE.slotLongMm, PLATE.slotShortMm)); });

    // the sound hole design
    var h = holes(o, ctx), H = h.paths;

    var land = grow(opening, -(shelfW + GLUE_MARGIN_MM));        // holes must stay inside this
    var blockKeep = grow(block, GLUE_MARGIN_MM);
    var headKeep = screwHeads.length ? grow(union(screwHeads), GLUE_MARGIN_MM) : [];

    // pickup cutouts
    var PU = [], puScrews = [], pk = null;
    if (o.pickup !== 'none') {
      var spec = PICKUPS[o.pickup], pl = spec.lengthMm, pw = spec.widthMm, pr = spec.cornerMm;
      if (o.pickup === 'custom') { pl = Math.max(10, o.pickupLengthMm); pw = Math.max(8, o.pickupWidthMm); pr = Math.max(0, o.pickupCornerMm); }
      var pn = o.pickupCount, psp = o.pickupSpacingMm > 0 ? o.pickupSpacingMm : pw + 22;
      var pcy = o.pickupYPct > 0 ? o.pickupYPct / 100 * L : 0.33 * L, pcx = o.pickupXMm, pa = o.pickupAngleDeg;
      var sR = spec.screwMm / 2, sOff = pl / 2 + MIN_BRIDGE_MM + 1 + sR; // ear screws: a full bridge past each end
      var groupAt = function (cy) {
        var cs = []; for (var iP = 0; iP < pn; iP++) cs.push([pcx, cy + (iP - (pn - 1) / 2) * psp]); return cs;
      };
      var footprint = function (cs) {
        var f = cs.map(function (c) { return P(xform(rrectPts(pl, pw, pr), c[0], c[1], pa)); });
        if (o.pickupScrews) cs.forEach(function (c) { [-1, 1].forEach(function (sg) { var q = xform([[sg * sOff, 0]], c[0], c[1], pa)[0]; f.push(circ(q[0], q[1], sR, 16)); }); });
        return union(f);
      };
      if (!(o.pickupYPct > 0)) {
        // automatic: nearest spot to a third of the length that keeps the
        // whole group on the top, clear of the sound hole, the neck block
        // and (if it can) the ladder braces
        var Hg = H.length ? grow(H, MIN_BRIDGE_MM) : [], brBands = [];
        if (meta.braces) meta.braces.segments.forEach(function (g) {
          brBands.push(P([[g.x0 - 30, g.y - meta.braces.widthMm / 2], [g.x1 + 30, g.y - meta.braces.widthMm / 2], [g.x1 + 30, g.y + meta.braces.widthMm / 2], [g.x0 - 30, g.y + meta.braces.widthMm / 2]]));
        });
        var best = null;
        for (var dy = 0; dy <= 0.6 * L; dy += 2) {
          [pcy - dy, pcy + dy].forEach(function (cy) {
            if (best && best.score === 0) return;
            var fp = footprint(groupAt(cy));
            if (area(diff(fp, land)) > 0.05 || area(inter(fp, blockKeep)) > 0.05) return;
            if (Hg.length && area(inter(fp, Hg)) > 0.05) return;
            if (headKeep.length && area(inter(fp, headKeep)) > 0.05) return;
            var sc2 = brBands.length && area(inter(fp, brBands)) > 0.05 ? 1 : 0;
            if (!best || sc2 < best.score) best = { y: cy, score: sc2 };
          });
          if (best && best.score === 0) break;
        }
        if (best) pcy = best.y;
      }
      var centres = groupAt(pcy);
      centres.forEach(function (c) {
        PU.push(P(xform(rrectPts(pl, pw, pr), c[0], c[1], pa)));
        if (o.pickupScrews) [-1, 1].forEach(function (sg) {
          var q = xform([[sg * sOff, 0]], c[0], c[1], pa)[0]; puScrews.push({ x: q[0], y: q[1], r: sR });
        });
      });
      PU = union(PU);
      pk = { type: o.pickup, label: spec.label, lengthMm: pl, widthMm: pw, cornerMm: pr, count: pn, spacingMm: psp, y: pcy, yPct: 100 * pcy / L, x: pcx, angleDeg: pa,
        centres: centres, screws: puScrews.length ? { count: puScrews.length, holeMm: spec.screwMm, spanMm: 2 * sOff } : null, needsDepthMm: spec.depthMm };
    }
    var puScrewPaths = puScrews.map(function (q) { return circ(q.x, q.y, q.r, 32); });

    // ---- clearance checks (finished, true-size geometry)
    var checks = [], bad = [];
    if (H.length) {
      var outside = area(diff(H, finished));
      if (outside > 0.5) bad.push({ kind: 'outside', mm: 0, msg: 'The sound hole runs off the top.' });
      var onShelf = area(diff(H, land));
      var dEdge = minDist(M(H), M(opening)).d;
      checks.push({ what: 'rim edge', mm: dEdge, need: shelfW + GLUE_MARGIN_MM });
      if (onShelf > 0.05) bad.push({ kind: 'shelf', mm: dEdge, msg: 'The sound hole comes within ' + dEdge.toFixed(1) + ' mm of the rim: it must stay ' + (shelfW + GLUE_MARGIN_MM).toFixed(0) + ' mm in (the ' + shelfW.toFixed(0) + ' mm glue shelf + ' + GLUE_MARGIN_MM + ' mm).' });
      var dBlock = minDist(M(H), M(diff(block, []))).d;
      checks.push({ what: 'neck block / pocket', mm: dBlock, need: GLUE_MARGIN_MM });
      if (area(inter(H, blockKeep)) > 0.05) bad.push({ kind: 'block', mm: dBlock, msg: 'The sound hole comes within ' + dBlock.toFixed(1) + ' mm of the neck block / pocket (keep ' + GLUE_MARGIN_MM + ' mm of glue land round it).' });
      if (screws.length) {
        var dS = Infinity;
        screws.forEach(function (s) { var d = minDist(M(H), [[[s.x, s.y]]]).d - sc.headMm / 2; dS = Math.min(dS, d); });
        checks.push({ what: 'screw heads', mm: dS, need: GLUE_MARGIN_MM });
        if (dS < GLUE_MARGIN_MM) bad.push({ kind: 'screw', mm: dS, msg: 'The sound hole comes within ' + Math.max(0, dS).toFixed(1) + ' mm of a top screw head (keep ' + GLUE_MARGIN_MM + ' mm).' });
      }
      // bridges between separate cut-outs of the design
      var pieces = H.filter(function (p) { return ClipperLib.Clipper.Area(p) > 0; });
      var dMin = Infinity, at = null;
      for (var i = 0; i < pieces.length; i++) for (var j = i + 1; j < pieces.length; j++) {
        var r = minDist(M([pieces[i]]), M([pieces[j]]));
        if (r.d < dMin) { dMin = r.d; at = r.at; }
      }
      if (pieces.length > 1) {
        checks.push({ what: 'between cut-outs', mm: dMin, need: MIN_BRIDGE_MM });
        if (dMin < MIN_BRIDGE_MM) bad.push({ kind: 'bridge', mm: dMin, at: at, msg: 'Thin wood: only ' + dMin.toFixed(1) + ' mm between two cut-outs (near x ' + at[0].toFixed(0) + ', y ' + at[1].toFixed(0) + ' mm); keep at least ' + MIN_BRIDGE_MM + ' mm.' });
      }
      // a narrow neck inside a single cut-out piece of wood: wood islands
      // (e.g. the crescent's inner horn) are covered by the bridge check
    }
    if (pk) {
      var PUall = union(PU.concat(puScrewPaths));
      if (area(diff(PUall, land)) > 0.05) { var dE = minDist(M(PUall), M(opening)).d; bad.push({ kind: 'pickup-shelf', mm: dE, msg: 'A pickup cutout comes within ' + dE.toFixed(1) + ' mm of the rim: keep ' + (shelfW + GLUE_MARGIN_MM).toFixed(0) + ' mm (glue shelf + ' + GLUE_MARGIN_MM + ' mm).' }); }
      if (area(inter(PUall, blockKeep)) > 0.05) { var dB = minDist(M(PUall), M(block)).d; bad.push({ kind: 'pickup-block', mm: dB, msg: 'A pickup cutout comes within ' + dB.toFixed(1) + ' mm of the neck block / pocket (keep ' + GLUE_MARGIN_MM + ' mm).' }); }
      if (H.length) {
        var dH = minDist(M(PUall), M(H)).d;
        checks.push({ what: 'pickup to sound hole', mm: dH, need: MIN_BRIDGE_MM });
        if (dH < MIN_BRIDGE_MM || area(inter(PUall, H)) > 0.01) bad.push({ kind: 'pickup-hole', mm: dH, msg: 'Thin wood: a pickup cutout is only ' + Math.max(0, dH).toFixed(1) + ' mm from the sound hole; keep at least ' + MIN_BRIDGE_MM + ' mm.' });
      }
      var pp = PU.filter(function (q) { return ClipperLib.Clipper.Area(q) > 0; });
      if (pp.length < pk.count) bad.push({ kind: 'pickup-overlap', mm: 0, msg: 'The pickup cutouts overlap; increase the spacing.' });
      else if (pk.count > 1) {
        var dP = Infinity; for (var a1 = 0; a1 < pp.length; a1++) for (var a2 = a1 + 1; a2 < pp.length; a2++) dP = Math.min(dP, minDist(M([pp[a1]]), M([pp[a2]])).d);
        checks.push({ what: 'between pickups', mm: dP, need: MIN_BRIDGE_MM });
        if (dP < MIN_BRIDGE_MM) bad.push({ kind: 'pickup-bridge', mm: dP, msg: 'Thin wood: only ' + dP.toFixed(1) + ' mm between pickup cutouts; keep at least ' + MIN_BRIDGE_MM + ' mm.' });
      }
      if (screws.length) {
        var dSp = Infinity; screws.forEach(function (s2) { dSp = Math.min(dSp, minDist(M(PUall), [[[s2.x, s2.y]]]).d - sc.headMm / 2); });
        checks.push({ what: 'pickup to top screws', mm: dSp, need: GLUE_MARGIN_MM });
        if (dSp < GLUE_MARGIN_MM) bad.push({ kind: 'pickup-screw', mm: dSp, msg: 'A pickup cutout comes within ' + Math.max(0, dSp).toFixed(1) + ' mm of a top screw head.' });
      }
      // cavity depth under each pickup: the top's underside down to the
      // back floor, or to the top of a ladder brace if one runs under it
      var underTop = meta.shelf.zTop - meta.floorMm, fromSurface = meta.topPanel.topSurfaceZ - meta.floorMm, br = meta.braces, over = [];
      if (br) br.segments.forEach(function (g) {
        var band = [P([[g.x0 - 30, g.y - br.widthMm / 2], [g.x1 + 30, g.y - br.widthMm / 2], [g.x1 + 30, g.y + br.widthMm / 2], [g.x0 - 30, g.y + br.widthMm / 2]])];
        var hit = inter(PU, band);
        if (!hit.length) return;
        var hb = bounds(M(hit)), xm = (g.x0 + g.x1) / 2, ha = (g.x1 - g.x0) / 2, hMax = 0;
        [hb[0], hb[2], Math.max(hb[0], Math.min(hb[2], xm))].forEach(function (x) {
          var u = Math.max(-1, Math.min(1, (x - xm) / ha)), hh = br.endHeightMm + (br.heightMm - br.endHeightMm) * (1 - u * u);
          hMax = Math.max(hMax, hh);
        });
        over.push({ y: g.y, yPct: 100 * g.y / L, braceTopMm: hMax, depthMm: underTop - hMax, fromSurfaceMm: fromSurface - hMax });
      });
      pk.depthUnderTopMm = underTop; pk.depthFromSurfaceMm = fromSurface; pk.overBraces = over;
      if (over.length) {
        var worst = over.reduce(function (m1, q) { return q.depthMm < m1.depthMm ? q : m1; });
        var enough = worst.fromSurfaceMm >= pk.needsDepthMm;
        bad.push({ kind: 'pickup-brace', mm: worst.depthMm, thin: !enough, msg: 'Pickup over a ladder brace (at ' + worst.yPct.toFixed(0) + '% of the length): ' + worst.fromSurfaceMm.toFixed(1) +
          ' mm from the top surface down to the brace, ' + fromSurface.toFixed(1) + ' mm elsewhere; a ' + pk.label.toLowerCase() + ' pickup needs about ' + pk.needsDepthMm + ' mm' +
          (enough ? ' (enough, but the brace is right under the pickup and its wiring; move the pickup or that brace if you want it clear).' : ' (not enough: move the pickup, or move / remove that brace with brace positions).') });
      } else if (fromSurface < pk.needsDepthMm) {
        bad.push({ kind: 'pickup-depth', mm: fromSurface, msg: 'Only ' + fromSurface.toFixed(1) + ' mm from the top surface to the back floor; a ' + pk.label.toLowerCase() + ' pickup needs about ' + pk.needsDepthMm + ' mm.' });
      }
    }
    if (plate.length && screws.length) {
      var dp = Infinity;
      plate.forEach(function (q) { screws.forEach(function (s) { dp = Math.min(dp, Math.hypot(q.x - s.x, q.y - s.y) - sc.headMm / 2 - PLATE.slotLongMm / 2); }); });
      if (dp < 1) warnings.push('A plate bolt mark overlaps a top screw head (' + dp.toFixed(1) + ' mm); they are only engraved, but you may want to move the screws (top screw count).');
    }
    if (plate.length && H.length) {
      var dph = minDist(M(H), M(plateSlots)).d;
      if (area(inter(H, grow(plateSlots, 1))) > 0.05) warnings.push('The sound hole runs into a plate bolt mark (' + dph.toFixed(1) + ' mm).');
    }
    bad.forEach(function (b) { warnings.push(b.msg); });

    // ---- cut paths (kerf / press-fit compensated)
    var k2 = o.kerfMm / 2;
    var outerCut = grow(finished, k2);
    var holeCuts = H.length ? grow(H, -k2) : [];
    if (H.length && area(holeCuts) < 0.5 * area(H)) warnings.push('The kerf is large for these holes.');
    var screwCuts = screws.map(function (s) { return circ(s.x, s.y, Math.max(0.2, sc.clearanceMm / 2 - k2), 40); });
    var puCuts = PU.length ? grow(PU, -k2) : [];
    var puScrewCuts = puScrews.map(function (q) { return circ(q.x, q.y, Math.max(0.2, q.r - k2), 32); });
    var innerCuts = holeCuts.concat(screwCuts, puCuts, puScrewCuts);
    var engrave = screwHeads.concat(plateSlots);
    var fb = bounds(M(finished)), cb = bounds(M(outerCut));
    return {
      options: o, warnings: warnings, checks: checks, problems: bad,
      hole: h.used, holeAreaMm2: area(H),
      finished: M(diff(finished, union(H.concat(screwHoles, PU, puScrewPaths)))),
      pickups: pk, pickupAreaMm2: area(PU),   // the finished part (with holes), for the 3D preview
      layers: { outer: M(outerCut), inner: M(innerCuts), engrave: M(engrave) },
      sizeMm: [fb[2] - fb[0], fb[3] - fb[1]], cutSizeMm: [cb[2] - cb[0], cb[3] - cb[1]], bounds: fb, cutBounds: cb,
      kerfMm: o.kerfMm, pressFitMm: o.pressFitMm, minBridgeMm: MIN_BRIDGE_MM, glueMarginMm: GLUE_MARGIN_MM,
      plate: plate.length ? { holes: plate, spec: PLATE } : null,
      screws: sc ? { count: screws.length, size: sc.size, clearanceMm: sc.clearanceMm, headMm: sc.headMm, head: sc.head } : null,
      style: meta.style, lengthMm: meta.lengthMm
    };
  }

  function bounds(pathsMm) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    pathsMm.forEach(function (pp) { pp.forEach(function (q) {
      if (q[0] < b[0]) b[0] = q[0]; if (q[1] < b[1]) b[1] = q[1]; if (q[0] > b[2]) b[2] = q[0]; if (q[1] > b[3]) b[3] = q[1];
    }); });
    return b;
  }

  // ------------------------------------------------------------------
  // Exports
  // ------------------------------------------------------------------
  var COLORS = { outer: '#ff0000', inner: '#0000ff', engrave: '#000000', calibration: '#ff00ff' };
  var NAMES = { outer: 'Outer cut', inner: 'Inner cuts', engrave: 'Engrave', calibration: 'Calibration (100 mm square)' };
  var MARGIN = 10, CAL = 100;

  // page layout in mm, y down (SVG / PDF flip as needed)
  function layout(sb, title) {
    var b = sb.cutBounds, w = b[2] - b[0], h = b[3] - b[1], cal = sb.options.calibration;
    var W = Math.max(w, cal ? CAL + 2 : 0) + 2 * MARGIN, Hh = h + 2 * MARGIN + (cal ? CAL + 22 : 0);
    function tx(q) { return [q[0] - b[0] + MARGIN, b[3] - q[1] + MARGIN]; } // neck up
    var label = (title || 'Soundboard') + ': finished ' + sb.sizeMm[1].toFixed(1) + ' x ' + sb.sizeMm[0].toFixed(1) + ' mm (' +
      (sb.sizeMm[1] / IN).toFixed(2) + ' x ' + (sb.sizeMm[0] / IN).toFixed(2) + ' in), cut path ' + sb.cutSizeMm[1].toFixed(2) + ' x ' + sb.cutSizeMm[0].toFixed(2) +
      ' mm; kerf ' + sb.kerfMm.toFixed(2) + ' mm, press fit +' + sb.pressFitMm.toFixed(2) + ' mm/side';
    var calY = h + 2 * MARGIN;
    return { W: W, H: Hh, tx: tx, cal: cal ? { x: MARGIN, y: calY, size: CAL } : null, label: label, label2: 'Square must measure exactly 100.0 x 100.0 mm. Units: mm, 1:1.' };
  }

  function svg(sb, title) {
    var lay = layout(sb, title), sw = 0.1;
    function d(paths) {
      return paths.map(function (pp) { return 'M' + pp.map(function (q) { var t = lay.tx(q); return t[0].toFixed(3) + ' ' + t[1].toFixed(3); }).join(' L') + ' Z'; }).join(' ');
    }
    function layer(id, paths) {
      if (!paths.length) return '';
      return '  <g id="' + id + '" inkscape:groupmode="layer" inkscape:label="' + NAMES[id] + '">\n' +
        '    <path d="' + d(paths) + '" fill="none" stroke="' + COLORS[id] + '" stroke-width="' + sw + '"/>\n  </g>\n';
    }
    var out = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" ' +
      'width="' + lay.W.toFixed(3) + 'mm" height="' + lay.H.toFixed(3) + 'mm" viewBox="0 0 ' + lay.W.toFixed(3) + ' ' + lay.H.toFixed(3) + '">\n' +
      '  <title>' + esc(lay.label) + '</title>\n' +
      '  <desc>1:1, millimetres (1 user unit = 1 mm). Layers: outer cut red, inner cuts blue, engrave black, calibration magenta (turn it off before cutting).</desc>\n' +
      layer('outer', sb.layers.outer) + layer('inner', sb.layers.inner) + layer('engrave', sb.layers.engrave);
    if (lay.cal) {
      var c = lay.cal;
      out += '  <g id="calibration" inkscape:groupmode="layer" inkscape:label="' + NAMES.calibration + '">\n' +
        '    <path d="M' + c.x + ' ' + c.y + ' h ' + c.size + ' v ' + c.size + ' h -' + c.size + ' Z" fill="none" stroke="' + COLORS.calibration + '" stroke-width="' + sw + '"/>\n' +
        '    <text x="' + c.x + '" y="' + (c.y + c.size + 6) + '" font-family="sans-serif" font-size="4" fill="' + COLORS.calibration + '">' + esc(lay.label) + '</text>\n' +
        '    <text x="' + c.x + '" y="' + (c.y + c.size + 12) + '" font-family="sans-serif" font-size="4" fill="' + COLORS.calibration + '">' + esc(lay.label2) + '</text>\n' +
        '  </g>\n';
    }
    return out + '</svg>\n';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function dxf(sb, title) {
    var lay = layout(sb, title);
    var L = [], acad = { outer: 1, inner: 5, engrave: 7, calibration: 6 };
    function g(c, v) { L.push(String(c), String(v)); }
    g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(9, '$MEASUREMENT'); g(70, 1); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, 4);
    ['outer', 'inner', 'engrave', 'calibration'].forEach(function (k) {
      if (k === 'calibration' && !lay.cal) return;
      g(0, 'LAYER'); g(2, k.toUpperCase().replace('OUTER', 'OUTER_CUT').replace('INNER', 'INNER_CUTS')); g(70, 0); g(62, acad[k]); g(6, 'CONTINUOUS');
    });
    g(0, 'ENDTAB'); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    // DXF is y-up: x' = x - minx + margin, y' = H - (svg y)
    function pt(q) { var t = lay.tx(q); return [t[0], lay.H - t[1]]; }
    function poly(name, pp) {
      g(0, 'POLYLINE'); g(8, name); g(66, 1); g(70, 1); g(10, 0); g(20, 0); g(30, 0);
      pp.forEach(function (q) { var t = pt(q); g(0, 'VERTEX'); g(8, name); g(10, t[0].toFixed(4)); g(20, t[1].toFixed(4)); g(30, 0); });
      g(0, 'SEQEND'); g(8, name);
    }
    sb.layers.outer.forEach(function (pp) { poly('OUTER_CUT', pp); });
    sb.layers.inner.forEach(function (pp) { poly('INNER_CUTS', pp); });
    sb.layers.engrave.forEach(function (pp) { poly('ENGRAVE', pp); });
    if (lay.cal) {
      var c = lay.cal, x0 = c.x, y0 = lay.H - c.y - c.size;
      g(0, 'POLYLINE'); g(8, 'CALIBRATION'); g(66, 1); g(70, 1); g(10, 0); g(20, 0); g(30, 0);
      [[x0, y0], [x0 + c.size, y0], [x0 + c.size, y0 + c.size], [x0, y0 + c.size]].forEach(function (q) { g(0, 'VERTEX'); g(8, 'CALIBRATION'); g(10, q[0].toFixed(4)); g(20, q[1].toFixed(4)); g(30, 0); });
      g(0, 'SEQEND'); g(8, 'CALIBRATION');
      [[lay.label, 6], [lay.label2, 12]].forEach(function (tl) {
        g(0, 'TEXT'); g(8, 'CALIBRATION'); g(10, x0.toFixed(3)); g(20, (y0 - tl[1]).toFixed(3)); g(30, 0); g(40, 4); g(1, tl[0]);
      });
    }
    g(0, 'ENDSEC'); g(0, 'EOF');
    return L.join('\n') + '\n';
  }

  // minimal 1:1 PDF (page = the drawing, in points; content drawn in mm)
  function pdf(sb, title) {
    var lay = layout(sb, title), k = 72 / IN;
    var rgb = { outer: '1 0 0', inner: '0 0 1', engrave: '0 0 0', calibration: '1 0 1' };
    var c = ['q', k.toFixed(6) + ' 0 0 ' + k.toFixed(6) + ' 0 0 cm', '0.1 w', '1 J 1 j'];
    function path(pp) {
      return pp.map(function (q, i) { var t = lay.tx(q); return t[0].toFixed(3) + ' ' + (lay.H - t[1]).toFixed(3) + (i ? ' l' : ' m'); }).join('\n') + '\nh S';
    }
    ['outer', 'inner', 'engrave'].forEach(function (id) {
      if (!sb.layers[id].length) return;
      c.push(rgb[id] + ' RG'); sb.layers[id].forEach(function (pp) { c.push(path(pp)); });
    });
    if (lay.cal) {
      var cl = lay.cal, x0 = cl.x, y0 = lay.H - cl.y - cl.size;
      c.push(rgb.calibration + ' RG', x0 + ' ' + y0 + ' ' + cl.size + ' ' + cl.size + ' re S');
      c.push(rgb.calibration + ' rg', 'BT /F1 4 Tf ' + x0 + ' ' + (y0 - 6) + ' Td (' + pdfStr(lay.label) + ') Tj ET');
      c.push('BT /F1 4 Tf ' + x0 + ' ' + (y0 - 12) + ' Td (' + pdfStr(lay.label2) + ') Tj ET');
    }
    c.push('Q');
    var content = c.join('\n');
    var Wp = (lay.W * k).toFixed(3), Hp = (lay.H * k).toFixed(3);
    var objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + Wp + ' ' + Hp + '] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Title (' + pdfStr(title || 'Soundboard') + ' 1:1 mm) /Producer (Body Builder) >>'
    ];
    var out = '%PDF-1.4\n', offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offs.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    return out;
  }
  function pdfStr(s) { return String(s).replace(/[^\x20-\x7e]/g, '-').replace(/([\\()])/g, '\\$1'); }

  var api = {
    DEFAULTS: DEFAULTS, HOLE_STYLES: HOLE_STYLES, PICKUPS: PICKUPS, F_VARIANTS: F_VARIANTS, PLATE: PLATE, MIN_BRIDGE_MM: MIN_BRIDGE_MM, GLUE_MARGIN_MM: GLUE_MARGIN_MM,
    COLORS: COLORS, build: build, svg: svg, dxf: dxf, pdf: pdf, withDefaults: withDefaults
  };
  if (isNode) module.exports = api; else global.SoundBoard = api;
})(typeof window !== 'undefined' ? window : this);
