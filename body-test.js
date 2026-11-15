/* Headless body builder tests: node body-test.js (also run by node test.js) */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ClipperLib = require('./vendor/clipper.js');
const B = require('./body-geometry.js');
const SB = require('./soundboard.js');
const STL = require('./stl.js');

const IN = 25.4;
const S = 1000;

function approx(actual, expected, tol, msg) {
  assert.ok(actual !== null && Math.abs(actual - expected) <= tol,
    `${msg}: expected ~${expected}, got ${actual}`);
}

// Every edge shared by exactly two triangles, running in opposite
// directions (closed, consistently wound = watertight).
function edgeErrors(tris) {
  const key = (i) => Math.round(tris[i] * 1e4) + ',' + Math.round(tris[i + 1] * 1e4) + ',' + Math.round(tris[i + 2] * 1e4);
  const edges = new Map();
  for (let i = 0; i < tris.length; i += 9) {
    const v = [key(i), key(i + 3), key(i + 6)];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const k = a < b ? a + '|' + b : b + '|' + a;
      const r = edges.get(k) || [0, 0];
      r[0]++; r[1] += a < b ? 1 : -1;
      edges.set(k, r);
    }
  }
  let bad = 0;
  edges.forEach(r => { if (r[0] !== 2 || r[1] !== 0) bad++; });
  return bad;
}

function signedVolume(t) {
  let v = 0;
  for (let i = 0; i < t.length; i += 9) {
    v += (t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) -
          t[i + 1] * (t[i + 3] * t[i + 8] - t[i + 5] * t[i + 6]) +
          t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6])) / 6;
  }
  return v;
}

// signed volume of each separate shell (connected by shared vertices):
// the body is one outer shell (+) plus one inner shell (-) per sealed
// cell under the neck pocket
function shellVolumes(t) {
  const key = (i) => Math.round(t[i] * 1e4) + ',' + Math.round(t[i + 1] * 1e4) + ',' + Math.round(t[i + 2] * 1e4);
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (let i = 0; i < t.length; i += 9) {
    const v = [key(i), key(i + 3), key(i + 6)];
    v.forEach(k => { if (!parent.has(k)) parent.set(k, k); });
    parent.set(find(v[1]), find(v[0])); parent.set(find(v[2]), find(v[0]));
  }
  const vol = new Map();
  for (let i = 0; i < t.length; i += 9) {
    const r = find(key(i));
    const dv = (t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) -
                t[i + 1] * (t[i + 3] * t[i + 8] - t[i + 5] * t[i + 6]) +
                t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6])) / 6;
    vol.set(r, (vol.get(r) || 0) + dv);
  }
  return [...vol.values()];
}
function outerShells(t) { return shellVolumes(t).filter(v => v > 0).length; }
function innerShells(t) { return shellVolumes(t).filter(v => v < 0).length; }

// number of separate shells (connected by shared vertices)
function shells(t) {
  const key = (i) => Math.round(t[i] * 1e4) + ',' + Math.round(t[i + 1] * 1e4) + ',' + Math.round(t[i + 2] * 1e4);
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (let i = 0; i < t.length; i += 9) {
    const v = [key(i), key(i + 3), key(i + 6)];
    v.forEach(k => { if (!parent.has(k)) parent.set(k, k); });
    parent.set(find(v[1]), find(v[0])); parent.set(find(v[2]), find(v[0]));
  }
  const roots = new Set();
  parent.forEach((_, k) => roots.add(find(k)));
  return roots.size;
}

function bounds(t) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], t[i + k]); b[k + 3] = Math.max(b[k + 3], t[i + k]); }
  }
  return b;
}

function area(paths) { let a = 0; paths.forEach(p => { a += ClipperLib.Clipper.Area(p); }); return a / (S * S); }
function clip(type, a, b) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
  if (b.length) c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out;
}
function grow(paths, d) {
  const co = new ClipperLib.ClipperOffset(2, 0.03 * S);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, d * S);
  return out;
}
// Print-orientation overhang audit on the slab stack (z up from the bed):
// material in each slab may reach at most `step` mm past the slab under
// it. Returns the unsupported patches [{z, area}].
function overhangs(levels, regions, step) {
  const bad = [];
  for (let k = 1; k < regions.length; k++) {
    const un = clip(ClipperLib.ClipType.ctDifference, regions[k], grow(regions[k - 1], step + 0.02));
    const a = area(un);
    if (a > 0.05) bad.push({ z: levels[k] / S, area: a, paths: un });
  }
  return bad;
}

// Where a cover pilot hole cuts the recess's bevel staircase, the step
// beside the hole has a sliver (well under 0.2 mm^2) with only the hole
// under it. Drop those: each must lie within 1.5 mm of a screw hole.
function minusScrewCrescents(r, bad) {
  const a = r.meta.access;
  if (!a) return bad;
  return bad.map(b => {
    const rest = b.paths.filter(p => {
      const ar = Math.abs(ClipperLib.Clipper.Area(p)) / (S * S);
      const near = p.every(q => a.screws.some(s => Math.hypot(q.X / S - s.x, q.Y / S - s.y) < a.screwHoleMm / 2 + 1.5));
      return !(near && ar < 0.2);
    });
    return Object.assign({}, b, { paths: rest, area: area(rest) });
  }).filter(b => b.area > 0.05);
}

const built = {};
function build(name, p) {
  if (!built[name]) built[name] = B.build(p);
  return built[name];
}
const P = (k, extra) => Object.assign(B.styleParams(k), extra || {});
const solid = (r, x, y, z) => B.solidAt(r, 'body', x, y, z);

// === Body A: style presets, generic names, Custom detection ==============
{
  assert.deepStrictEqual(B.STYLE_KEYS, ['parlor', 'small-dread', 'round', 'cigar-box', 'license-plate', 't-style']);
  B.STYLE_KEYS.forEach(k => {
    const p = B.styleParams(k);
    assert.strictEqual(p.style, k);
    assert.strictEqual(B.matchStyle(p), k, `A: ${k} matches itself`);
    const edited = Object.assign({}, p, { depthIn: p.depthIn + 0.1 });
    assert.strictEqual(B.matchStyle(edited), 'custom', `A: editing ${k} -> custom`);
  });
  // the clamshell is gone: no halves, channels, lips, collars, bolts
  ['channelDepthMm', 'lipMm', 'panelFitMm', 'neckCollar', 'neckBolts', 'tailBolts', 'boltSize', 'baseBlockMm', 'tailBlockLengthMm', 'neckBlockSideMm', 'neckBlockEndMm', 'gussetLengthMm'].forEach(k =>
    assert.ok(!(k in B.DEFAULTS), `A: obsolete clamshell parameter ${k} removed`));
  assert.strictEqual(B.DEFAULTS.pocketLengthIn, 2.75, 'A: pocket 2.75in long');
  assert.strictEqual(B.DEFAULTS.pocketWidthIn, 1.5, 'A: pocket 1.5in wide');
  assert.strictEqual(B.DEFAULTS.pocketDepthIn, 0.9, 'A: pocket floor 0.9in down');
  assert.strictEqual(B.DEFAULTS.pocketCornerMm, 6.35, 'A: pocket corners 1/4in radius');
  assert.strictEqual(B.DEFAULTS.pocketWallMm, 6, 'A: 6 mm pocket side walls');
  assert.strictEqual(B.DEFAULTS.pocketEndWallMm, 8, 'A: 8 mm pocket end wall');
  assert.strictEqual(B.DEFAULTS.neckScrewMode, 'plate', 'A: back plate (no wells) by default');
  assert.strictEqual(B.DEFAULTS.bedMarginMm, 5, 'A: 5 mm bed margin');
  assert.strictEqual(B.DEFAULTS.wallMm, 3, 'A: 3 mm walls');
  assert.strictEqual(B.WALL_MIN_MM, 2, 'A: 2 mm minimum wall');
  assert.strictEqual(B.DEFAULTS.neckBlockRibs, false, 'A: neck block ribs (the neck block brace) off by default');
  assert.strictEqual(B.DEFAULTS.ladderBraces, true, 'A: ladder braces on by default');
  assert.strictEqual(B.DEFAULTS.screwTop, false, 'A: glued top by default (screw-on top off)');
  assert.strictEqual(B.DEFAULTS.topScrewSize, '#4', 'A: #4 top screws by default');
  assert.strictEqual(B.DEFAULTS.topScrewHead, 'pan', 'A: pan head top screws by default');
  assert.ok(B.DEFAULTS.tabBossMm >= 10 && B.DEFAULTS.tabBossMm <= 11, 'A: 10-11 mm screw tab bosses');
  // no brand or model names anywhere in the body builder's files
  const banned = ['Fen' + 'der', 'Gib' + 'son', 'Tele' + 'caster', 'Mar' + 'tin', 'Les ' + 'Paul', 'Str' + 'at'];
  const re = new RegExp('\\b(' + banned.join('|') + ')', 'i');
  banned.push('Ricken' + 'backer', 'Stradi' + 'varius');
  ['body-builder.html', 'body-app.js', 'body-geometry.js', 'body-test.js', 'preview.js', 'soundboard.js', 'README.md'].forEach(f => {
    const txt = fs.readFileSync(path.join(__dirname, f), 'utf8');
    const m = txt.match(re);
    assert.ok(!m, `A: ${f} mentions "${m && m[0]}"`);
  });
  console.log('Body A ok: 6 generic style presets, edits switch to Custom, clamshell parameters gone, 2.75 x 1.5 x 0.9in pocket default, no brand names');
}

