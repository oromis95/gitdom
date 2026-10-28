# GitDom — Roadmap

> Versione 1.15.1 pubblicata il 2026-10-28 (Step 1–21 completati). Gli ID tra parentesi rimandano a [REQUISITI.md](REQUISITI.md).

## Dove siamo

Le milestone 0–6 sono completate:

- grafo dei commit virtualizzato;
- staging per file, hunk e riga;
- branch, remoti, stash e tag;
- merge, rebase e rebase interattivo, con risoluzione dei conflitti;
- cherry-pick, revert, reset e undo/redo;
- command palette, terminale integrato, blame e cronologia file;
- submodule, LFS e profili di identità;
- temi Scuro, Chiaro e Studio, animazioni e logo all'avvio;
- exe portable e installer generati da GitHub Actions;
- clone e nuovo repository, preferiti (Step 1);
- preferenze, zoom, pannelli ridimensionabili, editor e merge tool esterni (Step 2);
- diff affiancato, parole evidenziate, opzioni del diff, confronto tra revisioni e diff delle immagini (Step 3);
- ricerca nel grafo, colonne configurabili, branch nascosti o isolati, avatar, stash nel grafo e minimap (Step 4);
- log attività, backup automatici, reflog consultabile, avviso di nuova versione e changelog (Step 5);
- firma GPG/SSH di commit e tag, opzioni del commit, reword, template, .gitignore e stash parziali (Step 6);
- worktree, selettore rapido dei repository e workspace (Step 7);
- caricamento a pagine per storie di ogni dimensione, aperture più rapide e bundle diviso (Step 8);
- temi pronti e personalizzati con verifica del contrasto, scorciatoie personalizzabili, navigazione completa da tastiera, editor della configurazione git e diff tool esterno (Step 9);
- aggiornamento dall'app con verifica SHA-256 e CI su ogni push (Step 10);
- statistiche del repository, storia di righe e funzioni, ricerca nel codice, file a qualsiasi commit e blame a ritroso (Step 11);
- commit spostati su un altro branch, fixup, divisione e riordino dei commit, hunk modificati prima dello stage, anteprima dei conflitti, controlli prima del commit, note di rilascio, regole di ignore spiegate, pulizia dei file non tracciati e suggerimenti animati (Step 12).

Con la v1.0 i requisiti P0 e P1 sono coperti; il prossimo passo è l'ordine e la manutenzione: panoramica dei branch, salute del repository, hook e più repository insieme (Step 13).

## Principi per l'ordine

1. Prima i buchi che impediscono l'uso quotidiano, poi la comodità, infine integrazioni e AI.
2. Ogni step è una versione pubblicabile con un tag `v0.x.0`: GitHub genera l'exe da solo.
3. Ogni operazione git nuova arriva con i suoi test su repository fixture (NFR-11).
4. Prima le funzioni che lavorano solo in locale, senza servizi esterni; integrazioni e AI restano in fondo, facoltative ("Forse, un giorno").

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

## Step 6 — v0.7: Commit completi ✅

> Completato: opzioni del commit (salta gli hook, firma sì/no, autore alternativo) con un riepilogo sotto il box del messaggio; firma di commit e tag annotati con chiavi GPG, SSH o X.509, configurabile per repository o globale dal menu identità, e badge nel pannello dettagli (verificata, chiave non attendibile, non valida). Se la configurazione globale ha `gpg.ssh.program` vuoto, GitDom usa comunque il programma predefinito. Reword dal pannello dettagli anche per i commit più vecchi, con backup e undo, senza eseguire gli hook; template `commit.template` e riuso dei messaggi recenti; "Aggiungi a .gitignore" per file, estensione o cartella, togliendo dall'indice i file tracciati; stash dei soli file in stage o di un singolo file; preferenza per lo stash automatico al checkout, e merge con `--autostash` come pull e rebase.

- **Firma GPG/SSH** di commit e tag, con indicatore di firma verificata (COMMIT-09, ADV-09, DETAIL-05)
- Opzione "salta gli hook" (`--no-verify`) (COMMIT-09)
- **Aggiungi a .gitignore** dal menu dei file (COMMIT-11)
- **Modifica del messaggio (reword)** direttamente dal pannello dettagli (DETAIL-04)
- Template del messaggio e suggerimenti dai commit precedenti (COMMIT-10)
- Stash con i file untracked, stash solo dei file selezionati, auto-stash prima di checkout, pull e rebase (STASH-05, STASH-06)
- v0.7.2: **schede al passaggio del mouse** su autori, commit (con i file modificati), branch, tag e stash, disattivabili dalle Preferenze (UI-13)

## Step 7 — v0.8: Worktree e workspace ✅

> Completato: "Check out in a new worktree…" dai menu dei branch (anche remoti) e "Create worktree here…" dai commit, con la cartella proposta accanto al repository e il pulsante Sfoglia; sezione WORKTREES nella barra laterale con scheda al passaggio del mouse, blocco/sblocco, rimozione (chiudendo prima la scheda, con conferma se ci sono modifiche) e pulizia di quelli con la cartella mancante; il checkout di un branch già aperto in un altro worktree propone di aprire quello. Il watcher segue anche i worktree collegati, quindi i commit fatti da terminale compaiono subito. Selettore rapido sul nome del repository nella toolbar, con ricerca tra schede aperte, preferiti e recenti; workspace salvati dalle schede aperte e riaperti accanto a quelle esistenti o al loro posto, anche dalla palette.

- **Worktree**: aggiunta, elenco, rimozione, e una sezione nella barra laterale (REPO-09, SIDE-06)
- **Selettore rapido** dei repository dalla toolbar (REPO-06)
- **Workspace**: gruppi di repository che si riaprono insieme, per esempio "lavoro" e "personale" (REPO-07)

