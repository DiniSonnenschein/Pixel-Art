// Speichern und Teilen von Dateien. In der Android-App landen PNGs in
// "Dokumente/Pixel-Werkstatt", im Browser (zum Testen) als Download.

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FilePicker } from '@capawesome/capacitor-file-picker';

export const EXPORT_FOLDER = 'Pixel-Werkstatt';
const isNative = Capacitor.isNativePlatform();

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function sanitizeName(name) {
  const clean = name.trim().replace(/\.png$/i, '').replace(/[\\/:*?"<>|]+/g, '_');
  return clean || 'sprite';
}

export async function fileExists(fileName) {
  if (!isNative) return false;
  try {
    await Filesystem.stat({ path: `${EXPORT_FOLDER}/${fileName}`, directory: Directory.Documents });
    return true;
  } catch {
    return false;
  }
}

/** @returns Beschreibung, wo die Datei gelandet ist. */
export async function saveFile(fileName, bytes, mime = 'image/png') {
  if (!isNative) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'Downloads';
  }
  try {
    const perm = await Filesystem.checkPermissions();
    if (perm.publicStorage !== 'granted') await Filesystem.requestPermissions();
  } catch {
    // Ab Android 11 nicht nötig
  }
  await Filesystem.writeFile({
    path: `${EXPORT_FOLDER}/${fileName}`,
    data: toBase64(bytes),
    directory: Directory.Documents,
    recursive: true,
  });
  return `Dokumente/${EXPORT_FOLDER}`;
}

export function shareFile(fileName, bytes, mime = 'image/png') {
  return shareFiles([{ fileName, bytes }], mime);
}

/** Teilt eine oder mehrere Dateien über das Android-Teilen-Menü. */
export async function shareFiles(files, mime = 'image/png') {
  if (!isNative) {
    const list = files.map((f) => new File([f.bytes], f.fileName, { type: mime }));
    if (navigator.canShare && navigator.canShare({ files: list })) {
      await navigator.share({ files: list });
    } else {
      for (const f of files) await saveFile(f.fileName, f.bytes, mime);
    }
    return;
  }
  const uris = [];
  for (const f of files) {
    const written = await Filesystem.writeFile({
      path: `share/${f.fileName}`,
      data: toBase64(f.bytes),
      directory: Directory.Cache,
      recursive: true,
    });
    uris.push(written.uri);
  }
  await Share.share({ title: files.length === 1 ? files[0].fileName : `${files.length} Bilder`, files: uris });
}

function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Lässt eine Datei auswählen und liest sie sofort vollständig ein.
 * In der Android-App übernimmt das die native Auswahl: Über den Web-Dialog
 * verweigert Android bei Galerie-Bildern oft das spätere Lesen
 * ("NotReadableError").
 * @returns {Promise<{ bytes: Uint8Array, mime: string, name: string } | null>} null bei Abbruch
 */
export async function pickFile({ images = false } = {}) {
  if (isNative) {
    try {
      const result = images
        ? await FilePicker.pickImages({ limit: 1, readData: true })
        : await FilePicker.pickFiles({ limit: 1, readData: true });
      const f = result.files[0];
      if (!f || !f.data) return null;
      return { bytes: fromBase64(f.data), mime: f.mimeType || '', name: f.name || '' };
    } catch (err) {
      if (/cancel/i.test(String(err?.message))) return null;
      throw err;
    }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (images) input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      try {
        // sofort lesen, solange die Datei sicher zugänglich ist
        resolve(file ? { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, name: file.name } : null);
      } catch (err) {
        reject(err);
      } finally {
        input.remove();
      }
    });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    document.body.append(input);
    input.click();
  });
}
