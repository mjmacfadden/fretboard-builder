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
  assert.deepStrictEqual(B.STYLE_KEYS, ['parlor', 'small-dread', 'round', 'cigar-box', 't-style']);
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
  console.log('Body A ok: 5 generic style presets, all under the bed, edits switch to Custom, no brand names');
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
  // T-Style: single cutaway, slab outline, squared-off neck end
  const tp = B.styleParams('t-style');
  const ts = B.shapeOf(tp);
  approx(ts.L, 12.5 * IN, 1e-9, 'B: T-Style length');
  const tpts = B.outlinePoints(ts);
  const txs = tpts.map(q => q[0]), tys = tpts.map(q => q[1]);
  approx(Math.max(...txs) - Math.min(...txs), 10 * IN, 0.5, 'B: T-Style width');
  approx(Math.max(...tys), ts.L, 1e-6, 'B: T-Style reaches the neck end');
  approx(15.9 / 12.75, ts.L / (Math.max(...txs) - Math.min(...txs)), 0.02, 'B: T-Style keeps the published length:width proportion');
  approx(B.halfWidth(ts, ts.c1, 'left'), B.halfWidth(ts, ts.c1, 'right'), 1e-6, 'B: T-Style lower bout symmetric');
  const yCut = 0.8 * ts.L;
  assert.ok(B.halfWidth(ts, yCut, 'right') < B.halfWidth(ts, yCut, 'left') - 15, 'B: T-Style cutaway on the treble (right, +x) side');
  // flat neck end: both sides still have width just below the neck end
  assert.ok(B.halfWidth(ts, ts.L - 0.5, 'right') > 25 && B.halfWidth(ts, ts.L - 0.5, 'left') > 25, 'B: T-Style neck end is squared off');
  const lh = B.shapeOf(Object.assign(B.styleParams('t-style'), { leftHanded: true }));
  approx(B.halfWidth(lh, yCut, 'left'), B.halfWidth(ts, yCut, 'right'), 1e-9, 'B: left-handed mirrors the cutaway');
  assert.strictEqual(lh.cutawaySide, 'left');
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
    m3shallow: Object.assign(B.styleParams('round'), { boltSize: 'M3', depthIn: 2.5 }),
    't-style': B.styleParams('t-style'),
    'tstyle-lefty-insert': Object.assign(B.styleParams('t-style'), { leftHanded: true, collarFastener: 'insert', neckBolts: 1 }),
    'no-collar': Object.assign(B.styleParams('parlor'), { neckCollar: false, neckBolts: 1 })
  };
  Object.keys(cases).forEach(name => {
    const r = build(name, cases[name]);
    const L = r.groups.left, R = r.groups.right;
    assert.strictEqual(edgeErrors(L), 0, `C ${name}: left half not watertight`);
    assert.strictEqual(edgeErrors(R), 0, `C ${name}: right half not watertight`);
    const vl = signedVolume(L), vr = signedVolume(R);
    assert.ok(vl > 0 && vr > 0, `C ${name}: outward normals`);
    const bl = bounds(L), br = bounds(R);
    if (r.meta.symmetric) {
      approx(vl / vr, 1, 1e-4, `C ${name}: halves have equal volume (mirror images)`);
      approx(-bl[0], br[3], 1e-3, `C ${name}: mirror widths`);
    } else {
      // asymmetric outline: each half is its own shape, still on the bed
      approx(-bl[0], r.meta.leftFootprintMm[0], 1e-3, `C ${name}: left width`);
      approx(br[3], r.meta.rightFootprintMm[0], 1e-3, `C ${name}: right width`);
      assert.ok(Math.abs(vl - vr) / vr > 0.02, `C ${name}: halves really differ`);
      assert.ok(r.meta.leftFootprintMm[0] < r.meta.bedMm && r.meta.rightFootprintMm[0] < r.meta.bedMm, `C ${name}: both halves fit the bed`);
    }
    if (r.groups.collar) {
      const C = r.groups.collar, bc = bounds(C);
      assert.strictEqual(edgeErrors(C), 0, `C ${name}: neck collar not watertight`);
      assert.ok(signedVolume(C) > 0, `C ${name}: collar outward normals`);
      approx(bc[2], r.meta.pocketFloorZ, 1e-3, `C ${name}: collar's flat underside is at the pocket floor`);
      approx(bc[5], r.meta.topSlot[0], 1e-3, `C ${name}: collar's top is under the top panel`);
      assert.ok(bc[3] - bc[0] < r.meta.bedMm && bc[4] - bc[1] < r.meta.bedMm, `C ${name}: collar fits the bed`);
    } else {
      assert.ok(!r.meta.collar, `C ${name}: no collar part when it is off`);
    }
    approx(bl[2], 0, 1e-6, `C ${name}: left half sits on z = 0`);
    approx(br[2], 0, 1e-6, `C ${name}: right half sits on z = 0`);
    approx(bl[3], 0, 1e-6, `C ${name}: left half ends at the split plane`);
    approx(br[0], 0, 1e-6, `C ${name}: right half starts at the split plane`);
    approx(bl[5], r.meta.depthMm, 1e-3, `C ${name}: full depth`);
    assert.ok(bl[4] - bl[1] < r.meta.bedMm, `C ${name}: fits the bed`);
  });
  console.log('Body C ok:', Object.keys(cases).length, 'configurations, halves and neck collar closed and consistently wound, mirrored (or per-side for T-Style), flat on the bed');
}