// === Body B: one watertight part per style, access on/off, both screw modes
{
  let n = 0;
  B.STYLE_KEYS.forEach(k => {
    [false, true].forEach(acc => {
      ['plate', 'wells'].forEach(mode => {
        const r = build(`${k}-${acc}-${mode}`, P(k, { accessPanel: acc, neckScrewMode: mode }));
        const tag = `B: ${k} access=${acc} ${mode}`;
        assert.strictEqual(edgeErrors(r.body), 0, `${tag}: body watertight`);
        assert.strictEqual(outerShells(r.body), 1, `${tag}: body is one piece`);
        const cells = r.meta.neckBlock.cells ? r.meta.neckBlock.cells.count : 0;
        assert.strictEqual(innerShells(r.body), cells, `${tag}: the only other shells are the ${cells} sealed cells under the pocket`);
        assert.ok(signedVolume(r.body) > 0, `${tag}: outward normals`);
        const b = bounds(r.body);
        approx(b[2], 0, 1e-6, `${tag}: back face on the bed`);
        approx(b[5], r.meta.depthMm, 1e-3, `${tag}: rim edge at the full depth`);
        if (acc) {
          assert.ok(r.cover, `${tag}: cover made`);
          assert.strictEqual(edgeErrors(r.cover), 0, `${tag}: cover watertight`);
          assert.strictEqual(shells(r.cover), 1, `${tag}: cover is one piece`);
          assert.ok(signedVolume(r.cover) > 0, `${tag}: cover outward normals`);
        } else assert.strictEqual(r.cover, null, `${tag}: no cover`);
        n++;
      });
    });
  });
  const lefty = build('t-lefty', P('t-style', { leftHanded: true, accessPanel: true }));
  assert.strictEqual(edgeErrors(lefty.body), 0, 'B: left-handed T-Style watertight');
  const right = build('t-style-false-plate');
  const bl = bounds(lefty.body), br = bounds(right.body);
  approx(bl[0], -br[3], 0.05, 'B: lefty mirrors the outline');
  console.log(`Body B ok: ${n} builds + lefty, every body one watertight piece on the bed (plus its sealed cells), covers watertight`);
}

// === Body C: bed fit, outline-only scaling ==================================
{
  const bed = 12.9 * IN, lim = bed - 5;
  const t = build('t-style-false-plate'), m = t.meta;
  assert.ok(m.scaled && m.outlineScale < 1, 'C: T-Style outline is scaled');
  approx(Math.max(m.lengthMm, m.widthMm), lim, 0.05, 'C: T-Style scaled to the bed less the 5 mm margin');
  assert.ok(m.lengthMm <= lim + 1e-6 && m.widthMm <= lim + 1e-6 && m.fitsBed, 'C: T-Style fits');
  approx(m.naturalLengthMm, 12.9 * IN, 0.05, 'C: T-Style drawn at 12.9in');
  approx(m.lengthMm / IN, 12.70, 0.005, 'C: T-Style lands at 12.70in long');
  approx(m.widthMm / IN, 10.36, 0.01, 'C: T-Style lands at 10.36in wide');
  const b = bounds(t.body);
  assert.ok(b[4] - b[1] <= lim + 1e-3 && b[3] - b[0] <= lim + 1e-3, 'C: the T-Style mesh is inside the bed limit');
  // true-size parts: pocket, wall, shelf, holes
  approx(m.pocket.lengthMm, 2.75 * IN, 1e-6, 'C: scaled T-Style pocket still 2.75in long');
  approx(m.pocket.widthMm, 1.5 * IN + 0.3, 1e-6, 'C: scaled T-Style pocket still 1.5in (+fit)');
  approx(m.wallMm, 3, 1e-9, 'C: wall unscaled');
  approx(m.shelf.widthMm, 7, 1e-9, 'C: shelf unscaled');
  const par = build('parlor-false-plate').meta;
  assert.ok(!par.scaled && par.outlineScale === 1 && par.fitsBed, 'C: parlor fits unscaled');
  approx(par.lengthMm, 12.5 * IN, 1e-6, 'C: parlor full length');
  const sd = build('small-dread-false-plate').meta;
  assert.ok(sd.scaled && Math.abs(sd.lengthMm - lim) < 0.05, 'C: small dreadnought style (12.75in) scaled to the limit');
  const off = B.build(P('t-style', { fitBed: false }));
  assert.ok(!off.meta.fitsBed && !off.meta.scaled && off.warnings.some(w => /does not fit/.test(w)), 'C: scaling off -> too big warning');
  const small = B.build(P('parlor', { bedMm: 11 * IN }));
  assert.ok(small.meta.scaled && small.meta.lengthMm <= 11 * IN - 5 + 1e-6, 'C: smaller bed scales the parlor too');
  approx(small.meta.pocket.lengthMm, 2.75 * IN, 1e-9, 'C: ... with the pocket true size');
  console.log(`Body C ok: T-Style scaled ${(m.outlineScale * 100).toFixed(2)}% to ${(m.lengthMm / IN).toFixed(2)}in x ${(m.widthMm / IN).toFixed(2)}in (bed 12.9in - 5 mm), parlor unscaled, pocket/wall/shelf true size`);
}

