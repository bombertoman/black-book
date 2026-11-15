const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cmp = (a, b) => a.localeCompare(b, 'it', { numeric: true, sensitivity: 'base' });
const sortKey = (t) => t.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^(the|a|an)\s+/i, '');

const KINDS = {
  artists: { one: 'Artista', many: 'Artisti' },
  albums: { one: 'Album', many: 'Album' },
  drummers: { one: 'Batterista', many: 'Batteristi', text: 'drummerText' },
  producers: { one: 'Produttore', many: 'Produttori', text: 'producerText' },
  labels: { one: 'Etichetta', many: 'Etichette', text: 'labelText' },
};
const TYPES = { famoso: 'Famoso', documentato: 'Documentato', scoperta: 'Scoperta' };
const DEFAULTS = { tab: 'break', q: '', type: '', dec: '', ubb: '', sort: 'title', who: '', hk: '', min: '', esort: 'heat' };

let breaks = [], drummers = {}, sources = [];
const index = {};            // kind -> Map(name -> breaks[])
const state = { ...DEFAULTS };
// Names of one kind in a break: artist and album are single strings, the others arrays.
const vals = (b, kind) => (kind === 'artists' ? [b.artist] : kind === 'albums' ? (b.album ? [b.album] : []) : b[kind] || []);
// Heat key: a label counts by its own name, without the parent company ("Dial (Atlantic)" and "Dial (Mercury)" are both Dial).
const key = (kind, n) => (kind === 'labels' ? n.replace(/\s*\([^)]*\)$/, '') : n);
const keys = (b, kind) => [...new Set(vals(b, kind).map((n) => key(kind, n)))];
const variants = {};         // kind -> Map(key -> Set of names as written)

// ---------- state <-> URL hash ----------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const k in DEFAULTS) state[k] = p.get(k) || DEFAULTS[k];
}
function writeHash() {
  const p = new URLSearchParams();
  for (const k in DEFAULTS) if (state[k] !== DEFAULTS[k]) p.set(k, state[k]);
  const h = p.toString();
  history.replaceState(null, '', h ? '#' + h : location.pathname);
}
function set(patch) { Object.assign(state, patch); writeHash(); render(); }

// ---------- data ----------
async function load() {
  const get = (n) => fetch(`data/${n}.json`, { cache: 'no-cache' }).then((r) => r.json());
  [breaks, drummers, sources] = await Promise.all([get('breaks'), get('drummers'), get('sources')]);
  for (const kind in KINDS) {
    index[kind] = new Map();
    variants[kind] = new Map();
    for (const b of breaks) {
      for (const n of keys(b, kind)) {
        if (!index[kind].has(n)) index[kind].set(n, []);
        index[kind].get(n).push(b);
      }
      for (const n of vals(b, kind)) {
        const k = key(kind, n);
        if (!variants[kind].has(k)) variants[kind].set(k, new Set());
        variants[kind].get(k).add(n);
      }
    }
  }
  for (const b of breaks) {
    // Heat of a break per kind = its hottest name of that kind.
    b._heat = { any: 0 };
    for (const kind in KINDS) {
      b._heat[kind] = Math.max(0, ...keys(b, kind).map((n) => index[kind].get(n).length));
      b._heat.any = Math.max(b._heat.any, b._heat[kind]);
    }
    b._hay = norm([b.title, b.artist, b.release, b.album, b.where, b.drummers, b.drummerText, b.producers, b.producerText,
      b.labels, b.labelText, b.type, b.ubb ? 'ubb ' + b.ubb : ''].flat().filter(Boolean).join(' | '));
    b._dec = b.year ? Math.floor(b.year / 10) * 10 : 0;
    b._ubb = b.ubb ? String(parseInt(b.ubb, 10)) : '';
  }
  const decs = [...new Set(breaks.map((b) => b._dec).filter(Boolean))].sort();
  $('#dec').innerHTML = '<option value="">Tutti gli anni</option>' + decs.map((d) => `<option value="${d}">Anni ${d}</option>`).join('');
  const ubbs = [...new Set(breaks.map((b) => b._ubb).filter(Boolean))].sort((a, b) => a - b);
  $('#ubb').innerHTML = '<option value="">UBB: tutti</option><option value="any">UBB: solo presenti</option><option value="none">UBB: assenti</option>'
    + ubbs.map((u) => `<option value="${u}">UBB ${u}</option>`).join('');
  for (const kind in KINDS) {
    const dl = $('#dl-' + kind);
    if (dl) dl.innerHTML = [...variants[kind].values()].flatMap((s) => [...s]).sort(cmp).map((n) => `<option value="${esc(n)}">`).join('');
  }
}

