# Nova Debug Payload — v2 Schema

한국어 원본: [SCHEMA.md](SCHEMA.md) — **The Korean version is authoritative.** This document is a
faithful translation kept in sync with it; if the two ever disagree, the Korean version wins.

Framework-neutral debug payload spec. Produced by the server library (Nova/debug) and
consumed by the browser extension panel / the server's in-page fallback (`debug.js`).

- JSON Schema: [`schema/debug-payload.v2.schema.json`](schema/debug-payload.v2.schema.json) (draft 2020-12)
- Reference implementation: `Nova/debug/DebugAnalyzer.php::analyze()` (nova_builder repo)
- Consumer implementation: `Nova/debug/assets/debug.js` — `normalizeDebugPayload()` (converts v2 → renderer view model)
- Previous versions: v0 (no `schemaVersion` field, or `0`) — flattened ~20 scalars at the top
  level, and only `data[]`/`files[]` were arrays. Starting with v1, every output path (ext-saved
  JSON, in-page `window.__debugData`, text log) shares the same structure. v2 is the current
  version, absorbing v1's breaking changes (§13 Version Policy, changelog entry S5).

---

## 1. Top-level structure

```
{
  "schemaVersion": 2,
  "meta":       { ... },
  "summary":    { ... },
  "thresholds": { ... },
  "files":      [ ... ],
  "frames":     [ ... ],
  "entries":    [ ... ],
  "timeline":   [ ... ],
  "request":    { ... },  // optional — request context
  "x-nova":     { ... },  // optional — vendor extension
  "x-php":      { ... }   // optional — vendor extension
}
```

Required: `schemaVersion, meta, summary, thresholds, files, frames, entries, timeline`.
`request` is optional and included only when request context was collected (§12).
`x-nova`/`x-php` are optional and included only when there are vendor(Nova)-specific values or
PHP-reference-implementation-specific values, respectively (§9).

### Vendor extension keys — root `x-*` pattern

The root allows `patternProperties: {"^x-": {"type":"object"}}` (`additionalProperties: false`
is still kept). `x-nova`/`x-php` are already-known vendor extensions, but any other `x-`-prefixed
key (e.g. `x-client`, `x-debugbar`) also passes schema validation as long as its value is an
object — you don't need to modify the root schema every time a new vendor extension is added
(see §9).

---

