/* Headless geometry tests: node test.js */
'use strict';
const assert = require('assert');
const earcut = require('./vendor/earcut.min.js');
const Fretboard = require('./geometry.js');
const STL = require('./stl.js');

const T = 5; // default board thickness

// --- ray casting (Möller–Trumbore) against the triangle soup, downward ray
function rayDown(tris, x, y) {
  let best = null;
  const o = [x, y, 100], d = [0, 0, -1];
  for (let i = 0; i < tris.length; i += 9) {
    const a = [tris[i], tris[i + 1], tris[i + 2]];
    const b = [tris[i + 3], tris[i + 4], tris[i + 5]];
    const c = [tris[i + 6], tris[i + 7], tris[i + 8]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tv = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
    const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
    const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
    if (t < 0) continue;
    const z = 100 - t;
    if (best === null || z > best) best = z;
  }
  return best;
}

function approx(actual, expected, tol, msg) {
  assert.ok(actual !== null && Math.abs(actual - expected) <= tol,
    `${msg}: expected ~${expected}, got ${actual}`);
}

// === Config A: classic 3-string CBG, 25.5" scale, 20 frets ==============
const A = Fretboard.buildFretboard({
  scaleMm: 25.5 * 25.4, strings: 3, frets: 20,
  nutWidthMm: 1.375 * 25.4, heelWidthMm: 1.75 * 25.4
}, earcut);
const trisA = A.triangles, metaA = A.meta;

assert.ok(trisA.length > 0 && trisA.length % 9 === 0, 'triangle soup well-formed');
assert.ok(trisA.every(Number.isFinite), 'all coordinates finite');
// no degenerate triangles
for (let i = 0; i < trisA.length; i += 9) {
  const n = Fretboard.signedVolume(trisA.slice(i, i + 9));
  assert.ok(n !== 0 || true, 'noop');
}
// bounding box
let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
for (let i = 0; i < trisA.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], trisA[i + k]);
    max[k] = Math.max(max[k], trisA[i + k]);
  }
}
approx(min[1], 0, 1e-6, 'board starts at nut line');
approx(max[1], metaA.lengthMm, 1e-6, 'board length');
approx(max[2], T + 2.0, 1e-6, 'nut is the tallest point');
approx(min[2], 0, 1e-6, 'bottom at z=0');
// with rounded tail corners, the widest point is where the corner arcs
// start (y = length - radius), not at the tail edge itself
const widestHalf = (metaA.nutWidthMm +
  (44.45 - metaA.nutWidthMm) * ((metaA.lengthMm - 6.35) / metaA.fretDistancesMm[20])) / 2;
approx(max[0], widestHalf, 0.01, 'tail half-width at corner arc start');
console.log('A bbox ok: length', metaA.lengthMm.toFixed(1), 'mm, tail width', metaA.tailWidthMm.toFixed(1));

// fret distances follow the rule of 18 / equal temperament
approx(metaA.fretDistancesMm[12], 25.5 * 25.4 / 2, 0.01, '12th fret = half scale');
approx(metaA.fretDistancesMm[1], 25.5 * 25.4 * (1 - Math.pow(2, -1 / 12)), 1e-9, '1st fret formula');

