# GitDom — Documento dei Requisiti

> Client Git desktop con grafico dei commit interattivo.
> Versione documento: 0.1 — 2026-09-24

## Legenda priorità

| Priorità | Significato                                                            |
| -------- | ---------------------------------------------------------------------- |
| **P0**   | MVP — senza questo l'app non è utilizzabile come client Git quotidiano |
| **P1**   | v1.0 — le funzionalità core di un client Git grafico completo          |
| **P2**   | Post v1.0 — integrazioni, AI, funzioni avanzate/di nicchia             |

Ogni requisito ha un ID (`AREA-NN`) per poterlo tracciare in issue, commit e test.

---

## 1. Gestione repository (REPO)

| ID      | Requisito                                                                                         | Pri |
| ------- | ------------------------------------------------------------------------------------------------- | --- |
| REPO-01 | Aprire un repository locale esistente (dialog cartella + drag & drop)                             | P0  |
| REPO-02 | Clonare da URL (HTTPS/SSH) con barra di avanzamento e annullamento                                | P0  |
| REPO-03 | Inizializzare un nuovo repository (`git init`), con opzione .gitignore/README/licenza da template | P1  |
| REPO-04 | **Tab multiple**: più repository aperti contemporaneamente, riordinabili, chiudibili              | P0  |
| REPO-05 | Elenco repository recenti e preferiti                                                             | P0  |
| REPO-06 | Selettore rapido repository (dropdown "repository" nella toolbar)                                 | P1  |
| REPO-07 | Workspace: gruppi di repository salvati e riapribili insieme                                      | P2  |
| REPO-08 | Rilevamento automatico modifiche su disco (file watcher) e refresh                                | P0  |
| REPO-09 | Supporto a worktree (`git worktree add/list/remove`)                                              | P1  |
| REPO-10 | Supporto repository bare e shallow clone                                                          | P2  |
| REPO-11 | Clone con opzioni: branch specifico, profondità, submodule ricorsivi                              | P1  |

## 2. Grafico dei commit (GRAPH) — il cuore dell'app

| ID       | Requisito                                                                                                 | Pri |
| -------- | --------------------------------------------------------------------------------------------------------- | --- |
| GRAPH-01 | Visualizzazione a grafo dei commit con **corsie (lanes) colorate** per branch e linee curve di merge/fork | P0  |
| GRAPH-02 | Colonne: **Branch/Tag**, **Graph**, **Commit message**; colonne opzionali: autore, data, SHA              | P0  |
| GRAPH-03 | Colonne ridimensionabili, mostrabili/nascondibili (icona impostazioni sopra la tabella)                   | P1  |
| GRAPH-04 | **Avatar autore** dentro il nodo del commit (Gravatar / avatar provider / identicon generato)             | P1  |
| GRAPH-05 | Nodo speciale **// WIP** in cima con conteggio file modificati                                            | P0  |
| GRAPH-06 | Etichette branch/tag a sinistra con icone locale 💻 / remoto ☁️, collegate al nodo con una linea          | P0  |
| GRAPH-07 | Evidenziazione del branch corrente (checkmark)                                                            | P0  |
| GRAPH-08 | **Virtualizzazione**: scroll fluido su repository con 100k+ commit, caricamento incrementale              | P0  |
| GRAPH-09 | Merge commit disegnati come nodo piccolo (punto) distinto dai commit normali                              | P1  |
| GRAPH-10 | Selezione singola e multipla (Shift/Ctrl) di commit → diff aggregato                                      | P1  |
| GRAPH-11 | Menu contestuale sul commit (checkout, branch da qui, cherry-pick, revert, reset, tag, copia SHA…)        | P0  |
| GRAPH-12 | **Drag & drop** di un branch su un altro → menu merge / rebase / fast-forward                             | P1  |
| GRAPH-13 | Doppio click su un branch = checkout                                                                      | P0  |
| GRAPH-14 | Nascondere/mostrare singoli branch dal grafo; "solo questo branch" (solo)                                 | P1  |
| GRAPH-15 | Evidenziazione dei commit di un branch al passaggio del mouse                                             | P2  |
| GRAPH-16 | Minimap / barra di scroll con indicatori                                                                  | P2  |
| GRAPH-17 | Ricerca/filtro nel grafo per messaggio, autore, SHA, file                                                 | P1  |
| GRAPH-18 | Indicatori ahead/behind rispetto all'upstream                                                             | P0  |

## 3. Pannello laterale sinistro (SIDE)

