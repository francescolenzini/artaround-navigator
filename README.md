# artaround-navigator — Navigator

App smartphone (React 19 + TypeScript + TanStack Router, SPA Vite) con cui i
visitatori seguono una visita guidata: login, elenco visite, player audio/testo
per opera, mappa multi-piano con pin. Consuma il backend Node/Express/MongoDB
(`artaround-backend`).

Progetto **autonomo**: si sviluppa e si esegue anche da solo, senza il repo
`artaround` — a patto di avere un backend raggiungibile.

> **Esecuzione: esclusivamente via Docker.** Non è previsto l'avvio nativo
> (`npm run dev` diretto sull'host): tutte le variabili sono fornite dai file
> `docker-compose`, e la config con la API key (`app/public/api.config.json`) è
> **generata all'avvio**, mai committata.

## Struttura del repo

```
.
├── app/                       # applicazione (unico artefatto buildato)
│   ├── index.html
│   ├── package.json / package-lock.json / bun.lock / bunfig.toml
│   ├── vite.config.ts / tsconfig.json / eslint.config.js / components.json
│   ├── .prettierrc / .prettierignore
│   ├── src/                    # main.tsx, router.tsx, routes/, components/, hooks/, lib/
│   └── public/
│       ├── museum.config.json  # config del museo (non un segreto, committata)
│       ├── maps/                # immagini piantina (uffizi-p1.png, uffizi-p2.png)
│       └── api.config.json      # generato a runtime (contiene la apiKey) — MAI committato
├── docker/
│   ├── Dockerfile                          # immagine di SVILUPPO (Vite dev server)
│   ├── Dockerfile.prod                     # immagine di PRODUZIONE (build + nginx)
│   ├── nginx.conf                          # SPA fallback per il runtime di produzione
│   ├── docker-entrypoint.d/
│   │   └── 10-generate-api-config.sh       # genera api.config.json all'avvio (solo prod/nginx)
│   ├── docker-compose.yml                  # dev autonomo: solo il Navigator
│   └── docker-compose.prod.yml             # prod autonomo: solo il Navigator
├── .dockerignore
├── .gitignore
└── README.md
```

Non esiste una suite di test automatizzata per questo componente (nessuno
script `test` in `package.json`).

---

## Nota sulla ristrutturazione (nesting risolto)

Il repo aveva in precedenza un annidamento `navigator/navigator/` (il vero
progetto Vite viveva una cartella sotto la radice del repo), oltre a due file
alla radice (`index.ts`, `mockData.ts`) rimasti da **prima** della migrazione a
questa struttura — tipi e mock-data non referenziati da nessun file sotto
`src/` (verificato: `tsconfig.json` include solo `src/**`, e l'alias `@/types`
risolve al vero `app/src/lib/types.ts`, non al file alla radice). Sono stati
spostati in `_to_delete/` insieme alla vecchia cartella `navigator/` ora vuota:
puoi rimuoverli.

### Riferimenti a Lovable rimossi

Il progetto era stato generato da Lovable (vedi template originario
`tanstack_start_ts_current`). Rimossi in questa ristrutturazione, perché non
servono più fuori dal sandbox Lovable:

- `app/.lovable/` — solo metadati IDE (schemaVersion, template, revision), non
  referenziati da alcun codice.
- `app/src/lib/lovable-error-reporting.ts` — inviava gli errori a
  `window.__lovableEvents`, un hook che esiste solo dentro il sandbox Lovable;
  fuori era un no-op silenzioso. Rimosso insieme al suo utilizzo in
  `app/src/routes/__root.tsx` (import e `useEffect` dedicato), mantenendo il
  `console.error(error)` già presente come logging dell'errore.

Nello stesso passaggio sono stati rimossi anche due file orfani non legati a
Lovable ma della stessa origine (residui SSR pre-migrazione, non importati da
nessuna parte): `app/src/lib/error-capture.ts` e `app/src/lib/error-page.ts`
(il primo faceva riferimento esplicito a `server.ts`, già rimosso). Tutti e
quattro sono in `_to_delete/`.

---

## La dockerizzazione, in dettaglio

Due topologie indipendenti, come per backend e Editor. Il Navigator, come
l'Editor, **non include un database**: si collega a un backend già in
esecuzione altrove.

### File coinvolti e ruolo di ciascuno

| File | Usato da | Ruolo |
|---|---|---|
| `docker/Dockerfile` | `docker-compose.yml` (dev) | `node:20-alpine`. Installa le dipendenze di `app/` e lancia il `CMD`, che genera `app/public/api.config.json` dalle variabili d'ambiente (`API_KEY`, `BACKEND_URL`) e avvia `vite` in ascolto su tutte le interfacce. Pensata per il sorgente bind-montato (vedi sotto). |
| `docker/Dockerfile.prod` | `docker-compose.prod.yml` (prod) | Multi-stage: uno stage `build` (`node:20-alpine`) esegue `npm ci && npm run build`; lo stage `runtime` (`nginx:1.27-alpine`) serve `dist/` con `nginx.conf` (SPA fallback) ed esegue `docker-entrypoint.d/10-generate-api-config.sh` **all'avvio del container**, prima che nginx parta (meccanismo standard dell'immagine ufficiale nginx: ogni script in `/docker-entrypoint.d/` viene eseguito automaticamente). |
| `docker/nginx.conf` | `Dockerfile.prod` | `try_files ... /index.html` per il routing lato client di TanStack Router; disabilita la cache su `/api.config.json` (rigenerato a ogni avvio). |
| `docker/docker-entrypoint.d/10-generate-api-config.sh` | `Dockerfile.prod` (runtime) | Scrive `api.config.json` nella cartella servita da nginx, dalle env `BACKEND_URL` (obbligatoria) e `API_KEY`. |
| `docker/docker-compose.yml` | sviluppo | Un solo servizio, **`navigator`**. Bind-mount del sorgente + volume dedicato per `node_modules` (ha dipendenze pesanti: React, TanStack, Radix UI, ecc. — a differenza dell'Editor). |
| `docker/docker-compose.prod.yml` | produzione standalone | Un solo servizio, **`navigator`**. `API_KEY` e `BACKEND_URL` sono **obbligatorie**: il compose si rifiuta di partire se mancano. |
| `.dockerignore` | entrambe le build | Esclude `node_modules`, `dist`/output di build, `_to_delete/`, la cartella `navigator/` residua, `.git`, e **`app/public/api.config.json`** (il segreto generato a runtime non deve mai finire in un layer immagine). |

### Come viene gestita la API key (nessun file committato)

Il codice dell'app non è stato modificato: `AppContext.tsx` continua a fare
`fetch('/api.config.json')` esattamente come prima. Ciò che cambia è che quel
file **non esiste nel repo**: viene scritto dal container a ogni avvio,
interpolando le variabili d'ambiente — stesso principio già adottato per il
Editor (`serve.config.json`) e per il backend (niente `.env.example`,
tutto dal compose).

```json
{ "baseUrl": "<da $BACKEND_URL>", "apiKey": "<da $API_KEY>" }
```

> **Caveat, ereditato dal comportamento attuale dell'app:** in questa modalità
> standalone (senza il proxy server-side del repo Main) la `apiKey` finisce
> comunque nel bundle servito al browser — esattamente come accade oggi il
> Navigator fuori dall'integrazione col Main. Il deploy finale (repo
> `artaround`) inietta la chiave lato server e qui non è mai esposta;
> questo compose standalone serve solo a validare il Navigator da solo.

