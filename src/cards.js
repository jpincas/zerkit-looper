// A page of square cards laid out like the Circuit's pads: up to 16, on the top two pad rows
// (1-8, then 9-16), lined up with the track columns, so each card has a pad on the Circuit too.
// Tapping a card (or its pad) switches it in or out of its button's cycle; ✎ edits it (where
// there's an editor). Below the cards: a "＋ New" button and any notes.
//
//   items():   [{ key, name, color }] in order (the first 16 are shown)
//   isOn(key), current(key): the switch, and whether the selected track is playing it
//   toggle(key), onEdit(key)?, onNew()?, newLabel?, footer()?: html under the cards (wireFoot(el)
//   hooks up any buttons in it), usedBy(key): the small text on a card, hint(item)?: its tooltip
export const MAX_CARDS = 16;

export function cardPage(root, { items, isOn, current, toggle, onEdit, onNew, newLabel, footer, wireFoot, usedBy, hint }) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let drawnKeys = '', drawnFoot = '';

  function draw() {
    const list = items();
    drawnKeys = list.map(i => i.key).join('|');
    drawnFoot = '';
    const shown = list.slice(0, MAX_CARDS);
    root.innerHTML = `<div class="cards"></div><div class="cards-foot"></div>`;
    const grid = root.firstElementChild;
    shown.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.key = item.key;
      card.style.gridRow = i < 8 ? 1 : 2;
      card.style.gridColumn = (i % 8) + 1;
      card.style.setProperty('--c', item.color);
      card.title = hint?.(item) ?? `${item.name}: tap to switch it in or out of the cycle${onEdit ? ' · ✎ to edit' : ''}`;
      card.innerHTML = `<span class="card-num">${i + 1}</span><i class="card-dot"></i>`
        + `<span class="card-name">${esc(item.name)}</span><span class="card-use"></span>`
        + (onEdit ? '<button class="card-edit" title="Edit">✎</button>' : '');
      card.addEventListener('click', e => {
        if (e.target.closest('.card-edit')) return onEdit(item.key);
        toggle(item.key);
      });
      grid.appendChild(card);
    });
    drawFoot(list.length);
  }

  function drawFoot(total) {
    const extra = total > MAX_CARDS ? `<span class="cards-note">${total - MAX_CARDS} more not shown (16 at most).</span>` : '';
    const html = (onNew ? `<button class="dlg-btn cards-new">＋ ${esc(newLabel)}</button>` : '') + extra + (footer?.() ?? '');
    if (html === drawnFoot) return;
    drawnFoot = html;
    const foot = root.querySelector('.cards-foot');
    foot.innerHTML = html;
    foot.querySelector('.cards-new')?.addEventListener('click', onNew);
    wireFoot?.(foot);
  }

  function update() {
    const list = items();
    if (list.map(i => i.key).join('|') !== drawnKeys || !root.querySelector('.cards')) return draw();
    for (const card of root.querySelectorAll('.card')) {
      const key = card.dataset.key;
      card.classList.toggle('on', isOn(key));
      card.classList.toggle('current', current(key));
      const use = card.querySelector('.card-use');
      const text = usedBy(key);
      if (use.textContent !== text) use.textContent = text;
    }
    drawFoot(list.length);
  }

  // For the Circuit: the cards on its pads, in order.
  const state = () => items().slice(0, MAX_CARDS).map(i => ({ key: i.key, on: isOn(i.key), current: current(i.key) }));
  return { draw, update, state, toggleAt: i => { const it = items()[i]; if (it && i < MAX_CARDS) toggle(it.key); } };
}

// "Tracks 1, 3" / "" for a card.
export const tracksUsing = (instruments, key) => {
  const t = instruments.map((n, i) => (n === key ? i + 1 : 0)).filter(Boolean);
  return t.length ? `Track${t.length > 1 ? 's' : ''} ${t.join(', ')}` : '';
};
