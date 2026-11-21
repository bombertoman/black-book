#!/usr/bin/env node
// Black Book CLI. Run `node bb.js help`.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('./lib/store');

const HELP = `Black Book – drum breaks

  node bb.js add "Titolo - Artista" [opzioni]     aggiunge un break
  node bb.js add                                  aggiunta guidata (domande)
  node bb.js import <file.json | ->               aggiunge da JSON (array, oggetto o una riga per oggetto); "-" = stdin
                                                  batch completo: { "breaks": [..], "drummers": {..}, "sources": [..] }
  node bb.js list [testo]                         elenca / cerca
  node bb.js rm <id>                              rimuove un break
  node bb.js drummer "Nome" --role ".." --other ".."   scheda batterista
  node bb.js source "Titolo" <url>                aggiunge una fonte
  node bb.js serve [porta]                        avvia la webapp in locale (default 4173)

Opzioni di add (ripetibili per più nomi, oppure separati da ";"):
  -t --title      -a --artist     -r --release "Album (1973), lato A"   -b --album "Album"   -y --year
  -d --drummer    -p --producer   -x --arranger   -l --label
  --type famoso|documentato|scoperta   --ubb 6
  --drummer-text / --producer-text / --arranger-text / --label-text   testo libero mostrato al posto dei nomi
  --force   sostituisce un break esistente      --push   git commit + push dopo la modifica

Esempio:
  node bb.js add "Impeach the President - The Honey Drippers" -r "45 giri (1973)" -l Alaga --ubb 11 --push`;

const SHORT = { t: 'title', a: 'artist', r: 'release', b: 'album', y: 'year', d: 'drummer', p: 'producer', x: 'arranger', l: 'label' };
const BOOL = new Set(['force', 'push', 'help']);

function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/) || a.match(/^-([a-z])$/);
    if (!m || a === '-') { pos.push(a); continue; }
    const key = SHORT[m[1]] || m[1];
    if (BOOL.has(key)) { opt[key] = true; continue; }
    const val = m[2] !== undefined ? m[2] : argv[++i];
    if (val === undefined) throw new Error(`Manca il valore per ${a}`);
    opt[key] = key in opt ? [].concat(opt[key], val) : val;
  }
  return { pos, opt };
}

function push(message) {
  const git = (...args) => execFileSync('git', args, { cwd: __dirname, stdio: 'inherit' });
  git('add', 'data');
  git('commit', '-m', message);
  git('push');
}

const line = (b) => `${b.title} – ${b.artist}${b.year ? ` (${b.year})` : ''}  [${b.id}]`;

async function ask() {
  const rl = require('readline/promises').createInterface({ input: process.stdin, output: process.stdout });
  const q = async (label) => (await rl.question(label + ': ')).trim();
  const b = {
    title: await q('Titolo'), artist: await q('Artista'), release: await q('Disco, es. "Album (1973), lato A"'),
    album: await q('Album (vuoto se solo 45 giri)'),
    drummers: await q('Batteristi (separati da ;)'),
    producers: await q('Produttori (;)'), arrangers: await q('Arrangiatori (;)'), labels: await q('Etichette (;)'),
    type: await q('Tipo [famoso/documentato/scoperta] (vuoto = scoperta)'), ubb: await q('Volume UBB (vuoto = nessuno)'),
  };
  rl.close();
  return b;
}

function parseJson(text) {
  text = text.trim();
  try { return JSON.parse(text); } catch (e) {
    // Not one JSON document: read it as one object per line.
    return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parse(rest);
  if (!cmd || cmd === 'help' || opt.help) return console.log(HELP);

  if (cmd === 'add') {
    const { force, push: doPush, ...fields } = opt;
    let input = fields;
    if (pos[0]) input.title = input.title || pos[0];
    if (!Object.keys(input).length) input = await ask();
    const res = store.addBreaks(input, { force });
    const b = res.added[0] || res.updated[0];
    console.log(`${res.added.length ? 'Aggiunto' : 'Aggiornato'}: ${line(b)}  (${res.total} break)`);
    if (doPush) push(`Add break: ${b.title} – ${b.artist}`);
  } else if (cmd === 'import') {
    if (!pos[0]) throw new Error('Indica un file JSON oppure "-" per stdin');
    const text = fs.readFileSync(pos[0] === '-' ? 0 : path.resolve(pos[0]), 'utf8');
    const res = store.addBatch(parseJson(text), { force: opt.force });
    console.log(`Aggiunti ${res.added.length}, aggiornati ${res.updated.length} (${res.total} break)`);
    if (res.drummerCards || res.sourcesAdded) console.log(`Schede batterista: ${res.drummerCards}, fonti nuove: ${res.sourcesAdded}`);
    for (const k of store.KINDS) if (res.newNames[k].length) console.log(`Nomi nuovi, controlla la grafia – ${store.KIND_LABELS[k]}: ${res.newNames[k].join('; ')}`);
    for (const w of res.warnings) console.log(`ATTENZIONE – ${w}`);
    if (opt.push) push(`Add ${res.added.length + res.updated.length} breaks`);
  } else if (cmd === 'list') {
    const q = pos.join(' ').toLowerCase();
    const hits = store.read('breaks').filter((b) => !q || JSON.stringify(b).toLowerCase().includes(q));
    hits.forEach((b) => console.log(line(b)));
    console.log(`${hits.length} break`);
  } else if (cmd === 'rm') {
    if (!pos[0]) throw new Error('Indica l\'id (vedi `list`)');
    console.log('Rimosso: ' + line(store.removeBreak(pos[0])));
    if (opt.push) push(`Remove break: ${pos[0]}`);
  } else if (cmd === 'drummer') {
    if (!pos[0]) throw new Error('Indica il nome del batterista');
    console.log(pos[0], store.setDrummer(pos[0], { role: opt.role, other: opt.other, fullName: opt['full-name'] }));
    if (opt.push) push(`Update drummer: ${pos[0]}`);
  } else if (cmd === 'source') {
    if (!pos[1]) throw new Error('Uso: source "Titolo" <url>');
    console.log(`Fonti: ${store.addSource(pos[0], pos[1])}`);
    if (opt.push) push(`Add source: ${pos[0]}`);
  } else if (cmd === 'serve') {
    require('./server').start(Number(pos[0]) || undefined);
  } else {
    throw new Error(`Comando sconosciuto: ${cmd}\n\n${HELP}`);
  }
}

main().catch((e) => { console.error('Errore: ' + e.message); process.exit(1); });