## Step 8 — v0.9: Prestazioni e repository enormi ✅

> Completato: il grafo carica 10.000 commit e i successivi a pagine durante lo scroll; se un repository grande non ha il file commit-graph di git, GitDom lo scrive in background. Ogni apertura avvia la metà dei processi git: HEAD e cartelle git vengono letti dal disco, identità e firma arrivano da una sola chiamata, stash e worktree si chiedono solo se esistono. Il bundle è diviso: diff, terminale, editor del rebase e preferenze si caricano al primo uso (avvio da 1,8 MB a 400 kB, ora minificato). Misure su questo PC, con un repository sintetico da 1.000.000 di commit: apertura in 1,3 s con commit-graph (circa 5 s senza, solo la prima volta); scroll a 60 fps (16,7 ms per frame); ogni pagina da 10.000 commit in 0,9 s. Un repository piccolo si apre in 0,65 s invece di 1,2 s. Memoria con 5 repository aperti (quello da un milione compreso): circa 590 MB in totale, sotto il limite di 800 MB. Benchmark ripetibile con `GITDOM_BENCH=<percorso> npx vitest run bench`.

- Benchmark su repository molto grandi, come il kernel Linux con oltre un milione di commit (NFR-02, NFR-03)
- **Caricamento incrementale** oltre il limite attuale di commit caricati (GRAPH-08)
- Divisione del bundle, oggi 1,6 MB in un unico file, per un avvio più rapido
- Misura della RAM con 5 repository aperti (NFR-10)

## Step 9 — v1.0: Tastiera, accessibilità, rifinitura ✅

> Completato: 11 temi pronti (Nord, Dracula, Tokyo Night, Catppuccin Mocha e Latte, Gruvbox Dark, Monokai, Solarized scuro e chiaro, alto contrasto scuro e chiaro) in una galleria nelle Preferenze; temi personalizzati partendo da qualsiasi tema, con verifica del contrasto WCAG ed esportazione/importazione come testo. Scorciatoie personalizzabili in Preferenze → Keyboard. Navigazione da tastiera: Ctrl+1/2/3 tra i pannelli, frecce in sidebar, grafo e liste dei file, Invio e Spazio sui file, Alt+Giù/Su e F7 tra gli hunk, tasto menu e Shift+F10 per i menu contestuali, focus sempre visibile. Pulizia dei P1: checkout dei tag (TAG-03), Scarta tutto (COMMIT-13), aggiunta e sync dei submodule (ADV-02), pull e push LFS (ADV-03), sidebar a cartelle o a lista e Ctrl+Alt+F (SIDE-09, SIDE-11), zoom sempre in barra di stato (UI-06), diff tool esterno (DIFF-12) ed editor della configurazione git globale e locale (SET-03). README e screenshot aggiornati.

Obiettivo della v1.0: tutti i requisiti P0 e P1 coperti.

- **Scorciatoie personalizzabili**, con un elenco consultabile (UI-03)
- Navigazione completa da tastiera: grafo, liste dei file, diff (NFR-09)
- Verifica del contrasto dei tre temi; possibilità di **temi personalizzati** (UI-05)
- Pulizia dei requisiti P1 rimasti, aggiornamento di README e screenshot

## Step 10 — v1.1: Aggiornamenti e qualità del rilascio ✅

> Completato: l'exe portable si aggiorna da solo. "Update" scarica la nuova versione accanto all'exe, con barra di avanzamento e annullamento, e la verifica con lo SHA-256 pubblicato dal workflow di release; all'uscita, o subito con "Restart now", l'exe in uso viene rinominato in `.old` (Windows permette di rinominare un exe in esecuzione, non di sovrascriverlo), quello nuovo prende il suo nome e cartella, e il `.old` viene cancellato all'avvio successivo. Se il download fallisce o la cartella non è scrivibile resta il link alla pagina della release. Nuovo workflow CI su ogni push a main (prettier, eslint, typecheck, test, build su Windows), richiamato anche dal workflow di release, che pubblica solo se i controlli passano.

- ~~Avviso di nuova versione~~ e ~~changelog~~: anticipati nello Step 5 (NFR-08)
- **Aggiornamento dall'app**: scaricare e sostituire l'exe senza passare dal browser
- **CI su ogni push**: lint, typecheck e test su GitHub Actions, non solo al momento del rilascio

## Step 11 — v1.2: Capire il repository ✅

> Completato: **View → Statistics** mostra al posto del grafo commit, autori, calendario dell'attività, crescita del codice, ore dei commit, linguaggi, file caldi e bus factor, per il branch corrente o tutti e per periodo, da un solo `git log --numstat` annullabile. Nel blame si scelgono delle righe (o si scrive il nome di una funzione) per vederne tutta la storia con `git log -L`. "Code" accanto alla ricerca del grafo trova i commit che aggiungono o tolgono un testo (`-S`) o le cui righe cambiate corrispondono a una regex (`-G`). "All files" nel pannello del commit mostra l'albero del progetto a quel commit, con filtro e dimensioni; la nuova modalità "File" apre il file com'era (testo evidenziato, immagini, binari da salvare) e "Save as…" lo salva dove si vuole. La freccia accanto a un commit nel blame mostra la versione prima di quel commit alla stessa riga, calcolata dalla sua diff, e "Back" torna indietro un passo alla volta.

Tutto in locale, dai dati che git ha già. Le analisi lunghe mostrano l'avanzamento e si possono annullare.

