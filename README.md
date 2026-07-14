# oefa-jsf-scraper

Scraper en TypeScript para el portal **REPDIG del OEFA** ([https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml](https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml)). Extrae resoluciones de apelación y descarga sus PDFs asociados, manejando correctamente sesiones JSF/PrimeFaces, ViewState, paginación AJAX, reintentos con backoff exponencial y validaciones de integridad.

> **Nota**: El portal principal del desafío (jurisprudencia.pj.gob.pe) bloquea accesos fuera de Perú (HTTP 403). Este scraper usa la URL alternativa oficial indicada en el desafío, accesible sin VPN.

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CONFIG (.env)                             │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        SESSION MANAGER                              │
│  ┌──────────────────┐  ┌────────────────────────────────────────┐   │
│  │ HttpClient       │  │ ViewStateManager (ReadOnly / Writer)   │   │
│  │ - axios + Cookie │  │ - Single source of truth for ViewState │   │
│  │ - JSESSIONID     │  │ - PCK-004: only SessionManager writes  │   │
│  └────────┬─────────┘  └────────────────────────────────────────┘   │
└───────────┼─────────────────────────────────────────────────────────┘
            │
     ┌──────┴──────┐
     ▼             ▼
┌───────────┐   ┌───────────────┐
│ SEARCH    │   │ PAGINATION    │
│ SERVICE   │   │ SERVICE       │
│           │   │               │
│ POST      │   │ POST          │
│ btnBuscar │   │ dt_pagination │
└────┬──────┘   └──────┬────────┘
     │                 │
     ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        XML PARSER (fast-xml-parser)                 │
│  partial-response  ──►  updates[]  ──►  HTML table + new ViewState  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        HTML PARSER (cheerio)                        │
│  <table id$=":dt"> tbody tr[data-ri]  ──►  ResolutionRow[]          │
│  - uuid from onclick param_uuid                                     │
│  - pdfButtonId from onclick                                         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PDF DOWNLOADER                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────────┐   │
│  │ Retry           │  │ Concurrency     │  │ PdfStorage         │   │
│  │ (exp backoff)   │  │ (pool 2–4)      │  │ (atomic .tmp→mv)   │   │
│  └─────────────────┘  └─────────────────┘  └────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    VALIDATION & EXPORT                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │ SanityChecker    │  │ PdfValidator     │  │ JsonExporter       │  │
│  │ - dup UUIDs      │  │ - exists         │  │ - resoluciones.json│  │
│  │ - dup expediente │  │ - size > 0       │  │ - exportedAt       │  │
│  │ - required fields│  └──────────────────┘  └────────────────────┘  │
│  │ - total match    │                                                │
│  └──────────────────┘                                                │
└──────────────────────────────────────────────────────────────────────┘
```

---



## 2. Project Structure

```
src/
├── client/
│   └── HttpClient.ts           # Axios + CookieJar (JSESSIONID automático)
├── config/
│   └── index.ts                # dotenv + zod → AppConfig inmutable
├── jsf/
│   └── FormParamsBuilder.ts    # Parámetros POST exactos del formulario JSF
├── models/
│   ├── Resolution.ts           # ResolutionSchema (zod) + ResolutionRow
│   ├── SearchFilters.ts        # { numeroExpediente?, sector? }
│   ├── SearchResult.ts         # { rows, totalRecords, viewState }
│   ├── PaginationPageResult.ts # { rows }
│   └── PartialResponse.ts      # { updates, viewState }
├── parser/
│   ├── XmlParser.ts            # partial-response → updates[] + viewState
│   └── HtmlParser.ts           # DataTable PrimeFaces → ResolutionRow[]
├── scraper/
│   ├── SearchService.ts        # POST btnBuscar + parse
│   ├── PaginationService.ts    # POST dt_pagination + parse
│   └── PdfDownloader.ts        # Orquesta retry + concurrencia + storage
├── session/
│   ├── SessionManager.ts       # init()/restart(), única autoridad ViewState
│   ├── ViewStateManager.ts     # ReadOnlyViewState + Writer interno
│   └── MissingViewStateError.ts
├── storage/
│   ├── PdfStorage.ts           # savePdf (stream → .tmp → rename atómico)
│   ├── FailureRecorder.ts      # failed-downloads.json (NDJSON append)
│   └── JsonExporter.ts         # resoluciones.json pretty
├── validation/
│   ├── SanityChecker.ts        # dup UUIDs, dup expedientes, campos req, total
│   └── PdfValidator.ts         # valida PDFs en disco
├── utils/
│   ├── Logger.ts               # pino + redact cookies
│   ├── Retry.ts                # backoff exponencial + jitter genérico
│   ├── Concurrency.ts          # mapWithConcurrency (pool worker)
│   └── Sleep.ts                # sleep abortable
├── Scraper.ts                  # Orquestador: search → paginate → download → validate → export
└── main.ts                     # Bootstrap, CLI args (--sector, --expediente)

