# GitDom — Roadmap

> Versione 0.6.0 pubblicata il 2026-09-25 (Step 1–5 completati). Gli ID tra parentesi rimandano a [REQUISITI.md](REQUISITI.md).

## Dove siamo

Le milestone 0–5 sono completate:

- grafo dei commit virtualizzato;
- staging per file, hunk e riga;
- branch, remoti, stash e tag;
- merge, rebase e rebase interattivo, con risoluzione dei conflitti;
- cherry-pick, revert, reset e undo/redo;
- command palette, terminale integrato, blame e cronologia file;
- submodule, LFS e profili di identità;
- temi Scuro, Chiaro e Studio, animazioni e logo all'avvio;
- exe portable generato da GitHub Actions;
- clone e nuovo repository, preferiti (Step 1);
- preferenze, zoom, pannelli ridimensionabili, editor e merge tool esterni (Step 2);
- diff affiancato, parole evidenziate, opzioni del diff, confronto tra revisioni e diff delle immagini (Step 3);
- ricerca nel grafo, colonne configurabili, branch nascosti o isolati, avatar, stash nel grafo e minimap (Step 4);
- log attività, backup automatici, reflog consultabile, avviso di nuova versione e changelog (Step 5).

I requisiti P0 sono coperti; resta buona parte dei P1, a partire dai commit completi: firma, hook, reword (Step 6).

## Principi per l'ordine

1. Prima i buchi che impediscono l'uso quotidiano, poi la comodità, infine integrazioni e AI.
2. Ogni step è una versione pubblicabile con un tag `v0.x.0`: GitHub genera l'exe da solo.
3. Ogni operazione git nuova arriva con i suoi test su repository fixture (NFR-11).

---

## Step 1 — v0.2: Clone e nuovo repository ✅

> Completato: finestre Clone e Nuovo repository nel menu File, nella schermata iniziale e nella command palette.

Chiude i requisiti P0 mancanti per iniziare a lavorare su un progetto senza usare il terminale.

- **Clone da URL** HTTPS/SSH con barra di avanzamento e annullamento (REPO-02)
- Opzioni di clone: branch, profondità, submodule ricorsivi (REPO-11)
- **Nuovo repository** con `git init` e template per .gitignore, README e licenza (REPO-03)
- Preferiti tra i repository recenti (REPO-05)

## Step 2 — v0.3: Impostazioni ✅

> Completato: finestra Preferenze (File → Preferences, Ctrl+,), zoom con indicatore nella barra di stato, pannelli laterali ridimensionabili, editor e merge tool esterni.

Oggi molti comportamenti sono fissi nel codice, per esempio il fetch ogni 10 minuti.

- **Finestra Preferenze**, anche da File → Preferences (SET-01):
  - tema, font e dimensione del testo;
  - intervallo dell'auto-fetch e strategia di pull predefinita (SET-02);
  - percorso dell'eseguibile git (SET-04).
- **Editor e merge tool esterni** configurabili, per esempio VS Code (DIFF-12, MERGE-08)
- **Zoom** dell'interfaccia con Ctrl+/Ctrl−, mostrato nella barra di stato (UI-06)
- **Pannelli ridimensionabili** trascinando i bordi, con dimensioni salvate (UI-11, SIDE-10)

## Step 3 — v0.4: Diff di nuova generazione ✅

> Completato: vista unificata o affiancata, parole cambiate evidenziate, barra delle opzioni (file intero, contesto, ignora spazi, a capo), confronto tra due commit o con un branch/tag dai menu del grafo, diff delle immagini in tre modalità.

- **Vista affiancata** (split) oltre a quella unificata (DIFF-01)
- **Evidenziazione intra-riga** delle parole cambiate (DIFF-03)
- Opzioni: ignora spazi, righe di contesto, a capo automatico (DIFF-04)
- **File completo** con le modifiche evidenziate (DIFF-05)
- **Confronto tra due commit o branch qualsiasi**, selezionandoli nel grafo (DIFF-08)
- Diff delle immagini: affiancate, sovrapposte, a scorrimento (DIFF-06)

## Step 4 — v0.5: Grafo più potente ✅

> Completato: barra di ricerca sopra il grafo (Ctrl+F) su commit o file, con risultati evidenziati, navigazione e filtro; colonne SHA, autore e data ridimensionabili e nascondibili; "Nascondi nel grafo" e "Mostra solo questo branch" dai menu; avatar Gravatar/GitHub; stash come nodi; evidenziazione del branch sotto il mouse; minimap al posto della barra di scorrimento.

- **Ricerca e filtro** per messaggio, autore, SHA o file, con evidenziazione dei risultati (GRAPH-17)
- Colonne ridimensionabili e nascondibili (GRAPH-03)
- Nascondere un branch, oppure mostrare solo quello (GRAPH-14)
- **Avatar** degli autori da Gravatar, con le iniziali come ripiego offline (GRAPH-04)
- **Stash come nodi** nel grafo (STASH-03)
- Evidenziazione del branch al passaggio del mouse e minimap con indicatori (GRAPH-15, GRAPH-16)

## Step 5 — v0.6: Trasparenza e rete di sicurezza ✅