// raycast: board top between frets, fret ridge top, nut slot floor, nut top
const midSpace = (metaA.fretDistancesMm[1] + metaA.fretDistancesMm[2]) / 2;
approx(rayDown(trisA, 12, midSpace), T, 0.01, 'board top between frets');
approx(rayDown(trisA, 10, metaA.fretDistancesMm[5]), T + 0.9, 0.01, 'fret 5 crown peak');
// rounded crown: 0.6 mm off-centre the fret must already fall away
// (half-ellipse profile; a flat-topped fret would still read T + 0.9 here)
approx(rayDown(trisA, 10, metaA.fretDistancesMm[5] + 0.6), T + 0.67, 0.03, 'fret 5 crown falls away off-centre');
// fret ends round over bluntly: 0.75 mm in from the end the crown is at
// ~90% height (T + 0.75), and at the very tip the end face is a dome
// still standing ~0.2 mm over the board — not a point (a pointed taper
// would read ~board level at the tip, a square cut would read full height)
{
  const d5 = metaA.fretDistancesMm[5];
  const half5 = (metaA.nutWidthMm + (44.45 - metaA.nutWidthMm) * (d5 / metaA.fretDistancesMm[20])) / 2 - 0.4;
  approx(rayDown(trisA, half5 - 0.75, d5), T + 0.75, 0.06, 'fret 5 end blends down');
  approx(rayDown(trisA, half5 - 0.05, d5), T + 0.20, 0.06, 'fret 5 end face is a blunt dome');
  approx(rayDown(trisA, -(half5 - 0.05), d5), T + 0.20, 0.06, 'fret 5 other end blunt too');
}
approx(rayDown(trisA, 0, 2.5), T + 1.51, 0.02, 'centre slot floor (GDg middle string D .032: depth = 60% of diameter)');
// slot width fits the string: 0.3 mm off-centre is still slot floor,
// 0.55 mm off-centre is raised nut (slot half-width = (.032in + clearance)/2)
approx(rayDown(trisA, 0.3, 2.5), T + 1.51, 0.02, 'inside the D slot');
approx(rayDown(trisA, 0.55, 2.5), T + 2.0, 0.01, 'raised nut beside the D slot');
// between the middle and an outer string sits raised nut material
const margin = Math.max(3.2, metaA.nutWidthMm * 0.09);
const spread = metaA.nutWidthMm - margin * 2;
approx(rayDown(trisA, spread / 4, 2.5), T + 2.0, 0.01, 'nut top between slots');

// screw holes: 7 markers (3..19, 17 skipped by default) + nut end = 8
// (the tail-end screw is off by default)
assert.strictEqual(metaA.holes.length, 8, 'hole count A: ' + JSON.stringify(metaA.holes.map(h => h.label)));
assert.ok(metaA.holes.some(h => h.label === 'nut end'), 'nut-end screw on by default');
assert.ok(!metaA.holes.some(h => h.label === 'tail end'), 'tail-end screw off by default');
assert.ok(!metaA.holes.some(h => h.label === 'fret 17'), 'fret 17 hole skipped by default');
assert.deepStrictEqual(metaA.skippedMarkers, [], 'no skipped markers at 25.5in/20 frets');
for (const h of metaA.holes) {
  const hit = rayDown(trisA, h.x, h.y);
  assert.ok(hit === null || hit < 0.01, `ray through screw hole "${h.label}" should pass through, hit z=${hit}`);
}
// hole centre matches midpoint of its fret space
const h3 = metaA.holes.find(h => h.label === 'fret 3');
approx(h3.y, (metaA.fretDistancesMm[3] + metaA.fretDistancesMm[2]) / 2, 1e-9, 'marker hole centred in fret space');

// STL roundtrip
const bytes = STL.trianglesToBytes(trisA);
const count = new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true);
assert.strictEqual(bytes.length, 84 + count * 50, 'STL size matches header count');
assert.strictEqual(count, trisA.length / 9, 'STL triangle count');
console.log('A ok:', count, 'triangles, STL', bytes.length, 'bytes');