| ID      | Requisito                                                                                       | Pri |
| ------- | ----------------------------------------------------------------------------------------------- | --- |
| SIDE-01 | Sezione **LOCAL**: branch locali con conteggio, raggruppati per cartella (`feature/…`, `fix/…`) | P0  |
| SIDE-02 | Sezione **REMOTE**: remoti e loro branch, ad albero                                             | P0  |
| SIDE-03 | Sezione **STASHES** con conteggio                                                               | P0  |
| SIDE-04 | Sezione **TAGS**                                                                                | P0  |
| SIDE-05 | Sezione **SUBMODULES**                                                                          | P1  |
| SIDE-06 | Sezione **WORKTREES**                                                                           | P1  |
| SIDE-07 | Sezione **PULL REQUESTS** (richiede integrazione provider)                                      | P2  |
| SIDE-08 | Sezione **ISSUES** (richiede integrazione)                                                      | P2  |
| SIDE-09 | Filtro testuale (Ctrl+Alt+F) su tutte le sezioni                                                | P1  |
| SIDE-10 | Sezioni collassabili, pannello ridimensionabile e collassabile                                  | P0  |
| SIDE-11 | Vista List / Tree per i branch                                                                  | P1  |
| SIDE-12 | Menu contestuali su ogni voce (branch, remoto, tag, stash)                                      | P0  |

## 4. Working directory, staging e commit (COMMIT)

| ID        | Requisito                                                                           | Pri |
| --------- | ----------------------------------------------------------------------------------- | --- |
| COMMIT-01 | Liste **Unstaged Files** e **Staged Files** con conteggio                           | P0  |
| COMMIT-02 | Vista **Path** (lista piatta) e **Tree** (albero cartelle), "Expand All"            | P0  |
| COMMIT-03 | Stage/unstage file singolo, cartella, tutto ("Stage All Changes")                   | P0  |
| COMMIT-04 | **Stage/unstage per hunk e per singola riga** dal diff                              | P0  |
| COMMIT-05 | Discard modifiche (file, hunk, riga, tutto) con conferma                            | P0  |
| COMMIT-06 | Icone stato file: aggiunto, modificato, eliminato, rinominato, conflitto, untracked | P0  |
| COMMIT-07 | Campo **Commit summary** con contatore caratteri (limite 72) e **Description**      | P0  |
| COMMIT-08 | **Amend previous commit**                                                           | P0  |
| COMMIT-09 | Commit options: firma GPG/SSH, skip hooks (`--no-verify`), autore alternativo       | P1  |
| COMMIT-10 | Template messaggio commit (`commit.template`) e commit precedenti come suggerimento | P2  |
| COMMIT-11 | Aggiungere a .gitignore da menu contestuale                                         | P1  |
| COMMIT-12 | Esecuzione hook Git (pre-commit, commit-msg…) con visualizzazione output/errori     | P0  |
| COMMIT-13 | Pulsante cestino: scarta tutte le modifiche                                         | P1  |

## 5. Diff e visualizzazione file (DIFF)

| ID      | Requisito                                                 | Pri |
| ------- | --------------------------------------------------------- | --- |
| DIFF-01 | Diff **inline** (unified) e **split** (side-by-side)      | P0  |
| DIFF-02 | Syntax highlighting                                       | P0  |
| DIFF-03 | Evidenziazione intra-riga delle parti cambiate            | P1  |
| DIFF-04 | Opzioni: ignora whitespace, righe di contesto, word wrap  | P1  |
| DIFF-05 | Vista **file completo** con modifiche evidenziate         | P1  |
| DIFF-06 | Diff immagini (affiancate / sovrapposte / swipe)          | P2  |
| DIFF-07 | Rilevamento file binari e file LFS                        | P0  |
| DIFF-08 | Diff tra due commit/branch qualsiasi                      | P1  |
| DIFF-09 | **File History**: cronologia commit di un file            | P1  |
| DIFF-10 | **Blame** con annotazione per riga (autore, data, commit) | P1  |
| DIFF-11 | Editor integrato per modificare file direttamente         | P2  |
| DIFF-12 | Apertura in editor/diff tool esterno configurabile        | P1  |

## 6. Dettaglio commit (DETAIL)

| ID        | Requisito                                                                            | Pri |
| --------- | ------------------------------------------------------------------------------------ | --- |
| DETAIL-01 | Pannello con SHA, autore, committer, date, genitori (cliccabili), messaggio completo | P0  |
| DETAIL-02 | Lista file modificati nel commit con statistiche +/−                                 | P0  |
| DETAIL-03 | Click su file → diff del file in quel commit                                         | P0  |
| DETAIL-04 | Modifica messaggio commit (reword) dal pannello                                      | P1  |
| DETAIL-05 | Indicatore firma verificata (GPG/SSH)                                                | P2  |