// === Body D: neck pocket: 2.75 x 1.5in, 1/4in corners, floor 0.9in down ===
{
  ['parlor', 't-style', 'cigar-box'].forEach(k => {
    const r = build(`${k}-false-plate`, P(k)), m = r.meta, L = m.L, pk = m.pocket;
    const hw = pk.widthMm / 2, y0 = L - pk.lengthMm, zTop = m.topPanel.topSurfaceZ;
    approx(zTop - pk.floorZ, 0.9 * IN, 1e-6, `D: ${k} floor 0.9in below the top surface`);
    approx(zTop, m.depthMm - B.DEFAULTS.shelfAllowanceMm, 1e-6, `D: ${k} top surface near flush`);
    const zm = (pk.floorZ + m.shelf.zTop) / 2;
    // 1/4in (6.35 mm) radius inner corners: solid in the corner itself,
    // open just inside the arc, solid just outside it
    approx(pk.cornerRadiusMm, 6.35, 1e-9, `D: ${k} corner radius 1/4in`);
    const rc = pk.cornerRadiusMm, c45 = Math.SQRT1_2;
    [[-1, 1], [1, 1]].forEach(([sx]) => {
      assert.ok(solid(r, sx * (hw - 0.5), y0 + 0.5, zm), `D: ${k} corner filled by the radius`);
      const ax = hw - rc + rc * c45, ay = y0 + rc - rc * c45;
      assert.ok(!solid(r, sx * (ax - 0.15), ay + 0.15, zm), `D: ${k} pocket open just inside the corner arc`);
      assert.ok(solid(r, sx * (ax + 0.15), ay - 0.15, zm), `D: ${k} block just outside the corner arc`);
      assert.ok(!solid(r, sx * (hw - 0.05), y0 + rc + 0.5, zm), `D: ${k} straight side starts where the arc ends`);
      assert.ok(!solid(r, sx * (hw - rc - 0.5), y0 + 0.05, zm), `D: ${k} straight end wall starts where the arc ends`);
      assert.ok(solid(r, sx * (hw + 0.05), y0 - 0.05, zm), `D: ${k} block just past the inner corner`);
      assert.ok(solid(r, sx * (hw + 0.05), y0 + 10, zm), `D: ${k} pocket side wall`);
    });
    assert.ok(solid(r, 0, y0 - 0.05, zm), `D: ${k} pocket end wall`);
    assert.ok(!solid(r, 0, L - 1, zm), `D: ${k} pocket open through the neck end`);
    assert.ok(solid(r, hw - 2, y0 + 5, pk.floorZ - 0.05), `D: ${k} pocket floor is solid block`);
    assert.ok(!solid(r, hw - 2, y0 + 5, pk.floorZ + 0.05), `D: ${k} open above the floor`);
    // the shell walls are integral: solid from the back up to the shelf
    [[0, y0 - 4], [hw + 3, y0 + 20]].forEach(([x, y]) => {
      assert.ok(solid(r, x, y, 1) && solid(r, x, y, m.shelf.zTop - 0.05), `D: ${k} block walls from floor to shelf`);
      assert.ok(!solid(r, x, y, m.shelf.zTop + 0.05), `D: ${k} top panel sits on the block walls`);
    });
  });
  // never scaled: pocket size identical however long the body
  const a = B.build(P('parlor', { lengthIn: 10 })).meta.pocket, b2 = B.build(P('parlor', { lengthIn: 16 })).meta.pocket;
  approx(a.lengthMm, b2.lengthMm, 1e-9, 'D: pocket length independent of the body');
  approx(a.widthMm, b2.widthMm, 1e-9, 'D: pocket width independent of the body');
  // square corners still possible
  const sq = B.build(P('parlor', { pocketCornerMm: 0 })), sm = sq.meta, sy0 = sm.L - sm.pocket.lengthMm, shw = sm.pocket.widthMm / 2;
  assert.ok(!B.solidAt(sq, 'body', shw - 0.05, sy0 + 0.05, (sm.pocket.floorZ + sm.shelf.zTop) / 2) && edgeErrors(sq.body) === 0, 'D: radius 0 -> square corners');
  console.log('Body D ok: pocket 2.75 x 1.5in, 1/4in radius corners, floor 0.9in below the top surface, through the neck end, integral walls, never scaled');
}

// === Body E: glue shelf: drop, width, 45-degree taper ======================
{
  ['parlor', 't-style'].forEach(k => {
    const r = build(`${k}-false-plate`, P(k)), m = r.meta, sh = m.shelf, D = m.depthMm;
    approx(sh.dropMm, 3.175 + 0.25, 1e-9, `E: ${k} shelf drop = ply + allowance`);
    approx(D - sh.zTop, sh.dropMm, 1e-6, `E: ${k} glue surface ${sh.dropMm} mm below the rim`);
    approx(sh.taperDeg, 45, 0, 'E: 45 degree taper');
    assert.ok(sh.stepMm <= B.STEP_MM + 1e-9, `E: ${k} taper steps no bigger than ${B.STEP_MM} mm`);
    // probe across the right-hand side at the lower bout
    const y = B.shapeOf(Object.assign({}, P(k), Object.fromEntries(B.OUTLINE_KEYS.map(q => [q, P(k)[q] * m.outlineScale])))).c1 || m.L * 0.3;
    let xo = 0; for (let x = 0; x < 400; x += 0.05) { if (solid(r, x, y, 1)) xo = x; }
    const xi = xo - m.wallMm;                     // inside face of the wall
    assert.ok(solid(r, xi + 0.1, y, D - 0.1), `E: ${k} wall to the rim edge`);
    assert.ok(!solid(r, xi - 0.3, y, sh.zTop + 0.1), `E: ${k} recess for the top above the shelf`);
    assert.ok(solid(r, xi - sh.widthMm + 0.15, y, sh.zTop - 0.05), `E: ${k} glue surface ${sh.widthMm} mm wide`);
    assert.ok(!solid(r, xi - sh.widthMm - 0.15, y, sh.zTop - 0.05), `E: ${k} shelf ends at its width`);
    assert.ok(solid(r, xi - sh.widthMm + 0.15, y, sh.zTop - sh.lipMm + 0.05), `E: ${k} straight edge under the glue surface`);
    // taper: at h below the edge the shelf reaches (width - h) in from the wall, +-1 step
    for (let h = 1; h < sh.widthMm - 0.5; h += 1) {
      const z = sh.zTop - sh.lipMm - h;
      let reach = 0; for (let d = 0; d < 20; d += 0.02) if (solid(r, xi - d, y, z)) reach = d;
      assert.ok(Math.abs(reach - (sh.widthMm - h)) <= B.STEP_MM + 0.05, `E: ${k} 45-degree taper at ${h} mm: reach ${reach.toFixed(2)}`);
    }
    assert.ok(!solid(r, xi - 0.3, y, sh.taperBottomZ - 0.1), `E: ${k} plain wall under the taper`);
    approx(sh.glueWidthMm, sh.widthMm - B.DEFAULTS.topFitMm, 1e-9, 'E: glue width = shelf less the top fit');
  });
  console.log('Body E ok: shelf 3.425 mm below the rim (ply + 0.25), 7 mm wide (6.7 mm glue), 1.6 mm edge, 45-degree staircase taper');
}

// === Body F: support-free, floor down ======================================
{
  ['parlor', 'small-dread', 'round', 'cigar-box', 't-style'].forEach(k => {
    [false, true].forEach(acc => {
      const r = build(`${k}-${acc}-plate`), bad = minusScrewCrescents(r, overhangs(r.slabs.levels, r.slabs.body, B.STEP_MM));
      assert.strictEqual(bad.length, 0, `F: ${k} access=${acc}: unsupported overhangs ${JSON.stringify(bad.map(b => [b.z, b.area]))}`);
      if (r.cover) {
        const cb = overhangs(r.slabs.coverLevels, r.slabs.cover, 0);
        assert.strictEqual(cb.length, 0, `F: ${k} cover only narrows going up`);
      }
    });
  });
  // wells: the only flat roofs are the four round well tops (short bridges)
  const w = build('parlor-false-wells'), bad = overhangs(w.slabs.levels, w.slabs.body, B.STEP_MM);
  assert.ok(w.meta.neckScrews.wells, 'F: parlor has room for wells');
  assert.strictEqual(bad.length, 1, 'F: one roof level with wells');
  approx(bad[0].z, w.meta.neckScrews.wellTopZ, 1e-3, 'F: ... at the well tops');
  assert.ok(bad[0].area < 4 * Math.PI * 8 * 8 + 1, 'F: ... no bigger than the four wells');
  console.log('Body F ok: every slab within one 0.4 mm step of the one below (no supports), covers narrow upwards, wells = only bridges');
}

