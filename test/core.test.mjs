import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { encodePNG } from '../src/png.js';
import { scaleNearest, isCleanScale, compositeFrame, createDocument, createLayer } from '../src/document.js';
import { Stroke } from '../src/tools.js';

// Minimaler PNG-Decoder (nur RGBA, 8 Bit, Filter 0) zum Gegenprüfen
function decode(png) {
  const view = new DataView(png.buffer, png.byteOffset);
  let off = 8, width, height, idat = [];
  while (off < png.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = view.getUint32(off + 8); height = view.getUint32(off + 12); assert.equal(data[9], 6); }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width * 4 + 1)], 0);
    out.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, pixels: out };
}

test('PNG enthält jeden Pixel exakt, auch halbtransparente', async () => {
  const w = 37, h = 23;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i++) px[i] = (i * 7919) % 256;
  const png = await encodePNG(w, h, px);
  const dec = decode(png);
  assert.equal(dec.width, w);
  assert.equal(dec.height, h);
  assert.deepEqual(dec.pixels, new Uint8Array(px));
});

test('PNG mit unkomprimiertem Fallback ist gültig', async () => {
  const saved = globalThis.CompressionStream;
  globalThis.CompressionStream = undefined;
  try {
    const w = 300, h = 300; // > 65535 Bytes -> mehrere Blöcke
    const px = new Uint8ClampedArray(w * h * 4).map((_, i) => i % 251);
    const dec = decode(await encodePNG(w, h, px));
    assert.deepEqual(dec.pixels, new Uint8Array(px));
  } finally {
    globalThis.CompressionStream = saved;
  }
});

test('Nearest-Neighbor verdoppelt jeden Pixel zu 2×2', () => {
  const src = new Uint8ClampedArray([1,2,3,4, 5,6,7,8]); // 2×1
  const out = scaleNearest(src, 2, 1, 4, 2);
  assert.deepEqual([...out], [1,2,3,4, 1,2,3,4, 5,6,7,8, 5,6,7,8, 1,2,3,4, 1,2,3,4, 5,6,7,8, 5,6,7,8]);
  assert.deepEqual([...scaleNearest(out, 4, 2, 2, 1)], [...src]);
});

test('Saubere Skalierungsfaktoren', () => {
  assert.ok(isCleanScale(64, 128));
  assert.ok(isCleanScale(64, 32));
  assert.ok(isCleanScale(64, 64));
  assert.ok(!isCleanScale(64, 100));
  assert.ok(!isCleanScale(64, 48));
});

test('Ebenen werden verrechnet, deckende Pixel bleiben exakt', () => {
  const doc = createDocument(2, 1);
  const top = createLayer(2, 1);
  doc.frames[0].layers.push(top);
  doc.frames[0].layers[0].data.set([10,20,30,255, 0,0,0,0]);
  top.data.set([0,0,0,0, 200,100,50,255]);
  assert.deepEqual([...compositeFrame(doc, doc.frames[0])], [10,20,30,255, 200,100,50,255]);
  top.visible = false;
  assert.deepEqual([...compositeFrame(doc, doc.frames[0])], [10,20,30,255, 0,0,0,0]);
});

test('Strich zieht lückenlose Linie und lässt sich rückgängig machen', () => {
  const layer = createLayer(8, 8);
  const s = new Stroke(layer, 8, 8, 0xff0000ff);
  s.to(0, 0);
  s.to(7, 3);
  s.to(20, 20); // außerhalb wird ignoriert
  const px = new Uint32Array(layer.data.buffer);
  const set = [...px].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  assert.ok(set.length >= 8);
  const entry = s.finish();
  entry.undo();
  assert.ok(px.every((v) => v === 0));
  entry.redo();
  assert.equal([...px].filter(Boolean).length, set.length);
});

test('Fülleimer füllt nur die zusammenhängende Fläche', async () => {
  const { floodFill } = await import('../src/tools.js');
  const layer = createLayer(5, 5);
  const px = new Uint32Array(layer.data.buffer);
  // senkrechte Wand bei x = 2
  for (let y = 0; y < 5; y++) px[y * 5 + 2] = 0xff000000;
  const entry = floodFill(layer, 5, 5, 0, 0, 0xff0000ff);
  assert.equal([...px].filter((v) => v === 0xff0000ff).length, 10);
  assert.equal(px[3], 0, 'rechts der Wand bleibt leer');
  assert.equal(floodFill(layer, 5, 5, 0, 0, 0xff0000ff), null, 'gleiche Farbe -> nichts zu tun');
  entry.undo();
  assert.equal([...px].filter((v) => v === 0xff0000ff).length, 0);
});

