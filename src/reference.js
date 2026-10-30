// Vorlagen zum Abpausen: ein eingefügtes Bild als eigene Ebene, die in voller
// Bildqualität angezeigt, aber nie exportiert wird. Position/Größe in
// Bild-Pixeln (x, y, w, h), Zuschnitt in Pixeln des Originalbilds (sx, sy, sw, sh).

import { createLayer } from './document.js';
import { h, icon } from './ui.js';

const MAX_IMPORT = 2048; // größere Fotos werden beim Import verkleinert
const HANDLE_HIT = 26; // Fangradius der Griffe in CSS-px
const MIN_SIZE = 0.5; // kleinste Vorlagengröße in Bild-Pixeln

// ---------- Import und Laden ----------

/** Liest eine Bilddatei ein und verkleinert sehr große Fotos. */
export async function importImageFile(file) {
  let bitmap = await createImageBitmap(file);
  let bytes = new Uint8Array(await file.arrayBuffer());
  let mime = file.type || 'image/png';
  const big = Math.max(bitmap.width, bitmap.height);
  if (big > MAX_IMPORT || !/^image\/(png|jpeg|webp|gif)$/.test(mime)) {
    const f = Math.min(1, MAX_IMPORT / big);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bitmap.width * f));
    c.height = Math.max(1, Math.round(bitmap.height * f));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.92));
    bytes = new Uint8Array(await blob.arrayBuffer());
    mime = blob.type;
    bitmap = await createImageBitmap(blob);
  }
  return { bytes, mime, imgW: bitmap.width, imgH: bitmap.height, bitmap };
}

/** Lädt fehlende Bitmaps (z. B. nach dem Öffnen eines Projekts). */
export async function loadRefBitmaps(doc) {
  const jobs = [];
  for (const f of doc.frames) {
    for (const l of f.layers) {
      if (l.ref && !l.ref.bitmap) {
        jobs.push(createImageBitmap(new Blob([l.ref.bytes], { type: l.ref.mime })).then((b) => { l.ref.bitmap = b; }));
      }
    }
  }
  await Promise.all(jobs);
  return jobs.length > 0;
}

/** Vorlage so groß wie möglich mittig in die Leinwand einpassen. */
export function fitRef(ref, docW, docH) {
  const f = Math.min(docW / ref.sw, docH / ref.sh);
  ref.w = ref.sw * f;
  ref.h = ref.sh * f;
  ref.x = (docW - ref.w) / 2;
  ref.y = (docH - ref.h) / 2;
}

/** Fügt die Vorlage als unterste Ebene in alle Frames ein. */
export function addReference(doc, img, name = 'Vorlage') {
  const base = { bytes: img.bytes, mime: img.mime, imgW: img.imgW, imgH: img.imgH, bitmap: img.bitmap,
    sx: 0, sy: 0, sw: img.imgW, sh: img.imgH, x: 0, y: 0, w: 1, h: 1 };
  fitRef(base, doc.width, doc.height);
  for (const f of doc.frames) {
    const layer = createLayer(doc.width, doc.height, name);
    layer.opacity = 0.5;
    layer.ref = { ...base };
    f.layers.unshift(layer);
  }
  doc.layerIndex += 1; // die bisher gewählte Ebene bleibt gewählt
  return doc.frames[doc.frameIndex].layers[0];
}

export const REF_FIELDS = ['x', 'y', 'w', 'h', 'sx', 'sy', 'sw', 'sh'];

export function refParams(ref) {
  return Object.fromEntries(REF_FIELDS.map((k) => [k, ref[k]]));
}

/** Farbe des Originalbilds an einer Bildposition (für die Pipette) oder null. */
export function sampleRef(layer, px, py) {
  const ref = layer.ref;
  if (!ref.bitmap) return null;
  const u = ref.sx + ((px - ref.x) / ref.w) * ref.sw;
  const v = ref.sy + ((py - ref.y) / ref.h) * ref.sh;
  if (u < ref.sx || v < ref.sy || u >= ref.sx + ref.sw || v >= ref.sy + ref.sh) return null;
  if (!ref.sampleCtx) {
    const c = document.createElement('canvas');
    c.width = ref.imgW;
    c.height = ref.imgH;
    ref.sampleCtx = c.getContext('2d', { willReadFrequently: true });
    ref.sampleCtx.drawImage(ref.bitmap, 0, 0);
  }
  const d = ref.sampleCtx.getImageData(Math.floor(u), Math.floor(v), 1, 1).data;
  return d[3] ? { r: d[0], g: d[1], b: d[2], a: 255 } : null;
}