## 2. `meta` — request metadata

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Request identifier. Pattern `^[A-Za-z0-9_-]+$` (defensively excludes path separators and other dangerous characters, since the id is used as a filename/lookup key — the reference implementation's `\d{6}_\d{6}_[0-9a-f]{16}` format is already covered by this pattern) |
| `generator` | string | ✓ | Producer name/version, e.g. `nova-debug/20260618a` |
| `request` | object | optional | Request-identifying metadata (uri/date). If present, both fields below are required |
| `request.uri` | string | optional (required if `request` present) | Request URI |
| `request.date` | string | optional (required if `request` present) | ISO 8601, including timezone offset (e.g. `2026-07-20T14:30:00+09:00`) |
| `runtime.name` | string | ✓ | Runtime/language name (lowercase convention), e.g. `php` |
| `runtime.version` | string | ✓ | Runtime version string (reference implementation: `PHP_VERSION`) |
| `ide.protocol` | string | optional | `phpstorm` / `idea` / `vscode` etc. |
| `ide.serverPath` | string | optional | Absolute project root path on the server side |
| `ide.localPath` | string | optional | Absolute project root path on the developer's local machine |
| `ide.project` | string | optional | IDE project name |
| `dirRoot` | string | ✓ | Absolute base path that `files[].path` / frame file paths are stored relative to |
| `transport` | object | optional | Transport/cookie metadata. The extension panel does not consume this at all — Nova in-page fallback (`window.__debugData`) only. If present, both fields below are required |
| `transport.logApiUrl` | string | optional | Log-lookup API URL. **Included only in in-page (`window.__debugData`) output** — omitted from the ext-saved JSON (see below) |
| `transport.cookieName` | string | optional (required if `transport` present) | Debug panel display-state cookie name |
| `transport.cookieOn` | boolean | optional (required if `transport` present) | Cookie value at request time |

### Why `meta.request` / `meta.transport` were demoted to optional

Both sections had their **key itself** demoted to optional (previously they were in `meta`'s
required list).

- **`meta.transport`**: The browser extension (panel) never consumed this field to begin with —
  it's used only by Nova's in-page fallback (`window.__debugData`) to show the log-lookup URL
  and cookie state. There's no reason to force this field on producers that are consumed only
  by the extension (non-Nova, non-HTTP, etc.), so it was demoted to optional. The Nova reference
  implementation still produces it (since it's an HTTP + in-page-fallback environment).
- **`meta.request`**: Demoted to optional in anticipation of future non-HTTP execution capture
  (CLI/cron, TODO.md P5) — a non-HTTP execution has no `uri`, and may need a separate structure
  like `meta.cli{}`. The Nova reference implementation (HTTP requests) still produces it.

### Why `transport.logApiUrl` differs by output path

- **In-page fallback (`window.__debugData`)**: The in-page log viewer (`debug.js`) uses this URL
  to look up the log list, so it's included as-is.
- **Browser extension (ext) saved JSON**: There's no need to expose the server lookup path
  (`log.apiUrl`) — the extension constructs its own fetch URL from its own settings (default
  path + per-origin overrides). Same rationale as removing the `X-Nova-Debug-Fetch` response
  header (2026-07-12), and the same pattern as `meta.ide` handling (stripped in `extOutput()`).

### Why `meta.ide` field composition differs by output path

- **Browser extension (ext) saved JSON**: Only `serverPath` is sent (when configured); the rest
  is omitted. `localPath`/`project`/`protocol` vary by the developer's local environment, so
  they're filled in by extension settings (per-domain mapping). This keeps the saved JSON from
  being tied to a specific developer's machine.
- **In-page fallback (`window.__debugData`)**: Since the server renders on the same machine, the
  full `protocol/serverPath/localPath/project` set is sent (same behavior as v0).

---

## 3. `summary` — aggregate statistics

| Field | Type | Required | Description |
|---|---|---|---|
| `time.total` | number | ✓ | Total request duration (seconds). Denominator for percentage calculations of `entries[].time/duration` and `timeline[].start/duration` |
| `time.debug` | number | ✓ | Debug library's own processing time (seconds) |
| `memory.usage` / `memory.peak` | integer | ✓ | Bytes |
| `queries` | object | optional | Full query aggregate. Runtimes that never execute queries (non-DB environments) omit this key entirely |
| `queries.count` | integer | optional (required if `queries` present) | Total number of queries |
| `queries.time` | number | optional (required if `queries` present) | Total query duration (seconds) |
| `queries.slow.count` / `.time` | integer/number | optional (required if `queries` present) | Queries exceeding `thresholds.slowQueryTime` |
| `queries.dup.total` | integer | optional (required if `queries` present) | Number of queries flagged DUP |
| `queries.dup.patterns` | integer | optional (required if `queries` present) | Number of DUP fingerprint groups |
| `queries.dup.percent` | number | optional (required if `queries` present) | `dup.total / queries.count * 100` (rounded) |
| `queries.loop.total` | integer | optional (required if `queries` present) | Number of queries flagged LOOP |
| `queries.loop.sites` | integer | optional (required if `queries` present) | Number of LOOP call sites (same fingerprint + same trace) |
| `queries.loop.byType` | array | optional (required if `queries` present) | `{table, count}` — table/count per call site |
| `queries.avg` / `.max` | number | optional (required if `queries` present) | **Seconds** (unit-consistent with the rest of the payload's time fields). If a ms display is needed, the consumer computes `*1000` — the existing UI display convention is preserved on the consumer side |
| `queries.maxIndex` | integer | optional (required if `queries` present) | `entries[].index` of the slowest query |
| `files` | object | optional | File aggregate. Runtimes that can't count loaded files omit this key entirely |
| `files.count` | integer | optional (required if `files` present) | Count of "loaded files" (reference implementation: `get_included_files()`, see §10). May differ from the length of `files[]` (§6) |
| `logs.count` | integer | optional | Total number of `type:"log"` entries. If no logs are produced, the `logs` key itself is omitted |
| `logs.byLevel` | object | optional | PSR-3 level name => count for that level |

### Why `summary.queries` / `summary.files` were demoted to optional

Both used to be required in `summary`. For runtimes that don't execute queries (cache-only
requests, non-DB services, etc.) or that have no concept of "loaded files," forcing these values
to 0 was a fabrication — it wrongly represented "this concept doesn't exist" as "zero data." They
were demoted to optional so absence can be represented as-is. The Nova reference implementation
always computes and produces both values, so there's no impact on real usage. Consumers should
treat the absence of either key the same as "zero" (e.g. count badges show 0/empty), but
statistics UI (like the Queries tab) is more accurate if it hides the corresponding section when
absent.

---

## 4. `thresholds`

| Field | Description |
|---|---|
| `slowQueryTime` | Queries exceeding this value (seconds) are marked SLOW |
| `tooManyCount` | Threshold for array/object element counts. For multi-dimensional arrays (`array.depth==2`), the consumer may relax the multiplier (the Nova reference `debug.js` uses `tooManyCount` as-is when `depth>=2`, and `tooManyCount*2` otherwise) |

---

## 5. `entries[]` — debug output items

```
{
  "index": 12,
  "type": "query",              // open-ended string (pattern ^[a-z][a-z0-9-]*$). Known values: dump/query/array. See "Type registration procedure" for new types
  "time": 0.02883,               // offset from request start (seconds)
  "duration": 0.00025,            // duration (seconds). Mostly 0 for dump
  "label": "QUERY [S]",
  "dump": "SELECT ...",
  "truncated": false,              // optional — whether the producer truncated dump. Absent = "unknown/not truncated"
  "trace": [70, 71, 72, ...],     // frames[] index list, stack top first
  "array":  { "depth": 1, "count": 8 },        // only when type=array
  "object": { "className": "...", "count": 5 }, // only when type=dump && the value is an object (count only if num_rows is available)
  "query":  {                                    // only when type=query
    "table": "menu",                              // optional — omitted for non-table stores (cache, etc.)
    "connection": "default",                      // optional — multi-DB connection label
    "bindings": [1, "active"],                    // optional — prepared statement parameters (in order), scalar|null
    "warn": true,                                 // optional — absent = "not analyzed", false = "analyzed and OK"
    "explain": {                                  // present only if available — the canonical field (§7)
      "format": "table",
      "columns": ["id", "select_type", "table", "..."],
      "rows": [[1, "SIMPLE", "menu", "..."]]
    },
    "explainHtml": "<table>...</table>",         // present only if available — deprecated (§7)
    "dup":  { "count": 7, "group": "D1" },       // only if DUP
    "loop": { "count": 4, "group": "L1", "sig": "file:line|file:line|..." } // only if LOOP
  }
}
```

### Known types

| type | subobject | combination rule | description |
|---|---|---|---|
| `dump` | `object?` | present only when the value is a general object, not an exception/error object (reference implementation: excludes PHP `Throwable`, §10) | dump of an arbitrary value |
| `array` | `array` | always present | array dump — depth/count |
| `query` | `query` | always present | SQL query execution — table?/warn?/explain/explainHtml(deprecated)/dup/loop |
| `log` | `log` | always present | log message — level(PSR-3)/context |
| `exception` | `exception` | always present | exception/error — class/message/code/file/line/trace/previous |

Any `type` value other than the 5 above is treated as an "unknown type" and follows the
consumption rule below. For adding a new type, see "Type registration procedure."

### `query.table` / `query.warn` — why demoted to optional

Two fields that used to be required in the `query` subobject were demoted to optional.

- **`table`**: Storage that isn't a SQL backend (e.g. representing a cache lookup as
  `type:"query"`, a non-RDB store) has no concept of a table. If absent, the field itself is
  omitted — consumers apply a fallback like `table ?? '(unknown)'` when displaying.
- **`warn`**: Demoted to optional for producers that don't perform EXPLAIN analysis (lightweight
  drivers, configurations that skip analysis cost, etc.). It has a **three-state meaning** —
  **absence means "not analyzed"**, **`false` means "analyzed and OK"**, **`true` means "analyzed
  and needs attention"**. Absence and `false` must not be treated the same (the former is
  "unknown," the latter is "checked and confirmed fine").

