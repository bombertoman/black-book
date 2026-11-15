# Black Book – drum breaks

Database di drum break con batteristi, produttori ed etichette. Webapp statica, nessuna dipendenza.

## Avvio

```bash
node server.js
```

Apri http://localhost:4173. In locale compare il pulsante **+ Aggiungi**; la copia pubblicata è in sola lettura.

## Dati

- `data/breaks.json` — i break (fonte unica)
- `data/drummers.json` — ruolo e altri dischi dei batteristi
- `data/sources.json` — fonti

Artisti, album, produttori, etichette e calore sono calcolati dai break.

## Aggiungere break

Riga di comando:

```bash
node bb.js add "Impeach the President - The Honey Drippers" -r "45 giri (1973)" -l Alaga --ubb 11
node bb.js add            # aggiunta guidata
node bb.js import nuovi.json
echo '{"title":"X - Y","year":1974,"drummer":"A;B"}' | node bb.js import -
node bb.js help           # tutti i comandi
```

HTTP (server locale acceso):

```bash
curl -X POST localhost:4173/api/breaks -H "Content-Type: application/json" -d '{"title":"X","artist":"Y","year":1974}'
```

Campi: `title`, `artist`, `release`, `album`, `year`, `where`, `drummers`, `producers`, `labels` (array oppure nomi separati da `;`),
`drummerText` / `producerText` / `labelText` (testo libero con note), `type` (`famoso`, `documentato`, `scoperta`), `ubb`.
Valgono anche i nomi italiani (`brano`, `artista`, `disco`, `anno`, `dove`, `batterista`, `produttore`, `etichetta`, `tipo`).

Senza `type`: `famoso` se c'è `ubb`, altrimenti `scoperta`. L'anno si ricava dal disco se manca.

### Batch completo

`import` e `POST /api/breaks` accettano anche un oggetto con break, schede batterista e fonti insieme:

```json
{
  "breaks": [
    { "title": "Titolo", "artist": "Artista", "release": "Album (1974), lato A, traccia 2", "album": "Album", "drummers": ["Nome Cognome"], "labels": ["Kudu (CTI)"] }
  ],
  "drummers": {
    "Nome Cognome": { "role": "Turnista", "other": "Altri dischi", "fullName": "Nome \"Soprannome\" Cognome" }
  },
  "sources": [
    { "title": "Discogs – Titolo", "url": "https://..." }
  ]
}
```

Regole per i nomi (il calore conta le stringhe identiche):

- Persone: `Nome Cognome`, mai `Cognome, Nome`. Stessa grafia già presente nel database.
- Gruppo come produttore: stessa grafia del campo artista, con "The" se c'è (`The Fatback Band`, `The Isley Brothers`).
- Artista: il nome intero che c'è sul disco (`Kool & the Gang`, `The Jimmy Castor Bunch`, `Roy Ayers Ubiquity`).
  Si uniforma solo se lo stesso artista è già nel database con un altro nome. Allora si usa la parte comune ai due nomi e il nome sul disco va in `release`:
  `The J.B.'s` + `…, come Fred Wesley & the J.B.'s`; `Tullio De Piscopo` + `…, come Tullio De Piscopo Revolt Group`.
- Album: solo il titolo dell'LP o EP che contiene il brano, scritto come sul disco. Il calore dell'album conta i break con lo stesso titolo.
  45 giri poi uscito su LP: l'LP (`Did You Heard Me?`). Solo 45 giri o 12": niente `album`. Compilation dell'artista: vale (`Disco-Funk`).
  Due album diversi con lo stesso titolo: aggiungi l'artista tra parentesi (`Soul Makossa (Afrique)`).
- Etichetta con casa madre: tutta nel campo `labels`, es. `Kudu (CTI)`. Niente `labelText`.
  Il calore conta il nome senza la casa madre: `Dial (Atlantic)` e `Dial (Mercury)` sono entrambe Dial.
- `drummerText` / `producerText` / `labelText` solo per note (`(probabile)`, `(crediti dell'album)`), e devono contenere i nomi così come sono negli array.

L'import elenca i nomi mai visti prima (artisti, album, batteristi, produttori, etichette): se uno esiste già con un'altra grafia, correggi e reimporta con `--force`.
Segnala con `ATTENZIONE` i nomi nuovi che contengono un nome già presente o ci sono contenuti (`Tom Scott` / `Tom Scott & the L.A. Express`),
e gli album già presenti con un altro artista.

`--push` dopo un comando esegue `git commit` + `git push`: con GitHub Pages il sito si aggiorna da solo.