- **Statistiche del repository**: autori e quanto contribuisce ciascuno, calendario dell'attività, commit per ora e giorno della settimana, crescita del codice nel tempo, linguaggi; filtrabili per periodo
- **File caldi**: i file cambiati più spesso e più di recente, e quelli conosciuti da un solo autore (bus factor)
- **Storia di righe o di una funzione**: selezioni un pezzo di codice e vedi tutti i commit che l'hanno toccato (`git log -L`)
- **Ricerca nel contenuto**: quando una stringa è comparsa o sparita nella storia (`git log -S/-G`), accanto alla ricerca per messaggio, autore, SHA e file
- **Esplora i file a qualsiasi commit**: l'albero del progetto com'era in un commit, con i file da aprire o salvare
- **Blame a ritroso**: da una riga del blame si passa alla versione prima di quel commit

## Step 12 — v1.3: Correggere senza paura ✅

> Completato: dal menu di un commit si spostano lui e i successivi su un branch nuovo o esistente, gli si aggiungono le modifiche in stage (fixup) o lo si divide in due scegliendo i file; i commit si riordinano trascinandoli nel grafo. Un hunk si modifica prima dello stage lasciando il file com'è. I dialoghi di merge e rebase dicono quali file andranno in conflitto, e un avviso accanto al branch segnala quando branch e main toccano le stesse righe (`git merge-tree`). Prima del commit compaiono avvisi, mai bloccanti, su segreti, file grandi fuori da LFS, codice di debug e stile del messaggio. Dal menu di un tag si generano le note di rilascio in Markdown, raggruppate per tipo. **View → Ignored Files** spiega quale regola ignora un file, e **View → Clean Up Untracked Files…** rimuove file non tracciati o ignorati dopo un'anteprima con le dimensioni, nel Cestino o per sempre. In più, i suggerimenti animati presentano le funzioni meno visibili, all'avvio e nel momento giusto.

Operazioni che oggi richiedono il terminale o diversi passaggi, sempre con backup e undo.

- **Commit sul branch sbagliato**: sposti uno o più commit su un altro branch, nuovo o esistente, in un passaggio guidato
- **Fixup**: "correggi questo commit" con le modifiche attuali; GitDom crea il fixup e fa l'autosquash
- **Dividere un commit** in più commit, scegliendo file, hunk e righe (nuova azione `edit` nel rebase interattivo)
- **Riordinare i commit trascinandoli nel grafo**, lungo il branch corrente
- **Modificare un hunk prima dello stage**
- **Anteprima dei conflitti**: prima di un merge o rebase GitDom dice se ci saranno conflitti e su quali file (`git merge-tree`, git 2.38 o successivo), e avvisa quando il tuo branch e main toccano gli stessi file
- **Controlli prima del commit**: segreti (chiavi, token, password), file grandi o binari fuori da LFS, `console.log`/`TODO` dimenticati, formato del messaggio; sono avvisi disattivabili, mai blocchi
- **Note di rilascio**: i commit tra due tag, raggruppati per tipo, da copiare nel changelog
- **Perché questo file è ignorato?**: la regola del `.gitignore` responsabile (`git check-ignore -v`)
- **Pulizia dei file non tracciati** con anteprima e conferma (`git clean`)

## Step 13 — v1.4: Ordine, manutenzione e più repository ✅

> Completato: la panoramica dei branch e la salute del repository sono uscite con la v1.4.0; i temi con layout diverso e la gestione degli hook con la v1.5.0; bisect guidato, patch, i temi Retro 2000 e Matrix e il cruscotto dei workspace con la v1.6.1 (la v1.6.0 non è mai stata pubblicata); "Cosa ho fatto" con la v1.7.0.

- ✅ **Panoramica dei branch**: ultimo commit, età, avanti/indietro rispetto a main, già uniti o no; eliminazione in blocco di quelli vecchi o uniti
- ✅ **Salute del repository**: spazio occupato, gli oggetti più pesanti nella storia, e `gc`, `prune` e `fsck` con un clic
- ✅ **Temi Retro 2000 e Matrix**: il grigio a rilievo dei desktop del 2000 e il verde fosforo su nero, con controlli ridisegnati
- ✅ **Temi con layout diverso**: oltre a Studio, Focus (solo il grafo, sidebar a scomparsa), Posta (tre colonne con pannello di lettura) e IDE (grafo in alto, dettaglio e diff nel pannello in basso), ognuno con i suoi colori
- ✅ **Gestione degli hook**: vedere, attivare, disattivare e modificare gli hook git del repository
- ✅ **Bisect guidato**: segni "buono/cattivo" e l'app trova il commit colpevole (ADV-06)
- ✅ **Patch**: creazione da commit e applicazione di file .patch (ADV-07)
- ✅ **Cruscotto dei workspace**: lo stato di tutti i repository in una vista (modifiche aperte, avanti/indietro), con "Fetch tutti"
- ✅ **Cosa ho fatto questa settimana**: i tuoi commit su tutti i repository, per giorno, da copiare per uno standup o un report

## Step 14 — v1.8: Installer, avvio rapido, meno temi ✅

> Completato con la v1.8.0: installer per Windows accanto all'exe portable, avvio più rapido, cinque temi doppioni tolti.

- ✅ **Installer per Windows**: installazione per il solo utente, senza diritti di amministratore, con collegamenti nel menu Start e sul desktop; si aggiorna da solo come il portable, eseguendo il nuovo installer in silenzio (D8)
- ✅ **Avvio più rapido**: l'installer non decomprime nulla a ogni avvio; il portable è più leggero (solo le lingue inglese e italiana di Chromium, niente sorgenti già incluse nel bundle); meno processi git prima del grafo (LFS cercato su disco, radice del repository in parallelo), tab ripristinate una alla volta quando l'app è libera, terminale e changelog caricati solo quando servono
- ✅ **Meno temi**: tolti Tokyo Night, Catppuccin Mocha e Latte, Dracula e Monokai, troppo simili ad altri; chi li usava passa al più vicino

