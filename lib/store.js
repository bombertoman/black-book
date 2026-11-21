// Data layer shared by the CLI (bb.js) and the local server (server.js).
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const file = (name) => path.join(DATA, name + '.json');
const read = (name) => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const write = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');

const TYPES = ['famoso', 'documentato', 'scoperta'];

// Accepted input keys (English, Italian, short) -> canonical field.
const ALIASES = {
  title: 'title', brano: 'title', t: 'title',
  artist: 'artist', artista: 'artist', a: 'artist',
  release: 'release', disco: 'release', r: 'release',
  album: 'album', b: 'album',
  year: 'year', anno: 'year', y: 'year',
  where: 'where', dove: 'where', w: 'where',
  drummers: 'drummers', drummer: 'drummers', batterista: 'drummers', batteristi: 'drummers', d: 'drummers',
  producers: 'producers', producer: 'producers', produttore: 'producers', produttori: 'producers', p: 'producers',
  arrangers: 'arrangers', arranger: 'arrangers', arrangiatore: 'arrangers', arrangiatori: 'arrangers', arr: 'arrangers', x: 'arrangers',
  labels: 'labels', label: 'labels', etichetta: 'labels', etichette: 'labels', l: 'labels',
  drummerText: 'drummerText', 'drummer-text': 'drummerText',
  producerText: 'producerText', 'producer-text': 'producerText',
  arrangerText: 'arrangerText', 'arranger-text': 'arrangerText',
  labelText: 'labelText', 'label-text': 'labelText',
  type: 'type', tipo: 'type',
  ubb: 'ubb',
  id: 'id',
};

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const sortKey = (b) => b.title.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^(the|a|an)\s+/i, '');
const byTitle = (x, y) => sortKey(x).localeCompare(sortKey(y), 'it', { numeric: true, sensitivity: 'base' })
  || x.artist.localeCompare(y.artist, 'it');

// Names: array, or a string with ";" separators.
const names = (v) => [...new Set((Array.isArray(v) ? v : String(v).split(';'))
  .map((s) => String(s).trim()).filter(Boolean))];

function normalize(input) {
  const src = {};
  for (const [k, v] of Object.entries(input)) {
    const key = ALIASES[k];
    if (!key) throw new Error(`Campo sconosciuto: "${k}"`);
    if (v === undefined || v === null || v === '') continue;
    if (['drummers', 'producers', 'arrangers', 'labels'].includes(key)) src[key] = [...(src[key] || []), ...names(v)];
    else src[key] = typeof v === 'string' ? v.trim() : v;
  }
  // "Title - Artist" shorthand in the title field.
  if (src.title && !src.artist) {
    const m = String(src.title).match(/^(.+?)\s+[–-]\s+(.+)$/);
    if (m) { src.title = m[1]; src.artist = m[2]; }
  }
  if (!src.title) throw new Error('Manca il titolo (title)');
  if (!src.artist) throw new Error(`Manca l'artista (artist) per "${src.title}"`);

  const b = { id: src.id || slug(src.title + ' ' + src.artist), title: String(src.title), artist: String(src.artist) };
  if (src.release) b.release = String(src.release);
  if (src.album) b.album = String(src.album);
  if (src.year !== undefined) {
    b.year = Number(src.year);
    if (!Number.isInteger(b.year) || b.year < 1900 || b.year > 2100) throw new Error(`Anno non valido: "${src.year}"`);
  } else if (b.release) {
    const m = b.release.match(/\b(19|20)\d{2}\b/);
    if (m) b.year = Number(m[0]);
  }
  if (src.where) b.where = String(src.where);
  for (const k of ['drummers', 'producers', 'arrangers', 'labels']) {
    // Arrangers are optional: most breaks don't have them yet, so the empty array is left out.
    if (k !== 'arrangers' || src[k]) b[k] = src[k] || [];
    const tk = k.slice(0, -1) + 'Text';
    if (src[tk]) b[tk] = String(src[tk]);
  }
  if (src.ubb !== undefined) b.ubb = String(src.ubb);
  b.type = src.type ? String(src.type).toLowerCase() : (b.ubb ? 'famoso' : 'scoperta');
  if (!TYPES.includes(b.type)) throw new Error(`Tipo non valido: "${src.type}" (usa ${TYPES.join(', ')})`);
  // Keep a stable key order: type before ubb.
  if (b.ubb) { const u = b.ubb; delete b.ubb; b.ubb = u; }
  return b;
}

// Adds one or more breaks. Existing ids are rejected unless `force` (then replaced).
function addBreaks(inputs, { force = false } = {}) {
  const breaks = read('breaks');
  const added = [], updated = [];
  for (const input of [].concat(inputs)) {
    const b = normalize(input);
    const i = breaks.findIndex((x) => x.id === b.id);
    if (i >= 0) {
      if (!force) throw new Error(`Esiste già: "${b.title} – ${b.artist}" (id ${b.id}). Usa --force per sostituirlo.`);
      breaks[i] = b; updated.push(b);
    } else { breaks.push(b); added.push(b); }
  }
  breaks.sort(byTitle);
  write('breaks', breaks);
  return { added, updated, total: breaks.length };
}

function removeBreak(id) {
  const breaks = read('breaks');
  const i = breaks.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`Nessun break con id "${id}"`);
  const [gone] = breaks.splice(i, 1);
  write('breaks', breaks);
  return gone;
}

