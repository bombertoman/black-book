# Black Book – drum breaks

Database di drum break con batteristi, produttori ed etichette. Webapp statica, nessuna dipendenza.

## Avvio

```bash
node server.js
```

Apri http://localhost:4173. La webapp è in sola lettura, sia in locale sia pubblicata: i break si aggiungono solo da riga di comando.

## Dati

- `data/breaks.json` — i break (fonte unica)
- `data/drummers.json` — ruolo e altri dischi dei batteristi
- `data/sources.json` — fonti

Artisti, album, produttori, arrangiatori, etichette e calore sono calcolati dai break.

Calore: 2–3 azzurro, 4–5 verde, 6–7 giallo, da 8 in su rosso.

## Aggiungere break

Riga di comando:

```bash
node bb.js add "Impeach the President - The Honey Drippers" -r "45 giri (1973)" -l Alaga --ubb 11
node bb.js add            # aggiunta guidata
node bb.js import nuovi.json
echo '{"title":"X - Y","year":1974,"drummer":"A;B"}' | node bb.js import -
node bb.js help           # tutti i comandi
```

Campi: `title`, `artist`, `release`, `album`, `year`, `drummers`, `producers`, `arrangers`, `labels` (array oppure nomi separati da `;`),
`drummerText` / `producerText` / `arrangerText` / `labelText` (testo libero con note), `type` (`famoso`, `documentato`, `scoperta`), `ubb`.
Valgono anche i nomi italiani (`brano`, `artista`, `disco`, `anno`, `batterista`, `produttore`, `arrangiatore`, `etichetta`, `tipo`).
`arrangers` è facoltativo: chi ha arrangiato il brano ("arr." sul disco), solo l'arrangiamento generale o ritmico, non archi, fiati o voci.

### Cercare gli arrangiatori

```bash
node bb.js arr "Tower of Power" "Squib Cakes" "Back to Oakland"   # artista, titolo, album o singolo (facoltativo)
node bb.js arr --id squib-cakes-tower-of-power                     # un break del database
node bb.js arr --missing --limit 10 --out arr.json                 # i break senza arrangiatore, 10 alla volta
```

Con `--missing` cerca 2 break alla volta (`--jobs N` per cambiare): ogni sito riceve comunque una richiesta per volta, nei suoi limiti.
Il rapporto `--out` viene salvato dopo ogni break, quindi un giro lungo interrotto a metà non perde niente.

Il Black Book è sulla batteria: contano solo gli arrangiamenti che la riguardano, cioè quello generale del brano o quello ritmico.
I crediti solo per archi, fiati, voci, sintetizzatori o orchestra ("Arranged By [Strings]", "vocal arranger") vengono scartati ed elencati a parte.
Eccezione: chi è anche batterista del disco si tiene.
Se l'album accredita più arrangiatori senza dire chi ha fatto quale brano, i nomi vanno solo in `arrangerText`
("Non si sa chi: l'album accredita X e Y"), così non contano nel calore.

Cerca su Discogs (crediti del brano e del disco) e MusicBrainz (relazioni "arranger") insieme.
Wikipedia (righe del personale con "arrang") aggiunge di rado nomi nuovi, quindi fa da spareggio: viene consultata solo se
Discogs e MusicBrainz indicano persone diverse, o se sono entrambi vuoti e il break è su un album. `--wiki` la consulta sempre, `--nowiki` mai.
Per i break del database usa le pagine Discogs già tra le fonti; altrimenti cerca la release, una per master.
Non scrive nulla: mostra i candidati con la pagina da cui vengono, e `scope` dice se il credito è sul brano o su tutto il disco.
`--only discogs,musicbrainz,wikipedia` sceglie le fonti, `--discogs <url>` indica la release giusta, `--json` dà l'uscita grezza.
Discogs senza token accetta 25 richieste al minuto: con un token personale in `DISCOGS_TOKEN` la ricerca è più veloce.

Senza `type`: `famoso` se c'è `ubb`, altrimenti `scoperta`. L'anno si ricava dal disco se manca.

### Batch completo

`import` accetta anche un oggetto con break, schede batterista e fonti insieme:

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
