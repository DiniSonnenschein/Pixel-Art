// Dialoge: Neues Projekt, Leinwandgröße ändern, PNG-Export.

import { MAX_SIZE, MIN_SIZE, isCleanScale, compositeFrame, currentFrame, scaleNearest } from './document.js';
import { encodePNG } from './png.js';
import { saveFile, shareFiles, fileExists, sanitizeName } from './exporter.js';
import { buildStrip } from './frames.js';
import { h, openDialog, confirmDialog, numberField, toast } from './ui.js';

const PRESETS = [[16, 16], [32, 32], [64, 64], [128, 128], [256, 256], [32, 64], [64, 32], [64, 128], [128, 64]];

function clampSize(v) {
  return Number.isFinite(v) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, v)) : null;
}

function sizeFields(w, h0) {
  const wf = numberField('Breite (px)', w, MIN_SIZE, MAX_SIZE);
  const hf = numberField('Höhe (px)', h0, MIN_SIZE, MAX_SIZE);
  const row = h('div', { class: 'field-row' }, wf.wrap, h('span', { class: 'times' }, '×'), hf.wrap);
  return { wf, hf, row };
}

export function newImageDialog(app) {
  const { wf, hf, row } = sizeFields(app.doc.width, app.doc.height);
  const nameInput = h('input', { type: 'text', value: 'Neues Sprite', spellcheck: 'false' });
  const presets = h('div', { class: 'chips' },
    PRESETS.map(([pw, ph]) =>
      h('button', {
        class: 'chip',
        onClick: () => { wf.input.value = pw; hf.input.value = ph; },
      }, `${pw}×${ph}`),
    ),
  );
  openDialog({
    title: 'Neues Projekt',
    body: h('div', {}, h('label', { class: 'field wide' }, h('span', {}, 'Name'), nameInput), row, h('p', { class: 'hint' }, 'Breite und Höhe sind unabhängig – tippe einfach eigene Werte ein. Schnellauswahl:'), presets,
      h('p', { class: 'hint' }, 'Das aktuelle Projekt bleibt gespeichert – du findest es unter „Projekte“.')),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Erstellen',
        kind: 'primary',
        onClick: () => {
          const w = clampSize(wf.value), hh = clampSize(hf.value);
          if (!w || !hh) {
            toast('Bitte gültige Größe eingeben.');
            return false;
          }
          app.newProject(w, hh, nameInput.value.trim() || 'Neues Sprite');
        },
      },
    ],
  });
}

export function resizeDialog(app) {
  const doc = app.doc;
  const { wf, hf, row } = sizeFields(doc.width, doc.height);
  const lock = h('input', { type: 'checkbox' });
  const info = h('p', { class: 'hint' });
  const ratio = doc.width / doc.height;

  const update = () => {
    const w = wf.value, hh = hf.value;
    if (!w || !hh) { info.textContent = ''; return; }
    const clean = isCleanScale(doc.width, w) && isCleanScale(doc.height, hh);
    info.className = clean ? 'hint' : 'hint warn';
    info.textContent = clean
      ? 'Der Inhalt wird mitskaliert. Jeder Pixel bleibt gleichmäßig.'
      : 'Achtung: Bei diesem Faktor werden manche Pixel doppelt, andere einfach dargestellt – die Pixelart wirkt ungleichmäßig. Sauber sind ganze Vielfache (z. B. 2×) oder Teiler (z. B. ½).';
  };
  wf.input.addEventListener('input', () => {
    if (lock.checked && wf.value > 0) hf.input.value = Math.max(1, Math.round(wf.value / ratio));
    update();
  });
  hf.input.addEventListener('input', () => {
    if (lock.checked && hf.value > 0) wf.input.value = Math.max(1, Math.round(hf.value * ratio));
    update();
  });
  update();

  openDialog({
    title: 'Leinwandgröße ändern',
    body: h('div', {},
      h('p', { class: 'hint' }, `Aktuell: ${doc.width} × ${doc.height} px`),
      row,
      h('label', { class: 'check' }, lock, h('span', {}, 'Seitenverhältnis beibehalten')),
      info),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Übernehmen',
        kind: 'primary',
        onClick: () => {
          const w = clampSize(wf.value), hh = clampSize(hf.value);
          if (!w || !hh) {
            toast('Bitte gültige Größe eingeben.');
            return false;
          }
          if (w !== doc.width || hh !== doc.height) app.resizeDocument(w, hh);
        },
      },
    ],
  });
}

