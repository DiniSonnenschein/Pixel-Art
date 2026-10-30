// Pixel-Werkstatt – Einstiegspunkt. Verbindet Dokument, Ansicht, Werkzeuge und UI.

import { createDocument, currentLayer, currentFrame, allLayers, packColor, scaleNearest, compositeFrame } from './document.js';
import { History } from './history.js';
import { Stroke, floodFill } from './tools.js';
import { ColorPicker, colorToCss, colorToHex, parseHex, sameColor } from './colorpicker.js';
import { CanvasView } from './view.js';
import { loadAutosave, saveAutosave, deserialize } from './storage.js';
import { newImageDialog, resizeDialog, exportDialog } from './dialogs.js';
import { h, icon, openDialog, toast } from './ui.js';

// Feste Grundpalette zum schnellen Auswählen
const PALETTE = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  '#291814', '#111d35', '#422136', '#125359', '#742f29', '#49333b', '#a28879', '#f3ef7d',
  '#be1250', '#ff6c24', '#a8e72e', '#00b543', '#065ab5', '#754665', '#ff6e59', '#ffffff',
];

const MAX_RECENT = 16;
const hexToColor = parseHex;

class App {
  constructor() {
    this.doc = createDocument(64, 64);
    this.tool = 'pen';
    this.color = hexToColor('#000000');
    this.settings = { exportName: 'sprite', recentColors: [] };
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
    this.strokeTool = this.tool;
    if (this.tool === 'fill') {
      // Erst beim Loslassen füllen – so kann ein zweiter Finger (Zoom) noch abbrechen.
      this.pendingFill = p;
      return;
    }
    if (this.tool === 'picker') {
      this.colorBeforePick = { ...this.color };
      this.pickAt(p);
      return;
    }
    const layer = currentLayer(this.doc);
    const value = this.tool === 'eraser' ? 0 : packColor(this.color);
    this.stroke = new Stroke(layer, this.doc.width, this.doc.height, value);
    this.stroke.to(p.x, p.y);
    this.view.invalidate();
  }

  strokeMove(p) {
    if (this.strokeTool === 'picker') {
      this.pickAt(p);
      return;
    }
    if (!this.stroke) return;
    this.stroke.to(p.x, p.y);
    this.view.invalidate();
  }

  strokeEnd() {
    if (this.strokeTool === 'fill' && this.pendingFill) {
      const p = this.pendingFill;
      this.pendingFill = null;
      const entry = floodFill(currentLayer(this.doc), this.doc.width, this.doc.height, p.x, p.y, packColor(this.color));
      if (entry) this.commit(entry, true);
      return;
    }
    if (this.strokeTool === 'picker') {
      this.finishPick();
      return;
    }
    if (!this.stroke) return;
    const entry = this.stroke.finish();
    const usedColor = this.tool !== 'eraser';
    this.stroke = null;
    if (entry) this.commit(entry, usedColor);
  }

  strokeCancel() {
    this.pendingFill = null;
    if (this.strokeTool === 'picker' && this.colorBeforePick) {
      this.color = this.colorBeforePick;
      this.colorBeforePick = null;
      this.updateButtons();
    }
    if (!this.stroke) return;
    this.stroke.cancel();
    this.stroke = null;
    this.view.invalidate();
  }

  commit(entry, usedColor) {
    this.history.push(entry);
    this.view.invalidate();
    if (usedColor) this.addRecentColor(this.color);
    this.scheduleSave();
  }

  /** Pipette: nimmt die sichtbare Farbe (alle sichtbaren Ebenen zusammen). */
  pickAt(p) {
    const { width, height } = this.doc;
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return;
    const comp = compositeFrame(this.doc, currentFrame(this.doc));
    const i = (p.y * width + p.x) * 4;
    this.picked = { r: comp[i], g: comp[i + 1], b: comp[i + 2], a: comp[i + 3] };
    if (this.picked.a > 0) this.color = { ...this.picked };
    this.updateButtons();
  }