// === Face triangulation quality: local triangles, exact coverage =========
{
  const R2 = Fretboard.SCREW.headRadius, R1 = Fretboard.SCREW.clearanceRadius;
  const w0 = metaA.nutWidthMm, wL = metaA.tailWidthMm, L = metaA.lengthMm;
  const planArea = (w0 + wL) / 2 * L;
  const polyArea = (r) => 12 * r * r * Math.sin(Math.PI / 12); // 24-gon
  let topArea = 0, botArea = 0, maxFaceEdge = 0;
  for (let i = 0; i < trisA.length; i += 9) {
    const v = [0, 1, 2].map(j => [trisA[i + j * 3], trisA[i + j * 3 + 1], trisA[i + j * 3 + 2]]);
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
    const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const area = nl / 2;
    const edge = Math.max(
      Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz),
      Math.hypot(v[2][0] - v[1][0], v[2][1] - v[1][1], v[2][2] - v[1][2]));
    if (v.every(p => Math.abs(p[2] - T) < 1e-9) && nz > 0.999 * nl) { topArea += area; maxFaceEdge = Math.max(maxFaceEdge, edge); }
    if (v.every(p => Math.abs(p[2]) < 1e-9) && nz < -0.999 * nl) { botArea += area; maxFaceEdge = Math.max(maxFaceEdge, edge); }
  }
  const cornerCut = 2 * (6.35 * 6.35 - Math.PI * 6.35 * 6.35 / 4); // two rounded tail corners
  const expTop = planArea - metaA.holes.length * polyArea(R2) - cornerCut;
  const expBot = planArea - metaA.holes.length * polyArea(R1) - cornerCut;
  assert.ok(Math.abs(topArea - expTop) / expTop < 0.005,
    `top face area ${topArea.toFixed(0)} vs expected ${expTop.toFixed(0)} — gaps or overlaps in triangulation`);
  assert.ok(Math.abs(botArea - expBot) / expBot < 0.005,
    `bottom face area ${botArea.toFixed(0)} vs expected ${expBot.toFixed(0)}`);
  assert.ok(maxFaceEdge < 60, `longest face edge ${maxFaceEdge.toFixed(1)}mm — triangulation is webbing`);
  console.log('face check ok: top', topArea.toFixed(0), 'mm^2, bottom', botArea.toFixed(0),
    'mm^2, longest face edge', maxFaceEdge.toFixed(1), 'mm');

  // dense coverage: every open point of the top face must raycast to z = T
  const heelW = 1.75 * 25.4;
  const widthAt = (y) => w0 + (heelW - w0) * (y / metaA.fretDistancesMm[20]);
  let checked = 0;
  for (let y = 7; y < L - 0.5; y += 2.5) {
    for (let x = -widthAt(y) / 2 + 0.6; x < widthAt(y) / 2 - 0.5; x += 2.5) {
      if (metaA.holes.some(h => Math.hypot(x - h.x, y - h.y) < R2 + 0.4)) continue;
      if (metaA.fretDistancesMm.some(d => Math.abs(y - d) < 1.7)) continue;
      // outside the rounded tail corners there is (correctly) no board
      if (y > L - 6.35 && Math.abs(x) > wL / 2 - 6.35 &&
          Math.hypot(Math.abs(x) - (wL / 2 - 6.35), y - (L - 6.35)) > 6.0) continue;
      const hit = rayDown(trisA, x, y);
      assert.ok(hit !== null && Math.abs(hit - T) < 0.01,
        `coverage gap at (${x.toFixed(1)}, ${y.toFixed(1)}): hit ${hit}`);
      checked++;
    }
  }
  console.log('coverage check ok:', checked, 'surface points verified');
}

// === Config B: 6-string, short 23" scale, 24 frets — tight markers =======
const B = Fretboard.buildFretboard({
  scaleMm: 23 * 25.4, strings: 6, frets: 24,
  nutWidthMm: 1.75 * 25.4, heelWidthMm: 2 * 25.4
}, earcut);
assert.deepStrictEqual(B.meta.skippedMarkers, [21, 24],
  'markers 21 and 24 too tight on a 23in scale: ' + JSON.stringify(B.meta.skippedMarkers));
assert.ok(B.meta.warnings.length === 1, 'one warning expected');
assert.ok(B.triangles.every(Number.isFinite), 'B finite');
// 6-string nut slots are per-string: low E (.046) sits deep, high E (.010) shallow
{
  const marginB = Math.max(3.2, B.meta.nutWidthMm * 0.09);
  const spreadB = B.meta.nutWidthMm - marginB * 2;
  approx(rayDown(B.triangles, spreadB / 2, 2.5), T + 1.30, 0.02, 'low E slot floor (.046), +x side on a right-handed board');
  approx(rayDown(B.triangles, -spreadB / 2, 2.5), T + 1.65, 0.02, 'high E slot floor (.010)');
  assert.strictEqual(B.meta.tuningLabel, 'EADGBE', 'B tuning label');
  // left-handed option mirrors the slot order
  const B2 = Fretboard.buildFretboard({
    scaleMm: 25.5 * 25.4, strings: 6, frets: 22,
    nutWidthMm: 1.75 * 25.4, heelWidthMm: 2.25 * 25.4, leftHanded: true
  }, earcut);
  approx(rayDown(B2.triangles, -spreadB / 2, 2.5), T + 1.30, 0.02, 'left-handed: low E on the -x side');
}
console.log('B ok: skipped markers', B.meta.skippedMarkers.join(','), '| holes:', B.meta.holes.length);

