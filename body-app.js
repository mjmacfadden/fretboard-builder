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
    'depthIn', 'lowerPos', 'waistPos', 'upperPos', 'wallMm', 'floorMm', 'panelThicknessMm', 'shelfAllowanceMm',
    'shelfWidthMm', 'shelfLipMm', 'topFitMm', 'pocketLengthIn', 'pocketWidthIn', 'pocketDepthIn', 'pocketFitMm',
    'neckBlockSideMm', 'neckBlockEndMm', 'neckScrewSpanXIn', 'neckScrewSpanYIn', 'neckScrewHoleMm',
    'plateThicknessMm', 'screwBiteMm', 'wellDiameterMm', 'wellFloorMm', 'accessLengthMm', 'accessWidthMm',
    'accessCornerMm', 'accessPos', 'coverThicknessMm', 'coverFitMm', 'accessRingMm', 'accessRingHeightMm',
    'coverScrews', 'coverScrewHoleMm', 'coverScrewClearMm', 'bedMarginMm'];
  var SELECT_FIELDS = ['neckScrewMode'];
  var CHECK_FIELDS = ['accessPanel', 'fitBed', 'leftHanded'];

  var styleEl = $('style');
  var shape = 'bouts';      // the current outline family (kept when you go Custom)
  var result = null, preview = null, viewMode = 'body', timer = null;

  function readParams() {
    var p = { style: styleEl.value, shape: shape };
    NUM_FIELDS.forEach(function (k) {
      var v = parseFloat($(k).value);
      p[k] = isFinite(v) ? v : B.DEFAULTS[k];
    });
    SELECT_FIELDS.forEach(function (k) { p[k] = $(k).value; });
    CHECK_FIELDS.forEach(function (k) { p[k] = $(k).checked; });
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
    var m = result.meta;
    var WOOD = [208, 170, 112], PLY = [232, 214, 170], COVER = [120, 150, 190];
    var ex = viewMode === 'exploded';
    var layers = [{ tris: result.body, color: WOOD }];
    if (result.cover) layers.push({ tris: ex ? shifted(result.cover, 0, 0, -Math.max(40, m.depthMm * 0.6)) : result.cover, color: COVER });
    if (viewMode !== 'body') {
      if (!result.topTris) result.topTris = B.panelMesh(m.topPanel.outline, m.topPanel.z0, m.topPanel.z1);
      layers.push({ tris: ex ? shifted(result.topTris, 0, 0, Math.max(40, m.depthMm * 0.6)) : result.topTris, color: PLY });
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
      ' deep (' + m.lengthMm.toFixed(1) + ' × ' + m.widthMm.toFixed(1) + ' × ' + m.depthMm.toFixed(1) + ' mm)';
    $('bed-out').textContent = 'one piece, back face down; ' + (m.fitsBed
      ? 'fits the ' + fmtIn(m.bedMm) + ' bed with the ' + m.bedMarginMm + ' mm margin' : 'does NOT fit the ' + fmtIn(m.bedMm) + ' bed') +
      (m.scaled ? ' — outline scaled to ' + (m.outlineScale * 100).toFixed(1) + '% (from ' + fmtIn(m.naturalLengthMm) + ' × ' + fmtIn(m.naturalWidthMm) +
        '); pocket, wall, floor, shelf and screw holes stay true size' : '');
    var sh = m.shelf;
    $('shelf-out').textContent = fmtMm(sh.widthMm) + ' wide (' + fmtMm(sh.glueWidthMm) + ' glue surface), ' + sh.dropMm.toFixed(2) +
      ' mm below the rim edge (top ' + m.topPanel.thicknessMm.toFixed(2) + ' + ' + sh.allowanceMm.toFixed(2) + ' mm); ' + fmtMm(sh.lipMm) +
      ' straight edge, then a 45° taper back to the wall (' + sh.steps + ' steps of ' + sh.stepMm.toFixed(2) + ' mm)';
    var tp = m.topPanel;
    $('top-out').textContent = tp.sizeMm[1].toFixed(1) + ' × ' + tp.sizeMm[0].toFixed(1) + ' mm with the pocket notch, ' +
      fmtMm(tp.fitMm) + ' inside the rim; its face sits ' + tp.belowRimMm.toFixed(2) + ' mm below the rim edge';
    var pk = m.pocket;
    $('pocket-out').textContent = (pk.lengthMm / IN).toFixed(2) + '″ long × ' + (pk.widthMm / IN).toFixed(3) + '″ wide, square corners, floor ' +
      (pk.depthMm / IN).toFixed(2) + '″ below the top surface (never scaled)';
    var nb = m.neckBlock;
    $('block-out').textContent = 'integral, solid from the back floor up to the shelf: ' + (nb.footprintMm[0] / IN).toFixed(2) + '″ × ' +
      (nb.footprintMm[1] / IN).toFixed(2) + '″, ' + fmtMm(nb.plasticUnderPocketMm) + ' of floor and block under the pocket';
    var ns = m.neckScrews, stk = ns.stack;
    $('screws-out').textContent = '4 × #8 wood screws, ' + ns.lengthIn + '″ long (' + Math.round(stk.biteMm) + ' mm into the neck) ' +
      (ns.wells ? 'with washers or ferrules in ' + ns.wellDiameterMm + ' mm wells (' + fmtMm(stk.washerMm) + ' washer + ' + fmtMm(stk.blockMm) + ' block)'
        : 'through a back plate (' + fmtMm(stk.plateMm) + ' plate + ' + fmtMm(stk.blockMm) + ' floor and block)') +
      '; ' + p.neckScrewSpanXIn.toFixed(3) + '″ × ' + p.neckScrewSpanYIn.toFixed(3) + '″ hole pattern. ' + ns.note;
    var a = m.access;
    $('access-out').textContent = a
      ? 'opening ' + a.openingMm[0].toFixed(0) + ' × ' + a.openingMm[1].toFixed(0) + ' mm; recess ' + a.cover.sizeMm[0].toFixed(1) + ' × ' +
        a.cover.sizeMm[1].toFixed(1) + ' mm at the back face, ' + fmtMm(a.recessDepthMm) + ' deep with a 45° bevel seat; cover ' +
        fmtMm(a.cover.thicknessMm) + ' thick, ' + (a.screws.length ? a.screws.length + ' screws into the ring round the opening' : 'no screws')
      : (p.accessPanel ? 'left out (see the warning)' : 'off — the back is solid');
    $('overhang-out').textContent = 'no supports: vertical walls, 45° staircases (steps of ' + m.overhang.stairStepMm.toFixed(2) + ' mm or less)' +
      (ns.wells ? ', plus the flat round roofs of the ' + ns.wellDiameterMm + ' mm wells (short bridges)' : '');

    var warnEl = $('warnings');
    warnEl.hidden = !w.length;
    warnEl.textContent = w.join(' ');
    $('cover-dl-row').hidden = !result.cover;
    $('cover-cut-row').hidden = !result.cover;

    var base = 'body-' + (p.style === 'custom' ? 'custom' : p.style) + '-' + (m.lengthMm / IN).toFixed(2) + 'in' +
      (p.leftHanded && m.shape === 'tstyle' ? '-lefty' : '');
    result.names = {
      body: base + '.stl', cover: base + '-cover.stl', topSvg: base + '-top-panel.svg', topDxf: base + '-top-panel.dxf',
      coverSvg: base + '-cover.svg', coverDxf: base + '-cover.dxf'
    };
    $('filename').textContent = result.names.body + (result.cover ? ' · ' + result.names.cover : '');
    $('status').textContent = 'Built in ' + (Date.now() - t0) + ' ms — ' +
      (m.triangles.body + m.triangles.cover).toLocaleString() + ' triangles, watertight.';
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
  function coverCut() {
    var a = result.meta.access;
    var holes = a.screws.map(function (s) {
      var pts = [], r = a.screwClearMm / 2;
      for (var i = 0; i < 24; i++) pts.push([s.x + r * Math.cos(Math.PI * i / 12), s.y + r * Math.sin(Math.PI * i / 12)]);
      return pts;
    });
    return a.cover.outline.concat(holes);
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
  CHECK_FIELDS.forEach(function (k) { $(k).addEventListener('change', schedule); });
  $('bedIn').addEventListener('input', schedule);

  // the body STL is already in print orientation (back face on z = 0)
  $('dl-body').addEventListener('click', function () { if (result) download(STLExport.trianglesToSTL(result.body), result.names.body); });
  // the cover prints outer face down; it is modelled that way
  $('dl-cover').addEventListener('click', function () { if (result && result.cover) download(STLExport.trianglesToSTL(result.cover), result.names.cover); });
  $('dl-top-svg').addEventListener('click', function () { if (result) download(B.panelSVG(result.meta.topPanel.outline, 'Top panel'), result.names.topSvg, 'image/svg+xml'); });
  $('dl-top-dxf').addEventListener('click', function () { if (result) download(B.panelDXF(result.meta.topPanel.outline), result.names.topDxf, 'application/dxf'); });
  $('dl-cover-svg').addEventListener('click', function () { if (result && result.cover) download(B.panelSVG(coverCut(), 'Cover plate (outer face)'), result.names.coverSvg, 'image/svg+xml'); });
  $('dl-cover-dxf').addEventListener('click', function () { if (result && result.cover) download(B.panelDXF(coverCut()), result.names.coverDxf, 'application/dxf'); });

  Array.prototype.forEach.call(document.querySelectorAll('.view-row button'), function (btn) {
    btn.addEventListener('click', function () {
      if (!result || !preview) return;
      var m = result.meta;
      if (btn.dataset.view) { viewMode = btn.dataset.view; render(true); return; }
      var cam = btn.dataset.cam;
      if (cam === 'top') preview.setView({ az: 0, el: 1.5, zoom: 0.75, center: [0, m.lengthMm / 2, m.depthMm / 2] });
      if (cam === 'back') preview.setView({ az: 0, el: -1.5, zoom: 0.75, center: [0, m.lengthMm / 2, m.depthMm / 2] });
      if (cam === 'pocket') preview.setView({ az: -2.6, el: 0.6, zoom: 2.2, center: [0, m.L - m.pocket.lengthMm / 2, m.depthMm * 0.55] });
    });
  });

  // ---- start
  applyStyle(styleEl.value, true);
  preview = window.Preview3D.create($('preview'), $('preview-fallback'));
  rebuild();
  render(false);
})();
