// Pixel-Werkstatt – Einstiegspunkt. Verbindet Dokument, Ansicht, Werkzeuge und UI.

import { createDocument, currentLayer, currentFrame, allLayers, packColor, scaleNearest, compositeFrame } from './document.js';
import { History } from './history.js';
import { Stroke, floodFill } from './tools.js';
import { ColorPicker, colorToCss, colorToHex, parseHex, sameColor } from './colorpicker.js';
import { CanvasView } from './view.js';
import { listProjects, loadProject, saveProject, getValue, setValue, migrateLegacy, newProjectId } from './storage.js';
import { newImageDialog, resizeDialog, exportDialog } from './dialogs.js';
import { openLayersDialog } from './layerpanel.js';
import { openProjectsDialog } from './projects.js';
import { FrameBar } from './framebar.js';
import { change } from './layers.js';
import { importImageFile, loadRefBitmaps, addReference, fitRef, sampleRef, refParams, RefTransform, createRefBar } from './reference.js';
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
    this.settings = { recentColors: [], showGrid: true };
    this.project = null; // { id, name, exportName }
    this.history = new History(() => this.updateButtons());
    this.stroke = null;
    this.saveTimer = null;
  }

  async init() {
    try {
      await migrateLegacy();
      Object.assign(this.settings, (await getValue('settings')) || {});
      this.color = (await getValue('color')) || this.color;
      this.tool = (await getValue('tool')) || this.tool;
      const currentId = await getValue('currentProject');
      const loaded = currentId && (await loadProject(currentId));
      if (loaded) {
        this.doc = loaded.doc;
        this.project = loaded.meta;
      }
    } catch (err) {
      console.error('Speicher konnte nicht gelesen werden', err);
    }
    if (!this.project) this.project = { id: newProjectId(), name: 'Neues Sprite' };
    this.buildUI();
    this.view = new CanvasView(document.getElementById('canvas'), {
      getDoc: () => this.doc,
      onStrokeStart: (p) => this.strokeStart(p),
      onStrokeMove: (p) => this.strokeMove(p),
      onStrokeEnd: () => this.strokeEnd(),
      onStrokeCancel: () => this.strokeCancel(),
    });
    this.view.showGrid = this.settings.showGrid !== false;
    this.view.onion = !!this.settings.onion;
    this.frameBar = new FrameBar(this, document.getElementById('frame-bar'));
    loadRefBitmaps(this.doc).then(() => this.view.invalidate());
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
    if (layer.ref) {
      toast('Das ist die Vorlage – zum Zeichnen eine normale Ebene wählen.');
      return;
    }
    if (!layer.visible) {
      toast(`„${layer.name}“ ist ausgeblendet – zum Zeichnen erst einblenden.`);
      return;
    }
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
      if (currentLayer(this.doc).ref) {
        toast('Das ist die Vorlage – zum Füllen eine normale Ebene wählen.');
        return;
      }
      if (!currentLayer(this.doc).visible) {
        toast('Die Ebene ist ausgeblendet – zum Füllen erst einblenden.');
        return;
      }
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
    this.frameBar.refreshCurrent();
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
    if (this.picked.a === 0) {
      // Nichts gezeichnet: Farbe aus einer sichtbaren Vorlage nehmen (oberste zuerst)
      for (const layer of [...currentFrame(this.doc).layers].reverse()) {
        const c = layer.ref && layer.visible && sampleRef(layer, p.x + 0.5, p.y + 0.5);
        if (c) { this.picked = c; break; }
      }
    }
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

  /** Ein anderes Dokument anzeigen (Projektwechsel). */
  showDocument(doc, meta) {
    this.endRefTransform(false);
    this.doc = doc;
    this.project = meta;
    this.stroke = null;
    this.history.clear();
    this.view.fit();
    this.view.invalidate();
    this.updateAll();
    loadRefBitmaps(doc).then(() => this.view.invalidate());
  }

  // ---------- Vorlagen ----------

  pickReferenceImage() {
    const input = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      try {
        const img = await importImageFile(file);
        let layer;
        const entry = change(this.doc, () => { layer = addReference(this.doc, img); });
        this.commitStructure(entry);
        this.startRefTransform(layer);
      } catch (err) {
        toast(`Bild konnte nicht geladen werden: ${err?.message || err}`, 5000);
      }
    });
    document.body.append(input);
    input.click();
  }

  startRefTransform(layer) {
    this.endRefTransform(false);
    if (!layer.visible) layer.visible = true;
    const apply = (params) => {
      Object.assign(layer.ref, params);
      this.view.requestRender();
      this.refBar?.update();
      this.scheduleSave();
    };
    const overlay = new RefTransform(layer, {
      onChange: () => this.refBar?.update(),
      onCommit: (before, after) => {
        this.history.push({ undo: () => apply(before), redo: () => apply(after) });
        this.scheduleSave();
      },
    });
    const commitParams = (fn) => {
      const before = refParams(layer.ref);
      fn();
      overlay.onCommit(before, refParams(layer.ref));
      this.view.requestRender();
      this.refBar.update();
    };
    this.refBar = createRefBar({
      overlay,
      onRender: () => this.view.requestRender(),
      onFit: () => commitParams(() => fitRef(layer.ref, this.doc.width, this.doc.height)),
      onResetCrop: () => commitParams(() => {
        const r = layer.ref;
        const kx = r.w / r.sw, ky = r.h / r.sh;
        Object.assign(r, { x: r.x - r.sx * kx, y: r.y - r.sy * ky, w: r.imgW * kx, h: r.imgH * ky, sx: 0, sy: 0, sw: r.imgW, sh: r.imgH });
      }),
      onDone: () => this.endRefTransform(),
    });
    document.body.append(this.refBar.bar);
    document.body.classList.add('ref-editing');
    this.view.overlay = overlay;
    this.view.invalidate();
  }

  endRefTransform(save = true) {
    if (!this.refBar) return;
    this.refBar.bar.remove();
    this.refBar = null;
    document.body.classList.remove('ref-editing');
    this.view.overlay = null;
    this.view.invalidate();
    this.updateAll();
    if (save) this.scheduleSave();
  }

  async newProject(w, hh, name) {
    await this.saveNow();
    this.showDocument(createDocument(w, hh), { id: newProjectId(), name });
    await this.saveNow();
  }

  /** Übernimmt ein importiertes Dokument als neues Projekt. */
  async adoptProject(name, doc) {
    await this.saveNow();
    this.showDocument(doc, { id: newProjectId(), name });
    await this.saveNow();
  }

  async openProject(id) {
    await this.saveNow();
    const loaded = await loadProject(id);
    if (!loaded) return;
    this.showDocument(loaded.doc, loaded.meta);
    await this.saveNow();
  }

  /** Nach dem Löschen des offenen Projekts: neuestes öffnen oder ein leeres anlegen. */
  async openFirstOrNew() {
    const [first] = await listProjects();
    if (first) {
      const loaded = await loadProject(first.id);
      this.showDocument(loaded.doc, loaded.meta);
    } else {
      this.showDocument(createDocument(64, 64), { id: newProjectId(), name: 'Neues Sprite' });
    }
    await this.saveNow();
  }

  /** Strukturänderung (Ebenen) in den Verlauf legen und anzeigen. */
  commitStructure(entry) {
    this.history.push(entry);
    this.view.invalidate();
    this.updateAll();
    this.scheduleSave();
  }

  undoRedo(which) {
    this.history[which]();
    this.view.invalidate();
    this.updateAll();
    this.scheduleSave();
  }

  layerSelected() {
    this.updateAll();
    this.scheduleSave();
  }

  resizeDocument(w, hh) {
    const doc = this.doc;
    const oldW = doc.width, oldH = doc.height;
    const layers = allLayers(doc);
    const before = layers.map((l) => l.data);
    const after = layers.map((l) => scaleNearest(l.data, oldW, oldH, w, hh));
    const fx = w / oldW, fy = hh / oldH;
    const refsBefore = layers.map((l) => l.ref && refParams(l.ref));
    const refsAfter = layers.map((l) => l.ref && { ...refParams(l.ref), x: l.ref.x * fx, y: l.ref.y * fy, w: l.ref.w * fx, h: l.ref.h * fy });
    const apply = (width, height, datas) => {
      doc.width = width;
      doc.height = height;
      const refs = datas === after ? refsAfter : refsBefore;
      layers.forEach((l, i) => {
        l.data = datas[i];
        if (l.ref) Object.assign(l.ref, refs[i]);
      });
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

  /** Speichert Projekt und Einstellungen. Mehrfachaufrufe laufen nacheinander. */
  saveNow() {
    clearTimeout(this.saveTimer);
    if (this.view) this.settings.showGrid = this.view.showGrid;
    const job = async () => {
      this.project = await saveProject({ ...this.project, thumb: this.makeThumb() }, this.doc);
      await Promise.all([
        setValue('currentProject', this.project.id),
        setValue('settings', this.settings),
        setValue('color', this.color),
        setValue('tool', this.tool),
      ]);
    };
    this.saving = (this.saving || Promise.resolve()).then(job).catch((err) => console.error('Speichern fehlgeschlagen', err));
    return this.saving;
  }

  makeThumb() {
    const { width, height } = this.doc;
    const src = document.createElement('canvas');
    src.width = width;
    src.height = height;
    src.getContext('2d').putImageData(new ImageData(compositeFrame(this.doc, this.doc.frames[0]), width, height), 0, 0);
    const scale = Math.max(1, Math.floor(96 / Math.max(width, height)));
    const out = document.createElement('canvas');
    out.width = Math.min(96, width * scale);
    out.height = Math.min(96, height * scale);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = width * scale > 96 || height * scale > 96;
    const f = Math.min(out.width / width, out.height / height);
    ctx.drawImage(src, 0, 0, width * f, height * f);
    return out.toDataURL('image/png');
  }

  // ---------- Oberfläche ----------

  buildUI() {
    const $ = (id) => document.getElementById(id);
    $('btn-menu').append(icon('menu'));
    $('btn-undo').append(icon('undo'));
    $('btn-redo').append(icon('redo'));
    $('btn-grid').append(icon('grid'));
    $('btn-fit').append(icon('fit'));
    $('btn-layers').append(icon('layers'));
    $('btn-layers').addEventListener('click', () => openLayersDialog(this));
    $('doc-info').addEventListener('click', () => openProjectsDialog(this));
    for (const t of ['pen', 'eraser', 'fill', 'picker']) document.querySelector(`[data-tool="${t}"]`).prepend(icon(t));

    $('btn-undo').addEventListener('click', () => this.undoRedo('undo'));
    $('btn-redo').addEventListener('click', () => this.undoRedo('redo'));
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
        this.undoRedo(e.shiftKey ? 'redo' : 'undo');
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
        item('folder', 'Projekte …', () => openProjectsDialog(this)),
        item('plus', 'Neues Projekt …', () => newImageDialog(this)),
        item('layers', 'Ebenen …', () => openLayersDialog(this)),
        item('image', 'Vorlage-Bild einfügen …', () => this.pickReferenceImage()),
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
    const layer = currentLayer(this.doc);
    document.getElementById('doc-name').textContent = this.project.name;
    const frames = this.doc.frames.length > 1 ? ` · F${this.doc.frameIndex + 1}/${this.doc.frames.length}` : ' px';
    document.getElementById('doc-size').textContent =
      `${this.doc.width}×${this.doc.height}${frames} · ${layer.name}${layer.visible ? '' : ' (aus)'}`;
    this.frameBar?.render();
    this.updateButtons();
  }
}

const app = new App();
window.pixelApp = app; // zum Debuggen
app.init();
