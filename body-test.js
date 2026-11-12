/* Headless body builder tests: node body-test.js (also run by node test.js) */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ClipperLib = require('./vendor/clipper.js');
const B = require('./body-geometry.js');
const STL = require('./stl.js');

const IN = 25.4;

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

function bounds(t) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], t[i + k]); b[k + 3] = Math.max(b[k + 3], t[i + k]); }
  }
  return b;
}

const built = {};
function build(name, p) {
  if (!built[name]) built[name] = B.build(p);
  return built[name];
}

// === Body A: style presets, generic names, Custom detection ==============
{
  assert.deepStrictEqual(B.STYLE_KEYS, ['parlor', 'small-dread', 'round', 'cigar-box']);
  B.STYLE_KEYS.forEach(k => {
    const p = B.styleParams(k);
    assert.strictEqual(p.style, k);
    assert.strictEqual(B.matchStyle(p), k, `A: ${k} matches itself`);
    assert.ok(p.lengthIn * IN < 327.66, `A: ${k} preset is shorter than the 12.9in bed`);
    const edited = Object.assign({}, p, { depthIn: p.depthIn + 0.1 });
    assert.strictEqual(B.matchStyle(edited), 'custom', `A: editing ${k} -> custom`);
  });
  // no brand or model names anywhere in the body builder's files
  const banned = ['Fen' + 'der', 'Gib' + 'son', 'Tele' + 'caster', 'Mar' + 'tin', 'Les ' + 'Paul', 'Str' + 'at'];
  const re = new RegExp('\\b(' + banned.join('|') + ')', 'i');
  ['body-builder.html', 'body-app.js', 'body-geometry.js', 'body-test.js', 'preview.js'].forEach(f => {
    const txt = fs.readFileSync(path.join(__dirname, f), 'utf8');
    const m = txt.match(re);
    assert.ok(!m, `A: ${f} mentions "${m && m[0]}"`);
  });
  console.log('Body A ok: 4 generic style presets, all under the bed, edits switch to Custom, no brand names');
}

// === Body B: outline =====================================================
{
  const p = B.styleParams('parlor');
  const sh = B.shapeOf(p);
  const L = p.lengthIn * IN;
  approx(B.halfWidth(sh, p.lowerPos * L) * 2, p.lowerWidthIn * IN, 1e-6, 'B: lower bout width');
  approx(B.halfWidth(sh, p.waistPos * L) * 2, p.waistWidthIn * IN, 1e-6, 'B: waist width');
  approx(B.halfWidth(sh, p.upperPos * L) * 2, p.upperWidthIn * IN, 1e-6, 'B: upper bout width');
  assert.strictEqual(B.halfWidth(sh, 0), 0);
  assert.strictEqual(B.halfWidth(sh, L), 0);
  const pts = B.outlinePoints(sh);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  assert.ok(area > 0, 'B: outline is counter-clockwise');
  // round = a circle
  const r = B.shapeOf(B.styleParams('round'));
  approx(B.halfWidth(r, r.L / 2) * 2, 11.5 * IN, 1e-6, 'B: round width');
  approx(B.halfWidth(r, r.L / 4), Math.sqrt(1 - 0.25) * r.L / 2, 1e-6, 'B: round is a circle');
  // box = straight sides, rounded corners
  const bx = B.shapeOf(B.styleParams('cigar-box'));
  approx(B.halfWidth(bx, bx.L / 2) * 2, 7 * IN, 1e-6, 'B: box width');
  approx(B.halfWidth(bx, bx.L * 0.2) * 2, 7 * IN, 1e-6, 'B: box sides straight');
  console.log('Body B ok: outline passes through the bout / waist widths; round is a circle; box is straight-sided');
}