### `query.bindings` / `query.connection` — prepared statement parameters · multiple connections (2026-07-20)

```
query: {
  bindings?: (string|number|boolean|null)[],  // prepared statement parameters, in order
  connection?: string                          // multi-DB connection label
}
```

- **`bindings`**: Provides the parameter values bound to a prepared statement, separately from
  the SQL text. `entries[].dump` (the SQL text) **always stays as-is**, regardless of whether
  values were actually interpolated — `bindings` is additional information the producer provides
  only when it has separately captured the parameters. Value types allow scalar
  (string/number/boolean) or null, the same as cells in `query.explain.rows` (same rationale as
  §7 — drivers cast parameter types differently). If absent, the field itself is omitted (queries
  that don't use parameter binding, or producers that don't capture the values).
- **`connection`**: A display label distinguishing multiple DB connections (e.g. read/write
  split, multiple data sources), e.g. `"default"`, `"mysql_read"`. Producers using only a single
  connection omit it.

### Error determination — structural criteria recommended

Before `type:"exception"` was registered, there was no structural field to determine whether
something was an error, so the consumer implementation (`panel/renderer/row-renderer.js`) applied
a `/ERROR|Exception/i` regex to `label` to highlight it (the `d-error` class). Now that
`type:"exception"` and `log.level` (`error`/`critical`/`alert`/`emergency`) provide a structural
signal, **consumers are recommended to determine error status via `type === 'exception'` or
whether `log.level` is error-or-above** — this avoids false positives that string matching can
produce (e.g. a normal log message that happens to contain the word "Exception"). The existing
`label` regex determination is kept **only as a legacy-compatibility convention** for older
producers' payloads that lack this field (from when exceptions were represented only via
`type:"dump"`) — the structural field takes priority when available.

### v0 → v1 field changes

| v0 | v1 | Notes |
|---|---|---|
| `term` | `duration` | Renamed only |
| `time` (absolute microtime) | `time` (offset relative to request start, seconds) | Removed exposure of absolute timestamps; the calculation is otherwise the same |
| `type: ''` / `'array : 8'` / `'ClassName'` / `'ClassName : 5'` (string encoding) | `type` enum + `array{depth,count}` / `object{className,count}` | **Decomposes v0's core problem — "kind+count string encoding" — into structured fields**. The display string (`'array : 8'` etc.) is reassembled on the consumer side (`normalizeDebugPayload`) — the rendered result is identical to v0 |
| `dupCount/dupGroup/loopCount/loopGroup/loopSig` (flat fields on every entry, 0/'' when not a query) | `query.dup` / `query.loop` (only on queries, only when present) | DUP/LOOP are only meaningful for queries, hence nesting |
| `queryHtml` (always present, forcibly filled with `' '` when there's no EXPLAIN) | `query.explainHtml` (present only when available) | The forced-fill logic moved to consumer-side reconstruction logic (§7) |
| `tl_left` / `tl_width` (%, server-computed) | None — the consumer computes them from `time/duration` and `summary.time.total` | Presentational values removed |
| trace array: fully duplicates a `{idx,file,rawFile,line,func,args,argsFull}` object per item | `frames[]` integer index array | See §6 dedup |

### Unknown-type consumption rule

`type` is not an enum but an open-ended string (pattern `^[a-z][a-z0-9-]*$`). Consumers
(extensions/implementations) must safely render `type` values they don't recognize: render
generically using only `label` + `dump`(string) + `trace`, and ignore any unknown subobject
sharing the type's name (e.g. `cache{}`, `http{}`) — subobjects are always supplementary
information; the meaning of an item (what, when, where) is already complete with just those 3
fields.

### Type registration procedure

When adding a new type:

1. Add a row to the type table at the top of §5 (which lists dump/query/array/log/exception) in
   this document
2. Define the subobject spec — the key is written without an `x-` prefix, matching the type name
   (e.g. `type:"http"` → `http?{}`, `type:"event"` → `event?{}`). This is the same convention as
   the known types (`array`/`object`/`query`/`log`/`exception`)
3. Add an `if/then` condition to `$defs.entry` in `schema/debug-payload.v2.schema.json` to specify
   the combination rule for the new type and its subobject (see the `allOf` under §entries)
4. When registering the new type, also add the new type's subobject key to the exclusion lists
   (`properties: {…: false}`) of the existing known-type branches

New subobject keys are already accommodated by `entry.additionalProperties` (allowing only object
values), so schema validation passes even before registration — registration is the procedure
for "codifying the combination rule in the docs and schema."

**Findings from the first real-world application of this procedure (S3, registering
`log`/`exception`)**: The 3 steps above worked exactly as described, with no gaps found. However,
step 2's wording "same convention as the known 3 types" drifts from the actual count as more
types are added, so the count in that wording must be updated on each registration (this update
generalized "3 types" → "known types" to remove that future maintenance burden).

### `entries[].truncated` — dump truncation indicator (2026-07-20)

```
truncated?: boolean   // whether the producer truncated the dump
```

An optional field indicating whether `entries[].dump` was truncated due to a producer-side size
limit (reference implementation: `ext.dumpMaxLength`, see §10). **Absence means "unknown/not
truncated"** and is treated the same as `false` — unlike `query.warn` (§5), this field only needs
2 states ([not provided]/[true]) — there's little value in a producer explicitly asserting
`false` for "did not truncate." Including the field only when `true` is recommended, but
explicitly including `false` is also valid per the schema. Consumers should only show a
truncation indicator (badge, etc.) when the value is `true`.

### `additionalProperties` design (entry)

`entry` declares its known fields (`index`/`type`/`time`/`duration`/`label`/`dump`/`truncated`/
`trace`/`array`/`object`/`query`/`log`/`exception`) in `properties`, and additionally allows only
unknown-type subobjects (object-valued keys) via `additionalProperties: {"type": "object"}`. The
`patternProperties` approach (allowing by key-name pattern) considered initially failed in actual
validation — existing scalar field names like `index`/`type`/`time`/`duration`/`label`/`dump`/
`trace` also matched the lowercase pattern, which incorrectly imposed the "value must be an
object" constraint on them too (per the JSON Schema spec, all matching rules under `properties`
and `patternProperties` are ANDed together). `additionalProperties` doesn't apply to keys already
declared in `properties`, so this conflict doesn't occur.

