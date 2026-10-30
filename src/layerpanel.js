// Ebenen-Fenster: Liste (oberste Ebene oben), Sichtbarkeit, Deckkraft und Aktionen.

import { currentFrame } from './document.js';
import * as L from './layers.js';
import { h, icon, openDialog, promptDialog, confirmDialog, toast } from './ui.js';

function thumbnail(layer, width, height) {
  // Auf 44 px Kantenlänge hochskalieren, Seitenverhältnis bleibt erhalten
  const f = 44 / Math.max(width, height);
  const c = h('canvas', { class: 'layer-thumb', width, height, style: `width:${width * f}px;height:${height * f}px` });
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(layer.data), width, height), 0, 0);
  return c;
}

export function openLayersDialog(app) {
  const list = h('div', { class: 'layer-list' });
  const opacityLabel = h('span', {});
  const opacity = h('input', { type: 'range', min: 0, max: 100, step: 1, class: 'slider' });
  const actions = h('div', { class: 'layer-actions' });
  let opacityEntry = null;

  // Änderung ausführen, im Verlauf ablegen und alles neu anzeigen
  const run = (fn) => {
    let ok = true;
    const entry = L.change(app.doc, () => { ok = fn() !== false; });
    if (ok) app.commitStructure(entry);
    render();
    return ok;
  };

  const actionBtn = (ic, label, fn, disabled = false) =>
    h('button', { class: 'layer-action', disabled, onClick: fn }, icon(ic), h('span', {}, label));

  function render() {
    const doc = app.doc;
    const layers = currentFrame(doc).layers;
    list.replaceChildren(...layers.map((layer, i) => ({ layer, i })).reverse().map(({ layer, i }) =>
      h('div', {
        class: `layer-row${i === doc.layerIndex ? ' active' : ''}${layer.visible ? '' : ' hidden-layer'}`,
        onClick: () => { doc.layerIndex = i; app.layerSelected(); render(); },
      },
        h('button', {
          class: 'icon-btn eye',
          'aria-label': layer.visible ? 'Ausblenden' : 'Einblenden',
          onClick: (e) => {
            e.stopPropagation();
            run(() => L.setLayerProps(doc, i, { visible: !layer.visible }));
          },
        }, icon(layer.visible ? 'eye' : 'eyeOff')),
        h('span', { class: 'thumb-bg' }, thumbnail(layer, doc.width, doc.height)),
        h('span', { class: 'layer-name' }, layer.name),
        layer.opacity < 1 ? h('span', { class: 'layer-op' }, `${Math.round(layer.opacity * 100)} %`) : null,
      ),
    ));

    const cur = layers[doc.layerIndex];
    opacity.value = Math.round(cur.opacity * 100);
    opacityLabel.textContent = `Deckkraft „${cur.name}“: ${opacity.value} %`;

    const count = layers.length;
    actions.replaceChildren(
      actionBtn('plus', 'Neu', () => run(() => L.addLayer(doc))),
      actionBtn('copy', 'Kopie', () => run(() => L.duplicateLayer(doc))),
      actionBtn('up', 'Hoch', () => run(() => L.moveLayer(doc, 1)), doc.layerIndex >= count - 1),
      actionBtn('down', 'Runter', () => run(() => L.moveLayer(doc, -1)), doc.layerIndex === 0),
      actionBtn('merge', 'Vereinen', () => run(() => L.mergeDown(doc)), doc.layerIndex === 0),
      actionBtn('edit', 'Name', async () => {
        const name = await promptDialog('Ebene umbenennen', cur.name);
        if (name) run(() => L.setLayerProps(doc, doc.layerIndex, { name }));
      }),
      actionBtn('trash', 'Löschen', async () => {
        if (count <= 1) {
          toast('Die letzte Ebene kann nicht gelöscht werden.');
          return;
        }
        if (await confirmDialog('Ebene löschen', `„${cur.name}“ löschen? (Rückgängig ist möglich.)`, 'Löschen', 'danger')) {
          run(() => L.deleteLayer(doc));
        }
      }, count <= 1),
    );
  }

  // Deckkraft live anzeigen, beim Loslassen als ein Schritt in den Verlauf
  opacity.addEventListener('input', () => {
    const doc = app.doc;
    if (!opacityEntry) opacityEntry = { index: doc.layerIndex, before: currentFrame(doc).layers[doc.layerIndex].opacity };
    L.setLayerProps(doc, opacityEntry.index, { opacity: opacity.value / 100 });
    opacityLabel.textContent = `Deckkraft „${currentFrame(doc).layers[doc.layerIndex].name}“: ${opacity.value} %`;
    app.view.invalidate();
  });
  opacity.addEventListener('change', () => {
    if (!opacityEntry) return;
    const doc = app.doc, { index, before } = opacityEntry;
    const after = opacity.value / 100;
    opacityEntry = null;
    L.setLayerProps(doc, index, { opacity: before });
    run(() => L.setLayerProps(doc, index, { opacity: after }));
  });

  render();
  openDialog({
    title: 'Ebenen',
    body: h('div', {},
      list,
      h('div', { class: 'opacity-row' }, opacityLabel, opacity),
      actions,
      h('p', { class: 'hint' }, 'Gezeichnet wird immer auf der markierten Ebene. Unten in der Liste = ganz hinten im Bild.')),
  });
}