// ---------- rendering helpers ----------
const heat = (n) => (n >= 3 ? ' h3' : n === 2 ? ' h2' : '');
function entBtn(kind, name, badge = true) {
  const k = key(kind, name), n = (index[kind].get(k) || []).length;
  return `<button class="ent${heat(n)}" data-who="${esc(kind + ':' + k)}" title="Calore ${n}: compare in ${n} break">${esc(name)}${badge && n > 1 ? `<sup>${n}</sup>` : ''}</button>`;
}
// Names of a break for one kind; free text keeps its notes, with names made clickable.
function people(b, kind) {
  const names = b[kind] || [], text = b[KINDS[kind].text];
  if (!names.length) return text ? `<span class="dim">${esc(text)}</span>` : '';
  if (!text) return names.map((n) => entBtn(kind, n)).join(names.length > 2 ? ', ' : ' e ');
  const re = new RegExp('(' + [...names].sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')');
  return text.split(re).map((part, i) => (i % 2 ? entBtn(kind, part) : esc(part))).join('');
}
// Release text with the album name made clickable (or put in front when the text doesn't contain it).
function disco(b) {
  const r = b.release || '';
  if (!b.album) return esc(r);
  const i = r.indexOf(b.album);
  if (i < 0) return entBtn('albums', b.album) + (r ? ` <span class="dim">· ${esc(r)}</span>` : '');
  return esc(r.slice(0, i)) + entBtn('albums', b.album) + esc(r.slice(i + b.album.length));
}
const cell = (label, html) => `<div data-l="${label}"${html ? '' : ' class="none"'}>${html || '<span class="dim">–</span>'}</div>`;

function filtered() {
  const words = norm(state.q).split(/\s+/).filter(Boolean);
  const [wk, wn] = state.who ? [state.who.slice(0, state.who.indexOf(':')), state.who.slice(state.who.indexOf(':') + 1)] : [];
  const hk = state.hk || 'any', min = Number(state.min) || 0;
  const out = breaks.filter((b) =>
    words.every((w) => b._hay.includes(w))
    && (!state.type || b.type === state.type)
    && (!state.dec || String(b._dec) === state.dec)
    && (!state.ubb || (state.ubb === 'any' ? b._ubb : state.ubb === 'none' ? !b._ubb : b._ubb === state.ubb))
    && (!wk || keys(b, wk).includes(wn))
    && b._heat[hk] >= min);
  if (state.sort === 'year') out.sort((a, b) => (a.year || 9999) - (b.year || 9999) || cmp(sortKey(a.title), sortKey(b.title)));
  else if (state.sort === 'heat') out.sort((a, b) => b._heat[hk] - a._heat[hk] || cmp(sortKey(a.title), sortKey(b.title)));
  else if (state.sort === 'artist') out.sort((a, b) => cmp(sortKey(a.artist), sortKey(b.artist)) || cmp(sortKey(a.title), sortKey(b.title)));
  else out.sort((a, b) => cmp(sortKey(a.title), sortKey(b.title)));
  return out;
}