// === Body G: neck screws ====================================================
{
  const r = build('parlor-false-plate'), m = r.meta, ns = m.neckScrews;
  assert.strictEqual(ns.holes.length, 4, 'G: 4 neck screw holes');
  ns.holes.forEach(h => {
    assert.ok(!solid(r, h.x, h.y, 0.5) && !solid(r, h.x, h.y, m.pocket.floorZ - 0.5), 'G: hole runs through the floor and block');
    assert.ok(solid(r, h.x + ns.holeMm / 2 + 0.3, h.y, m.pocket.floorZ - 0.5), 'G: hole is the clearance size');
    assert.ok(Math.abs(h.x) + ns.holeMm / 2 < m.pocket.widthMm / 2 && h.y > m.pocket.y0, 'G: holes inside the pocket floor');
  });
  approx(ns.lengthMm, 3 + m.pocket.floorZ + 19, 1e-6, 'G: plate screw = plate + floor/block + bite');
  assert.strictEqual(ns.lengthIn, Math.ceil(ns.lengthMm / IN * 4 - 1e-6) / 4, 'G: rounded up to 1/4in');
  assert.strictEqual(ns.lengthIn, 3.25, 'G: parlor plate screws 3.25in');
  const w = build('parlor-false-wells').meta.neckScrews;
  approx(w.lengthMm, 1.5 + 25.4 + 19, 1e-6, 'G: wells screw = washer + well floor + bite');
  assert.strictEqual(w.lengthIn, 2, 'G: wells screws 2in');
  const tw = build('t-style-false-wells');
  assert.ok(!tw.meta.neckScrews.wells && tw.warnings.some(x => /No room for screw wells/.test(x)), 'G: shallow T-Style falls back to the plate');
  const t = build('t-style-false-plate').meta.neckScrews;
  assert.strictEqual(t.lengthIn, 2, 'G: T-Style plate screws 2in');
  console.log(`Body G ok: 4 holes through floor + block; parlor ${ns.lengthIn}in (plate) / ${w.lengthIn}in (wells), T-Style ${t.lengthIn}in`);
}

// === Body H: back access panel ==============================================
{
  const off = build('parlor-false-plate'), on = build('parlor-true-plate'), a = on.meta.access;
  assert.strictEqual(off.meta.access, null, 'H: off by default');
  const cy = a.centerY, hw = a.openingMm[0] / 2;
  assert.ok(solid(off, 0, cy, 1) && solid(off, hw + 2, cy, 0.1), 'H: toggle off -> solid back');
  assert.ok(!solid(on, 0, cy, 1) && !solid(on, 0, cy, a.ringTop - 0.1), 'H: opening through the back');
  // 45-degree recess: at height z the recess reaches (depth - z) past the opening
  for (let z = 0.15; z < a.recessDepthMm; z += 0.5) {
    const reach = a.recessDepthMm - Math.floor(z / a.stepMm) * a.stepMm;   // staircase: one step per stepMm
    assert.ok(reach <= a.recessDepthMm - z + a.stepMm + 1e-9, 'H: 45-degree staircase');
    assert.ok(!solid(on, hw + reach - 0.05, cy, z), `H: recess open at z=${z}`);
    assert.ok(solid(on, hw + reach + 0.05, cy, z), `H: recess wall at z=${z}`);
  }
  assert.ok(solid(on, hw + 0.3, cy, a.recessDepthMm + 0.1), 'H: seat ring above the recess');
  assert.ok(solid(on, hw + a.recessDepthMm + a.ringWidthMm - 0.3, cy, a.ringTop - 0.1), 'H: raised ring inside');
  assert.ok(!solid(on, hw + a.recessDepthMm + a.ringWidthMm + 0.3, cy, a.ringTop - 0.1), 'H: ring ends');
  // cover: fills the recess, coverFit clear of the body everywhere
  const cv = on.slabs.cover, cl = on.slabs.coverLevels;
  for (let k = 0; k < cv.length; k++) {
    const z = (cl[k] + cl[k + 1]) / 2 / S;
    let kb = 0; while (kb + 1 < on.slabs.levels.length && !(z * S >= on.slabs.levels[kb] && z * S < on.slabs.levels[kb + 1])) kb++;
    const clash = clip(ClipperLib.ClipType.ctIntersection, grow(cv[k], 0.15), on.slabs.body[kb]);
    assert.ok(area(clash) < 0.05, `H: cover clears the body at z=${z.toFixed(2)}`);
  }
  const cb = bounds(on.cover);
  approx(cb[2], 0, 1e-6, 'H: cover outer face on the bed (print face down)');
  approx(cb[5], a.recessDepthMm, 1e-6, 'H: cover flush with the back');
  approx(cb[3] - cb[0], a.cover.sizeMm[0], 0.05, 'H: cover size');
  assert.strictEqual(a.screws.length, 4, 'H: 4 cover screws');
  a.screws.forEach(s => {
    assert.ok(!solid(on, s.x, s.y, a.ringTop - 0.2), 'H: pilot hole through the ring');
    assert.ok(!B.solidAt(on, 'cover', s.x, s.y, 0.2), 'H: clearance hole in the cover');
    assert.ok(B.solidAt(on, 'cover', s.x + a.screwClearMm / 2 + 0.6, s.y, 0.2) || B.solidAt(on, 'cover', s.x - a.screwClearMm / 2 - 0.6, s.y, 0.2), 'H: cover round the hole');
  });
  // does not fit -> left out with a warning, body still one watertight piece
  const big = B.build(P('parlor', { accessPanel: true, accessWidthMm: 400 }));
  assert.ok(big.meta.access === null && big.cover === null && big.warnings.some(w => /Access opening left out/.test(w)), 'H: oversize opening left out');
  const none = B.build(P('parlor', { accessPanel: true, coverScrews: 0 }));
  assert.ok(none.meta.access.screws.length === 0 && edgeErrors(none.body) === 0 && edgeErrors(none.cover) === 0, 'H: no screws ok');
  console.log(`Body H ok: access ${a.openingMm[0]} x ${a.openingMm[1]} mm, ${a.recessDepthMm} mm 45-degree recess, ring, cover fits and prints face down, off = solid back`);
}

// === Body I: top panel and cover outlines (SVG / DXF), STL =================
{
  const r = build('parlor-true-plate'), m = r.meta, tp = m.topPanel;
  approx(tp.sizeMm[0], m.widthMm - 2 * (m.wallMm + tp.fitMm), 0.1, 'I: top panel width = inside of the rim less the fit');
  assert.ok(tp.outline.length === 1, 'I: top panel is one closed cut path');
  const notch = tp.outline[0].filter(q => Math.abs(Math.abs(q[0]) - m.pocket.widthMm / 2) < 1e-6);
  assert.ok(notch.length >= 4, 'I: top panel has the pocket notch');
  const svg = B.panelSVG(tp.outline, 'Top panel'), dxf = B.panelDXF(tp.outline);
  assert.ok(/<svg[^>]+width="[\d.]+mm"/.test(svg) && /100 mm check bar/.test(svg), 'I: SVG is 1:1 mm with a check bar');
  assert.ok(/\$INSUNITS[\s\S]*\n4\n/.test(dxf) && (dxf.match(/\nLINE\n/g) || []).length === tp.outline[0].length, 'I: DXF in mm, one LINE per edge');
  const csvg = B.panelSVG(m.access.cover.outline, 'Cover');
  assert.ok(/<path/.test(csvg), 'I: cover outline SVG');
  const bytes = STL.trianglesToBytes(r.body);
  assert.strictEqual(bytes.length, 84 + 50 * r.body.length / 9, 'I: binary STL size');
  console.log(`Body I ok: top panel ${tp.sizeMm[1].toFixed(1)} x ${tp.sizeMm[0].toFixed(1)} mm with the notch, SVG/DXF 1:1 mm, cover outline, STL`);
}

// === Body J: limits and warnings ============================================
{
  const thin = B.build(P('parlor', { wallMm: 1 }));
  assert.ok(thin.meta.wallMm === 2 && thin.warnings.some(w => /Walls thinner/.test(w)), 'J: wall clamped to 2 mm');
  const flat = B.build(P('parlor', { depthIn: 1 }));
  assert.ok(flat.meta.depthMm > 25.4 && flat.warnings.some(w => /Body depth raised/.test(w)), 'J: depth raised for the pocket');
  assert.strictEqual(edgeErrors(flat.body), 0, 'J: shallowest body watertight');
  approx(flat.meta.pocket.floorZ, 15, 1e-6, 'J: 15 mm of block under the pocket at the minimum depth');
  const floor = B.build(P('parlor', { floorMm: 1 }));
  assert.ok(floor.meta.floorMm === 2 && floor.warnings.some(w => /floor thinner/.test(w)), 'J: floor clamped to 2 mm');
  const wide = B.build(P('parlor', { neckScrewSpanXIn: 1.5 }));
  assert.ok(wide.warnings.some(w => /pocket walls/.test(w)), 'J: holes outside the pocket warned');
  console.log('Body J ok: wall / floor minimums, depth raised for the pocket, screw-hole warnings');
}

