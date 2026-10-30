// Kleine UI-Helfer: Elemente bauen, Dialoge (Bottom-Sheets), Hinweise.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICON_PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  grid: 'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  pen: 'M4 20l1.2-4.8L16 4.4l3.6 3.6L8.8 18.8zM13.5 7l3.5 3.5',
  eraser: 'M8 20h12M5 15.5 14.5 6l5 5-7.5 7.5a2 2 0 0 1-1.4.5H9a2 2 0 0 1-1.4-.6L5 16.9a1 1 0 0 1 0-1.4zM10 10.5l5 5',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  resize: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  export: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  fill: 'm19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11ZM5 2l5 5M2 13h15M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z',
  picker: 'm2 22 1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z',
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`;
  return span;
}

/**
 * Öffnet einen Dialog am unteren Bildschirmrand.
 * actions: [{ label, kind: 'primary'|'secondary'|'danger', onClick }]
 * Gibt onClick ausdrücklich false zurück, bleibt der Dialog offen.
 */
export function openDialog({ title, body, actions = [] }) {
  const backdrop = h('div', { class: 'backdrop' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const sheet = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onClick: close }, icon('close')),
    ),
    h('div', { class: 'sheet-body' }, body),
    actions.length
      ? h('div', { class: 'sheet-actions' },
          actions.map((a) =>
            h('button', {
              class: `btn ${a.kind || 'secondary'}`,
              onClick: async () => {
                if ((await a.onClick?.()) !== false) close();
              },
            }, a.label),
          ),
        )
      : null,
  );
  backdrop.append(sheet);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  return { close, sheet };
}

export function confirmDialog(title, text, okLabel = 'OK', kind = 'primary') {
  return new Promise((resolve) => {
    let answered = false;
    const { sheet } = openDialog({
      title,
      body: h('p', {}, text),
      actions: [
        { label: 'Abbrechen', onClick: () => { answered = true; resolve(false); } },
        { label: okLabel, kind, onClick: () => { answered = true; resolve(true); } },
      ],
    });
    // Schließen über X oder Hintergrund zählt als "Abbrechen"
    new MutationObserver((_, obs) => {
      if (!sheet.isConnected) {
        obs.disconnect();
        if (!answered) resolve(false);
      }
    }).observe(document.body, { childList: true });
  });
}

let toastTimer;
export function toast(text, ms = 2600) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Zahlenfeld für Pixelangaben. */
export function numberField(label, value, min, max) {
  const input = h('input', {
    type: 'number', inputmode: 'numeric', min, max, step: 1, value,
  });
  input.addEventListener('focus', () => input.select());
  const wrap = h('label', { class: 'field' }, h('span', {}, label), input);
  return { wrap, input, get value() { return parseInt(input.value, 10); } };
}