## 7. Branch (BRANCH)

| ID        | Requisito                                                                                | Pri |
| --------- | ---------------------------------------------------------------------------------------- | --- |
| BRANCH-01 | Creare branch (da HEAD o da un commit qualsiasi) con checkout opzionale                  | P0  |
| BRANCH-02 | Checkout branch locale; checkout branch remoto → crea tracking locale                    | P0  |
| BRANCH-03 | Rinominare branch                                                                        | P0  |
| BRANCH-04 | Eliminare branch locale (con force se non mergiato) e remoto                             | P0  |
| BRANCH-05 | Impostare/modificare upstream                                                            | P1  |
| BRANCH-06 | Checkout "detached HEAD" su un commit                                                    | P1  |
| BRANCH-07 | Gestione modifiche non committate al checkout (stash automatico / blocco / porta con sé) | P0  |

## 8. Merge, rebase e conflitti (MERGE)

| ID       | Requisito                                                                                           | Pri |
| -------- | --------------------------------------------------------------------------------------------------- | --- |
| MERGE-01 | Merge (fast-forward, no-ff, squash)                                                                 | P0  |
| MERGE-02 | Rebase di un branch su un altro                                                                     | P0  |
| MERGE-03 | **Interactive rebase** visuale: pick, reword, squash, fixup, drop, riordino drag & drop             | P1  |
| MERGE-04 | Stato "merge/rebase in corso" con banner e pulsanti Continue / Skip / Abort                         | P0  |
| MERGE-05 | Lista file in conflitto                                                                             | P0  |
| MERGE-06 | **Merge conflict tool integrato** a 3 pannelli (ours / theirs / output) con selezione per hunk/riga | P1  |
| MERGE-07 | "Take all ours / theirs" per file                                                                   | P0  |
| MERGE-08 | Apertura conflitto in merge tool esterno                                                            | P1  |
| MERGE-09 | Cherry-pick (singolo e multiplo)                                                                    | P0  |
| MERGE-10 | Revert commit                                                                                       | P0  |
| MERGE-11 | Reset soft / mixed / hard a un commit                                                               | P0  |

## 9. Remoti e sincronizzazione (REMOTE)

| ID        | Requisito                                                                                             | Pri |
| --------- | ----------------------------------------------------------------------------------------------------- | --- |
| REMOTE-01 | **Pull** con strategie: fetch only, fast-forward if possible, merge, rebase (dropdown accanto a Pull) | P0  |
| REMOTE-02 | **Push**, con creazione upstream al primo push                                                        | P0  |
| REMOTE-03 | Force push (`--force-with-lease`) con conferma esplicita                                              | P0  |
| REMOTE-04 | Fetch manuale e **fetch automatico periodico** configurabile                                          | P0  |
| REMOTE-05 | Aggiungere / rimuovere / rinominare / modificare URL dei remoti                                       | P0  |
| REMOTE-06 | Push/eliminazione tag su remoto                                                                       | P1  |
| REMOTE-07 | Fetch con prune                                                                                       | P1  |
| REMOTE-08 | Aggiungere remoto di un fork dal provider                                                             | P2  |

## 10. Stash (STASH)

| ID       | Requisito                                                       | Pri |
| -------- | --------------------------------------------------------------- | --- |
| STASH-01 | **Stash** rapido dalla toolbar e stash con messaggio            | P0  |
| STASH-02 | **Pop** / apply / drop                                          | P0  |
| STASH-03 | Stash in grafo come nodo dedicato                               | P1  |
| STASH-04 | Visualizzare contenuto (diff) di uno stash                      | P0  |
| STASH-05 | Stash inclusi untracked; stash parziale (solo file selezionati) | P1  |
| STASH-06 | Auto-stash prima di checkout/pull/rebase                        | P1  |

## 11. Tag (TAG)

| ID     | Requisito                                         | Pri |
| ------ | ------------------------------------------------- | --- |
| TAG-01 | Creare tag leggero e annotato su qualsiasi commit | P0  |
| TAG-02 | Eliminare tag locale / remoto                     | P0  |
| TAG-03 | Checkout di un tag                                | P1  |

## 12. Funzioni Git avanzate (ADV)