// === Body L: the neck block is a ribbed shell, not a solid lump ============
{
  B.STYLE_KEYS.forEach(k => {
    const r = build(`${k}-false-plate`, P(k)), m = r.meta, nb = m.neckBlock, pk = m.pocket;
    const hw = pk.widthMm / 2, y0 = pk.y0, L = m.L, yc = L - pk.lengthMm / 2, zm = (pk.floorZ + m.shelf.zTop) / 2;
    assert.strictEqual(nb.footprintPieces, 1, `L: ${k} walls and ties are one connected piece`);
    assert.ok(nb.pocketWallMm >= 2 && nb.pocketEndWallMm >= 2 && nb.ribMm >= 2 && nb.bossWallMm >= 2 && nb.pocketFloorMm >= 2, `L: ${k} every block wall at least 2 mm`);
    // pocket walls tw thick, side and end, up to the shelf
    const tw = nb.pocketWallMm, ew = nb.pocketEndWallMm;
    assert.ok(solid(r, hw + tw - 0.2, yc + 5, zm) && solid(r, 0, y0 - ew + 0.2, zm), `L: ${k} ${tw} mm side walls, ${ew} mm end wall`);
    approx(nb.y0, y0 - ew, 1e-6, `L: ${k} block ends at the end wall`);
    // no gussets: nothing behind the end wall, at any height
    [m.floorMm + 0.5, m.floorMm + 2, zm].forEach(z => [0, hw, hw + tw - 1, -hw].forEach(x =>
      assert.ok(!solid(r, x, y0 - ew - 0.3, z) && !solid(r, x, y0 - ew - 10, z), `L: ${k} hollow behind the end wall at x=${x.toFixed(1)}, z=${z.toFixed(1)}`)));
    if (!nb.filledSides.includes('right')) {
      assert.ok(!solid(r, hw + tw + 0.3, yc + 5, zm), `L: ${k} hollow outside the side wall`);
      assert.ok(!nb.ribs && !nb.neckBrace && !solid(r, hw + tw + 1, yc, m.floorMm + 1), `L: ${k} no neck block brace with neck block ribs off (the default)`);
    }
    // ribs on: ONE brace straight across the body at mid-pocket, the
    // ladder-brace profile over the full inside width (tallest on the
    // centreline), the pocket shell solid through the middle
    const rr = build(`${k}-ribs`, P(k, { neckBlockRibs: true })), nr = rr.meta.neckBlock, nbr = nr.neckBrace, bm = rr.meta.braces;
    assert.ok(nr.ribs && nbr, `L: ${k} ribs on -> neck block brace`);
    approx(nbr.y, yc, 1e-6, `L: ${k} neck brace at mid-pocket`);
    approx(nbr.heightCentreMm, bm.heightMm, 1e-9, `L: ${k} neck brace has the ladder braces' centre height`);
    approx(nbr.endHeightMm, bm.endHeightMm, 1e-9, `L: ${k} ... and end height`);
    assert.strictEqual(nr.footprintPieces, 1, `L: ${k} ribs on: shell and brace one piece`);
    const X0 = nbr.segments[0].x0, xsw = hw + tw, hcalc = (x) => { const a = x < 0 ? nbr.spanMm - (nbr.segments.slice(-1)[0].x1) : 0; return a; };
    void hcalc;
    [-1, 1].forEach(sg => {
      if (sg > 0 && nr.filledSides.includes('right')) return;
      if (sg < 0 && nr.filledSides.includes('left')) return;
      const h = nbr.heightAtShellMm[sg < 0 ? 0 : 1];
      // meets the shell wall at the full arc's height there
      assert.ok(B.solidAt(rr, 'body', sg * (xsw + 0.5), yc, m.floorMm + h - 0.6), `L: ${k} brace meets the ${sg < 0 ? 'bass' : 'treble'} wall at ${h.toFixed(1)} mm`);
      assert.ok(!B.solidAt(rr, 'body', sg * (xsw + 0.5), yc, m.floorMm + h + 0.6), `L: ${k} ... and no higher`);
      assert.ok(h > nbr.endHeightMm + 3 && h <= nbr.heightCentreMm, `L: ${k} wall height between the end and centre heights (one arc, not two)`);
      // hollow above it, up to the shelf
      assert.ok(!B.solidAt(rr, 'body', sg * (xsw + 1), yc, zm), `L: ${k} hollow above the neck brace`);
    });
    assert.ok(X0 < -hw - tw - 20, `L: ${k} neck brace reaches out towards the bass rim`);
    // continuous arc: inside the shell the profile would be taller than at the walls
    assert.ok(nbr.heightCentreMm > Math.max.apply(null, nbr.heightAtShellMm) - 1e-9, `L: ${k} the pocket interrupts the tallest part of the arc`);
    // under the pocket: solid floor plate, then cells between ribs and screw bosses
    const c = nb.cells;
    assert.ok(c && c.count === 4, `L: ${k} four sealed cells under the pocket`);
    assert.ok(solid(r, hw / 2, yc + 8, pk.floorZ - nb.pocketFloorMm + 0.2), `L: ${k} solid plate under the pocket floor`);
    const zc = (c.bottomZ + c.roofStartZ) / 2;
    assert.ok(!solid(r, hw / 2, yc + 8, zc) && !solid(r, -hw / 2, yc - 8, zc), `L: ${k} cells are hollow`);
    assert.ok(solid(r, 0, yc + 8, zc) && solid(r, hw / 2, yc, zc), `L: ${k} centre rib and cross rib`);
    m.neckScrews.holes.forEach(h => {
      assert.ok(!solid(r, h.x, h.y, zc), `L: ${k} screw hole runs through its boss`);
      const d = m.neckScrews.holeMm / 2 + nb.bossWallMm - 0.3;
      assert.ok(solid(r, h.x, h.y + d, zc) && solid(r, h.x, h.y - d, zc), `L: ${k} ${nb.bossDiameterMm.toFixed(1)} mm boss round the hole`);
    });
    assert.ok(m.volume.neckBlockCm3 > 50 && m.volume.neckBlockCm3 < 200, `L: ${k} neck block ${m.volume.neckBlockCm3.toFixed(0)} cm3 (a solid block was 190-480)`);
  });
  const t = build('t-style-false-plate').meta.neckBlock, lefty = build('t-lefty').meta.neckBlock;
  assert.deepStrictEqual(t.filledSides, ['right'], 'L: T-Style treble-side gap to the rim filled solid');
  assert.deepStrictEqual(lefty.filledSides, ['left'], 'L: lefty T-Style fills the other side');
  assert.deepStrictEqual(build('parlor-false-plate').meta.neckBlock.filledSides, [], 'L: parlor: no gap fill (ties both sides when ribs are on)');
  const tr = build('t-style-ribs', P('t-style', { neckBlockRibs: true })).meta.neckBlock;
  assert.deepStrictEqual(tr.filledSides, ['right'], 'L: T-Style treble fill stays with ribs on');
  const pr = build('parlor-ribs').meta.neckBlock.neckBrace;
  approx(pr.heightAtShellMm[0], pr.heightAtShellMm[1], 0.05, 'L: parlor neck brace symmetric');
  assert.strictEqual(pr.segments.length, 1, 'L: parlor neck brace one run rim to rim');
  const par = build('parlor-false-plate').meta.volume;
  assert.ok(par.totalCm3 < 650, `L: parlor body ${par.totalCm3.toFixed(0)} cm3 (847 with the solid block)`);
  const thin = B.build(P('parlor', { pocketWallMm: 1, ribMm: 1 }));
  assert.ok(thin.meta.neckBlock.pocketWallMm === 2 && thin.meta.neckBlock.ribMm === 2 && thin.warnings.some(w => /thinner than 2 mm/.test(w)), 'L: block walls clamped to 2 mm');
  assert.strictEqual(edgeErrors(thin.body), 0, 'L: thinnest shell watertight');
  console.log(`Body L ok: ${build('parlor-false-plate').meta.neckBlock.pocketWallMm} mm shell walls, ${build('parlor-false-plate').meta.neckBlock.pocketEndWallMm} mm end wall, no gussets, one neck block brace (ribs on: ${build('parlor-ribs').meta.neckBlock.neckBrace.heightAtShellMm[0].toFixed(1)} mm at the pocket walls), gap fill kept, ${build('parlor-false-plate').meta.neckBlock.bossDiameterMm.toFixed(1)} mm bosses, 4 sealed cells; parlor ${par.totalCm3.toFixed(0)} cm3 total`);
}

