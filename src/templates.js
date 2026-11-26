// Templates: a project's whole setup (tempo, each track's sound, octave, quantise, mix, FX and
// synth, which instruments each button cycles through) without its recordings. Shift + Save
// keeps one, Shift + Open starts a new project from one; one can be the default, used for every
// new project (and when the page opens). Kept in this browser (localStorage), so they're there
// at once, with no folder to allow first.

const LIST = 'templates', DEFAULT = 'defaultTemplate';

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
};
let changes = 0;                                   // bumped on every change, so pages know to redraw
const write = (key, value) => {
  changes++;
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
};

export const templates = {
  version: () => changes,
  // Newest first: [{ name, savedAt, json }]
  list: () => read(LIST, []).sort((a, b) => b.savedAt - a.savedAt),
  get: name => templates.list().find(t => t.name === name) ?? null,
  exists: name => !!templates.get(name),
  save(name, json) {
    const list = templates.list().filter(t => t.name !== name);
    list.push({ name, savedAt: Date.now(), json });
    return write(LIST, list);
  },
  remove(name) {
    if (templates.defaultName() === name) templates.setDefault(null);
    write(LIST, templates.list().filter(t => t.name !== name));
  },
  // The default's name, or null for the stock setup.
  defaultName() { const n = read(DEFAULT, null); return n && templates.exists(n) ? n : null; },
  setDefault(name) { write(DEFAULT, name); },
};