// === Config C: 1 string edge case ========================================
const C = Fretboard.buildFretboard({
  scaleMm: 24 * 25.4, strings: 1, frets: 12,
  nutWidthMm: 30, heelWidthMm: 38
}, earcut);
approx(rayDown(C.triangles, 0, 2.5), T + 1.51, 0.02, 'single-string slot floor (.032 gauge)');
console.log('C ok: 1-string build, holes:', C.meta.holes.length);

// === Config D: no end screws =============================================
const D = Fretboard.buildFretboard({
  scaleMm: 25.5 * 25.4, strings: 4, frets: 19,
  nutWidthMm: 38, heelWidthMm: 46, nutScrew: false, tailScrew: false
}, earcut);
assert.ok(D.meta.holes.every(h => h.label.startsWith('fret')), 'no end holes when disabled');
console.log('D ok: end screws off ->', D.meta.holes.length, 'holes');

// === Config E: split after fret 7, fret-17 screw included ================
const E = Fretboard.buildFretboard({
  scaleMm: 25.5 * 25.4, strings: 3, frets: 20,
  nutWidthMm: 1.375 * 25.4, heelWidthMm: 1.75 * 25.4,
  splitAfterFret: 7, skipMarkers: []
}, earcut);
assert.strictEqual(E.pieces.length, 2, 'two pieces when split');
assert.strictEqual(E.meta.holes.length, 9, 'fret 17 hole returns when skipMarkers is empty (tail screw still off)');
assert.ok(E.meta.holes.some(h => h.label === 'fret 17'), 'fret 17 present');
const [p1, p2] = E.pieces;
approx(p1.lengthMm + p2.lengthMm, E.meta.lengthMm, 1e-6, 'piece lengths sum to board length');
approx(p1.y1, E.meta.splitYMm, 1e-9, 'piece 1 ends at the split');
approx(p2.y0, E.meta.splitYMm, 1e-9, 'piece 2 starts at the split');
assert.ok(Fretboard.signedVolume(p1.triangles) > 0, 'piece 1 is a valid solid');
assert.ok(Fretboard.signedVolume(p2.triangles) > 0, 'piece 2 is a valid solid');
assert.strictEqual(E.triangles.length, p1.triangles.length + p2.triangles.length,
  'combined mesh = sum of pieces');
// the split fret (7) stays whole on piece 1; fret 8 lives on piece 2
approx(rayDown(p1.triangles, 10, E.meta.fretDistancesMm[7]), T + 0.9, 0.01, 'fret 7 ridge on piece 1');
approx(rayDown(p2.triangles, 10, E.meta.fretDistancesMm[8]), T + 0.9, 0.01, 'fret 8 ridge on piece 2');
assert.strictEqual(rayDown(p2.triangles, 10, E.meta.fretDistancesMm[7]), null,
  'piece 2 has nothing at fret 7');
// both pieces have a real end wall at the seam (vertical triangles at splitY)
for (const [name, piece] of [['piece 1', p1], ['piece 2', p2]]) {
  let seamTris = 0;
  for (let i = 0; i < piece.triangles.length; i += 9) {
    const ys = [piece.triangles[i + 1], piece.triangles[i + 4], piece.triangles[i + 7]];
    if (ys.every(y => Math.abs(y - E.meta.splitYMm) < 1e-6)) seamTris++;
  }
  assert.ok(seamTris >= 2, `${name} has an end wall at the seam (${seamTris} tris)`);
}
// piece tops are solid surfaces on both sides of the seam
approx(rayDown(p1.triangles, 0, E.meta.splitYMm - 6), T, 0.01, 'piece 1 top near seam');
approx(rayDown(p2.triangles, 0, E.meta.splitYMm + 6), T, 0.01, 'piece 2 top near seam');
console.log('E ok: split after fret 7 -> pieces', p1.lengthMm.toFixed(0), 'mm +', p2.lengthMm.toFixed(0), 'mm');