// === Body M: neck block ribs, ladder braces, screw-on top ===================
{
  const keys = process.env.BODY_FULL ? B.STYLE_KEYS : ['parlor', 't-style'];
  let n = 0;
  keys.forEach(k => [false, true].forEach(acc => [false, true].forEach(ribs => [false, true].forEach(br => [false, true].forEach(st => {
    if (!process.env.BODY_FULL && !(ribs === st)) return; // the full matrix: BODY_FULL=1 node body-test.js
    const r = B.build(P(k, { accessPanel: acc, neckBlockRibs: ribs, ladderBraces: br, screwTop: st }));
    const tag = `M: ${k} access=${acc} ribs=${ribs} braces=${br} screwTop=${st}`;
    assert.strictEqual(edgeErrors(r.body), 0, `${tag}: body watertight`);
    assert.strictEqual(outerShells(r.body), 1, `${tag}: one piece`);
    if (r.cover) assert.strictEqual(edgeErrors(r.cover), 0, `${tag}: cover watertight`);
    const bad = minusScrewCrescents(r, overhangs(r.slabs.levels, r.slabs.body, B.STEP_MM));
    assert.strictEqual(bad.length, 0, `${tag}: support-free ${JSON.stringify(bad.map(b => [b.z, b.area]))}`);
    assert.strictEqual(!!r.meta.braces, br, `${tag}: braces ${br ? 'present' : 'absent'}`);
    assert.strictEqual(!!r.meta.screwTop, st, `${tag}: screw tabs ${st ? 'present' : 'absent'}`);
    assert.strictEqual(!!r.meta.neckBlock.neckBrace, ribs, `${tag}: neck brace ${ribs ? 'present' : 'absent'}`);
    if (ribs && st) r.meta.screwTop.screws.forEach(h => assert.ok(Math.abs(h.y - r.meta.neckBlock.neckBrace.y) > r.meta.screwTop.bossMm / 2 + 2 || r.meta.screwTop.tabBottomZ > r.meta.floorMm + r.meta.neckBlock.neckBrace.heightCentreMm + 2, `${tag}: tab clear of the neck brace`));
    if (ribs) assert.ok(r.meta.floorMm + r.meta.neckBlock.neckBrace.heightCentreMm < r.meta.shelf.taperBottomZ - 5, `${tag}: neck brace well under the shelf`);
    n++;
  })))));
  // braces: tall, thin, parabolic, rounded top; clear of the block, access ring and shelf
  const r = build('parlor-false-plate'), m = r.meta, bm = m.braces;
  assert.ok(bm && bm.count === 3, 'M: three braces by default');
  assert.ok(bm.widthMm >= 6 && bm.widthMm <= 8 && bm.heightMm >= 10 && bm.heightMm <= 12, 'M: 6-8 mm wide, 10-12 mm tall');
  bm.segments.forEach(g => {
    const xm = (g.x0 + g.x1) / 2, z = m.floorMm + bm.heightMm - 0.3;
    assert.ok(solid(r, xm, g.y, z), `M: brace at y=${g.y.toFixed(0)} reaches full height mid-span`);
    assert.ok(!solid(r, xm, g.y, m.floorMm + bm.heightMm + 0.3), 'M: ... and no higher');
    assert.ok(!solid(r, xm, g.y + bm.widthMm / 2 - 0.4, z), 'M: rounded crown (narrower at the top)');
    assert.ok(solid(r, xm, g.y + bm.widthMm / 2 - 0.2, m.floorMm + 1), 'M: full width at the foot');
    const xe = g.x0 + 3; // near the end: only the low end height
    assert.ok(solid(r, xe, g.y, m.floorMm + bm.endHeightMm - 0.3) && !solid(r, xe, g.y, m.floorMm + bm.endHeightMm + 1.5), 'M: tapers down to the ends');
    // between: parabolic (the quarter point is well over the end height)
    const xq = g.x0 + (g.x1 - g.x0) / 4, hq = bm.endHeightMm + (bm.heightMm - bm.endHeightMm) * 0.75;
    assert.ok(solid(r, xq, g.y, m.floorMm + hq - 1), 'M: parabolic profile at the quarter point');
    assert.ok(g.y + bm.widthMm / 2 < m.neckBlock.y0, 'M: clear of the neck block');
    assert.ok(m.floorMm + bm.heightMm < m.shelf.taperBottomZ - 5, 'M: well under the glue shelf');
  });
  const ra = build('parlor-true-plate'), acc = ra.meta.access;
  ra.meta.braces.segments.forEach(g => {
    const ring = acc.openingMm[0] / 2;
    assert.ok(!(Math.abs(g.y - acc.centerY) < acc.openingMm[1] / 2 + 5 && Math.min(Math.abs(g.x0), Math.abs(g.x1)) < ring), 'M: braces stop short of the access ring');
  });
  // screw-on top: tabs, pilots, sizes
  const st = B.build(P('parlor', { screwTop: true })), sm = st.meta.screwTop;
  assert.ok(sm.count >= 6 && sm.count <= 10, `M: ${sm.count} tabs (6-10)`);
  approx(sm.bossMm, 11, 1e-9, 'M: 11 mm bosses');
  assert.ok(sm.pilotMm === 2.3 && sm.clearanceMm === 3.2 && sm.headMm === 5.6, 'M: #4 pilot / clearance / pan head');
  sm.screws.forEach(h => {
    const z = st.meta.shelf.zTop - 2;
    assert.ok(!B.solidAt(st, 'body', h.x, h.y, z), 'M: pilot hole open');
    assert.ok(B.solidAt(st, 'body', h.x + sm.pilotMm / 2 + 0.5, h.y, z), 'M: tab round the pilot');
    assert.ok(B.solidAt(st, 'body', h.x + sm.bossMm / 2 - 0.6, h.y, z) || B.solidAt(st, 'body', h.x - sm.bossMm / 2 + 0.6, h.y, z), 'M: boss wall left for #8');
    assert.ok((sm.bossMm - B.TOP_SCREWS['#8'].pilotMm) / 2 >= 3.5, 'M: >= 3.5 mm of boss round a #8 pilot');
    assert.ok(!B.solidAt(st, 'body', h.x, h.y, st.meta.shelf.zTop - sm.holeDepthMm - 0.3) || B.solidAt(st, 'body', h.x, h.y, st.meta.shelf.zTop - sm.holeDepthMm - 0.3), 'M: blind pilot');
  });
  const s8 = B.build(P('parlor', { screwTop: true, topScrewSize: '#8' })).meta.screwTop;
  assert.ok(s8.pilotMm === 3.3 && s8.clearanceMm === 4.5 && s8.headMm === 8.2, 'M: #8 sizes');
  const tiny = B.build(P('parlor', { screwTop: true, topScrewCount: 30 }));
  assert.ok(tiny.meta.screwTop.count <= 24, 'M: count capped');
  console.log(`Body M ok: ${n} ribs/braces/screw-top/access builds watertight and support-free; braces ${bm.widthMm} x ${bm.heightMm} mm parabolic; ${sm.count} x #4 tabs, ${sm.bossMm} mm bosses`);
}