export function exportDialog(app) {
  const doc = app.doc;
  const n = doc.frames.length;
  const name = h('input', { type: 'text', value: app.project.exportName || sanitizeName(app.project.name), autocapitalize: 'off', spellcheck: 'false' });
  let factor = 1;
  let mode = n > 1 ? 'strip' : 'frame';
  const info = h('p', { class: 'hint' });

  const chipRow = (options, current, onPick) => {
    const row = h('div', { class: 'chips' });
    for (const [value, label] of options) {
      const b = h('button', {
        class: `chip${value === current ? ' active' : ''}`,
        onClick: () => {
          row.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
          onPick(value);
          update();
        },
      }, label);
      row.append(b);
    }
    return row;
  };

  // Dateinamen je nach Variante; GameMaker zerlegt "name_stripN.png" beim Import automatisch
  const fileNames = () => {
    const base = sanitizeName(name.value);
    if (mode === 'strip') return [`${base}_strip${n}.png`];
    if (mode === 'frames') return doc.frames.map((_, i) => `${base}_${i}.png`);
    return [n > 1 ? `${base}_${doc.frameIndex}.png` : `${base}.png`];
  };

  const update = () => {
    const w = doc.width * factor, hh = doc.height * factor;
    const names = fileNames();
    const size = mode === 'strip' ? `${w * n} × ${hh}` : `${w} × ${hh}`;
    info.textContent = mode === 'frames'
      ? `${n} Dateien (${names[0]} … ${names[n - 1]}), je ${size} px.`
      : `Datei: ${names[0]} · ${size} px.`;
    info.textContent += ' Transparente Bereiche bleiben transparent.';
  };

  const framePixels = (frame) => {
    let px = compositeFrame(doc, frame);
    if (factor > 1) px = scaleNearest(px, doc.width, doc.height, doc.width * factor, doc.height * factor);
    return px;
  };

  const build = async () => {
    app.project.exportName = sanitizeName(name.value);
    app.scheduleSave();
    const names = fileNames();
    const w = doc.width * factor, hh = doc.height * factor;
    if (mode === 'strip') {
      const strip = buildStrip(doc);
      const px = factor > 1 ? scaleNearest(strip.pixels, strip.width, strip.height, strip.width * factor, strip.height * factor) : strip.pixels;
      return [{ fileName: names[0], bytes: await encodePNG(strip.width * factor, strip.height * factor, px) }];
    }
    if (mode === 'frames') {
      return Promise.all(doc.frames.map(async (f, i) => ({ fileName: names[i], bytes: await encodePNG(w, hh, framePixels(f)) })));
    }
    return [{ fileName: names[0], bytes: await encodePNG(w, hh, framePixels(currentFrame(doc))) }];
  };

  name.addEventListener('input', update);
  update();

  openDialog({
    title: 'Als PNG exportieren',
    body: h('div', {},
      h('label', { class: 'field wide' }, h('span', {}, 'Name'), name),
      n > 1 ? h('p', { class: 'hint' }, 'Was exportieren?') : null,
      n > 1 ? chipRow([['strip', `Streifen (${n} Frames)`], ['frames', 'Einzelbilder'], ['frame', `Nur Frame ${doc.frameIndex + 1}`]], mode, (v) => { mode = v; }) : null,
      h('p', { class: 'hint' }, 'Größe:'),
      chipRow([[1, '1× Original'], [2, '2×'], [4, '4×'], [8, '8×']], 1, (v) => { factor = v; }),
      info,
      n > 1
        ? h('p', { class: 'hint' }, `GameMaker: Den Streifen einfach importieren – an „_strip${n}“ erkennt GameMaker die ${n} Frames automatisch. Danach im Sprite-Editor ${doc.fps} FPS einstellen. Für GameMaker immer „1× Original“ nehmen.`)
        : h('p', { class: 'hint' }, '„1× Original“ ist Pixel für Pixel genau dein Bild – das brauchst du für GameMaker.')),
    actions: [
      {
        label: 'Teilen …',
        onClick: async () => {
          try {
            await shareFiles(await build());
          } catch (err) {
            if (!/cancel/i.test(String(err?.message))) toast(`Teilen fehlgeschlagen: ${err?.message || err}`);
          }
        },
      },
      {
        label: 'Speichern',
        kind: 'primary',
        onClick: async () => {
          try {
            const files = await build();
            const existing = [];
            for (const f of files) if (await fileExists(f.fileName)) existing.push(f.fileName);
            if (existing.length) {
              const what = existing.length === 1 ? `„${existing[0]}“ gibt es schon.` : `${existing.length} dieser Dateien gibt es schon.`;
              const ok = await confirmDialog('Datei existiert bereits', `${what} Überschreiben?`, 'Überschreiben', 'danger');
              if (!ok) return false;
            }
            let where = '';
            for (const f of files) where = await saveFile(f.fileName, f.bytes);
            toast(files.length === 1 ? `Gespeichert: ${where}/${files[0].fileName}` : `${files.length} Bilder gespeichert in ${where}`, 4000);
          } catch (err) {
            toast(`Speichern fehlgeschlagen: ${err?.message || err}. Versuch es über „Teilen“.`, 5000);
            return false;
          }
        },
      },
    ],
  });
}
