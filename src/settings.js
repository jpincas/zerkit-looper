// Settings (the cog): pages of settings in the pad area. While it's open the track buttons pick
// the page; ▲ ▼ (the Octave buttons, the arrow keys or the master filter knob) choose a row,
// Play (Enter) does the row's thing and Clear track (⌫) deletes it, pressed twice.
//
// Pages:
//   Templates: the stock setup and your templates. Play makes the chosen one the default (the
//              setup every new project starts with; the stock setup when none is).
import { templates } from './templates.js';

export function setupSettings({ root, INSTRUMENTS, DEFAULTS, toast }) {
  const PAGES = [{ id: 'templates', name: 'Templates' }];
  let page = 0, sel = 0, confirmDelete = null;          // confirmDelete: the row waiting for a second press
  let rows = [], shown = '', dflt = null;             // dflt: the default template's name (null: stock)

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ago = t => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
    return new Date(t).toLocaleDateString();
  };

  // ---- Templates ------------------------------------------------------------------
  function readRows() {
    rows = [{ name: null, label: 'Stock setup', when: 'built in', colors: DEFAULTS.map(k => INSTRUMENTS[k]?.color ?? '#888'), tempo: 120 },
      ...templates.list().map(t => ({ name: t.name, label: t.name, when: ago(t.savedAt), colors: t.json.tracks.map(x => INSTRUMENTS[x.instrument]?.color ?? '#888'), tempo: t.json.tempo }))];
    dflt = templates.defaultName();
    sel = Math.min(sel, rows.length - 1);
  }
  const isDefault = r => r.name === dflt;                     // the stock row when there's none
  function makeDefault(i) {
    const r = rows[i];
    const name = isDefault(r) ? null : r.name;                  // the default again: back to stock
    templates.setDefault(name);
    toast(name ? `New projects start from “${name}”` : 'New projects start from the stock setup');
  }
  function remove(i) {
    const r = rows[i];
    if (r.name == null) return toast('The stock setup is built in: it can’t be deleted', 'warn');
    if (confirmDelete !== r.name) { confirmDelete = r.name; return; }
    templates.remove(r.name);
    confirmDelete = null;
    toast(`Deleted · ${r.name}`);
    readRows();
  }

  function draw() {
    const key = JSON.stringify([page, sel, confirmDelete, dflt, rows.map(r => r.name)]);
    if (key === shown) return;
    shown = key;
    root.innerHTML = `
      <div class="set">
        <div class="set-list">${rows.map((r, i) => `
          <div class="set-row${i === sel ? ' sel' : ''}${isDefault(r) ? ' dflt' : ''}" data-i="${i}">
            <span class="sr-star" title="The default">★</span>
            <span class="sr-name">${esc(r.label)}</span>
            <span class="di-tracks">${r.colors.map(c => `<i class="on" style="--c:${c}"></i>`).join('')}</span>
            <span class="sr-tempo">${r.tempo} BPM</span>
            <span class="sr-when">${r.when}</span>
            <button class="sr-btn sr-default">${isDefault(r) ? 'Default' : 'Make default'}</button>
            ${r.name == null ? '<span></span>' : `<button class="sr-btn sr-del${confirmDelete === r.name ? ' armed' : ''}">${confirmDelete === r.name ? 'Delete?' : 'Delete'}</button>`}
          </div>`).join('')}
        </div>
      </div>`;
    root.querySelectorAll('.set-row').forEach(el => {
      const i = Number(el.dataset.i);
      el.addEventListener('click', () => { if (sel !== i) confirmDelete = null; sel = i; });
      el.querySelector('.sr-default').addEventListener('click', e => { e.stopPropagation(); sel = i; makeDefault(i); });
      el.querySelector('.sr-del')?.addEventListener('click', e => { e.stopPropagation(); sel = i; remove(i); });
    });
    root.querySelector('.set-row.sel')?.scrollIntoView({ block: 'nearest' });
  }

  let version = -1;
  return {
    pages: PAGES,
    page: () => page,
    selectPage(i) { if (i < PAGES.length) { page = i; sel = 0; confirmDelete = null; } },
    update() {
      if (version !== templates.version()) { version = templates.version(); readRows(); }
      draw();
    },
    move(dir) { sel = Math.max(0, Math.min(rows.length - 1, sel + dir)); confirmDelete = null; },
    enter() { makeDefault(sel); },
    del() { remove(sel); },
    canDelete: () => rows[sel]?.name != null,
    close() { confirmDelete = null; },
    // The Circuit's pads: a pad per row (the default amber, the chosen one white).
    cards: {
      press(p) { if (p < rows.length) { if (sel !== p) confirmDelete = null; sel = p; } },
      release() {},
      state: () => rows.slice(0, 32).map((r, i) => ({ on: true, current: i === sel, code: isDefault(r) ? 0x2B : 0x02 })),
    },
  };
}
