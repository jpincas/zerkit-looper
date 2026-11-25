// Project storage: a projects folder on the computer, chosen once (the browser's File System
// Access API; Chrome). Each project is a folder in it:
//
//   My Song.zerkit/
//     project.json      everything except audio (see main.js: snapshot / restore)
//     audio/*.wav       one 32-bit float WAV per recorded take or overdub layer
//
// The folder's handle is kept in IndexedDB so it's remembered between visits. Chrome asks for
// permission to use it again after a reload; that needs a click or key press on the page (a
// Circuit button doesn't count), and "Allow on every visit" stops it asking.

const DB = 'zerkit', STORE = 'handles', KEY = 'projects-folder';
const EXT = '.zerkit';

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

export const supported = () => typeof window.showDirectoryPicker === 'function';

export class Projects {
  constructor() {
    this.root = null;          // FileSystemDirectoryHandle of the projects folder
    this.ready = idb('readonly', s => s.get(KEY)).then(h => { this.root = h ?? null; }).catch(() => {});
  }

  get folderName() { return this.root?.name ?? null; }

  // 'granted', 'prompt' (needs a click to allow again) or 'none' (no folder chosen yet).
  async access() {
    await this.ready;
    if (!this.root) return 'none';
    return (await this.root.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : 'prompt';
  }

  // Call from a click: asks again for a remembered folder, or picks one the first time.
  async allow() {
    await this.ready;
    if (this.root && (await this.root.requestPermission({ mode: 'readwrite' })) === 'granted') return true;
    if (!this.root) return this.chooseFolder();
    return false;
  }

  async chooseFolder() {
    const h = await window.showDirectoryPicker({ id: 'zerkit-projects', mode: 'readwrite', startIn: 'music' });
    this.root = h;
    await idb('readwrite', s => s.put(h, KEY));
    return true;
  }

  // Recent projects, newest first: [{ name, savedAt, summary }]
  async list() {
    const out = [];
    for await (const [entry, h] of this.root.entries()) {
      if (h.kind !== 'directory' || !entry.endsWith(EXT)) continue;
      try {
        const file = await (await h.getFileHandle('project.json')).getFile();
        const json = JSON.parse(await file.text());
        out.push({ name: entry.slice(0, -EXT.length), savedAt: json.savedAt ?? file.lastModified, summary: json.summary ?? null });
      } catch { /* not a readable project: skip it */ }
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  async exists(name) {
    try { await this.root.getDirectoryHandle(name + EXT); return true; } catch { return false; }
  }

  // Write a project: its JSON, then any audio files not already there (recordings never change,
  // so a file that exists is the same audio), then remove audio files no longer used.
  async save(name, json, audio /* Map path -> AudioBuffer */) {
    const dir = await this.root.getDirectoryHandle(name + EXT, { create: true });
    const audioDir = await dir.getDirectoryHandle('audio', { create: true });
    const keep = new Set();
    for (const [path, buffer] of audio) {
      const file = path.split('/').pop();
      keep.add(file);
      try { await audioDir.getFileHandle(file); continue; } catch { /* not written yet */ }
      await write(await audioDir.getFileHandle(file, { create: true }), encodeWav(buffer));
    }
    for await (const [file] of audioDir.entries()) if (!keep.has(file)) await audioDir.removeEntry(file);
    await write(await dir.getFileHandle('project.json', { create: true }), JSON.stringify(json, null, 1));
  }

  // Read a project: its JSON, and a loader for its audio files (decoded with `ctx`).
  async load(name, ctx) {
    const dir = await this.root.getDirectoryHandle(name + EXT);
    const json = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text());
    const audio = async path => {
      let h = dir;
      const parts = path.split('/');
      for (const p of parts.slice(0, -1)) h = await h.getDirectoryHandle(p);
      const bytes = await (await (await h.getFileHandle(parts.at(-1))).getFile()).arrayBuffer();
      return ctx.decodeAudioData(bytes);
    };
    return { json, audio };
  }
}

async function write(fileHandle, data) {
  const w = await fileHandle.createWritable();
  await w.write(data);
  await w.close();
}

// 32-bit float WAV (lossless for what Web Audio records).
export function encodeWav(buffer) {
  const ch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
  const bytes = 44 + len * ch * 4;
  const v = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true);         // 3 = IEEE float
  v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 4, true);
  v.setUint16(32, ch * 4, true); v.setUint16(34, 32, true);
  str(36, 'data'); v.setUint32(40, len * ch * 4, true);
  const chans = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  for (let i = 0, o = 44; i < len; i++) for (let c = 0; c < ch; c++, o += 4) v.setFloat32(o, chans[c][i], true);
  return v.buffer;
}