// === Body C: watertight halves, mirror images, flat on the bed ===========
{
  const cases = {
    parlor: B.styleParams('parlor'),
    'small-dread': B.styleParams('small-dread'),
    round: B.styleParams('round'),
    'cigar-box': B.styleParams('cigar-box'),
    wells: Object.assign(B.styleParams('parlor'), { neckScrewMode: 'wells' }),
    bolts2: Object.assign(B.styleParams('small-dread'), { neckBolts: 2, boltSize: '#6' }),
    m3shallow: Object.assign(B.styleParams('round'), { boltSize: 'M3', depthIn: 2.5 })
  };
  Object.keys(cases).forEach(name => {
    const r = build(name, cases[name]);
    const L = r.groups.left, R = r.groups.right;
    assert.strictEqual(edgeErrors(L), 0, `C ${name}: left half not watertight`);
    assert.strictEqual(edgeErrors(R), 0, `C ${name}: right half not watertight`);
    const vl = signedVolume(L), vr = signedVolume(R);
    assert.ok(vl > 0 && vr > 0, `C ${name}: outward normals`);
    approx(vl / vr, 1, 1e-4, `C ${name}: halves have equal volume (mirror images)`);
    const bl = bounds(L), br = bounds(R);
    approx(bl[2], 0, 1e-6, `C ${name}: left half sits on z = 0`);
    approx(br[2], 0, 1e-6, `C ${name}: right half sits on z = 0`);
    approx(bl[3], 0, 1e-6, `C ${name}: left half ends at the split plane`);
    approx(br[0], 0, 1e-6, `C ${name}: right half starts at the split plane`);
    approx(-bl[0], br[3], 1e-3, `C ${name}: mirror widths`);
    approx(bl[5], r.meta.depthMm, 1e-3, `C ${name}: full depth`);
    assert.ok(bl[4] - bl[1] < r.meta.bedMm, `C ${name}: fits the bed`);
  });
  console.log('Body C ok: 7 configurations, both halves closed and consistently wound, mirror images, flat on the bed');
}

// === Body D: panel tracks ================================================
{
  const p = B.styleParams('parlor');
  const r = build('parlor', p);
  const m = r.meta;
  const D = m.depthMm, t = p.panelThicknessMm, fit = p.panelFitMm, g = p.grooveDepthMm;
  approx(m.topSlot[1] - m.topSlot[0], t + fit, 1e-9, 'D: top slot height = panel + clearance');
  approx(D - m.topSlot[1], p.topLipMm, 1e-9, 'D: top lip');
  approx(m.bottomSlot[0], p.bottomLipMm, 1e-9, 'D: bottom lip');
  approx(m.bottomSlot[1] - m.bottomSlot[0], t + fit, 1e-9, 'D: bottom slot height');
  // at the widest point of the lower bout, the wall inside face is at
  // hw - wall; the track goes g further into the wall
  const sh = B.shapeOf(p);
  const y = p.lowerPos * sh.L, hw = B.halfWidth(sh, y);
  const inner = hw - p.wallMm;
  const zTop = (m.topSlot[0] + m.topSlot[1]) / 2, zBot = (m.bottomSlot[0] + m.bottomSlot[1]) / 2;
  [['top', zTop], ['back', zBot]].forEach(([name, z]) => {
    assert.ok(!B.solidAt(r, 'left', -(inner + g - 0.2), y, z), `D ${name}: track ${g} mm into the wall is open`);
    assert.ok(B.solidAt(r, 'left', -(inner + g + 0.2), y, z), `D ${name}: wall behind the track is solid`);
    assert.ok(!B.solidAt(r, 'right', inner + g - 0.2, y, z), `D ${name}: right track open`);
  });
  // lips above / below the tracks are solid wall all the way to the inside face
  assert.ok(B.solidAt(r, 'left', -(inner + 0.2), y, D - 0.3), 'D: top lip solid');
  assert.ok(!B.solidAt(r, 'left', -(inner - 0.2), y, D - 0.3), 'D: inside of the top lip is open');
  assert.ok(B.solidAt(r, 'left', -(inner + 0.2), y, p.bottomLipMm - 0.3), 'D: bottom lip solid');
  // 45-degree staircase roof above each track: 1 step up, the track is one step shallower
  const step = B.STEP_MM;
  assert.ok(!B.solidAt(r, 'left', -(inner + g - step - 0.1), y, m.topSlot[1] + step / 2), 'D: roof step 1 open');
  assert.ok(B.solidAt(r, 'left', -(inner + g - step + 0.1), y, m.topSlot[1] + step / 2), 'D: roof step 1 closes in by one step');
  console.log('Body D ok: top and back tracks', (t + fit).toFixed(3), 'mm tall,', g, 'mm deep, with 45deg stepped roofs');
}

