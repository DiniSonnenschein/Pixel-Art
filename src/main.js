// Pixel-Werkstatt – Einstiegspunkt. Verbindet Dokument, Ansicht, Werkzeuge und UI.

import { createDocument, currentLayer, allLayers, packColor, scaleNearest } from './document.js';
import { History } from './history.js';
import { Stroke } from './tools.js';
import { CanvasView } from './view.js';
import { loadAutosave, saveAutosave, deserialize } from './storage.js';
import { newImageDialog, resizeDialog, exportDialog } from './dialogs.js';
import { h, icon, openDialog } from './ui.js';

// Vorläufige Farbpalette (das Farbrad folgt in Schritt 2)
const PALETTE = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  '#291814', '#111d35', '#422136', '#125359', '#742f29', '#49333b', '#a28879', '#f3ef7d',
  '#be1250', '#ff6c24', '#a8e72e', '#00b543', '#065ab5', '#754665', '#ff6e59', '#ffffff',
];

function hexToColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 };
}

function colorToCss({ r, g, b, a }) {
  return `rgba(${r},${g},${b},${a / 255})`;
}

class App {
  constructor() {
    this.doc = createDocument(64, 64);
    this.tool = 'pen';
    this.color = hexToColor('#000000');
    this.settings = { exportName: 'sprite' };
    this.history = new History(() => this.updateButtons());
    this.stroke = null;
    this.saveTimer = null;
  }

