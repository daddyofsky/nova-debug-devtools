# Nova Debug Payload — v2 스키마

English: [SCHEMA.en.md](SCHEMA.en.md)

프레임워크 중립 디버그 페이로드 스펙. 서버 라이브러리(Nova/debug)가 생산하고, 브라우저
확장 패널/서버 in-page 폴백(debug.js)이 소비한다.

- JSON Schema: [`schema/debug-payload.v2.schema.json`](schema/debug-payload.v2.schema.json) (draft 2020-12)
- 레퍼런스 구현: `Nova/debug/DebugAnalyzer.php::analyze()` (nova_builder repo)
- 소비 구현: `Nova/debug/assets/debug.js` — `normalizeDebugPayload()` (v2 → 렌더러 뷰 모델 변환)
- 이전 버전: v0 (`schemaVersion` 필드 없음 또는 0) — 최상위에 20여 개 스칼라를 평면 나열하고
  `data[]`/`files[]`만 배열이었다. v1부터 모든 출력 경로(ext 저장 JSON, in-page
  `window.__debugData`, 텍스트 로그)가 동일한 구조를 공유한다. v2는 v1의 breaking 변경(§13
  버전 정책, 변경 이력 S5 참조)을 흡수한 현재 버전이다.

---

## 1. 최상위 구조

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
  "request":    { ... },  // 선택 — 요청 컨텍스트
  "x-nova":     { ... },  // 선택 — 벤더 확장
  "x-php":      { ... }   // 선택 — 벤더 확장
}
```

required: `schemaVersion, meta, summary, thresholds, files, frames, entries, timeline`.
`request`는 선택이며 요청 컨텍스트를 수집했을 때만 포함된다(§12).
`x-nova`/`x-php`는 선택이며, 벤더(Nova) 고유 값·PHP 레퍼런스 구현 고유 값이 있을 때만 각각 포함된다(§9).

### 벤더 확장 키 — 루트 `x-*` 패턴

루트는 `patternProperties: {"^x-": {"type":"object"}}`를 허용한다(`additionalProperties: false`는
유지). `x-nova`/`x-php`는 이미 알려진 벤더 확장이지만, 그 외 임의의 `x-` 프리픽스 키(예:
`x-client`, `x-debugbar`)도 값이 객체이기만 하면 스키마 검증을 통과한다 — 신규 벤더 확장을
추가할 때마다 루트 스키마를 매번 수정할 필요가 없다(§9 참조).

---

## 2. `meta` — 요청 메타데이터

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | ✓ | 요청 식별자. 패턴 `^[A-Za-z0-9_-]+$` (파일명/조회 키로 쓰이므로 경로 구분자 등 위험 문자를 방어적으로 배제 — 레퍼런스 구현의 `\d{6}_\d{6}_[0-9a-f]{16}` 형식은 이 패턴에 포함됨) |
| `generator` | string | ✓ | 생산자 이름/버전, 예: `nova-debug/20260618a` |
| `request` | object | 선택 | 요청 식별 메타데이터(uri/date). 있으면 아래 두 필드 모두 필수 |
| `request.uri` | string | 선택(request 존재 시 ✓) | 요청 URI |
| `request.date` | string | 선택(request 존재 시 ✓) | ISO 8601, 타임존 오프셋 포함 (예: `2026-07-20T14:30:00+09:00`) |
| `runtime.name` | string | ✓ | 런타임/언어 이름(소문자 관례), 예: `php` |
| `runtime.version` | string | ✓ | 런타임 버전 문자열 (레퍼런스 구현 기준: `PHP_VERSION`) |
| `ide.protocol` | string | 선택 | `phpstorm` / `idea` / `vscode` 등 |
| `ide.serverPath` | string | 선택 | 서버측 프로젝트 루트 절대경로 |
| `ide.localPath` | string | 선택 | 로컬(개발자 머신) 프로젝트 루트 절대경로 |
| `ide.project` | string | 선택 | IDE 프로젝트명 |
| `dirRoot` | string | ✓ | `files[].path` / 프레임 파일 경로가 상대경로로 저장된 기준 절대경로 |
| `transport` | object | 선택 | 전송/쿠키 메타데이터. 확장 패널은 원래 미소비 — Nova 인페이지 폴백(`window.__debugData`) 전용. 있으면 아래 두 필드 모두 필수 |
| `transport.logApiUrl` | string | 선택 | 로그 조회 API URL. **in-page(`window.__debugData`) 출력에만 포함** — ext 저장 JSON은 생략(아래 참조) |
| `transport.cookieName` | string | 선택(transport 존재 시 ✓) | 디버그 패널 표시상태 쿠키명 |
| `transport.cookieOn` | boolean | 선택(transport 존재 시 ✓) | 요청 시점 쿠키 값 |

### `meta.request` / `meta.transport` — optional 강등 사유

두 섹션 모두 **키 자체가 선택**으로 강등됐다(이전에는 `meta`의 required 목록에 있었다).

- **`meta.transport`**: 브라우저 확장(패널)은 이 필드를 애초에 소비하지 않는다 — Nova
  인페이지 폴백(`window.__debugData`)이 로그 조회 URL·쿠키 상태를 표시하는 데만 쓴다.
  확장만 소비하는 생산자(비-Nova, 비-HTTP 등)에 이 필드를 강제할 이유가 없어 optional로
  내렸다. Nova 레퍼런스 구현은 계속 생산한다(HTTP+인페이지 폴백 환경이므로).
- **`meta.request`**: 향후 CLI/cron 등 비-HTTP 실행 수집(TODO.md P5)을 대비해 optional로
  내렸다 — HTTP 요청이 아닌 실행에는 `uri`가 없고 `meta.cli{}` 같은 별도 구조가 필요할 수
  있기 때문이다. Nova 레퍼런스 구현(HTTP 요청)은 계속 생산한다.

### `transport.logApiUrl`이 출력 경로별로 다른 이유

- **in-page 폴백(`window.__debugData`)**: 페이지 내 로그 뷰어(`debug.js`)가 이 URL로 로그 목록을
  조회하므로 그대로 포함한다.
- **브라우저 확장(ext) 저장 JSON**: 서버 조회 경로(`log.apiUrl`)를 노출할 필요가 없다 — 확장은
  자체 설정(기본 경로 + origin별 오버라이드)으로 fetch URL을 구성한다. 응답 헤더 `X-Nova-Debug-Fetch`
  제거(2026-07-12)와 같은 이유의 조치이며 `meta.ide` 처리와 동일한 패턴(`extOutput()`에서 strip)이다.

### `meta.ide` 필드 구성이 출력 경로별로 다른 이유

- **브라우저 확장(ext) 저장 JSON**: `serverPath`만 전달(설정된 경우), 나머지는 생략.
  `localPath`/`project`/`protocol`은 개발자 로컬 환경에 따라 다르므로 확장 옵션(도메인별
  매핑)에서 채운다. 이렇게 하면 저장된 JSON이 특정 개발자 머신에 종속되지 않는다.
- **in-page 폴백(`window.__debugData`)**: 서버가 같은 머신에서 렌더링하는 것이므로
  `protocol/serverPath/localPath/project` 전체를 전달한다 (v0과 동일 동작 유지).

---

## 3. `summary` — 집계 통계

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `time.total` | number | ✓ | 요청 총 소요시간(초). `entries[].time/duration`, `timeline[].start/duration` 퍼센트 계산의 분모 |
| `time.debug` | number | ✓ | 디버그 라이브러리 자체 처리시간(초) |
| `memory.usage` / `memory.peak` | integer | ✓ | bytes |
| `queries` | object | 선택 | 쿼리 집계 전체. 쿼리를 전혀 실행하지 않는 런타임(비-DB 환경)은 이 키 자체를 생략한다 |
| `queries.count` | integer | 선택(queries 존재 시 ✓) | 전체 쿼리 수 |
| `queries.time` | number | 선택(queries 존재 시 ✓) | 쿼리 총 소요시간(초) |
| `queries.slow.count` / `.time` | integer/number | 선택(queries 존재 시 ✓) | `thresholds.slowQueryTime` 초과 쿼리 |
| `queries.dup.total` | integer | 선택(queries 존재 시 ✓) | DUP로 표시된 쿼리 개수 |
| `queries.dup.patterns` | integer | 선택(queries 존재 시 ✓) | DUP fingerprint 그룹 수 |
| `queries.dup.percent` | number | 선택(queries 존재 시 ✓) | `dup.total / queries.count * 100` (반올림) |
| `queries.loop.total` | integer | 선택(queries 존재 시 ✓) | LOOP로 표시된 쿼리 개수 |
| `queries.loop.sites` | integer | 선택(queries 존재 시 ✓) | LOOP 호출 지점 수 (같은 fingerprint + 같은 trace) |
| `queries.loop.byType` | array | 선택(queries 존재 시 ✓) | `{table, count}` — 호출지점별 테이블/횟수 |
| `queries.avg` / `.max` | number | 선택(queries 존재 시 ✓) | **초 단위**(페이로드 전체 시간 필드와 단위 통일). ms 표시가 필요하면 소비측이 `*1000` 계산 — 기존 UI 표시 관례는 소비측에서 유지 |
| `queries.maxIndex` | integer | 선택(queries 존재 시 ✓) | 최대 소요시간 쿼리의 `entries[].index` |
| `files` | object | 선택 | 파일 집계. 로드 파일 수를 셀 수 없는 런타임은 이 키 자체를 생략한다 |
| `files.count` | integer | 선택(files 존재 시 ✓) | "로드된 파일" 개수(레퍼런스 구현 기준: `get_included_files()`, §10 참조). `files[]` 배열 길이와 다를 수 있음(§6) |
| `logs.count` | integer | 선택 | `type:"log"` 엔트리 총 개수. 로그를 생산하지 않으면 `logs` 키 자체를 생략 |
| `logs.byLevel` | object | 선택 | PSR-3 레벨명 => 해당 레벨 개수 |

### `summary.queries` / `summary.files` — optional 강등 사유

둘 다 이전에는 `summary`의 required였다. 쿼리를 실행하지 않는 런타임(캐시 전용 요청,
비-DB 서비스 등)이나 "로드된 파일" 개념이 없는 런타임에서는 이 값들을 강제로 0으로
채우는 것이 "데이터가 0건"이 아니라 "이 개념 자체가 없음"을 잘못 표현하는 날조였다 —
optional로 내려 부재를 있는 그대로 표현한다. Nova 레퍼런스 구현은 항상 두 값을 계산해
생산하므로 실사용에는 영향이 없다. 소비자는 두 키의 부재를 "0건"과 동일하게 처리하되
(카운트 배지 등은 0/빈 값 표시), 통계 UI(Queries 탭 등)는 부재 시 해당 섹션을 숨기는
편이 더 정확하다.

---

## 4. `thresholds`

| 필드 | 설명 |
|---|---|
| `slowQueryTime` | 이 값(초) 초과 쿼리 = SLOW |
| `tooManyCount` | 배열/객체 원소 수 임계값. 다차원 배열(`array.depth==2`)은 소비측이 배수를 완화 적용해도 됨(Nova 레퍼런스 debug.js는 `depth>=2`일 때 `tooManyCount` 그대로, 그 외엔 `tooManyCount*2`) |

---

## 5. `entries[]` — 디버그 출력 항목

```
{
  "index": 12,
  "type": "query",              // 개방형 문자열(패턴 ^[a-z][a-z0-9-]*$). 알려진 값: dump/query/array. 신규 타입은 "타입 등록 절차" 참조
  "time": 0.02883,               // 요청 시작 대비 오프셋(초)
  "duration": 0.00025,            // 소요시간(초). 대부분 dump는 0
  "label": "QUERY [S]",
  "dump": "SELECT ...",
  "truncated": false,              // 선택 — dump가 생산자 측에서 truncate됐는지. 부재="알 수 없음/비절단"
  "trace": [70, 71, 72, ...],     // frames[] 인덱스 목록, 스택 최상단 먼저
  "array":  { "depth": 1, "count": 8 },        // type=array 일 때만
  "object": { "className": "...", "count": 5 }, // type=dump && 객체일 때만(count는 num_rows 있을 때만)
  "query":  {                                    // type=query 일 때만
    "table": "menu",                              // 선택 — 비테이블 저장소(캐시 등)는 생략
    "connection": "default",                      // 선택 — 다중 DB 커넥션 구분 라벨
    "bindings": [1, "active"],                    // 선택 — prepared statement 파라미터(순서대로), scalar|null
    "warn": true,                                 // 선택 — 부재="분석 안 함", false="분석했고 정상"
    "explain": {                                  // 있을 때만 — 정식 필드 (§7)
      "format": "table",
      "columns": ["id", "select_type", "table", "..."],
      "rows": [[1, "SIMPLE", "menu", "..."]]
    },
    "explainHtml": "<table>...</table>",         // 있을 때만 — deprecated (§7)
    "dup":  { "count": 7, "group": "D1" },       // DUP일 때만
    "loop": { "count": 4, "group": "L1", "sig": "file:line|file:line|..." } // LOOP일 때만
  }
}
```

### 알려진 타입

| type | 서브객체 | 결합 규칙 | 설명 |
|---|---|---|---|
| `dump` | `object?` | 값이 예외/오류 객체가 아닌 일반 객체일 때만 존재(레퍼런스 구현 기준: PHP Throwable 제외, §10) | 임의 값 dump |
| `array` | `array` | 항상 존재 | 배열 dump — depth/count |
| `query` | `query` | 항상 존재 | SQL 쿼리 실행 — table?/warn?/explain/explainHtml(deprecated)/dup/loop |
| `log` | `log` | 항상 존재 | 로그 메시지 — level(PSR-3)/context |
| `exception` | `exception` | 항상 존재 | 예외/오류 — class/message/code/file/line/trace/previous |

위 5타입 외의 `type` 값은 "알 수 없는 타입"으로 취급되며 아래 소비 규칙을 따른다.
신규 타입 추가는 "타입 등록 절차" 참조.

### `query.table` / `query.warn` — optional 강등 사유

`query` 서브객체의 required였던 두 필드를 optional로 내렸다.

- **`table`**: SQL 백엔드가 아닌 저장소(캐시 조회를 `type:"query"`로 표현하는 등 비-RDB
  저장소)는 테이블 개념이 없다. 없으면 필드 자체를 생략한다 — 소비자는 표시 시
  `table ?? '(unknown)'` 같은 폴백을 적용한다.
- **`warn`**: EXPLAIN 분석을 수행하지 않는 생산자(경량 드라이버, 분석 비용을 건너뛰는
  설정 등)를 위해 optional로 내렸다. **3상태 의미**를 갖는다 — **부재는 "분석 안 함"**,
  **`false`는 "분석했고 정상"**, **`true`는 "분석했고 주의 필요"**. 부재와 `false`를
  같은 값으로 취급하지 않아야 한다(전자는 "모름", 후자는 "확인했고 문제없음").

### `query.bindings` / `query.connection` — prepared statement 파라미터 · 다중 커넥션 (2026-07-20)

```
query: {
  bindings?: (string|number|boolean|null)[],  // prepared statement 파라미터, 순서대로
  connection?: string                          // 다중 DB 커넥션 구분 라벨
}
```

- **`bindings`**: prepared statement에 바인딩된 파라미터 값을 SQL 원문과 분리해 제공한다.
  `entries[].dump`(SQL 원문)는 값이 실제로 보간됐는지와 무관하게 **항상 그대로 유지**된다
  — `bindings`는 생산자가 파라미터를 별도로 확보했을 때만 추가로 제공하는 부가 정보다.
  값 타입은 `query.explain.rows`의 셀과 동일하게 scalar(string/number/boolean) 또는
  null을 허용한다(§7과 같은 이유 — 드라이버가 파라미터 타입을 캐스팅하는 방식이 제각각).
  없으면 필드 자체를 생략한다(파라미터 바인딩을 쓰지 않는 쿼리, 또는 생산자가 값을
  캡처하지 않는 경우).
- **`connection`**: 다중 DB 커넥션(예: 읽기/쓰기 분리, 여러 데이터소스)을 구분하는 표시용
  라벨이다(예: `"default"`, `"mysql_read"`). 단일 커넥션만 쓰는 생산자는 생략한다.

### 오류 판정 — 구조적 기준 권장

`type:"exception"` 등록 이전에는 오류 여부를 판정할 구조적 필드가 없어, 소비 구현
(`panel/renderer/row-renderer.js`)이 `label` 문자열에 `/ERROR|Exception/i` 정규식을
적용해 강조 표시(`d-error` 클래스)하는 방식을 써왔다. 이제 `type:"exception"`과
`log.level`(`error`/`critical`/`alert`/`emergency`)이라는 구조적 신호가 생겼으므로,
**소비자는 `type === 'exception'` 또는 `log.level`이 error 이상인지로 오류 여부를
판정하는 것을 권장한다** — 문자열 매칭보다 오탐(예: 정상 로그 메시지에 우연히
"Exception"이라는 단어가 포함된 경우)이 없다. 기존 `label` 정규식 판정은 아직 이
필드가 없는 구버전 생산자의 페이로드(`type:"dump"`로만 예외를 표현하던 시절)를 위한
**레거시 호환 관례로만 유지**한다 — 구조적 필드가 있으면 그것을 우선한다.

### v0 → v1 필드 변경

| v0 | v1 | 비고 |
|---|---|---|
| `term` | `duration` | 이름만 변경 |
| `time` (절대 microtime) | `time` (요청 시작 대비 상대 오프셋, 초) | 절대시각 노출 제거, 계산은 동일 |
| `type: ''` / `'array : 8'` / `'ClassName'` / `'ClassName : 5'` (문자열 인코딩) | `type` enum + `array{depth,count}` / `object{className,count}` | **v0의 핵심 문제였던 "종류+개수 문자열 인코딩"을 구조화 필드로 분해**. 화면 표시 문자열(`'array : 8'` 등)은 소비측(`normalizeDebugPayload`)이 재조립 — 렌더 결과는 v0과 동일 |
| `dupCount/dupGroup/loopCount/loopGroup/loopSig` (모든 엔트리에 평면 필드, 쿼리가 아니면 0/'') | `query.dup` / `query.loop` (쿼리에만, 있을 때만) | DUP/LOOP는 쿼리에서만 의미 있으므로 중첩 |
| `queryHtml` (항상 존재, EXPLAIN 없으면 강제로 `' '` 채움) | `query.explainHtml` (있을 때만) | 강제 채움 로직은 소비측 재구성 로직으로 이동 (§7) |
| `tl_left` / `tl_width` (%, 서버 계산) | 없음 — 소비측이 `time/duration`과 `summary.time.total`로 계산 | 표현값 제거 |
| trace 배열: `{idx,file,rawFile,line,func,args,argsFull}` 객체를 항목마다 완전 복제 | `frames[]` 인덱스 정수 배열 | §6 dedup 참조 |

### 알 수 없는 타입 소비 규칙

`type`은 열거형이 아니라 개방형 문자열이다(패턴 `^[a-z][a-z0-9-]*$`). 소비자(확장/구현체)는
자신이 모르는 `type` 값을 만나도 안전하게 렌더링해야 한다: `label` + `dump`(문자열) + `trace`만으로
generic 렌더링하고, 타입명과 같은 이름의 미지 서브객체(예: `cache{}`, `http{}`)는 무시해도 된다 —
서브객체는 항상 부가 정보이며 위 3개 필드만으로 항목의 의미(무엇을, 언제, 어디서)가 이미 완결된다.

### 타입 등록 절차

신규 타입을 추가할 때:

1. 본 문서 §5 상단 타입 표(dump/query/array/log/exception 나열)에 1행 추가
2. 서브객체 스펙을 정의한다 — 키는 `x-` 프리픽스 없이 타입명과 동일하게 쓴다(예: `type:"http"` →
   `http?{}`, `type:"event"` → `event?{}`). 알려진 타입(`array`/`object`/`query`/`log`/`exception`)과
   동일한 관례다
3. `schema/debug-payload.v2.schema.json`의 `$defs.entry`에 `if/then` 조건을 추가해 새 타입과
   서브객체의 결합 규칙을 명시한다(§entries의 `allOf` 참조)
4. 신규 타입 등록 시 기존 알려진 타입 브랜치들의 배제 목록(`properties: {…: false}`)에도
   신규 타입 서브객체 키를 추가한다

새 서브객체 키는 `entry.additionalProperties`(값이 객체인 경우만 허용)로 이미 수용되므로,
등록 전에도 스키마 검증은 통과한다 — 등록은 "결합 규칙을 문서·스키마에 명문화"하는 절차다.

**본 절차의 첫 실전 적용(S3, `log`/`exception` 등록)에서 확인된 사항**: 위 3단계 그대로
수행 가능했고 미비점은 없었다. 다만 2단계 "알려진 3타입과 동일한 관례" 문구가 타입이
늘어날수록 실제 개수와 어긋나므로, 등록 시 이 문구의 타입 개수도 함께 갱신해야 한다(이번
갱신에서 "3타입" → "알려진 타입"으로 일반화해 향후 갱신 부담을 없앴다).

### `entries[].truncated` — dump 절단 표시 (2026-07-20)

```
truncated?: boolean   // 생산자가 dump를 truncate했는지
```

`entries[].dump`가 생산자 측 크기 제한(레퍼런스 구현 기준: `ext.dumpMaxLength`, §10)에
걸려 절단됐는지 표시하는 선택 필드다. **부재는 "알 수 없음/비절단"을 의미**하며 `false`와
동일하게 취급한다 — `query.warn`(§5)과 달리 이 필드는 2상태([미제공]/[true])로 충분하다(생산자가
절단하지 않았음을 굳이 `false`로 명시할 실익이 적다). `true`일 때만 필드를 포함하는 것을
권장하되, `false`를 명시적으로 포함해도 스키마상 유효하다. 소비자는 `true`일 때만 절단
표식(뱃지 등)을 표시한다.

### `additionalProperties` 설계 (entry)

`entry`는 알려진 필드(`index`/`type`/`time`/`duration`/`label`/`dump`/`truncated`/`trace`/`array`/`object`/`query`/
`log`/`exception`)를 `properties`에 명시하고, `additionalProperties: {"type": "object"}`로 미지 타입의 서브객체(값이
객체인 키)만 추가로 허용한다. 처음 검토했던 `patternProperties`(키 이름 패턴으로 허용) 방식은
실제 검증에서 실패했다 — `index`/`type`/`time`/`duration`/`label`/`dump`/`trace` 등 기존 스칼라
필드명도 소문자 패턴에 매치되어 "값이 object여야 한다"는 제약이 함께 걸려버렸기 때문이다(JSON
Schema 사양상 `properties`와 `patternProperties`는 매칭되는 모든 규칙이 AND로 적용됨).
`additionalProperties`는 `properties`에 이미 선언된 키에는 적용되지 않으므로 이 충돌이 없다.

### `log` 서브객체 — 로그 메시지 (`type:"log"`)

```
log: { level: "debug"|"info"|"notice"|"warning"|"error"|"critical"|"alert"|"emergency",
       context?: object }