test('Farbumrechnung HSV <-> RGB und Hex', async () => {
  const { rgbToHsv, hsvToRgb, parseHex, colorToHex } = await import('../src/colorpicker.js');
  for (const c of [{ r: 255, g: 0, b: 77 }, { r: 18, g: 200, b: 99 }, { r: 0, g: 0, b: 0 }, { r: 128, g: 128, b: 128 }]) {
    const { h, s, v } = rgbToHsv(c);
    assert.deepEqual(hsvToRgb(h, s, v), c);
  }
  assert.deepEqual(parseHex('#ff8000'), { r: 255, g: 128, b: 0, a: 255 });
  assert.deepEqual(parseHex('f80'), { r: 255, g: 136, b: 0, a: 255 });
  assert.deepEqual(parseHex('#FF800080'), { r: 255, g: 128, b: 0, a: 128 });
  assert.equal(parseHex('xyz'), null);
  assert.equal(colorToHex({ r: 255, g: 128, b: 0, a: 255 }), '#FF8000');
  assert.equal(colorToHex({ r: 255, g: 128, b: 0, a: 128 }), '#FF800080');
});

test('Ebenen: anlegen, verschieben, zusammenführen, löschen – alles rückgängig machbar', async () => {
  const L = await import('../src/layers.js');
  const doc = createDocument(2, 1);
  doc.frames.push({ layers: [createLayer(2, 1, 'Ebene 1')] }); // zweiter Frame
  doc.frames[0].layers[0].data.set([255,0,0,255, 0,0,0,0]);
  const e1 = L.change(doc, () => L.addLayer(doc));
  assert.equal(L.layerCount(doc), 2);
  assert.equal(doc.frames[1].layers.length, 2, 'gilt für alle Frames');
  assert.equal(doc.frames[0].layers[1].name, 'Ebene 2');
  assert.equal(doc.layerIndex, 1);
  doc.frames[0].layers[1].data.set([0,0,0,0, 0,255,0,255]);
  const e2 = L.change(doc, () => L.mergeDown(doc));
  assert.equal(L.layerCount(doc), 1);
  assert.deepEqual([...doc.frames[0].layers[0].data], [255,0,0,255, 0,255,0,255]);
  e2.undo();
  assert.equal(L.layerCount(doc), 2);
  assert.deepEqual([...doc.frames[0].layers[0].data], [255,0,0,255, 0,0,0,0]);
  const e3 = L.change(doc, () => L.moveLayer(doc, -1));
  assert.equal(doc.frames[0].layers[0].name, 'Ebene 2');
  e3.undo();
  assert.equal(doc.frames[0].layers[0].name, 'Ebene 1');
  const e4 = L.change(doc, () => L.setLayerProps(doc, 1, { visible: false, opacity: 0.5 }));
  assert.equal(doc.frames[1].layers[1].visible, false);
  e4.undo();
  assert.equal(doc.frames[1].layers[1].visible, true);
  e1.undo();
  assert.equal(L.layerCount(doc), 1);
  assert.equal(L.change(doc, () => assert.equal(L.deleteLayer(doc), false)) !== null, true);
});

test('Projektdatei: Speichern und Laden ergibt exakt dasselbe Bild', async () => {
  const { encodeProjectFile, decodeProjectFile } = await import('../src/storage.js');
  const doc = createDocument(3, 2);
  doc.frames[0].layers.push(createLayer(3, 2, 'Oben'));
  doc.frames[0].layers[1].opacity = 0.4;
  doc.frames[0].layers[1].visible = false;
  doc.frames[0].layers[0].data.forEach((_, i, a) => { a[i] = (i * 37) % 256; });
  const bytes = await encodeProjectFile('Held', doc);
  const { name, doc: back } = await decodeProjectFile(bytes);
  assert.equal(name, 'Held');
  assert.equal(back.width, 3);
  assert.equal(back.frames[0].layers[1].name, 'Oben');
  assert.equal(back.frames[0].layers[1].opacity, 0.4);
  assert.equal(back.frames[0].layers[1].visible, false);
  assert.deepEqual([...back.frames[0].layers[0].data], [...doc.frames[0].layers[0].data]);
  await assert.rejects(decodeProjectFile(new TextEncoder().encode('{"format":"anders"}')));
});