### `log` subobject — log message (`type:"log"`)

```
log: { level: "debug"|"info"|"notice"|"warning"|"error"|"critical"|"alert"|"emergency",
       context?: object }
```

Adopted the 8 PSR-3 levels as-is. When `type:"log"`, the `log` subobject is **required** (same
"always present" combination rule as the other 3 known types — see the §5 type table). The log
message body doesn't get a new `message` field; it reuses the existing `entries[].dump` (string)
as-is — this keeps consistency with the consumption rule S1 established, that "even an unknown
type can be rendered with just `label`+`dump`+`trace`" (a log must also be minimally renderable
with just these 3 fields, no exceptions). `label` is free for the producer to choose (e.g. logger
channel name). `context` corresponds to the PSR-3 `context` array and doesn't restrict value
types.

### `exception` subobject — exception/error (`type:"exception"`)

```
exception: { class: string, message: string, code?: integer|string,
             file: integer|null, line: integer|null,
             trace: [framesIdx...], previous?: exception }
```

When `type:"exception"`, the `exception` subobject is required. Defined as `$defs/exception` so
that `previous` recursively references the same definition (exception chaining — no limit on
chain length).

- **`file` is a `files[]` index (integer) or `null`** — directly holding a string absolute/relative
  path was also considered but rejected. Rationale: `frames[]` already uses the same `files[]`
  index-reference convention (§6), so file-path resolution logic (relative-path restoration, IDE
  deep links, etc.) can stay centralized in one place, and the same file appearing repeatedly
  across multiple exceptions only needs an index comparison rather than a `files[]` re-lookup.
  Exceptions with no file information (native errors, etc.) are represented as `null`.
- **`line` is also `integer|null`** — same convention as `file` (§6's `frames[].line` is also the
  same). If `file` is `null` (no information), `line` is also `null` — absence of information is
  not represented with the magic value `0`.
- **`trace` is a `frames[]` index array**, reusing the same convention as `entries[].trace`.
  However, **the meaning is distinct** — `entry.trace` is the call stack at the point this entry
  was *captured* by the debug library (e.g. where `set_exception_handler` runs), while
  `exception.trace` is the stack from the point the exception object itself was thrown (PHP's
  `Throwable::getTrace()`). If capture happens immediately after the exception is thrown, the two
  values may in practice be identical, and a producer may put the same array in both without
  issue, but the schema doesn't enforce this — consumers should read `entry.trace` for "when was
  this log entry recorded" and `exception.trace` (and `previous.trace`) for "where was the
  exception actually thrown."