// ---------- Anpassen-Modus ----------

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export class RefTransform {
  constructor(layer, { onCommit, onChange }) {
    this.layer = layer;
    this.mode = 'transform'; // oder 'crop'
    this.lock = true; // Seitenverhältnis an den Ecken beibehalten
    this.onCommit = onCommit;
    this.onChange = onChange;
    this.drag = null;
  }

  get ref() {
    return this.layer.ref;
  }

  handlePoints(view) {
    const r = view.toScreenRect(this.ref);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const pos = {
      nw: [r.x, r.y], n: [cx, r.y], ne: [r.x + r.w, r.y], e: [r.x + r.w, cy],
      se: [r.x + r.w, r.y + r.h], s: [cx, r.y + r.h], sw: [r.x, r.y + r.h], w: [r.x, cy],
    };
    return HANDLES.map((id) => ({ id, x: pos[id][0], y: pos[id][1] }));
  }

  draw(ctx, view) {
    const ref = this.ref;
    if (!ref.bitmap) return;
    if (this.mode === 'crop') {
      // ganzes Bild blass, zugeschnittener Teil kräftig
      const kx = ref.w / ref.sw, ky = ref.h / ref.sh;
      const full = view.toScreenRect({ x: ref.x - ref.sx * kx, y: ref.y - ref.sy * ky, w: ref.imgW * kx, h: ref.imgH * ky });
      ctx.globalAlpha = 0.25;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(ref.bitmap, full.x, full.y, full.w, full.h);
      ctx.globalAlpha = 1;
      view.drawRef(this.layer, Math.max(0.75, this.layer.opacity));
    } else {
      view.drawRef(this.layer, Math.max(0.35, this.layer.opacity));
    }
    const r = view.toScreenRect(ref);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#ffb347';
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
    for (const p of this.handlePoints(view)) {
      const corner = p.id.length === 2;
      const s = corner ? 16 : 12;
      ctx.fillStyle = corner ? '#ffb347' : '#ffffff';
      ctx.strokeStyle = '#1b1206';
      ctx.lineWidth = 2;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
    }
  }

  down(p, view) {
    let best = null, bestD = HANDLE_HIT;
    for (const hp of this.handlePoints(view)) {
      const d = Math.hypot(hp.x - p.x, hp.y - p.y);
      if (d < bestD) { best = hp.id; bestD = d; }
    }
    this.drag = { type: best || 'move', start: p, before: refParams(this.ref) };
  }

  move(p, view) {
    if (!this.drag) return;
    const ref = this.ref, b = this.drag.before;
    const dx = (p.x - this.drag.start.x) / view.scale;
    const dy = (p.y - this.drag.start.y) / view.scale;
    const type = this.drag.type;
    Object.assign(ref, b);
    if (type === 'move') {
      ref.x = b.x + dx;
      ref.y = b.y + dy;
    } else if (this.mode === 'crop') {
      this.cropEdges(type, dx, dy, b);
    } else {
      this.resizeEdges(type, dx, dy, b);
    }
    this.onChange();
    view.requestRender();
  }

  resizeEdges(type, dx, dy, b) {
    const ref = this.ref;
    let { x, y, w, h } = b;
    if (type.includes('e')) w = Math.max(MIN_SIZE, b.w + dx);
    if (type.includes('w')) { w = Math.max(MIN_SIZE, b.w - dx); x = b.x + b.w - w; }
    if (type.includes('s')) h = Math.max(MIN_SIZE, b.h + dy);
    if (type.includes('n')) { h = Math.max(MIN_SIZE, b.h - dy); y = b.y + b.h - h; }
    if (type.length === 2 && this.lock) {
      // Ecke mit festem Seitenverhältnis: gegenüberliegende Ecke bleibt stehen
      const f = Math.max(MIN_SIZE / Math.min(b.w, b.h), (w / b.w + h / b.h) / 2);
      w = b.w * f;
      h = b.h * f;
      x = type.includes('w') ? b.x + b.w - w : b.x;
      y = type.includes('n') ? b.y + b.h - h : b.y;
    }
    Object.assign(ref, { x, y, w, h });
  }

  cropEdges(type, dx, dy, b) {
    const ref = this.ref;
    const kx = b.w / b.sw, ky = b.h / b.sh; // Bild-Pixel pro Originalpixel
    if (type.includes('w')) {
      const du = Math.min(Math.max(dx / kx, -b.sx), b.sw - 1);
      ref.sx = b.sx + du; ref.sw = b.sw - du; ref.x = b.x + du * kx; ref.w = ref.sw * kx;
    }
    if (type.includes('e')) {
      ref.sw = Math.min(Math.max(1, b.sw + dx / kx), ref.imgW - b.sx); ref.w = ref.sw * kx;
    }
    if (type.includes('n')) {
      const dv = Math.min(Math.max(dy / ky, -b.sy), b.sh - 1);
      ref.sy = b.sy + dv; ref.sh = b.sh - dv; ref.y = b.y + dv * ky; ref.h = ref.sh * ky;
    }
    if (type.includes('s')) {
      ref.sh = Math.min(Math.max(1, b.sh + dy / ky), ref.imgH - b.sy); ref.h = ref.sh * ky;
    }
  }

  up() {
    if (!this.drag) return;
    const before = this.drag.before, after = refParams(this.ref);
    this.drag = null;
    if (REF_FIELDS.some((k) => before[k] !== after[k])) this.onCommit(before, after);
  }

  cancel(view) {
    if (!this.drag) return;
    Object.assign(this.ref, this.drag.before);
    this.drag = null;
    this.onChange();
    view.requestRender();
  }
}