## Step 15 — v1.9: Credenziali, sicurezza, macOS e Linux ✅

> Completato con la v1.9.1 (la v1.9.0 non è mai stata pubblicata: un test falliva su Linux): le cinque cose da migliorare emerse dall'analisi della v1.8.

- ✅ **Credenziali nell'app**: quando git chiede nome utente e password o token, la passphrase di una chiave SSH o se fidarsi di un server mai visto, GitDom lo chiede in una finestra (helper `GIT_ASKPASS`/`SSH_ASKPASS` che parla con l'app su una pipe locale protetta da un token). Nome utente e password si chiedono insieme, una volta sola; li conserva il credential helper di git, GitDom non salva niente. Il fetch periodico non chiede mai: se servono credenziali lo segnala una volta
- ✅ **Sandbox**: l'interfaccia gira nella sandbox di Chromium, la navigazione verso altre pagine è bloccata, e il nome del file passato all'editor esterno è quotato, così niente in un nome di file può diventare un comando
- ✅ **File più piccoli**: `operations.ts`, `actions.ts` e `DetailPanel.tsx` divisi in moduli per area, senza cambiare il comportamento
- ✅ **Test end-to-end**: `npm run test:e2e` costruisce l'app e la guida con Playwright (grafo, stage e commit, branch, palette, sandbox, credenziali); la CI li esegue a ogni push
- ✅ **macOS e Linux**: scorciatoie con ⌘ e menu dell'app su macOS, ⌘+clic per scegliere più commit, PATH della shell di login (git, LFS ed editor di Homebrew), shell zsh/bash/fish nel terminale, testi e font del sistema, watcher che su Linux ripiega sulla cartella `.git` se finiscono i watch; CI su Windows, Linux e macOS; nelle release dmg per Apple Silicon e Intel, AppImage e deb

## Step 16 — v1.10: Time-lapse di un file ✅

> Completato con la v1.10.0. Il blame che scorre nel tempo, come il Time-lapse View di Perforce: GitDom ha già blame, storia delle righe e ricerca nel codice, qui diventano una vista sola da scorrere.