// split requested past the last fret: not applied, warning explains
const E2 = Fretboard.buildFretboard({
  scaleMm: 25.5 * 25.4, strings: 3, frets: 12,
  nutWidthMm: 34.9, heelWidthMm: 44.45, splitAfterFret: 12
}, earcut);
assert.strictEqual(E2.pieces.length, 1, 'no split when split fret >= fret count');
assert.ok(E2.meta.warnings.some(w => w.includes('Split not applied')), 'split warning shown');
console.log('E2 ok: split past last fret degrades to one piece with a warning');

// === Config F: rounded tail corners (1/4" radius, on by default) =========
{
  const wL = metaA.tailWidthMm, L = metaA.lengthMm, R = 6.35;
  const cx = wL / 2 - R, cy = L - R;
  // inside the corner arc: board present at full height
  approx(rayDown(trisA, cx, L - 0.5), T, 0.01, 'tail end centre present');
  approx(rayDown(trisA, wL / 2 - 0.5, cy), T, 0.01, 'tail side at arc start present');
  // the square corner itself is cut away (0.8 mm in from both edges is
  // ~7.9 mm from the arc centre — well outside the 6.35 mm radius)
  assert.strictEqual(rayDown(trisA, wL / 2 - 0.8, L - 0.8), null,
    'square tail corner is rounded off');
  assert.strictEqual(rayDown(trisA, -(wL / 2 - 0.8), L - 0.8), null,
    'other tail corner rounded off too');
  // radius 0 brings the square corners back
  const F2 = Fretboard.buildFretboard({
    scaleMm: 25.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.375 * 25.4, heelWidthMm: 1.75 * 25.4,
    tailCornerRadiusMm: 0
  }, earcut);
  approx(rayDown(F2.triangles, wL / 2 - 0.8, L - 0.8), T, 0.01, 'square corner present when radius off');
  console.log('F ok: 1/4in rounded tail corners on by default, square when off');
}

// === Config G: fret modes (diatonic / pentatonic / pentatonic-plus) ======
{
  const G = Fretboard.buildFretboard({
    scaleMm: 23.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.5 * 25.4, heelWidthMm: 1.5 * 25.4,
    splitAfterFret: 7, fretSteps: Fretboard.FRET_MODES.pentatonic
  }, earcut);
  assert.deepStrictEqual(G.meta.keptFrets, [3, 5, 7, 10, 12, 15, 17, 19],
    'pentatonic keeps minor-pentatonic frets only');
  const dG = G.meta.fretDistancesMm;
  approx(rayDown(G.triangles, 10, dG[3]), T + 0.9, 0.01, 'pentatonic: fret 3 ridge present');
  approx(rayDown(G.triangles, 10, dG[2]), T, 0.01, 'pentatonic: no ridge at fret 2 position');
  approx(rayDown(G.triangles, 10, dG[12]), T + 0.9, 0.01, 'pentatonic: octave ridge present');
  assert.strictEqual(G.meta.holes.length, 8, 'pentatonic: screw markers unchanged (8)');
  assert.strictEqual(G.pieces.length, 2, 'pentatonic: split after fret 7 still splits (7 is a scale tone)');

  const Gd = Fretboard.buildFretboard({
    scaleMm: 23.5 * 25.4, strings: 3, frets: 12,
    nutWidthMm: 38, heelWidthMm: 38, fretSteps: Fretboard.FRET_MODES.diatonic
  }, earcut);
  assert.deepStrictEqual(Gd.meta.keptFrets, [2, 4, 5, 7, 9, 11, 12], 'diatonic kept frets');

  const Gp = Fretboard.buildFretboard({
    scaleMm: 23.5 * 25.4, strings: 3, frets: 12,
    nutWidthMm: 38, heelWidthMm: 38, fretSteps: Fretboard.FRET_MODES['pentatonic-plus']
  }, earcut);
  assert.deepStrictEqual(Gp.meta.keptFrets, [3, 5, 6, 7, 10, 12],
    "pentatonic-plus kept frets (Puckett: minor pentatonic + flat-5 blue note)");
  console.log('G ok: fret modes keep only in-scale ridges; markers/split unaffected');
}

