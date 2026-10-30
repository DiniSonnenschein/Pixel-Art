// Dialoge: Neues Projekt, Leinwandgröße ändern, PNG-Export.

import { MAX_SIZE, MIN_SIZE, isCleanScale, compositeFrame, currentFrame, scaleNearest } from './document.js';
import { encodePNG } from './png.js';
import { saveFile, shareFile, fileExists, sanitizeName } from './exporter.js';
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
  const name = h('input', { type: 'text', value: app.project.exportName || sanitizeName(app.project.name), autocapitalize: 'off', spellcheck: 'false' });
  let factor = 1;
  const sizeInfo = h('p', { class: 'hint' });
  const updateInfo = () => {
    sizeInfo.textContent = `Ergebnis: ${doc.width * factor} × ${doc.height * factor} px, transparente Bereiche bleiben transparent.`;
  };
  const scaleChips = h('div', { class: 'chips' },
    [1, 2, 4, 8].map((f) => {
      const b = h('button', {
        class: `chip${f === 1 ? ' active' : ''}`,
        onClick: () => {
          factor = f;
          scaleChips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
          updateInfo();
        },
      }, f === 1 ? '1× Original' : `${f}×`);
      return b;
    }),
  );
  updateInfo();

  const build = async () => {
    const fileName = `${sanitizeName(name.value)}.png`;
    app.project.exportName = sanitizeName(name.value);
    app.scheduleSave();
    let pixels = compositeFrame(doc, currentFrame(doc));
    let w = doc.width, hh = doc.height;
    if (factor > 1) {
      pixels = scaleNearest(pixels, w, hh, w * factor, hh * factor);
      w *= factor;
      hh *= factor;
    }
    return { fileName, bytes: await encodePNG(w, hh, pixels) };
  };

  openDialog({
    title: 'Als PNG exportieren',
    body: h('div', {},
      h('label', { class: 'field wide' }, h('span', {}, 'Dateiname'), h('div', { class: 'suffix' }, name, h('span', {}, '.png'))),
      h('p', { class: 'hint' }, 'Größe:'),
      scaleChips,
      sizeInfo,
      h('p', { class: 'hint' }, '„1× Original“ ist Pixel für Pixel genau dein Bild – das brauchst du für GameMaker.')),
    actions: [
      {
        label: 'Teilen …',
        onClick: async () => {
          try {
            const { fileName, bytes } = await build();
            await shareFile(fileName, bytes);
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
            const { fileName, bytes } = await build();
            if (await fileExists(fileName)) {
              const ok = await confirmDialog('Datei existiert bereits', `„${fileName}“ gibt es schon. Überschreiben?`, 'Überschreiben', 'danger');
              if (!ok) return false;
            }
            const where = await saveFile(fileName, bytes);
            toast(`Gespeichert: ${where}/${fileName}`, 4000);
          } catch (err) {
            toast(`Speichern fehlgeschlagen: ${err?.message || err}. Versuch es über „Teilen“.`, 5000);
            return false;
          }
        },
      },
    ],
  });
}
