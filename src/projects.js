// Projekte-Fenster: Liste aller Projekte im App-Speicher, Öffnen, Umbenennen,
// Duplizieren, Löschen sowie Sichern/Öffnen als .pxw-Datei.

import { listProjects, loadProject, saveProject, saveProjectMeta, deleteProject, newProjectId,
  encodeProjectFile, decodeProjectFile, PROJECT_EXT } from './storage.js';
import { saveFile, shareFile, fileExists, sanitizeName } from './exporter.js';
import { newImageDialog } from './dialogs.js';
import { h, icon, openDialog, promptDialog, confirmDialog, toast } from './ui.js';

function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export async function openProjectsDialog(app) {
  await app.saveNow();
  const list = h('div', { class: 'project-list' });

  const render = async () => {
    const projects = await listProjects();
    list.replaceChildren(...projects.map((p) => {
      const isCurrent = p.id === app.project.id;
      const smallBtn = (ic, label, fn) => h('button', {
        class: 'icon-btn small', 'aria-label': label,
        onClick: (e) => { e.stopPropagation(); fn(); },
      }, icon(ic));
      return h('div', {
        class: `project-row${isCurrent ? ' active' : ''}`,
        onClick: async () => {
          if (!isCurrent) await app.openProject(p.id);
          dlg.close();
        },
      },
        h('span', { class: 'thumb-bg project-thumb' }, p.thumb ? h('img', { src: p.thumb, alt: '' }) : null),
        h('span', { class: 'project-info' },
          h('span', { class: 'project-name' }, p.name),
          h('span', { class: 'hint' }, `${p.width} × ${p.height} px · ${formatDate(p.updated)}${isCurrent ? ' · geöffnet' : ''}`)),
        smallBtn('edit', 'Umbenennen', async () => {
          const name = await promptDialog('Projekt umbenennen', p.name);
          if (!name) return;
          if (isCurrent) {
            app.project.name = name;
            app.updateAll();
            await app.saveNow();
          } else {
            await saveProjectMeta({ ...p, name });
          }
          render();
        }),
        smallBtn('copy', 'Duplizieren', async () => {
          const src = await loadProject(p.id);
          await saveProject({ ...src.meta, id: newProjectId(), name: `${p.name} Kopie` }, src.doc);
          render();
        }),
        smallBtn('trash', 'Löschen', async () => {
          const ok = await confirmDialog('Projekt löschen', `„${p.name}“ endgültig löschen? Das kann nicht rückgängig gemacht werden.`, 'Löschen', 'danger');
          if (!ok) return;
          await deleteProject(p.id);
          if (isCurrent) await app.openFirstOrNew();
          render();
        }),
      );
    }));
  };

  const fileInput = h('input', { type: 'file', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const { name, doc } = await decodeProjectFile(new Uint8Array(await file.arrayBuffer()));
      await app.adoptProject(name, doc);
      toast(`Projekt „${name}“ geöffnet`);
      dlg.close();
    } catch (err) {
      toast(`Datei konnte nicht geöffnet werden: ${err.message}`, 5000);
    }
  });

  const backup = async (share) => {
    await app.saveNow();
    const bytes = await encodeProjectFile(app.project.name, app.doc);
    const fileName = `${sanitizeName(app.project.name)}.${PROJECT_EXT}`;
    try {
      if (share) {
        await shareFile(fileName, bytes, 'application/octet-stream');
        return;
      }
      const path = `Projekte/${fileName}`;
      if (await fileExists(path)) {
        if (!(await confirmDialog('Datei existiert bereits', `„${fileName}“ überschreiben?`, 'Überschreiben', 'danger'))) return;
      }
      const where = await saveFile(path, bytes, 'application/octet-stream');
      toast(`Gesichert: ${where}/${path}`, 4000);
    } catch (err) {
      if (!/cancel/i.test(String(err?.message))) toast(`Fehlgeschlagen: ${err?.message || err}`, 5000);
    }
  };

  const dlg = openDialog({
    title: 'Projekte',
    body: h('div', {},
      h('div', { class: 'chips' },
        h('button', { class: 'chip', onClick: () => { dlg.close(); newImageDialog(app); } }, '+ Neues Projekt'),
        h('button', { class: 'chip', onClick: () => fileInput.click() }, 'Datei öffnen …')),
      list,
      fileInput,
      h('p', { class: 'hint section' }, `Aktuelles Projekt „${app.project.name}“ als Datei sichern (enthält alle Ebenen):`),
      h('div', { class: 'chips' },
        h('button', { class: 'chip', onClick: () => backup(false) }, 'In Dokumente speichern'),
        h('button', { class: 'chip', onClick: () => backup(true) }, 'Teilen …')),
      h('p', { class: 'hint' }, 'Projekte werden automatisch in der App gespeichert. Die Datei-Sicherung ist zusätzlich – z. B. bevor du die App neu installierst.')),
  });
  render();
}