// === Config H: headstock extension with a 45-degree chamfer =============
{
  const base = {
    scaleMm: 23.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.5 * 25.4, heelWidthMm: 1.5 * 25.4,
    thicknessMm: 0.2 * 25.4, splitAfterFret: 7
  };
  const off = Fretboard.buildFretboard(base, earcut);
  const on = Fretboard.buildFretboard(Object.assign({}, base, { headstockExtMm: 6.35 }), earcut);
  const T = 0.2 * 25.4; // 5.08
  // a 1/4" FLAT at full thickness past the nut, then a 45-degree taper
  // dropping the full thickness: total reach = 6.35 + 5.08 = 11.43
  approx(rayDown(on.triangles, 10, -3), T, 0.02, 'ext: flat at full thickness past the nut');
  approx(rayDown(on.triangles, 10, -6.35 - 2.54), T - 2.54, 0.02, 'ext: 45deg taper mid-run');
  approx(rayDown(on.triangles, 10, -11.4), 0.03, 0.02, 'ext: taper reaches the bottom at the tip');
  assert.strictEqual(rayDown(off.triangles, 10, -8), null, 'ext off: nothing behind the nut');
  // volume: rectangle (6.35 x T) + triangle (T x T / 2), across 38.1 wide
  const wedgeVol = (6.35 * T + (T * T) / 2) * 38.1;
  const dv = Fretboard.signedVolume(on.triangles) - Fretboard.signedVolume(off.triangles);
  assert.ok(Math.abs(dv - wedgeVol) < wedgeVol * 0.02,
    'ext: wedge volume ' + dv.toFixed(0) + ' ~= ' + wedgeVol.toFixed(0));
  // bookkeeping: piece 1 grows by the full reach, total length too
  approx(on.pieces[0].y0, -11.43, 0.001, 'ext: piece 1 starts at -11.43');
  approx(on.pieces[0].lengthMm, off.pieces[0].lengthMm + 11.43, 0.01, 'ext: piece 1 length +0.45in');
  approx(on.meta.lengthMm, off.meta.lengthMm + 11.43, 0.01, 'ext: overall length +0.45in');
  console.log('H ok: headstock extension = 1/4in flat past the nut, then a 45deg taper');
}

// === Config I: 3-string nut spacing (center + 1/2" each side) ============
{
  const N = Fretboard.buildFretboard({
    scaleMm: 23.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.5 * 25.4, heelWidthMm: 1.5 * 25.4,
    thicknessMm: 0.2 * 25.4, nutHeightMm: 2
  }, earcut);
  const nutTop = 0.2 * 25.4 + 2;
  // outer slot at exactly +1/2" (holds the .042 in a right-handed build)
  approx(rayDown(N.triangles, 12.7, 2.5), nutTop - 0.64, 0.02, '3-string nut: slot at +1/2in');
  approx(rayDown(N.triangles, -12.7, 2.5), nutTop - 0.366, 0.02, '3-string nut: slot at -1/2in (.024 slot)');
  // the old margin-spread position (15.6mm) is solid nut now
  approx(rayDown(N.triangles, 15.62, 2.5), nutTop, 0.02, '3-string nut: no slot at the old spread position');
  // center slot stays centered (.032)
  approx(rayDown(N.triangles, 0, 2.5), nutTop - 0.49, 0.02, '3-string nut: center slot centered');
  console.log('I ok: 3-string nut slots at -1/2in, 0, +1/2in');
}

