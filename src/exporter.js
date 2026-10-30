// Speichern und Teilen von Dateien. In der Android-App landen PNGs in
// "Dokumente/Pixel-Werkstatt", im Browser (zum Testen) als Download.

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

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

export async function shareFile(fileName, bytes, mime = 'image/png') {
  if (!isNative) {
    const file = new File([bytes], fileName, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      await saveFile(fileName, bytes, mime);
    }
    return;
  }
  const written = await Filesystem.writeFile({
    path: `share/${fileName}`,
    data: toBase64(bytes),
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({ title: fileName, files: [written.uri] });
}