### Come il Navigator raggiunge il backend

Stesso principio dell'Editor: in sviluppo il compose punta di default a
`http://host.docker.internal:3002` (il backend standalone del repo
`artaround-backend`, pubblicato sull'host), con:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

necessario su Linux (nativo su Docker Desktop mac/Windows). In produzione non
c'è default: `BACKEND_URL` va sempre passato esplicitamente.

### `museum.config.json`: non è un segreto

A differenza di `api.config.json`, `app/public/museum.config.json` **è
committato** (contiene `museumSlug`, testi, riferimenti alle mappe): non è un
segreto, è la configurazione del museo con cui l'app viene personalizzata.
Nota ereditata dal progetto: il campo `editorUrl` al suo interno è ancora
hardcoded (`http://localhost:5174`) — noto e già segnalato nella
documentazione del progetto come da rendere configurabile in vista del deploy
reale; non l'ho toccato in questa ristrutturazione perché esula dalla
dockerizzazione.

### Bind-mount + volume per `node_modules`

Come nel backend (e a differenza dell'Editor, che non ne ha bisogno): il
sorgente è bind-montato (`..:/app`) per l'hot-reload, e un volume dedicato
protegge `node_modules` (`/app/app/node_modules`) da quel bind-mount.
`CHOKIDAR_USEPOLLING=true` è impostato per compatibilità con bind-mount su
macOS/Windows.

---

## Sviluppo (Docker)

Presuppone un backend già raggiungibile (es. `artaround-backend` avviato con
il suo compose, pubblicato su `:3002`).

```bash
# build + avvio (API_KEY vuota finché non fai il seed sul backend)
docker compose -f docker/docker-compose.yml up -d --build

# dopo aver ottenuto la API key dal seed del backend, impostala e riavvia:
API_KEY=<chiave-dal-seed-del-backend> docker compose -f docker/docker-compose.yml up -d
```

- App → <http://localhost:5173>
- Se il backend gira su un host/porta diversi: `BACKEND_URL=http://<host>:<porta> docker compose -f docker/docker-compose.yml up -d`

Account demo (password `12345678`): `visitatore1`/`visitatore2` (visitor). Gli
account `admin`/`autore*` funzionano ma sono pensati per l'Editor.

Stop:

```bash
docker compose -f docker/docker-compose.yml down
```

## Produzione (Docker)

`Dockerfile.prod` / `docker-compose.prod.yml` buildano la SPA e la servono con
nginx, senza bind-mount. `API_KEY` e `BACKEND_URL` sono **obbligatorie**:

```bash
API_KEY=<chiave> BACKEND_URL=https://api.tuo-dominio.it \
  docker compose -f docker/docker-compose.prod.yml up -d --build
```

- App → <http://localhost:${NAVIGATOR_PORT:-8080}>

Per il deploy sui **due container del dipartimento** si usa il repo
**artaround**, che assembla i build dei tre componenti e inietta la API
key lato server (nessuna esposizione nel browser) — questo compose di
produzione standalone serve a validare il Navigator da solo, non è il percorso
di consegna finale.

---

## Variabili d'ambiente

| Variabile | Sviluppo (default) | Produzione |
|---|---|---|
| `API_KEY` | vuota (login fallisce finché non la imposti dopo il seed) | **obbligatoria**, nessun default |
| `BACKEND_URL` | `http://host.docker.internal:3002` | **obbligatoria**, nessun default |
| `CHOKIDAR_USEPOLLING` | `true` (fisso, per l'HMR su bind-mount) | non applicabile (nessun watch in prod) |
| `NAVIGATOR_PORT` | — | `8080` (porta pubblicata sull'host, nginx ascolta su 80 nel container) |

## Troubleshooting

| Sintomo | Causa probabile | Rimedio |
|---|---|---|
| Login fallisce con `Invalid API key` | `API_KEY` mancante, vuota o vecchia | ri-esegui il seed sul backend, imposta `API_KEY`, riavvia |
| Schermata bianca / errore di rete al primo avvio | `api.config.json` non ancora generato o `BACKEND_URL` errato | verifica i log del container: il `CMD`/entrypoint scrive il file prima di avviare Vite/nginx |
| Il Navigator non raggiunge un backend sull'host (Linux) | `host.docker.internal` non risolto | verifica `extra_hosts: host-gateway` nel compose di sviluppo |
| HMR lento o assente | watch su bind-mount (macOS/Windows) | già mitigato da `CHOKIDAR_USEPOLLING=true`; un piccolo ritardo è normale |
| `npm run build` fallisce nello stage `build` | dipendenza mancante/incompatibile | verifica `app/package-lock.json`; prova `npm ci` in locale fuori da Docker per isolare l'errore |

