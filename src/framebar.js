// Frame-Leiste (Vorschaubilder, Neu/Kopie, Onion Skin, Abspielen),
// Frame-Aktionen und das Vorschau-Fenster mit einstellbarer FPS.

import { compositeFrame } from './document.js';
import * as F from './frames.js';
import { change } from './layers.js';
import { h, icon, openDialog, confirmDialog, toast } from './ui.js';

const THUMB = 40;

function frameCanvas(doc, frame, maxSize) {
  const f = maxSize / Math.max(doc.width, doc.height);
  const c = h('canvas', { width: doc.width, height: doc.height, style: `width:${doc.width * f}px;height:${doc.height * f}px` });
  c.getContext('2d').putImageData(new ImageData(compositeFrame(doc, frame), doc.width, doc.height), 0, 0);
  return c;
}

export class FrameBar {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.thumbs = h('div', { class: 'frame-thumbs' });
    this.onionBtn = h('button', { class: 'icon-btn', 'aria-label': 'Onion Skin', onClick: () => this.toggleOnion() }, icon('onion'));
    el.append(
      this.thumbs,
      h('button', { class: 'icon-btn', 'aria-label': 'Neuer leerer Frame', onClick: () => this.run(F.addFrame) }, icon('plus')),
      h('button', { class: 'icon-btn', 'aria-label': 'Frame kopieren', onClick: () => this.run(F.duplicateFrame) }, icon('copy')),
      this.onionBtn,
      h('button', { class: 'icon-btn', 'aria-label': 'Abspielen', onClick: () => openPreview(app) }, icon('play')),
    );
  }

  run(op) {
    const app = this.app;
    let ok = true;
    const entry = change(app.doc, () => { ok = op(app.doc) !== false; });
    if (ok) app.commitStructure(entry);
    return ok;
  }

  toggleOnion() {
    this.app.settings.onion = !this.app.settings.onion;
    this.app.view.onion = this.app.settings.onion;
    this.app.view.invalidate();
    this.render();
    this.app.scheduleSave();
    toast(this.app.settings.onion ? 'Onion Skin an: Nachbar-Frames scheinen durch' : 'Onion Skin aus', 1800);
  }

  select(i) {
    const app = this.app;
    if (i === app.doc.frameIndex) {
      this.openActions();
      return;
    }
    app.endRefTransform();
    app.doc.frameIndex = i;
    app.view.invalidate();
    app.updateAll();
    app.scheduleSave();
  }

  /** Alle Vorschaubilder neu zeichnen. */
  render() {
    const doc = this.app.doc;
    this.thumbs.replaceChildren(...doc.frames.map((frame, i) =>
      h('button', {
        class: `frame-thumb${i === doc.frameIndex ? ' active' : ''}`,
        'aria-label': `Frame ${i + 1}`,
        onClick: () => this.select(i),
      }, h('span', { class: 'thumb-bg' }, frameCanvas(doc, frame, THUMB)), h('span', { class: 'frame-no' }, String(i + 1)))));
    this.onionBtn.classList.toggle('active', !!this.app.settings.onion);
    this.thumbs.children[doc.frameIndex]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  /** Nur das Vorschaubild des aktuellen Frames aktualisieren (nach einem Strich). */
  refreshCurrent() {
    const doc = this.app.doc;
    const btn = this.thumbs.children[doc.frameIndex];
    if (!btn || this.thumbs.children.length !== doc.frames.length) return this.render();
    btn.querySelector('.thumb-bg').replaceChildren(frameCanvas(doc, doc.frames[doc.frameIndex], THUMB));
  }

  openActions() {
    const doc = this.app.doc;
    const n = doc.frames.length, i = doc.frameIndex;
    const item = (ic, label, fn, disabled = false) =>
      h('button', { class: 'menu-item', disabled, onClick: async () => { dlg.close(); await fn(); } }, icon(ic), h('span', {}, label));
    const dlg = openDialog({
      title: `Frame ${i + 1} von ${n}`,
      body: h('div', { class: 'menu' },
        item('copy', 'Kopie dahinter einfügen', () => this.run(F.duplicateFrame)),
        item('plus', 'Leeren Frame dahinter einfügen', () => this.run(F.addFrame)),
        item('left', 'Nach links verschieben', () => this.run((d) => F.moveFrame(d, -1)), i === 0),
        item('right', 'Nach rechts verschieben', () => this.run((d) => F.moveFrame(d, 1)), i === n - 1),
        item('trash', 'Frame löschen', async () => {
          if (await confirmDialog('Frame löschen', `Frame ${i + 1} löschen? (Rückgängig ist möglich.)`, 'Löschen', 'danger')) this.run(F.deleteFrame);
        }, n <= 1)),
    });
  }
}