- **`code` allows both `integer|string`** — PHP exception codes are conventionally int
  (`Exception::getCode()`'s default return type), but there are real cases like `PDOException`
  that return SQLSTATE strings (e.g. `"HY000"`) as the code. Other-language producers also split
  between integer/string error-code representations, so this is more universally applicable.
- **`previous`**: chaining to the previous (causal) exception. Omitted entirely if there is none
  (recursion base case).

---

## 6. `files[]` / `frames[]` — file/frame tables

**`files[]`**: `{path, original?}`. `path` is a path relative to `meta.dirRoot` (with a leading
slash). If an absolute path is needed, restore it as `dirRoot + path` (for IDE deep links, etc.).
`original` is included only when there's an original-path mapping for a template cache file.

### `dirRoot`-external file path fallback convention

`files[].path` is, in principle, relative to `dirRoot`, but files **outside `dirRoot`** — system
libraries, globally installed packages, etc. — have no way to be expressed as a relative path.
Such paths **carry the absolute path as-is in `path`** (the format of the value itself is just a
string per the schema and isn't validated — this convention is a documentation rule). Consumers
can recognize a path as "an absolute path outside `dirRoot`" if `path` starts with `/` and doesn't
start with `dirRoot` (or if `dirRoot` itself is simply absent) — in that case, they should skip
the `dirRoot + path` restoration operation and treat the value as an already-complete absolute
path. It's safe to skip IDE deep-link wiring for such paths (a link is usually meaningless for
files outside the local project).

**The path separator is always fixed to `/`**. Producers on Windows must convert `\` to `/`
before storing — it's better for the producer to normalize once than to have every consumer
(browser extension, etc.) handle platform-specific separators.

**`frames[]`**: A dedup table containing only unique `(file, line, func, args, argsFull)` tuples
across the whole request. `file` is a `files[]` index (`null` if there's no file — native
functions, etc.). **`line` is also `null` if `file` is `null`** (same convention as §5's
`exception.file`) — absence of information is not expressed via the magic value `0`. Consumers
should not display `line` either when `file` is absent (don't print a meaningless `:0` line
number).

**`entries[].trace`**: An integer array of `frames[]` indices (stack top first, same order as v0).

### `func`/`args`/`argsFull` — opaque display strings formatted by the producer

The frame's structure (i.e. the fact that `file`/`line`/`func`/`args`/`argsFull` fields exist) is
itself language-neutral, but the **values** of `func`/`args`/`argsFull` are opaque strings
formatted by the producer for display — the format (e.g. `Class::method` notation, how summary vs.
expanded argument strings are distinguished) is up to the producer and not enforced by the
schema. Consumers should display this string as-is rather than trying to parse it back into
structure. See §10 for the Nova reference implementation's specific formatting convention.

### Why dedup happens at the whole-frame level

The same call site (`file:line`, function, arguments) recurs across many dump/query calls within
one request. Measured on a sample (91 entries): out of 1050 trace occurrences, 484 unique frames
(~54% dedup). Agreed with the user to dedup at the whole-frame level (same file+line+function+
arguments required to be considered the same frame) — deduping by `file:line` alone would merge
frames with different arguments and lose `args`/`argsFull` information.

### Call-number (`idx`) display — an intentional difference from v0

v0 stored the original stack depth (`idx`, reverse-computed including filtered frames) on each
trace item. If frames were skipped by filtering (`trace.ignoreClasses`/`ignoreFunctions`), gaps
in numbering could appear among the retained frames (since a skip still consumes a counter
position). v1 doesn't transmit this number at all; instead the consumer assigns consecutive
numbers starting from 1 via `trace.length - position`. On screen this still shows as "N." with no
functional difference, and in the common case where filtering only happens at the top of the
stack (the debug library's own call frames), the numbering is identical to v0. Only in the rare
case where a filtered frame is in the middle of the stack does the numbering diverge slightly from
v0 (the content is the same — only the sequence number differs).

### Why the length of `files[]` can exceed `summary.files.count`

Explanation based on the reference implementation (PHP): `files[]` is, by default, exactly the
order of `get_included_files()`, matching the length of `summary.files.count`. However, if a trace
references a file path not present in the `get_included_files()` list (evaluated code, etc. — a
rare case), it's additionally appended to the tail of `files[]`. **UI count displays such as the
"Files" tab should use `summary.files.count`** — not the full length of `files[]`. (Rationale:
measurement/code review found this path is essentially never taken in practice, but it's left
open defensively so frame file resolution never fails.)

---

## 7. `query.explain` / `explainHtml` — EXPLAIN result representation

DESIGN.md §9's direction was "remove presentational values from the server and compute them on
the client," and this was mostly applied (`tl_left/tl_width`, timeline `left/width`,
`files[].link/originalLink`). `query.explainHtml` alone was originally kept as an exception — the
logic that renders EXPLAIN results as color-highlighted HTML tables
(`AbstractQueryDriver::getInfoHtml()`) is code that understands DB-driver-specific EXPLAIN column
semantics (type/key/Extra, etc.), and was data processing requiring driver knowledge rather than
pure presentation (coordinate/link computation). Later, as the need for a truly
framework-neutral consumer arose, this decision was revisited and `query.explain` (a raw
structure) was introduced as the canonical field — `explainHtml` is transitioned to
**deprecated**.

### `query.explain` — the canonical field (DB-engine-neutral raw structure)

```
explain?: {
  format: "table" | "text" | "json",
  columns?: string[],   // format=table
  rows?: (string|number|boolean|null)[][],  // format=table
  text?: string,         // format=text
  json?: any             // format=json
}
```

- **`format:"table"`**: `columns`+`rows` required (`text`/`json` forbidden). Column-row-shaped
  EXPLAIN, as in MySQL/SQLite etc. Cell types in `rows` are not forced to string; scalar
  (string/number/boolean) or null is allowed — **rationale** (observed from the reference
  implementation's PHP DB drivers mysqli/PDO/SQLite3, see §10): drivers vary in whether they cast
  EXPLAIN's numeric columns (`rows`/`filtered`, etc.) and nullable columns (`ref`/`key`, etc.) to
  strings, or return them in their original type. If the schema forced strings, producers would
  have to cast every time and would lose original information such as the distinction between
  `NULL` (no value) and `"NULL"` (a string). Allowing scalar/null remains valid even if a
  different language's driver always returns values as plain strings — the producer just passes
  the driver's return value straight through, and string conversion for display becomes the
  consumer-side renderer's responsibility.
- **`format:"text"`**: `text` required (`columns`/`rows`/`json` forbidden). Output that only comes
  as line-based text, like PostgreSQL's default `EXPLAIN`.
- **`format:"json"`**: `json` required (`columns`/`rows`/`text` forbidden). PostgreSQL
  `EXPLAIN (FORMAT JSON)`, MSSQL execution plans (converted to JSON), etc. — since the structure
  differs per engine, the schema doesn't constrain its shape.

Any DB engine's execution plan is accommodated by one of these 3 formats (see COMPARISON.md
§3-4).

Each `if` under `allOf` specifies `"required": ["format"]` (the same technique as `entries[]`'s
per-type `if/then` using `"required": ["type"]`). Without this, an `explain` object lacking a
`format` field entirely would silently fail to match any branch's `const` comparison, making the
validation error message vague — with it, "format is missing" shows up directly as the cause in
the validation error. This change doesn't alter behavior (which inputs are valid/invalid) — it
only improves error-message quality.

### `explainHtml` — deprecated, kept during a transition period

`query.explainHtml` is **deprecated**. `query.explain` is the canonical field; `explainHtml` is
kept in parallel only for legacy-consumer compatibility during the transition.

- **Production rule**: Producers should produce `explain` (the raw structure) whenever possible.
  `explainHtml` may optionally be produced in parallel for legacy consumers (either may be
  absent, only one may be present, or both may be present — both are included only when EXPLAIN
  was actually produced; the field itself is omitted if there's no value).
- **Consumption rule**: When both `explain` and `explainHtml` coexist, **`explain` takes
  priority**. `explainHtml` is referenced as a fallback only when rendering an older producer's
  payload that lacks `explain`.
- **Removal plan**: TODO.md's mention of "demote `explainHtml` to `x-nova`" is interpreted as work
  for after this transition period ends (once both extension consumption (E) and server
  production (P) have completed the switch to `explain`) — it is not moved out of `query` or into
  `x-nova` right now. This round (Track S) concludes by leaving it inside the `query` object as-is
  and marking it deprecated in the schema description. Actual removal (or moving to `x-nova`)
  happens in a separate round after the E/P work lands.

`query.explainHtml` is included only when EXPLAIN was actually produced (the field itself is
omitted when there's no value). v0 forcibly filled `queryHtml` with `' '` (a single space) even
when there was no EXPLAIN, doubling as a signal that "this item is a query" — v1 no longer needs
this forced fill, since `type==='query'` clearly replaces that signal. However, to make it behave
identically to `debug.js`'s existing render branch (`if (item.queryHtml)`), **the consumer side
(`normalizeDebugPayload`) reconstructs `explainHtml || ' '` when `type==='query'`** — this is
purely a client-side compatibility measure to reuse legacy render code; there is no space-filling
in the wire format itself.

---

## 8. `timeline[]`

```
{ "name": "START", "start": 0, "duration": 0.09487 }
```

`start`/`duration` are in seconds, relative to request start. The percentage (`left`/`width`) is
computed by the consumer by dividing by `summary.time.total` (v0 had the server pre-compute the
percentage and send it as `left`/`width`).

---

## 9. `x-nova` / `x-php` — vendor extensions

```
{
  "x-nova": { "fileHighlight": { "/Controllers/": "blue", "/Models/": "green", ... } },
  "x-php":  { "opcache": true }
}
```

- **`x-nova`**: Holds only values specific to the Nova framework. General consumers can safely
  ignore this key. If there's no `fileHighlight` configuration, the `x-nova` key itself is
  omitted.
- **`x-php`**: Holds only values specific to the PHP reference implementation (`opcache` active
  status). General consumers can safely ignore this key. Non-PHP producers omit this key entirely
  (since `meta.runtime` already handles runtime identification, `x-php` is limited to PHP-specific
  auxiliary values).

Both objects have `additionalProperties: true` (each declares its known fields in `properties`).
This vendor-extension area was made permissive so the schema doesn't need to be updated every
time a new value is added — known values (`fileHighlight`, `opcache`) are still type-validated,
while any other auxiliary values are freely allowed. This is the same direction of decision as the
root's `x-*` pattern allowance (§1).

---

## 10. Nova reference implementation notes

This document/schema is a language/framework-neutral contract, but some details of the current
sole producer, Nova/debug (PHP, `DebugAnalyzer.php::analyze()`), are needed to explain the origin
of certain values. Below gathers such "reference-implementation-specific" facts in one place; the
contract itself doesn't presuppose PHP — other-language implementations may fill values
differently from below and remain schema-valid.

| Field/Area | Reference implementation (PHP) detail |
|---|---|
| `meta.runtime` | `{name:"php", version: PHP_VERSION}` |
| `x-php.opcache` | Whether the opcache extension is active |
| `summary.files.count` / `files[]` | Collected from the file list loaded via `get_included_files()` (§6) |
| `entries[].dump` | Stringified via `print_r()` (truncated by the ext channel per `ext.dumpMaxLength`) |
| `entries[].object` | Filled only when the value is not a `Throwable` exception/error object (exception representation is `type:"exception"`, Track S3) |
| `entries[].object.count` | Filled only when a `num_rows()`-like method exists on a DB result set |
| `query.explain.rows` cell type (scalar/null allowed) | Due to differences in EXPLAIN casting across PHP DB drivers like mysqli/PDO/SQLite3 (§7) |
| Specific format of `frames[].func`/`args`/`argsFull` values | The `Class::method` notation + a two-tier summary/expanded argument-string convention (§6) — the structure is language-neutral, but this format itself is a convention, not part of the contract |

---

## 11. Consumer implementation notes (`debug.js`)

`assets/debug.js`'s `normalizeDebugPayload(payload)` takes a v2 payload and converts it into the
v0-style flat view model that the existing render code (`createHelpers`, `renderRow`,
`setupTimeline`, `setupFileList`, etc.) expects. Render code outside this function is unaffected
by schema changes — all presentational computation (IDE links, percentage positions, type display
strings) is concentrated in this one place. Both the `window.__debugRender` (in-page) and
`window.__debugLogRender` (text-log mode) entry points pass the original v2 payload through
`normalizeDebugPayload()` first before use.

The v2 transition of the browser extension panel (`_browser/debug/panel/renderer/*`) is a
separate work scope (this document/schema serves as its baseline).

---

## 12. `request` — request context

```
request?: {
  method: string, status: integer, contentType: string,
  route?: string, handler?: string,
  get?{}, post?{}, cookies?{}, session?{},
  requestHeaders?{}, responseHeaders?{}
}
```

A top-level optional section. Holds GET/POST parameters, cookies, session, request/response
headers, and the response status/Content-Type. `method`/`status`/`contentType` are always
required whenever `request` is present — the remaining submaps are included only when they were
collected.

### Role separation from `meta.request`

`meta.request{uri, date}` (§2) is **always present** request-identifying metadata (request URI,
server time). This section's `request` is **optionally collected** detailed context, and doesn't
duplicate `uri`/`date` — use `meta.request` to identify the request, and `request` to look at
parameter/header/cookie/session details.

| Field | Type | Required (if `request` present) | Description |
|---|---|---|---|
| `method` | string | ✓ | HTTP method, e.g. `GET`/`POST` |
| `status` | integer | ✓ | Response status code |
| `contentType` | string | ✓ | Response Content-Type |
| `route` | string | optional | Route pattern display string (e.g. `/users/{id}`). An opaque display string formatted by the producer, same as `frames[].func` (§6) |
| `handler` | string | optional | Handler (controller) display string (e.g. `UserController::show`). Same representational convention as `route` |
| `get` | object | optional | GET query parameters |
| `post` | object | optional | Parsed POST parameters (no raw body) |
| `cookies` | object | optional | Request cookies |
| `session` | object | optional | Session data |
| `requestHeaders` | object | optional | Request headers |
| `responseHeaders` | object | optional | Response headers |

### `get`/`post`/`cookies`/`session`/`requestHeaders`/`responseHeaders` value type — rationale

The values of these six maps are all fixed to **string**
(`additionalProperties: {"type": "string"}`). The alternative considered was to allow nested
arrays/objects as-is (PHP can nest a query string like `a[b]=1` arbitrarily deep into
`$_GET['a']['b']`). Rationale for choosing to fix on string:

- **Consistency with existing conventions**: This schema already uses the "opaque display string
  formatted by the producer" pattern for `entries[].dump` (§5) and
  `frames[].func/args/argsFull` (§6). If `request`'s values follow the same pattern, consumers
  don't need to add a new type branch (string/array/object recursive handling).
- **Avoiding a recursive schema**: Allowing arbitrary-depth nesting would require defining a
  recursive type in `$defs`, and would burden producers in other languages (whose nested-parameter
  syntax differs from PHP's) with converting their structure to fit the schema. Fixing on string
  means any language's parameter structure works as long as the producer passes through the
  display-oriented serialization it already has (flattening keys into `a[b]` form, or
  JSON-stringifying values, etc.) — this actually increases framework neutrality.
- **Consistency with masking/truncation**: The masking/size-limit rules below are defined per "one
  key = one value (string)." If a value were a nested structure, masking would need to traverse
  the tree and check sub-keys too, and the truncation criterion (character length) would need to
  be applied differently per node, complicating the rules. With a flattened string map, both rules
  are simply "apply as-is to each value string."
- **Generality of session values**: Sessions can hold arbitrary serializable values (objects, etc.)
  that an application stores, so "always scalar" can't be guaranteed at the source — since
  stringification is needed anyway, it's more consistent to unify GET/POST/cookies under the same
  rule too.

The producer (PHP reference implementation) flattens nested parameters into `a[b]`-style key
paths, following the same convention as `http_build_query()`, and stringifies values the same way
as `entries[].dump`.

### Repeated parameter key convention

GET/POST parameters where the same key appears multiple times, like `?tag=a&tag=b`, may have
multiple values (unless the language, like PHP, overwrites the earlier value with the later one).
Since this schema's `get`/`post` maps are "one key = one value (string)" structures, a producer
must combine the values into a single string to represent a repeated key —
**the same combination convention recommended for multiple headers in `requestHeaders`/
`responseHeaders` (joined with `", "`, §12 table) is recommended here too**: `tag: "a, b"`. This is
a documented **recommended convention** and is not enforced by the schema — schema validation
still passes if a producer uses a different joiner, or JSON-stringifies an array into the value
(e.g. `tag: "[\"a\",\"b\"]"`). However, following the recommended convention above is preferable
for consistent display across consumers, absent a specific reason not to.

### Masking rule (producer obligation)

The `request` section ends up in the saved `ext.*.json` file as-is, so sensitive information can
be left in plaintext on the filesystem. **The producer must perform masking before saving** — this
rule is a documentation rule and cannot be enforced by JSON Schema (the schema only validates that
the value is a string; it doesn't validate the content).

Masking targets: if a key (case-insensitive, **substring match**) contains any of the patterns
below, its value is replaced with `"***"`.

```
password, passwd, pwd, secret, token, auth, authorization,
api-key, api_key, apikey, session-id, session_id, sessid,
cookie, csrf, private, credential
```

- The `cookie` pattern applies to the entire request `Cookie` header value and the entire
  response `Set-Cookie` header value (masking the whole header value, not individual cookie
  values — individual items in `request.cookies` are masked only when their key matches the
  pattern list above).
- Since matching is substring-based, keys like `csrf_token`, `x-api-key`, and `PHPSESSID`
  (contains `sessid`) also match.
- The validation script (`test/validate-payload.py`) does not enforce this rule — it's a separate,
  warning-style check apart from schema validation, and even if introduced it should only be added
  as a warning that doesn't affect the exit code (the current version has not added a masking
  warning check — see the "open items" note).

### Size-limit rule

Per-value truncation follows `ext.dumpMaxLength` (same truncation criterion as the reference
implementation's `entries[].dump` — see §10). POST includes **only parsed parameters** — the raw
request body is not part of the schema — because file uploads etc. can make body size large, and
because unparsed raw text can't have the masking rule applied per individual field, creating a
high risk of exposing sensitive information.

---

## 13. Version policy

The schema version (`schemaVersion`, integer `N`) and the extension (browser extension) version
(`N.x.x`) are mapped 1:1 — an extension consuming schema `vN` always uses major version `N`
(v1 ↔ 1.x.x, v2 ↔ 2.x.x).

| Nature of change | Example | Schema version | Extension version |
|---|---|---|---|
| Adding an optional field | Registering a new type (§5 procedure), introducing a new optional section | Unchanged (`schemaVersion` stays) | minor/patch |
| Demoting required → optional | Relaxing `meta.transport`/`meta.request`, `summary.queries`/`.files`, `query.table`/`.warn`, etc. from required to optional | Unchanged (`schemaVersion` stays) | minor — no impact on existing consumers unless they had code that assumed the field's existence and read it unconditionally (non-breaking). If a consumer had code that always assumed presence and accessed it directly, that consumer-side code needs fixing, but the schema itself remains backward-compatible |
| Changing or removing an existing field's meaning | Field deletion, type change, promotion to required | Major bump (`schemaVersion` +1) | major |

The `schemaVersion` field itself is always integer `N` (e.g. `"schemaVersion": 2` — no decimal
notation). The extension's `x.x` (minor/patch) in `N.x.x` can increment independently of the
schema version, purely from changes to the extension itself (bug fixes, UI improvements, etc.).

---

## Changelog

- **2026-07-20 (S7, remaining-improvements round)**: First round after v2 was frozen (§13) —
  entirely optional field additions/documentation, so `schemaVersion` is unchanged.
  1. `query.bindings?: (string|number|boolean|null)[]` — provides prepared-statement parameters
     separately from the SQL text (dump) (§5). A prerequisite for P6 (debugbar bridge)'s
     PDOCollector mapping.
  2. `query.connection?: string` — multi-DB connection label (§5)
  3. `request.route?`/`request.handler?: string` — route-pattern/handler display strings (§12,
     the same opaque-string convention as `frames[].func`). Consumption (the Request tab)
     proceeds separately in E1 — this round only adds the schema.
  4. `entries[].truncated?: boolean` — whether the producer truncated the dump (§5)
  5. Gave `meta.id` a `pattern: "^[A-Za-z0-9_-]+$"` (§2) — a defense since the id is used as a
     filename/lookup key. Confirmed compatibility with the existing Nova id format
     (`\d{6}_\d{6}_[0-9a-f]{16}`) and with all existing fixtures.
  6. Replaced `$id` with an actually resolvable GitHub raw URL —
     `https://raw.githubusercontent.com/daddyofsky/nova-debug-devtools/main/schema/debug-payload.v2.schema.json`
  7. Documented the repeated-parameter-key convention (§12) — recommends the `", "` joining
     convention used for headers for `?tag=a&tag=b`-style keys too
  8. Documented the `dirRoot`-external file path fallback convention (§6) — carry the absolute
     path as-is, allow consumers to skip the IDE link, path separator fixed to `/`
  9. Reflected in extension consumption: `panel/renderer/query-renderer.js` (bindings/connection
     display), `panel/renderer/row-renderer.js` (truncated badge)
  10. New English translation `SCHEMA.en.md` — a required item before E5 (store release,
      TODO.md S7)

- **2026-07-20 (last breaking round before freezing v2)**: Cleaned up universality gaps
  identified in a schema review, before v2 is frozen. All 10 items keep `schemaVersion` unchanged
  (stay on v2) — demoting required→optional is non-breaking for existing consumers (§13's new
  case). Summary:
  1. Added root `patternProperties: {"^x-": {"type":"object"}}` — allows arbitrary vendor
     extension keys (§1)
  2. Relaxed `x-nova`/`x-php`'s `additionalProperties` from `false` to `true` (§9)
  3. Demoted all of `meta.transport` to optional (§2) — not consumed by the extension panel, Nova
     in-page-fallback-only
  4. Demoted all of `meta.request` to optional (§2) — anticipating future non-HTTP capture such
     as CLI/cron
  5. Changed `meta.request.date` from `'Y-m-d H:i:s'` to ISO 8601 including a timezone offset (§2)
  6. Demoted `summary.queries`/`summary.files` to optional (§3) — prevents 0-fabrication in
     runtimes with no query/file concept
  7. Changed `summary.queries.avg`/`.max` from ms to seconds (§3) — unifies the payload's overall
     time unit. ms display is computed on the consumer side (`normalizeDebugPayload`/
     `query-renderer.js`) via `*1000`
  8. Demoted `query.table`/`query.warn` to optional (§5) — `warn` has a 3-state meaning: absence =
     "not analyzed," `false` = "analyzed and OK"
  9. Changed `frames[].line`/`exception.line` from `integer` to `integer|null` (§5, §6) — `line`
     is `null` if `file` is `null` (removing the magic value `0`)
  10. Added `"required": ["format"]` to each `if` under `query.explain`'s `allOf` (§7) — improves
      error messages, behavior unchanged

- **2026-07-17 (S3)**: Registered the `type:"log"` (`log{level, context?}`, 8 PSR-3 levels) and
  `type:"exception"` (`exception{class, message, code?, file, line, trace, previous?}`, recursive
  chaining) types (§5), added `summary.logs?{count, byLevel}` aggregation (§3), recommended
  replacing error determination from a `label` regex with structural `type`/`log.level` criteria
  (§5). The first real-world application of the type registration procedure (that S1 created) —
  no changes to the procedure itself were needed. Optional addition, so `schemaVersion` is
  unchanged.
- **2026-07-17 (S2)**: Introduced the top-level optional `request` section (request context:
  method/status/contentType + get/post/cookies/session/requestHeaders/responseHeaders) (§12).
  Separated its role from `meta.request` (uri/date) — details in §12. Optional addition, so
  `schemaVersion` is unchanged.
- **2026-07-17 (v2 promotion)**: Formally promoted the schema from `v1` to `v2`
  (`schema/debug-payload.v2.schema.json`, `schemaVersion` const `1`→`2`). Introduced the version
  policy (§13: schema `vN` ↔ extension `N.x.x`, adding optional fields keeps the version, changing
  or removing an existing field's meaning bumps the major version). S5 (removing `meta.php`) is
  the substantive trigger for this promotion, and the optional additions from S1–S4 (type
  registration procedure, the `request` section, `log`/`exception` types, `query.explain`) were
  all already valid under v1 — this promotion formally reflects S5's breaking change and confirms
  the cumulative total as v2 at the same time. The "keep `schemaVersion: 1` since there are zero
  external consumers" exception applied at the time of the S5 commit is retired — the "zero
  external consumers" premise had already weakened due to publishing on Packagist
  (`daddyofsky/nova-debug`) and GitHub. Updated `schemaVersion` to `2` across all fixtures
  (`test/fixtures/`).
- **2026-07-17 (S5, ⚠ breaking)**: Removed `meta.php{version, opcache}` → introduced
  `meta.runtime{name, version}` (required) + the top-level `x-php{opcache}` vendor extension
  (§2, §9, §10). Codified `frames[].func`/`args`/`argsFull` as "opaque display strings formatted
  by the producer" (§6). Isolated PHP-presupposing wording throughout SCHEMA.md into
  "reference-implementation-specific" notation + the new §10 section.
  Existing `meta.php` payloads will **fail** schema validation due to this change (field removal
  is generally subject to a `schemaVersion` bump) — this breaking change was the direct trigger
  for the v2 promotion decision above. Migrated all fixtures (`test/fixtures/`) to the new
  structure — after this commit, real payloads with the old `meta.php` structure intentionally
  FAIL until the E/P work lands.
- **2026-07-17 (S4)**: Added `query.explain` (a DB-engine-neutral raw EXPLAIN structure, 3
  formats: table/text/json); `query.explainHtml` is treated as deprecated (the canonical field is
  `explain`, scheduled for removal after a transition period — §7). Optional addition, so
  `schemaVersion` is unchanged.
- **2026-07-12**: Changed `transport.logApiUrl` from required to optional. The ext-saved JSON
  omits this field to avoid exposing the server lookup path (in-page output still includes it).
  Removed the `X-Nova-Debug-Fetch` response header, added `ext.token` authentication, changed the
  ext id to a fixed 16-char hex via `bin2hex(random_bytes(8))` (all transport/security-layer
  changes; the payload field structure itself is unchanged — `schemaVersion` is unchanged).
