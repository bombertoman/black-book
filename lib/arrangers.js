// Looks up who arranged a track, on Discogs, MusicBrainz and Wikipedia.
// Nothing is written to the database: the results are candidates for a person to check.
// Rate limits: Discogs 25 requests/minute without a token (60 with DISCOGS_TOKEN), MusicBrainz 1/second,
// Wikipedia a few per second; the waits below stay under them.

const UA = 'BlackBook/1.0';
const ROLE = /arrang|orchestrat/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
// "Squib Cakes" matches "Squib Cakes", "Squib Cakes (Live)", "Squib-Cakes"; very short titles must match exactly.
const sameTitle = (a, b) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x));
};
// Discogs adds " (2)" to tell apart artists with the same name.
const cleanName = (n) => String(n).replace(/\s*\(\d+\)$/, '').replace(/\*$/, '').trim();

let lastCall = {};
async function get(url, { host, gap, headers = {} }) {
  const wait = (lastCall[host] || 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  for (let attempt = 0; attempt < 3; attempt++) {
    lastCall[host] = Date.now();
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
    if (r.status === 429 || r.status === 503) { await sleep(gap * (attempt + 2)); continue; }
    if (!r.ok) throw new Error(`${host}: HTTP ${r.status}`);
    return r.json();
  }
  throw new Error(`${host}: troppe richieste, riprova più tardi`);
}

// ---------- Discogs ----------
const discogsHeaders = () => (process.env.DISCOGS_TOKEN ? { Authorization: `Discogs token=${process.env.DISCOGS_TOKEN}` } : {});
const discogs = (path) => get('https://api.discogs.com' + path, {
  host: 'discogs', gap: process.env.DISCOGS_TOKEN ? 1100 : 2500, headers: discogsHeaders(),
});

// "https://www.discogs.com/it/release/123-Foo" or "release/123" or "master/456" -> { kind, id }
function parseDiscogs(ref) {
  const m = String(ref).match(/(release|master)s?\/(\d+)/i);
  if (m) return { kind: m[1].toLowerCase(), id: m[2] };
  if (/^\d+$/.test(String(ref).trim())) return { kind: 'release', id: String(ref).trim() };
  return null;
}

// Positions covered by a Discogs "tracks" field such as "A1 to A5, B2".
function coversPosition(spec, position, order) {
  if (!spec) return true;
  return spec.split(',').some((part) => {
    const [from, to] = part.split(/\s+to\s+/i).map((s) => s.trim());
    if (!to) return from === position;
    const i = order.indexOf(from), j = order.indexOf(to), k = order.indexOf(position);
    return i >= 0 && j >= 0 && k >= i && k <= j;
  });
}

function flatTracks(list) {
  const out = [];
  for (const t of list || []) { out.push(t); if (t.sub_tracks) out.push(...t.sub_tracks); }
  return out;
}

// Arranger credits of one Discogs release for one track.
function discogsCredits(rel, title) {
  const tracks = flatTracks(rel.tracklist);
  const order = tracks.map((t) => t.position);
  const track = tracks.find((t) => sameTitle(t.title, title));
  const url = rel.uri || `https://www.discogs.com/release/${rel.id}`;
  const where = `${rel.title} (${(rel.labels || []).map((l) => `${l.name} ${l.catno}`).join(', ')}${rel.year ? `, ${rel.year}` : ''})`;
  const out = [];
  if (track) {
    for (const e of track.extraartists || []) {
      if (ROLE.test(e.role)) out.push({ name: cleanName(e.anv || e.name), role: e.role, scope: 'brano', source: 'Discogs', where, url });
    }
  }
  for (const e of rel.extraartists || []) {
    if (!ROLE.test(e.role)) continue;
    if (e.tracks && !(track && coversPosition(e.tracks, track.position, order))) continue;
    out.push({ name: cleanName(e.anv || e.name), role: e.role, scope: e.tracks ? 'brano' : 'disco', source: 'Discogs', where, url });
  }
  return { out, track: track ? `${track.position} ${track.title}${track.duration ? ` (${track.duration})` : ''}` : null };
}

async function fromDiscogs({ artist, title, release, discogsRefs = [], max = 3 }, log) {
  const ids = [];
  const refs = discogsRefs.map(parseDiscogs).filter(Boolean);
  if (refs.length) {
    for (const ref of refs) ids.push(ref.kind === 'master' ? `m${ref.id}` : ref.id);
  } else {
    const q = new URLSearchParams({ artist, track: title, type: 'release', per_page: '25' });
    if (release) q.set('release_title', release);
    let res = await discogs(`/database/search?${q}`);
    // A wrong album or single title would hide everything: search again without it.
    if (!res.results.length && release) { q.delete('release_title'); res = await discogs(`/database/search?${q}`); }
    // One release per master: the master's main release usually has the full credits.
    const seen = new Set();
    for (const r of res.results) {
      const key = r.master_id || `r${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(r.master_id ? `m${r.master_id}` : String(r.id));
      if (ids.length >= max) break;
    }
  }
  const found = [], checked = [];
  for (let id of ids) {
    if (id.startsWith('m')) id = String((await discogs(`/masters/${id.slice(1)}`)).main_release);
    const rel = await discogs(`/releases/${id}`);
    const { out, track } = discogsCredits(rel, title);
    checked.push({ source: 'Discogs', url: rel.uri, what: rel.title, track });
    found.push(...out);
    log(`Discogs: ${rel.title} [${id}]${track ? ` – ${track}` : ' – brano non trovato nella tracklist'}: ${out.length} crediti`);
  }
  return { found, checked };
}

// ---------- MusicBrainz ----------
const mb = (path) => get('https://musicbrainz.org/ws/2' + path + (path.includes('?') ? '&' : '?') + 'fmt=json',
  { host: 'musicbrainz', gap: 1100 });
const quote = (s) => '"' + String(s).replace(/(["\\])/g, '\\$1') + '"';
const MB_ROLES = /arrang|orchestrat/i;

async function fromMusicBrainz({ artist, title, release, max = 3 }, log) {
  let query = `recording:${quote(title)} AND artist:${quote(artist)}`;
  if (release) query += ` AND release:${quote(release)}`;
  let res = await mb(`/recording?query=${encodeURIComponent(query)}&limit=10`);
  if (!res.recordings.length && release) {
    res = await mb(`/recording?query=${encodeURIComponent(`recording:${quote(title)} AND artist:${quote(artist)}`)}&limit=10`);
  }
  const recs = res.recordings.filter((r) => r.score >= 85 && sameTitle(r.title, title)).slice(0, max);
  const found = [], checked = [];
  for (const r of recs) {
    const rec = await mb(`/recording/${r.id}?inc=artist-rels+work-rels+releases`);
    const url = `https://musicbrainz.org/recording/${r.id}`;
    checked.push({ source: 'MusicBrainz', url, what: rec.title });
    let n = 0;
    for (const rel of rec.relations || []) {
      if (rel.artist && MB_ROLES.test(rel.type)) {
        found.push({ name: rel.artist.name, role: [rel.type, ...(rel.attributes || [])].join(' '), scope: 'brano', source: 'MusicBrainz', where: rec.title, url });
        n++;
      }
    }
    // Arrangers are often credited on the release ("arranger" for the whole album).
    const first = (rec.releases || [])[0];
    if (first) {
      const relx = await mb(`/release/${first.id}?inc=artist-rels`);
      const rurl = `https://musicbrainz.org/release/${first.id}`;
      for (const rel of relx.relations || []) {
        if (rel.artist && MB_ROLES.test(rel.type)) {
          found.push({ name: rel.artist.name, role: [rel.type, ...(rel.attributes || [])].join(' '), scope: 'disco', source: 'MusicBrainz', where: relx.title, url: rurl });
          n++;
        }
      }
    }
    log(`MusicBrainz: ${rec.title}: ${n} crediti`);
  }
  if (!recs.length) log('MusicBrainz: nessuna registrazione trovata');
  return { found, checked };
}

// ---------- Wikipedia ----------
const wiki = (params) => get('https://en.wikipedia.org/w/api.php?format=json&' + new URLSearchParams(params),
  { host: 'wikipedia', gap: 2100 });
// "[[Greg Adams (musician)|Greg Adams]]" -> "Greg Adams"; templates and refs removed.
const unwiki = (s) => s.replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/\{\{[^{}]*\}\}/g, '')
  .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// Track number of a title in a Wikipedia track listing, or null. Two formats:
// the template ("| title5 = Squib Cakes") and a numbered list ('#"Squib Cakes" (Chester Thompson) - 7:49').
function trackNumber(text, title) {
  const re = /\|\s*title(\d+)\s*=\s*([^\n|]+)/g;
  let m;
  while ((m = re.exec(text))) if (sameTitle(unwiki(m[2]).replace(/^"|"$/g, ''), title)) return Number(m[1]);
  const i = text.search(/==\s*Track listing\s*==/i);
  if (i < 0) return null;
  let n = 0;
  for (const line of text.slice(i).split('\n').slice(1)) {
    if (/^==[^=]/.test(line)) break;
    // A new side ("=== Side two ===") keeps counting: Wikipedia credits use the album-wide number.
    const q = line.match(/^#\s*"([^"]+)"/);
    if (!q) continue;
    n++;
    if (sameTitle(unwiki(q[1]), title)) return n;
  }
  return null;
}
// Track numbers next to an arranger credit, e.g. "arrangements (3, 4, 6–8)" -> Set {3,4,6,7,8}; null when there are none.
function arrangerTracks(role) {
  const m = role.match(/arrang[^()]*\(([\d\s,–−-]+)\)/i);
  if (!m) return null;
  const set = new Set();
  for (const part of m[1].split(',')) {
    const [x, y] = part.split(/[–−-]/).map((s) => Number(s.trim()));
    if (!x) continue;
    for (let i = x; i <= (y || x); i++) set.add(i);
  }
  return set.size ? set : null;
}

async function fromWikipedia({ artist, title, release, max = 3 }, log) {
  const found = [], checked = [];
  const queries = [...new Set([release && `${release} ${artist} album`, `${title} ${artist}`].filter(Boolean))];
  const pages = [];
  for (const q of queries) {
    const res = await wiki({ action: 'query', list: 'search', srsearch: q, srlimit: '3' });
    for (const p of res.query.search) if (!pages.includes(p.title)) pages.push(p.title);
  }
  const a = norm(artist), t = norm(title);
  for (const page of pages.slice(0, max + 1)) {
    const res = await wiki({ action: 'parse', page, prop: 'wikitext', redirects: '1' });
    if (!res.parse) continue;
    const text = res.parse.wikitext['*'];
    // Only pages about this artist that mention the track.
    const flat = norm(text);
    if (!flat.includes(a) || !flat.includes(t)) continue;
    const url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(res.parse.title.replace(/ /g, '_'));
    const n0 = trackNumber(text, title);
    checked.push({ source: 'Wikipedia', url, what: res.parse.title, track: n0 ? `traccia ${n0}` : null });
    let n = 0;
    for (const raw of text.split('\n')) {
      if (!ROLE.test(raw) || /^\[\[Category/i.test(raw)) continue;
      const line = unwiki(raw);
      if (!line || line.length > 400) continue;
      // Personnel list: "* Name – arranger" or infobox "| arranger = Name".
      const m = line.match(/^\*\s*(.+?)\s+[–—-]\s+(.*)$/) || line.match(/^\|\s*(arranger\w*)\s*=\s*(.+)$/i);
      const infobox = m && m[1].toLowerCase().startsWith('arranger');
      // Other lines: only sentences like "All songs were ... arranged by X"; infobox fields such as "occupation = arranger" are noise.
      if (!m && (/^\|/.test(line) || !/arranged\b.{0,40}\bby|arrangements? by/i.test(line))) continue;
      const name = m ? (infobox ? m[2] : m[1]) : null;
      const role = m ? (infobox ? 'arranger' : m[2]) : line.slice(0, 200);
      // "arrangements (3, 4)": credits limited to some tracks; skip them when our track is not among them.
      const nums = arrangerTracks(role);
      if (nums && n0 && !nums.has(n0)) continue;
      found.push({ name: name ? name.trim() : null, role, scope: nums && n0 ? 'brano' : 'pagina', source: 'Wikipedia', where: res.parse.title, url });
      n++;
    }
    log(`Wikipedia: ${res.parse.title}${n0 ? ` (traccia ${n0})` : ''}: ${n} crediti`);
  }
  if (!checked.length) log('Wikipedia: nessuna pagina pertinente');
  return { found, checked };
}

// ---------- all sources ----------
async function findArrangers(input, { sources = ['discogs', 'musicbrainz', 'wikipedia'], log = () => {} } = {}) {
  if (!input.artist || !input.title) throw new Error('Servono almeno artista e titolo del brano');
  const all = { found: [], checked: [], errors: [] };
  const run = { discogs: fromDiscogs, musicbrainz: fromMusicBrainz, wikipedia: fromWikipedia };
  for (const s of sources) {
    try {
      const r = await run[s](input, log);
      all.found.push(...r.found); all.checked.push(...r.checked);
    } catch (e) { all.errors.push(`${s}: ${e.message}`); log(`${s}: errore – ${e.message}`); }
  }
  // Same person from several sources: one line per name, sources listed together.
  const byName = new Map();
  for (const f of all.found) {
    const k = f.name ? norm(f.name) : `?${byName.size}`;
    if (!byName.has(k)) byName.set(k, { name: f.name, credits: [] });
    byName.get(k).credits.push(f);
  }
  all.people = [...byName.values()].sort((x, y) => (y.credits.some((c) => c.scope === 'brano') - x.credits.some((c) => c.scope === 'brano')) || y.credits.length - x.credits.length);
  return all;
}

// Discogs pages already saved as sources for a break (their titles name the artist and the record).
function discogsRefsFor(b, sources) {
  const a = norm(b.artist), t = norm(b.title), al = norm(b.album);
  return sources.filter((s) => /discogs\.com\/(?:[a-z]{2}\/)?(release|master)\//.test(s.url))
    .filter((s) => { const x = norm(s.title); return x.includes(a) && (x.includes(t) || (al && x.includes(al))); })
    .map((s) => s.url);
}

module.exports = { findArrangers, discogsRefsFor, parseDiscogs, sameTitle, coversPosition };
