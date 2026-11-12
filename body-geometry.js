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

  // Clearance holes / washers for the clamshell bolts.
  var BOLTS = {
    M3: { label: 'M3', holeMm: 3.4, washerMm: 7.0, nutMm: 2.4, washerTMm: 0.5 },
    M4: { label: 'M4', holeMm: 4.5, washerMm: 9.0, nutMm: 3.2, washerTMm: 0.8 },
    '#6': { label: '#6', holeMm: 3.8, washerMm: 9.5, nutMm: 2.8, washerTMm: 1.2 }
  };

  // Every user-adjustable value with its default. Big dimensions are in
  // inches (like the fretboard builder), fine clearances in millimetres.
  var DEFAULTS = {
    style: 'parlor',
    shape: 'bouts',          // 'bouts' (lower bout / waist / upper bout) or 'box'
    lengthIn: 12.5,
    lowerWidthIn: 9.5,
    waistWidthIn: 5.75,
    upperWidthIn: 7.0,
    lowerPos: 0.30,          // widest point of the lower bout, fraction of length from the tail
    waistPos: 0.57,
    upperPos: 0.80,
    widthIn: 7.0,            // box shape only
    cornerRadiusIn: 0.5,     // box shape only
    depthIn: 3.25,           // rim height = overall body depth
    wallMm: 6.0,             // rim wall thickness (outside to inside face)
    panelThicknessMm: 3.175, // 1/8" plywood
    panelFitMm: 0.3,         // extra slot height over the panel thickness
    grooveDepthMm: 2.5,      // how far the track cuts into the wall
    panelEdgeGapMm: 0.5,     // gap left at the bottom of the track (panel is cut this much smaller)
    topLipMm: 4.0,           // rim above the top panel's slot
    bottomLipMm: 2.4,        // rim below the back panel's slot
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
    neckBolts: 1,
    tailBolts: 1,
    bedMm: 327.66            // 12.9"
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
    }
  };
  var STYLE_KEYS = ['parlor', 'small-dread', 'round', 'cigar-box'];
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

  function halfWidth(sh, y) {
    var L = sh.L;
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

  // Closed outline, counter-clockwise, in mm: [[x, y], ...]
  function outlinePoints(sh) {
    var L = sh.L, ys = [], i;
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
    return out;
  }
  function teardropBands(r, zc) {
    var top = zc + r * Math.SQRT2;
    return gridBands(zc - r, top).map(function (band) {
      var zm = clamp(zc, band[0], band[1]);
      // quantised to 0.05 mm so neighbouring bands never differ by a
      // few microns (sub-printable slivers)
      return { z0: band[0], z1: band[1], half: Math.ceil(teardropHalf(r, zc, zm) / 0.05 - 1e-6) * 0.05 };
    }).filter(function (b) { return b.half > 0.05; });
  }

  // ------------------------------------------------------------------
  // Build everything
  // ------------------------------------------------------------------
  function build(input) {
    var p = withDefaults(input);
    var warnings = [];
    var sh = shapeOf(p);
    var L = sh.L, D = p.depthIn * IN;
    var bolt = BOLTS[p.boltSize] || BOLTS.M4;
    var t = p.panelThicknessMm, fit = p.panelFitMm, g = p.grooveDepthMm, ec = p.panelEdgeGapMm;
    var pl = p.pocketLengthIn * IN, pw2 = p.pocketWidthIn * IN / 2 + p.pocketFitMm;
    var bl = pl + p.neckBlockEndMm;                 // neck block length (from the neck end)
    var kw = pw2 + p.neckBlockSideMm;               // neck block half width
    var tbl = p.tailBlockLengthMm, tw = p.tailBlockWidthMm / 2;

    var outline = outlinePoints(sh);
    var maxHw = 0;
    outline.forEach(function (q) { maxHw = Math.max(maxHw, Math.abs(q[0])); });

    // heights
    var zBL = p.bottomLipMm, zBS = zBL + t + fit;          // back panel slot
    var zTS0 = D - p.topLipMm - t - fit, zTS1 = D - p.topLipMm; // top panel slot
    var panelTopZ = zTS0 + t;                              // top surface of the top panel
    var zF = panelTopZ - p.pocketDepthIn * IN;             // pocket floor
    var nRoof = Math.ceil(g / STEP - 1e-9);
    var baseTop = Math.max(p.baseBlockMm, zBS + nRoof * STEP + 0.4);

    // clamshell bolts: horizontal holes across the full-width end slabs
    var boltZ = baseTop / 2;
    var rSpot = bolt.washerMm / 2 + 0.5, rHole = bolt.holeMm / 2;
    var boltYs = [];
    if (p.neckBolts >= 1) boltYs.push({ name: 'neck', y: L - pl / 2 });
    if (p.neckBolts >= 2) boltYs.push({ name: 'neck (rear)', y: L - bl + Math.max(9, rSpot + 4) });
    if (p.tailBolts >= 1) boltYs.push({ name: 'tail', y: Math.max(rSpot + 3, tbl / 2) });
    boltYs.forEach(function (b) {
      var minHw = Infinity;
      for (var s2 = -1; s2 <= 1.0001; s2 += 0.05) minHw = Math.min(minHw, halfWidth(sh, b.y + s2 * rSpot));
      b.xs = minHw - 1.0; // flat washer seat, just inside the wall
      b.hole = teardropBands(rHole, boltZ);
      b.spot = teardropBands(rSpot, boltZ);
    });

    // lines that straight cuts will follow (see presplit)
    var SX = [0, pw2, -pw2, kw, -kw, tw, -tw].map(function (v) { return Math.round(v * S); });
    var SY = [tbl, L - bl, L - pl];
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
    var cavM = diff(I, union(K, Kt));                      // between the slabs and the top slot
    var pocket = rect(-pw2, L - pl, pw2, L + 50);

    // features: { z0, z1, void }
    var F = [];
    function addF(z0, z1, v) { if (z1 - z0 > 1e-6 && v.length) F.push({ z0: z0, z1: z1, v: v }); }
    // base zone
    addF(0, zBL, cavB);
    addF(zBL, zBS, P(offset(cavB, g)));
    for (var j = 1; j <= nRoof; j++) addF(zBS + (j - 1) * STEP, zBS + j * STEP, P(offset(cavB, Math.max(0, g - j * STEP))));
    addF(zBS + nRoof * STEP, baseTop, cavB);
    // middle zone
    addF(baseTop, zTS0, cavM);
    // top slot zone
    addF(zTS0, zTS1, P(offset(I, g)));
    var roofTop = zTS1;
    for (j = 1; j <= nRoof && zTS1 + j * STEP <= D - 0.6 + 1e-9; j++) {
      addF(zTS1 + (j - 1) * STEP, zTS1 + j * STEP, P(offset(I, Math.max(0, g - j * STEP))));
      roofTop = zTS1 + j * STEP;
    }
    if (zTS1 + nRoof * STEP > D - 0.6 + 1e-9) warnings.push('The top lip (' + p.topLipMm.toFixed(1) + ' mm) is too thin to roof over a ' + g.toFixed(1) + ' mm deep track without supports; make it at least ' + (g + 1.5).toFixed(1) + ' mm.');
    addF(roofTop, D, I);
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
        addF(sb.z0, sb.z1, union(rect(b.xs, b.y - sb.half, BIG / S, b.y + sb.half), rect(-BIG / S, b.y - sb.half, -b.xs, b.y + sb.half)));
      });
      var grip = 2 * b.xs;
      var len = grip + 2 * bolt.washerTMm + bolt.nutMm + 2;
      boltInfo.push({ name: b.name, yMm: b.y, zMm: boltZ, gripMm: grip, minLengthMm: len });
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

    // ---- halves
    var leftHP = rect(-BIG / S, -BIG / S, 0, BIG / S), rightHP = rect(0, -BIG / S, BIG / S, BIG / S);
    var leftRegions = solid.map(function (r) { return inter(r, leftHP); });
    var rightRegions = solid.map(function (r) { return inter(r, rightHP); });
    var left = meshSlabs(levels, leftRegions);
    var right = meshSlabs(levels, rightRegions);

    // ---- overhang audit: downward faces above the bed
    var maxLedge = 0, downArea = 0;
    for (k = 1; k < levels.length - 1; k++) {
      var dn = diff(leftRegions[k], leftRegions[k - 1]);
      if (!dn.length) continue;
      downArea += areaMm2(dn);
      // widest ledge: grow an inward offset until the region vanishes
      var w = 0;
      while (w < 50 && offset(dn, -(w + 0.05)).length) w += 0.05;
      maxLedge = Math.max(maxLedge, 2 * w);
    }

    // ---- panels (1:1 outlines, mm)
    var topPanel = diff(offset(I, g - ec), pocket);
    var backPanel = offset(cavB, g - ec);

    // ---- checks and warnings
    var bed = p.bedMm;
    if (L >= bed) warnings.push('Body length ' + (L / IN).toFixed(2) + '″ does not fit the ' + (bed / IN).toFixed(2) + '″ print bed; keep it under ' + (bed / IN).toFixed(2) + '″.');
    if (maxHw >= bed) warnings.push('Each half is ' + (maxHw / IN).toFixed(2) + '″ wide, more than the print bed.');
    if (zF < 19) warnings.push('Only ' + zF.toFixed(1) + ' mm of block under the neck pocket; use a deeper body (3″ or more recommended).');
    if (p.neckScrewMode === 'wells' && plasticUnderPocket < 19) warnings.push('Only ' + plasticUnderPocket.toFixed(1) + ' mm of printed floor between the screw wells and the pocket; 19 mm or more recommended.');
    if (zF <= baseTop + 1) warnings.push('The pocket floor is below the top of the end slabs; the neck bolt may break into the pocket. Use a deeper body.');
    var backLen = (L - bl) - tbl;
    if (backLen < 60) warnings.push('The neck and tail blocks leave only ' + backLen.toFixed(0) + ' mm for the back panel; shorten the pocket or the blocks, or lengthen the body.');
    if (zTS0 - baseTop < 5) warnings.push('The body is too shallow for the end slabs and the top track; increase the depth.');
    if (sx + rs > pw2 - 2 || sy + rs > pl / 2 - 2) warnings.push('The neck screw pattern does not fit inside the neck pocket.');
    if (p.topLipMm < g + 1.5 && zTS1 + nRoof * STEP <= D - 0.6 + 1e-9) warnings.push('The top lip is thin (' + p.topLipMm.toFixed(1) + ' mm); ' + (g + 1.5).toFixed(1) + ' mm or more is stronger.');
    if (p.wallMm < g + 2.5) warnings.push('Wall ' + p.wallMm.toFixed(1) + ' mm leaves under 2.5 mm behind the ' + g.toFixed(1) + ' mm track; use a thicker wall or a shallower track.');

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
    var meta = {
      params: p,
      lengthMm: L, widthMm: 2 * maxHw, depthMm: D,
      halfFootprintMm: [maxHw, L], halfHeightMm: D, fitsBed: L < bed && maxHw < bed, bedMm: bed,
      panelTopZ: panelTopZ, pocketFloorZ: zF, topSlot: [zTS0, zTS1], bottomSlot: [zBL, zBS],
      baseTopMm: baseTop, neckBlock: { lengthMm: bl, widthMm: 2 * kw, heightMm: zTS0 },
      tailBlock: { lengthMm: tbl, widthMm: 2 * tw, heightMm: zTS0 },
      pocket: { lengthMm: pl, widthMm: 2 * pw2, depthMm: panelTopZ - zF, floorZ: zF },
      plasticUnderPocketMm: plasticUnderPocket,
      neckScrews: screws.map(function (q) { return { x: q[0], y: q[1] }; }),
      neckScrewThroughMm: throughMm, neckScrewLengthIn: screwIn, neckScrewNeedMm: screwMm, neckScrewBiteMm: biteMm, neckScrewWells: wellsUsed, neckScrewNote: screwNote,
      bolts: boltInfo, boltSize: bolt.label,
      panels: {
        top: { outline: pathsToMm(topPanel), sizeMm: [lpanelBox[2] - lpanelBox[0], lpanelBox[3] - lpanelBox[1]], areaMm2: areaMm2(topPanel) },
        back: { outline: pathsToMm(backPanel), sizeMm: [bpanelBox[2] - bpanelBox[0], bpanelBox[3] - bpanelBox[1]], areaMm2: areaMm2(backPanel) },
        topZ: [zTS0, zTS0 + t], backZ: [zBL, zBL + t]
      },
      overhang: { downFacingAreaMm2: downArea, widestLedgeMm: maxLedge },
      levels: levels.length, outline: outline,
      triangles: { left: left.length / 9, right: right.length / 9 }
    };
    return { groups: groups, meta: meta, warnings: warnings,
      slabs: { levels: levels, left: leftRegions, right: rightRegions } };
  }

  // Is (x, y, z) (mm) inside the printed material of one half?
  // half = 'left' | 'right'. Used by the tests and handy for debugging.
  function solidAt(result, half, x, y, z) {
    var lv = result.slabs.levels, zi = z * S, k;
    for (k = 0; k + 1 < lv.length; k++) if (zi >= lv[k] && zi < lv[k + 1]) break; // on a level: the slab above
    if (k + 1 >= lv.length) return false;
    var pt = { X: Math.round(x * S), Y: Math.round(y * S) }, wind = 0;
    result.slabs[half][k].forEach(function (path) {
      if (ClipperLib.Clipper.PointInPolygon(pt, path) !== 0) wind += ClipperLib.Clipper.Area(path) > 0 ? 1 : -1;
    });
    return wind > 0;
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
    STEP_MM: STEP,
    styleParams: styleParams, matchStyle: matchStyle, withDefaults: withDefaults,
    shapeOf: shapeOf, halfWidth: halfWidth, outlinePoints: outlinePoints,
    build: build, solidAt: solidAt, panelMesh: panelMesh, panelSVG: panelSVG, panelDXF: panelDXF,
    _meshSlabs: meshSlabs, _toPath: toPath
  };
  if (isNode) module.exports = api;
  else global.BodyBuilder = api;
})(typeof window !== 'undefined' ? window : this);