  finishPick() {
    this.colorBeforePick = null;
    if (!this.picked) return;
    if (this.picked.a === 0) {
      this.tool = 'eraser';
      toast('Transparent – Radierer gewählt');
    } else {
      this.tool = 'pen';
      this.addRecentColor(this.color);
      toast(`Farbe übernommen: ${colorToHex(this.color)}`, 1600);
    }
    this.picked = null;
    this.updateButtons();
    this.scheduleSave();
  }

  addRecentColor(color) {
    const list = this.settings.recentColors.filter((c) => !sameColor(c, color));
    list.unshift({ ...color });
    this.settings.recentColors = list.slice(0, MAX_RECENT);
    this.renderRecent();
  }

  setColor(color) {
    this.color = { ...color };
    if (this.tool === 'eraser' || this.tool === 'picker') this.tool = 'pen';
    this.updateButtons();
    this.scheduleSave();
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
    for (const t of ['pen', 'eraser', 'fill', 'picker']) document.querySelector(`[data-tool="${t}"]`).prepend(icon(t));

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
    $('btn-color').addEventListener('click', () => this.openColorDialog());

    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.history.redo(); else this.history.undo();
        this.view.invalidate();
      } else {
        const tool = { b: 'pen', e: 'eraser', g: 'fill', i: 'picker' }[e.key];
        if (tool) { this.tool = tool; this.updateButtons(); }
      }
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

  swatch(color, onPick, active = false) {
    return h('button', {
      class: `swatch-btn${active ? ' active' : ''}`,
      'aria-label': colorToHex(color),
      onClick: () => onPick(color),
    }, h('span', { style: `background:${colorToCss(color)}` }));
  }

  openColorDialog() {
    const original = { ...this.color };
    const preview = h('span', { class: 'preview-new' });
    const picker = new ColorPicker(this.color, (c) => {
      this.color = c;
      preview.style.background = colorToCss(c);
      this.updateButtons();
    });
    const pickFromList = (c) => picker.setColor(c);
    const recent = this.settings.recentColors;
    const body = h('div', {},
      h('div', { class: 'preview-row' },
        h('button', { class: 'preview-old', style: `--c:${colorToCss(original)}`, title: 'Vorherige Farbe', onClick: () => picker.setColor(original) },
          h('span', { style: `background:${colorToCss(original)}` })),
        h('span', { class: 'preview-arrow' }, '→'),
        h('span', { class: 'preview-box' }, preview),
        h('span', { class: 'hint' }, 'Links tippen = alte Farbe zurück')),
      picker.el,
      recent.length ? h('p', { class: 'hint section' }, 'Zuletzt benutzt') : null,
      recent.length ? h('div', { class: 'palette' }, recent.map((c) => this.swatch(c, pickFromList))) : null,
      h('p', { class: 'hint section' }, 'Palette'),
      h('div', { class: 'palette' }, PALETTE.map((hex) => this.swatch(hexToColor(hex), pickFromList))),
    );
    openDialog({
      title: 'Farbe',
      body,
      actions: [{
        label: 'Fertig',
        kind: 'primary',
        onClick: () => {
          if (this.tool === 'eraser' || this.tool === 'picker') this.tool = 'pen';
          this.updateButtons();
          this.scheduleSave();
        },
      }],
    });
    requestAnimationFrame(() => picker.drawAlpha());
  }

  renderRecent() {
    const strip = document.getElementById('recent-strip');
    if (!strip) return;
    strip.replaceChildren(...this.settings.recentColors.map((c) =>
      this.swatch(c, (col) => this.setColor(col), sameColor(c, this.color))));
    strip.hidden = !this.settings.recentColors.length;
  }

  updateButtons() {
    const $ = (id) => document.getElementById(id);
    if (!$('btn-undo')) return;
    $('btn-undo').disabled = !this.history.canUndo;
    $('btn-redo').disabled = !this.history.canRedo;
    $('btn-grid').classList.toggle('active', !!this.view?.showGrid);
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === this.tool));
    $('color-chip').style.background = colorToCss(this.color);
    this.renderRecent();
  }

  updateAll() {
    document.getElementById('doc-info').textContent = `${this.doc.width} × ${this.doc.height} px`;
    this.updateButtons();
  }
}

const app = new App();
window.pixelApp = app; // zum Debuggen
app.init();
