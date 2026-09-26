// kit.js - общий «каркас» небольших игр «Игротеки»: главное меню, пауза, настройки,
// переназначение клавиш, геймпад, музыка и звуки (синтез WebAudio), достижения,
// пауза при скрытии вкладки, счётчик кадров, всплывающие сообщения.
// Один и тот же файл лежит в папке каждой игры (страницы самостоятельные), копии одинаковые -
// это проверяет tests/web/_kit.spec.js. Игра подключает его обычным <script src="kit.js">.
'use strict';
(function () {
  const DEFAULT_SETTINGS = { musicVol: 0.5, sfxVol: 0.8, difficulty: 'normal', effects: true, shake: true, showFps: false, lang: 'ru' };
  const DIFF_NAMES = { easy: 'Лёгкая', normal: 'Обычная', hard: 'Трудная' };
  const KEY_NAMES = {
    Space: 'Пробел', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter', Escape: 'Esc',
    ShiftLeft: 'Shift', ShiftRight: 'Правый Shift', ControlLeft: 'Ctrl', ControlRight: 'Правый Ctrl',
    AltLeft: 'Alt', AltRight: 'Правый Alt', Backspace: 'Backspace', Tab: 'Tab', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=',
  };
  const PAD_NAMES = { b0: 'A', b1: 'B', b2: 'X', b3: 'Y', b4: 'LB', b5: 'RB', b6: 'LT', b7: 'RT', b9: 'Start', b12: 'Крест ↑', b13: 'Крест ↓', b14: 'Крест ←', b15: 'Крест →', 'a0-': 'Стик ←', 'a0+': 'Стик →', 'a1-': 'Стик ↑', 'a1+': 'Стик ↓' };
  function keyName(code) {
    if (!code) return '—';
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    return code;
  }

  // ---------- Ноты и музыка ----------
  const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  function noteFreq(n) {
    const m = /^([A-G]#?)(-?\d)$/.exec(n);
    if (!m) return 0;
    const midi = NOTE[m[1]] + (Number(m[2]) + 1) * 12;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  // Дорожка: { bpm, steps: 16 на такт, voices: [{ type, vol, notes: 'C4 . E4 - G4 ...' }], drums: 'k.h.s.h.' }
  // '.' - пауза, '-' - продлить предыдущую ноту. Все голоса и ударные зациклены по своей длине.
  function parseVoice(str) { return str.trim().split(/\s+/); }

  class Music {
    constructor(kit) { this.kit = kit; this.track = null; this.name = null; this.timer = 0; this.step = 0; this.nextTime = 0; }
    play(name) {
      if (this.name === name && this.track) return;
      this.stop();
      const def = (this.kit.o.music || {})[name];
      if (!def) return;
      this.name = name;
      this.track = { bpm: def.bpm, voices: (def.voices || []).map((v) => ({ ...v, seq: parseVoice(v.notes) })), drums: def.drums ? def.drums.replace(/\s+/g, '') : '' };
      const ctx = this.kit.audioCtx();
      if (!ctx) return;
      this.step = 0;
      this.nextTime = ctx.currentTime + 0.08;
      this.timer = setInterval(() => this.schedule(), 25);
    }
    stop() {
      clearInterval(this.timer);
      this.timer = 0;
      this.track = null;
      this.name = null;
    }
    schedule() {
      const ctx = this.kit.ctx;
      if (!ctx || !this.track || ctx.state !== 'running') return;
      const stepDur = 60 / this.track.bpm / 4;
      while (this.nextTime < ctx.currentTime + 0.15) {
        this.playStep(this.step, this.nextTime, stepDur);
        this.step++;
        this.nextTime += stepDur;
      }
    }
    playStep(i, t, stepDur) {
      const k = this.kit, out = k.musicGain;
      for (const v of this.track.voices) {
        const n = v.seq[i % v.seq.length];
        if (n === '.' || n === '-') continue;
        let len = 1;
        while (v.seq[(i + len) % v.seq.length] === '-' && len < v.seq.length) len++;
        const f = noteFreq(n);
        if (!f) continue;
        const o = k.ctx.createOscillator(), g = k.ctx.createGain();
        o.type = v.type || 'square';
        o.frequency.setValueAtTime(f, t);
        const d = stepDur * len * 0.95, vol = v.vol || 0.1;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.01);
        g.gain.setValueAtTime(vol, t + d * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(out);
        o.start(t); o.stop(t + d + 0.02);
      }
      const dr = this.track.drums;
      if (dr) {
        const c = dr[i % dr.length];
        if (c === 'k') k.drum('kick', t, out);
        else if (c === 's') k.drum('snare', t, out);
        else if (c === 'h') k.drum('hat', t, out);
      }
    }
  }

  // ---------- Сам каркас ----------
  class Kit {
    constructor(o) {
      this.o = o;
      this.id = o.id;
      this.game = o.game || {};
      this.mode = 'menu';            // menu | play | paused
      this.stack = [];
      const extra = {};
      for (const x of o.extraSettings || []) extra[x.name] = x.default;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, extra, o.settings || {}, this.load('settings', {}));
      this.actions = o.actions || {};
      this.bindings = this.defaultBindings();
      const savedB = this.load('bindings', null);
      if (savedB) for (const a in savedB) if (this.bindings[a]) this.bindings[a] = savedB[a].slice(0, 2);
      this.unlocked = this.load('achievements', {});
      this.held = new Set();
      this.pressed = new Set();
      this.padDown = new Set();
      this.padPrev = new Set();
      this.frames = 0; this.fps = 0; this.fpsT = performance.now();
      this.ctx = null;
      this.music = new Music(this);
      this.rebinding = null;
      this.buildDom();
      this.bindEvents();
      requestAnimationFrame((t) => this.loop(t));
      this.applySettings();
    }

    // ---------- Хранилище: всё с приставкой игры, чтобы игры в одном приложении не мешали друг другу ----------
    key(k) { return this.id + ':' + k; }
    load(k, def) { try { const v = localStorage.getItem(this.key(k)); return v === null ? def : JSON.parse(v); } catch (e) { return def; } }
    save(k, v) { try { localStorage.setItem(this.key(k), JSON.stringify(v)); } catch (e) { /* нет хранилища */ } }
    remove(k) { try { localStorage.removeItem(this.key(k)); } catch (e) { /* нет хранилища */ } }

    // ---------- Настройки ----------
    set(name, value) {
      this.settings[name] = value;
      this.save('settings', this.settings);
      this.applySettings();
    }
    applySettings() {
      if (this.musicGain) {
        this.musicGain.gain.value = this.settings.musicVol;
        this.sfxGain.gain.value = this.settings.sfxVol;
      }
      this.fpsEl.style.display = this.settings.showFps ? 'block' : 'none';
      if (this.game.onSettings) this.game.onSettings(this.settings);
    }
    diff(values) { return values[this.settings.difficulty] !== undefined ? values[this.settings.difficulty] : values.normal; }

    // ---------- Звук ----------
    audioCtx() {
      if (!this.ctx) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.connect(this.ctx.destination);
          this.musicGain = this.ctx.createGain();
          this.sfxGain = this.ctx.createGain();
          this.musicGain.connect(this.master);
          this.sfxGain.connect(this.master);
          this.applySettings();
          if (document.hidden) this.ctx.suspend();
        } catch (e) { this.ctx = null; }
      }
      return this.ctx;
    }
    // Простой звук: tone(частота, длительность, {type, vol, slide, delay})
    tone(freq, dur, opt = {}) {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime + (opt.delay || 0);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = opt.type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (opt.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.slide), t + dur);
      const vol = opt.vol === undefined ? 0.15 : opt.vol;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.sfxGain);
      o.start(t); o.stop(t + dur + 0.02);
    }
    noiseBuffer() {
      if (!this._noise) {
        const n = this.ctx.sampleRate;
        this._noise = this.ctx.createBuffer(1, n, n);
        const d = this._noise.getChannelData(0);
        let seed = 12345;
        for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = seed / 0x3fffffff - 1; }
      }
      return this._noise;
    }
    // Шум (взрыв, удар): noise(длительность, {vol, freq, delay})
    noise(dur, opt = {}, out) {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const t = opt.t !== undefined ? opt.t : ctx.currentTime + (opt.delay || 0);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      const f = ctx.createBiquadFilter();
      f.type = opt.filter || 'lowpass';
      f.frequency.value = opt.freq || 1200;
      const g = ctx.createGain();
      const vol = opt.vol === undefined ? 0.2 : opt.vol;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(out || this.sfxGain);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    }
    drum(kind, t, out) {
      const ctx = this.ctx;
      if (kind === 'kick') {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        o.connect(g).connect(out); o.start(t); o.stop(t + 0.16);
      } else if (kind === 'snare') this.noise(0.12, { vol: 0.12, freq: 3000, filter: 'bandpass', t }, out);
      else this.noise(0.04, { vol: 0.05, freq: 7000, filter: 'highpass', t }, out);
    }

    // ---------- Ввод: действия вместо клавиш ----------
    defaultBindings() {
      const b = {};
      for (const a in this.actions) b[a] = (this.actions[a].keys || []).slice(0, 2);
      return b;
    }
    isDown(action) {
      const keys = this.bindings[action] || [];
      return keys.some((c) => c && this.held.has(c)) || this.padDown.has(action);
    }
    wasPressed(action) { return this.pressed.has(action); }
    // Игра вызывает после каждого шага мира: нажатия «съедены»
    endStep() { this.pressed.clear(); }
    releaseAll() { this.held.clear(); this.pressed.clear(); this.padDown.clear(); }
    actionOf(code) {
      for (const a in this.bindings) if (this.bindings[a].includes(code)) return a;
      return null;
    }
    keyLabel(action) { return (this.bindings[action] || []).filter(Boolean).map(keyName).join(' / ') || '—'; }

    bindEvents() {
      addEventListener('keydown', (e) => this.onKeyDown(e), true);
      addEventListener('keyup', (e) => { this.held.delete(e.code); });
      addEventListener('blur', () => { this.releaseAll(); if (this.mode === 'play') this.pause(); });
      document.addEventListener('visibilitychange', () => this.onVisibility());
      const unlockAudio = () => { const c = this.audioCtx(); if (c && c.state === 'suspended' && !document.hidden) c.resume(); this.refreshMusic(); };
      addEventListener('pointerdown', unlockAudio, true);
      addEventListener('keydown', unlockAudio, true);
    }

    onVisibility() {
      if (document.hidden) {
        this.releaseAll();
        if (this.mode === 'play') this.pause();
        if (this.ctx) this.ctx.suspend();
      } else if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();      // игра остаётся на паузе, пока игрок сам не продолжит
      }
    }

    onKeyDown(e) {
      const code = e.code;
      if (this.rebinding) { e.preventDefault(); e.stopPropagation(); this.finishRebind(code); return; }
      if (this.stack.length) {        // открыт экран меню: стрелки, Enter, Esc
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' && t.type === 'text');
        if (typing) return;
        if (code === 'ArrowDown' || code === 'ArrowUp') { e.preventDefault(); this.moveFocus(code === 'ArrowDown' ? 1 : -1); return; }
        if (code === 'Escape') { e.preventDefault(); this.back(); return; }
        return;
      }
      if (this.mode !== 'play') return;
      const a = this.actionOf(code);
      if (code === 'Escape' || a === 'pause') { e.preventDefault(); this.pause(); return; }
      if (a || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
      if (!e.repeat && a) for (const act in this.bindings) if (this.bindings[act].includes(code)) this.pressed.add(act);
      this.held.add(code);
    }

    // Первый подключённый геймпад (для аналоговых стиков в игре) или null
    pad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      return Array.from(pads || []).find((p) => p && p.connected) || null;
    }
    // Геймпад: стандартная раскладка, опрос каждый кадр
    pollPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = Array.from(pads || []).find((p) => p && p.connected);
      this.padDown.clear();
      if (!pad) { this.padPrev.clear(); return; }
      const on = (id) => {
        if (id[0] === 'b') { const b = pad.buttons[Number(id.slice(1))]; return !!(b && b.pressed); }
        const ax = pad.axes[Number(id[1])] || 0;
        return id[2] === '-' ? ax < -0.5 : ax > 0.5;
      };
      if (this.stack.length) {
        const now = new Set(['b12', 'b13', 'a1-', 'a1+', 'b0', 'b1'].filter(on));
        const fresh = (id) => now.has(id) && !this.padPrev.has(id);
        if (fresh('b13') || fresh('a1+')) this.moveFocus(1);
        if (fresh('b12') || fresh('a1-')) this.moveFocus(-1);
        if (fresh('b0') && document.activeElement && this.layer.contains(document.activeElement)) document.activeElement.click();
        if (fresh('b1')) this.back();
        this.padPrev = now;
        return;
      }
      const now = new Set();
      for (const a in this.actions) {
        const ids = this.actions[a].pad || [];
        if (ids.some(on)) { this.padDown.add(a); ids.forEach((id) => { if (on(id)) now.add(a); }); }
      }
      for (const a of now) if (!this.padPrev.has(a)) { if (a === 'pause' && this.mode === 'play') this.pause(); else this.pressed.add(a); }
      if (on('b9') && !this.padPrev.has('start') && this.mode === 'play') this.pause();
      if (on('b9')) now.add('start');
      this.padPrev = now;
    }

    loop(t) {
      this.pollPad();
      if (t - this.fpsT >= 500) {
        this.fps = Math.round(this.frames * 1000 / (t - this.fpsT));
        this.frames = 0; this.fpsT = t;
        if (this.settings.showFps) this.fpsEl.textContent = this.fps + ' кадр/с';
      }
      if (this.logoCanvas && this.logoCanvas.isConnected && this.o.drawLogo) {
        const c = this.logoCanvas, g = c.getContext('2d');
        g.setTransform(c.width / 480, 0, 0, c.width / 480, 0, 0);
        g.clearRect(0, 0, 480, 140);
        this.o.drawLogo(g, 480, 140, t / 1000);
      }
      requestAnimationFrame((tt) => this.loop(tt));
    }
    countFrame() { this.frames++; }

    // ---------- Режимы ----------
    play() {
      this.closeAll();
      this.mode = 'play';
      this.releaseAll();
      this.refreshMusic();
    }
    pause() {
      if (this.mode !== 'play') return;
      this.mode = 'paused';
      this.releaseAll();
      if (this.game.onPause) this.game.onPause();
      this.refreshMusic();
      this.showPause();
    }
    resume() {
      if (this.mode !== 'paused') return;
      this.play();
      if (this.game.onResume) this.game.onResume();
    }
    toMenu() {
      this.closeAll();
      this.mode = 'menu';
      this.releaseAll();
      if (this.game.onQuit) this.game.onQuit();
      this.showMain();
    }
    refreshMusic() {
      if (!this.ctx) return;
      if (this.mode === 'play') this.music.play(this.game.musicFor ? this.game.musicFor() : 'game');
      else if (this.mode === 'menu') this.music.play('menu');
      else this.music.stop();
    }

    // ---------- Экраны ----------
    buildDom() {
      const th = Object.assign({ bg: 'rgba(12,14,28,0.92)', fg: '#f2f2f7', accent: '#ffcc33', accent2: '#ff6b3d', dim: '#9aa0b8', font: '"Segoe UI", Arial, sans-serif', panel: 'rgba(24,28,52,0.96)' }, this.o.theme || {});
      if (!document.getElementById('kit-style')) {
        const st = document.createElement('style');
        st.id = 'kit-style';
        st.textContent = `
.kit-layer { position: absolute; inset: 0; z-index: 50; pointer-events: none; font-family: var(--kit-font); color: var(--kit-fg); }
.kit-screen { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--kit-shade); pointer-events: auto; animation: kitIn .18s ease-out; }
@keyframes kitIn { from { opacity: 0; transform: scale(.98); } to { opacity: 1; transform: none; } }
.kit-panel { background: var(--kit-panel); border: 2px solid var(--kit-accent); border-radius: 14px; padding: 18px 22px; min-width: 280px; max-width: min(760px, 92%); max-height: 92%; overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.5); text-align: center; }
.kit-panel.wide { min-width: min(620px, 92%); }
.kit-panel h2 { margin: 4px 0 12px; font-size: 24px; letter-spacing: 2px; color: var(--kit-accent); }
.kit-logo { display: block; width: min(480px, 80vw); aspect-ratio: 480 / 140; margin: 0 auto 6px; }
.kit-body { text-align: left; line-height: 1.5; font-size: 15px; }
.kit-body p { margin: 6px 0; }
.kit-body table { border-collapse: collapse; width: 100%; }
.kit-body td { padding: 3px 6px; border-bottom: 1px solid rgba(255,255,255,.08); }
.kit-buttons { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; align-items: stretch; }
.kit-buttons.row { flex-direction: row; justify-content: center; flex-wrap: wrap; }
.kit-btn { font: inherit; font-size: 16px; font-weight: 600; padding: 9px 18px; border-radius: 10px; border: 2px solid transparent; background: rgba(255,255,255,.08); color: var(--kit-fg); cursor: pointer; }
.kit-btn:hover, .kit-btn:focus { border-color: var(--kit-accent); outline: none; background: rgba(255,255,255,.14); }
.kit-btn.primary { background: var(--kit-accent2); color: #fff; }
.kit-btn.small { font-size: 13px; padding: 5px 10px; font-weight: 500; }
.kit-btn.on { background: var(--kit-accent); color: #111; }
.kit-btn:disabled { opacity: .4; cursor: default; }
.kit-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; }
.kit-row .lbl { color: var(--kit-dim); }
.kit-seg { display: flex; gap: 4px; }
.kit-sec { margin: 12px 0 4px; font-size: 12px; letter-spacing: 3px; color: var(--kit-accent); text-transform: uppercase; }
.kit-range { width: 180px; accent-color: var(--kit-accent); }
.kit-toast { position: absolute; right: 12px; bottom: 12px; z-index: 60; display: flex; flex-direction: column; gap: 6px; pointer-events: none; font-family: var(--kit-font); }
.kit-toast div { background: var(--kit-panel); color: var(--kit-fg); border-left: 4px solid var(--kit-accent); padding: 8px 12px; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.4); animation: kitIn .2s ease-out; font-size: 14px; }
.kit-fps { position: absolute; left: 8px; bottom: 8px; z-index: 60; font: 12px Consolas, monospace; color: #0f0; background: rgba(0,0,0,.55); padding: 2px 6px; border-radius: 4px; pointer-events: none; }
.kit-modal { position: absolute; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.6); pointer-events: auto; font-family: var(--kit-font); color: var(--kit-fg); }
.kit-modal .kit-panel { min-width: 320px; }
.kit-warn { color: #ff8080; min-height: 20px; margin-top: 8px; }
.kit-ach { display: flex; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,.08); }
.kit-ach .ic { font-size: 22px; width: 30px; text-align: center; }
.kit-ach.locked { opacity: .45; }
.kit-ach b { display: block; }
.kit-ach small { color: var(--kit-dim); }
.kit-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin-top: 8px; }
.kit-grid .kit-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 6px; }
.kit-grid small { font-weight: 400; color: var(--kit-dim); font-size: 12px; }
.kit-stars { color: var(--kit-accent); letter-spacing: 2px; }
`;
        document.head.appendChild(st);
      }
      const root = this.o.root;
      root.style.setProperty('--kit-bg', th.bg);
      root.style.setProperty('--kit-fg', th.fg);
      root.style.setProperty('--kit-accent', th.accent);
      root.style.setProperty('--kit-accent2', th.accent2);
      root.style.setProperty('--kit-dim', th.dim);
      root.style.setProperty('--kit-font', th.font);
      root.style.setProperty('--kit-panel', th.panel);
      root.style.setProperty('--kit-shade', th.shade || 'rgba(0,0,0,.35)');
      this.layer = document.createElement('div');
      this.layer.className = 'kit-layer';
      root.appendChild(this.layer);
      this.toastEl = document.createElement('div');
      this.toastEl.className = 'kit-toast';
      root.appendChild(this.toastEl);
      this.fpsEl = document.createElement('div');
      this.fpsEl.className = 'kit-fps';
      root.appendChild(this.fpsEl);
    }

    el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
    btn(label, onClick, cls = '') {
      const b = this.el('button', 'kit-btn ' + cls);
      b.type = 'button';
      b.innerHTML = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.click(); onClick(e); });
      return b;
    }
    click() { this.tone(660, 0.05, { type: 'triangle', vol: 0.08 }); }

    // Показать экран: { title, html | node, buttons: [{label, onClick, primary, cls}], row, wide, logo, back, id }
    show(def) {
      const scr = this.el('div', 'kit-screen');
      if (def.id) scr.dataset.screen = def.id;
      const panel = this.el('div', 'kit-panel' + (def.wide ? ' wide' : ''));
      if (def.logo && this.o.drawLogo) {
        const c = this.el('canvas', 'kit-logo');
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.round(480 * dpr); c.height = Math.round(140 * dpr);
        panel.appendChild(c);
        this.logoCanvas = c;
      }
      if (def.title) panel.appendChild(this.el('h2', '', def.title));
      if (def.html !== undefined || def.node) {
        const body = this.el('div', 'kit-body');
        if (def.node) body.appendChild(def.node); else body.innerHTML = def.html;
        panel.appendChild(body);
      }
      if (def.buttons && def.buttons.length) {
        const bs = this.el('div', 'kit-buttons' + (def.row ? ' row' : ''));
        for (const b of def.buttons) {
          const el = this.btn(b.label, b.onClick, (b.primary ? 'primary ' : '') + (b.cls || ''));
          if (b.id) el.dataset.id = b.id;
          if (b.disabled) el.disabled = true;
          bs.appendChild(el);
        }
        panel.appendChild(bs);
      }
      scr.appendChild(panel);
      scr.addEventListener('pointerdown', (e) => e.stopPropagation());
      for (const s of this.stack) s.el.style.display = 'none';
      this.layer.appendChild(scr);
      this.stack.push({ el: scr, def });
      const first = scr.querySelector('.kit-btn.primary:not(:disabled)') || scr.querySelector('.kit-btn:not(:disabled)');
      if (first) first.focus({ preventScroll: true });
      return scr;
    }
    // Закрыть верхний экран и вернуться к предыдущему
    pop() {
      const top = this.stack.pop();
      if (top) top.el.remove();
      const prev = this.stack[this.stack.length - 1];
      if (prev) {
        prev.el.style.display = 'flex';
        if (prev.def.refresh) { prev.el.remove(); this.stack.pop(); prev.def.refresh(); return; }
        const f = prev.el.querySelector('.kit-btn:not(:disabled)');
        if (f) f.focus({ preventScroll: true });
      }
    }
    replace(def) { const top = this.stack.pop(); if (top) top.el.remove(); return this.show(def); }
    closeAll() { while (this.stack.length) this.stack.pop().el.remove(); this.logoCanvas = null; }
    back() {
      const top = this.stack[this.stack.length - 1];
      if (!top) return;
      if (top.def.back) top.def.back();
      else if (this.stack.length > 1) this.pop();
    }
    topId() { const t = this.stack[this.stack.length - 1]; return t ? t.def.id || null : null; }
    moveFocus(dir) {
      const top = this.stack[this.stack.length - 1];
      if (!top) return;
      const items = Array.from(top.el.querySelectorAll('button:not(:disabled), input[type=range]'));
      if (!items.length) return;
      let i = items.indexOf(document.activeElement);
      i = i < 0 ? 0 : (i + dir + items.length) % items.length;
      items[i].focus();
    }
    toast(text, icon = '★') {
      const d = this.el('div', '', `${icon} ${text}`);
      this.toastEl.appendChild(d);
      setTimeout(() => d.remove(), 3200);
    }
    confirm(text, onYes) {
      this.show({ id: 'confirm', title: 'Точно?', html: `<p style="text-align:center">${text}</p>`, row: true,
        buttons: [{ label: 'Да', primary: true, onClick: () => { this.pop(); onYes(); } }, { label: 'Нет', onClick: () => this.pop() }] });
    }

    // ---------- Стандартные экраны ----------
    showMain() {
      this.closeAll();
      this.mode = 'menu';
      this.refreshMusic();
      const items = (this.game.menuItems ? this.game.menuItems() : []).map((m) => ({ ...m }));
      items.push({ label: 'Настройки', id: 'settings', onClick: () => this.showSettings() });
      items.push({ label: 'Достижения и рекорды', id: 'achievements', onClick: () => this.showAchievements() });
      items.push({ label: 'Как играть', id: 'howto', onClick: () => this.show({ id: 'howto', title: 'Как играть', html: this.o.howto || '', wide: true, buttons: [{ label: 'Назад', onClick: () => this.pop() }] }) });
      items.push({ label: 'Об игре', id: 'credits', onClick: () => this.show({ id: 'credits', title: 'Об игре', html: this.o.credits || '', wide: true, buttons: [{ label: 'Назад', onClick: () => this.pop() }] }) });
      this.show({ id: 'main', logo: true, buttons: items, back: () => {} });
    }
    showPause() {
      this.show({
        id: 'pause', title: 'Пауза', back: () => this.resume(),
        buttons: [
          { label: 'Продолжить', primary: true, id: 'resume', onClick: () => this.resume() },
          { label: 'Настройки', id: 'settings', onClick: () => this.showSettings() },
          { label: 'Заново', id: 'restart', onClick: () => { this.closeAll(); if (this.game.onRestart) this.game.onRestart(); } },
          { label: 'В меню', id: 'menu', onClick: () => this.toMenu() },
        ],
      });
    }

    showSettings() {
      const s = this.settings, node = this.el('div');
      const row = (label, control) => { const r = this.el('div', 'kit-row'); r.appendChild(this.el('span', 'lbl', label)); r.appendChild(control); return r; };
      const range = (name) => {
        const i = this.el('input', 'kit-range');
        i.type = 'range'; i.min = 0; i.max = 100; i.step = 5; i.value = Math.round(s[name] * 100);
        i.dataset.setting = name;
        i.addEventListener('input', () => { this.set(name, Number(i.value) / 100); if (name === 'sfxVol') this.click(); });
        return i;
      };
      const toggle = (name) => {
        const b = this.btn(s[name] ? 'Вкл' : 'Выкл', () => { this.set(name, !this.settings[name]); b.textContent = this.settings[name] ? 'Вкл' : 'Выкл'; b.classList.toggle('on', this.settings[name]); }, 'small' + (s[name] ? ' on' : ''));
        b.dataset.setting = name;
        return b;
      };
      node.appendChild(this.el('div', 'kit-sec', 'Звук'));
      node.appendChild(row('Музыка', range('musicVol')));
      node.appendChild(row('Звуки', range('sfxVol')));
      node.appendChild(this.el('div', 'kit-sec', 'Игра'));
      const seg = this.el('div', 'kit-seg');
      for (const d of ['easy', 'normal', 'hard']) {
        const b = this.btn(DIFF_NAMES[d], () => { this.set('difficulty', d); seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.diff === this.settings.difficulty)); }, 'small' + (s.difficulty === d ? ' on' : ''));
        b.dataset.diff = d;
        seg.appendChild(b);
      }
      node.appendChild(row('Сложность', seg));
      if (this.o.difficultyNote) node.appendChild(this.el('p', 'lbl', `<small style="color:var(--kit-dim)">${this.o.difficultyNote}</small>`));
      for (const x of this.o.extraSettings || []) node.appendChild(row(x.label, toggle(x.name)));
      node.appendChild(this.el('div', 'kit-sec', 'Графика'));
      node.appendChild(row('Частицы и вспышки', toggle('effects')));
      node.appendChild(row('Тряска экрана', toggle('shake')));
      node.appendChild(row('Показывать кадры в секунду', toggle('showFps')));
      node.appendChild(row('Язык', this.el('span', '', 'Русский')));
      node.appendChild(this.el('div', 'kit-sec', 'Управление'));
      for (const a in this.actions) {
        const slots = this.el('div', 'kit-seg');
        for (let i = 0; i < 2; i++) {
          const b = this.btn(keyName(this.bindings[a][i]), () => this.startRebind(a, i), 'small');
          b.dataset.bind = a + ':' + i;
          slots.appendChild(b);
        }
        const pad = (this.actions[a].pad || []).map((id) => PAD_NAMES[id] || id).join(' / ');
        const extra = a === 'pause' ? 'также Esc и Start на геймпаде' : (pad ? 'геймпад: ' + pad : '');
        const lbl = this.actions[a].label + (extra ? ` <small style="opacity:.6">(${extra})</small>` : '');
        node.appendChild(row(lbl, slots));
      }
      const resetKeys = this.btn('Клавиши по умолчанию', () => { this.bindings = this.defaultBindings(); this.save('bindings', this.bindings); this.pop(); this.showSettings(); }, 'small');
      resetKeys.dataset.id = 'resetKeys';
      node.appendChild(row('', resetKeys));
      node.appendChild(this.el('div', 'kit-sec', 'Прогресс'));
      const resetP = this.btn('Сбросить прогресс', () => this.confirm('Стереть весь прогресс, рекорды и достижения? Настройки останутся.', () => this.resetProgress()), 'small');
      resetP.dataset.id = 'resetProgress';
      node.appendChild(row('Уровни, рекорды, достижения', resetP));
      this.show({ id: 'settings', title: 'Настройки', node, wide: true, buttons: [{ label: 'Готово', primary: true, onClick: () => this.pop() }] });
    }
    startRebind(action, slot) {
      const m = this.el('div', 'kit-modal');
      m.innerHTML = `<div class="kit-panel"><h2>Новая клавиша</h2><p>Действие «${this.actions[action].label}». Нажмите клавишу.</p><p class="lbl" style="color:var(--kit-dim)">Esc - отмена, Backspace - очистить</p><div class="kit-warn"></div></div>`;
      this.o.root.appendChild(m);
      this.rebinding = { action, slot, modal: m };
    }
    // Нажатие в окне «нажмите клавишу»: занятая другим действием клавиша не принимается
    finishRebind(code) {
      const r = this.rebinding;
      if (code === 'Escape') { this.cancelRebind(); return; }
      if (code === 'Backspace') { this.bindings[r.action][r.slot] = null; }
      else {
        const other = Object.keys(this.bindings).find((a) => a !== r.action && this.bindings[a].includes(code));
        if (other) {
          r.modal.querySelector('.kit-warn').textContent = `Клавиша ${keyName(code)} уже занята: «${this.actions[other].label}». Выберите другую.`;
          return false;
        }
        const same = this.bindings[r.action].indexOf(code);
        if (same >= 0 && same !== r.slot) this.bindings[r.action][same] = null;
        this.bindings[r.action][r.slot] = code;
      }
      this.save('bindings', this.bindings);
      this.cancelRebind();
      const b = this.layer.querySelector(`[data-bind="${r.action}:${r.slot}"]`);
      if (b) { b.textContent = keyName(this.bindings[r.action][r.slot]); b.focus(); }
      const o = this.layer.querySelector(`[data-bind="${r.action}:${1 - r.slot}"]`);
      if (o) o.textContent = keyName(this.bindings[r.action][1 - r.slot]);
      if (this.game.onBindings) this.game.onBindings();
      return true;
    }
    cancelRebind() { if (this.rebinding) { this.rebinding.modal.remove(); this.rebinding = null; } }

    resetProgress() {
      const keep = new Set([this.key('settings'), this.key('bindings')]);
      try {
        const kill = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(this.id + ':') && !keep.has(k)) kill.push(k); }
        kill.forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* нет хранилища */ }
      this.unlocked = {};
      if (this.game.onResetProgress) this.game.onResetProgress();
      this.toast('Прогресс сброшен', '↺');
      this.showMain();
    }

    // ---------- Достижения ----------
    unlock(id) {
      if (this.unlocked[id]) return false;
      const def = (this.o.achievements || []).find((a) => a.id === id);
      if (!def) return false;
      this.unlocked[id] = Date.now();
      this.save('achievements', this.unlocked);
      this.toast('Достижение: ' + def.name, '🏆');
      this.tone(880, 0.1, { type: 'triangle', vol: 0.1 });
      this.tone(1320, 0.18, { type: 'triangle', vol: 0.1, delay: 0.1 });
      return true;
    }
    showAchievements() {
      const list = (this.o.achievements || []).map((a) => {
        const got = !!this.unlocked[a.id];
        return `<div class="kit-ach${got ? '' : ' locked'}" data-ach="${a.id}"><span class="ic">${got ? '🏆' : '🔒'}</span><span><b>${a.name}</b><small>${a.desc}</small></span></div>`;
      }).join('');
      const got = Object.keys(this.unlocked).length, all = (this.o.achievements || []).length;
      const rec = this.game.recordsHtml ? this.game.recordsHtml() : '';
      this.show({ id: 'achievements', title: 'Достижения и рекорды', wide: true, html: `${rec}<div class="kit-sec">Достижения: ${got} из ${all}</div>${list}`, buttons: [{ label: 'Назад', onClick: () => this.pop() }] });
    }
  }

  window.GameKit = { create: (o) => { const k = new Kit(o); window.__kit = k; return k; }, keyName, noteFreq };
})();