/** Steuerleiste unten, solange eine Vorlage angepasst wird. */
export function createRefBar({ overlay, onFit, onResetCrop, onDone, onRender }) {
  const info = h('span', { class: 'ref-info' });
  const modeBtns = {};
  const lockBtn = h('button', { class: 'chip' });
  const update = () => {
    const r = overlay.ref;
    info.textContent = `${fmt(r.w)} × ${fmt(r.h)} px` + (overlay.mode === 'crop' ? ` · Ausschnitt ${Math.round(r.sw)} × ${Math.round(r.sh)} Originalpixel` : '');
    for (const [m, b] of Object.entries(modeBtns)) b.classList.toggle('active', overlay.mode === m);
    lockBtn.textContent = overlay.lock ? 'Ecken: Seitenverhältnis fest' : 'Ecken: frei';
    lockBtn.classList.toggle('active', overlay.lock);
    lockBtn.hidden = overlay.mode === 'crop';
  };
  const modeBtn = (m, label) => (modeBtns[m] = h('button', { class: 'chip', onClick: () => { overlay.mode = m; update(); onRender(); } }, label));
  lockBtn.addEventListener('click', () => { overlay.lock = !overlay.lock; update(); });
  const bar = h('div', { class: 'ref-bar' },
    h('div', { class: 'ref-bar-head' }, h('strong', {}, 'Vorlage anpassen'), info),
    h('div', { class: 'chips' },
      modeBtn('transform', 'Größe & Position'),
      modeBtn('crop', 'Zuschneiden'),
      lockBtn),
    h('div', { class: 'chips' },
      h('button', { class: 'chip', onClick: onFit }, 'In Leinwand einpassen'),
      h('button', { class: 'chip', onClick: onResetCrop }, 'Zuschnitt aufheben'),
      h('button', { class: 'btn primary ref-done', onClick: onDone }, icon('check'), 'Fertig')),
    h('p', { class: 'hint' }, 'Im Bild ziehen = verschieben · Ecken = skalieren · Kanten = Breite/Höhe · zwei Finger = zoomen'),
  );
  update();
  return { bar, update };
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
}
