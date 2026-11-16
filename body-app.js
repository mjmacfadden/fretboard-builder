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
  var SBL = window.SoundBoard;
  var $ = function (id) { return document.getElementById(id); };

  // Controls whose id is the parameter name.
  var NUM_FIELDS = ['lengthIn', 'lowerWidthIn', 'waistWidthIn', 'upperWidthIn', 'widthIn', 'cornerRadiusIn',
    'depthIn', 'lowerPos', 'waistPos', 'upperPos', 'wallMm', 'floorMm', 'panelThicknessMm', 'shelfAllowanceMm',
    'shelfWidthMm', 'shelfLipMm', 'topFitMm', 'pocketLengthIn', 'pocketWidthIn', 'pocketDepthIn', 'pocketFitMm',
    'pocketCornerMm', 'neckScrewSpanXIn', 'neckScrewSpanYIn', 'neckScrewHoleMm',
    'plateThicknessMm', 'screwBiteMm', 'wellDiameterMm', 'wellFloorMm', 'accessLengthMm', 'accessWidthMm',
    'accessCornerMm', 'accessPos', 'coverThicknessMm', 'coverFitMm', 'accessRingMm', 'accessRingHeightMm',
    'coverScrews', 'coverScrewHoleMm', 'coverScrewClearMm', 'bedMarginMm', 'braceCount', 'braceWidthMm', 'braceHeightMm',
    'braceEndHeightMm', 'topScrewCount', 'tabBossMm', 'tabDepthMm'];
  var SELECT_FIELDS = ['neckScrewMode', 'topScrewSize', 'topScrewHead', 'bracePositions'];
  var CHECK_FIELDS = ['accessPanel', 'fitBed', 'leftHanded', 'neckBlockRibs', 'ladderBraces', 'screwTop'];

  var styleEl = $('style');
  var shape = 'bouts';      // the current outline family (kept when you go Custom)
  var result = null, preview = null, viewMode = 'body', timer = null, tab = 'body';
  var SB_NUM = ['holeSizeMm', 'holeXMm', 'holeYPct', 'holeCount', 'holeSpacingMm', 'holeAngleDeg', 'kerfMm', 'pressFitMm',
    'pickupCount', 'pickupYPct', 'pickupXMm', 'pickupSpacingMm', 'pickupAngleDeg', 'pickupLengthMm', 'pickupWidthMm', 'pickupCornerMm'];
  var SB_SEL = ['soundHole', 'fVariant', 'pickup'];

  function readSB() {
    var o = {};
    SB_NUM.forEach(function (k) { var v = parseFloat($(k).value); o[k] = isFinite(v) ? v : null; });
    ['holeSizeMm', 'holeYPct', 'holeCount', 'holeSpacingMm', 'pickupYPct', 'pickupXMm', 'pickupSpacingMm', 'pickupAngleDeg'].forEach(function (k) { if (o[k] === null) o[k] = 0; });
    ['pickupCount', 'pickupLengthMm', 'pickupWidthMm', 'pickupCornerMm'].forEach(function (k) { if (o[k] === null) o[k] = SBL.DEFAULTS[k]; });
    o.pickupScrews = $('pickupScrews').checked;
    if (o.kerfMm === null) o.kerfMm = SBL.DEFAULTS.kerfMm;
    if (o.pressFitMm === null) o.pressFitMm = SBL.DEFAULTS.pressFitMm;
    SB_SEL.forEach(function (k) { o[k] = $(k).value; });
    o.calibration = $('sbCalibration').checked;
    o.plateMarks = $('plateMarks').checked && !$('plate-row').hidden;
    return o;
  }

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
    $('plate-row').hidden = shape !== 'box';
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
      if (!result.topTris) result.topTris = B.panelMesh(result.sb ? result.sb.finished : m.topPanel.outline, m.topPanel.z0, m.topPanel.z1);
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
    $('pocket-out').textContent = (pk.lengthMm / IN).toFixed(2) + '″ long × ' + (pk.widthMm / IN).toFixed(3) + '″ wide, ' + (pk.cornerRadiusMm === 0 ? 'square corners' : (Math.abs(pk.cornerRadiusMm - 6.35) < 1e-6 ? '¼″ (6.35 mm)' : pk.cornerRadiusMm.toFixed(2) + ' mm') + ' radius corners') + ', floor ' +
      (pk.depthMm / IN).toFixed(2) + '″ below the top surface (never scaled)';
    var nb = m.neckBlock;
    $('block-out').textContent = 'integral, solid: the pocket plus ' + fmtMm(nb.wallAroundPocketMm) + ' all round, from the back floor up to the shelf' + (nb.filledSides.length ? ', filled out to the rim on the ' + nb.filledSides.join(' and ') + ' side' : '') +
      (nb.neckBrace ? '; one brace across the body at mid-pocket (ladder-brace arc, ' + nb.neckBrace.heightAtShellMm.map(function (h) { return h.toFixed(1); }).join(' / ') + ' mm high at the block)' : '') +
      '; ' + (nb.footprintMm[0] / IN).toFixed(2) + '″ × ' + (nb.footprintMm[1] / IN).toFixed(2) + '″; body ' + m.volume.totalCm3.toFixed(0) + ' cm³ (block ' + m.volume.neckBlockCm3.toFixed(0) + ' cm³). In the slicer: 4+ walls and 30–40% gyroid in the block area.';
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
    var bm = m.braces;
    $('braces-out').textContent = bm
      ? bm.count + ' across the back floor at ' + bm.positionsPct.map(function (v) { return v.toFixed(0) + '%'; }).join(', ') + ' of the length; ' +
        fmtMm(bm.widthMm) + ' wide, ' + fmtMm(bm.heightMm) + ' tall at the centre falling to ' + fmtMm(bm.endHeightMm) + ' at the ends (parabolic, rounded top)' +
        (bm.segments.some(function (g) { return g.ends.indexOf('stops short') >= 0; }) ? '; split round the access ring / neck block' : '')
      : (p.ladderBraces ? 'left out (see the warning)' : 'off');
    var stp = m.screwTop;
    $('screw-size-row').hidden = !p.screwTop;
    $('topscrews-out').textContent = stp
      ? stp.count + ' × ' + stp.size + ' × ' + stp.lengthIn + '″ ' + stp.head + ' head wood / plastic screws into ' + stp.bossMm.toFixed(1) + ' mm tabs under the shelf; ' +
        stp.pilotMm + ' mm pilot, ' + stp.holeDepthMm.toFixed(0) + ' mm deep; top panel ' + stp.clearanceMm + ' mm clearance holes, ' + stp.headMm + ' mm head ' + (stp.head === 'flat' ? 'countersink' : 'circle') + ' marked'
      : (p.screwTop ? 'left out (see the warning)' : 'off — the top is glued');
    var ft = m.fit;
    $('fit-out').textContent = 'inside ' + ft.innerWidthMm.toFixed(1) + ' mm wide; neck block ' + ft.blockWidthMm.toFixed(1) + ' mm' +
      (ft.blockSideClearMm !== null ? ', ' + ft.blockSideClearMm.toFixed(1) + ' mm clear to the rim each side' : '') +
      (ft.access ? '; access ring ' + ft.access.ringWidthMm.toFixed(0) + ' mm, ' + ft.access.sideClearMm.toFixed(1) + ' mm clear each side' : '') +
      (ft.bracesDropped.length ? '; ' + ft.bracesDropped.length + ' brace(s) left out — see the warning' : '; everything fits');
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
    result.names.topPdf = base + '-top-panel.pdf';
    result.names.topSvg = base + '-soundboard.svg'; result.names.topDxf = base + '-soundboard.dxf'; result.names.topPdf = base + '-soundboard.pdf';
    soundboard();
    $('filename').textContent = result.names.body + (result.cover ? ' · ' + result.names.cover : '');
    $('status').textContent = 'Built in ' + (Date.now() - t0) + ' ms — ' +
      (m.triangles.body + m.triangles.cover).toLocaleString() + ' triangles, watertight.';
    render(true);
  }

  // ---- soundboard (2D, cheap: rebuilt on its own when only its fields change)
  function sbTitle() { var st = B.STYLES[result.meta.style]; return 'Soundboard, ' + (st ? st.label : 'custom') + ' body'; }
  function soundboard() {
    if (!result) return;
    var o = readSB(), sh = o.soundHole;
    $('fvariant-row').hidden = sh !== 'f-single' && sh !== 'f-double';
    $('hole-rows').hidden = sh === 'none';
    $('count-row').hidden = ['ports', 'starburst', 'rosette', 'slash'].indexOf(sh) < 0;
    $('spacing-row').hidden = ['f-double', 'ports', 'slash'].indexOf(sh) < 0;
    $('pickup-rows').hidden = o.pickup === 'none';
    $('pickup-custom').hidden = o.pickup !== 'custom';
    var sb;
    try { sb = SBL.build(result.meta, o); } catch (e) { $('sb-warnings').hidden = false; $('sb-warnings').textContent = 'Could not draw the soundboard: ' + e.message; return; }
    result.sb = sb; result.topTris = null;
    $('sb-svg').innerHTML = SBL.svg(sb, sbTitle()).replace(/^<\?xml[^>]*>\s*/, '');
    $('sb-size-out').textContent = sb.sizeMm[1].toFixed(1) + ' × ' + sb.sizeMm[0].toFixed(1) + ' mm finished (' + (sb.sizeMm[1] / IN).toFixed(2) + '″ × ' + (sb.sizeMm[0] / IN).toFixed(2) +
      '″), ⅛″ ply; files at 1:1 in millimetres (SVG width/height in mm, viewBox in mm)' + (sb.screws ? '; ' + sb.screws.count + ' × ' + sb.screws.size + ' screw holes (' + sb.screws.clearanceMm + ' mm, head ' + sb.screws.headMm + ' mm engraved)' : '') +
      (sb.plate ? '; plate bolt slots engraved at 7″ × 4¾″ (½″ × 0.28″ slots)' : '');
    $('sb-kerf-out').textContent = 'kerf ' + sb.kerfMm.toFixed(2) + ' mm, press fit ' + (sb.pressFitMm >= 0 ? '+' : '') + sb.pressFitMm.toFixed(2) + ' mm per side: the outer cut runs ' +
      (sb.kerfMm / 2 + sb.pressFitMm).toFixed(3) + ' mm outside the rim line (kerf/2 + press fit; the neck notch kerf/2 only); inner cuts ' + (sb.kerfMm / 2).toFixed(3) + ' mm inside (kerf/2). Cut path ' +
      sb.cutSizeMm[1].toFixed(2) + ' × ' + sb.cutSizeMm[0].toFixed(2) + ' mm.';
    var h = sb.hole;
    $('sb-hole-out').textContent = h.style === 'none' ? 'none' : (h.style + (h.variant ? ' (' + h.variant + ')' : '') + ', ' + h.sizeMm.toFixed(0) + ' mm, centre ' + h.x.toFixed(0) + ' mm across, ' +
      h.yPct.toFixed(0) + '% along' + (h.count ? ', ' + h.count + ' parts' : '') + (h.spacingMm ? ', spacing ' + h.spacingMm.toFixed(0) + ' mm' : '') + (h.angleDeg ? ', ' + h.angleDeg.toFixed(0) + '°' : '') + '; open area ' + (sb.holeAreaMm2 / 100).toFixed(1) + ' cm²');
    $('sb-check-out').textContent = sb.checks.length ? sb.checks.map(function (c) { return c.what + ' ' + c.mm.toFixed(1) + ' mm (min ' + c.need.toFixed(0) + ')'; }).join('; ') +
      '. Thin-wood threshold ' + sb.minBridgeMm + ' mm; holes stay ' + sb.glueMarginMm + ' mm off the glue shelf and the neck block.' : '—';
    var pk = sb.pickups;
    $('sb-pickup-out').textContent = !pk ? 'none' : (pk.count + ' × ' + pk.label.toLowerCase() + ', cutout ' + pk.lengthMm.toFixed(1) + ' × ' + pk.widthMm.toFixed(1) + ' mm, ' + pk.cornerMm.toFixed(1) +
      ' mm corners, centred ' + pk.yPct.toFixed(0) + '% along' + (pk.count > 1 ? ', ' + pk.spacingMm.toFixed(0) + ' mm apart' : '') + (pk.screws ? '; ' + pk.screws.count + ' screw holes ' + pk.screws.holeMm + ' mm, ' + pk.screws.spanMm.toFixed(1) + ' mm apart' : '') +
      '; cavity ' + pk.depthFromSurfaceMm.toFixed(1) + ' mm from the top surface to the back floor (' + pk.depthUnderTopMm.toFixed(1) + ' mm under the top)' +
      (pk.overBraces.length ? ', ' + pk.overBraces.map(function (b) { return b.fromSurfaceMm.toFixed(1) + ' mm over the brace at ' + b.yPct.toFixed(0) + '%'; }).join(', ') : '') + '; needs about ' + pk.needsDepthMm + ' mm');
    $('sb-warnings').hidden = !sb.warnings.length;
    $('sb-warnings').textContent = sb.warnings.join(' ');
    if (viewMode !== 'body') render(true);
  }
  function setTab(t) {
    tab = t;
    $('tab-body').classList.toggle('active', t === 'body');
    $('tab-sb').classList.toggle('active', t === 'sb');
    $('body-view').hidden = t !== 'body';
    $('sb-view').hidden = t !== 'sb';
    if (t === 'body') render(true);
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
  $('dl-top-svg').addEventListener('click', function () { if (result && result.sb) download(SBL.svg(result.sb, sbTitle()), result.names.topSvg, 'image/svg+xml'); });
  $('dl-top-dxf').addEventListener('click', function () { if (result && result.sb) download(SBL.dxf(result.sb, sbTitle()), result.names.topDxf, 'application/dxf'); });
  $('dl-top-pdf').addEventListener('click', function () { if (result && result.sb) download(SBL.pdf(result.sb, sbTitle()), result.names.topPdf, 'application/pdf'); });
  SB_NUM.forEach(function (k) { $(k).addEventListener('input', soundboard); });
  SB_SEL.forEach(function (k) { $(k).addEventListener('change', soundboard); });
  $('sbCalibration').addEventListener('change', soundboard);
  $('plateMarks').addEventListener('change', soundboard);
  $('pickupScrews').addEventListener('change', soundboard);
  $('tab-body').addEventListener('click', function () { setTab('body'); });
  $('tab-sb').addEventListener('click', function () { setTab('sb'); });
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
