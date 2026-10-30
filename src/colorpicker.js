// Farbrad: Farbton-Ring mit Sättigung/Helligkeit-Quadrat in der Mitte,
// dazu Deckkraft-Regler, Hex-Feld und RGBA-Zahlenfelder.

import { h } from './ui.js';

export function rgbToHsv({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
  let hue = 0;
  if (d) {
    if (max === rn) hue = ((gn - bn) / d) % 6;
    else if (max === gn) hue = (bn - rn) / d + 2;
    else hue = (rn - gn) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: max ? d / max : 0, v: max };
}

export function hsvToRgb(hue, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

export function colorToHex({ r, g, b, a }) {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a === 255 ? '' : hex2(a)}`.toUpperCase();
}

/** Liest #RGB, #RRGGBB oder #RRGGBBAA (mit oder ohne #). */
export function parseHex(text) {
  let t = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.replace(/./g, (c) => c + c);
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return null;
  const n = (i) => parseInt(t.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: t.length === 8 ? n(6) : 255 };
}

export function colorToCss({ r, g, b, a }) {
  return `rgba(${r},${g},${b},${a / 255})`;
}

export function sameColor(a, b) {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

export class ColorPicker {
  constructor(color, onChange) {
    this.onChange = onChange;
    this.color = { ...color };
    this.hsv = rgbToHsv(color);
    this.el = this.build();
    this.sync();
  }

  build() {
    const size = Math.min(280, window.innerWidth - 48);
    this.size = size;
    const dpr = window.devicePixelRatio || 1;
    this.wheel = h('canvas', { class: 'wheel', width: size * dpr, height: size * dpr, style: `width:${size}px;height:${size}px` });
    this.alpha = h('canvas', { class: 'alpha-bar', height: 28 * dpr });
    this.hexInput = h('input', { type: 'text', class: 'hex', maxlength: 9, autocapitalize: 'characters', spellcheck: 'false' });
    this.fields = {};
    const num = (key, label) => {
      const input = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 255, step: 1 });
      input.addEventListener('focus', () => input.select());
      input.addEventListener('input', () => {
        const v = parseInt(input.value, 10);
        if (!Number.isFinite(v)) return;
        this.color[key] = Math.max(0, Math.min(255, v));
        if (key !== 'a') this.hsv = { ...rgbToHsv(this.color), h: this.keepHue() };
        this.sync(input);
      });
      this.fields[key] = input;
      return h('label', { class: 'mini-field' }, h('span', {}, label), input);
    };

    this.hexInput.addEventListener('input', () => {
      const c = parseHex(this.hexInput.value);
      if (!c) return;
      this.color = c;
      this.hsv = { ...rgbToHsv(c), h: this.keepHue() };
      this.sync(this.hexInput);
    });

    this.bindDrag(this.wheel, (p, start) => this.onWheel(p, start));
    this.bindDrag(this.alpha, (p) => {
      const w = this.alpha.getBoundingClientRect().width;
      this.color.a = Math.round(Math.max(0, Math.min(1, p.x / w)) * 255);
      this.sync();
    });

    return h('div', { class: 'picker' },
      h('div', { class: 'wheel-wrap' }, this.wheel),
      h('div', { class: 'alpha-row' }, h('span', { class: 'hint' }, 'Deckkraft'), this.alpha),
      h('div', { class: 'value-row' },
        h('label', { class: 'mini-field hex-field' }, h('span', {}, 'Hex'), this.hexInput),
        num('r', 'R'), num('g', 'G'), num('b', 'B'), num('a', 'A')),
    );
  }

  // Bei Grau/Schwarz ist der Farbton undefiniert – dann den bisherigen behalten.
  keepHue() {
    const fresh = rgbToHsv(this.color);
    return fresh.s === 0 || fresh.v === 0 ? this.hsv.h : fresh.h;
  }

  bindDrag(el, fn) {
    el.style.touchAction = 'none';
    let active = null;
    const pos = (e) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.addEventListener('pointerdown', (e) => {
      active = e.pointerId;
      el.setPointerCapture(e.pointerId);
      fn(pos(e), true);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === active) fn(pos(e), false); });
    const end = (e) => { if (e.pointerId === active) active = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  geometry() {
    const size = this.size;
    const outer = size / 2;
    const ring = Math.max(18, size * 0.11);
    const inner = outer - ring;
    const half = (inner - 6) / Math.SQRT2; // halbe Kantenlänge des Quadrats
    return { c: outer, outer, inner, ring, half };
  }

  onWheel(p, start) {
    const g = this.geometry();
    const dx = p.x - g.c, dy = p.y - g.c;
    if (start) this.dragTarget = Math.hypot(dx, dy) > g.inner - 2 ? 'ring' : 'square';
    if (this.dragTarget === 'ring') {
      let hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      if (hue < 0) hue += 360;
      this.hsv.h = hue % 360;
    } else {
      this.hsv.s = Math.max(0, Math.min(1, (dx + g.half) / (2 * g.half)));
      this.hsv.v = Math.max(0, Math.min(1, 1 - (dy + g.half) / (2 * g.half)));
    }
    Object.assign(this.color, hsvToRgb(this.hsv.h, this.hsv.s, this.hsv.v));
    this.sync();
  }

  setColor(color) {
    this.color = { ...color };
    this.hsv = { ...rgbToHsv(color), h: this.keepHue() };
    this.sync();
  }

  /** Alles neu zeichnen; das Feld, in dem gerade getippt wird, bleibt unberührt. */
  sync(source = null) {
    this.drawWheel();
    this.drawAlpha();
    if (source !== this.hexInput) this.hexInput.value = colorToHex(this.color);
    for (const k of ['r', 'g', 'b', 'a']) if (source !== this.fields[k]) this.fields[k].value = this.color[k];
    this.onChange({ ...this.color });
  }

  drawWheel() {
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.wheel.getContext('2d');
    const g = this.geometry();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);

    // Farbton-Ring
    if (!this.ringCache) {
      const ring = document.createElement('canvas');
      ring.width = ring.height = this.size * dpr;
      const rc = ring.getContext('2d');
      rc.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let d = 0; d < 360; d++) {
        rc.beginPath();
        const a0 = ((d - 90 - 0.6) * Math.PI) / 180, a1 = ((d - 90 + 0.6) * Math.PI) / 180;
        rc.arc(g.c, g.c, g.outer, a0, a1);
        rc.arc(g.c, g.c, g.inner, a1, a0, true);
        rc.closePath();
        rc.fillStyle = `hsl(${d},100%,50%)`;
        rc.fill();
      }
      this.ringCache = ring;
    }
    ctx.drawImage(this.ringCache, 0, 0, this.size, this.size);

    // Sättigung/Helligkeit-Quadrat
    const x0 = g.c - g.half, y0 = g.c - g.half, side = 2 * g.half;
    const pure = hsvToRgb(this.hsv.h, 1, 1);
    ctx.fillStyle = `rgb(${pure.r},${pure.g},${pure.b})`;
    ctx.fillRect(x0, y0, side, side);
    let grad = ctx.createLinearGradient(x0, 0, x0 + side, 0);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, side, side);
    grad = ctx.createLinearGradient(0, y0, 0, y0 + side);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, '#000');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, side, side);

    // Markierungen
    const marker = (x, y, r) => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    };
    const ha = ((this.hsv.h - 90) * Math.PI) / 180, hr = (g.outer + g.inner) / 2;
    marker(g.c + Math.cos(ha) * hr, g.c + Math.sin(ha) * hr, g.ring / 2 - 1);
    marker(x0 + this.hsv.s * side, y0 + (1 - this.hsv.v) * side, 8);
  }

  drawAlpha() {
    const dpr = window.devicePixelRatio || 1;
    const cv = this.alpha;
    const w = cv.getBoundingClientRect().width || this.size;
    if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hgt = 28;
    for (let x = 0; x < w; x += 7) {
      for (let y = 0; y < hgt; y += 7) {
        ctx.fillStyle = ((x + y) / 7) % 2 ? '#b3b3ba' : '#c9c9ce';
        ctx.fillRect(x, y, 7, 7);
      }
    }
    const { r, g, b, a } = this.color;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(1, `rgb(${r},${g},${b})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, hgt);
    const x = (a / 255) * w;
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.min(w - 4, Math.max(0, x - 2)), 0, 4, hgt);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.min(w - 4, Math.max(0, x - 2)) + 0.5, 0.5, 3, hgt - 1);
  }
}