```

PSR-3 8레벨 그대로 채택했다. `type:"log"`일 때 `log` 서브객체는 **필수**다(다른 알려진
3타입과 동일하게 "항상 존재" 결합 규칙 — §5 타입 표). 로그 메시지 본문은 별도 `message`
필드를 신설하지 않고 기존 `entries[].dump`(문자열)를 그대로 재사용한다 — S1이 정한 "알 수
없는 타입도 `label`+`dump`+`trace`만으로 렌더 가능"이라는 소비 규칙과 정합을 유지하기
위함이다(로그도 예외 없이 이 3필드만으로 최소 렌더링이 가능해야 한다). `label`은 생산자
자유(예: 로거 채널명 등). `context`는 PSR-3 `context` 배열에 대응하며 값 타입을 제한하지
않는다.

### `exception` 서브객체 — 예외/오류 (`type:"exception"`)

```
exception: { class: string, message: string, code?: integer|string,
             file: integer|null, line: integer|null,
             trace: [framesIdx...], previous?: exception }
```

`type:"exception"`일 때 `exception` 서브객체는 필수다. `$defs/exception`으로 정의해
`previous`가 같은 정의를 재귀 참조한다(예외 체이닝 — 체인 길이 제한 없음).

- **`file`은 `files[]` 인덱스(integer) 또는 `null`** — 문자열 절대/상대경로 직접 보유안도
  검토했으나 기각했다. 근거: `frames[]`가 이미 동일한 `files[]` 인덱스 참조 관례를 쓰고
  있어(§6) 파일 경로 해석(=상대경로 복원, IDE 딥링크 등) 로직을 한 곳에 모을 수 있고,
  같은 파일이 여러 예외에 반복 등장해도 `files[]` 재조회 없이 인덱스만 비교하면 되기
  때문이다. 파일 정보가 없는 예외(네이티브 에러 등)는 `null`로 표현한다.
- **`line`도 `integer|null`** — `file`과 동일 관례(§6 `frames[].line`도 동일)다. `file`이
  `null`이면(정보 없음) `line`도 `null`로 표현한다 — 정보 없음을 `0`이라는 매직값으로
  대신하지 않는다.
- **`trace`는 `frames[]` 인덱스 배열**로 `entries[].trace`와 동일 관례를 재사용한다. 다만
  **의미는 별개**다 — `entry.trace`는 이 엔트리가 debug 라이브러리에 의해 *캡처된 시점*의
  호출 스택(예: `set_exception_handler`가 실행되는 지점)이고, `exception.trace`는 예외
  객체 자신이 던져진 지점부터의 스택(PHP `Throwable::getTrace()`)이다. 캡처가 예외 발생
  직후 곧바로 이뤄지면 두 값이 사실상 동일해 생산자가 같은 배열을 양쪽에 넣어도 무방하지만,
  스키마는 이를 강제하지 않는다 — 소비자는 "언제 이 로그 항목이 기록됐는가"는 `entry.trace`,
  "예외가 실제로 어디서 던져졌는가"는 `exception.trace`(및 `previous.trace`)로 구분해
  읽어야 한다.
- **`code`는 `integer|string` 모두 허용** — PHP 예외 코드는 관례상 int(`Exception::getCode()`
  기본 반환형)이지만 `PDOException`처럼 SQLSTATE 문자열(예: `"HY000"`)을 코드로 반환하는
  사례가 실재해 채택했다. 다른 언어 생산자도 에러 코드 표현이 정수/문자열로 갈리므로
  이쪽이 더 범용적이다.
- **`previous`**: 이전(원인) 예외로의 체이닝. 없으면 필드 자체를 생략한다(재귀 종료 조건).

---

## 6. `files[]` / `frames[]` — 파일·프레임 테이블

**`files[]`**: `{path, original?}`. `path`는 `meta.dirRoot` 기준 상대경로(선행 슬래시 포함).
절대경로가 필요하면 `dirRoot + path`로 복원한다(IDE 딥링크 등). `original`은 템플릿 캐시
파일의 원본 경로 매핑이 있을 때만 포함.

### `dirRoot` 밖 파일 경로 폴백 규약

`files[].path`는 `dirRoot` 기준 상대경로가 원칙이지만, 시스템 라이브러리·전역 설치
패키지 등 **`dirRoot` 밖에 있는 파일**은 상대경로로 표현할 방법이 없다. 이런 경로는
**절대경로를 그대로 `path`에 수록**한다(값 자체의 형식은 스키마상 문자열이라 검증되지
않는다 — 이 규약은 문서 규칙이다). 소비자는 `path`가 `/`로 시작하고 `dirRoot`로 시작하지
않으면(또는 애초에 `dirRoot` 자체가 없으면) 이를 "dirRoot 밖 절대경로"로 인식할 수 있다
— 이 경우 `dirRoot + path` 복원 연산을 생략하고 값을 이미 완성된 절대경로로 취급해야
한다. IDE 딥링크 연결은 이런 경로에 대해 생략해도 안전하다(로컬 프로젝트 밖 파일이라
링크가 무의미한 경우가 대부분).

**경로 구분자는 항상 `/`로 고정**한다. Windows 환경의 생산자는 저장 전 `\`를 `/`로
변환해야 한다 — 소비자(브라우저 확장 등)가 플랫폼별 구분자를 모두 처리하게 하는 것보다
생산자가 한 번 정규화하는 편이 스키마 전체의 일관성을 높인다.

**`frames[]`**: 요청 전체에서 유일한 `(file, line, func, args, argsFull)` 조합만 담는
dedup 테이블. `file`은 `files[]` 인덱스(네이티브 함수 등 파일이 없으면 `null`). **`line`도
`file`이 `null`이면 `null`**이다(§5 `exception.file`과 동일 관례) — 정보가 없는 상황을
`0`이라는 매직값으로 표현하지 않는다. 소비자는 `file`이 없을 때 `line`도 표시하지 않아야
한다(`:0` 같은 무의미한 라인 번호 출력 금지).

**`entries[].trace`**: `frames[]` 인덱스의 정수 배열(스택 최상단이 먼저, v0과 동일 순서).

### `func`/`args`/`argsFull` — 생산자가 포맷한 불투명 표시 문자열

프레임의 구조(`file`/`line`/`func`/`args`/`argsFull` 각 필드가 존재한다는 것) 자체는
언어 중립이지만, `func`/`args`/`argsFull`의 **값**은 생산자가 표시용으로 포맷한
불투명(opaque) 문자열이다 — 형식(예: `Class::method` 표기, 인자 요약/펼침 구분 방식)은
생산자 자유이며 스키마가 강제하지 않는다. 소비자는 이 문자열을 파싱해 구조를
재추출하려 하지 말고 그대로 표시만 해야 한다. Nova 레퍼런스 구현의 구체적인 포맷
관례는 §10 참조.

### 왜 프레임 전체 단위로 dedup 하는가

한 요청 안에서 동일 호출 지점(`file:line`, 함수, 인자)이 여러 dump/query 호출에서
반복 등장한다. 실측(91 entries 샘플): trace occurrence 1050건 중 유니크 프레임 484건
(dedup 약 54%). 사용자와 프레임 전체 단위(파일+라인+함수+인자까지 동일해야 같은 프레임)로
합의 완료 — `file:line`만으로 묶으면 인자가 달라도 병합되어 args/argsFull 정보 손실.

### 호출 번호(`idx`) 표시 — v0과의 의도적 차이

v0은 각 trace 항목에 원본 스택 깊이(`idx`, 필터링된 프레임 포함 역산)를 저장했다.
필터링(`trace.ignoreClasses`/`ignoreFunctions`)으로 스킵된 프레임이 있으면 유지된
프레임들 사이에 번호 공백이 생길 수 있었다(스킵도 카운터를 소모하므로). v1은 이
번호를 아예 전송하지 않고, 소비측이 `trace.length - position`으로 1부터 연속 번호를
매긴다. 화면에는 여전히 "N." 형태로 표시되어 기능상 차이가 없고, 필터링이 스택
맨 위(디버그 라이브러리 자신의 호출 프레임)에서만 발생하는 일반적인 경우
번호가 v0과 완전히 동일하다. 필터링된 프레임이 스택 중간에 끼는 드문 경우에만
번호가 v0과 미세하게 달라질 수 있다(내용은 동일, 순번만).

### files[] 길이가 `summary.files.count`보다 클 수 있는 이유

레퍼런스 구현(PHP) 기준 설명: `files[]`는 기본적으로 `get_included_files()` 순서
그대로이며 `summary.files.count`와 길이가 같다. 다만 trace가 참조하는 파일 중
`get_included_files()` 목록에 없는 경로가 있으면(eval된 코드 등 드문 경우) `files[]`
뒤쪽에 추가로 수용한다. **"Files" 탭 등
파일 목록 UI의 카운트 표시는 `summary.files.count` 기준으로 한다** — `files[]` 전체
길이가 아니다. (근거: 실측/코드 검토 결과 이 경로로 추가되는 경우는 사실상 없었으나,
프레임 파일 해석이 실패하지 않도록 방어적으로 열어둔 것.)

---

## 7. `query.explain` / `explainHtml` — EXPLAIN 결과 표현

DESIGN.md §9 방향은 "표현값은 서버에서 제거하고 클라이언트가 계산"이었고, 대부분
적용했다(`tl_left/tl_width`, timeline `left/width`, `files[].link/originalLink`).
`query.explainHtml`만은 당초 예외로 유지했었다 — EXPLAIN 결과를 색상 강조된 HTML
테이블로 렌더링하는 로직(`AbstractQueryDriver::getInfoHtml()`)은 DB 드라이버별 EXPLAIN
컬럼 의미(type/key/Extra 등)를 아는 코드이며, 순수 표현(좌표/링크 계산)이 아니라
드라이버 지식이 필요한 데이터 가공이었기 때문이다. 이후 진짜 프레임워크 중립
소비자가 필요해지면서 이 결정을 재검토해 `query.explain`(원시 구조)을 정식 필드로
도입했다 — `explainHtml`은 **deprecated**로 전환한다.

### `query.explain` — 정식 필드 (DB 엔진 중립 원시 구조)

```
explain?: {
  format: "table" | "text" | "json",
  columns?: string[],   // format=table
  rows?: (string|number|boolean|null)[][],  // format=table
  text?: string,         // format=text
  json?: any             // format=json
}
```

- **`format:"table"`**: `columns`+`rows` 필수(`text`/`json` 금지). MySQL/SQLite 등 컬럼-행
  형태 EXPLAIN. `rows`의 셀 타입은 문자열로 강제하지 않고 scalar(string/number/boolean)
  또는 null을 허용한다 — **채택 근거**(레퍼런스 구현인 PHP DB 드라이버 mysqli/PDO/SQLite3
  기준 관찰, §10): 드라이버마다 EXPLAIN의 숫자 컬럼(`rows`/`filtered` 등)과 NULL 가능
  컬럼(`ref`/`key` 등)을 문자열로 캐스팅해 반환하기도, 원래 타입 그대로 반환하기도
  한다. 스키마가 문자열을 강제하면 생산자가 매번 캐스팅해야 하고 `NULL`(값 없음)과
  `"NULL"`(문자열)의 구분 같은 원본 정보를 잃는다. scalar/null 허용은 다른 언어의
  드라이버가 값을 항상 문자열로만 반환해도 그대로 유효하다 — 생산자가 드라이버
  리턴값을 그대로 통과시키게 하고, 표시 시 문자열 변환은 소비측 렌더러의 책임으로 둔다.
- **`format:"text"`**: `text` 필수(`columns`/`rows`/`json` 금지). PostgreSQL 기본 `EXPLAIN`처럼
  줄 단위 텍스트로만 나오는 산출물.
- **`format:"json"`**: `json` 필수(`columns`/`rows`/`text` 금지). PostgreSQL `EXPLAIN (FORMAT JSON)`,
  MSSQL 실행계획(JSON 변환) 등 엔진마다 구조가 달라 스키마상 형태를 제한하지 않는다.

어떤 DB 엔진의 실행계획도 이 3-format 중 하나로 수용된다(COMPARISON.md §3-4).

`allOf`의 각 `if`에는 `"required": ["format"]`을 명시한다(`entries[]`의 타입별 `if/then`이
`"required": ["type"]`을 쓰는 것과 동일한 기법). 이것이 없으면 `format` 필드 자체가 없는
`explain` 객체에 대해 각 분기의 `const` 비교가 그냥 "매치 안 됨"으로 조용히 넘어가며 오류
메시지가 모호해진다 — 명시하면 "format이 없다"는 원인이 검증 오류에 바로 드러난다.
동작(어떤 입력이 valid/invalid인지)은 이 변경으로 바뀌지 않는다 — 오류 메시지 품질만
개선한다.

### `explainHtml` — deprecated, 병행 기간 유지

`query.explainHtml`은 **deprecated**다. `query.explain`이 정식 필드이며, `explainHtml`은
과도기 동안 기존(레거시) 소비자 호환을 위해서만 병행 유지한다.

- **생산 규칙**: 생산자는 가능하면 `explain`(원시 구조)을 생산한다. `explainHtml`은
  레거시 소비자를 위해 선택적으로 병행 생산할 수 있다(둘 다 없을 수도, 하나만 있을
  수도, 둘 다 있을 수도 있다 — 둘 다 EXPLAIN이 실제로 산출됐을 때만 포함, 값이
  없으면 필드 자체를 생략).
- **소비 규칙**: `explain`과 `explainHtml`이 공존하면 **`explain`을 우선** 사용한다.
  `explainHtml`은 `explain`이 없는 구버전 생산자의 페이로드를 렌더링할 때만 폴백으로
  참조한다.
- **제거 계획**: TODO.md가 언급하는 "`explainHtml`을 `x-nova`로 강등"은 이 병행 기간의
  종료 시점(확장 소비(E)·서버 생산(P) 양쪽이 `explain`으로 전환 완료한 뒤) 처리로
  해석한다 — 지금 당장 `query` 밖으로 옮기거나 `x-nova`로 이동하지 않는다. `query`
  객체 안에 그대로 두되 스키마 description에 deprecated를 명시하는 것으로 이번
  범위(Track S)를 마친다. 실제 제거(또는 `x-nova` 이동)는 E/P 반영이 끝난 뒤 별도
  차수에서 진행한다.

`query.explainHtml`은 EXPLAIN이 실제로 산출됐을 때만 포함된다(값이 없을 때는 필드 자체를
생략). v0은 EXPLAIN이 없어도 `queryHtml`을 `' '`(공백 1개)로 강제 채워 "이 항목은
쿼리다"라는 신호로도 겸용했다 — v1은 `type==='query'`가 그 신호를 명확히 대체하므로
이 강제 채움이 필요 없다. 다만 debug.js의 기존 렌더 분기(`if (item.queryHtml)`)와
동일하게 동작시키기 위해 **소비측(`normalizeDebugPayload`)이 `type==='query'`일 때
`explainHtml || ' '`로 재구성**한다 — 이는 순수히 레거시 렌더 코드 재사용을 위한
클라이언트측 호환 처리이며, 와이어 포맷 자체에는 공백 채움이 없다.

---

## 8. `timeline[]`

```
{ "name": "START", "start": 0, "duration": 0.09487 }
```

`start`/`duration`은 초 단위, 요청 시작 대비 상대값. 퍼센트(`left`/`width`)는
소비측이 `summary.time.total`로 나눠 계산한다(v0은 서버가 미리 퍼센트를 계산해
`left`/`width`로 전달했다).

---

## 9. `x-nova` / `x-php` — 벤더 확장

```
{
  "x-nova": { "fileHighlight": { "/Controllers/": "blue", "/Models/": "green", ... } },
  "x-php":  { "opcache": true }
}
```

- **`x-nova`**: Nova 프레임워크 고유 값만 담는다. 범용 소비자는 이 키를 무시해도
  안전하다. `fileHighlight` 설정이 없으면 `x-nova` 키 자체가 생략된다.
- **`x-php`**: PHP 레퍼런스 구현 고유 값(`opcache` 활성 여부)만 담는다. 범용 소비자는
  이 키를 무시해도 안전하다. PHP가 아닌 생산자는 이 키 자체를 생략한다(`meta.runtime`이
  런타임 식별을 이미 담당하므로 `x-php`는 PHP 특유의 부가 값에 한정).

두 객체 모두 `additionalProperties: true`다(각각 알려진 필드는 `properties`에 명시). 벤더
확장 영역이므로 신규 값을 추가할 때마다 스키마를 갱신할 필요가 없게 관대화했다 — 알려진
값(`fileHighlight`, `opcache`)은 여전히 타입 검증되고, 그 외 임의의 부가 값은 자유롭게
허용된다. 루트의 `x-*` 패턴 허용(§1)과 같은 방향의 결정이다.

---

## 10. Nova 레퍼런스 구현 노트

본 문서·스키마는 언어/프레임워크 중립 계약이지만, 현재 유일한 생산자인 Nova/debug
(PHP, `DebugAnalyzer.php::analyze()`)의 구현 세부사항이 일부 값의 유래를 설명하는 데
필요하다. 아래는 그런 "레퍼런스 구현 기준" 사실을 한 곳에 모은 것이며, 계약 자체가
PHP를 전제하는 것은 아니다 — 다른 언어 구현은 아래와 다르게 값을 채워도 스키마상 유효하다.

| 필드/영역 | 레퍼런스 구현(PHP) 세부사항 |
|---|---|
| `meta.runtime` | `{name:"php", version: PHP_VERSION}` |
| `x-php.opcache` | opcache 확장 활성 여부 |
| `summary.files.count` / `files[]` | `get_included_files()`로 로드된 파일 목록 수집(§6) |
| `entries[].dump` | `print_r()`로 값을 문자열화(ext 채널은 `ext.dumpMaxLength` 기준 절단) |
| `entries[].object` | 값이 `Throwable` 예외/에러 객체가 아닐 때만 채움(예외 표현은 Track S3 `type:"exception"` 예정) |
| `entries[].object.count` | DB 결과셋의 `num_rows()`류 메서드가 있을 때만 채움 |
| `query.explain.rows` 셀 타입(scalar/null 허용) | mysqli/PDO/SQLite3 등 PHP DB 드라이버의 EXPLAIN 캐스팅 방식 차이 때문(§7) |
| `frames[].func`/`args`/`argsFull` 값의 구체 포맷 | `Class::method` 표기 + 요약/펼침 두 단계 인자 문자열 관례(§6) — 구조는 언어 중립, 이 포맷 자체는 관례일 뿐 계약이 아님 |

---

## 11. 소비 구현 노트 (`debug.js`)

`assets/debug.js`의 `normalizeDebugPayload(payload)`가 v2 페이로드를 받아 기존
렌더 코드(`createHelpers`, `renderRow`, `setupTimeline`, `setupFileList` 등)가
기대하는 v0 스타일 평면 뷰 모델로 변환한다. 이 함수 밖의 렌더 코드는 스키마 변경의
영향을 받지 않는다 — 표현값 계산(IDE 링크, 퍼센트 위치, type 표시 문자열)이 전부
이 한 곳에 모여 있다. `window.__debugRender`(in-page)와 `window.__debugLogRender`
(text log 모드) 양쪽 진입점 모두 원본 v2 페이로드를 먼저 `normalizeDebugPayload()`에
통과시킨 뒤 사용한다.

브라우저 확장 패널(`_browser/debug/panel/renderer/*`)의 v2 전환은 별도 작업 범위다
(이 문서/스키마는 그 작업의 기준이 된다).

---

## 12. `request` — 요청 컨텍스트

```
request?: {
  method: string, status: integer, contentType: string,
  route?: string, handler?: string,
  get?{}, post?{}, cookies?{}, session?{},
  requestHeaders?{}, responseHeaders?{}
}
```

최상위 optional 섹션이다. GET/POST 파라미터, 쿠키, 세션, 요청/응답 헤더, 응답
status·Content-Type을 담는다. `method`/`status`/`contentType`은 `request`가 있으면
항상 필수다 — 나머지 서브맵은 수집 여부에 따라 있을 때만 포함된다.

### `meta.request`와의 역할 분리

`meta.request{uri, date}`(§2)는 **항상 존재**하는 요청 식별 메타데이터(요청 URI·서버
시각)다. 이 절의 `request` 섹션은 **선택적으로 수집**되는 상세 컨텍스트이며, `uri`/`date`를
중복 보유하지 않는다 — 요청을 식별할 때는 `meta.request`를, 파라미터·헤더·쿠키·세션 상세를
볼 때는 `request`를 참조한다.

| 필드 | 타입 | 필수(request 존재 시) | 설명 |
|---|---|---|---|
| `method` | string | ✓ | HTTP 메서드, 예: `GET`/`POST` |
| `status` | integer | ✓ | 응답 status 코드 |
| `contentType` | string | ✓ | 응답 Content-Type |
| `route` | string | 선택 | 라우트 패턴 표시 문자열(예: `/users/{id}`). `frames[].func`(§6)과 동일하게 생산자가 포맷한 불투명 문자열 |
| `handler` | string | 선택 | 핸들러(컨트롤러) 표시 문자열(예: `UserController::show`). 표현 관례는 `route`와 동일 |
| `get` | object | 선택 | GET 쿼리 파라미터 |
| `post` | object | 선택 | 파싱된 POST 파라미터 (raw body 금지) |
| `cookies` | object | 선택 | 요청 쿠키 |
| `session` | object | 선택 | 세션 데이터 |
| `requestHeaders` | object | 선택 | 요청 헤더 |
| `responseHeaders` | object | 선택 | 응답 헤더 |

### `get`/`post`/`cookies`/`session`/`requestHeaders`/`responseHeaders` 값 타입 — 채택 근거

이 여섯 맵의 값은 모두 **문자열**로 고정한다(`additionalProperties: {"type": "string"}`).
검토했던 대안은 중첩 배열/객체를 그대로 허용하는 것이었다(PHP는 `a[b]=1` 같은 쿼리
문자열을 `$_GET['a']['b']`처럼 임의 깊이로 중첩시킬 수 있다). 문자열 고정을 채택한 근거:

- **기존 관례와의 일관성**: 이 스키마는 이미 "생산자가 포맷한 불투명 표시 문자열" 패턴을
  `entries[].dump`(§5)·`frames[].func/args/argsFull`(§6)에 쓰고 있다. `request`의 값들도
  같은 패턴을 따르면 소비자가 새로운 타입 분기(문자열/배열/객체 재귀 처리)를 추가할
  필요가 없다.
- **재귀 스키마 회피**: 임의 깊이 중첩을 허용하려면 `$defs`에 재귀 타입을 정의해야 하고,
  다른 언어 생산자(중첩 파라미터 문법이 PHP와 다른 프레임워크)가 구조를 스키마에 맞춰
  변환해야 하는 부담이 생긴다. 문자열 고정은 어떤 언어의 파라미터 구조든 생산자가 이미
  가진 표시용 직렬화(키를 `a[b]` 형태로 평탄화하거나 값을 JSON 문자열화하는 등)를 그대로
  통과시키면 되므로 프레임워크 중립성이 오히려 높아진다.
- **마스킹·truncate와의 정합**: 아래 마스킹/크기 제한 규칙은 "키 하나 = 값 하나(문자열)"
  단위로 정의된다. 값이 중첩 구조면 마스킹 시 트리를 순회하며 하위 키까지 검사해야 하고
  truncate 기준(문자 길이)도 노드마다 다르게 적용해야 해 규칙이 복잡해진다. 평탄화된
  문자열 맵이면 두 규칙 모두 "각 값 문자열에 그대로 적용"으로 단순하다.
- **세션 값의 일반성**: 세션에는 애플리케이션이 임의의 직렬화 가능 값(객체 등)을 저장할
  수 있어 원천적으로 "항상 스칼라"를 보장할 수 없다 — 어차피 문자열화가 필요하므로 GET/POST/
  쿠키까지 동일 규칙으로 통일하는 편이 스키마 전체의 일관성이 높다.

생산자(PHP 레퍼런스 구현)는 중첩 파라미터를 `http_build_query()`류 관례와 동일하게
키 경로를 `a[b]` 형태로 평탄화하고, 값은 `entries[].dump`와 동일하게 문자열화해 표현한다.

### 반복 파라미터 키 규약

`?tag=a&tag=b`처럼 같은 키가 여러 번 나타나는 GET/POST 파라미터는 (PHP처럼 뒤 값이 앞
값을 덮어쓰는 언어가 아닌 한) 값이 여러 개 존재할 수 있다. 이 스키마의 `get`/`post` 맵은
"키 하나 = 값 하나(문자열)" 구조이므로 반복 키를 표현하려면 생산자가 값들을 하나의
문자열로 결합해야 한다 — **`requestHeaders`/`responseHeaders`의 복수 헤더 결합 관례
(`", "`로 연결, §12 표)와 동일한 방식을 권장한다**: `tag: "a, b"`. 이는 문서상 **권장
관례**이며 스키마로 강제하지 않는다 — 생산자가 다른 결합자를 쓰거나 배열을 JSON
문자열화해 넣어도(예: `tag: "[\"a\",\"b\"]"`) 스키마 검증은 통과한다. 다만 소비자 간
일관된 표시를 위해 특별한 사정이 없으면 위 권장 관례를 따르는 것이 좋다.

### 마스킹 규칙 (생산자 의무)

`request` 섹션은 저장되는 `ext.*.json` 파일에 그대로 담기므로, 민감정보가 파일시스템에
평문으로 남을 수 있다. **생산자는 저장 전에 반드시 마스킹을 수행해야 한다** — 이 규칙은
문서 규칙이며 JSON Schema로는 강제할 수 없다(스키마는 값이 문자열이라는 것만 검증하고
내용은 검증하지 않는다).

마스킹 대상: 키(대소문자 무시, **부분 일치**)가 아래 패턴 중 하나라도 포함하면 값을
`"***"`로 치환한다.

```
password, passwd, pwd, secret, token, auth, authorization,
api-key, api_key, apikey, session-id, session_id, sessid,
cookie, csrf, private, credential
```

- `cookie` 패턴은 요청 헤더 `Cookie` 전체와 응답 헤더 `Set-Cookie` 전체에 적용된다(개별
  쿠키 값이 아니라 헤더 값 전체를 마스킹 — `request.cookies`의 개별 항목은 위 패턴 목록에
  키가 매치될 때만 마스킹됨).
- 부분 일치이므로 `csrf_token`, `x-api-key`, `PHPSESSID`(`sessid` 포함) 등도 매치된다.
- 검증 스크립트(`test/validate-payload.py`)는 이 규칙을 강제하지 않는다 — 스키마 검증과
  분리된 별도 경고 성격의 검사이며, 도입 시에도 종료코드에 영향을 주지 않는 warning으로만
  추가해야 한다(현재 버전은 마스킹 경고 검사를 추가하지 않았다 — 아래 "열린 항목" 참조).

### 크기 제한 규칙

값별 truncate 기준은 `ext.dumpMaxLength`를 준용한다(레퍼런스 구현의 `entries[].dump`
절단 기준과 동일 — §10). POST는 **파싱된 파라미터만** 수록하며 raw request body는
스키마에 포함하지 않는다 — 파일 업로드 등으로 body 크기가 커질 수 있고, 파싱되지 않은
원문은 위 마스킹 규칙을 개별 필드 단위로 적용할 수 없어 민감정보 노출 위험이 크다.

---

## 13. 버전 정책

스키마 버전(`schemaVersion`, 정수 `N`)과 확장(브라우저 익스텐션) 버전(`N.x.x`)을
1:1 대응시킨다 — 스키마 `vN`을 소비하는 확장은 항상 메이저 버전 `N`을 쓴다
(v1 ↔ 1.x.x, v2 ↔ 2.x.x).

| 변경 성격 | 예 | 스키마 버전 | 확장 버전 |
|---|---|---|---|
| optional 필드 추가 | 신규 타입 등록(§5 절차), optional 섹션 신설 | 유지 (`schemaVersion` 불변) | minor/patch |
| required → optional 강등 | `meta.transport`/`meta.request`, `summary.queries`/`.files`, `query.table`/`.warn` 등을 필수에서 선택으로 완화 | 유지 (`schemaVersion` 불변) | minor — 기존 소비자는 이미 그 필드를 있다고 가정하고 읽던 코드만 아니라면 영향 없음(non-breaking). 소비자가 무조건 존재를 가정하고 접근하던 코드가 있었다면 그 소비자쪽 수정은 필요하지만 스키마 자체는 하위호환 |
| 기존 필드 의미 변경 또는 제거 | 필드 삭제·타입 변경·required 승격 | 메이저 승격 (`schemaVersion` +1) | major |

`schemaVersion` 필드 자체는 항상 정수 `N`이다(`"schemaVersion": 2`처럼 — 소수점
표기 없음). 확장의 `N.x.x` 중 `x.x`(minor/patch)는 스키마 버전과 무관하게 확장
자체의 변경(버그 수정, UI 개선 등)만으로도 올라갈 수 있다.

---

## 변경 이력

- **2026-07-20 (S7, 잔여 개선 라운드)**: v2 고정(§13) 이후 첫 라운드 — 전부 optional 필드
  추가·문서화이므로 `schemaVersion` 불증가.
  1. `query.bindings?: (string|number|boolean|null)[]` — prepared statement 파라미터를
     SQL 원문(dump)과 분리해 제공(§5). P6(debugbar 브리지) PDOCollector 매핑의 선행 조건.
  2. `query.connection?: string` — 다중 DB 커넥션 구분 라벨(§5)
  3. `request.route?`/`request.handler?: string` — 라우트 패턴·핸들러 표시 문자열(§12,
     `frames[].func`와 동일한 불투명 문자열 관례). 소비(Request 탭)는 E1에서 별도 진행 —
     이번 라운드는 스키마 추가만.
  4. `entries[].truncated?: boolean` — dump가 생산자 측 truncate를 거쳤는지 표시(§5)
  5. `meta.id`에 `pattern: "^[A-Za-z0-9_-]+$"` 부여(§2) — id가 파일명/조회 키로 쓰이는
     것에 대한 방어. 기존 Nova id 형식(`\d{6}_\d{6}_[0-9a-f]{16}`)과 픽스처 전건 호환 확인
  6. `$id`를 GitHub raw 실제 resolvable URL로 교체 —
     `https://raw.githubusercontent.com/daddyofsky/nova-debug-devtools/main/schema/debug-payload.v2.schema.json`
  7. 반복 파라미터 키 규약 문서화(§12) — `?tag=a&tag=b`류는 헤더의 `", "` 결합 관례 준용 권장
  8. `dirRoot` 밖 파일 경로 폴백 규약 문서화(§6) — 절대경로 그대로 수록 + 소비자 IDE 링크
     생략 허용, 경로 구분자 `/` 고정 명시
  9. 확장 소비 반영: `panel/renderer/query-renderer.js`(bindings/connection 표시),
     `panel/renderer/row-renderer.js`(truncated 뱃지)
  10. 영문판 `SCHEMA.en.md` 신설 — E5(스토어 배포) 전 필수 항목(TODO.md S7)

- **2026-07-20 (v2 고정 전 마지막 breaking 라운드)**: 스키마 리뷰에서 확인된 범용성 결함을
  v2 고정 전에 정리. 10건 모두 `schemaVersion` 불증가(v2 유지) — required→optional 강등은
  기존 소비자에게 non-breaking이기 때문(§13 신규 케이스). 요약:
  1. 루트 `patternProperties: {"^x-": {"type":"object"}}` 추가 — 임의 벤더 확장 키 허용(§1)
  2. `x-nova`/`x-php`의 `additionalProperties`를 `false`→`true`로 관대화(§9)
  3. `meta.transport` 전체를 optional로 강등(§2) — 확장 패널 미소비, Nova 인페이지 폴백 전용
  4. `meta.request` 전체를 optional로 강등(§2) — 향후 CLI/cron 등 비-HTTP 수집 대비
  5. `meta.request.date`를 `'Y-m-d H:i:s'`에서 ISO 8601(타임존 오프셋 포함)로 변경(§2)
  6. `summary.queries`/`summary.files`를 optional로 강등(§3) — 쿼리/파일 개념이 없는
     런타임에서 0 날조를 막음
  7. `summary.queries.avg`/`.max`를 ms에서 초 단위로 변경(§3) — 페이로드 전체 시간 단위
     통일. ms 표시는 소비측(`normalizeDebugPayload`/`query-renderer.js`)이 `*1000` 계산
  8. `query.table`/`query.warn`을 optional로 강등(§5) — `warn`은 부재="분석 안 함",
     `false`="분석했고 정상"인 3상태 의미
  9. `frames[].line`/`exception.line`을 `integer`에서 `integer|null`로 변경(§5, §6) — `file`이
     `null`이면 `line`도 `null`(매직값 `0` 제거)
  10. `query.explain`의 `allOf` 각 `if`에 `"required": ["format"]` 추가(§7) — 오류 메시지
      개선, 동작 불변

- **2026-07-17 (S3)**: `type:"log"`(`log{level, context?}`, PSR-3 8레벨) +
  `type:"exception"`(`exception{class, message, code?, file, line, trace, previous?}`,
  재귀 체이닝) 타입 등록(§5), `summary.logs?{count, byLevel}` 집계 추가(§3), 오류 판정을
  `label` 정규식에서 `type`/`log.level` 구조 기준으로 대체 권장(§5). 타입 등록 절차(S1이
  만든 절차)의 첫 실전 적용 — 절차 자체 수정은 불필요했음. optional 추가이므로
  `schemaVersion` 불증가.
- **2026-07-17 (S2)**: 최상위 optional `request`(요청 컨텍스트: method/status/contentType +
  get/post/cookies/session/requestHeaders/responseHeaders) 섹션 신설(§12). `meta.request`(uri/date)와
  역할 분리 — 상세는 §12. optional 추가이므로 `schemaVersion` 불증가.
- **2026-07-17 (v2 승격)**: 스키마를 `v1` → `v2`로 정식 승격(`schema/debug-payload.v2.schema.json`,
  `schemaVersion` const `1`→`2`). 버전 정책 신설(§13: 스키마 `vN` ↔ 확장 `N.x.x`,
  optional 필드 추가는 버전 유지, 기존 필드 의미 변경/제거는 메이저 승격). S5(`meta.php`
  제거)가 이번 승격의 실체적 계기이며, S1~S4(타입 등록 절차·`request` 섹션·`log`/`exception`
  타입·`query.explain`)의 optional 추가분은 모두 v1 상태에서도 유효했던 변경이다 — 이번
  승격은 S5의 breaking 변경을 정식 반영하며 그 누적분을 함께 v2로 확정하는 것이다. S5
  커밋 시점 적용했던 "외부 소비자 0이므로 `schemaVersion: 1` 유지" 특례는 폐기한다 —
  Packagist(`daddyofsky/nova-debug`)·GitHub 공개로 "외부 소비자 0" 전제가 이미 약화됐기
  때문. 픽스처(`test/fixtures/`) 전건의 `schemaVersion`을 `2`로 갱신했다.
- **2026-07-17 (S5, ⚠ breaking)**: `meta.php{version, opcache}` 제거 → `meta.runtime{name,
  version}`(required) 신설 + `x-php{opcache}` 벤더 확장 신설(§2, §9, §10). `frames[].func`/
  `args`/`argsFull`을 "생산자가 포맷한 불투명 표시 문자열"로 명문화(§6). SCHEMA.md 전반의
  PHP 전제 표현을 "레퍼런스 구현 기준" 표기 + §10 신설 절로 격리.
  기존 `meta.php` 페이로드는 이 변경으로 스키마 검증에 **실패**하게 된다(필드 제거는
  일반적으로 `schemaVersion` 증가 대상) — 이 breaking 변경이 위 v2 승격 결정의 직접
  계기가 됐다. 픽스처(`test/fixtures/`) 전건을 새 구조로 마이그레이션했다 — 이 커밋
  이후 구 `meta.php` 구조의 실물 페이로드는 E/P 반영 전까지 의도적으로 FAIL한다.
- **2026-07-17 (S4)**: `query.explain`(DB 엔진 중립 원시 EXPLAIN 구조, table/text/json
  3-format) 추가, `query.explainHtml`은 deprecated 처리(정식 필드는 `explain`, 병행 기간
  후 제거 예정 — §7). optional 추가이므로 `schemaVersion` 불증가.
- **2026-07-12**: `transport.logApiUrl`을 필수 → 선택으로 변경. ext 저장 JSON은 서버 조회 경로
  노출을 막기 위해 이 필드를 생략한다(in-page 출력은 그대로 포함). 응답 헤더 `X-Nova-Debug-Fetch`
  제거, `ext.token` 인증 추가, ext id를 `bin2hex(random_bytes(8))` 고정 16자 hex로 변경(모두
  전송/보안 계층 변경이며 페이로드 필드 구조 자체는 그대로 — `schemaVersion` 불증가).