function renderBreaks() {
  const rows = filtered();
  const yt = (b) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(`${b.artist} ${b.title}`);
  const head = '<div class="row head"><div>Brano</div><div>Disco</div><div>Dove</div><div>Batterista</div><div>Produttore</div><div>Etichetta</div><div>Tipo</div></div>';
  const body = rows.map((b) => `<article class="row">
    <div class="title"><b>${esc(b.title)}</b><span>${entBtn('artists', b.artist)}</span></div>
    ${cell('Disco', disco(b))}
    ${cell('Dove', esc(b.where || ''))}
    ${cell('Batterista', people(b, 'drummers'))}
    ${cell('Produttore', people(b, 'producers'))}
    ${cell('Etichetta', people(b, 'labels'))}
    <div class="tags"><span class="tag ${b.type}">${TYPES[b.type]}</span>${b.ubb ? `<span class="tag">UBB ${esc(b.ubb)}</span>` : ''}<a class="yt" href="${yt(b)}" target="_blank" rel="noopener" title="Cerca su YouTube">▶</a></div>
  </article>`).join('');
  $('#list').className = 'breaks';
  $('#list').innerHTML = rows.length ? head + body : '<p class="empty">Nessun break trovato.</p>';
  return rows.length;
}

function renderEntities(kind) {
  const words = norm(state.q).split(/\s+/).filter(Boolean);
  const isDr = kind === 'drummers';
  // Under the name: an album's artists (a compilation can have several), a label as written on the records.
  const sub = (name, list) => (kind === 'albums' ? [...new Set(list.map((b) => b.artist))].join(', ')
    : [...variants[kind].get(name)].filter((v) => v !== name).join(', '));
  const rows = [...index[kind]].map(([name, list]) => ({ name, list, info: (isDr && drummers[name]) || { fullName: sub(name, list) } }))
    .filter((e) => { const hay = norm([e.name, e.info.fullName, e.info.role, e.info.other, e.list.map((b) => b.title + ' ' + b.artist)].flat().join(' | ')); return e.list.length >= (Number(state.min) || 0) && words.every((w) => hay.includes(w)); })
    .sort((a, b) => (state.esort === 'name' ? 0 : b.list.length - a.list.length) || cmp(a.name, b.name));
  const head = `<div class="row head"><div>${KINDS[kind].one}</div><div>Calore</div>${isDr ? '<div>Ruolo</div>' : ''}<div>Break</div>${isDr ? '<div>Altri dischi</div>' : ''}</div>`;
  const body = rows.map((e) => `<article class="row">
    <div class="title">${entBtn(kind, e.name, false)}${e.info.fullName ? `<div class="sub">${esc(e.info.fullName)}</div>` : ''}</div>
    <div class="heat${heat(e.list.length)}">${e.list.length}</div>
    ${isDr ? cell('Ruolo', esc(e.info.role || '')) : ''}
    <div class="sub" data-l="Break">${e.list.map((b) => esc(b.title)).join(' · ')}</div>
    ${isDr ? cell('Altri dischi', esc(e.info.other || '')) : ''}
  </article>`).join('');
  $('#list').className = 'ents ' + kind;
  $('#list').innerHTML = rows.length ? head + body : '<p class="empty">Nessun risultato.</p>';
}

function renderSources() {
  const words = norm(state.q).split(/\s+/).filter(Boolean);
  const rows = sources.filter((s) => words.every((w) => norm(s.title + ' ' + s.url).includes(w)));
  $('#list').className = '';
  $('#list').innerHTML = rows.length
    ? '<ul class="sources">' + rows.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('') + '</ul>'
    : '<p class="empty">Nessuna fonte trovata.</p>';
}