// === Body N: the License Plate style =======================================
{
  const r = build('license-plate-false-plate'), m = r.meta;
  approx(m.lengthMm, 12 * IN, 0.05, 'N: 12in long'); approx(m.widthMm, 6 * IN, 0.05, 'N: 6in wide');
  assert.ok(!m.scaled && m.outlineScale === 1 && m.fitsBed, 'N: full size, not scaled');
  assert.ok(12 * IN + m.bedMarginMm <= m.bedMm + 1e-9 && m.bedLimitMm === m.bedMm - m.bedMarginMm, `N: 304.8 + ${m.bedMarginMm} mm margin within the ${m.bedMm.toFixed(2)} mm bed`);
  approx(m.depthMm, 2.5 * IN, 1e-6, 'N: 2.5in deep by default');
  approx(m.pocket.lengthMm, 2.75 * IN, 1e-6, 'N: pocket 2.75in, true size'); approx(m.pocket.widthMm, 1.5 * IN + 2 * B.DEFAULTS.pocketFitMm, 1e-6, 'N: pocket 1.5in (+ fit)');
  approx(m.pocket.y1, m.L, 1e-6, 'N: neck on the short (top) end');
  assert.ok(m.fit && m.fit.blockSideClearMm > 40, `N: ${m.fit.blockSideClearMm.toFixed(1)} mm each side of the neck block`);
  // corners: 1/4in radius (the corner point is outside, 2 mm in along the diagonal is inside)
  const hx = m.widthMm / 2, ri = 0.25 * IN, d = ri * (1 - Math.SQRT1_2);
  assert.ok(!solid(r, hx - d + 0.4, 0 + d - 0.4, 1) && solid(r, hx - d - 0.4, d + 0.4, 1), 'N: quarter-inch rounded corners');
  const ra = build('license-plate-true-plate'), fa = ra.meta.fit;
  assert.ok(fa.access && fa.bracesDropped.length >= 1 && ra.warnings.some(w => /^Fit check:/.test(w) && /no wider than/.test(w)), 'N: access panel on: fit check warns and suggests options');
  const rl = B.build(P('license-plate', { accessPanel: true, bracePositions: '60, 68' }));
  assert.ok(rl.meta.braces && rl.meta.braces.count === 2 && !rl.warnings.some(w => /^Fit check:/.test(w)), 'N: braces moved off the ring: no fit warning');
  console.log(`Body N ok: License Plate ${m.lengthMm.toFixed(1)} x ${m.widthMm.toFixed(1)} mm unscaled (bed limit ${m.bedLimitMm.toFixed(2)}), ${m.depthMm} mm deep, ${m.volume.totalCm3.toFixed(0)} cm3; access-panel fit check suggests options`);
}

// === Body O: soundboard export (sizes, layers, kerf), hole styles, pickups ===
{
  const KEYS = B.STYLE_KEYS;
  function svgInfo(txt) {
    const w = +txt.match(/<svg[^>]*\swidth="([\d.]+)mm"/)[1], h = +txt.match(/<svg[^>]*\sheight="([\d.]+)mm"/)[1];
    const vb = txt.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
    const groups = {};
    txt.replace(/<g id="(\w+)"[^>]*>([\s\S]*?)<\/g>/g, (all, id, body) => {
      // a small path parser (M L H V h v l m Z), every subpath separately
      const paths = [];
      body.replace(/<path[^>]*\sd="([^"]+)"/g, (a, dd) => {
        const tok = dd.match(/[MLHVZmlhvz]|-?[\d.]+(?:e-?\d+)?/g); let cmd = 'M', cx = 0, cy = 0, cur = null, i = 0;
        while (i < tok.length) {
          if (/[A-Za-z]/.test(tok[i])) { cmd = tok[i++]; if (/[Zz]/.test(cmd)) { cur = null; continue; } }
          const num = () => +tok[i++];
          if (cmd === 'M' || cmd === 'm') { const x = num(), y = num(); cx = cmd === 'm' ? cx + x : x; cy = cmd === 'm' ? cy + y : y; cur = [[cx, cy]]; paths.push(cur); cmd = cmd === 'm' ? 'l' : 'L'; continue; }
          if (cmd === 'L') { cx = num(); cy = num(); } else if (cmd === 'l') { cx += num(); cy += num(); }
          else if (cmd === 'H') cx = num(); else if (cmd === 'h') cx += num(); else if (cmd === 'V') cy = num(); else if (cmd === 'v') cy += num();
          if (!cur) { cur = [[cx, cy]]; paths.push(cur); } else cur.push([cx, cy]);
        }
      });
      groups[id] = paths; return all;
    });
    return { w, h, vb, groups };
  }
  const bb = (paths) => { let b = [Infinity, Infinity, -Infinity, -Infinity]; paths.forEach(pp => pp.forEach(q => { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); })); return b; };
  let n = 0;
  KEYS.forEach(k => {
    const r = build(`${k}-false-plate`), m = r.meta, sb = SB.build(m, {});
    assert.strictEqual(sb.problems.length, 0, `O: ${k} default round hole clears everything: ${JSON.stringify(sb.warnings)}`);
    const sv = SB.svg(sb, k), info = svgInfo(sv);
    // 1 user unit = 1 mm
    assert.ok(info.vb[0] === 0 && info.vb[1] === 0 && Math.abs(info.vb[2] - info.w) < 1e-6 && Math.abs(info.vb[3] - info.h) < 1e-6, `O: ${k} SVG width/height in mm match the viewBox`);
    assert.ok(!/px|pt"/.test(sv.match(/<svg[^>]*>/)[0]), `O: ${k} no px/pt units`);
    // the outer cut, measured from the file = the finished top + the kerf
    const ob = bb(info.groups.outer);
    approx(ob[2] - ob[0], sb.sizeMm[0] + sb.kerfMm, 0.02, `O: ${k} SVG outer cut width = finished + kerf`);
    approx(ob[3] - ob[1], sb.sizeMm[1] + sb.kerfMm, 0.02, `O: ${k} SVG outer cut length = finished + kerf`);
    // the finished top = the rim's inside face + the press fit each side
    const ib = (function () { let b = [Infinity, Infinity, -Infinity, -Infinity]; m.topPanel.opening.forEach(pp => pp.forEach(q => { b[0] = Math.min(b[0], q[0]); b[2] = Math.max(b[2], q[0]); })); return b; })();
    approx(sb.sizeMm[0], ib[2] - ib[0] + 2 * sb.pressFitMm, 0.02, `O: ${k} finished width = opening + 2 x press fit`);
    // calibration: a 100 mm square on its own layer
    const cal = info.groups.calibration.map(p => bb([p])).filter(b => Math.abs(b[2] - b[0] - 100) < 0.01 && Math.abs(b[3] - b[1] - 100) < 0.01);
    assert.strictEqual(cal.length, 1, `O: ${k} 100 mm calibration square`);
    const off = svgInfo(SB.svg(SB.build(m, { calibration: false }), k));
    assert.ok(!off.groups.calibration || !off.groups.calibration.length, `O: ${k} calibration can be turned off`);
    assert.ok(/stroke="#ff0000"|stroke="red"/i.test(sv.split('id="outer"')[1].split('</g>')[0]) || /ff0000/i.test(sv), `O: ${k} outer cut red`);
    // inner cut: the round hole is kerf/2 smaller
    const inn = info.groups.inner.map(p => bb([p])).filter(b => b[2] - b[0] > 10);
    assert.ok(inn.some(b => Math.abs(b[2] - b[0] - (sb.hole.sizeMm - sb.kerfMm)) < 0.05), `O: ${k} round hole cut = size - kerf`);
    // DXF in mm, PDF at 1:1
    const dx = SB.dxf(sb, k);
    assert.ok(/\$INSUNITS\s*\n\s*70\s*\n\s*4\b/.test(dx) && /OUTER_CUT/.test(dx) && /INNER_CUTS/.test(dx) && /CALIBRATION/.test(dx), `O: ${k} DXF in mm with layers`);
    const pdf = SB.pdf(sb, k), mb = pdf.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
    approx(+mb[1] / 72 * IN, info.w, 0.01, `O: ${k} PDF page 1:1`);
    n++;
  });
  // every hole style on every body builds; thin bridges flagged
  const styles = SB.HOLE_STYLES.map(h => h[0]);
  KEYS.forEach(k => styles.forEach(h => {
    const sb = SB.build(build(`${k}-false-plate`).meta, { soundHole: h });
    assert.ok(sb.layers.outer.length >= 1, `O: ${k} ${h} builds`);
    assert.strictEqual(sb.problems.length, 0, `O: ${k} ${h} default placement is clean: ${JSON.stringify(sb.warnings)}`);
  }));
  const thin = SB.build(build('parlor-false-plate').meta, { soundHole: 'ports', holeCount: 8, holeSpacingMm: 12, holeSizeMm: 10 });
  assert.ok(thin.problems.some(p => p.mm < SB.MIN_BRIDGE_MM) && thin.warnings.some(w => /Thin wood/.test(w)), 'O: a 2 mm bridge between ports is flagged');
  // screw-on top: clearance holes cut, heads engraved
  const st = B.build(P('parlor', { screwTop: true })), sst = SB.build(st.meta, {});
  assert.strictEqual(sst.screws.count, st.meta.screwTop.count, 'O: one top hole per tab');
  // plate marks: 7in x 4-3/4in, 1/2 x 0.28in slots, engrave layer, off by default
  const lp = build('license-plate-false-plate').meta;
  assert.ok(!SB.build(lp, {}).plate, 'O: plate marks off by default');
  const pm = SB.build(lp, { plateMarks: true });
  approx(pm.plate.spec.spanAlongMm, 7 * IN, 1e-9, 'O: plate slots 7in apart along'); approx(pm.plate.spec.spanAcrossMm, 4.75 * IN, 1e-9, 'O: 4-3/4in across');
  approx(pm.plate.spec.slotLongMm, 0.5 * IN, 1e-9, 'O: 1/2in slots'); approx(pm.plate.spec.slotShortMm, 0.28 * IN, 1e-9, 'O: 0.28in slots');
  // pickups: presets, kerf, clearances, brace warning, depth
  const par = build('parlor-false-plate').meta;
  const p1 = SB.build(par, { soundHole: 'none', pickup: 'humbucker' });
  assert.ok(p1.pickups && p1.pickups.lengthMm === 71 && p1.pickups.widthMm === 39 && p1.problems.length === 0, 'O: humbucker preset placed clear');
  const pinn = svgInfo(SB.svg(p1, 'p')).groups.inner.map(p => bb([p]));
  assert.ok(pinn.some(b => Math.abs(b[2] - b[0] - (71 - p1.kerfMm)) < 0.05 && Math.abs(b[3] - b[1] - (39 - p1.kerfMm)) < 0.05), 'O: pickup cut = cutout - kerf');
  approx(p1.pickups.depthFromSurfaceMm, par.topPanel.topSurfaceZ - par.floorMm, 1e-6, 'O: cavity depth reported');
  const p3 = SB.build(par, { soundHole: 'none', pickup: 'single', pickupCount: 3, pickupScrews: true });
  assert.ok(p3.pickups.count === 3 && p3.pickups.screws.count === 6 && p3.problems.every(p => p.kind === 'pickup-brace'), 'O: 3 single-coil style with screws');
  const ov = SB.build(par, { soundHole: 'none', pickup: 'humbucker', pickupYPct: par.braces.positionsPct[1] });
  assert.ok(ov.pickups.overBraces.length === 1 && ov.warnings.some(w => /over a ladder brace/.test(w)), 'O: pickup over a ladder brace warned');
  const nearHole = SB.build(par, { soundHole: 'round', pickup: 'humbucker', pickupYPct: SB.build(par, {}).hole.yPct });
  assert.ok(nearHole.problems.some(p => p.kind === 'pickup-hole'), 'O: pickup on the sound hole flagged');
  const shelf = SB.build(par, { soundHole: 'none', pickup: 'custom', pickupLengthMm: 160, pickupWidthMm: 30, pickupYPct: 40 });
  assert.ok(shelf.problems.some(p => p.kind === 'pickup-shelf'), 'O: pickup onto the glue shelf flagged');
  const blk = SB.build(par, { soundHole: 'none', pickup: 'humbucker', pickupYPct: 85 });
  assert.ok(blk.problems.some(p => p.kind === 'pickup-block'), 'O: pickup into the neck block flagged');
  const cu = SB.build(par, { soundHole: 'none', pickup: 'custom', pickupLengthMm: 60, pickupWidthMm: 20, pickupCornerMm: 10 });
  assert.ok(cu.pickups.cornerMm === 10 && Math.abs(cu.pickupAreaMm2 - (60 * 20 - (4 - Math.PI) * 100)) < 3, 'O: custom rectangle corner radius');
  console.log(`Body O ok: ${n} soundboards export 1:1 (SVG mm viewBox, DXF mm, PDF), kerf ${SB.DEFAULTS.kerfMm} / press fit ${SB.DEFAULTS.pressFitMm}, ${styles.length} hole styles x ${KEYS.length} bodies clean, plate marks, pickups`);
}

