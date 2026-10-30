// Leinwand-Ansicht: Darstellung (Zoom, Verschieben, Raster, Transparenz-
// Karomuster) und Touch-Steuerung. Ein Finger zeichnet, zwei Finger zoomen
// und verschieben.

import { compositeFrame, currentFrame } from './document.js';

const MAX_ZOOM = 96; // Bildschirm-Pixel pro Bild-Pixel
const GRID_MIN_ZOOM = 6;
const CANCEL_STROKE_MS = 250; // Zweiter Finger kurz nach dem ersten -> Strich verwerfen
const TOUCH_SLOP = 8; // So weit (CSS-px) darf der Finger beim Antippen wackeln
const TOUCH_SMOOTHING = 0.45; // 1 = keine Glättung; kleiner = ruhiger, aber träger

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
    this.offscreen = document.createElement('canvas');
    this.composite = null;
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

    if (this.dirty || this.offscreen.width !== doc.width || this.offscreen.height !== doc.height) {
      if (this.offscreen.width !== doc.width || this.offscreen.height !== doc.height) {
        this.offscreen.width = doc.width;
        this.offscreen.height = doc.height;
        this.composite = null;
      }
      this.composite = compositeFrame(doc, currentFrame(doc), this.composite || undefined);
      this.offscreen.getContext('2d').putImageData(new ImageData(this.composite, doc.width, doc.height), 0, 0);
      this.dirty = false;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = this.offsetX, y = this.offsetY;
    const w = doc.width * this.scale, h = doc.height * this.scale;

    ctx.fillStyle = this.checker;
    ctx.fillRect(x, y, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.offscreen, x, y, w, h);

    if (this.showGrid && this.scale >= GRID_MIN_ZOOM) this.drawGrid(doc, x, y, w, h, dpr);

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1 / dpr;
    ctx.strokeRect(x - 0.5 / dpr, y - 0.5 / dpr, w + 1 / dpr, h + 1 / dpr);
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

    if (this.pointers.size === 1 && this.mode === 'idle') {
      this.mode = 'draw';
      this.drawPointer = e.pointerId;
      this.strokeStart = performance.now();
      this.downPoint = this.pointers.get(e.pointerId);
      this.isTouch = e.pointerType === 'touch';
      this.slopPassed = !this.isTouch;
      this.smoothed = { ...this.downPoint };
      this.lastRaw = null;
      this.cb.onStrokeStart(this.toDocPixel(this.downPoint));
    } else if (this.pointers.size === 2) {
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
      for (const ev of events.length ? events : [e]) {
        const p = this.localPoint(ev);
        // Kleines Wackeln beim Aufsetzen soll keine Nachbarpixel einfärben
        if (!this.slopPassed) {
          if (Math.hypot(p.x - this.downPoint.x, p.y - this.downPoint.y) < TOUCH_SLOP) continue;
          this.slopPassed = true;
        }
        // Fingerzittern dämpfen: Position folgt dem Finger etwas weich nach
        if (this.isTouch) {
          this.lastRaw = p;
          this.smoothed.x += (p.x - this.smoothed.x) * TOUCH_SMOOTHING;
          this.smoothed.y += (p.y - this.smoothed.y) * TOUCH_SMOOTHING;
          this.cb.onStrokeMove(this.toDocPixel(this.smoothed));
        } else {
          this.cb.onStrokeMove(this.toDocPixel(p));
        }
      }
    }
    this.pointers.set(e.pointerId, this.localPoint(e));
    if (this.mode === 'gesture') this.updateGesture();
  }

  onUp(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.mode === 'draw' && e.pointerId === this.drawPointer) {
      // Die Glättung hinkt etwas hinterher: Strich bis zur letzten echten Position ziehen
      if (!cancelled && this.lastRaw) this.cb.onStrokeMove(this.toDocPixel(this.lastRaw));
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