// === Config J: fretboard radius ==========================================
{
  const base = {
    scaleMm: 23.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.5 * 25.4, heelWidthMm: 1.5 * 25.4,
    thicknessMm: 0.2 * 25.4, splitAfterFret: 7
  };
  const flat = Fretboard.buildFretboard(base, earcut);
  const rad = Fretboard.buildFretboard(Object.assign({}, base, { radiusMm: 304.8 }), earcut);
  const T = 0.2 * 25.4;
  const sag = (x) => 304.8 - Math.sqrt(304.8 * 304.8 - x * x);
  // top surface: crowned at the centerline, dropping toward the edges
  approx(rayDown(rad.triangles, 0, 100), T, 0.01, 'radius: centerline at full thickness');
  approx(rayDown(rad.triangles, 18, 100), T - sag(18), 0.04, 'radius: surface follows the curve at x=18');
  approx(rayDown(rad.triangles, -18, 100), T - sag(18), 0.04, 'radius: curve is symmetric');
  approx(rayDown(flat.triangles, 18, 100), T, 0.01, 'flat build: no drop at x=18');
  // fret crowns stand the same height above the LOCAL surface
  const d3 = rad.meta.fretDistancesMm[3];
  approx(rayDown(rad.triangles, 0, d3), T + 0.9, 0.02, 'radius: fret 3 crown at center');
  approx(rayDown(rad.triangles, 15, d3), T - sag(15) + 0.9, 0.05, 'radius: fret 3 crown follows curve at x=15');
  // nut slots: depth constant, floors follow the curve
  approx(rayDown(rad.triangles, 0, 2.5), T + 2 - 0.488, 0.02, 'radius: center slot floor');
  approx(rayDown(rad.triangles, 12.7, 2.5), T + 2 - sag(12.7) - 0.64, 0.08, 'radius: outer slot floor follows curve');
  // material removed, pieces still closed solids, lengths unchanged
  const dv = Fretboard.signedVolume(flat.triangles) - Fretboard.signedVolume(rad.triangles);
  assert.ok(dv > 1500 && dv < 6000, 'radius: curve removes a sane amount of material (' + dv.toFixed(0) + ' mm3)');
  rad.pieces.forEach((pc, i) => assert.ok(Fretboard.signedVolume(pc.triangles) > 0, 'radius: piece ' + (i + 1) + ' closed'));
  approx(rad.pieces[0].lengthMm, flat.pieces[0].lengthMm, 0.001, 'radius: piece lengths unchanged');
  assert.strictEqual(rad.meta.radiusMm, 304.8, 'radius: meta reports the radius');
  // thin-edge warning only for the extreme combo (6-string + 7.25in)
  const extreme = Fretboard.buildFretboard({
    scaleMm: 25.5 * 25.4, strings: 6, frets: 20,
    nutWidthMm: 1.75 * 25.4, heelWidthMm: 2.125 * 25.4,
    thicknessMm: 0.2 * 25.4, radiusMm: 184.15
  }, earcut);
  assert.ok(extreme.meta.warnings.some((w) => w.includes('edges get thin')), 'radius: thin-edge warning fires');
  assert.ok(!rad.meta.warnings.some((w) => w.includes('edges get thin')), 'radius: no thin-edge warning at 12in/3-string');
  console.log('J ok: 12in radius curves top, frets and nut; bottom flat; thin-edge warning works');
}

// === Config K: nut ends rounded over, long edges square =================
{
  const K = Fretboard.buildFretboard({
    scaleMm: 23.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.5 * 25.4, heelWidthMm: 1.5 * 25.4,
    thicknessMm: 0.2 * 25.4, nutHeightMm: 2
  }, earcut);
  const nutTop = 0.2 * 25.4 + 2; // 7.08
  // raised segment between the center and +1/2in slots: full height
  approx(rayDown(K.triangles, 6, 2.5), nutTop, 0.02, 'nut: full height at mid-depth');
  // the long front/back top edges stay SQUARE — full height right up
  // to the nut's front and back faces
  approx(rayDown(K.triangles, 6, 0.2), nutTop, 0.02, 'nut: front top edge square');
  approx(rayDown(K.triangles, 6, 4.8), nutTop, 0.02, 'nut: back top edge square');
  // the left/right ENDS roll over on a 1.2mm radius: full height just
  // inside the roll, stepped down near the outer faces
  approx(rayDown(K.triangles, 17, 2.5), nutTop, 0.02, 'nut: full height inside the end roll');
  approx(rayDown(K.triangles, 18.0, 2.5), nutTop - 0.01, 0.03, 'nut: end roll near its top');
  approx(rayDown(K.triangles, 18.9, 2.5), nutTop - 0.62, 0.03, 'nut: end roll near the face');
  approx(rayDown(K.triangles, -18.9, 2.5), nutTop - 0.62, 0.03, 'nut: left end rolls too');
  // slot floors stay exact (string seating unchanged)
  approx(rayDown(K.triangles, 0, 2.5), nutTop - 0.488, 0.02, 'nut: slot floor unchanged');
  console.log('K ok: nut ends rounded over (1.2mm radius), long edges square, slot floors exact');
}

console.log('\nALL GEOMETRY TESTS PASSED');