function render() {
  const tabs = [['break', 'Break', breaks.length], ...Object.keys(KINDS).map((k) => [k, KINDS[k].many, index[k].size]), ['fonti', 'Fonti', sources.length]];
  $('#tabs').innerHTML = tabs.map(([id, label, n]) => `<button data-tab="${id}" class="${state.tab === id ? 'on' : ''}">${label}<small>${n}</small></button>`).join('');
  const onBreaks = state.tab === 'break';
  const onEnts = !!KINDS[state.tab];
  $('#filters').hidden = !onBreaks && !onEnts;
  document.querySelectorAll('#filters .bo').forEach((el) => { el.hidden = !onBreaks; });
  document.querySelectorAll('#filters .eo').forEach((el) => { el.hidden = !onEnts; });
  if ($('#min').value !== state.min) $('#min').value = state.min;
  $('#esort').value = state.esort;
  $('#reset').hidden = !(state.q || state.min || (onBreaks && (state.type || state.dec || state.ubb || state.who || state.hk)));
  if ($('#q').value !== state.q) $('#q').value = state.q;

  // Entity banner
  const who = $('#who');
  who.hidden = !(onBreaks && state.who);
  if (!who.hidden) {
    const i = state.who.indexOf(':'), kind = state.who.slice(0, i), name = state.who.slice(i + 1);
    const info = (kind === 'drummers' && drummers[name]) || {};
    const list = index[kind].get(name) || [], n = list.length;
    const by = kind === 'albums' ? [...new Set(list.map((b) => b.artist))].join(', ')
      : [...(variants[kind].get(name) || [])].filter((v) => v !== name).join(', ');
    who.innerHTML = `<button data-who="">✕</button><span class="dim">${KINDS[kind].one}:</span> <b>${esc(info.fullName || name)}</b>
      <span class="heat${heat(n)}">${n}</span>${by ? `<span class="meta">${esc(by)}</span>` : ''}
      ${info.role ? `<span class="meta">${esc(info.role)}</span>` : ''}${info.other ? `<span class="meta">Altri dischi: ${esc(info.other)}</span>` : ''}`;
  }

  if (onBreaks) {
    const count = (t) => breaks.filter((b) => !t || b.type === t).length;
    $('#types').innerHTML = [['', 'Tutti'], ...Object.entries(TYPES)].map(([v, l]) =>
      `<button data-type="${v}" class="${state.type === v ? 'on' : ''}">${l}<small>${count(v)}</small></button>`).join('');
    $('#dec').value = state.dec; $('#ubb').value = state.ubb; $('#sort').value = state.sort; $('#hk').value = state.hk;
    renderBreaks();
  } else if (state.tab === 'fonti') renderSources();
  else if (KINDS[state.tab]) renderEntities(state.tab);
  else set({ tab: 'break' });
}

// ---------- events ----------
let timer;
$('#q').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => set({ q: e.target.value }), 80); });
$('#dec').addEventListener('change', (e) => set({ dec: e.target.value }));
$('#ubb').addEventListener('change', (e) => set({ ubb: e.target.value }));
$('#sort').addEventListener('change', (e) => set({ sort: e.target.value }));
$('#hk').addEventListener('change', (e) => set({ hk: e.target.value }));
$('#esort').addEventListener('change', (e) => set({ esort: e.target.value }));
$('#min').addEventListener('input', (e) => set({ min: e.target.value }));
$('#reset').addEventListener('click', () => set({ q: '', type: '', dec: '', ubb: '', who: '', hk: '', min: '' }));
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab],[data-type],[data-who]');
  if (!t) return;
  if (t.dataset.tab !== undefined) set({ tab: t.dataset.tab, q: '', min: '' });
  else if (t.dataset.type !== undefined) set({ type: t.dataset.type });
  else { set({ tab: 'break', who: t.dataset.who, q: '', type: '', dec: '', ubb: '', hk: '', min: '' }); scrollTo(0, 0); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
});
addEventListener('hashchange', () => { readHash(); render(); });

// ---------- add form (only when the local server API is there) ----------
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; setTimeout(() => { t.hidden = true; }, 2500); }
$('#add').addEventListener('click', () => { $('#form').reset(); $('#err').textContent = ''; $('#dlg').showModal(); });
$('#cancel').addEventListener('click', () => $('#dlg').close());
$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries([...new FormData(e.target)].filter(([, v]) => v.trim()));
  try {
    const r = await fetch('api/breaks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const res = await r.json();
    if (!r.ok) throw new Error(res.error);
    $('#dlg').close();
    await load(); render();
    toast(`Aggiunto: ${res.added[0].title} – ${res.added[0].artist}`);
  } catch (err) { $('#err').textContent = err.message; }
});

(async () => {
  readHash();
  await load();
  render();
  fetch('api/ping').then((r) => r.ok && r.json()).then((j) => { if (j && j.ok) $('#add').hidden = false; }).catch(() => {});
})();
