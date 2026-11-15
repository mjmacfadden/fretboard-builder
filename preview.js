/*
 * preview.js — the fretboard builder's dependency-free canvas 3D
 * preview, packaged for reuse (used by the body builder page).
 * Same controls: drag to orbit (all the way under), right-drag or
 * shift-drag to pan, scroll to zoom (0.5x to 64x, toward the cursor),
 * double-click to reset the view.
 *
 * Drawn with WebGL and a depth buffer when the browser has it (exact
 * hidden-surface removal: thin walls and long rim faces never show
 * through each other); otherwise a canvas-2D painter's sort, which can
 * mis-order long thin faces and leave ragged edges or see-through slivers.
 *
 * Browser: window.Preview3D.create(container, fallbackEl) ->
 *   { setScene(layers, keepView), draw(), canvas }
 * where layers = [{ tris: Float32Array (9 per triangle, mm), color: [r, g, b] }].
 */
(function (global) {
  'use strict';

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function create(container, fallbackEl) {
    var canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.cursor = 'grab';
    canvas.title = 'Drag to spin · right-drag to pan · scroll to zoom · double-click to reset';
    container.appendChild(canvas);
    var ctx = null, gl = null;
    var prog = null, glBufs = [], U = {};   // WebGL program, per-layer buffers, locations
    try {
      gl = canvas.getContext && (canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true }) ||
        canvas.getContext('experimental-webgl', { antialias: true, preserveDrawingBuffer: true }));
    } catch (e) { gl = null; }
    if (gl && !initGL()) gl = null;
    if (!gl) {
      try { ctx = canvas.getContext && canvas.getContext('2d'); } catch (e) { ctx = null; }
    }
    if (!gl && !ctx) {
      fallbackEl.hidden = false;
      container.style.display = 'none';
      return null;
    }

    var tris = null; // scene layers [{ tris, color }]
    var sceneSet = false, home = [0, 0, 0];
    var groupNormals = {}; // per-group smoothed vertex normals
    var center = [0, 0, 0], radius = 1;
    var MIN_ZOOM = 0.5, MAX_ZOOM = 64;
    var az = -0.6, el = 0.62, zoom = 1;
    var panX = 0, panY = 0; // screen-space pan offset, canvas pixels

    // Smooth (per-vertex) normals for shading: at each vertex, average
    // the normals of the faces meeting there that point within ~30
    // degrees of each other. Curved surfaces (fret crowns, countersink
    // cones, nut round-overs, the radius) shade smoothly, while sharp
    // edges (board edges, slot walls) stay crisp.
    function computeNormals(t) {
      var fn = new Float32Array(t.length);
      var i, j;
      for (i = 0; i < t.length; i += 9) {
        var ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
        var wx = t[i + 6] - t[i], wy = t[i + 7] - t[i + 1], wz = t[i + 8] - t[i + 2];
        var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        for (j = 0; j < 3; j++) {
          fn[i + j * 3] = nx / nl; fn[i + j * 3 + 1] = ny / nl; fn[i + j * 3 + 2] = nz / nl;
        }
      }
      var byVertex = new Map();
      for (i = 0; i < t.length; i += 3) {
        var key = t[i].toFixed(3) + ',' + t[i + 1].toFixed(3) + ',' + t[i + 2].toFixed(3);
        if (!byVertex.has(key)) byVertex.set(key, []);
        byVertex.get(key).push(i);
      }
      var out = new Float32Array(t.length);
      byVertex.forEach(function (slots) {
        slots.forEach(function (s) {
          var fx = fn[s], fy = fn[s + 1], fz = fn[s + 2];
          var sx = 0, sy = 0, sz = 0;
          slots.forEach(function (o) {
            if (fn[o] * fx + fn[o + 1] * fy + fn[o + 2] * fz > 0.86) {
              sx += fn[o]; sy += fn[o + 1]; sz += fn[o + 2];
            }
          });
          var l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
          out[s] = sx / l; out[s + 1] = sy / l; out[s + 2] = sz / l;
        });
      });
      return out;
    }

    function resize() {
      var w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      draw();
    }

    // layers: [{ tris: Float32Array, color: [r, g, b] }, ...]. All layers
    // are depth-sorted together (the body's rim, panels and pocket
    // interleave in depth, so per-layer painting would be wrong here).
    function setScene(layers, keepView) {
      tris = layers;
      groupNormals = layers.map(function (l) { return computeNormals(l.tris); });
      if (gl) uploadGL();
      var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      layers.forEach(function (l) {
        var all = l.tris;
        for (var i = 0; i < all.length; i += 3) {
          for (var k = 0; k < 3; k++) {
            if (all[i + k] < min[k]) min[k] = all[i + k];
            if (all[i + k] > max[k]) max[k] = all[i + k];
          }
        }
      });
      if (!keepView || !sceneSet) {
        center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
        // bounding-sphere radius, so wide bodies fit the view as well as long boards
        var dx = max[0] - min[0], dy = max[1] - min[1], dz = max[2] - min[2];
        radius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2 || 1;
        home = center.slice();
      }
      sceneSet = true;
      draw();
    }

    function colorFor(s, c) {
      c = c || [208, 170, 112];
      return 'rgb(' + Math.round(c[0] * s) + ',' + Math.round(c[1] * s) + ',' + Math.round(c[2] * s) + ')';
    }

    // ---- WebGL path: same orthographic view, light and shading as the
    // canvas-2D path below, but with a depth buffer.
    function initGL() {
      var vs = [
        'attribute vec3 aPos; attribute vec3 aNrm;',
        'uniform vec3 uCenter; uniform vec4 uRot; uniform vec4 uView; uniform float uDepth; uniform float uH;',
        'uniform vec3 uLight; uniform vec3 uColor; varying vec3 vCol;',
        'void main() {',
        '  vec3 p = aPos - uCenter;',
        '  float rx = p.x * uRot.x - p.y * uRot.y, ry = p.x * uRot.y + p.y * uRot.x;',
        '  float vy = ry * uRot.z - p.z * uRot.w, vz = ry * uRot.w + p.z * uRot.z;',
        '  float nrx = aNrm.x * uRot.x - aNrm.y * uRot.y, nry = aNrm.x * uRot.y + aNrm.y * uRot.x;',
        '  vec3 n = vec3(nrx, nry * uRot.z - aNrm.z * uRot.w, nry * uRot.w + aNrm.z * uRot.z);',
        '  float sh = 0.42 + 0.58 * max(0.0, dot(n, uLight));',
        '  vCol = uColor * sh;',
        // uView = (scale, panX, panY, canvas width) in canvas pixels, uH = canvas
        // height; uDepth scales view y (away from the viewer) into clip z
        '  gl_Position = vec4((rx * uView.x + uView.y) * 2.0 / uView.w, (vz * uView.x - uView.z) * 2.0 / uH, vy * uDepth, 1.0);',
        '}'].join('\n');
      var fs = 'precision mediump float; varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }';
      function sh(type, src) {
        var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
        return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null;
      }
      var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
      if (!v || !f) return false;
      prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
      ['uCenter', 'uRot', 'uView', 'uDepth', 'uH', 'uLight', 'uColor'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
      U.aPos = gl.getAttribLocation(prog, 'aPos'); U.aNrm = gl.getAttribLocation(prog, 'aNrm');
      return true;
    }
    function uploadGL() {
      glBufs.forEach(function (b) { gl.deleteBuffer(b.pos); gl.deleteBuffer(b.nrm); });
      glBufs = tris.map(function (l, i) {
        if (!l.tris || !l.tris.length) return null;
        var pos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pos);
        gl.bufferData(gl.ARRAY_BUFFER, l.tris instanceof Float32Array ? l.tris : new Float32Array(l.tris), gl.STATIC_DRAW);
        var nrm = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
        gl.bufferData(gl.ARRAY_BUFFER, groupNormals[i], gl.STATIC_DRAW);
        return { pos: pos, nrm: nrm, n: l.tris.length / 3, color: l.color || [208, 170, 112] };
      }).filter(Boolean);
    }
    function drawGL(W, H, cosA, sinA, cosE, sinE, scale, lx, ly, lz) {
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!glBufs.length) return;
      gl.useProgram(prog);
      gl.uniform3f(U.uCenter, center[0], center[1], center[2]);
      gl.uniform4f(U.uRot, cosA, sinA, cosE, sinE);
      gl.uniform4f(U.uView, scale, panX, panY, W);
      gl.uniform1f(U.uH, H);
      // view y (away from the viewer) into clip z; everything lies well
      // within a few radii of the view centre
      var reach = 4 * radius + Math.abs(center[0] - home[0]) + Math.abs(center[1] - home[1]) + Math.abs(center[2] - home[2]);
      gl.uniform1f(U.uDepth, 1 / reach);
      gl.uniform3f(U.uLight, lx, ly, lz);
      glBufs.forEach(function (b) {
        gl.uniform3f(U.uColor, b.color[0] / 255, b.color[1] / 255, b.color[2] / 255);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.enableVertexAttribArray(U.aPos); gl.vertexAttribPointer(U.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.nrm); gl.enableVertexAttribArray(U.aNrm); gl.vertexAttribPointer(U.aNrm, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, b.n);
      });
    }

    function draw() {
      var W = canvas.width, H = canvas.height;
      if (!W || !H) return;
      if (gl) {
        if (!tris) { gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return; }
        var cA = Math.cos(az), sA = Math.sin(az), cE = Math.cos(el), sE = Math.sin(el);
        var sc = (Math.max(W, H) * 0.46 / radius) * zoom;
        var l0 = -0.45, l1 = -0.35, l2 = 0.82, ln = Math.sqrt(l0 * l0 + l1 * l1 + l2 * l2);
        drawGL(W, H, cA, sA, cE, sE, sc, l0 / ln, l1 / ln, l2 / ln);
        return;
      }
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

      // One painter's sort over every layer (back faces culled).
      var faces = [];
      for (var li = 0; li < tris.length; li++) {
        var t = tris[li].tris;
        var vn = groupNormals[li];
        var col = tris[li].color;
        if (!t) continue;

        var i, j;
        for (i = 0; i < t.length; i += 9) {
          var X = [], Y = [], Z = [];
          for (j = 0; j < 3; j++) {
            var x = t[i + j * 3] - center[0];
            var y = t[i + j * 3 + 1] - center[1];
            var z = t[i + j * 3 + 2] - center[2];
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
          var px = [], py = [], depth = 0, vsh = [];
          for (j = 0; j < 3; j++) {
            px.push(W / 2 + X[j] * scale + panX);
            py.push(H / 2 - Z[j] * scale + panY);
            depth += -Y[j]; // toward the viewer
            if (vn) {
              var mx = vn[i + j * 3], my = vn[i + j * 3 + 1], mz = vn[i + j * 3 + 2];
              var mrx = mx * cosA - my * sinA, mry = mx * sinA + my * cosA;
              var vnx = mrx, vny = mry * cosE - mz * sinE, vnz = mry * sinE + mz * cosE;
              vsh.push(0.42 + 0.58 * Math.max(0, vnx * lx + vny * ly + vnz * lz));
            }
          }
          // skip faces entirely off-canvas (matters when zoomed in close)
          if (Math.max(px[0], px[1], px[2]) < -2 || Math.min(px[0], px[1], px[2]) > W + 2 ||
              Math.max(py[0], py[1], py[2]) < -2 || Math.min(py[0], py[1], py[2]) > H + 2) continue;
          faces.push({ px: px, py: py, depth: depth / 3, shade: shade, vsh: vsh, col: col });
        }
      }
        faces.sort(function (a, b) { return a.depth - b.depth; }); // far first

        for (i = 0; i < faces.length; i++) {
          var f = faces[i], s = f.shade;
          ctx.beginPath();
          ctx.moveTo(f.px[0], f.py[0]);
          ctx.lineTo(f.px[1], f.py[1]);
          ctx.lineTo(f.px[2], f.py[2]);
          ctx.closePath();
          if (f.vsh.length === 3 && (f.vsh[0] !== f.vsh[1] || f.vsh[1] !== f.vsh[2])) {
            // Exact linear (Gouraud) interpolation of the vertex shades:
            // fit shade = a*x + b*y + c through the three vertices and
            // run the gradient along (a, b). Cheaper darkest-to-lightest
            // gradients flip direction per triangle and weave a diamond
            // pattern into long thin faces like the fret lofts.
            var det = (f.px[1] - f.px[0]) * (f.py[2] - f.py[0]) -
                      (f.px[2] - f.px[0]) * (f.py[1] - f.py[0]);
            var ga = det !== 0 ? ((f.vsh[1] - f.vsh[0]) * (f.py[2] - f.py[0]) -
                                  (f.vsh[2] - f.vsh[0]) * (f.py[1] - f.py[0])) / det : 0;
            var gb = det !== 0 ? ((f.px[1] - f.px[0]) * (f.vsh[2] - f.vsh[0]) -
                                  (f.px[2] - f.px[0]) * (f.vsh[1] - f.vsh[0])) / det : 0;
            var gl2 = ga * ga + gb * gb;
            if (gl2 > 1e-12) {
              var sMin = Math.min(f.vsh[0], f.vsh[1], f.vsh[2]);
              var sMax = Math.max(f.vsh[0], f.vsh[1], f.vsh[2]);
              var start = f.vsh.indexOf(sMin);
              var gLen = (sMax - sMin) / Math.sqrt(gl2); // distance along the (ga, gb) direction covering the full shade range
              var ux = ga / Math.sqrt(gl2), uy = gb / Math.sqrt(gl2);
              var grad = ctx.createLinearGradient(
                f.px[start], f.py[start],
                f.px[start] + ux * gLen, f.py[start] + uy * gLen);
              grad.addColorStop(0, colorFor(sMin, f.col));
              for (var q = 0; q < 3; q++) {
                if (q === start) continue;
                var frac = ((f.px[q] - f.px[start]) * ux + (f.py[q] - f.py[start]) * uy) / gLen;
                grad.addColorStop(Math.max(0, Math.min(1, frac)), colorFor(f.vsh[q], f.col));
              }
              grad.addColorStop(1, colorFor(sMax, f.col));
              ctx.fillStyle = grad;
            } else {
              ctx.fillStyle = colorFor(s, f.col);
            }
          } else {
            ctx.fillStyle = colorFor(s, f.col);
          }
          ctx.fill();
          // stroke with the flat fill color: seals hairline seams between
          // faces without drawing the triangulation as a dark web
          ctx.strokeStyle = colorFor(s, f.col);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
    }

    var dragMode = null, lastX = 0, lastY = 0; // 'orbit' | 'pan'
    canvas.addEventListener('pointerdown', function (e) {
      // right button (or shift+drag) pans; left button orbits
      dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
      lastX = e.clientX; lastY = e.clientY;
      canvas.style.cursor = dragMode === 'pan' ? 'move' : 'grabbing';
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragMode) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (dragMode === 'pan') {
        // pointer deltas are CSS pixels; pan offsets are canvas pixels
        var k = canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;
        panX += dx * k;
        panY += dy * k;
      } else {
        az += dx * 0.008;
        // nearly pole to pole (±86°), so the underside is fully reachable
        el = clamp(el + dy * 0.008, -1.5, 1.5);
      }
      draw();
    });
    function endDrag() { dragMode = null; canvas.style.cursor = 'grab'; }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      // Zoom toward the cursor: adjust the pan by the same factor so
      // the board point under the mouse stays under the mouse.
      var rect = canvas.getBoundingClientRect();
      var k = rect.width ? canvas.width / rect.width : 1;
      var mx = (e.clientX - rect.left) * k, my = (e.clientY - rect.top) * k;
      // Scale the step by the wheel delta so trackpads zoom smoothly and a
      // mouse notch is ~15%. Max 64x shows ~8 mm across the view, close
      // enough to inspect the edge round-over and fret ends. The view is
      // orthographic, so there is no near plane to clip through.
      var dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      var step = clamp(Math.pow(1.0015, -dy), 0.8, 1.25);
      var newZoom = clamp(zoom * step, MIN_ZOOM, MAX_ZOOM);
      var r = newZoom / zoom;
      if (r !== 1) {
        panX = mx - canvas.width / 2 - (mx - canvas.width / 2 - panX) * r;
        panY = my - canvas.height / 2 + (canvas.height / 2 + panY - my) * r;
        zoom = newZoom;
      }
      draw();
    }, { passive: false });
    canvas.addEventListener('dblclick', function () {
      az = -0.6; el = 0.62; zoom = 1; panX = 0; panY = 0;
      center = home.slice();
      draw();
    });
    window.addEventListener('resize', resize);

    resize();
    // Jump to a view: { az, el, zoom, center: [x, y, z] } (any subset).
    function setView(o) {
      if (o.az !== undefined) az = o.az;
      if (o.el !== undefined) el = clamp(o.el, -1.5, 1.5);
      if (o.zoom !== undefined) zoom = clamp(o.zoom, MIN_ZOOM, MAX_ZOOM);
      if (o.center) center = o.center.slice();
      panX = 0; panY = 0;
      draw();
    }

    return { setScene: setScene, setView: setView, draw: draw, canvas: canvas };
  }

  global.Preview3D = { create: create };
})(typeof window !== 'undefined' ? window : this);