tests/
├── e2e.test.ts                 # Flujo completo con servidor HTTP local + fixtures
├── scraper.test.ts             # Orquestación (reintentos ViewState, export si falla download)
├── client.test.ts              # HttpClient GET/POST + cookie persistence
├── jsf/
│   └── FormParamsBuilder.test.ts
├── parser/
│   ├── xml.test.ts
│   └── html.test.ts
├── validation/
│   └── sanity.test.ts
├── pagination.test.ts
├── download.test.ts
├── storage.test.ts
├── retry.test.ts
├── session.test.ts
├── config.test.ts
├── logger.test.ts
├── sleep.test.ts
├── json.test.ts
├── pdfvalidator.test.ts
├── fixtures/                   # Payloads reales del portal
│   ├── page.html
│   ├── datatable.html
│   ├── partial-search.xml
│   └── partial-page2.xml
└── scaffold.test.ts
```

---



## 3. Features

✅ **JSF ViewState management** — Extracción y renovación automática tras cada respuesta AJAX  
✅ **PrimeFaces AJAX parsing** — `partial-response` XML con CDATA → HTML tabla + ViewState  
✅ **Automatic session recovery** — `MissingViewStateError` → `SessionManager.restart()` (máx 3 intentos)  
✅ **Retry with exponential backoff + jitter** — Genérico, configurable, solo reintenta 429/5xx  
✅ **Concurrent PDF downloads** — Pool 2–4 workers (`OEFA_DOWNLOAD_CONCURRENCY`)  
✅ **Atomic file writes** — Stream → `.tmp` → `rename()`; evita PDFs corruptos parciales  
✅ **JSON export** — `resoluciones.json` con `exportedAt`, `count`, `resolutions[]`  
✅ **Sanity validation** — Duplicados UUID/expediente, campos requeridos, total esperado vs obtenido  
✅ **Failure recovery** — `failed-downloads.json` (NDJSON) con uuid, buttonId, status, error, timestamp  
✅ **Zero browser automation** — Solo HTTP (axios) + parsing (cheerio, fast-xml-parser)  
✅ **TypeScript strict** — `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, ESM `NodeNext`  

---



## 4. Design Decisions


| Módulo                | ¿Por qué existe?                                                                                                                                                       | Decisión clave                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **SessionManager**    | Autoridad única del ViewState (PCK-004). Evita race conditions si varios servicios actualizan el ViewState concurrentemente.                                           | Solo `SessionManager` tiene `updateViewState()`. Servicios leen con `getViewState()` (ReadOnlyViewState) y devuelven el nuevo valor al manager. |
| **FormParamsBuilder** | Los IDs JSF son frágiles (`listarDetalleInfraccionRAAForm:dt:0:j_idt63`). Centralizarlos permite adaptar el scraper cambiando un solo archivo cuando el portal cambie. | Funciones puras `buildSearchParams`, `buildPaginationParams`, `buildDownloadParams` sin side effects. Testables unitariamente.                  |
| **XmlParser**         | PrimeFaces envuelve el HTML en `<update><![CDATA[...]]></update>`. `fast-xml-parser` con `cdataPropName: "#cdata"` preserva el HTML intacto.                           | Función pura `parsePartialResponse(xml)` → `{ updates[], viewState }`. No toca SessionManager.                                                  |
| **HtmlParser**        | La tabla PrimeFaces usa `tr[data-ri]` y el `onclick` del botón PDF está en la **última celda**, no en la fila.                                                         | Selector `table[id$=":dt"] tbody tr[data-ri]`. Regex sobre `onclick` para `param_uuid` y `buttonId`. Valida cada fila con zod.                  |
| **Retry**             | Los PDFs devuelven 429 (rate limit). Backoff exponencial + jitter evita thundering herd.                                                                               | Genérico (`retry<T>(fn, opts)`), independiente de HTTP. `shouldRetry` decide por tipo de error.                                                 |
| **FailureRecorder**   | Si un PDF falla definitivamente (404, 403), registrar contexto completo para reintento manual posterior.                                                               | NDJSON append (`failed-downloads.json`). Cada línea: uuid, buttonId, expediente, attempts, lastStatus, lastError, timestamp.                    |
| **PdfStorage**        | Escritura atómica evita PDFs de 0 bytes si el proceso muere a mitad de descarga.                                                                                       | `pipeline(stream, createWriteStream(tmp))` → `stat(tmp)` → `size>0` → `rename(tmp, final)`.                                                     |
| **SanityChecker**     | Detecta corrupción silenciosa (duplicados, campos vacíos, total mismatch) antes de exportar.                                                                           | Lanza `SanityError` con reporte detallado. `assertValid()` para fail-fast.                                                                      |


---



## 5. How It Works

