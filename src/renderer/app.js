'use strict';

(() => {
  const api = window.gluttony || null; // null when opened in a plain browser for previewing
  const glCanvas = document.getElementById('hole');
  const fx = document.getElementById('fx');
  const ctx = fx.getContext('2d');
  const toastEl = document.getElementById('toast');
  if (!api) { // browser preview: fake desktop + fixed widget size
    document.documentElement.style.background = new URLSearchParams(location.search).get('bg') === 'dark' ? '#05060c' : 'linear-gradient(135deg,#d9dee8,#7d8aa3)';
    const px = (params0 => params0.get('px') || '300')(new URLSearchParams(location.search));
    Object.assign(document.body.style, { width: px + 'px', height: px + 'px', position: 'relative', margin: '30px' });
  }

  const STYLES = {
    tilted:  { incl: 0.09, roll: 1.83, faceTint: 0.8, frontDim: 0.12, warm: 0.0 },
    classic: { incl: 0.14, roll: 0.06, faceTint: 0.0,  frontDim: 1.0, warm: 1.0 },
    edge:    { incl: 0.035, roll: -0.18, faceTint: 0.25, frontDim: 0.7, warm: 0.35 },
  };
  const params = new URLSearchParams(location.search);
  const cfg = { style: params.get('style') || 'tilted', sound: true, quality: 'high' };
  const look = { ...STYLES[cfg.style] };

  // ---------------- WebGL ----------------
  const gl = glCanvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: !api && params.has('icon') });
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, window.HOLE_VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, window.HOLE_FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const n of ['uRes', 'uTime', 'uHunger', 'uGulp', 'uIncl', 'uRoll', 'uFaceTint', 'uFrontDim', 'uWarm', 'uSteps']) {
    U[n] = gl.getUniformLocation(prog, n);
  }

  let W = 0; let H = 0; let dpr = 1;
  function resize() {
    const maxDpr = cfg.quality === 'low' ? 1 : 2;
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    W = document.body.clientWidth; H = document.body.clientHeight;
    glCanvas.width = Math.round(W * dpr); glCanvas.height = Math.round(H * dpr);
    fx.width = Math.round(W * dpr); fx.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------- state ----------------
  let hunger = 0; let hungerTarget = 0; let gulp = 0;
  let lastFrame = 0;
  const t0 = performance.now();
  const items = [];   // swallowed file chips
  const sparks = [];  // debris

  function frame(now) {
    requestAnimationFrame(frame);
    const minDt = cfg.quality === 'low' ? 1000 / 30 : 0;
    if (now - lastFrame < minDt) return;
    const dt = Math.min((now - (lastFrame || now)) / 1000, 0.05);
    lastFrame = now;

    hunger += (hungerTarget - hunger) * Math.min(1, dt * 5);
    gulp = Math.max(0, gulp - dt * 1.6);
    for (const k of Object.keys(STYLES.tilted)) look[k] += (STYLES[cfg.style][k] - look[k]) * Math.min(1, dt * 3);

    gl.uniform2f(U.uRes, glCanvas.width, glCanvas.height);
    gl.uniform1f(U.uTime, (now - t0) / 1000);
    gl.uniform1f(U.uHunger, hunger);
    gl.uniform1f(U.uGulp, gulp);
    gl.uniform1f(U.uIncl, look.incl);
    gl.uniform1f(U.uRoll, look.roll);
    gl.uniform1f(U.uFaceTint, look.faceTint);
    gl.uniform1f(U.uFrontDim, look.frontDim);
    gl.uniform1f(U.uWarm, look.warm);
    gl.uniform1i(U.uSteps, cfg.quality === 'low' ? 130 : 260);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    drawFx(dt);
  }
  requestAnimationFrame(frame);

  // ---------------- swallow animation ----------------
  const ICONS = { folder: '\u{1F4C1}', image: '\u{1F5BC}', video: '\u{1F39E}', audio: '\u{1F3B5}', archive: '\u{1F5DC}', doc: '\u{1F4C4}' };
  function iconFor(name, isDir) {
    if (isDir) return ICONS.folder;
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (/^(png|jpe?g|gif|webp|heic|bmp|tiff?|svg|raw|psd)$/.test(ext)) return ICONS.image;
    if (/^(mp4|mov|mkv|avi|webm|m4v)$/.test(ext)) return ICONS.video;
    if (/^(mp3|wav|aac|flac|m4a|ogg)$/.test(ext)) return ICONS.audio;
    if (/^(zip|rar|7z|tar|gz|dmg|iso|pkg|exe|msi)$/.test(ext)) return ICONS.archive;
    return ICONS.doc;
  }

  function spawn(name, isDir, x, y, idx) {
    const cx = W / 2; const cy = H / 2;
    let dx = x - cx; let dy = y - cy;
    let r = Math.hypot(dx, dy);
    if (r < W * 0.22) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); r = W * 0.36; }
    const item = {
      name, icon: iconFor(name, isDir),
      r: r + idx * 6, theta: Math.atan2(dy, dx) + idx * 0.5, r0: r + idx * 6,
      vr: 0, delay: idx * 0.09, age: 0, state: 'fall', alpha: 1,
    };
    items.push(item);
    return item;
  }

  function drawFx(dt) {
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2; const cy = H / 2;
    const horizon = Math.min(W, H) * 0.075;

    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.age += dt;
      if (it.age < it.delay) continue;

      if (it.state === 'fall') {
        it.vr += dt * (W * 0.55) * (1 + 3 * (1 - it.r / it.r0));
        it.r -= it.vr * dt;
        it.theta += dt * 2.2 * Math.pow(it.r0 / Math.max(it.r, horizon), 1.2);
        if (Math.random() < 0.6) sparkAt(it);
        if (it.r <= horizon) { it.state = 'gone'; gulp = Math.min(1, gulp + 0.6); }
      } else if (it.state === 'spit') {
        it.r += dt * W * 0.6;
        it.theta -= dt * 1.5;
        it.alpha -= dt * 1.4;
        if (it.alpha <= 0) it.state = 'gone';
      }
      if (it.state === 'gone') { items.splice(i, 1); continue; }

      const k = Math.max(0, Math.min(1, (it.r - horizon) / (it.r0 - horizon)));
      const x = cx + Math.cos(it.theta) * it.r;
      const y = cy + Math.sin(it.theta) * it.r;
      const scale = 0.25 + 0.75 * Math.pow(k, 0.8);
      const stretch = 1 + (1 - k) * 2.2; // spaghettification

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(it.theta + Math.PI / 2);
      ctx.scale(scale * stretch, scale / Math.sqrt(stretch));
      ctx.globalAlpha = Math.max(0, it.alpha) * (0.25 + 0.75 * k);
      const red = it.state === 'spit' ? 1 : 1 - k;
      ctx.shadowColor = `rgba(${150 + 105 * red},${170 - 80 * red},255,0.9)`;
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(14,16,30,0.82)';
      const label = it.name.length > 16 ? `${it.name.slice(0, 14)}…` : it.name;
      ctx.font = '600 10px -apple-system, "Segoe UI", system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 26;
      roundRect(-tw / 2, -9, tw, 18, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgb(${220 + 35 * red},${232 - 120 * red},${255 - 150 * red})`;
      ctx.textBaseline = 'middle';
      ctx.fillText(`${it.icon} ${label}`, -tw / 2 + 6, 0.5);
      ctx.restore();
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      s.r -= dt * s.speed * (1 + 40 / Math.max(s.r, 1));
      s.theta += dt * 3.5 * (60 / Math.max(s.r, 10));
      if (s.life <= 0 || s.r < horizon) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, s.life * 2);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(s.theta) * s.r, cy + Math.sin(s.theta) * s.r, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function sparkAt(it) {
    sparks.push({
      r: it.r + (Math.random() - 0.5) * 10, theta: it.theta + (Math.random() - 0.5) * 0.3,
      speed: 20 + Math.random() * 40, life: 0.5 + Math.random() * 0.6, size: 0.6 + Math.random() * 1.2,
      color: Math.random() < 0.5 ? 'rgba(150,190,255,0.9)' : 'rgba(255,140,110,0.9)',
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------- sound ----------------
  let audio = null;
  function rumble() {
    if (!cfg.sound) return;
    try {
      audio = audio || new AudioContext();
      const t = audio.currentTime;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 1.1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t + 1.25);

      const len = audio.sampleRate * 0.9;
      const nb = audio.createBuffer(1, len, audio.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const n = audio.createBufferSource();
      const f = audio.createBiquadFilter();
      const ng = audio.createGain();
      n.buffer = nb;
      f.type = 'bandpass';
      f.frequency.setValueAtTime(1800, t);
      f.frequency.exponentialRampToValueAtTime(120, t + 0.9);
      ng.gain.value = 0.12;
      n.connect(f).connect(ng).connect(audio.destination);
      n.start(t);
    } catch { /* audio is optional */ }
  }

  // ---------------- toast ----------------
  let toastTimer = 0;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', !!isErr);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), isErr ? 4200 : 1800);
  }

  // ---------------- drag & drop ----------------
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; hungerTarget = 1; });
  window.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; hungerTarget = 1; });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hungerTarget = 0; });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0; hungerTarget = 0;
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;

    const entries = files.map((f, i) => {
      const entry = e.dataTransfer.items?.[i]?.webkitGetAsEntry?.();
      return { file: f, path: api ? api.pathFor(f) : null, isDir: !!entry?.isDirectory };
    });

    const chips = entries.map((en, i) => spawn(en.file.name, en.isDir, e.clientX, e.clientY, i));
    rumble();

    if (!api) { toast(`Preview mode: ${files.length} item(s) would be devoured`); return; }

    const valid = entries.filter((en) => en.path);
    const results = await api.devour(valid.map((en) => en.path));
    const byPath = new Map(results.map((r) => [r.path, r]));

    let ok = 0; const fails = [];
    entries.forEach((en, i) => {
      const r = en.path ? byPath.get(en.path) : { ok: false, error: 'Not a file on disk' };
      if (r && r.ok) ok++;
      else {
        chips[i].state = 'spit';
        if (!r?.cancelled) fails.push(`${en.file.name}: ${r ? r.error : 'Unknown error'}`);
      }
    });

    if (fails.length) toast(fails.length === 1 ? fails[0] : `${fails.length} items resisted — ${fails[0]}`, true);
    else if (ok) toast(`Devoured ${ok} item${ok === 1 ? '' : 's'} forever`);
  });

  // ---------------- window drag + menu ----------------
  let dragging = false; let lx = 0; let ly = 0;
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true; lx = e.screenX; ly = e.screenY;
    document.body.classList.add('dragging');
    document.body.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.screenX - lx; const dy = e.screenY - ly;
    if (dx || dy) { api?.moveBy(dx, dy); lx = e.screenX; ly = e.screenY; }
  });
  const endDrag = () => { dragging = false; document.body.classList.remove('dragging'); };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('contextmenu', (e) => { e.preventDefault(); api?.showMenu(); });

  api?.onConfig((c) => {
    Object.assign(cfg, c);
    if (!STYLES[cfg.style]) cfg.style = 'tilted';
    resize();
  });

  // expose for icon rendering / debugging
  window.__hole = { cfg, spawn: (n) => { spawn(n, false, W * 0.95, H * 0.1, 0); rumble(); } };
})();
