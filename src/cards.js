// A page of square cards laid out like the Circuit's pads: up to 16 (`max`: up to 32), on the top
// pad rows (1-8, then 9-16, and so on), lined up with the track columns, so each card has a pad on the Circuit too.
// Tapping a card (or its pad) switches it in or out of its button's cycle; ✎ edits it (where
// there's an editor). Below the cards: a "＋ New" button and any notes.
//
//   items():   [{ key, name, color, code? (its Circuit light) }] in order (the first `max` are shown)
//   isOn(key), current(key): the switch, and whether the selected track is playing it
//   toggle(key), onEdit(key)?, onNew()?, newLabel?, footer()?: html under the cards (wireFoot(el)
//   hooks up any buttons in it), usedBy(key): the small text on a card, hint(item)?: its tooltip,
//   max?: how many cards (16, or 32 for all four pad rows)
export const MAX_CARDS = 16;

export function cardPage(root, { items, isOn, current, toggle, onEdit, onNew, newLabel, footer, wireFoot, usedBy, hint, max = MAX_CARDS }) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let drawnKeys = '', drawnFoot = '';

  function draw() {
    const list = items();
    drawnKeys = list.map(i => i.key).join('|');
    drawnFoot = '';
    const shown = list.slice(0, max);
    root.innerHTML = `<div class="cards"></div><div class="cards-foot"></div>`;
    const grid = root.firstElementChild;
    grid.style.gridTemplateRows = `repeat(${Math.ceil(max / 8)}, var(--sq))`;
    shown.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.key = item.key;
      card.style.gridRow = Math.floor(i / 8) + 1;
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
    const extra = total > max ? `<span class="cards-note">${total - max} more not shown (${max} at most).</span>` : '';
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
  const state = () => items().slice(0, max).map(i => ({ key: i.key, code: i.code, on: isOn(i.key), current: current(i.key) }));
  return { draw, update, state, max, toggleAt: i => { const it = items()[i]; if (it && i < max) toggle(it.key); } };
}

// "Tracks 1, 3" / "" for a card.
export const tracksUsing = (instruments, key) => {
  const t = instruments.map((n, i) => (n === key ? i + 1 : 0)).filter(Boolean);
  return t.length ? `Track${t.length > 1 ? 's' : ''} ${t.join(', ')}` : '';
};