- ✅ **Timeline da trascinare**: sotto il codice una barra con un segno per ogni commit che ha cambiato il file; trascinandola (o con le frecce, Shift per dieci alla volta, Home/End) il file cambia versione all'istante, con autore, data e commit su ogni riga. Tutte le versioni si leggono con un `git log` e un `git cat-file --batch`, e il blame di ognuna si calcola in GitDom, senza un `git blame` a ogni passo
- ✅ **Colore per età**: le righe appena cambiate sono evidenziate e sbiadiscono man mano che si va avanti nella storia
- ✅ **Righe fantasma**: le righe che il commit ha tolto restano visibili in rosso, al loro posto
- ✅ **Segui una riga**: si blocca una riga con un clic; resta ferma sullo schermo mentre si scorre, e la barra segna i commit in cui esiste
- ✅ **Ricerca nella storia**: mentre si scrive, la barra segna i commit che aggiungono o tolgono righe con quel testo, o il cui messaggio, autore o hash lo contiene; filtri per righe aggiunte, tolte e commit; F3 / Invio passano al prossimo
- ✅ **Tag e segnalibro sulla barra**: i tag di release segnati sulla timeline; un segnalibro su un commit per tornarci (M per metterlo, ' per saltare avanti e indietro) e aprire il diff tool esterno tra il segnalibro e la versione mostrata
- ✅ Le modifiche non ancora committate sono l'ultimo passo della timeline; il dettaglio del commit mostrato segue la timeline

## Step 17 — v1.11: Qualità interna ✅

> Completato con la v1.11.1 (la v1.11.0 non è mai stata pubblicata: i nuovi test end-to-end, sugli schermi più piccoli della CI, hanno trovato barre che in una finestra stretta finivano sotto il pannello di dettaglio, ora corrette). Quattro dei cinque miglioramenti dell'analisi di ottobre 2026; la firma degli aggiornamenti (chiave propria o certificati Authenticode/Apple) è rimasta fuori per scelta.

- ✅ **Impostazioni su file** (SET-05): `settings.json` nella cartella di GitDom al posto del localStorage dell'interfaccia; il preload le legge una volta all'avvio (in modo sincrono, così i moduli che le leggono subito non cambiano) e il main le scrive poco dopo ogni modifica, in modo atomico, e subito alla chiusura. Al primo avvio le impostazioni del localStorage passano nel file, che resta com'era per una versione precedente. **File → Export Settings… / Import Settings…** salvano e ripristinano tutto. Una regola di ESLint impedisce di tornare al localStorage
- ✅ **Calcoli lunghi in un worker thread**: le righe del time-lapse (un diff per versione) e le somme delle statistiche girano in `out/main/worker.js`; git resta nel processo principale. Misurato su 400 versioni di un file di 4000 righe: il processo principale risponde in 170 ms al massimo invece di restare fermo per 5 secondi. Annullare le statistiche ferma anche il calcolo finale
- ✅ **CSS in file per funzione**: `workflow.css` e `tips.css` (oltre 3000 righe ciascuno) diventano indici di `@import` di `assets/workflow/` e `assets/tips/`, nello stesso ordine: il CSS costruito è identico byte per byte
- ✅ **Componenti più piccoli e test dei flussi**: `GraphView`, `FileInspector`, `StatisticsView` e `TipAnimation` divisi in `graph/`, `inspector/`, `statistics/` e `tips/` senza cambiare il comportamento; nuovi test end-to-end per stage di righe e hunk, stash di un file, cherry-pick, rebase interattivo, riordino dei commit trascinandoli, merge tool e merge trascinando un branch, oltre a impostazioni e worker

## Step 18 — v1.12: Schede e attese ✅

> Completato con la v1.12.0. Richiesto dall'utente il 2026-10-26: le schede si chiudevano solo una alla volta, e aprire una repository o fare un push sembrava bloccare l'app.

- ✅ **Menu delle schede**: il tasto destro su una scheda chiude quella, le altre, quelle a destra o a sinistra, oppure tutte; copia il percorso o mostra la cartella. **Close other tabs** e **Close all tabs** anche nella palette dei comandi. Il tasto destro non cambia più la scheda attiva
- ✅ **Apertura immediata**: la scheda compare subito, in caricamento, prima che git abbia letto la storia; se la cartella era una sottocartella di una repository già aperta, resta la scheda esistente, e una cartella che non è una repository toglie la scheda e mostra l'errore. Al posto di "Loading repository…" il logo con le auto che continuano a cambiare corsia e alcune righe segnaposto del grafo; l'icona della scheda ora gira davvero
- ✅ **Progresso del push**: `git push --progress`, letto da `src/main/git/progress.ts` (lo stesso parser del clone, con una tabella di fasi per operazione: Counting 0–5, Compressing 5–30, Writing 30–90, Resolving deltas sul remoto 90–100) e inviato all'interfaccia tramite uno scope `AsyncLocalStorage` attorno a ogni operazione. Una barra sottile sotto la toolbar si riempie, la barra di stato mostra fase, quantità inviata e velocità, il pulsante Push la percentuale; finito l'invio la barra pulsa ("waiting for the remote"). Le operazioni che non riportano progresso (fetch, pull, merge…) mostrano una barra che scorre. Le righe che git riscrive con `\r` non finiscono più nei dettagli delle notifiche né nell'Activity log

---

## Pull request — piano (Step 19–24)

> 📝 In corso, richiesto dall'utente il 2026-10-27 (Step 19 pubblicato con la v1.13.0, Step 20 con la v1.14.0, Step 21 con la v1.15.0, Step 22 completato e da pubblicare): pull request di GitHub, GitLab, Bitbucket (Cloud e Data Center) e Azure DevOps dentro GitDom (INT-01, INT-03, INT-05, SIDE-07, AUTH-06). L'idea non è copiare il sito del provider: le PR compaiono dove si lavora già, nel grafo, nella sidebar e nel diff. Si procede uno step alla volta, ognuno è una release.

### Decisioni comuni a tutti gli step

**Provider e repository**

- Il provider si riconosce dagli URL dei remoti:
  - `github.com`;
  - `gitlab.com`;
  - `bitbucket.org`;
  - per Azure DevOps `dev.azure.com/<org>/<progetto>/_git/<repo>`, `<org>.visualstudio.com` e `ssh.dev.azure.com:v3/…`;
  - per Bitbucket Data Center, su qualsiasi host, `https://<server>/scm/<progetto>/<repo>.git` o SSH sulla porta 7999 (Step 22).

  I server propri (GitHub Enterprise, GitLab self-managed, Bitbucket Data Center con altre porte SSH, Azure DevOps Server) si aggiungono nelle preferenze, indicando host e tipo; le preferenze vincono sul riconoscimento automatico.

- Se c'è un remoto `upstream`, cioè la repository è un fork, le PR si leggono lì, e il branch sorgente sta su `origin`. Altrimenti si usa `origin`.
- Il termine segue il provider: "Pull request" su GitHub, Bitbucket e Azure DevOps, "Merge request" su GitLab.

**Login, un account per host, in quest'ordine**

1. **Token di Git Credential Manager**: `git credential fill` per l'host, con `GCM_INTERACTIVE=never` e `GIT_TERMINAL_PROMPT=0`, senza askpass, così non compare nessuna finestra. Una chiamata di prova verifica che il token vada bene per le API. Dal codice di GCM risulta che:
   - con **GitHub** funziona: GCM chiede gli scope `repo`, `gist` e `workflow`;
   - con **Azure DevOps** funziona: GCM usa un token Entra ID oppure un PAT `vso.code_write`, che copre le PR;
   - con **GitLab** non basta: GCM chiede solo `read_repository` e `write_repository`, che non danno accesso alle API;
   - con **Bitbucket** non basta: GCM chiede `repository:write` e `account`, ma non `pullrequest`;
   - con **Bitbucket Data Center** funziona: GCM tiene nome utente e password (o token), che le API accettano in Basic.
2. **Device flow OAuth**: si inserisce un codice nella pagina del provider. È possibile su GitHub e su gitlab.com, ma serve un'app OAuth "GitDom" registrata su ciascuno, con un client ID pubblico incluso nell'app.
3. **Token inserito a mano**:
   - GitHub: PAT;
   - GitLab: PAT con scope `api`;
   - Bitbucket: API token Atlassian con email e scope `read:pullrequest`/`write:pullrequest`, che sostituisce le app password;
   - Bitbucket Data Center: HTTP access token con il permesso "Repository write";
   - Azure DevOps: PAT "Code: Read & Write".

   La finestra spiega quali permessi spuntare e apre la pagina giusta del provider.

I token vanno in un file a parte nella cartella di GitDom (`accounts.json`), cifrati con `safeStorage` (NFR-06); quelli di Git Credential Manager non vengono copiati affatto, si richiedono a GCM a ogni sessione. Non stanno in `settings.json`, così **Export Settings** non li esporta mai. Se il sistema non sa cifrare, l'account dura fino alla chiusura di GitDom. I token non arrivano mai all'interfaccia: tutte le chiamate di rete partono dal main con `net.fetch`, che passa dal proxy di sistema, e il token non compare né nell'Activity log (`git credential fill` non passa da lì) né nelle notifiche.

Nelle preferenze, una sezione **Accounts** elenca gli account collegati, con avatar, nome, host e origine del token (GCM, OAuth o token manuale), e un pulsante per scollegarli.

**Architettura**

- Nuova cartella `src/main/forge/`:
  - `detect.ts`: dal remoto al provider, al progetto e al repository;
  - `accounts.ts` (token cifrati), `credential.ts` (GCM) e `device.ts` (device flow);
  - `http.ts`: richieste, errori chiari (token rifiutato, permesso mancante, rate limit, rete);
  - un modulo per provider, `github.ts` e `gitlab.ts`, poi `bitbucket.ts`, `azure.ts` e `bitbucketServer.ts`, tutti con la stessa interfaccia `ForgeProvider` (`provider.ts`);
  - `service.ts`: account da usare, ultimo stato di ogni repository, fetch delle PR; `ipc.ts`.
- Modello normalizzato in `src/shared/forge.ts`:
  - `PullRequest` con numero, titolo, autore, stato (bozza, aperta, merged, chiusa), branch sorgente e destinazione, repository sorgente, sha della testa, reviewer col loro voto, riassunto dei check, mergeability (pulita, conflitti, bloccata con il motivo), commenti e URL;
  - `capabilities` per provider, per esempio: label, auto-merge, "richiedi modifiche", metodi di merge permessi dal repository. L'interfaccia nasconde ciò che il provider non ha.
- Chiamate:
  - per GitHub e GitLab, GraphQL per gli elenchi: PR, review, check e mergeability in una richiesta; le query sono validate sugli schemi ufficiali;
  - REST per le azioni e per gli altri provider: Bitbucket 2.0, Azure DevOps `api-version=7.1`, Bitbucket Data Center 1.0.
- **Aggiornamento**:
  - nella scheda attiva, ogni 60 s con la finestra in primo piano e ogni 5 minuti in background;
  - subito dopo push e fetch;
  - GraphQL non ha richieste condizionate (ETag): una query al minuto resta molto sotto il limite di GitHub (5000 punti l'ora);
  - se il limite finisce, l'errore dice fino a quando.

  Senza rete restano gli ultimi dati, segnati come non aggiornati.

- Markdown di descrizioni e commenti: un parser di GitDom (`src/shared/markdown.ts`, senza dipendenze) che produce elementi React, mai HTML: i tag vengono tolti, i link aperti nel browser solo se http(s), le immagini mostrate come link. Gli avatar li carica il main e li passa come `data:`. La sandbox e la CSP restano come sono.

**Test**

- Ogni provider viene testato con risposte JSON registrate e un `fetch` finto: mapping dei campi, paginazione, errori, permessi mancanti e rate limit.
- Gli E2E usano un server finto locale (`GITDOM_FORGE_MOCK`) che imita i quattro provider. La CI non usa mai la rete né account veri.
- Prima di ogni release, prova a mano con account veri. Per GitLab, Bitbucket e Azure DevOps bastano account gratuiti di prova.

### Step 19 — v1.13: Pull request, fondamenta e lettura (GitHub e GitLab) ✅

> Completato con la v1.13.0. Due provider insieme, per verificare subito che l'interfaccia comune funzioni anche per un servizio diverso da GitHub. Provato anche contro il vero GitHub (il repository di GitDom ed `electron/electron`), che ha trovato tre cose che lo schema non diceva:
>
> - il token di GCM non ha `read:org`, che serve per leggere i **team** fra i reviewer: GitDom riprova senza team e se lo ricorda per l'host;
> - `mergeStateStatus` su 30 PR di un repository grande supera il tempo che GitHub concede (502): l'elenco ne fa a meno e legge 20 PR (10 se GitHub risponde ancora 502), e la vista della PR chiede il verdetto esatto per quella sola;
> - una rilettura chiesta mentre ne era già in corsa una veniva persa (la sezione restava su **Connect** dopo la connessione): ora si ripete.
>
> Il device flow è pronto ma non viene offerto finché non si registrano le app OAuth "GitDom" su GitHub e gitlab.com (client ID in `src/main/forge/device.ts`).

- ✅ Rilevamento del provider, sezione **Accounts**, login con GCM, device flow e token, file dei token cifrato
- ✅ **Badge nel grafo**:
  - sull'etichetta del branch con una PR aperta compare `#42`, colorato per stato: bozza, aperta, approvata, con modifiche richieste, con conflitti;
  - accanto, un pallino per la CI: verde, rosso, oppure giallo che pulsa mentre gira;
  - il badge compare sul branch locale che segue il branch sorgente e sul branch remoto.
- ✅ **Scheda al passaggio del mouse**, come quelle dei commit: titolo, autore, reviewer e voti, check falliti con il nome, mergeability con il motivo del blocco.
- ✅ **Sezione Pull Requests** nella sidebar (SIDE-07):
  - gruppi **Le mie**, **Review richiesta a me** e **Altre**;
  - ogni riga mostra stato, CI, approvazioni e commenti;
  - il filtro della sidebar funziona anche qui, e la sezione si può nascondere come le altre.
- ✅ **Vista della PR**, in sola lettura (i file cambiati nel pannello di dettaglio, il diff sopra la vista, Esc torna alla PR):
  - intestazione con stato, branch e reviewer;
  - descrizione in markdown e timeline di commenti e review;
  - elenco dei commit, con un clic che li seleziona nel grafo;
  - check con link ai log sul provider.
- ✅ **Diff in locale**:
  - GitDom scarica la testa della PR (`refs/pull/N/head` su GitHub, `refs/merge-requests/N/head` su GitLab) e calcola il diff dal merge-base con il branch di destinazione, come fa il provider, usando il DiffView esistente con tutte le sue opzioni;
  - funziona anche con le PR da fork; i commit vanno in `refs/gitdom/pull/N/`, fuori dal grafo, e si tolgono quando la PR non è più aperta.
- ✅ **Palette dei comandi**: ogni PR aperta, la PR del branch corrente (nell'app o nel browser), "Connect to GitHub", "Refresh pull requests".

### Step 20 — v1.14: Azure DevOps e Bitbucket in lettura ✅

> Completato con la v1.14.0. Tutto lo Step 19 anche per gli altri due provider, con le loro differenze. Bitbucket è provato su risposte vere di bitbucket.org (un progetto pubblico di Atlassian, senza login); per Azure DevOps non c'è un progetto pubblico con repository Azure da leggere, quindi le risposte seguono gli esempi della documentazione ufficiale. Manca la prova con account veri dei due servizi.

- ✅ **Azure DevOps**:
  - organizzazione (o collection del server), progetto e repository dall'URL; anche **Azure DevOps Server** fra i server propri, con collection di più segmenti (`tfs/DefaultCollection`);
  - voti dei reviewer: approva (10), approva con suggerimenti (5), in attesa dell'autore (−5), rifiuta (−10); i reviewer obbligatori decidono se la review manca;
  - come CI valgono gli status della PR (l'ultimo di ogni contesto) e le policy di build validation, con il link alla build; le altre policy obbligatorie (reviewer, commenti da risolvere, work item) spiegano perché la PR è bloccata;
  - il token di GCM si chiede con il percorso del repository, perché GCM tiene i token per organizzazione; un PAT va come password, un token Entra come bearer;
  - Azure DevOps non dice quando una PR è cambiata: il dettaglio si rilegge quando cambiano l'ultimo commit o i voti;
  - gli avatar stanno dietro il login: il main li chiede con il token, solo per l'host dell'account;
  - chi ha un'email come login (Azure DevOps) compare con il nome.
- ✅ **Bitbucket Cloud**:
  - workspace e repository dall'URL; l'elenco porta reviewer, approvazioni e "richieste modifiche" in una chiamata (`fields=+values.participants`);
  - commit status come CI: una chiamata per PR, tenuta finché l'ultimo commit non cambia e tutto è finito, per stare nei limiti di Bitbucket;
  - i conflitti si vedono nella vista della PR (diffstat), perché l'elenco non li dice;
  - login con API token ed email dell'account Atlassian (Basic), con un access token da solo (Bearer), o con il token di GCM: GitDom prova prima con il suo nome utente, poi senza;
  - Bitbucket Data Center ha un'altra API: arriva con lo Step 22.
- ✅ **Commit della PR senza ref dedicato**: GitDom scarica il branch sorgente dal remoto, da un altro remoto che punta al fork, dall'URL del fork che Azure DevOps dà, oppure dall'URL del remoto con il percorso del fork al posto di quello del repository.
- ✅ In tutti e quattro i provider, le PR in bozza compaiono come bozze.

### Step 21 — v1.15: Lavorare su una pull request ✅

> Completato con la v1.15.0. Le chiamate che cambiano le PR (creare, unire, chiudere) non si possono provare sui servizi veri senza creare PR vere: sono verificate sulla documentazione e sugli schemi ufficiali (GitHub: OpenAPI e schema GraphQL; GitLab: documentazione dell'API; Bitbucket: swagger; Azure DevOps: documentazione REST), con test che controllano richiesta per richiesta, e con un finto GitHub negli end-to-end. Differenze dal piano:
>
> - l'anteprima della creazione mostra i commit, non i file;
> - si riapre una PR chiusa in GitDom nella stessa sessione: le PR chiuse non sono nell'elenco;
> - Bitbucket non ha l'auto-merge, la riapertura di una PR rifiutata e le label; su Azure DevOps le label si scrivono (non c'è un elenco da cui sceglierle) e le policy del branch possono permettere meno metodi di merge di quelli offerti: Azure DevOps rifiuta gli altri;
> - su GitLab il metodo di merge è un'impostazione del progetto (merge, rebase poi merge, fast-forward) e lo squash si sceglie per la singola MR; una bozza si riconosce dal titolo ("Draft: ");
> - su GitHub l'auto-merge si offre solo se il repository lo permette.

- ✅ **Checkout della PR**:
  - se la PR è nella stessa repository, crea un branch locale che segue il branch sorgente, così un push aggiorna la PR;
  - se viene da un fork, crea un branch dalla testa della PR, con l'opzione di aggiungere il fork come remoto.
- ✅ **Apri in un worktree**: la PR si apre in una cartella accanto alla repository e in una nuova scheda, senza toccare il lavoro in corso. Riusa i worktree dello Step 7.
- ✅ **Creare una PR**:
  - dopo un push su un branch senza PR compare la notifica "Create pull request";
  - si apre anche dal menu del branch e dalla palette;
  - nella finestra:
    - la destinazione è il branch di default del provider;
    - il titolo viene dal nome del branch o dall'unico commit;
    - la descrizione usa il template del repository (`.github/pull_request_template.md`, `.gitlab/merge_request_templates/`, `.azuredevops/pull_request_template.md`), altrimenti l'elenco dei commit;
    - si scelgono bozza, reviewer con ricerca, e label dove esistono;
    - un'anteprima mostra i commit che entrano.

    Se il branch non è pubblicato, fa prima il push, con la barra di progresso.
- ✅ **Modificare una PR**: titolo, descrizione, reviewer, passaggio da bozza a pronta.
- ✅ **Merge**:
  - si sceglie tra i metodi che il repository permette: merge, squash, rebase o fast-forward, secondo il provider;
  - messaggio del commit modificabile;
  - opzione per cancellare il branch sorgente;
  - auto-merge quando i check passano, dove esiste: GitHub, GitLab "merge when pipeline succeeds", Azure DevOps auto-complete;
  - se il merge è bloccato, la finestra dice perché.
- ✅ **Pulizia dopo il merge**: GitDom propone di tornare sul branch di destinazione, aggiornarlo e cancellare il branch locale: una finestra con le due scelte, e il branch locale si cancella anche dopo uno squash, che git non vede come unito.
- ✅ Chiudere e riaprire una PR.

### Step 22 — v1.16: Bitbucket Data Center ✅

> Completato, da pubblicare. Richiesto dall'utente il 2026-10-28: i suoi repository di lavoro stanno su un Bitbucket Data Center 9.4, dove la sezione Pull Requests non compariva. Le chiamate seguono lo schema OpenAPI ufficiale della 9.4, gli esempi della documentazione REST e le risposte registrate da un server vero nei test del plugin Bitbucket di Jenkins; il riconoscimento, il login anonimo rifiutato e la pagina dei token sono verificati sul server dell'utente. Manca la prova con un account vero.

- ✅ **Riconoscimento senza configurare nulla**: `…/scm/<progetto>/<repo>.git` (anche sotto un context path, `https://host/bitbucket/scm/…`) o SSH sulla porta 7999. Il percorso diventa `[context/]PROGETTO/repo`; i remoti dei fork si leggono allo stesso modo. Nelle preferenze, `host bitbucket` su un host diverso da bitbucket.org vuol dire Data Center.
- ✅ **Login**: la credenziale di GCM (nome utente e password, o token) in Basic, poi da sola in Bearer; oppure un HTTP access token incollato, con il link alla pagina dei token del server. Chi è l'account lo dice l'header `X-AUSERNAME` delle risposte, o `/plugins/servlet/applinks/whoami`.
- ✅ **Lettura**:
  - reviewer approvati, "needs work" e in attesa; vale anche chi approva senza essere reviewer;
  - conflitti dall'elenco (`mergeResult`); nella vista, le merge check che bloccano (approvazioni, build, task) dicono perché;
  - build status dell'ultimo commit come CI, una chiamata per PR tenuta finché nulla cambia;
  - commenti con le risposte e la riga del diff; commit; avatar dal server, chiesti con il token.
- ✅ **Scrittura**: ogni modifica rilegge la `version` della PR, che Bitbucket vuole aggiornata.
  - Creazione con i default reviewer del repository, come la pagina di Bitbucket, senza l'autore.
  - Modifica di titolo, descrizione e bozza, mantenendo i reviewer; reviewer nuovi come partecipanti.
  - Chiusura e riapertura.
  - Merge con le strategie attive del repository, rifiutato se nel frattempo è arrivato un commit; auto-merge se il repository lo permette; il branch sorgente si cancella solo se è ancora all'ultimo commit visto.

### Step 23 — v1.17: Review nell'app

- **Commenti sul diff**:
  - un clic sul margine di una riga, o un trascinamento per più righe, apre un commento;
  - i commenti già scritti compaiono in linea, con risposte, "risolto" e "riapri".
- **Review in sospeso**:
  - i commenti si accumulano e partono insieme con _Approve_, _Request changes_ o _Comment_, oppure con il voto di Azure DevOps;
  - su GitHub è la review in sospeso del provider, sugli altri provider GitDom la tiene finché non si invia;
  - le posizioni si convertono nel formato di ciascuno: `line`/`side` su GitHub, `position` con i tre sha su GitLab, `inline` su Bitbucket, `threadContext` su Azure DevOps.
- **File visti**: si spuntano i file già guardati; quando l'autore fa push, si torna a vedere solo i file cambiati. Il diff "da quando l'ho vista", cioè dall'ultima testa vista a quella nuova, si calcola in locale.
- Suggerimenti di modifica (GitHub e GitLab), mostrati come mini-diff e applicabili con un clic.
- Scorciatoie: `N`/`P` per il file successivo o precedente, `C` per commentare, `V` per segnare come visto.

### Step 24 — v1.18: Notifiche e dashboard

- **Notifiche**: confrontando un aggiornamento con il precedente, GitDom mostra toast come "CI fallita su #42", "Mario ha approvato #42", "Review richiesta su !17", "#42 ha conflitti", e un contatore sulla sezione della sidebar. Si possono disattivare per tipo.
- **Dashboard personale** (INT-05): una vista con le PR di tutti i repository preferiti e del workspace:
  - le mie;
  - da rivedere;
  - con la CI rossa;
  - pronte per il merge.

  Un clic apre la repository nella scheda giusta, con la PR aperta.

- **Descrizione con l'AI** (AI-05): solo se nel frattempo arriva l'assistente AI opzionale, altrimenti resta per dopo.

---

## Forse, un giorno

Funzioni che dipendono da servizi esterni o poco usate nel lavoro quotidiano: restano possibili, ma fuori dalla roadmap attiva.

- **Issue** dei provider delle pull request: elenco, e creazione di un branch da una issue (INT-02, SIDE-08)
- **Assistente AI**, opzionale, con chiave API fornita dall'utente e salvata cifrata, con i modelli Claude:
  - messaggio di commit generato (AI-01);
  - spiegazione di un commit o di un branch (AI-03);
  - aiuto sui conflitti (AI-04);
  - descrizione della PR (AI-05);
  - divisione delle modifiche in più commit logici (AI-02).
- **Git Flow**: feature, release e hotfix (ADV-04)
- **Sparse checkout, repository bare e shallow** (ADV-08, REPO-10)

## Idee oltre i requisiti

- **Variante chiara del tema Studio**, per chi vuole il layout Studio ma con fondo chiaro
- **Timeline animata** della storia del repository, in stile con il logo dell'autostrada