// === Body K: random shapes stay watertight ==================================
{
  let seed = 20261113;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const N = +(process.env.BODY_FUZZ || 24);
  for (let i = 0; i < N; i++) {
    const k = B.STYLE_KEYS[Math.floor(rnd() * B.STYLE_KEYS.length)], base = B.styleParams(k);
    const p = Object.assign(base, {
      lengthIn: base.lengthIn * (0.85 + rnd() * 0.3), depthIn: 1.4 + rnd() * 2.6, wallMm: 2 + rnd() * 4, floorMm: 2 + rnd() * 3,
      shelfWidthMm: 4 + rnd() * 6, shelfLipMm: 0.8 + rnd() * 2.5, shelfAllowanceMm: rnd() * 0.6,
      pocketLengthIn: 2 + rnd() * 1.2, pocketWidthIn: 1.25 + rnd() * 0.6, pocketCornerMm: rnd() * 10,
      pocketWallMm: 2 + rnd() * 8, ribMm: 2 + rnd() * 3, pocketFloorMm: 2 + rnd() * 8, pocketEndWallMm: 2 + rnd() * 8,
      neckScrewMode: rnd() < 0.5 ? 'plate' : 'wells', accessPanel: rnd() < 0.6, accessLengthMm: 60 + rnd() * 80, accessWidthMm: 40 + rnd() * 60,
      accessCornerMm: 5 + rnd() * 25, accessPos: 0.2 + rnd() * 0.3, coverThicknessMm: 2.5 + rnd() * 3, coverScrews: Math.floor(rnd() * 7),
      leftHanded: rnd() < 0.5, neckBlockRibs: rnd() < 0.5, ladderBraces: rnd() < 0.7, braceCount: 1 + Math.floor(rnd() * 4),
      braceWidthMm: 4 + rnd() * 8, braceHeightMm: 6 + rnd() * 14, braceEndHeightMm: 3 + rnd() * 4,
      screwTop: rnd() < 0.5, topScrewCount: rnd() < 0.5 ? 0 : 4 + Math.floor(rnd() * 8), topScrewSize: ['#4', '#6', '#8'][Math.floor(rnd() * 3)],
      tabBossMm: 9 + rnd() * 4, tabDepthMm: 8 + rnd() * 10
    });
    const r = B.build(p);
    assert.strictEqual(edgeErrors(r.body), 0, `K: random body ${i} (${k}) watertight`);
    if (r.cover) assert.strictEqual(edgeErrors(r.cover), 0, `K: random cover ${i} (${k}) watertight`);
    assert.strictEqual(minusScrewCrescents(r, overhangs(r.slabs.levels, r.slabs.body, B.STEP_MM)).filter(b => !r.meta.neckScrews.wells || Math.abs(b.z - r.meta.neckScrews.wellTopZ) > 1e-3).length, 0,
      `K: random body ${i} (${k}) support-free`);
  }
  console.log(`Body K ok: ${N} random bodies watertight and support-free`);
}

console.log('\nALL BODY TESTS PASSED');
