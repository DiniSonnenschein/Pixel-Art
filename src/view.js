// Leinwand-Ansicht: Darstellung (Zoom, Verschieben, Raster, Transparenz-
// Karomuster) und Touch-Steuerung. Ein Finger zeichnet, zwei Finger zoomen
// und verschieben.

import { compositeFrame, currentFrame } from './document.js';

const MAX_ZOOM = 96; // Bildschirm-Pixel pro Bild-Pixel
const GRID_MIN_ZOOM = 6;
const CANCEL_STROKE_MS = 250; // Zweiter Finger kurz nach dem ersten -> Strich verwerfen

export class CanvasView {
  constructor(canvas, { getDoc, onStrokeStart, onStrokeMove, onStrokeEnd, onStrokeCancel }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getDoc = getDoc;
    this.cb = { onStrokeStart, onStrokeMove, onStrokeEnd, onStrokeCancel };
    this.scale = 8;
    this.offsetX = 0;
    this.offsetY = 0;
    this.showGrid = true;
    this.pointers = new Map();
    this.mode = 'idle'; // idle | draw | gesture | blocked
    this.segments = [];
    this.onionCanvases = [];
    this.onion = false; // Nachbar-Frames blass anzeigen
    this.overlay = null; // z. B. Vorlage anpassen
    this.dirty = true;
    this.checker = this.makeChecker();

    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  makeChecker() {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d');
    g.fillStyle = '#c9c9ce';
    g.fillRect(0, 0, 24, 24);
    g.fillStyle = '#b3b3ba';
    g.fillRect(0, 0, 12, 12);
    g.fillRect(12, 12, 12, 12);
    return this.ctx.createPattern(c, 'repeat');
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const first = !this.cssWidth;
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    if (first) this.fit();
    this.requestRender();
  }

  /** Bild mittig und möglichst groß einpassen. */
  fit() {
    const doc = this.getDoc();
    if (!this.cssWidth || !doc) return;
    const margin = 24;
    const s = Math.min((this.cssWidth - margin) / doc.width, (this.cssHeight - margin) / doc.height);
    this.scale = Math.max(0.25, Math.min(MAX_ZOOM, s >= 1 ? Math.floor(s) : s));
    this.offsetX = (this.cssWidth - doc.width * this.scale) / 2;
    this.offsetY = (this.cssHeight - doc.height * this.scale) / 2;
    this.requestRender();
  }

  invalidate() {
    this.dirty = true;
    this.requestRender();
  }

  requestRender() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.render();
    });
  }

  render() {
    const doc = this.getDoc();
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--canvas-bg') || '#1b1b22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!doc) return;

    if (this.dirty || this.segmentsFor !== doc || this.segmentsSize !== `${doc.width}x${doc.height}`) {
      this.buildSegments(doc);
      this.dirty = false;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = this.offsetX, y = this.offsetY;
    const w = doc.width * this.scale, h = doc.height * this.scale;

    ctx.fillStyle = this.checker;
    ctx.fillRect(x, y, w, h);
    // Onion Skin: vorheriger Frame deutlicher, nächster schwächer
    ctx.imageSmoothingEnabled = false;
    for (const { canvas, alpha } of this.onionCanvases) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(canvas, x, y, w, h);
    }
    ctx.globalAlpha = 1;
    for (const seg of this.segments) {
      if (seg.canvas) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(seg.canvas, x, y, w, h);
      } else if (seg.layer.visible && seg.layer.ref.bitmap && !(this.overlay && this.overlay.layer === seg.layer)) {
        // Vorlage in voller Bildqualität, auf die Leinwand beschnitten
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        this.drawRef(seg.layer, seg.layer.opacity);
        ctx.restore();
      }
    }

    if (this.showGrid && this.scale >= GRID_MIN_ZOOM) this.drawGrid(doc, x, y, w, h, dpr);

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1 / dpr;
    ctx.strokeRect(x - 0.5 / dpr, y - 0.5 / dpr, w + 1 / dpr, h + 1 / dpr);

    if (this.overlay) this.overlay.draw(ctx, this);
  }

  /**
   * Teilt die Ebenen in Abschnitte: aufeinanderfolgende Pixel-Ebenen werden zu
   * einem Bild verrechnet, Vorlage-Ebenen dazwischen einzeln gezeichnet.
   */
  buildSegments(doc) {
    const segments = [];
    let run = [];
    const pool = this.canvasPool || (this.canvasPool = []);
    let used = 0;
    const flush = () => {
      if (!run.length) return;
      const c = pool[used] || (pool[used] = document.createElement('canvas'));
      used++;
      if (c.width !== doc.width || c.height !== doc.height) {
        c.width = doc.width;
        c.height = doc.height;
      }
      const pixels = compositeFrame(doc, { layers: run });
      c.getContext('2d').putImageData(new ImageData(pixels, doc.width, doc.height), 0, 0);
      segments.push({ canvas: c });
      run = [];
    };
    for (const layer of currentFrame(doc).layers) {
      if (layer.ref) {
        flush();
        segments.push({ layer });
      } else {
        run.push(layer);
      }
    }
    flush();
    this.segments = segments;

    this.onionCanvases = [];
    if (this.onion && doc.frames.length > 1) {
      const pool2 = this.onionPool || (this.onionPool = [document.createElement('canvas'), document.createElement('canvas')]);
      [[doc.frameIndex - 1, 0.35], [doc.frameIndex + 1, 0.15]].forEach(([fi, alpha], k) => {
        const frame = doc.frames[fi];
        if (!frame) return;
        const c = pool2[k];
        c.width = doc.width;
        c.height = doc.height;
        c.getContext('2d').putImageData(new ImageData(compositeFrame(doc, frame), doc.width, doc.height), 0, 0);
        this.onionCanvases.push({ canvas: c, alpha });
      });
    }
    this.segmentsFor = doc;
    this.segmentsSize = `${doc.width}x${doc.height}`;
  }

  /** Bildschirm-Rechteck (CSS-px) eines Rechtecks in Bild-Pixeln. */
  toScreenRect(r) {
    return { x: this.offsetX + r.x * this.scale, y: this.offsetY + r.y * this.scale, w: r.w * this.scale, h: r.h * this.scale };
  }

  /** Zeichnet den zugeschnittenen Teil einer Vorlage an ihrer Position. */
  drawRef(layer, alpha) {
    const { ctx } = this;
    const ref = layer.ref;
    const r = this.toScreenRect(ref);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ref.bitmap, ref.sx, ref.sy, ref.sw, ref.sh, r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
  }

  drawGrid(doc, x, y, w, h, dpr) {
    const { ctx } = this;
    const x0 = Math.max(0, Math.floor(-x / this.scale));
    const x1 = Math.min(doc.width, Math.ceil((this.cssWidth - x) / this.scale));
    const y0 = Math.max(0, Math.floor(-y / this.scale));
    const y1 = Math.min(doc.height, Math.ceil((this.cssHeight - y) / this.scale));
    const line = (major) => {
      ctx.beginPath();
      for (let i = x0; i <= x1; i++) {
        if ((i % 8 === 0) !== major) continue;
        const px = Math.round((x + i * this.scale) * dpr) / dpr + 0.5 / dpr;
        ctx.moveTo(px, y);
        ctx.lineTo(px, y + h);
      }
      for (let j = y0; j <= y1; j++) {
        if ((j % 8 === 0) !== major) continue;
        const py = Math.round((y + j * this.scale) * dpr) / dpr + 0.5 / dpr;
        ctx.moveTo(x, py);
        ctx.lineTo(x + w, py);
      }
      ctx.stroke();
    };
    ctx.lineWidth = 1 / dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    line(false);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    line(true);
  }

  // ---------- Eingabe ----------

  localPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  toDocPixel(p) {
    return {
      x: Math.floor((p.x - this.offsetX) / this.scale),
      y: Math.floor((p.y - this.offsetY) / this.scale),
    };
  }

  onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.localPoint(e));

    if (this.pointers.size === 1 && this.mode === 'idle' && this.overlay) {
      this.mode = 'overlay';
      this.drawPointer = e.pointerId;
      this.overlay.down(this.pointers.get(e.pointerId), this);
    } else if (this.pointers.size === 1 && this.mode === 'idle') {
      this.mode = 'draw';
      this.drawPointer = e.pointerId;
      this.strokeStart = performance.now();
      this.cb.onStrokeStart(this.toDocPixel(this.pointers.get(e.pointerId)));
    } else if (this.pointers.size === 2) {
      if (this.mode === 'overlay') this.overlay?.cancel(this);
      if (this.mode === 'draw') {
        if (performance.now() - this.strokeStart < CANCEL_STROKE_MS) this.cb.onStrokeCancel();
        else this.cb.onStrokeEnd();
      }
      this.startGesture();
    }
  }

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (this.mode === 'draw' && e.pointerId === this.drawPointer) {
      for (const ev of events.length ? events : [e]) this.cb.onStrokeMove(this.toDocPixel(this.localPoint(ev)));
    }
    this.pointers.set(e.pointerId, this.localPoint(e));
    if (this.mode === 'overlay' && e.pointerId === this.drawPointer) this.overlay?.move(this.localPoint(e), this);
    if (this.mode === 'gesture') this.updateGesture();
  }

  onUp(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.mode === 'overlay' && e.pointerId === this.drawPointer) {
      if (cancelled) this.overlay?.cancel(this);
      else this.overlay?.up(this);
      this.mode = 'idle';
    } else if (this.mode === 'draw' && e.pointerId === this.drawPointer) {
      if (cancelled) this.cb.onStrokeCancel();
      else this.cb.onStrokeEnd();
      this.mode = 'idle';
    } else if (this.mode === 'gesture') {
      // Erst wieder zeichnen, wenn alle Finger oben sind.
      this.mode = this.pointers.size ? 'blocked' : 'idle';
    } else if (this.mode === 'blocked' && !this.pointers.size) {
      this.mode = 'idle';
    }
  }

  gesturePoints() {
    const [a, b] = [...this.pointers.values()];
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }

  startGesture() {
    this.mode = 'gesture';
    const { mid, dist } = this.gesturePoints();
    this.gesture = {
      dist,
      scale: this.scale,
      // Bildkoordinate unter dem Mittelpunkt der Finger
      anchorX: (mid.x - this.offsetX) / this.scale,
      anchorY: (mid.y - this.offsetY) / this.scale,
    };
  }

  updateGesture() {
    if (this.pointers.size < 2) return;
    const { mid, dist } = this.gesturePoints();
    const g = this.gesture;
    this.scale = clamp(g.scale * (dist / g.dist), 0.25, MAX_ZOOM);
    this.offsetX = mid.x - g.anchorX * this.scale;
    this.offsetY = mid.y - g.anchorY * this.scale;
    this.requestRender();
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.localPoint(e);
    const ax = (p.x - this.offsetX) / this.scale;
    const ay = (p.y - this.offsetY) / this.scale;
    this.scale = clamp(this.scale * Math.exp(-e.deltaY * 0.0015), 0.25, MAX_ZOOM);
    this.offsetX = p.x - ax * this.scale;
    this.offsetY = p.y - ay * this.scale;
    this.requestRender();
  }
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
