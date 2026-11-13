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
    assert.ok(p.lengthIn * IN < 327.66 || (k === 't-style' && p.lengthIn === 12.9), `A: ${k} preset is no longer than the 12.9in bed`);
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
  // T-Style: outline traced from the drawing, 12.9in long, neck end closed
  const tp = B.styleParams('t-style');
  const ts = B.shapeOf(tp);
  approx(ts.L, 12.9 * IN, 1e-9, 'B: T-Style length is 12.9in');
  const tpts = B.outlinePoints(ts);
  const txs = tpts.map(q => q[0]), tys = tpts.map(q => q[1]);
  const pr = B.tstyleProportions();
  approx(ts.scale[0], ts.scale[1], 1e-12, 'B: T-Style scaled uniformly');
  approx(Math.max(...txs) - Math.min(...txs), pr.widthPerLength * ts.L, 0.2, 'B: T-Style width = drawing proportion');
  approx(Math.min(...tys), 0, 1e-6, 'B: T-Style tail at y = 0');
  approx(Math.max(...tys), ts.L, 1e-6, 'B: T-Style reaches the neck end');
  approx(pr.pocketLength * 12.9, 3.0, 0.02, 'B: drawing pocket marker is 3in long');
  approx(pr.pocketWidth * 12.9, 1.5, 0.01, 'B: drawing pocket marker is 1.5in wide');
  approx(pr.pocketEndGap, 0, 1e-9, 'B: pocket marker ends at the neck end');
  const pip = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  // the drawing is kept: every traced point is on or inside the outline
  ts.raw.forEach(q => assert.ok(pip(tpts, q[0], q[1]) || tpts.some(o => Math.hypot(o[0] - q[0], o[1] - q[1]) < 0.05) ||
    tpts.some((o, i) => { const n = tpts[(i + 1) % tpts.length]; const dx = n[0] - o[0], dy = n[1] - o[1];
      const t = Math.max(0, Math.min(1, ((q[0] - o[0]) * dx + (q[1] - o[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(o[0] + t * dx - q[0], o[1] + t * dy - q[1]) < 0.05; }), 'B: T-Style keeps the drawn outline'));
  // cutaway on the treble (+x) side: the notch beside the pocket wall
  const yCut = ts.L - 25;
  assert.ok(!pip(tpts, ts.side + 8, yCut) && pip(tpts, -(ts.side + 8), yCut), 'B: T-Style cutaway on the treble (right, +x) side');
  // the treble horn still reaches out beyond the cutaway
  assert.ok(B.halfWidth(ts, yCut, 'right') > 90, 'B: T-Style keeps the treble horn');
  // closed neck end: a straight edge across, with a wall each side of the pocket
  const pw2 = tp.pocketWidthIn * IN / 2;
  [-1, 1].forEach(sg => { for (let y = ts.L - tp.pocketLengthIn * IN; y < ts.L; y += 2) assert.ok(pip(tpts, sg * (ts.side - 0.3), y), 'B: wall beside the pocket'); });
  assert.ok(ts.side - pw2 > tp.wallMm + tp.channelDepthMm, 'B: pocket side walls carry the channel');
  assert.ok(B.halfWidth(ts, ts.L - 0.5, 'right') >= ts.side - 0.01 && B.halfWidth(ts, ts.L - 0.5, 'left') >= ts.side - 0.01, 'B: T-Style neck end is closed');
  const lh = B.shapeOf(Object.assign(B.styleParams('t-style'), { leftHanded: true }));
  approx(B.halfWidth(lh, yCut, 'left'), B.halfWidth(ts, yCut, 'right'), 1e-9, 'B: left-handed mirrors the cutaway');
  approx(B.halfWidth(lh, 0.3 * ts.L, 'right'), B.halfWidth(ts, 0.3 * ts.L, 'left'), 1e-9, 'B: left-handed mirrors the bass side');
  assert.strictEqual(lh.cutawaySide, 'left');
  console.log('Body B ok: outline passes through the bout / waist widths; round is a circle; box is straight-sided; T-Style traced from the drawing at 12.9in, pocket marker 3 x 1.5in, neck end closed');
}

// === Body C: watertight halves, mirror images, flat on the bed ===========
{
  const cases = {
    parlor: B.styleParams('parlor'),
    'small-dread': B.styleParams('small-dread'),
    round: B.styleParams('round'),
    'cigar-box': B.styleParams('cigar-box'),
    wells: Object.assign(B.styleParams('parlor'), { neckScrewMode: 'wells' }),
    bolts2: Object.assign(B.styleParams('small-dread'), { neckBolts: 2, neckCollar: false, boltSize: '#6' }),
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
    // the separate neck and tail blocks: closed, standing on the back
    // panel's upper face (the back channel's top), up to the top panel
    // (the neck block to the pocket floor when the collar is on)
    [['neckBlock', r.meta.neckBlock], ['tailBlock', r.meta.tailBlock]].forEach(([g, info]) => {
      const T = r.groups[g], bb = bounds(T);
      assert.strictEqual(edgeErrors(T), 0, `C ${name}: ${g} not watertight`);
      assert.ok(signedVolume(T) > 0, `C ${name}: ${g} outward normals`);
      approx(bb[2], r.meta.bottomSlot[1], 1e-3, `C ${name}: ${g} underside flush with the back channel's upper face`);
      approx(bb[5], g === 'neckBlock' && r.groups.collar ? r.meta.pocketFloorZ : r.meta.topSlot[0], 1e-3, `C ${name}: ${g} top`);
      assert.ok(bb[3] - bb[0] < r.meta.bedMm && bb[4] - bb[1] < r.meta.bedMm, `C ${name}: ${g} fits the bed`);
      approx(info.bottomZ, r.meta.bottomSlot[1], 1e-9, `C ${name}: ${g} meta bottom`);
    });
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
    if (r.groups.cap) {
      // cutaway cap: closed, and flipped upside down it sits flat on the bed
      const Cp = r.groups.cap, bp = bounds(Cp);
      assert.strictEqual(edgeErrors(Cp), 0, `C ${name}: cutaway cap not watertight`);
      assert.ok(signedVolume(Cp) > 0, `C ${name}: cap outward normals`);
      approx(bp[2], r.meta.topSlot[0], 1e-3, `C ${name}: cap starts at the top panel's seat`);
      approx(bp[5], r.meta.depthMm, 1e-3, `C ${name}: cap reaches the top face`);
      const Fp = B.flipZ(Cp, r.meta.cap.topZ), bfp = bounds(Fp);
      assert.strictEqual(edgeErrors(Fp), 0, `C ${name}: flipped cap not watertight`);
      assert.ok(signedVolume(Fp) > 0, `C ${name}: flipped cap still faces out`);
      approx(bfp[2], 0, 1e-3, `C ${name}: flipped cap sits on z = 0`);
      const sg = r.meta.cap.side === 'right' ? 1 : -1;
      assert.ok(sg > 0 ? bp[0] >= -1e-6 : bp[3] <= 1e-6, `C ${name}: cap is all on the ${r.meta.cap.side} side`);
      assert.strictEqual(r.meta.cap.side, r.meta.cutawaySide, `C ${name}: cap is on the cutaway side`);
      assert.ok(r.slabs.cap.every(reg => reg.length === 1), `C ${name}: cap is one piece, no holes, at every level`);
    } else {
      assert.ok(r.meta.symmetric, `C ${name}: no cap on a symmetric body`);
    }
    approx(bl[2], 0, 1e-6, `C ${name}: left half sits on z = 0`);
    approx(br[2], 0, 1e-6, `C ${name}: right half sits on z = 0`);
    approx(bl[3], 0, 1e-6, `C ${name}: left half ends at the split plane`);
    approx(br[0], 0, 1e-6, `C ${name}: right half starts at the split plane`);
    approx(bl[5], r.meta.depthMm, 1e-3, `C ${name}: full depth`);
    if (r.meta.fitsBed) assert.ok(bl[4] - bl[1] < r.meta.bedMm, `C ${name}: fits the bed`);
    else assert.ok(r.meta.diagonalSquareMm < r.meta.bedMm - 2 && r.warnings.some(w => /print bed/.test(w)), `C ${name}: fits only corner to corner, and says so`);
  });
  console.log('Body C ok:', Object.keys(cases).length, 'configurations, halves, neck / tail blocks and neck collar closed and consistently wound, mirrored (or per-side for T-Style), flat on the bed; blocks stand on the back channel\'s upper face');
}

// === Body D: panel channels ==============================================
// Each panel edge sits in a channel with a flat lip on each face of the
// panel. r = distance in from the channel back (the inside face of the
// wall), measured at the widest point of the lower bout.
{
  const p = B.styleParams('parlor');
  const r = build('parlor', p);
  const m = r.meta, ch = m.channel;
  const D = m.depthMm, t = p.panelThicknessMm, fit = p.panelFitMm, sag = p.channelSagMm, lip = p.lipMm;
  const cD = p.channelDepthMm, ec = p.panelEdgeGapMm;
  assert.strictEqual(B.DEFAULTS.lipMm, 2, 'D: 2 mm lips by default');
  assert.strictEqual(B.DEFAULTS.channelDepthMm, 4, 'D: 4 mm lip overlap by default');
  assert.ok(sag >= 0.2, 'D: some sag allowance by default');
  approx(m.topSlot[1] - m.topSlot[0], t + fit + sag, 1e-9, 'D: top channel height = panel + clearance + sag allowance');
  approx(m.bottomSlot[1] - m.bottomSlot[0], t + fit + sag, 1e-9, 'D: back channel height');
  approx(m.bottomSlot[0], lip, 1e-9, 'D: bottom lip under the back panel');
  approx(D - m.topSlot[1], lip, 1e-9, 'D: rim above the top channel = the 2 mm top lip, no chamfer');
  approx(ch.engagementMm, cD - ec, 1e-9, 'D: engagement');
  const sh = B.shapeOf(p);
  const y = p.lowerPos * sh.L, inner = B.halfWidth(sh, y) - p.wallMm;
  const X = (rr) => -(inner - rr);            // left half, rr mm in from the channel back
  const S = (rr, z) => B.solidAt(r, 'left', X(rr), y, z);
  const R = (rr, z) => B.solidAt(r, 'right', inner - rr, y, z);
  [['top', m.topSlot], ['back', m.bottomSlot]].forEach(([name, sl]) => {
    const z = (sl[0] + sl[1]) / 2;
    assert.ok(S(-0.3, z), `D ${name}: wall solid behind the channel`);
    assert.ok(!S(0.3, z) && !S(cD + 1, z) && !R(0.3, z), `D ${name}: channel open from the wall inwards`);
    // flat lips just below and just above the panel: the full reach, the
    // full thickness right to the edge, and square (no chamfer, no corbel)
    [[sl[0] - 0.1, sl[0] - lip + 0.1], [sl[1] + 0.1, sl[1] + lip - 0.1]].forEach(([zn, zf], i) => {
      const which = i ? 'over' : 'under';
      for (let rr = 0.3; rr < cD; rr += 0.5) assert.ok(S(rr, zn) && S(rr, zf), `D ${name}: lip ${which} the panel solid at ${rr} mm`);
      assert.ok(!S(cD + 0.3, zn) && !S(cD + 0.3, zf), `D ${name}: lip ${which} the panel stops at ${cD} mm, square edge`);
      assert.ok(R(cD - 0.3, zn), `D ${name}: right half lip ${which} the panel`);
    });
    // beyond the lips: nothing (no chamfer or staircase under / over a lip)
    const zOut = [sl[0] - lip - 0.2, sl[1] + lip + 0.2].filter(zz => zz > 0 && zz < D);
    zOut.forEach(zz => assert.ok(!S(0.3, zz), `D ${name}: nothing past the ${lip} mm lip at z=${zz.toFixed(2)}`));
  });
  // the outside of the rim is untouched (a clean wall face)
  for (let z = 0.2; z < D; z += 1) assert.ok(S(-p.wallMm + 0.3, z), `D: outer wall solid at z=${z.toFixed(1)}`);
  console.log('Body D ok: channels', (t + fit + sag).toFixed(3), 'mm tall (' + sag + ' mm sag allowance), flat', lip, 'mm lips reaching', cD, 'mm over both faces (', ch.engagementMm, 'mm of panel held ), no chamfers');
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
  // the cutaway cap goes on last, straight down: at the top panel's level
  // it is only wall, outside the ply, and above it is the lip over the ply
  ['t-style', 'tstyle-lefty-insert'].forEach(name => {
    const r = built[name] || build(name, Object.assign(B.styleParams('t-style'), { leftHanded: true, collarFastener: 'insert', neckBolts: 1 }));
    const m = r.meta, cl = r.slabs.capLevels, zMid = (m.topSlot[0] + m.topSlot[1]) / 2;
    let k = 0;
    while (!(zMid * 1000 >= cl[k] && zMid * 1000 < cl[k + 1])) k++;
    const c = new ClipperLib.Clipper();
    c.AddPaths(r.slabs.cap[k], ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(m.panels.top.outline.map(pp => pp.map(q => ({ X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }))), ClipperLib.PolyType.ptClip, true);
    const out = new ClipperLib.Paths();
    c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    assert.ok(out.reduce((a, q) => a + Math.abs(ClipperLib.Clipper.Area(q)), 0) / 1e6 < 0.01, `E ${name}: cap clears the top panel as it goes on`);
    // and the lip above the panel overlaps the ply (it holds it down)
    const top = r.slabs.cap[r.slabs.cap.length - 1];
    const c2 = new ClipperLib.Clipper();
    c2.AddPaths(top, ClipperLib.PolyType.ptSubject, true);
    c2.AddPaths(m.panels.top.outline.map(pp => pp.map(q => ({ X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }))), ClipperLib.PolyType.ptClip, true);
    const o2 = new ClipperLib.Paths();
    c2.Execute(ClipperLib.ClipType.ctIntersection, o2, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    assert.ok(o2.reduce((a, q) => a + Math.abs(ClipperLib.Clipper.Area(q)), 0) / 1e6 > 200, `E ${name}: cap's lip lies over the top panel`);
  });
  // the neck and tail blocks stand on the back panel; the halves close
  // over them exactly like over the panels (every slab of each block)
  const partOutline = (r, part, k) => r.slabs[part][k].map(pp => pp.map(q => [q.X / 1000, q.Y / 1000]));
  ['parlor', 'small-dread', 'round', 'cigar-box', 't-style'].forEach(name => {
    const r = build(name, B.styleParams(name));
    ['neckBlock', 'tailBlock'].forEach(part => {
      const lv = r.slabs[part + 'Levels'];
      for (let k = 0; k + 1 < lv.length; k++) {
        const z = (lv[k] + lv[k + 1]) / 2000;
        ['left', 'right'].forEach(half => {
          assert.ok(sweptArea(r, half, partOutline(r, part, k), z) < 0.01, `E ${name}: ${part} collides with the ${half} half while closing (z=${z.toFixed(2)})`);
        });
      }
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
  console.log('Body E ok: both panels, the neck and tail blocks and the neck collar clear each half as it closes in sideways (T-Style: cutaway cap goes on last, from above), reach into the channels, top panel notched');
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
  // inside the pocket: open above the floor, solid neck block just below it
  assert.ok(!B.solidAt(r, 'left', -5, yc + 5, zF + 0.5) && !B.solidAt(r, 'neckBlock', -5, yc + 5, zF + 0.5) && !B.solidAt(r, 'collar', -5, yc + 5, zF + 0.5), 'F: pocket open above the floor');
  assert.ok(B.solidAt(r, 'neckBlock', -5, yc + 5, zF - 0.5), 'F: pocket floor solid');
  // pocket side walls (in the neck collar by default): solid wall just
  // outside the pocket width, a full block thick, and the end wall
  const wy = yc + 8; // clear of the collar bolts
  assert.ok(B.solidAt(r, 'collar', -(m.pocket.widthMm / 2 + 1), wy, zF + 5), 'F: pocket side wall');
  assert.ok(B.solidAt(r, 'collar', -(m.pocket.widthMm / 2 + p.neckBlockSideMm - 1), wy, zF + 5), 'F: side wall is a full block thick');
  assert.ok(B.solidAt(r, 'collar', -2, L - m.pocket.lengthMm - 1, zF + 5), 'F: pocket end wall');
  // without the collar the same walls are part of the (one-piece) neck block
  const nc = build('no-collar', Object.assign(B.styleParams('parlor'), { neckCollar: false, neckBolts: 1 }));
  assert.ok(B.solidAt(nc, 'neckBlock', -(m.pocket.widthMm / 2 + 1), wy, zF + 5), 'F: no collar: side wall in the neck block');
  assert.ok(B.solidAt(nc, 'neckBlock', -5, L - m.pocket.lengthMm - 1, zF + 5), 'F: no collar: end wall in the neck block');
  assert.ok(!B.solidAt(nc, 'neckBlock', -5, yc, zF + 5), 'F: no collar: pocket open');
  // the clamping column: the neck block is solid all the way from the
  // pocket floor down to its underside on the back panel beside each
  // screw, except the bolt hole; under it, the back panel (no printed
  // floor of the halves there)
  const zB = m.neckBlock.bottomZ, nb = m.bolts.find(b => b.name === 'neck');
  approx(zB, m.bottomSlot[1], 1e-9, 'F: neck block stands on the back channel\'s upper face');
  for (let z = zB + 0.2; z < zF; z += 0.5) {
    m.neckScrews.forEach(s => {
      assert.ok(!B.solidAt(r, 'neckBlock', s.x, s.y, z), `F: screw hole open at z=${z.toFixed(1)}`);
      assert.ok(B.solidAt(r, 'neckBlock', s.x - Math.sign(s.x) * (p.neckScrewHoleMm / 2 + 1), s.y, z), `F: solid beside the screw at z=${z.toFixed(1)}`);
    });
    if (Math.abs(z - nb.zMm) > B.BOLTS[p.boltSize].holeMm) assert.ok(B.solidAt(r, 'neckBlock', -5, nb.yMm, z), `F: solid under the pocket at z=${z.toFixed(1)}`);
  }
  for (let z = 0.2; z < zB; z += 0.5) assert.ok(!B.solidAt(r, 'left', -20, yc, z), `F: open under the neck block (back panel there) at z=${z.toFixed(1)}`);
  // the solid block under the pocket floor, and the screw-length math:
  // plate + 1/8in back panel + the block, plus the bite into the neck
  approx(m.plasticUnderPocketMm, zF - zB, 1e-9, 'F: plate mode clamps the whole block');
  assert.ok(m.plasticUnderPocketMm > 40, 'F: >40 mm of block under the pocket');
  const st = m.neckScrewStack;
  approx(st.plateMm, p.plateThicknessMm, 1e-9, 'F: plate in the stack');
  approx(st.backPanelMm, p.panelThicknessMm, 1e-9, 'F: back panel in the stack');
  approx(st.blockMm, zF - zB, 1e-9, 'F: block in the stack');
  const under = st.plateMm + st.backPanelMm + st.blockMm;
  approx(m.neckScrewNeedMm, under + p.screwBiteMm, 1e-9, 'F: screw need = plate + ply + block + bite');
  approx(m.neckScrewBiteMm, m.neckScrewLengthIn * IN - under, 1e-9, 'F: bite = screw - plate - ply - block');
  assert.ok(m.neckScrewBiteMm >= 13 && m.neckScrewBiteMm <= p.screwBiteMm + 3, `F: screw bites ${m.neckScrewBiteMm.toFixed(1)} mm into the neck`);
  // the screws pass through the back panel: holes in its outline
  const holes = m.panels.back.holes.filter(h => /neck screw/.test(h.what));
  assert.strictEqual(holes.length, 4, 'F: 4 neck screw holes in the back panel');
  holes.forEach(h => approx(h.dMm, p.neckScrewHoleMm, 1e-9, 'F: clearance hole size'));
  const inBack = (x, y) => m.panels.back.outline.reduce((w, pp) => w + (ClipperLib.Clipper.PointInPolygon({ X: Math.round(x * 1000), Y: Math.round(y * 1000) },
    pp.map(q => ({ X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }))) !== 0 ? (ClipperLib.Clipper.Area(pp.map(q => ({ X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }))) > 0 ? 1 : -1) : 0), 0) > 0;
  m.neckScrews.forEach(s => {
    assert.ok(!inBack(s.x, s.y), 'F: back panel open at the screw');
    assert.ok(inBack(s.x + p.neckScrewHoleMm / 2 + 2, s.y), 'F: back panel solid round the screw hole (the plate bears on it)');
  });
  // wells mode: counterbores from the back stop wellFloorMm under the pocket
  const w = build('wells', Object.assign(B.styleParams('parlor'), { neckScrewMode: 'wells' }));
  const s0 = w.meta.neckScrews[0];
  const zW = w.meta.pocketFloorZ - p.wellFloorMm;
  assert.ok(zW - w.meta.neckBlock.bottomZ > 4, 'F: wells start at the neck block underside');
  assert.ok(!B.solidAt(w, 'neckBlock', s0.x + p.wellDiameterMm / 2 - 1, s0.y, zW - 0.5), 'F: well open below the floor');
  assert.ok(!B.solidAt(w, 'neckBlock', s0.x + p.wellDiameterMm / 2 - 1, s0.y, w.meta.neckBlock.bottomZ + 0.2), 'F: well open at the block underside');
  assert.ok(B.solidAt(w, 'neckBlock', s0.x + p.wellDiameterMm / 2 - 1, s0.y, zW + 4), 'F: well roof closes (45deg)');
  approx(w.meta.plasticUnderPocketMm, p.wellFloorMm, 1e-9, 'F: wells keep the floor');
  approx(w.meta.neckScrewBiteMm, w.meta.neckScrewLengthIn * IN - (1.5 + p.wellFloorMm), 1e-9, 'F: wells: screw = washer + floor + bite');
  assert.ok(w.meta.neckScrewLengthIn <= 2, 'F: wells take standard short screws');
  // the heads go in through the back panel: well-sized holes
  const wh = w.meta.panels.back.holes.filter(h => /neck screw well/.test(h.what));
  assert.strictEqual(wh.length, 4, 'F: wells: 4 well-sized holes in the back panel');
  wh.forEach(h => approx(h.dMm, p.wellDiameterMm, 1e-9, 'F: well hole size'));
  console.log('Body F ok: pocket', (m.pocket.lengthMm / IN).toFixed(2), 'x', (m.pocket.widthMm / IN).toFixed(3),
    'in, floor', (0.9).toFixed(1), 'in below the top;', m.plasticUnderPocketMm.toFixed(1), 'mm solid neck block under it (on the back panel);',
    'screws', m.neckScrewLengthIn + 'in (plate ' + p.plateThicknessMm + ' + ply ' + p.panelThicknessMm + ' + block ' + m.neckScrewStack.blockMm.toFixed(1) + ' mm, ' + m.neckScrewBiteMm.toFixed(1) + ' mm bite) /', w.meta.neckScrewLengthIn + 'in (wells)');
}

// === Body G: clamshell bolts through the walls and the neck / tail blocks
{
  // the neck block is its own part now: one sideways neck bolt by default
  // ties the halves together at the neck, plus the low and upper tail bolts
  const p = B.styleParams('parlor');
  const r = build('parlor', p);
  const m = r.meta, ch = m.channel;
  assert.deepStrictEqual(m.bolts.map(b => b.name), ['neck', 'tail', 'tail (upper)']);
  const bolt = B.BOLTS[p.boltSize];
  const sh = B.shapeOf(p);
  m.bolts.forEach(b => {
    const part = /neck/.test(b.name) ? 'neckBlock' : 'tailBlock';
    const hwL = B.halfWidth(sh, b.yMm, 'left'), hwR = B.halfWidth(sh, b.yMm, 'right');
    // clear hole right through both walls and the block at the bolt centre
    [-(hwL - 1.5), -(hwL - p.wallMm + 0.3)].forEach(x => assert.ok(!B.solidAt(r, 'left', x, b.yMm, b.zMm), `G ${b.name}: hole open in the left wall at x=${x.toFixed(1)}`));
    [hwR - 1.5].forEach(x => assert.ok(!B.solidAt(r, 'right', x, b.yMm, b.zMm), `G ${b.name}: hole open in the right wall`));
    [-30, -1, 1, 30].forEach(x => assert.ok(!B.solidAt(r, part, x, b.yMm, b.zMm), `G ${b.name}: hole open through the ${part} at x=${x}`));
    // wall and block solid just outside the hole radius
    const yS = b.yMm + bolt.washerMm / 2 + 1.2;
    assert.ok(B.solidAt(r, 'left', -(B.halfWidth(sh, yS, 'left') - 1.5), yS, b.zMm), `G ${b.name}: wall solid beside the hole`);
    assert.ok(B.solidAt(r, part, -20, b.yMm + bolt.holeMm / 2 + 0.6, b.zMm), `G ${b.name}: block solid beside the hole`);
    // teardrop: open a little above the round top, closed further up
    assert.ok(!B.solidAt(r, part, -20, b.yMm, b.zMm + bolt.holeMm / 2 + 0.3), `G ${b.name}: teardrop point`);
    assert.ok(B.solidAt(r, part, -20, b.yMm, b.zMm + bolt.holeMm / 2 * Math.SQRT2 + 0.6), `G ${b.name}: solid above the teardrop`);
    // flat washer seat (spot face) at the outside wall
    assert.ok(b.gripMm > 50 && b.gripMm < 2 * B.halfWidth(sh, b.yMm), `G ${b.name}: grip ${b.gripMm}`);
    assert.ok(!B.solidAt(r, 'left', -(b.gripMm / 2 + 0.5), b.yMm + bolt.washerMm / 2 - 0.3, b.zMm), `G ${b.name}: washer seat cut`);
    assert.ok(B.solidAt(r, 'left', -(b.gripMm / 2 - 0.5), b.yMm + bolt.washerMm / 2 - 0.3, b.zMm), `G ${b.name}: washer seat is flat (solid inside it)`);
    // clear of the back channel and its upper lip, and of the top channel's
    // lower lip: the whole washer seat (teardrop top included) is between them
    assert.ok(b.zMm - bolt.washerMm / 2 - 0.5 >= ch.backLipTopZ, `G ${b.name}: washer seat (bottom ${(b.zMm - bolt.washerMm / 2 - 0.5).toFixed(2)}) above the back lip (${ch.backLipTopZ.toFixed(2)})`);
    assert.ok(b.zMm + (bolt.washerMm / 2 + 0.5) * Math.SQRT2 <= ch.topLowerLipZ + 1e-6, `G ${b.name}: washer seat under the top channel's lip`);
    // the hole runs through solid block only (never through the slab top)
    assert.ok(b.zMm + bolt.holeMm / 2 * Math.SQRT2 < (/neck/.test(b.name) ? Math.min(m.neckBlock.slabTopZ, m.pocketFloorZ) : (b.name === 'tail' ? m.tailBlock.slabTopZ : m.tailBlock.topZ)), `G ${b.name}: inside the block`);
    // the back channel stays whole beside the bolt: scanning in from the
    // outside at the bolt's y, the slot opens at the same x as the lip
    // under it ends + the lip overlap (the boss and seat are all above it)
    const zIn = (ch.backSlot[0] + ch.backSlot[1]) / 2;
    let xs0 = -B.halfWidth(sh, b.yMm, 'left') + 0.3;
    while (B.solidAt(r, 'left', xs0, b.yMm, zIn)) xs0 += 0.05;
    let xl = xs0;
    while (B.solidAt(r, 'left', xl, b.yMm, ch.backSlot[0] / 2)) xl += 0.05;
    assert.ok(xl - xs0 > 1 && B.solidAt(r, 'left', xs0 + 0.2, b.yMm, ch.backSlot[1] + 0.1), `G ${b.name}: back channel intact at the bolt (slot from ${xs0.toFixed(1)}, lip to ${xl.toFixed(1)})`);
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
  for (let x = -(up.gripMm / 2 - p.wallMm - 1); x < -0.5; x += 2) {
    assert.ok(B.solidAt(r, 'tailBlock', x, up.yMm + bolt.holeMm / 2 + 0.6, up.zMm), `G: solid web beside the upper tail bolt at x=${x.toFixed(0)}`);
  }
  assert.ok(B.solidAt(r, 'tailBlock', -40, up.yMm, m.topSlot[0] - 0.5), 'G: tail block reaches the top channel');
  const t1 = build('tail1', Object.assign(B.styleParams('parlor'), { tailBolts: 1 }));
  assert.deepStrictEqual(t1.meta.bolts.map(b => b.name), ['neck', 'tail'], 'G: tailBolts 1 = the low bolt only');
  // no tail bolt / no neck bolt -> warnings
  const nt = B.build(Object.assign(B.styleParams('cigar-box'), { tailBolts: 0 }));
  assert.ok(nt.warnings.some(w => /tail bolt/i.test(w)), 'G: warns without a tail bolt');
  const nn = B.build(Object.assign(B.styleParams('cigar-box'), { neckBolts: 0 }));
  assert.ok(nn.warnings.some(w => /No neck bolt/.test(w)), 'G: warns without a neck bolt');
  console.log('Body G ok: neck + low and upper tail bolts (' + p.boltSize + ') clear through both walls and the blocks with teardrop tops and flat washer seats, above the back channel; heights',
    m.bolts.map(b => b.zMm.toFixed(1) + ' mm').join(' / '), '; grips', m.bolts.map(b => b.gripMm.toFixed(0) + ' mm').join(' / '));
}

// === Body H: printable without supports, bed checks ======================
{
  B.STYLE_KEYS.forEach(k => {
    const r = build(k, B.styleParams(k));
    const o = r.meta.overhang, cA = B.DEFAULTS.channelDepthMm;
    assert.ok(o.stairLedgeMm <= 1.0, `H ${k}: staircase ledge ${o.stairLedgeMm} mm`);
    // the flat lip undersides: cA (the lip overlap) wide on straight runs, a
    // little more measured into inside corners, where the ledge is held on two sides
    assert.ok(o.channelRoofLedgeMm >= cA - 0.1 && o.channelRoofLedgeMm <= cA * Math.SQRT2 + 0.1, `H ${k}: channel roof ledge ${o.channelRoofLedgeMm} mm`);
    if (k === 't-style') {
      // 12.9in long on a 12.9in bed: the only warning is the bed one, and
      // each half fits turned corner to corner
      assert.ok(r.warnings.length === 1 && /print bed/.test(r.warnings[0]) && /corner to corner/.test(r.warnings[0]), `H ${k}: bed warning only`);
      assert.ok(!r.meta.fitsBed && r.meta.diagonalSquareMm < r.meta.bedMm - 10, `H ${k}: fits diagonally`);
    } else {
      assert.deepStrictEqual(r.warnings, [], `H ${k}: preset builds without warnings`);
      assert.ok(r.meta.fitsBed, `H ${k}: fits the bed`);
    }
  });
  const long = B.build(Object.assign(B.styleParams('cigar-box'), { lengthIn: 13.2 }));
  assert.ok(!long.meta.fitsBed && long.warnings.some(w => /print bed/.test(w)), 'H: 13.2in body warns about the bed');
  const shallow = B.build(Object.assign(B.styleParams('round'), { depthIn: 1.4 }));
  assert.ok(shallow.warnings.length > 0, 'H: very shallow body warns');
  console.log('Body H ok: overhangs are 45deg staircases (<= 1 mm) plus the flat channel-lip undersides (= lip overlap); presets warning-free, bed and depth checks warn');
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
      wallMm: 2 + rnd() * 4, channelDepthMm: 2.5 + rnd() * 2.5, lipMm: 1.6 + rnd() * 1.4, channelSagMm: rnd() * 0.5, panelThicknessMm: pick([3.175, 3, 4]), neckScrewMode: pick(['plate', 'wells']), boltSize: pick(['M3', 'M4', '#6']),
      neckBolts: pick([0, 1, 2]), tailBolts: pick([1, 2]), pocketWidthIn: pick([1.375, 1.5, 1.625]),
      neckCollar: rnd() < 0.7, collarFastener: pick(['nut', 'insert']), leftHanded: rnd() < 0.3
    });
    const r = B.build(p);
    assert.strictEqual(edgeErrors(r.groups.left) + edgeErrors(r.groups.right), 0, `J ${n}: watertight ${JSON.stringify(p)}`);
    if (r.groups.collar) assert.strictEqual(edgeErrors(r.groups.collar), 0, `J ${n}: collar watertight ${JSON.stringify(p)}`);
    ["neckBlock", "tailBlock"].forEach(g => assert.strictEqual(edgeErrors(r.groups[g]), 0, `J ${n}: ${g} watertight ${JSON.stringify(p)}`));
    assert.ok(r.meta.overhang.stairLedgeMm <= 1.0 && r.meta.overhang.channelRoofLedgeMm <= p.channelDepthMm * Math.SQRT2 + 0.1, `J ${n}: overhang ${JSON.stringify(r.meta.overhang)}`);
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
    assert.strictEqual(m.bolts.filter(b => /neck/.test(b.name)).length, 1, `K ${name}: one sideways neck bolt ties the halves at the neck`);
    // the neck block stops at the pocket floor...
    assert.ok(!B.solidAt(r, 'left', -(pw + 5), L - 30, zF + 1) && !B.solidAt(r, 'neckBlock', -(pw + 5), L - 30, zF + 1), `K ${name}: open above the split`);
    assert.ok(B.solidAt(r, 'neckBlock', -(pw + 5), L - 30, zF - 1) || c.bolts.some(b => Math.hypot(b.x + pw + 5, b.y - L + 30) < 6), `K ${name}: neck block solid below the split`);
    // ...and the collar bridges the left/right split
    assert.ok(B.solidAt(r, 'collar', -2, L - m.pocket.lengthMm - 3, zF + 3) && B.solidAt(r, 'collar', 2, L - m.pocket.lengthMm - 3, zF + 3), `K ${name}: collar spans x = 0`);
    // the neck heel bears only on the halves' solid lower block: nothing
    // of the collar inside the pocket, and solid under the whole floor
    for (let y = L - m.pocket.lengthMm + 2; y < L - 2; y += 6) {
      for (let x = -pw + 1; x < pw - 1; x += 4) {
        assert.ok(!B.solidAt(r, 'collar', x, y, zF + 1), `K ${name}: collar clear of the pocket at ${x.toFixed(0)},${y.toFixed(0)}`);
        const nearScrew = m.neckScrews.some(s => Math.hypot(s.x - x, s.y - y) < p.neckScrewHoleMm / 2 + 0.2);
        if (!nearScrew) assert.ok(['neckBlock', 'left', 'right'].some(h => B.solidAt(r, h, x, y, zF - 0.5)), `K ${name}: pocket floor solid at ${x.toFixed(0)},${y.toFixed(0)}`);
      }
    }
    // collar bolts on both sides; each hole runs from a counterbored well
    // in the neck block's underside straight up to the split, and the back
    // panel has a hole under each well for the head
    ['left', 'right'].forEach(side => assert.ok(c.bolts.some(b => b.side === side), `K ${name}: a collar bolt on the ${side}`));
    assert.strictEqual(c.bolts.length, 4, `K ${name}: 4 collar bolts`);
    const zB = m.neckBlock.bottomZ;
    c.bolts.forEach(b => {
      const half = 'neckBlock';
      for (let z = zB + 0.2; z < zF; z += 0.5) assert.ok(!B.solidAt(r, half, b.x, b.y, z), `K ${name}: collar bolt hole open at z=${z.toFixed(1)}`);
      assert.ok(B.solidAt(r, half, b.x + c.holeMm / 2 + 0.3, b.y, zF - 1), `K ${name}: snug hole (${c.holeMm} mm) in the neck block`);
      assert.ok(c.wells, `K ${name}: counterbored wells`);
      assert.ok(!B.solidAt(r, half, b.x + bolt.washerMm / 2 + 0.5, b.y, c.seatZ - 0.5), `K ${name}: washer well`);
      assert.ok(B.solidAt(r, half, b.x + c.wellMm / 2 + 1.5, b.y, zB + 0.5), `K ${name}: the well stays inside the block`);
      assert.ok(c.seatZ - zB >= 5, `K ${name}: well deep enough to sink the head`);
      assert.ok(m.panels.back.holes.some(h => /collar/.test(h.what) && Math.hypot(h.x - b.x, h.y - b.y) < 1e-6 && h.dMm >= bolt.washerMm), `K ${name}: back panel hole for the collar bolt head`);
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
    assert.deepStrictEqual(r.warnings.filter(w => !/print bed/.test(w)), [], `K ${name}: no warnings`);
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
  // no neck bolt: warn
  const r0 = B.build(Object.assign(B.styleParams('parlor'), { neckCollar: false, neckBolts: 0 }));
  assert.ok(r0.warnings.some(w => /No neck bolt/.test(w)), 'K: warns with nothing tying the neck end');
  console.log('Body K ok: neck block split at the pocket floor; U-shaped collar bolted onto the one-piece neck block with 4 vertical',
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
      ['left', 'right', 'collar', 'neckBlock', 'tailBlock'].forEach(h => assert.strictEqual(edgeErrors(r.groups[h]), 0, `L ${name} ${wall} mm: ${h} watertight`));
      assert.ok(m.overhang.stairLedgeMm <= 1.0 && m.overhang.channelRoofLedgeMm <= p.channelDepthMm * Math.SQRT2 + 0.1, `L ${name} ${wall} mm: no supports (${JSON.stringify(m.overhang)})`);
      assert.deepStrictEqual(r.warnings.filter(w => !/print bed/.test(w)), [], `L ${name} ${wall} mm: no warnings`);
      const sh = B.shapeOf(p), y = sh.c1, inner = B.halfWidth(sh, y, 'left') - wall;
      // plain wall exactly `wall` thick between the channels, lips still reach cD in
      const zMid = (m.channel.topLowerLipZ + m.baseTopMm) / 2;
      assert.ok(B.solidAt(r, 'left', -(inner + 0.2), y, zMid) && !B.solidAt(r, 'left', -(inner - 0.2), y, zMid), `L ${name} ${wall} mm: plain wall ${wall} mm`);
      const zl = m.topSlot[0] - 0.2;
      assert.ok(B.solidAt(r, 'left', -(inner - p.channelDepthMm + 0.3), y, zl) && !B.solidAt(r, 'left', -(inner - p.channelDepthMm - 0.3), y, zl), `L ${name} ${wall} mm: lip reach`);
      // the collar still sits inside the rim with its clearance; blocks stay solid
      assert.ok(B.solidAt(r, 'neckBlock', -5, m.lengthMm - m.pocket.lengthMm / 2 + 8, m.pocketFloorZ - 1), `L ${name} ${wall} mm: neck block solid`);
      assert.ok(B.solidAt(r, 'tailBlock', -5, 15 + 6, m.topSlot[0] - 1), `L ${name} ${wall} mm: tail block solid`);
      assert.ok(m.collar.bolts.length === 4, `L ${name} ${wall} mm: 4 collar bolts`);
    });
  });
  const thin = B.build(Object.assign(B.styleParams('cigar-box'), { wallMm: 1.2 }));
  assert.ok(thin.warnings.some(w => /Wall raised to the 2.0 mm minimum/.test(w)), 'L: walls under 2 mm are raised with a warning');
  console.log('Body L ok: 2 / 3 / 6 mm walls watertight, support-free, channels and blocks intact; under 2 mm is raised to 2 mm');
}

// === Body M: the back mirrors the top: back channel all round, blocks on the back panel
{
  const toI = pp => pp.map(q => ({ X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }));
  const areaOf = paths => paths.reduce((a, q) => a + ClipperLib.Clipper.Area(q), 0) / 1e6;
  function clip(type, a, b) {
    const c = new ClipperLib.Clipper();
    c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
    const out = new ClipperLib.Paths();
    c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return out;
  }
  ['parlor', 'small-dread', 'round', 'cigar-box'].forEach(name => {
    const p = B.styleParams(name), r = build(name, p), m = r.meta, ch = m.channel;
    const outl = m.panels.back.outline;
    // one piece covering the whole outline, offset like the top panel:
    // its outer edge is the inside face of the wall less the edge gap,
    // everywhere (so not cut short at the blocks)
    const outer = outl.filter(pp => ClipperLib.Clipper.Area(toI(pp)) > 0);
    assert.strictEqual(outer.length, 1, `M ${name}: back panel is one piece`);
    assert.ok(!m.backFloor, `M ${name}: no printed floor anywhere`);
    const holesN = outl.length - 1;
    assert.strictEqual(holesN, m.panels.back.holes.length, `M ${name}: the listed holes are cut in the outline`);
    const sh = B.shapeOf(p);
    const yb = [2, m.tailBlock.lengthMm / 2, m.lengthMm - m.neckBlock.lengthMm / 2, m.lengthMm - 8];
    const bb = outer[0].reduce((b, q) => [Math.min(b[0], q[1]), Math.max(b[1], q[1])], [Infinity, -Infinity]);
    assert.ok(bb[0] < p.wallMm + p.panelEdgeGapMm + 0.2 && bb[1] > m.lengthMm - p.wallMm - p.panelEdgeGapMm - 0.2, `M ${name}: back panel runs from the tail wall to the neck wall (${bb.map(v => v.toFixed(1))})`);
    const topOuter = m.panels.top.outline.filter(pp => ClipperLib.Clipper.Area(toI(pp)) > 0);
    // same outline as the top panel, apart from the pocket notch
    const pocket = [toI([[-m.pocket.widthMm / 2, m.lengthMm - m.pocket.lengthMm], [m.pocket.widthMm / 2, m.lengthMm - m.pocket.lengthMm], [m.pocket.widthMm / 2, m.lengthMm + 50], [-m.pocket.widthMm / 2, m.lengthMm + 50]])];
    const backLessPocket = clip(ClipperLib.ClipType.ctDifference, [toI(outer[0])], pocket);
    approx(areaOf(backLessPocket), areaOf(topOuter.map(toI)), 1, `M ${name}: back panel = top panel outline`);
    // every point along its edge is in the channel: a lip under it, a lip
    // (or a block standing on it) over it, open where it goes
    const zUnder = ch.backSlot[0] / 2, zOver = ch.backSlot[1] + p.lipMm / 2, zIn = (ch.backSlot[0] + ch.backSlot[1]) / 2;
    const held = p.channelDepthMm - p.panelEdgeGapMm;
    let n = 0, onBlocks = 0;
    [0.5, held - 0.5].forEach(d => {
      const co = new ClipperLib.ClipperOffset(2, 10);
      co.AddPaths([toI(outer[0])], ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
      const sol = new ClipperLib.Paths();
      co.Execute(sol, -d * 1000);
      assert.strictEqual(sol.length, 1, `M ${name}: band ${d} mm in from the panel edge is one loop`);
      const loop = sol[0];
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        const len = Math.hypot(b.X - a.X, b.Y - a.Y) / 1000, steps = Math.max(1, Math.ceil(len / 2));
        for (let k = 0; k < steps; k++) {
          const x = (a.X + (b.X - a.X) * k / steps) / 1000, y = (a.Y + (b.Y - a.Y) * k / steps) / 1000;
          if (Math.abs(x) < 0.4) continue;              // the split plane itself
          const half = x < 0 ? 'left' : 'right';
          const blk = B.solidAt(r, 'neckBlock', x, y, zOver) || B.solidAt(r, 'tailBlock', x, y, zOver);
          assert.ok(B.solidAt(r, half, x, y, zUnder), `M ${name}: lip under the back panel at ${x.toFixed(1)},${y.toFixed(1)}`);
          // (the only gap is the block clearance between a bolt boss in the
          // half and the block's notch for it: held on both sides of it)
          const over = (xx, yy) => ['neckBlock', 'tailBlock', half].some(h => B.solidAt(r, h, xx, yy, zOver));
          const g = m.blockClearanceMm + 0.1;
          assert.ok(B.solidAt(r, half, x, y, zOver) || blk || (over(x - g, y) && over(x + g, y)) || (over(x, y - g) && over(x, y + g)), `M ${name}: lip (or block) over the back panel at ${x.toFixed(1)},${y.toFixed(1)}`);
          assert.ok(!B.solidAt(r, half, x, y, zIn), `M ${name}: channel open where the panel goes at ${x.toFixed(1)},${y.toFixed(1)}`);
          n++;
          if (blk) onBlocks++;
        }
      }
    });
    assert.ok(onBlocks > 40, `M ${name}: the panel edge runs under the blocks too (${onBlocks} samples)`);
    // nothing printed inside the back panel's space: no part intersects it
    // anywhere (halves at every slab level in its thickness; the blocks and
    // the collar start above it)
    const pz0 = m.panels.backZ[0], pz1 = m.panels.backZ[1];
    const lv = r.slabs.levels;
    for (let k = 0; k + 1 < lv.length; k++) {
      if (lv[k + 1] / 1000 <= pz0 || lv[k] / 1000 >= pz1) continue;
      ['left', 'right'].forEach(h => {
        const hit = clip(ClipperLib.ClipType.ctIntersection, r.slabs[h][k], outl.map(toI));
        assert.ok(Math.abs(areaOf(hit)) < 0.01, `M ${name}: ${h} half intersects the back panel at z=${(lv[k] / 1000).toFixed(2)}`);
      });
    }
    ['neckBlock', 'tailBlock'].forEach(part => assert.ok(r.slabs[part + 'Levels'][0] / 1000 >= pz1 - 1e-9, `M ${name}: ${part} above the back panel`));
    if (r.slabs.collarLevels) assert.ok(r.slabs.collarLevels[0] / 1000 >= pz1, `M ${name}: collar above the back panel`);
    // the blocks rest on the back panel's upper face: their undersides are
    // flush with the channel's upper face and lie wholly over the panel
    ['neckBlock', 'tailBlock'].forEach(part => {
      approx(r.slabs[part + 'Levels'][0] / 1000, ch.backSlot[1], 1e-9, `M ${name}: ${part} underside flush with the back channel's upper face`);
      const foot = r.slabs[part][0];
      // (it keeps only the block clearance from the walls, so its edge may
      // reach past the panel's edge gap: under 2% of it, a hair-thin strip)
      const solidOutline = clip(ClipperLib.ClipType.ctUnion, [toI(outer[0])], []);
      const out = clip(ClipperLib.ClipType.ctDifference, foot, solidOutline);
      assert.ok(Math.abs(areaOf(out)) < 0.02 * areaOf(foot), `M ${name}: ${part} underside lies over the back panel (${Math.abs(areaOf(out)).toFixed(1)} mm2 off it)`);
      const co2 = new ClipperLib.ClipperOffset(2, 10);
      co2.AddPaths([toI(outer[0])], ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
      const wallIn = new ClipperLib.Paths(); co2.Execute(wallIn, (p.panelEdgeGapMm - m.blockClearanceMm + 0.01) * 1000);
      assert.ok(Math.abs(areaOf(clip(ClipperLib.ClipType.ctDifference, foot, wallIn))) < 0.01, `M ${name}: ${part} stays the block clearance inside the walls`);
      assert.ok(areaOf(foot) > 500, `M ${name}: ${part} has a broad flat underside (${areaOf(foot).toFixed(0)} mm2)`);
    });
    // the halves leave the panel's whole face open between the lips: no
    // printed floor under the blocks any more
    assert.ok(!B.solidAt(r, 'left', -10, m.tailBlock.lengthMm / 2, 0.5) && !B.solidAt(r, 'left', -10, m.lengthMm - m.neckBlock.lengthMm / 2, 0.5), `M ${name}: back open under the blocks`);
    if (name === 'parlor') console.log(`Body M: back channel continuous round the whole back panel (${n} points checked, ${onBlocks} of them under the neck / tail blocks); no part in the panel's space`);
  });
  // T-Style (paused): the horn beyond the cutaway keeps a printed floor,
  // and the back channel runs along its edge
  ['t-style'].forEach(name => {
    const r = build(name, B.styleParams(name)), m = r.meta;
    assert.ok(m.backFloor && m.backFloor.side === m.cutawaySide && m.backFloor.areaMm2 < 3000, `M ${name}: printed floor only under the horn`);
    assert.strictEqual(m.panels.back.outline.filter(pp => ClipperLib.Clipper.Area(toI(pp)) > 0).length, 1, `M ${name}: back panel one piece`);
  });
  // lip thickness and overlap settings, with thin and thick walls
  [[2, 4, 3], [1.6, 3, 2], [3, 6, 2], [2, 2.5, 6], [2.5, 5, 3]].forEach(([lip, ov, wall]) => {
    const name = `lip${lip}-ov${ov}-w${wall}`;
    const p = Object.assign(B.styleParams('parlor'), { lipMm: lip, channelDepthMm: ov, wallMm: wall });
    const r = B.build(p), m = r.meta;
    ['left', 'right', 'collar', 'neckBlock', 'tailBlock'].forEach(h => assert.strictEqual(edgeErrors(r.groups[h]), 0, `M ${name}: ${h} watertight`));
    assert.ok(signedVolume(r.groups.left) > 0 && signedVolume(r.groups.right) > 0, `M ${name}: outward normals`);
    approx(m.channel.lipMm, lip, 1e-9, `M ${name}: lip`); approx(m.channel.depthMm, ov, 1e-9, `M ${name}: overlap`);
    approx(m.bottomSlot[0], lip, 1e-9, `M ${name}: bottom lip thickness`);
    approx(m.depthMm - m.topSlot[1], lip, 1e-9, `M ${name}: top lip thickness`);
    approx(m.channel.backLipTopZ - m.bottomSlot[1], lip, 1e-9, `M ${name}: back upper lip thickness`);
    approx(m.neckBlock.bottomZ, m.bottomSlot[1], 1e-9, `M ${name}: blocks follow the back channel`);
    assert.ok(m.bolts.every(b => b.zMm - B.BOLTS[p.boltSize].washerMm / 2 - 0.5 >= m.channel.backLipTopZ), `M ${name}: bolts clear the back channel`);
    approx(m.topSlot[0] - m.channel.topLowerLipZ, lip, 1e-9, `M ${name}: top lower lip thickness`);
    const sh = B.shapeOf(p), y = p.lowerPos * sh.L, inner = B.halfWidth(sh, y) - wall;
    [m.bottomSlot[0] - 0.1, m.bottomSlot[1] + 0.1, m.topSlot[0] - 0.1, m.topSlot[1] + 0.1].forEach(z => {
      assert.ok(B.solidAt(r, 'left', -(inner - ov + 0.3), y, z) && !B.solidAt(r, 'left', -(inner - ov - 0.3), y, z), `M ${name}: lip reaches ${ov} mm at z=${z.toFixed(2)}`);
    });
    const o = m.overhang;
    assert.ok(o.stairLedgeMm <= 1.0 && o.channelRoofLedgeMm >= ov - 0.1 && o.channelRoofLedgeMm <= ov * Math.SQRT2 + 0.1, `M ${name}: only the flat lip undersides overhang (${JSON.stringify(o)})`);
    const w = r.warnings;
    if (ov > 5) assert.ok(w.some(x => /droops/.test(x)), `M ${name}: wide lip warns`);
    else if (ov - p.panelEdgeGapMm < 2.5) assert.ok(w.some(x => /held/.test(x)), `M ${name}: short overlap warns`);
    else assert.ok(!w.some(x => /droops|held|fragile/.test(x)), `M ${name}: no channel warnings (${w})`);
  });
  const fr = B.build(Object.assign(B.styleParams('parlor'), { lipMm: 1.2, channelDepthMm: 2.5 }));
  assert.ok(fr.warnings.some(x => /fragile/.test(x)) && fr.warnings.some(x => /held/.test(x)), 'M: thin lip and short overlap warn');
  console.log('Body M ok: back panel = full outline under the blocks, no part in its space; lip thickness / overlap settings (1.6-3 mm lips, 2.5-6 mm overlap, 2-6 mm walls) watertight, square flat lips, warnings past the limits');
}

console.log('\nALL BODY TESTS PASSED');