> Completato: pannello Attività (Ctrl+Shift+L) con i comandi git raggruppati per azione, durata, esito e output, credenziali nascoste; backup dei branch prima di reset, rebase e force push, con ripristino, creazione di un branch e undo del ripristino; vista Reflog di HEAD e di ogni branch, con i commit fuori dal grafo segnalati. In più, anticipati dallo Step 10: avviso all'avvio quando su GitHub c'è una versione più recente, con il link per scaricarla, e un CHANGELOG mostrato dopo ogni aggiornamento (Aiuto → What's New) e usato come note delle release.

Serve a fidarsi dell'app anche nelle operazioni rischiose.

- **Log attività**: pannello con ogni comando git eseguito, la sua durata e il suo output (UI-09, NFR-07)
- **Backup automatico** dei riferimenti prima di reset, rebase e force push, ripristinabile con un clic (NFR-04)
- **Reflog consultabile**, per recuperare commit "persi" oltre il semplice undo (ADV-05)

## Step 6 — v0.7: Commit completi

- **Firma GPG/SSH** di commit e tag, con indicatore di firma verificata (COMMIT-09, ADV-09, DETAIL-05)
- Opzione "salta gli hook" (`--no-verify`) (COMMIT-09)
- **Aggiungi a .gitignore** dal menu dei file (COMMIT-11)
- **Modifica del messaggio (reword)** direttamente dal pannello dettagli (DETAIL-04)
- Template del messaggio e suggerimenti dai commit precedenti (COMMIT-10)
- Stash con i file untracked, stash solo dei file selezionati, auto-stash prima di checkout, pull e rebase (STASH-05, STASH-06)

## Step 7 — v0.8: Worktree e workspace

- **Worktree**: aggiunta, elenco, rimozione, e una sezione nella barra laterale (REPO-09, SIDE-06)
- **Selettore rapido** dei repository dalla toolbar (REPO-06)
- **Workspace**: gruppi di repository che si riaprono insieme, per esempio "lavoro" e "personale" (REPO-07)

## Step 8 — v0.9: Prestazioni e repository enormi

- Benchmark su repository molto grandi, come il kernel Linux con oltre un milione di commit (NFR-02, NFR-03)
- **Caricamento incrementale** oltre il limite attuale di commit caricati (GRAPH-08)
- Divisione del bundle, oggi 1,6 MB in un unico file, per un avvio più rapido
- Misura della RAM con 5 repository aperti (NFR-10)

## Step 9 — v1.0: Tastiera, accessibilità, rifinitura

Obiettivo della v1.0: tutti i requisiti P0 e P1 coperti.

- **Scorciatoie personalizzabili**, con un elenco consultabile (UI-03)
- Navigazione completa da tastiera: grafo, liste dei file, diff (NFR-09)
- Verifica del contrasto dei tre temi; possibilità di **temi personalizzati** (UI-05)
- Pulizia dei requisiti P1 rimasti, aggiornamento di README e screenshot

## Step 10 — v1.1: Aggiornamenti e qualità del rilascio

- ~~Avviso di nuova versione~~ e ~~changelog~~: anticipati nello Step 5 (NFR-08)
- **Aggiornamento dall'app**: scaricare e sostituire l'exe senza passare dal browser
- **CI su ogni push**: lint, typecheck e test su GitHub Actions, non solo al momento del rilascio

## Step 11 — v1.2: Integrazione GitHub

- **Login con GitHub** tramite device flow OAuth, con token salvato cifrato con `safeStorage` (AUTH-06, NFR-06)
- **Pull request**: elenco, creazione dal branch corrente, stato delle review, merge (INT-01, SIDE-07)
- **Stato CI** accanto ai commit nel grafo (INT-03)
- **Issue**: elenco, e creazione di un branch da una issue (INT-02, SIDE-08)
- Dashboard personale con PR e issue di tutti i repository (INT-05)

## Step 12 — v1.3: Assistente AI

Opzionale, con chiave API fornita dall'utente e salvata cifrata. Usa i modelli Claude.

- **Messaggio di commit generato** dalle modifiche in stage (AI-01)
- **Spiegazione** di un commit o di un branch (AI-03)
- **Aiuto sui conflitti**: proposta di risoluzione da confermare (AI-04)
- **Descrizione della PR** generata (AI-05)
- **Divisione delle modifiche** in più commit logici (AI-02)

## Step 13 — v1.4: Funzioni avanzate

- **Bisect guidato**: segni "buono/cattivo" e l'app trova il commit colpevole (ADV-06)
- **Patch**: creazione da commit e applicazione di file .patch (ADV-07)
- **Git Flow**: feature, release e hotfix (ADV-04)
- Sparse checkout, repository bare e shallow (ADV-08, REPO-10)

---

## Idee oltre i requisiti

- **Variante chiara del tema Studio**, per chi vuole il layout Studio ma con fondo chiaro
- **Statistiche del repository**: autori più attivi, frequenza dei commit, file più modificati
- **Timeline animata** della storia del repository, in stile con il logo dell'autostrada
- **Condivisione della configurazione** (temi, profili, scorciatoie) tramite un file esportabile (SET-05)
