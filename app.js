/*
 * app.js — UI wiring, 3D preview, STL download.
 * Geometry lives in geometry.js, STL encoding in stl.js.
 * The preview is a small hand-rolled canvas renderer: no libraries,
 * no CDN, works offline straight from file://.
 */
(function () {
  'use strict';

  var IN = 25.4;
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    strings: $('strings'), frets: $('frets'), fretsValue: $('frets-value'),
    scalePreset: $('scale-preset'), scale: $('scale'),
    nutWidth: $('nut-width'), heelWidth: $('heel-width'),
    split: $('split'), fret17: $('fret-17'),
    thickness: $('thickness'), fretHeight: $('fret-height'), tail: $('tail'),
    nutScrew: $('nut-screw'), tailScrew: $('tail-screw'), roundTail: $('round-tail'),
    leftHanded: $('left-handed'),
    downloads: $('downloads'), filename: $('filename'),
    sizeOut: $('size-out'), holesOut: $('holes-out'), slotsOut: $('slots-out'),
    warnings: $('warnings'),
    fretRows: $('fret-rows'), preview: $('preview'), previewFallback: $('preview-fallback')
  };

  // Sensible nut widths per string count (inches); heel = nut + 3/8".
  var NUT_DEFAULTS = { 2: 1.5, 3: 1.5, 4: 1.5, 5: 1.625, 6: 1.75 };

  var current = null; // { triangles, meta, filename }
  var preview = null;

  function num(el, fallback) {
    var v = parseFloat(el.value);
    return isFinite(v) ? v : fallback;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function readParams() {
    return {
      scaleMm: clamp(num(els.scale, 23.5), 18, 30) * IN,
      strings: parseInt(els.strings.value, 10),
      frets: parseInt(els.frets.value, 10),
      nutWidthMm: clamp(num(els.nutWidth, 1.5), 1, 2.5) * IN,
      heelWidthMm: clamp(num(els.heelWidth, 1.5), 1.1, 3) * IN,
      thicknessMm: clamp(num(els.thickness, 0.2), 0.14, 0.31) * IN,
      fretHeightMm: clamp(num(els.fretHeight, 0.035), 0.02, 0.06) * IN,
      tailMm: clamp(num(els.tail, 0.75), 0.4, 2.36) * IN,
      nutScrew: els.nutScrew.checked,
      tailScrew: els.tailScrew.checked,
      tailCornerRadiusMm: els.roundTail.checked ? 6.35 : 0,
      leftHanded: els.leftHanded.checked,
      splitAfterFret: parseInt(els.split.value, 10) || 0,
      skipMarkers: els.fret17.checked ? [] : [17]
    };
  }

  function fmtIn(mm) { return (mm / IN).toFixed(2) + '″'; }

  function downloadSTL(triangles, filename) {
    var blob = STLExport.trianglesToSTL(triangles);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function rebuild() {
    var params = readParams();
    var result = Fretboard.buildFretboard(params, earcut);
    var meta = result.meta;
    var scaleIn = (params.scaleMm / IN).toFixed(2).replace(/\.?0+$/, '');
    var base = 'fretboard_' + params.strings + 'string_' + params.frets +
      'fret_' + scaleIn + 'in';
    var multi = result.pieces.length > 1;
    current = { triangles: result.triangles, meta: meta, filename: base + '.stl' };

    els.fretsValue.textContent = params.frets;

    // one download button per printable piece
    els.downloads.innerHTML = '';
    var names = [];
    result.pieces.forEach(function (piece, i) {
      var fname = base + (multi ? '_part' + (i + 1) : '') + '.stl';
      names.push(fname);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = multi
        ? '⬇ Part ' + (i + 1) + ' — ' + (i === 0 ? 'nut end' : 'tail end') +
          ' (' + fmtIn(piece.lengthMm) + ')'
        : '⬇ Download STL';
      btn.addEventListener('click', function () { downloadSTL(piece.triangles, fname); });
      els.downloads.appendChild(btn);
    });
    els.filename.textContent = names.join('  +  ');

    els.sizeOut.textContent =
      fmtIn(meta.lengthMm) + ' long × ' + fmtIn(meta.nutWidthMm) + ' → ' +
      fmtIn(meta.tailWidthMm) + ' wide' +
      (multi
        ? ' · Part 1: ' + fmtIn(result.pieces[0].lengthMm) + ' · Part 2: ' +
          fmtIn(result.pieces[1].lengthMm) + ' — check they fit your print bed'
        : '');
    els.holesOut.textContent = meta.holes.length + ' — ' +
      meta.holes.map(function (h) { return h.label; }).join(', ');
    els.slotsOut.textContent = 'sized per string' +
      (meta.tuningLabel ? ' for ' + meta.tuningLabel : '') + ': ' +
      meta.stringGaugesIn.map(function (g) { return g.toFixed(3).replace('0.', '.') + '″'; }).join(' · ') +
      (params.leftHanded ? ' — left-handed layout' : '');

    if (meta.warnings.length) {
      els.warnings.textContent = '⚠ ' + meta.warnings.join(' ');
      els.warnings.hidden = false;
    } else {
      els.warnings.hidden = true;
    }

    var rows = '';
    for (var n = 1; n < meta.fretDistancesMm.length; n++) {
      var d = meta.fretDistancesMm[n];
      rows += '<tr><td>' + n + '</td><td>' + (d / IN).toFixed(3) + '</td><td>' +
        d.toFixed(1) + '</td></tr>';
    }
    els.fretRows.innerHTML = rows;

    if (preview) preview.setTriangles(result.triangles);
  }

  // ------------------------------------------------------------------
  // 3D preview — dependency-free canvas renderer.
  // Drag to orbit, scroll to zoom, double-click to reset the view.
  // ------------------------------------------------------------------
  function createPreview(container, fallbackEl) {
    var canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.cursor = 'grab';
    canvas.title = 'Drag to spin · scroll to zoom · double-click to reset';
    container.appendChild(canvas);
    var ctx = null;
    try { ctx = canvas.getContext && canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) {
      fallbackEl.hidden = false;
      container.style.display = 'none';
      return null;
    }

    var tris = null;
    var center = [0, 0, 0], radius = 1;
    var az = -0.6, el = 0.62, zoom = 1;

    function resize() {
      var w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      draw();
    }

    function setTriangles(t) {
      tris = t;
      var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (var i = 0; i < t.length; i += 3) {
        for (var k = 0; k < 3; k++) {
          if (t[i + k] < min[k]) min[k] = t[i + k];
          if (t[i + k] > max[k]) max[k] = t[i + k];
        }
      }
      center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      radius = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
      draw();
    }

    function draw() {
      var W = canvas.width, H = canvas.height;
      if (!W || !H) return;
      ctx.clearRect(0, 0, W, H);
      if (!tris) return;

      var cosA = Math.cos(az), sinA = Math.sin(az);
      var cosE = Math.cos(el), sinE = Math.sin(el);
      var scale = (Math.max(W, H) * 0.46 / radius) * zoom;
      // Light direction in view space: from the upper left, on the
      // viewer's side of the board. View axes: x = right, y = away
      // from the viewer, z = up.
      var lx = -0.45, ly = -0.35, lz = 0.82;
      var ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
      lx /= ll; ly /= ll; lz /= ll;

      var faces = [];
      var i, j;
      for (i = 0; i < tris.length; i += 9) {
        var X = [], Y = [], Z = [];
        for (j = 0; j < 3; j++) {
          var x = tris[i + j * 3] - center[0];
          var y = tris[i + j * 3 + 1] - center[1];
          var z = tris[i + j * 3 + 2] - center[2];
          // spin in the board's plane, then tilt the top toward the viewer
          var rx = x * cosA - y * sinA;
          var ry = x * sinA + y * cosA;
          X.push(rx);                        // view x (screen right)
          Y.push(ry * cosE - z * sinE);      // view y (away from viewer)
          Z.push(ry * sinE + z * cosE);      // view z (screen up)
        }
        // Face normal in view space (rotations preserve winding).
        var ux = X[1] - X[0], uy = Y[1] - Y[0], uz = Z[1] - Z[0];
        var wx = X[2] - X[0], wy = Y[2] - Y[0], wz = Z[2] - Z[0];
        var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nl === 0 || ny >= 0) continue; // backface (viewer sits at -y)
        nx /= nl; ny /= nl; nz /= nl;
        var shade = 0.42 + 0.58 * Math.max(0, nx * lx + ny * ly + nz * lz);
        var px = [], py = [], depth = 0;
        for (j = 0; j < 3; j++) {
          px.push(W / 2 + X[j] * scale);
          py.push(H / 2 - Z[j] * scale);
          depth += -Y[j]; // toward the viewer
        }
        faces.push({ px: px, py: py, depth: depth / 3, shade: shade });
      }
      faces.sort(function (a, b) { return a.depth - b.depth; }); // far first

      for (i = 0; i < faces.length; i++) {
        var f = faces[i], s = f.shade;
        ctx.beginPath();
        ctx.moveTo(f.px[0], f.py[0]);
        ctx.lineTo(f.px[1], f.py[1]);
        ctx.lineTo(f.px[2], f.py[2]);
        ctx.closePath();
        ctx.fillStyle = 'rgb(' + Math.round(208 * s) + ',' + Math.round(170 * s) + ',' + Math.round(112 * s) + ')';
        ctx.fill();
        // stroke with the fill color: seals hairline seams between faces
        // without drawing the triangulation as a dark web
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    var dragging = false, lastX = 0, lastY = 0;
    canvas.addEventListener('pointerdown', function (e) {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      az += (e.clientX - lastX) * 0.008;
      el = clamp(el + (e.clientY - lastY) * 0.008, 0.08, 1.35);
      lastX = e.clientX; lastY = e.clientY;
      draw();
    });
    function endDrag() { dragging = false; canvas.style.cursor = 'grab'; }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoom = clamp(zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.5, 8);
      draw();
    }, { passive: false });
    canvas.addEventListener('dblclick', function () {
      az = -0.6; el = 0.62; zoom = 1;
      draw();
    });
    window.addEventListener('resize', resize);

    resize();
    return { setTriangles: setTriangles, draw: draw, canvas: canvas };
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  els.strings.addEventListener('change', function () {
    var nut = NUT_DEFAULTS[els.strings.value] || 1.5;
    els.nutWidth.value = nut;
    els.heelWidth.value = nut + 0.375;
    rebuild();
  });
  els.scalePreset.addEventListener('change', function () {
    if (els.scalePreset.value !== 'custom') {
      els.scale.value = els.scalePreset.value;
      rebuild();
    } else {
      els.scale.focus();
    }
  });
  els.scale.addEventListener('input', function () {
    els.scalePreset.value = 'custom';
    rebuild();
  });
  ['frets', 'nut-width', 'heel-width', 'thickness', 'fret-height', 'tail'].forEach(function (id) {
    $(id).addEventListener('input', rebuild);
  });
  els.nutScrew.addEventListener('change', rebuild);
  els.tailScrew.addEventListener('change', rebuild);
  els.roundTail.addEventListener('change', rebuild);
  els.leftHanded.addEventListener('change', rebuild);
  els.split.addEventListener('change', rebuild);
  els.fret17.addEventListener('change', rebuild);

  preview = createPreview(els.preview, els.previewFallback);
  rebuild();
})();