function setDrummer(name, info) {
  const drummers = read('drummers');
  const d = { ...(drummers[name] || {}) };
  for (const k of ['role', 'other', 'fullName']) if (info[k] !== undefined) { if (info[k]) d[k] = String(info[k]); else delete d[k]; }
  drummers[name] = d;
  const sorted = Object.fromEntries(Object.entries(drummers).sort(([x], [y]) => x.localeCompare(y, 'it')));
  write('drummers', sorted);
  return d;
}

function addSource(title, url) {
  const sources = read('sources');
  if (!sources.some((s) => s.url === url)) { sources.push({ title, url }); write('sources', sources); }
  return sources.length;
}

// One call for a whole batch. Accepts a break, an array of breaks, or
// { breaks: [...], drummers: { "Name": { role, other, fullName } }, sources: [{ title, url }] }.
// Everything is validated before anything is written.
function addBatch(input, { force = false } = {}) {
  const isBreak = (o) => ['title', 'brano', 't'].some((k) => k in o);
  const wrapped = input && !Array.isArray(input) && !isBreak(input)
    && ['breaks', 'drummers', 'sources'].some((k) => k in input);
  const batch = wrapped ? input : { breaks: input };
  for (const k of Object.keys(batch)) if (!['breaks', 'drummers', 'sources'].includes(k)) throw new Error(`Sezione sconosciuta: "${k}"`);

  const info = batch.drummers || {};
  if (typeof info !== 'object' || Array.isArray(info)) throw new Error('"drummers" deve essere un oggetto { "Nome": { role, other } }');
  for (const [name, d] of Object.entries(info)) {
    if (!d || typeof d !== 'object') throw new Error(`Scheda batterista non valida: "${name}"`);
    for (const k of Object.keys(d)) if (!['role', 'other', 'fullName'].includes(k)) throw new Error(`Campo sconosciuto in drummers["${name}"]: "${k}"`);
  }
  const srcs = batch.sources || [];
  if (!Array.isArray(srcs)) throw new Error('"sources" deve essere un array [{ title, url }]');
  for (const s of srcs) if (!s || !s.title || !/^https?:\/\//.test(s.url || '')) throw new Error(`Fonte non valida: ${JSON.stringify(s)}`);

  const old = read('breaks');
  const before = Object.fromEntries(KINDS.map((k) => [k, new Set(old.flatMap((b) => vals(b, k)))]));
  const res = batch.breaks ? addBreaks(batch.breaks, { force }) : { added: [], updated: [], total: old.length };
  const touched = [...res.added, ...res.updated];
  // Names never seen before: a typo here splits one name in two, so report them.
  const newNames = Object.fromEntries(KINDS.map((k) => [k,
    [...new Set(touched.flatMap((b) => vals(b, k)))].filter((n) => !before[k].has(n))]));
  // New names that contain, or are contained in, an existing one: probably the same artist or person.
  const warnings = [];
  for (const k of KINDS) for (const n of newNames[k]) {
    const like = [...before[k]].filter((e) => similar(n, e));
    if (like.length) warnings.push(`${KIND_LABELS[k]}: "${n}" somiglia a ${like.map((e) => `"${e}"`).join(', ')}`);
  }
  // An existing album title used by another artist: a different album with the same title?
  for (const b of touched) {
    if (!b.album || !before.albums.has(b.album)) continue;
    const artists = [...new Set(old.filter((x) => x.album === b.album && x.id !== b.id).map((x) => x.artist))];
    if (artists.length && !artists.includes(b.artist)) {
      warnings.push(`Album: "${b.album}" c'è già, di ${artists.join(', ')}. Se è un altro disco, aggiungi l'artista tra parentesi.`);
    }
  }

  for (const [name, d] of Object.entries(info)) setDrummer(name, d);
  const nSources = read('sources').length;
  for (const s of srcs) addSource(s.title, s.url);
  return { ...res, newNames, warnings, drummerCards: Object.keys(info).length, sourcesAdded: read('sources').length - nSources };
}

// Every kind of name that gets a heat count.
const KINDS = ['artists', 'albums', 'drummers', 'producers', 'arrangers', 'labels'];
const KIND_LABELS = { artists: 'Artisti', albums: 'Album', drummers: 'Batteristi', producers: 'Produttori', arrangers: 'Arrangiatori', labels: 'Etichette' };
const vals = (b, k) => (k === 'artists' ? [b.artist] : k === 'albums' ? (b.album ? [b.album] : []) : b[k] || []);

// Same name written differently:
// "Tom Scott" ~ "Tom Scott & the L.A. Express" (whole words of one inside the other),
// "Kenny Jones" ~ "Kenney Jones" (one or two letters apart).
// A final "(…)" is left out, so "Kudu (CTI)" is compared as "Kudu", not with "CTI".
const simple = (s) => ' ' + s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\s*\([^)]*\)\s*$/, '').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
function distance(a, b) {
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function similar(a, b) {
  const x = simple(a), y = simple(b);
  if (x === y) return a !== b;
  const short = Math.min(x.length, y.length);
  return (short > 5 && (x.includes(y) || y.includes(x))) || (short > 9 && distance(x, y) <= 2);
}

module.exports = { read, addBreaks, addBatch, removeBreak, setDrummer, addSource, normalize, TYPES, DATA, KINDS, KIND_LABELS };
