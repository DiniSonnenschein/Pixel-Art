// Speicher im App-Speicher (IndexedDB): mehrere Projekte, globale Einstellungen.
// Jedes Projekt hat einen kleinen Metadaten-Eintrag (für die Liste) und
// einen Dateneintrag mit allen Pixeln.

import { createLayer } from './document.js';

const DB_NAME = 'pixel-werkstatt';
const LEGACY = 'autosave'; // Schritt 1/2: nur ein Bild
const META = 'projectMeta';
const DATA = 'projectData';
const KV = 'kv';

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of [LEGACY, META, DATA, KV]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const result = fn(...[stores].flat().map((s) => t.objectStore(s)));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function serialize(doc) {
  return {
    version: 2,
    width: doc.width,
    height: doc.height,
    frameIndex: doc.frameIndex,
    layerIndex: doc.layerIndex,
    frames: doc.frames.map((f) => ({
      layers: f.layers.map((l) => ({
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        data: l.data.slice().buffer,
      })),
    })),
  };
}

export function deserialize(saved) {
  const { width, height } = saved;
  return {
    width,
    height,
    frameIndex: saved.frameIndex || 0,
    layerIndex: saved.layerIndex || 0,
    frames: saved.frames.map((f) => ({
      layers: f.layers.map((l) => {
        const layer = createLayer(width, height, l.name);
        layer.visible = l.visible;
        layer.opacity = l.opacity;
        layer.data.set(new Uint8ClampedArray(l.data));
        return layer;
      }),
    })),
  };
}

export function newProjectId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- Projekte ----------

export function listProjects() {
  return tx(META, 'readonly', (s) => s.getAll()).then((list) => list.sort((a, b) => b.updated - a.updated));
}

export function saveProject(meta, doc) {
  const m = { ...meta, width: doc.width, height: doc.height, updated: Date.now() };
  return tx([META, DATA], 'readwrite', (ms, ds) => {
    ms.put(m, m.id);
    ds.put(serialize(doc), m.id);
  }).then(() => m);
}

export function saveProjectMeta(meta) {
  return tx(META, 'readwrite', (s) => s.put(meta, meta.id));
}

export async function loadProject(id) {
  const [meta, data] = await Promise.all([
    tx(META, 'readonly', (s) => s.get(id)),
    tx(DATA, 'readonly', (s) => s.get(id)),
  ]);
  if (!meta || !data) return null;
  return { meta, doc: deserialize(data) };
}

export function deleteProject(id) {
  return tx([META, DATA], 'readwrite', (ms, ds) => {
    ms.delete(id);
    ds.delete(id);
  });
}

// ---------- Einstellungen ----------

export function getValue(key) {
  return tx(KV, 'readonly', (s) => s.get(key)).catch(() => undefined);
}

export function setValue(key, value) {
  return tx(KV, 'readwrite', (s) => s.put(value, key));
}

/** Übernimmt das Einzelbild aus Schritt 1/2 einmalig als erstes Projekt. */
export async function migrateLegacy() {
  const old = await tx(LEGACY, 'readonly', (s) => s.get('current')).catch(() => null);
  if (!old) return null;
  const meta = { id: newProjectId(), name: 'Mein erstes Bild', exportName: old.settings?.exportName || 'sprite' };
  const saved = await saveProject(meta, deserialize(old));
  if (old.settings) await setValue('settings', { recentColors: old.settings.recentColors || [], showGrid: old.settings.showGrid });
  if (old.color) await setValue('color', old.color);
  await setValue('currentProject', saved.id);
  await tx(LEGACY, 'readwrite', (s) => s.delete('current'));
  return saved;
}

// ---------- Projektdatei (.pxw) zum Sichern außerhalb der App ----------

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export const PROJECT_EXT = 'pxw';

export async function encodeProjectFile(name, doc) {
  const s = serialize(doc);
  const json = JSON.stringify({
    format: 'pixel-werkstatt',
    ...s,
    name,
    frames: s.frames.map((f) => ({
      layers: f.layers.map((l) => ({ ...l, data: toBase64(new Uint8Array(l.data)) })),
    })),
  });
  return pipe(new TextEncoder().encode(json), new CompressionStream('gzip'));
}

export async function decodeProjectFile(bytes) {
  let text;
  try {
    text = new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));
  } catch {
    text = new TextDecoder().decode(bytes); // unkomprimiert
  }
  const obj = JSON.parse(text);
  if (obj.format !== 'pixel-werkstatt') throw new Error('Keine Pixel-Werkstatt-Projektdatei');
  const size = obj.width * obj.height * 4;
  obj.frames = obj.frames.map((f) => ({
    layers: f.layers.map((l) => {
      const data = fromBase64(l.data);
      if (data.length !== size) throw new Error('Projektdatei ist beschädigt');
      return { ...l, data: data.buffer };
    }),
  }));
  return { name: obj.name || 'Importiert', doc: deserialize(obj) };
}