| ID     | Requisito                                                                                          | Pri |
| ------ | -------------------------------------------------------------------------------------------------- | --- |
| ADV-01 | **Undo / Redo** delle ultime operazioni (checkout, commit, reset, branch delete…) basato su reflog | P1  |
| ADV-02 | Submodule: add, init, update, sync, apertura come repo separato                                    | P1  |
| ADV-03 | **Git LFS**: track/untrack, pull/push, indicatori nei file                                         | P1  |
| ADV-04 | **Git Flow**: init, start/finish feature/release/hotfix                                            | P2  |
| ADV-05 | Reflog consultabile                                                                                | P2  |
| ADV-06 | Bisect guidato                                                                                     | P2  |
| ADV-07 | Patch: crea da commit / applica file .patch                                                        | P2  |
| ADV-08 | Sparse checkout                                                                                    | P2  |
| ADV-09 | Firma commit e tag GPG / SSH                                                                       | P1  |

## 13. Toolbar, navigazione e produttività (UI)

| ID    | Requisito                                                                                                          | Pri                |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ------------------ |
| UI-01 | Toolbar con: breadcrumb repository › branch, Undo, Redo, Pull, Push, Branch, Stash, Pop, Terminal, Actions, Search | P0                 |
| UI-02 | **Command Palette** (Ctrl+P / Ctrl+Shift+P) per tutte le azioni                                                    | P1                 |
| UI-03 | Scorciatoie da tastiera complete e personalizzabili                                                                | P1                 |
| UI-04 | **Terminale integrato** nella cartella del repo                                                                    | P1                 |
| UI-05 | Tema scuro e chiaro (+ temi personalizzati)                                                                        | P0 dark / P1 light |
| UI-06 | Zoom interfaccia (status bar 100%)                                                                                 | P1                 |
| UI-07 | Status bar: stato operazioni, versione, zoom, notifiche                                                            | P1                 |
| UI-08 | Notifiche toast per operazioni completate / errori con dettaglio output git                                        | P0                 |
| UI-09 | Log attività: elenco comandi git eseguiti e relativo output                                                        | P1                 |
| UI-10 | Barra menu File / Edit / View / Help                                                                               | P0                 |
| UI-11 | Layout a 3 pannelli ridimensionabili con persistenza dimensioni                                                    | P0                 |
| UI-12 | Internazionalizzazione (IT / EN)                                                                                   | P2                 |

## 14. Autenticazione e profili (AUTH)

| ID      | Requisito                                                                        | Pri |
| ------- | -------------------------------------------------------------------------------- | --- |
| AUTH-01 | Autenticazione HTTPS con username/token, salvataggio nel **keychain di sistema** | P0  |
| AUTH-02 | SSH: uso di ssh-agent / Pageant, chiavi esistenti, generazione nuova chiave      | P0  |
| AUTH-03 | Integrazione Git Credential Manager                                              | P0  |
| AUTH-04 | **Profili** multipli (nome, email, chiavi, account) con switch rapido            | P1  |
| AUTH-05 | Impostazione identità per repository (`user.name` / `user.email` locali)         | P0  |
| AUTH-06 | Login OAuth a GitHub / GitLab / Bitbucket / Azure DevOps                         | P2  |

## 15. Integrazioni (INT) — P2

| ID     | Requisito                                                                                          | Pri |
| ------ | -------------------------------------------------------------------------------------------------- | --- |
| INT-01 | Pull Request: elenco, creazione, review, commenti, merge (GitHub, GitLab, Bitbucket, Azure DevOps) | P2  |
| INT-02 | Issue tracker: GitHub Issues, GitLab, Jira — elenco, creazione branch da issue                     | P2  |
| INT-03 | Stato CI/CD sui commit                                                                             | P2  |
| INT-04 | Cloud Patches / condivisione modifiche                                                             | P2  |
| INT-05 | Launchpad: dashboard PR/issue personali cross-repo                                                 | P2  |

## 16. Funzionalità AI (AI) — P2

| ID    | Requisito                                                      | Pri |
| ----- | -------------------------------------------------------------- | --- |
| AI-01 | Generazione messaggio di commit dalle modifiche in stage       | P2  |
| AI-02 | "Compose commits": suddivide le modifiche in più commit logici | P2  |
| AI-03 | Spiegazione di un commit / branch                              | P2  |
| AI-04 | Assistenza alla risoluzione dei conflitti                      | P2  |
| AI-05 | Generazione descrizione PR                                     | P2  |

## 17. Impostazioni (SET)

| ID     | Requisito                                                                  | Pri |
| ------ | -------------------------------------------------------------------------- | --- |
| SET-01 | Preferenze globali: tema, font, editor esterno, diff/merge tool, terminale | P0  |
| SET-02 | Intervallo auto-fetch, comportamento pull predefinito                      | P0  |
| SET-03 | Editor di `.gitconfig` (globale e per repo) via UI                         | P1  |
| SET-04 | Percorso eseguibile git personalizzabile                                   | P0  |
| SET-05 | Import/export impostazioni                                                 | P2  |

---