// === Body D: panel channels ==============================================
// Each panel edge sits in a channel: an inward flange ring with a solid lip
// on each face of the panel. r = distance in from the channel back (the
// inside face of the wall), measured at the widest point of the lower bout.
{
  const p = B.styleParams('parlor');
  const r = build('parlor', p);
  const m = r.meta, ch = m.channel;
  const D = m.depthMm, t = p.panelThicknessMm, fit = p.panelFitMm;
  const cD = p.channelDepthMm, cA = p.channelRoofFlatMm, ec = p.panelEdgeGapMm;
  approx(m.topSlot[1] - m.topSlot[0], t + fit, 1e-9, 'D: top channel height = panel + clearance');
  approx(m.bottomSlot[1] - m.bottomSlot[0], t + fit, 1e-9, 'D: back channel height');
  approx(m.bottomSlot[0], p.bottomLipMm, 1e-9, 'D: bottom lip under the back panel');
  approx(D - m.topSlot[1], (cD - cA) + p.topLipMm, 1e-9, 'D: rim above the top channel = 45deg climb + top lip');
  approx(ch.engagementMm, cD - ec, 1e-9, 'D: engagement');
  assert.ok(ch.engagementMm >= 6 && ch.engagementMm <= 8, 'D: 6-8 mm of each panel edge held');
  const sh = B.shapeOf(p);
  const y = p.lowerPos * sh.L, inner = B.halfWidth(sh, y) - p.wallMm;
  const X = (rr) => -(inner - rr);            // left half, rr mm in from the channel back
  const S = (rr, z) => B.solidAt(r, 'left', X(rr), y, z);
  const R = (rr, z) => B.solidAt(r, 'right', inner - rr, y, z);
  [['top', m.topSlot], ['back', m.bottomSlot]].forEach(([name, sl]) => {
    const z = (sl[0] + sl[1]) / 2;
    assert.ok(S(-0.3, z), `D ${name}: wall solid behind the channel`);
    assert.ok(!S(0.3, z) && !S(cD + 1, z) && !R(0.3, z), `D ${name}: channel open from the wall inwards`);
    // bearing lips just below and just above the panel, the full reach
    assert.ok(S(0.3, sl[0] - 0.2) && S(cD - 0.3, sl[0] - 0.2) && !S(cD + 0.3, sl[0] - 0.2), `D ${name}: lip under the panel reaches ${cD} mm`);
    assert.ok(R(cD - 0.3, sl[0] - 0.2), `D ${name}: right half lip under the panel`);
    // the roof: flat for cA next to the wall, then 45 degrees
    assert.ok(S(cA - 0.3, sl[1] + 0.1) && !S(cA + 0.3, sl[1] + 0.1), `D ${name}: flat roof ${cA} mm wide`);
    assert.ok(S(cD - 0.3, sl[1] + (cD - cA) + 0.2), `D ${name}: roof climbs to the full reach`);
  });
  // lip thicknesses at the lip edge
  assert.ok(S(cD - 0.3, 0.2) && S(cD - 0.3, p.bottomLipMm - 0.2), 'D: back panel bottom lip solid to its edge, on the bed');
  assert.ok(S(cD - 0.3, ch.backLipTopZ - 0.2) && S(cD - 0.3, ch.backLipTopZ - p.innerLipMm + 0.2) && !S(cD - 0.3, ch.backLipTopZ + 0.2), 'D: back channel upper lip ' + p.innerLipMm + ' mm thick at its edge');
  assert.ok(S(cD - 0.3, m.topSlot[0] - p.innerLipMm + 0.2), 'D: top channel lower lip ' + p.innerLipMm + ' mm thick at its edge');
  assert.ok(S(cD - 0.3, D - 0.2) && S(cD - 0.3, D - p.topLipMm + 0.2), 'D: top lip ' + p.topLipMm + ' mm thick at its edge');
  // under the top channel's lower lip: a 45-degree corbel back to the wall
  const zMidC = ch.topCorbelFootZ + cD / 2;
  assert.ok(S(cD / 2 - 0.7, zMidC) && !S(cD / 2 + 0.7, zMidC), 'D: 45deg corbel under the top channel lip');
  assert.ok(!S(0.3, ch.topCorbelFootZ - 0.3), 'D: plain wall below the corbel');
  // the outside of the rim is untouched (a clean wall face)
  for (let z = 0.2; z < D; z += 1) assert.ok(S(-p.wallMm + 0.3, z), `D: outer wall solid at z=${z.toFixed(1)}`);
  console.log('Body D ok: channels', (t + fit).toFixed(3), 'mm tall,', cD, 'mm lips on both faces (', ch.engagementMm, 'mm of panel held ), flat roof', cA, 'mm then 45deg, lips',
    p.bottomLipMm + '/' + p.innerLipMm + '/' + p.innerLipMm + '/' + p.topLipMm, 'mm');
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
  ['parlor', 'small-dread', 'round', 'cigar-box', 't-style'].forEach(name => {
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
    const toI = pp => pp.map(q => ({ X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }));
    const inP = (which, x) => m.panels[which].outline.some(pp => ClipperLib.Clipper.PointInPolygon({ X: Math.round(x * 1000), Y: Math.round(yMid * 1000) }, toI(pp)) !== 0);
    ['top', 'back'].forEach(which => {
      [-1, 1].forEach(side => {
        const innerHalf = B.halfWidth(sh, yMid, side > 0 ? 'right' : 'left') - p.wallMm;
        // the panel runs under the whole lip (past its edge at cD) to
        // within the edge gap of the channel back
        assert.ok(inP(which, side * (innerHalf - p.channelDepthMm - 1)) && inP(which, side * (innerHalf - p.panelEdgeGapMm - 0.1)),
          `E ${name}: ${which} panel reaches ${(p.channelDepthMm - p.panelEdgeGapMm).toFixed(1)} mm under the lips`);
        assert.ok(!inP(which, side * (innerHalf - p.panelEdgeGapMm + 0.1)), `E ${name}: ${which} panel stops ${p.panelEdgeGapMm} mm short of the channel back`);
      });
    });
  });
  // the neck collar: set into one half sideways, then the other half
  // closes over it, exactly like the panels (checked at mid height)
  ['parlor', 't-style'].forEach(name => {
    const r = build(name, B.styleParams(name));
    const cl = r.slabs.collarLevels, zMid = (r.meta.collar.bottomZ + r.meta.collar.topZ) / 2;
    let k = 0;
    while (!(zMid * 1000 >= cl[k] && zMid * 1000 < cl[k + 1])) k++;
    const outline = r.slabs.collar[k].map(pp => pp.map(q => [q.X / 1000, q.Y / 1000]));
    ['left', 'right'].forEach(half => {
      assert.ok(sweptArea(r, half, outline, zMid) < 0.01, `E ${name}: neck collar collides with the ${half} half while closing`);
    });
  });
  // the top panel has the pocket notch: no ply where the neck goes
  const r = build('parlor');
  const m = r.meta;
  const c = new ClipperLib.Clipper();
  const notchPt = { X: 0, Y: Math.round((m.lengthMm - 10) * 1000) };
  const inPanel = m.panels.top.outline.some(pp => ClipperLib.Clipper.PointInPolygon(notchPt, pp.map(q => ({ X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }))) !== 0);
  assert.ok(!inPanel, 'E: top panel is notched for the neck pocket');
  console.log('Body E ok: both panels and the neck collar clear each half as it closes in sideways, reach into the tracks, top panel notched');
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
  // pocket side walls (in the neck collar by default): solid wall just
  // outside the pocket width, a full block thick, and the end wall
  const wy = yc + 8; // clear of the collar bolts
  assert.ok(B.solidAt(r, 'collar', -(m.pocket.widthMm / 2 + 1), wy, zF + 5), 'F: pocket side wall');
  assert.ok(B.solidAt(r, 'collar', -(m.pocket.widthMm / 2 + p.neckBlockSideMm - 1), wy, zF + 5), 'F: side wall is a full block thick');
  assert.ok(B.solidAt(r, 'collar', -2, L - m.pocket.lengthMm - 1, zF + 5), 'F: pocket end wall');
  // without the collar the same walls are part of the halves
  const nc = build('no-collar', Object.assign(B.styleParams('parlor'), { neckCollar: false, neckBolts: 1 }));
  assert.ok(B.solidAt(nc, 'left', -(m.pocket.widthMm / 2 + 1), wy, zF + 5), 'F: no collar: side wall in the half');
  assert.ok(B.solidAt(nc, 'left', -5, L - m.pocket.lengthMm - 1, zF + 5), 'F: no collar: end wall in the half');
  // the clamping column: solid all the way from the pocket floor down to
  // the back face (z = 0) beside each screw, except the bolt hole
  const boltY = yc;
  for (let z = 0.2; z < zF; z += 0.5) {
    m.neckScrews.forEach(s => {
      if (s.x > 0) return;
      assert.ok(!B.solidAt(r, 'left', s.x, s.y, z), `F: screw hole open at z=${z.toFixed(1)}`);
      assert.ok(B.solidAt(r, 'left', s.x - p.neckScrewHoleMm / 2 - 1, s.y, z), `F: solid beside the screw at z=${z.toFixed(1)}`);
    });
    assert.ok(B.solidAt(r, 'left', -5, boltY, z), `F: solid under the pocket at z=${z.toFixed(1)}`);
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
  // collar on by default: only the tail bolt runs sideways
  assert.deepStrictEqual(build('parlor', B.styleParams('parlor')).meta.bolts.map(b => b.name), ['tail', 'tail (upper)']);
  const p = Object.assign(B.styleParams('parlor'), { neckBolts: 1 });
  const r = build('parlor-neckbolt', p);
  const m = r.meta;
  assert.deepStrictEqual(m.bolts.map(b => b.name), ['neck', 'tail', 'tail (upper)']);
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
  // upper tail bolt: near the top of the tail block, right under the top
  // channel, through a full-width web of solid block (no cavity to crush)
  const up = m.bolts.find(b => b.name === 'tail (upper)'), lo = m.bolts.find(b => b.name === 'tail');
  assert.ok(up.zMm > m.topSlot[0] - 12 && up.zMm + bolt.washerMm / 2 * Math.SQRT2 + 1.5 <= m.topSlot[0], 'G: upper tail bolt just under the top channel');
  assert.ok(up.zMm - lo.zMm > 30, 'G: the two tail bolts clamp the bottom and the top of the seam');
  for (let x = -(up.gripMm / 2 - 1); x < -0.5; x += 2) {
    assert.ok(B.solidAt(r, 'left', x, up.yMm + bolt.holeMm / 2 + 0.6, up.zMm), `G: solid web beside the upper tail bolt at x=${x.toFixed(0)}`);
  }
  assert.ok(B.solidAt(r, 'left', -40, up.yMm, m.topSlot[0] - 0.5), 'G: tail block reaches the top channel');
  const t1 = build('tail1', Object.assign(B.styleParams('parlor'), { tailBolts: 1 }));
  assert.deepStrictEqual(t1.meta.bolts.map(b => b.name), ['tail'], 'G: tailBolts 1 = the low bolt only');
  // no tail bolt -> warning
  const nt = B.build(Object.assign(B.styleParams('cigar-box'), { tailBolts: 0 }));
  assert.ok(nt.warnings.some(w => /tail bolt/i.test(w)), 'G: warns without a tail bolt');
  console.log('Body G ok: neck + low and upper tail bolts (' + p.boltSize + ') clear through both halves with teardrop tops and flat washer seats; grips',
    m.bolts.map(b => b.gripMm.toFixed(0) + ' mm').join(' / '));
}

// === Body H: printable without supports, bed checks ======================
{
  B.STYLE_KEYS.forEach(k => {
    const r = build(k, B.styleParams(k));
    const o = r.meta.overhang, cA = B.DEFAULTS.channelRoofFlatMm;
    assert.ok(o.stairLedgeMm <= 1.0, `H ${k}: staircase ledge ${o.stairLedgeMm} mm`);
    // the channel roofs: cA wide on straight runs, a little more measured
    // into inside corners, where the ledge is held on two sides
    assert.ok(o.channelRoofLedgeMm >= cA - 0.1 && o.channelRoofLedgeMm <= cA * Math.SQRT2 + 0.1, `H ${k}: channel roof ledge ${o.channelRoofLedgeMm} mm`);
    assert.deepStrictEqual(r.warnings, [], `H ${k}: preset builds without warnings`);
    assert.ok(r.meta.fitsBed, `H ${k}: fits the bed`);
  });
  const long = B.build(Object.assign(B.styleParams('cigar-box'), { lengthIn: 13.2 }));
  assert.ok(!long.meta.fitsBed && long.warnings.some(w => /print bed/.test(w)), 'H: 13.2in body warns about the bed');
  const shallow = B.build(Object.assign(B.styleParams('round'), { depthIn: 1.6 }));
  assert.ok(shallow.warnings.length > 0, 'H: very shallow body warns');
  console.log('Body H ok: overhangs are 45deg staircases (<= 1 mm) plus the 3 mm flat channel roofs; presets warning-free, bed and depth checks warn');
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
  const N = 8;
  for (let n = 0; n < N; n++) {
    const p = B.styleParams(pick(B.STYLE_KEYS));
    Object.assign(p, {
      lengthIn: Math.min(12.85, p.lengthIn * (0.85 + rnd() * 0.2)), depthIn: 2.4 + rnd() * 1.5,
      wallMm: 2 + rnd() * 4, channelDepthMm: 5 + rnd() * 3, channelRoofFlatMm: 2 + rnd() * 2, panelThicknessMm: pick([3.175, 3, 4]),
      topLipMm: 2.5 + rnd() * 1.5, innerLipMm: 2.5 + rnd() * 1.5, neckScrewMode: pick(['plate', 'wells']), boltSize: pick(['M3', 'M4', '#6']),
      neckBolts: pick([0, 1, 2]), tailBolts: pick([1, 2]), pocketWidthIn: pick([1.375, 1.5, 1.625]),
      neckCollar: rnd() < 0.7, collarFastener: pick(['nut', 'insert']), leftHanded: rnd() < 0.3
    });
    const r = B.build(p);
    assert.strictEqual(edgeErrors(r.groups.left) + edgeErrors(r.groups.right), 0, `J ${n}: watertight ${JSON.stringify(p)}`);
    if (r.groups.collar) assert.strictEqual(edgeErrors(r.groups.collar), 0, `J ${n}: collar watertight ${JSON.stringify(p)}`);
    assert.ok(r.meta.overhang.stairLedgeMm <= 1.0 && r.meta.overhang.channelRoofLedgeMm <= p.channelRoofFlatMm * Math.SQRT2 + 0.1, `J ${n}: overhang ${JSON.stringify(r.meta.overhang)}`);
  }
  console.log('Body J ok:', N, 'random bodies watertight');
}

// === Body K: split neck block (neck collar bolted on vertically) ========
{
  ['parlor', 't-style', 'cigar-box'].forEach(name => {
    const p = B.styleParams(name);
    const r = build(name, p);
    const m = r.meta, c = m.collar, bolt = B.BOLTS[p.boltSize];
    const zF = m.pocketFloorZ, L = m.lengthMm, pw = m.pocket.widthMm / 2;
    assert.ok(c, `K ${name}: collar on by default`);
    approx(c.bottomZ, zF, 1e-9, `K ${name}: split at the pocket floor`);
    approx(c.topZ, m.topSlot[0], 1e-9, `K ${name}: collar top carries the top panel`);
    assert.strictEqual(m.bolts.filter(b => /neck/.test(b.name)).length, 0, `K ${name}: no long sideways neck bolt`);
    // the halves stop at the pocket floor inside the neck block...
    assert.ok(!B.solidAt(r, 'left', -(pw + 5), L - 30, zF + 1), `K ${name}: half open above the split`);
    assert.ok(B.solidAt(r, 'left', -(pw + 5), L - 30, zF - 1) || c.bolts.some(b => Math.hypot(b.x + pw + 5, b.y - L + 30) < 6), `K ${name}: half solid below the split`);
    // ...and the collar bridges the left/right split
    assert.ok(B.solidAt(r, 'collar', -2, L - m.pocket.lengthMm - 3, zF + 3) && B.solidAt(r, 'collar', 2, L - m.pocket.lengthMm - 3, zF + 3), `K ${name}: collar spans x = 0`);
    // the neck heel bears only on the halves' solid lower block: nothing
    // of the collar inside the pocket, and solid under the whole floor
    for (let y = L - m.pocket.lengthMm + 2; y < L - 2; y += 6) {
      for (let x = -pw + 1; x < pw - 1; x += 4) {
        assert.ok(!B.solidAt(r, 'collar', x, y, zF + 1), `K ${name}: collar clear of the pocket at ${x.toFixed(0)},${y.toFixed(0)}`);
        const nearScrew = m.neckScrews.some(s => Math.hypot(s.x - x, s.y - y) < p.neckScrewHoleMm / 2 + 0.2);
        if (!nearScrew) assert.ok(B.solidAt(r, x < 0 ? 'left' : 'right', x, y, zF - 0.5), `K ${name}: pocket floor solid at ${x.toFixed(0)},${y.toFixed(0)}`);
      }
    }
    // at least one collar bolt into each half; each half's hole runs from
    // the back face (or a counterbored well) straight up to the split
    ['left', 'right'].forEach(side => assert.ok(c.bolts.some(b => b.side === side), `K ${name}: a collar bolt into the ${side} half`));
    assert.strictEqual(c.bolts.length, 4, `K ${name}: 4 collar bolts`);
    c.bolts.forEach(b => {
      const half = b.side;
      for (let z = 0.2; z < zF; z += 0.5) assert.ok(!B.solidAt(r, half, b.x, b.y, z), `K ${name}: collar bolt hole open at z=${z.toFixed(1)}`);
      assert.ok(B.solidAt(r, half, b.x + c.holeMm / 2 + 0.3, b.y, zF - 1), `K ${name}: snug hole (${c.holeMm} mm) in the half`);
      if (c.wells) {
        assert.ok(!B.solidAt(r, half, b.x + bolt.washerMm / 2 + 0.5, b.y, c.seatZ - 0.5), `K ${name}: washer well`);
        assert.ok(c.seatZ >= 5, `K ${name}: well deep enough to sink the head`);
      }
      // nut trap: plastic floor under the nut (the bolt pulls the nut
      // down onto it: compression), hex pocket open to the top
      assert.ok(!B.solidAt(r, 'collar', b.x, b.y, zF + 1), `K ${name}: bolt hole in the collar`);
      assert.ok(B.solidAt(r, 'collar', b.x + c.holeMm / 2 + 0.4, b.y, zF + 1), `K ${name}: nut floor solid`);
      assert.ok(!B.solidAt(r, 'collar', b.x + c.holeMm / 2 + 0.6, b.y, c.topZ - 0.5), `K ${name}: nut trap open at the top`);
      // clear of the neck screws
      m.neckScrews.forEach(s => assert.ok(Math.hypot(s.x - b.x, s.y - b.y) > 12, `K ${name}: collar bolt clear of the neck screws`));
    });
    assert.ok(c.boltLengthMm >= c.boltMinMm && c.boltLengthMm <= c.boltMaxMm && !c.boltNote, `K ${name}: stock bolt length ${c.boltLengthMm}`);
    // a gap all round between the collar and the rim's inside wall
    const sh = B.shapeOf(p);
    const yw = L - m.pocket.lengthMm - 3;
    const edgeR = B.halfWidth(sh, yw, 'right') - p.wallMm;
    if (edgeR < m.neckBlock.widthMm / 2) assert.ok(!B.solidAt(r, 'collar', edgeR - p.collarClearanceMm / 2, yw, zF + 3), `K ${name}: collar clears the wall`);
    assert.deepStrictEqual(r.warnings, [], `K ${name}: no warnings`);
  });
  // heat-set insert version: blind hole from the underside with a 45deg
  // pointed roof (no bridging), insert-sized
  const ri = B.build(Object.assign(B.styleParams('parlor'), { collarFastener: 'insert' }));
  const ci = ri.meta.collar, bi = ci.bolts[0], bolt = B.BOLTS.M4;
  assert.ok(!B.solidAt(ri, 'collar', bi.x + bolt.insertHoleMm / 2 - 0.2, bi.y, ci.bottomZ + 2), 'K insert: insert hole');
  assert.ok(B.solidAt(ri, 'collar', bi.x, bi.y, ci.topZ - 0.5), 'K insert: blind (closed at the top)');
  assert.ok(ri.meta.overhang.stairLedgeMm <= 1.0, 'K insert: pointed roof prints without support');
  assert.ok(ci.boltLengthMm <= ci.boltMaxMm, 'K insert: bolt does not bottom out');
  // collar + 2 neck bolts: one is dropped with a warning (they would cross)
  const r2 = B.build(Object.assign(B.styleParams('parlor'), { neckBolts: 2 }));
  assert.ok(r2.warnings.some(w => /only one sideways neck bolt/.test(w)) && r2.meta.bolts.filter(b => b.name.startsWith('neck')).length === 1, 'K: rear neck bolt dropped with the collar');
  // neither collar nor neck bolt: warn
  const r0 = B.build(Object.assign(B.styleParams('parlor'), { neckCollar: false, neckBolts: 0 }));
  assert.ok(r0.warnings.some(w => /No neck collar and no neck bolt/.test(w)), 'K: warns with nothing tying the neck end');
  console.log('Body K ok: neck block split at the pocket floor; U-shaped collar bridges the halves with 4 vertical',
    build('parlor').meta.boltSize, 'bolts (' + build('parlor').meta.collar.boltLengthMm + ' mm), nut traps / heat-set inserts, pocket floor all solid lower block');
}

// === Body L: thin walls (2, 3 and 6 mm) ===================================
{
  assert.strictEqual(B.DEFAULTS.wallMm, 3, 'L: 3 mm default wall');
  [2, 3, 6].forEach(wall => {
    ['parlor', 't-style'].forEach(name => {
      const p = Object.assign(B.styleParams(name), { wallMm: wall });
      const r = build(name + '-wall' + wall, p);
      const m = r.meta;
      ['left', 'right', 'collar'].forEach(h => assert.strictEqual(edgeErrors(r.groups[h]), 0, `L ${name} ${wall} mm: ${h} watertight`));
      assert.ok(m.overhang.stairLedgeMm <= 1.0 && m.overhang.channelRoofLedgeMm <= p.channelRoofFlatMm * Math.SQRT2 + 0.1, `L ${name} ${wall} mm: no supports (${JSON.stringify(m.overhang)})`);
      assert.deepStrictEqual(r.warnings, [], `L ${name} ${wall} mm: no warnings`);
      const sh = B.shapeOf(p), y = sh.c1, inner = B.halfWidth(sh, y, 'left') - wall;
      // plain wall exactly `wall` thick between the channels, lips still reach cD in
      const zMid = (m.channel.topCorbelFootZ + m.baseTopMm) / 2;
      assert.ok(B.solidAt(r, 'left', -(inner + 0.2), y, zMid) && !B.solidAt(r, 'left', -(inner - 0.2), y, zMid), `L ${name} ${wall} mm: plain wall ${wall} mm`);
      const zl = m.topSlot[0] - 0.2;
      assert.ok(B.solidAt(r, 'left', -(inner - p.channelDepthMm + 0.3), y, zl) && !B.solidAt(r, 'left', -(inner - p.channelDepthMm - 0.3), y, zl), `L ${name} ${wall} mm: lip reach`);
      // the collar still sits inside the rim with its clearance; blocks stay solid
      assert.ok(B.solidAt(r, 'left', -5, m.lengthMm - m.pocket.lengthMm / 2, m.pocketFloorZ - 1), `L ${name} ${wall} mm: neck block solid`);
      assert.ok(B.solidAt(r, 'left', -5, 15 + 6, m.topSlot[0] - 1), `L ${name} ${wall} mm: tail block solid`);
      assert.ok(m.collar.bolts.length === 4, `L ${name} ${wall} mm: 4 collar bolts`);
    });
  });
  const thin = B.build(Object.assign(B.styleParams('cigar-box'), { wallMm: 1.2 }));
  assert.ok(thin.warnings.some(w => /Wall raised to the 2.0 mm minimum/.test(w)), 'L: walls under 2 mm are raised with a warning');
  console.log('Body L ok: 2 / 3 / 6 mm walls watertight, support-free, channels and blocks intact; under 2 mm is raised to 2 mm');
}

console.log('\nALL BODY TESTS PASSED');