/** Vorschau: spielt alle Frames in Schleife mit einstellbarer FPS ab. */
export function openPreview(app) {
  const doc = app.doc;
  const frames = doc.frames.map((frame) => {
    const c = document.createElement('canvas');
    c.width = doc.width;
    c.height = doc.height;
    c.getContext('2d').putImageData(new ImageData(compositeFrame(doc, frame), doc.width, doc.height), 0, 0);
    return c;
  });
  // ganzzahlig vergrößern, damit jeder Pixel gleich groß bleibt
  const maxW = Math.min(360, window.innerWidth - 64), maxH = Math.min(320, window.innerHeight * 0.4);
  const scale = Math.max(1, Math.floor(Math.min(maxW / doc.width, maxH / doc.height)));
  const screen = h('canvas', { class: 'preview-canvas', width: doc.width * scale, height: doc.height * scale });
  const ctx = screen.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let index = 0, playing = true, last = performance.now(), acc = 0, raf = 0;
  const counter = h('span', { class: 'hint' });
  const draw = () => {
    ctx.clearRect(0, 0, screen.width, screen.height);
    ctx.drawImage(frames[index], 0, 0, screen.width, screen.height);
    counter.textContent = `Frame ${index + 1} / ${frames.length}`;
  };

  const fpsLabel = h('span', {});
  const fpsRange = h('input', { type: 'range', min: 1, max: 30, step: 1, value: Math.min(30, doc.fps), class: 'slider' });
  const fpsNum = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 60, value: doc.fps, class: 'fps-num' });
  const setFps = (v) => {
    v = Math.max(1, Math.min(60, Math.round(v) || 1));
    doc.fps = v;
    fpsRange.value = Math.min(30, v);
    fpsNum.value = v;
    fpsLabel.textContent = `${v} FPS · ${Math.round(1000 / v)} ms pro Frame`;
    app.scheduleSave();
  };
  fpsRange.addEventListener('input', () => setFps(+fpsRange.value));
  fpsNum.addEventListener('change', () => setFps(+fpsNum.value));
  setFps(doc.fps);

  const playBtn = h('button', { class: 'btn primary' });
  const updatePlay = () => {
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play'), playing ? ' Pause' : ' Abspielen');
  };
  playBtn.addEventListener('click', () => { playing = !playing; last = performance.now(); acc = 0; updatePlay(); });
  const step = (d) => { playing = false; updatePlay(); index = (index + d + frames.length) % frames.length; draw(); };

  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    if (!screen.isConnected) { cancelAnimationFrame(raf); return; }
    if (!playing) return;
    acc += now - last;
    last = now;
    const dur = 1000 / doc.fps;
    if (acc >= dur) {
      const steps = Math.floor(acc / dur);
      acc -= steps * dur;
      index = (index + steps) % frames.length;
      draw();
    }
  };

  draw();
  updatePlay();
  openDialog({
    title: 'Animation abspielen',
    body: h('div', { class: 'preview' },
      h('div', { class: 'preview-stage thumb-bg' }, screen),
      h('div', { class: 'preview-controls' },
        h('button', { class: 'icon-btn', 'aria-label': 'Vorheriger Frame', onClick: () => step(-1) }, icon('left')),
        playBtn,
        h('button', { class: 'icon-btn', 'aria-label': 'Nächster Frame', onClick: () => step(1) }, icon('right')),
        counter),
      h('div', { class: 'opacity-row' },
        h('div', { class: 'fps-row' }, fpsLabel, fpsNum),
        fpsRange),
      frames.length < 2 ? h('p', { class: 'hint' }, 'Tipp: Lege unten mit + oder Kopie weitere Frames an.') : null,
      h('p', { class: 'hint' }, `Vorschau in ${scale}-facher Größe. Für GameMaker: im Sprite-Editor dieselbe FPS eintragen.`)),
  });
  raf = requestAnimationFrame(tick);
}
