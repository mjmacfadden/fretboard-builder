/*
 * body-app.js — UI wiring for the body builder page.
 * Geometry lives in body-geometry.js, STL encoding in stl.js, the 3D
 * preview in preview.js (the fretboard builder's renderer). No
 * libraries from the network: works offline straight from file://.
 */
(function () {
  'use strict';

  var IN = 25.4;
  var B = window.BodyBuilder;
  var $ = function (id) { return document.getElementById(id); };

  // Controls whose id is the parameter name.
  var NUM_FIELDS = ['lengthIn', 'lowerWidthIn', 'waistWidthIn', 'upperWidthIn', 'widthIn', 'cornerRadiusIn',
    'depthIn', 'lowerPos', 'waistPos', 'upperPos', 'wallMm', 'panelThicknessMm', 'panelFitMm',
    'grooveDepthMm', 'panelEdgeGapMm', 'topLipMm', 'bottomLipMm', 'pocketLengthIn', 'pocketWidthIn',
    'pocketDepthIn', 'pocketFitMm', 'neckBlockSideMm', 'neckBlockEndMm', 'baseBlockMm',
    'tailBlockLengthMm', 'tailBlockWidthMm', 'neckScrewSpanXIn', 'neckScrewSpanYIn', 'neckScrewHoleMm',
    'plateThicknessMm', 'screwBiteMm', 'wellDiameterMm', 'wellFloorMm', 'collarClearanceMm', 'collarNutFloorMm'];
  var SELECT_FIELDS = ['neckScrewMode', 'boltSize', 'neckBolts', 'collarFastener'];

  var styleEl = $('style');
  var shape = 'bouts';      // the current outline family (kept when you go Custom)
  var result = null, preview = null, viewMode = 'rim', timer = null;

  function readParams() {
    var p = { style: styleEl.value, shape: shape };
    NUM_FIELDS.forEach(function (k) {
      var v = parseFloat($(k).value);
      p[k] = isFinite(v) ? v : B.DEFAULTS[k];
    });
    SELECT_FIELDS.forEach(function (k) { p[k] = $(k).value; });
    p.neckBolts = Number(p.neckBolts);
    p.tailBolts = $('tailBolts').checked ? 1 : 0;
    p.neckCollar = $('neckCollar').checked;
    p.leftHanded = $('leftHanded').checked;
    var bed = parseFloat($('bedIn').value);
    p.bedMm = (isFinite(bed) ? bed : 12.9) * IN;
    return p;
  }

  function syncShapeRows() {
    $('bouts-rows').hidden = shape !== 'bouts';
    $('bout-pos-rows').hidden = shape !== 'bouts';
    $('box-rows').hidden = shape !== 'box' && shape !== 'tstyle';
    $('corner-row').hidden = shape !== 'box';
    $('lefty-row').hidden = shape !== 'tstyle';
    $('fastener-row').hidden = !$('neckCollar').checked;
    $('collar-dl-row').hidden = !$('neckCollar').checked;
  }

  // Style presets fill in the shape fields (see BodyBuilder.STYLES);
  // editing any of those fields afterwards flips the menu to Custom.
  function applyStyle(key, quiet) {
    var st = B.STYLES[key];
    if (!st) { syncShapeRows(); if (!quiet) schedule(); return; }
    var v = st.values;
    shape = v.shape;
    B.STYLE_FIELDS.forEach(function (k) {
      if (k === 'shape' || v[k] === undefined) return;
      $(k).value = String(v[k]);
    });
    syncShapeRows();
    if (!quiet) schedule();
  }

  function fmtIn(mm) { return (mm / IN).toFixed(2) + '″'; }
  function fmtMm(mm) { return mm.toFixed(1) + ' mm'; }

  function shifted(t, dx, dy, dz) {
    var out = new Float32Array(t.length);
    for (var i = 0; i < t.length; i += 3) {
      out[i] = t[i] + dx; out[i + 1] = t[i + 1] + dy; out[i + 2] = t[i + 2] + dz;
    }
    return out;
  }

  function sceneLayers() {
    var g = result.groups, m = result.meta;
    var WOOD = [208, 170, 112], WOOD2 = [190, 152, 98], PLY = [232, 214, 170], PLY2 = [214, 196, 152];
    var gap = viewMode === 'exploded' ? Math.max(40, m.widthMm * 0.25) : 0;
    var layers = [
      { tris: gap ? shifted(g.left, -gap, 0, 0) : g.left, color: WOOD },
      { tris: gap ? shifted(g.right, gap, 0, 0) : g.right, color: WOOD2 }
    ];
    if (g.collar) layers.push({ tris: gap ? shifted(g.collar, 0, 0, m.depthMm - m.collar.bottomZ + 30) : g.collar, color: [176, 132, 84] });
    if (viewMode !== 'rim') {
      if (!result.panelTris) {
        result.panelTris = {
          top: B.panelMesh(m.panels.top.outline, m.panels.topZ[0], m.panels.topZ[1]),
          back: B.panelMesh(m.panels.back.outline, m.panels.backZ[0], m.panels.backZ[1])
        };
      }
      layers.push({ tris: result.panelTris.top, color: PLY }, { tris: result.panelTris.back, color: PLY2 });
    }
    return layers;
  }

  function render(keepView) {
    if (preview && result) preview.setScene(sceneLayers(), keepView);
  }

  function rebuild() {
    timer = null;
    var t0 = Date.now();
    var p = readParams();
    try {
      result = B.build(p);
    } catch (e) {
      $('status').textContent = 'Could not build this shape: ' + e.message;
      return;
    }
    var m = result.meta, w = result.warnings.slice();

    $('size-out').textContent = fmtIn(m.lengthMm) + ' long × ' + fmtIn(m.widthMm) + ' wide × ' + fmtIn(m.depthMm) +
      ' deep (' + m.lengthMm.toFixed(0) + ' × ' + m.widthMm.toFixed(0) + ' × ' + m.depthMm.toFixed(0) + ' mm)';
    $('bed-out').textContent = fmtIn(m.halfFootprintMm[1]) + ' × ' + (m.symmetric ? fmtIn(m.halfFootprintMm[0])
      : fmtIn(m.leftFootprintMm[0]) + ' (left) / ' + fmtIn(m.rightFootprintMm[0]) + ' (right)') + ' footprint, ' +
      fmtIn(m.halfHeightMm) + ' tall — ' + (m.fitsBed
        ? 'fits the ' + fmtIn(m.bedMm) + ' bed (' + (m.bedMm - m.lengthMm).toFixed(1) + ' mm to spare on length)'
        : 'does NOT fit the ' + fmtIn(m.bedMm) + ' bed (' + Math.abs(m.bedMm - m.lengthMm).toFixed(1) + ' mm too long)');
    $('panels-out').textContent = 'top ' + m.panels.top.sizeMm[1].toFixed(1) + ' × ' + m.panels.top.sizeMm[0].toFixed(1) +
      ' mm (with the pocket notch), back ' + m.panels.back.sizeMm[1].toFixed(1) + ' × ' + m.panels.back.sizeMm[0].toFixed(1) + ' mm';
    $('pocket-out').textContent = (m.pocket.lengthMm / IN).toFixed(2) + '″ long × ' + (m.pocket.widthMm / IN).toFixed(3) +
      '″ wide, floor ' + (m.pocket.depthMm / IN).toFixed(2) + '″ below the top of the top panel; ' +
      fmtMm(m.plasticUnderPocketMm) + ' of solid block under the floor';
    var bite = ' (' + m.neckScrewBiteMm.toFixed(0) + ' mm into the neck)';
    var screwTxt = m.neckScrewWells
      ? '4 × #8 wood screws, ' + m.neckScrewLengthIn + '″ long' + bite + ', with washers or ferrules in the wells'
      : '4 × #8 wood screws, ' + m.neckScrewLengthIn + '″ long' + bite + ', through a back plate on the back face';
    $('screws-out').textContent = screwTxt + ' (' + (p.neckScrewSpanXIn).toFixed(3) + '″ × ' + p.neckScrewSpanYIn.toFixed(3) + '″ hole pattern). ' + m.neckScrewNote;
    $('bolts-out').textContent = m.bolts.length ? m.bolts.map(function (b) {
      return b.name + ': ' + m.boltSize + ' × ' + Math.ceil(b.minLengthMm / 5) * 5 + ' mm+ (or threaded rod), clamps ' + b.gripMm.toFixed(0) + ' mm';
    }).join('; ') + '. Washers both sides.' : 'none';
    var c = m.collar;
    $('collar-out').textContent = c
      ? c.bolts.length + ' × ' + m.boltSize + ' × ' + c.boltLengthMm + ' mm bolts up from the back face' +
        (c.wells ? ' (heads in counterbored wells)' : '') + ' into ' +
        (c.fastener === 'insert' ? 'heat-set inserts' : 'hex nuts in traps') + '; collar ' +
        (c.footprintMm[0] / IN).toFixed(2) + '″ × ' + (c.footprintMm[1] / IN).toFixed(2) + '″ × ' + fmtMm(c.heightMm) +
        ', split at the pocket floor. ' + c.boltNote
      : 'off — the neck block is part of each half';
    $('overhang-out').textContent = 'no supports needed — widest unsupported ledge ' + m.overhang.widestLedgeMm.toFixed(1) +
      ' mm (45° staircase steps of ' + B.STEP_MM + ' mm)';

    var warnEl = $('warnings');
    warnEl.hidden = !w.length;
    warnEl.textContent = w.join(' ');

    var base = 'body-' + (p.style === 'custom' ? 'custom' : p.style) + '-' + p.lengthIn.toFixed(2) + 'in' +
      (p.leftHanded && !m.symmetric ? '-lefty' : '');
    result.names = {
      left: base + '-left-half.stl', right: base + '-right-half.stl', collar: base + '-neck-collar.stl',
      topSvg: base + '-top-panel.svg', backSvg: base + '-back-panel.svg',
      topDxf: base + '-top-panel.dxf', backDxf: base + '-back-panel.dxf'
    };
    $('filename').textContent = result.names.left + ' · ' + result.names.right + (m.collar ? ' · ' + result.names.collar : '');
    $('status').textContent = 'Built in ' + (Date.now() - t0) + ' ms — ' +
      (m.triangles.left + m.triangles.right + m.triangles.collar).toLocaleString() + ' triangles, watertight parts.';
    render(true);
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    $('status').textContent = 'Building…';
    timer = setTimeout(rebuild, 150);
  }

  function download(data, filename, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  // ---- events
  styleEl.addEventListener('change', function () { applyStyle(styleEl.value); });
  B.STYLE_FIELDS.forEach(function (k) {
    var el = $(k);
    if (!el) return;
    el.addEventListener('input', function () { styleEl.value = 'custom'; });
  });
  NUM_FIELDS.forEach(function (k) { $(k).addEventListener('input', schedule); });
  SELECT_FIELDS.forEach(function (k) { $(k).addEventListener('change', schedule); });
  $('tailBolts').addEventListener('change', schedule);
  $('leftHanded').addEventListener('change', schedule);
  // the collar replaces the sideways neck bolt; without it, put one back
  $('neckCollar').addEventListener('change', function () {
    $('neckBolts').value = $('neckCollar').checked ? '0' : '1';
    syncShapeRows(); schedule();
  });
  $('bedIn').addEventListener('input', schedule);

  $('dl-left').addEventListener('click', function () { if (result) download(STLExport.trianglesToSTL(result.groups.left), result.names.left); });
  $('dl-right').addEventListener('click', function () { if (result) download(STLExport.trianglesToSTL(result.groups.right), result.names.right); });
  // the collar prints underside down: move it to z = 0 for the STL
  $('dl-collar').addEventListener('click', function () {
    if (result && result.groups.collar) download(STLExport.trianglesToSTL(shifted(result.groups.collar, 0, 0, -result.meta.collar.bottomZ)), result.names.collar);
  });
  $('dl-top-svg').addEventListener('click', function () { if (result) download(B.panelSVG(result.meta.panels.top.outline, 'Top panel'), result.names.topSvg, 'image/svg+xml'); });
  $('dl-back-svg').addEventListener('click', function () { if (result) download(B.panelSVG(result.meta.panels.back.outline, 'Back panel'), result.names.backSvg, 'image/svg+xml'); });
  $('dl-top-dxf').addEventListener('click', function () { if (result) download(B.panelDXF(result.meta.panels.top.outline), result.names.topDxf, 'application/dxf'); });
  $('dl-back-dxf').addEventListener('click', function () { if (result) download(B.panelDXF(result.meta.panels.back.outline), result.names.backDxf, 'application/dxf'); });

  Array.prototype.forEach.call(document.querySelectorAll('.view-row button'), function (btn) {
    btn.addEventListener('click', function () {
      if (!result || !preview) return;
      var m = result.meta;
      if (btn.dataset.view) { viewMode = btn.dataset.view; render(true); return; }
      var cam = btn.dataset.cam;
      if (cam === 'top') preview.setView({ az: 0, el: 1.5, zoom: 0.75, center: [0, m.lengthMm / 2, m.depthMm / 2] });
      if (cam === 'back') preview.setView({ az: 0, el: -1.5, zoom: 0.75, center: [0, m.lengthMm / 2, m.depthMm / 2] });
      if (cam === 'pocket') preview.setView({ az: -2.6, el: 0.6, zoom: 2.2, center: [0, m.lengthMm - m.pocket.lengthMm / 2, m.depthMm * 0.55] });
    });
  });

  // ---- start
  applyStyle(styleEl.value, true);
  preview = window.Preview3D.create($('preview'), $('preview-fallback'));
  rebuild();
  render(false);
})();