## 18. Requisiti non funzionali (NFR)

| ID     | Requisito                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| NFR-01 | **Piattaforme**: Windows 10/11 (primaria), macOS, Linux                                                                 |
| NFR-02 | **Performance**: apertura repo < 2s su repo con 50k commit; grafo a 60 fps durante lo scroll                            |
| NFR-03 | **Scalabilità**: supporto repo tipo Linux kernel (1M+ commit) con caricamento incrementale                              |
| NFR-04 | **Affidabilità**: mai perdere dati — conferma per operazioni distruttive, backup ref prima di reset/rebase              |
| NFR-05 | **Compatibilità**: rispetto totale della configurazione git utente (`.gitconfig`, hooks, attributes, credential helper) |
| NFR-06 | **Sicurezza**: credenziali solo nel keychain di sistema, nessun segreto in chiaro su disco                              |
| NFR-07 | **Trasparenza**: ogni operazione mostra il comando git equivalente e l'output in caso di errore                         |
| NFR-08 | **Aggiornamenti automatici** dell'applicazione                                                                          |
| NFR-09 | **Accessibilità**: navigazione completa da tastiera, contrasto adeguato                                                 |
| NFR-10 | **Memoria**: < 500 MB RAM con 5 repository aperti                                                                       |
| NFR-11 | **Testabilità**: suite di test su repository fixture per ogni operazione git                                            |

---

## 19. Scelte architetturali (decise il 2026-09-24)

Contesto: uso personale, al massimo condivisa con qualche amico/collega. Si privilegia semplicità e velocità di sviluppo rispetto a distribuzione e scalabilità commerciale.

| #   | Decisione           | Scelta                                                                                      | Motivo                                                                                                                                                               |
| --- | ------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Framework desktop   | **Electron** (via electron-vite)                                                            | Richiede solo Node.js: il PC aziendale non ha permessi admin e winget è bloccato, quindi Tauri (Rust + VS Build Tools) non è installabile                            |
| D2  | Motore Git          | **CLI `git`** invocata dal main process Node (child_process), output parsato                | Hook, config, credential manager, LFS e SSH funzionano gratis e identici al terminale. `gitoxide` solo se in futuro la lettura del log diventa un collo di bottiglia |
| D3  | Rendering grafo     | **Canvas 2D** virtualizzato                                                                 | Unico approccio fluido con decine di migliaia di commit                                                                                                              |
| D4  | Frontend            | **React + TypeScript + Vite**, stato con **Zustand**                                        | Ecosistema più ampio, componenti pronti                                                                                                                              |
| D5  | Editor/diff         | **Diff viewer custom (React + highlight.js)**; Monaco solo per l'editor file (M4)           | Lo staging di hunk e singole righe richiede il controllo di ogni riga: con un componente proprio è semplice, con Monaco sarebbe una lotta contro l'API               |
| D6  | Terminale integrato | **xterm.js** + `node-pty` (con binari precompilati: niente compilatore C++ disponibile)     | Standard de facto                                                                                                                                                    |
| D7  | Test                | **Vitest** (frontend) + test del layer git con repository fixture temporanei (main process) |                                                                                                                                                                      |
| D8  | Distribuzione       | Installer `.exe` (NSIS) generato da electron-builder, condiviso a mano; nessuno store       | Uso personale                                                                                                                                                        |

### Impatto sulle priorità

- **NFR-01**: solo Windows come target verificato; macOS/Linux "probabilmente funzionano" grazie a Electron, non testati.
- **NFR-10** (RAM): obiettivo rilassato a < 800 MB, Electron pesa di più.
- **NFR-08** (auto-update): declassato a P2.
- **UI-12** (i18n): rimosso — interfaccia solo in inglese.
- **AUTH-06**, **INT-\***: restano P2, si valuteranno in base al provider usato.

---

## 20. Roadmap proposta

1. **Milestone 0 — Fondamenta**: scelta stack, scaffolding, layer di esecuzione comandi git, apertura repo.
2. **Milestone 1 — Grafo read-only**: log, algoritmo di layout delle lanes, rendering virtualizzato, pannello laterale, dettaglio commit, diff.
3. **Milestone 2 — Workflow quotidiano (MVP)**: staging/commit, branch, checkout, pull/push/fetch, stash, tag, autenticazione.
4. **Milestone 3 — Operazioni avanzate**: merge/rebase, conflitti, cherry-pick, reset, revert, interactive rebase, undo/redo.
5. **Milestone 4 — Rifinitura v1.0**: command palette, terminale, blame, file history, submodule, LFS, profili, tema chiaro.
6. **Milestone 5 — Integrazioni e AI**.