```
GET /repdig/consulta/consultaTfa.xhtml
      │
      ▼
┌───────────────────────────────────────────────┐
│  HTML inicial → extrae javax.faces.ViewState  │
│  Cookie JSESSIONID establecida                │
└───────────────────────────────────────────────┘
      │
      ▼
POST btnBuscar (AJAX: Faces-Request=partial/ajax)
      │
      ├─► javax.faces.partial.ajax=true
      ├─► javax.faces.source=...:btnBuscar
      ├─► javax.faces.partial.execute=@all
      ├─► javax.faces.partial.render=...:pgLista ...:txtNroexp
      └─► javax.faces.ViewState=<actual>
      │
      ▼
┌───────────────────────────────────────────┐
│  partial-response XML                     │
│  ├─ update[id=...:pgLista] → HTML tabla   │
│  └─ update[id=...:ViewState:0] → nuevo VS │
└───────────────────────────────────────────┘
      │
      ├─► XmlParser → updates[] + viewState
      ├─► SessionManager.updateViewState(nuevo)
      └─► HtmlParser → ResolutionRow[] (uuid, buttonId, datos)
      │
      ▼
┌──────────────────────────────────────────┐
│  PAGINACIÓN (while rows < totalRecords)  │
│  POST dt_pagination (AJAX)               │
│  ├─► ...:dt_pagination=true              │
│  ├─► ...:dt_first=10,20,30...            │
│  ├─► ...:dt_rows=10                      │
│  └─► javax.faces.source=...:dt           │
└──────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────┐
│  DESCARGA PDF (POST normal, NO AJAX)     │
│  mojarra.jsfcljs(...) →                  │
│  ├─► buttonId=...:dt:N:j_idt63           │
│  └─► param_uuid=<uuid>                   │
│  Response: application/octet-stream      │
└──────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────┐
│  VALIDACIÓN + EXPORT                     │
│  SanityChecker.assertValid(rows, total)  │
│  PdfValidator.validateDownloaded(rows)   │
│  JsonExporter.export(rows, path)         │
└──────────────────────────────────────────┘
```

---



## 6. Known Limitations

- **Dependencia de estructura PrimeFaces actual**: si cambian los IDs del formulario (`listarDetalleInfraccionRAAForm`), botones (`btnBuscar`, `dt`), o el paginador (`.ui-paginator-current`), hay que actualizar `FormParamsBuilder` y `HtmlParser`.
- **Requiere sesión válida**: el scraper obtiene `JSESSIONID` y `ViewState` en el GET inicial. Si el portal introduce CAPTCHA, challenge JS o Cloudflare, el flujo HTTP puro fallará.
- **Descarga concurrente moderada**: `OEFA_DOWNLOAD_CONCURRENCY=2` (máx 4 recomendado). Valores altos disparan 429 y saturan el portal.
- `totalRecords` **desde paginador**: el portal muestra “1 – 10 de 1.753” en `.ui-paginator-current`. Si el formato cambia, `extractTotalRecords` devolverá valor incorrecto y el sanity check reportará mismatch.
- **No probado contra portal real en esta sesión**: los tests usan fixtures locales. El primer run real puede revelar diferencias menores (separador de miles, encoding, headers extra).
- **PDFs grandes**: se hace streaming directo a disco (`responseType: "stream"`), pero no hay verificación de hash/checksum del contenido.

---



## 7. Quick Start



### Prerequisitos

- Node.js ≥ 20.11
- npm ≥ 10



### Instalación

```bash
git clone <repo>
cd oefa-jsf-scraper
npm ci
cp .env.example .env   # ajusta si necesitas
```



### Configuración (`.env`)

```env
# URL del portal (la alternativa sin VPN)
OEFA_BASE_URL=https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml

# Salida
OEFA_OUTPUT_DIR=./output
OEFA_JSON_FILE=./output/resoluciones.json
OEFA_PDF_DIR=./output/pdfs

# Paginación (no cambiar sin inspeccionar el portal)
OEFA_ROWS_PER_PAGE=10

# Descarga PDFs
OEFA_DOWNLOAD_CONCURRENCY=2
OEFA_DOWNLOAD_DELAY_MS=500

# Reintentos
OEFA_RETRY_MAX_ATTEMPTS=5
OEFA_RETRY_BASE_DELAY_MS=1000
OEFA_RETRY_MAX_DELAY_MS=30000
OEFA_RETRY_JITTER_MS=500

# HTTP
OEFA_HTTP_TIMEOUT_MS=30000
OEFA_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# Logging
OEFA_LOG_LEVEL=info   # debug | info | warn | error
```



### Ejecución

```bash
# Desarrollo (tsx, hot reload)
npm run dev [-- --sector=1 --expediente=EXP-2024-001]

# Producción (compilado)
npm run build
npm start [-- --sector=1 --expediente=EXP-2024-001]
```

**Filtros CLI**:

- `--sector=1|2|3|8|9` (vacío = todos). Ver `SearchFilters.ts` para mapeo: 1=MINERÍA, 2=ELECTRICIDAD, 3=HIDROCARBUROS, 8=PESQUERÍA, 9=INDUSTRIA.
- `--expediente=NUMERO` (parcial o exacto).



### Salida

```
output/
├── resoluciones.json       # { exportedAt, count, resolutions: [...] }
├── pdfs/
│   ├── EXP-2024-001_<uuid>.pdf
│   └── ...
└── failed-downloads.json   # solo si hay fallos definitivos (NDJSON)
```



### Tests

```bash
npm test           # 93 tests (unit + integración + e2e)
npm run test:watch # modo watch
npm run typecheck  # tsc --noEmit
npm run build      # compila a dist/
```

---



## License

MIT — desarrollado como prueba técnica para Magnar.