  async init() {
    const saved = await loadAutosave();
    if (saved) {
      try {
        this.doc = deserialize(saved);
        if (saved.color) this.color = saved.color;
        if (saved.tool) this.tool = saved.tool;
        if (saved.settings) Object.assign(this.settings, saved.settings);
      } catch (err) {
        console.error('Autosave konnte nicht geladen werden', err);
      }
    }
    this.buildUI();
    this.view = new CanvasView(document.getElementById('canvas'), {
      getDoc: () => this.doc,
      onStrokeStart: (p) => this.strokeStart(p),
      onStrokeMove: (p) => this.strokeMove(p),
      onStrokeEnd: () => this.strokeEnd(),
      onStrokeCancel: () => this.strokeCancel(),
    });
    this.view.showGrid = this.settings.showGrid !== false;
    this.updateAll();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveNow();
    });
    window.addEventListener('pagehide', () => this.saveNow());
  }

  // ---------- Zeichnen ----------

  strokeStart(p) {
    const layer = currentLayer(this.doc);
    const value = this.tool === 'eraser' ? 0 : packColor(this.color);
    this.stroke = new Stroke(layer, this.doc.width, this.doc.height, value);
    this.stroke.to(p.x, p.y);
    this.view.invalidate();
  }

  strokeMove(p) {
    if (!this.stroke) return;
    this.stroke.to(p.x, p.y);
    this.view.invalidate();
  }

  strokeEnd() {
    if (!this.stroke) return;
    const entry = this.stroke.finish();
    this.stroke = null;
    if (entry) {
      this.history.push(entry);
      this.scheduleSave();
    }
  }

  strokeCancel() {
    if (!this.stroke) return;
    this.stroke.cancel();
    this.stroke = null;
    this.view.invalidate();
  }

  // ---------- Dokument ----------

  newDocument(w, hh) {
    this.doc = createDocument(w, hh);
    this.history.clear();
    this.view.fit();
    this.view.invalidate();
    this.updateAll();
    this.scheduleSave();
  }

  resizeDocument(w, hh) {
    const doc = this.doc;
    const oldW = doc.width, oldH = doc.height;
    const layers = allLayers(doc);
    const before = layers.map((l) => l.data);
    const after = layers.map((l) => scaleNearest(l.data, oldW, oldH, w, hh));
    const apply = (width, height, datas) => {
      doc.width = width;
      doc.height = height;
      layers.forEach((l, i) => { l.data = datas[i]; });
      this.view.fit();
      this.view.invalidate();
      this.updateAll();
      this.scheduleSave();
    };
    apply(w, hh, after);
    this.history.push({ undo: () => apply(oldW, oldH, before), redo: () => apply(w, hh, after) });
  }

  // ---------- Speichern ----------

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 800);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    this.settings.showGrid = this.view?.showGrid;
    saveAutosave(this.doc, { color: this.color, tool: this.tool, settings: this.settings })
      .catch((err) => console.error('Autosave fehlgeschlagen', err));
  }

  // ---------- Oberfläche ----------

  buildUI() {
    const $ = (id) => document.getElementById(id);
    $('btn-menu').append(icon('menu'));
    $('btn-undo').append(icon('undo'));
    $('btn-redo').append(icon('redo'));
    $('btn-grid').append(icon('grid'));
    $('btn-fit').append(icon('fit'));
    document.querySelector('[data-tool="pen"]').prepend(icon('pen'));
    document.querySelector('[data-tool="eraser"]').prepend(icon('eraser'));

    $('btn-undo').addEventListener('click', () => { this.history.undo(); this.view.invalidate(); this.scheduleSave(); });
    $('btn-redo').addEventListener('click', () => { this.history.redo(); this.view.invalidate(); this.scheduleSave(); });
    $('btn-grid').addEventListener('click', () => {
      this.view.showGrid = !this.view.showGrid;
      this.view.requestRender();
      this.updateButtons();
      this.scheduleSave();
    });
    $('btn-fit').addEventListener('click', () => this.view.fit());
    $('btn-menu').addEventListener('click', () => this.openMenu());
    document.querySelectorAll('[data-tool]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tool = b.dataset.tool;
        this.updateButtons();
        this.scheduleSave();
      }),
    );
    $('btn-color').addEventListener('click', () => this.openPalette());

    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.history.redo(); else this.history.undo();
        this.view.invalidate();
      } else if (e.key === 'b') { this.tool = 'pen'; this.updateButtons(); }
      else if (e.key === 'e') { this.tool = 'eraser'; this.updateButtons(); }
    });
  }

  openMenu() {
    const item = (ic, label, fn) =>
      h('button', { class: 'menu-item', onClick: () => { dlg.close(); fn(); } }, icon(ic), h('span', {}, label));
    const dlg = openDialog({
      title: 'Menü',
      body: h('div', { class: 'menu' },
        item('plus', 'Neues Bild …', () => newImageDialog(this)),
        item('resize', 'Leinwandgröße ändern …', () => resizeDialog(this)),
        item('export', 'Als PNG exportieren …', () => exportDialog(this)),
        h('p', { class: 'hint version' }, `Pixel-Werkstatt · Version ${__APP_VERSION__}`)),
    });
  }

  openPalette() {
    const current = PALETTE.find((c) => {
      const col = hexToColor(c);
      return col.r === this.color.r && col.g === this.color.g && col.b === this.color.b;
    });
    const dlg = openDialog({
      title: 'Farbe',
      body: h('div', { class: 'palette' },
        PALETTE.map((c) =>
          h('button', {
            class: `swatch-btn${c === current ? ' active' : ''}`,
            style: `background:${c}`,
            'aria-label': c,
            onClick: () => {
              this.color = hexToColor(c);
              if (this.tool === 'eraser') this.tool = 'pen';
              this.updateButtons();
              this.scheduleSave();
              dlg.close();
            },
          }),
        )),
    });
  }

  updateButtons() {
    const $ = (id) => document.getElementById(id);
    if (!$('btn-undo')) return;
    $('btn-undo').disabled = !this.history.canUndo;
    $('btn-redo').disabled = !this.history.canRedo;
    $('btn-grid').classList.toggle('active', !!this.view?.showGrid);
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === this.tool));
    $('color-chip').style.background = colorToCss(this.color);
  }

  updateAll() {
    document.getElementById('doc-info').textContent = `${this.doc.width} × ${this.doc.height} px`;
    this.updateButtons();
  }
}

const app = new App();
window.pixelApp = app; // zum Debuggen
app.init();