// === Body E: panels slide in sideways and sit in the tracks ==============
{
  const BIG = 2000 * 1000;
  function sweptArea(r, half, panelPaths, z) {
    const lv = r.slabs.levels, zi = z * 1000;
    let k = 0;
    while (!(zi >= lv[k] && zi < lv[k + 1])) k++;
    const mat = r.slabs[half][k];
    // The left half closes in moving +x: its material at final position m
    // passes through m - d (d >= 0), so it hits the panel iff m lies in
    // the panel swept towards +x. Mirror for the right half.
    const dir = half === 'left' ? 1 : -1;
    const seg = [{ X: 0, Y: 0 }, { X: dir * BIG, Y: 0 }, { X: dir * BIG, Y: 1 }, { X: 0, Y: 1 }];
    let swept = [];
    panelPaths.forEach(pp => {
      const ip = pp.map(q => ({ X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }));
      swept = swept.concat(ClipperLib.Clipper.MinkowskiSum(seg, ip, true), [ip]);
    });
    const c = new ClipperLib.Clipper();
    c.AddPaths(swept, ClipperLib.PolyType.ptSubject, true);
    const u = new ClipperLib.Paths();
    c.Execute(ClipperLib.ClipType.ctUnion, u, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const c2 = new ClipperLib.Clipper();
    c2.AddPaths(u, ClipperLib.PolyType.ptSubject, true);
    c2.AddPaths(mat, ClipperLib.PolyType.ptClip, true);
    const out = new ClipperLib.Paths();
    c2.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return out.reduce((a, q) => a + Math.abs(ClipperLib.Clipper.Area(q)), 0) / 1e6;
  }
  ['parlor', 'small-dread', 'round', 'cigar-box'].forEach(name => {
    const r = build(name, B.styleParams(name));
    const m = r.meta;
    const zT = (m.topSlot[0] + m.topSlot[1]) / 2, zB = (m.bottomSlot[0] + m.bottomSlot[1]) / 2;
    ['left', 'right'].forEach(half => {
      assert.ok(sweptArea(r, half, m.panels.top.outline, zT) < 0.01, `E ${name}: top panel collides with the ${half} half while closing`);
      assert.ok(sweptArea(r, half, m.panels.back.outline, zB) < 0.01, `E ${name}: back panel collides with the ${half} half while closing`);
    });
    // the panels really are captured: they reach past the inside face of the wall
    const p = B.styleParams(name);
    const sh = B.shapeOf(p);
    // measured where the wall runs straight along y (widest point), so
    // the horizontal and the true (normal) track depth are the same
    const yMid = sh.kind === 'box' ? sh.L / 2 : sh.c1;
    const innerHalf = B.halfWidth(sh, yMid) - p.wallMm;
    const toI = pp => pp.map(q => ({ X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }));
    const engage = p.grooveDepthMm - p.panelEdgeGapMm - 0.3;
    ['top', 'back'].forEach(which => {
      [-1, 1].forEach(side => {
        const pt = { X: Math.round(side * (innerHalf + engage) * 1000), Y: Math.round(yMid * 1000) };
        assert.ok(m.panels[which].outline.some(pp => ClipperLib.Clipper.PointInPolygon(pt, toI(pp)) !== 0),
          `E ${name}: ${which} panel reaches ${engage.toFixed(1)} mm past the inside of the wall`);
      });
    });
  });
  // the top panel has the pocket notch: no ply where the neck goes
  const r = build('parlor');
  const m = r.meta;
  const c = new ClipperLib.Clipper();
  const notchPt = { X: 0, Y: Math.round((m.lengthMm - 10) * 1000) };
  const inPanel = m.panels.top.outline.some(pp => ClipperLib.Clipper.PointInPolygon(notchPt, pp.map(q => ({ X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }))) !== 0);
  assert.ok(!inPanel, 'E: top panel is notched for the neck pocket');
  console.log('Body E ok: both panels clear each half as it closes in sideways, reach into the tracks, top panel notched');
}

// === Body F: neck pocket, block and screw holes ==========================
{
  const p = B.styleParams('parlor');
  const r = build('parlor', p);
  const m = r.meta;
  const L = m.lengthMm;
  approx(m.pocket.lengthMm, 3 * IN, 1e-9, 'F: pocket 3in long');
  approx(m.pocket.widthMm, 1.5 * IN + 2 * p.pocketFitMm, 1e-9, 'F: pocket 1.5in wide + fit');
  approx(m.panelTopZ - m.pocketFloorZ, 0.9 * IN, 1e-9, 'F: floor 0.9in below the top of the top panel');
  const zF = m.pocketFloorZ, yc = L - m.pocket.lengthMm / 2;
  // inside the pocket: open above the floor, solid just below it
  assert.ok(!B.solidAt(r, 'left', -5, yc + 5, zF + 0.5), 'F: pocket open above the floor');
  assert.ok(B.solidAt(r, 'left', -5, yc + 5, zF - 0.5), 'F: pocket floor solid');
  // pocket side walls: solid neck-block wall just outside the pocket width
  assert.ok(B.solidAt(r, 'left', -(m.pocket.widthMm / 2 + 1), yc, zF + 5), 'F: pocket side wall');
  assert.ok(B.solidAt(r, 'left', -(m.pocket.widthMm / 2 + p.neckBlockSideMm - 1), yc, zF + 5), 'F: side wall is a full block thick');
  // pocket end wall
  assert.ok(B.solidAt(r, 'left', -5, L - m.pocket.lengthMm - 1, zF + 5), 'F: pocket end wall');
  // the clamping column: solid all the way from the pocket floor down to
  // the back face (z = 0) beside each screw, except the bolt hole
  const boltY = m.bolts[0].yMm;
  for (let z = 0.2; z < zF; z += 0.5) {
    m.neckScrews.forEach(s => {
      if (s.x > 0) return;
      assert.ok(!B.solidAt(r, 'left', s.x, s.y, z), `F: screw hole open at z=${z.toFixed(1)}`);
      assert.ok(B.solidAt(r, 'left', s.x - p.neckScrewHoleMm / 2 - 1, s.y, z), `F: solid beside the screw at z=${z.toFixed(1)}`);
    });
    if (Math.abs(z - m.bolts[0].zMm) > 8) assert.ok(B.solidAt(r, 'left', -5, boltY, z), `F: solid under the pocket at z=${z.toFixed(1)}`);
  }
  approx(m.plasticUnderPocketMm, zF, 1e-9, 'F: plate mode clamps the whole block');
  assert.ok(m.plasticUnderPocketMm > 40, 'F: >40 mm of block under the pocket');
  // the back plate lands on the flat back face (printed on the bed)
  assert.ok(B.solidAt(r, 'left', -20, yc, 0.1), 'F: back face solid where the plate lands');
  // wells mode: counterbores from the back stop wellFloorMm under the pocket
  const w = build('wells', Object.assign(B.styleParams('parlor'), { neckScrewMode: 'wells' }));
  const s0 = w.meta.neckScrews[0];
  const zW = w.meta.pocketFloorZ - p.wellFloorMm;
  assert.ok(!B.solidAt(w, 'left', s0.x + p.wellDiameterMm / 2 - 1, s0.y, zW - 0.5), 'F: well open below the floor');
  assert.ok(B.solidAt(w, 'left', s0.x + p.wellDiameterMm / 2 - 1, s0.y, zW + 4), 'F: well roof closes (45deg)');
  approx(w.meta.plasticUnderPocketMm, p.wellFloorMm, 1e-9, 'F: wells keep the floor');
  assert.ok(w.meta.neckScrewLengthIn <= 2, 'F: wells take standard short screws');
  console.log('Body F ok: pocket', (m.pocket.lengthMm / IN).toFixed(2), 'x', (m.pocket.widthMm / IN).toFixed(3),
    'in, floor', (0.9).toFixed(1), 'in below the top;', m.plasticUnderPocketMm.toFixed(1), 'mm solid block under it;',
    'screws', m.neckScrewLengthIn + 'in (plate) /', w.meta.neckScrewLengthIn + 'in (wells)');
}

// === Body G: clamshell bolts through the neck and tail blocks ============
{
  const p = B.styleParams('parlor');
  const r = build('parlor', p);
  const m = r.meta;
  assert.deepStrictEqual(m.bolts.map(b => b.name), ['neck', 'tail']);
  const bolt = B.BOLTS[p.boltSize];
  m.bolts.forEach(b => {
    // clear hole right across both halves at the bolt centre
    [-60, -20, -1].forEach(x => assert.ok(!B.solidAt(r, 'left', x, b.yMm, b.zMm), `G ${b.name}: hole open at x=${x}`));
    [1, 20, 60].forEach(x => assert.ok(!B.solidAt(r, 'right', x, b.yMm, b.zMm), `G ${b.name}: hole open at x=${x}`));
    // material just outside the hole radius
    assert.ok(B.solidAt(r, 'left', -20, b.yMm + bolt.holeMm / 2 + 0.6, b.zMm), `G ${b.name}: solid beside the hole`);
    // teardrop: open a little above the round top, closed further up
    assert.ok(!B.solidAt(r, 'left', -20, b.yMm, b.zMm + bolt.holeMm / 2 + 0.3), `G ${b.name}: teardrop point`);
    assert.ok(B.solidAt(r, 'left', -20, b.yMm, b.zMm + bolt.holeMm / 2 * Math.SQRT2 + 0.6), `G ${b.name}: solid above the teardrop`);
    // flat washer seat (spot face) at the outside wall
    assert.ok(b.gripMm > 50 && b.gripMm < 2 * B.halfWidth(B.shapeOf(p), b.yMm), `G ${b.name}: grip ${b.gripMm}`);
    assert.ok(!B.solidAt(r, 'left', -(b.gripMm / 2 + 0.5), b.yMm + bolt.washerMm / 2 - 0.3, b.zMm), `G ${b.name}: washer seat cut`);
    assert.ok(B.solidAt(r, 'left', -(b.gripMm / 2 - 0.5), b.yMm + bolt.washerMm / 2 - 0.3, b.zMm), `G ${b.name}: washer seat is flat (solid inside it)`);
  });
  // the neck bolt passes between the two rows of neck screws, under the pocket floor
  const nb = m.bolts[0];
  const rows = [...new Set(m.neckScrews.map(s => s.y.toFixed(3)))].map(Number);
  assert.ok(Math.min(...rows) < nb.yMm && nb.yMm < Math.max(...rows), 'G: neck bolt between the screw rows');
  assert.ok(nb.zMm + bolt.washerMm < m.pocketFloorZ, 'G: neck bolt well under the pocket floor');
  // no tail bolt -> warning
  const nt = B.build(Object.assign(B.styleParams('cigar-box'), { tailBolts: 0 }));
  assert.ok(nt.warnings.some(w => /tail bolt/i.test(w)), 'G: warns without a tail bolt');
  console.log('Body G ok: neck + tail bolts (' + p.boltSize + ') clear through both halves with teardrop tops and flat washer seats; grips',
    m.bolts.map(b => b.gripMm.toFixed(0) + ' mm').join(' / '));
}

// === Body H: printable without supports, bed checks ======================
{
  B.STYLE_KEYS.forEach(k => {
    const r = build(k, B.styleParams(k));
    assert.ok(r.meta.overhang.widestLedgeMm <= 1.0, `H ${k}: overhang ledge ${r.meta.overhang.widestLedgeMm} mm`);
    assert.deepStrictEqual(r.warnings, [], `H ${k}: preset builds without warnings`);
    assert.ok(r.meta.fitsBed, `H ${k}: fits the bed`);
  });
  const long = B.build(Object.assign(B.styleParams('cigar-box'), { lengthIn: 13.2 }));
  assert.ok(!long.meta.fitsBed && long.warnings.some(w => /print bed/.test(w)), 'H: 13.2in body warns about the bed');
  const shallow = B.build(Object.assign(B.styleParams('round'), { depthIn: 1.6 }));
  assert.ok(shallow.warnings.length > 0, 'H: very shallow body warns');
  console.log('Body H ok: every overhang <= 1 mm (45deg staircases), presets warning-free, bed and depth checks warn');
}

// === Body I: SVG / DXF / STL output ======================================
{
  const r = build('parlor');
  const top = r.meta.panels.top;
  const svg = B.panelSVG(top.outline, 'Top panel');
  const wm = svg.match(/width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  assert.ok(wm, 'I: SVG sized in mm with a matching viewBox');
  approx(Number(wm[1]), top.sizeMm[0] + 20, 0.01, 'I: SVG width = panel width + 2 x 10 mm margin (1:1)');
  approx(Number(wm[1]), Number(wm[3]), 1e-6, 'I: 1 user unit = 1 mm');
  assert.ok(/100 mm check bar/.test(svg), 'I: SVG has a scale check bar');
  const dxf = B.panelDXF(top.outline);
  const lines = (dxf.match(/\nLINE\n/g) || []).length;
  assert.strictEqual(lines, top.outline.reduce((a, pp) => a + pp.length, 0), 'I: DXF has one LINE per outline edge');
  assert.ok(/\$INSUNITS\n70\n4\n/.test(dxf), 'I: DXF units are millimetres');
  const bytes = STL.trianglesToBytes(r.groups.left);
  assert.strictEqual(bytes.length, 84 + 50 * r.groups.left.length / 9, 'I: STL size');
  console.log('Body I ok: 1:1 SVG (mm), DXF in mm, binary STL for each half');
}

// === Body J: random shapes stay watertight ===============================
{
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const N = 6;
  for (let n = 0; n < N; n++) {
    const p = B.styleParams(pick(B.STYLE_KEYS));
    Object.assign(p, {
      lengthIn: Math.min(12.85, p.lengthIn * (0.85 + rnd() * 0.2)), depthIn: 2.4 + rnd() * 1.5,
      wallMm: 5 + rnd() * 3, grooveDepthMm: 1.5 + rnd() * 2, panelThicknessMm: pick([3.175, 3, 4]),
      topLipMm: 4 + rnd() * 2, neckScrewMode: pick(['plate', 'wells']), boltSize: pick(['M3', 'M4', '#6']),
      neckBolts: pick([1, 2]), pocketWidthIn: pick([1.375, 1.5, 1.625])
    });
    const r = B.build(p);
    assert.strictEqual(edgeErrors(r.groups.left) + edgeErrors(r.groups.right), 0, `J ${n}: watertight ${JSON.stringify(p)}`);
  }
  console.log('Body J ok:', N, 'random bodies watertight');
}

console.log('\nALL BODY TESTS PASSED');
