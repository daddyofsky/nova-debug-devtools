# Nova Debug Payload — v1 스키마

프레임워크 중립 디버그 페이로드 스펙. 서버 라이브러리(Nova/debug)가 생산하고, 브라우저
확장 패널/서버 in-page 폴백(debug.js)이 소비한다.

- JSON Schema: [`schema/debug-payload.v1.schema.json`](schema/debug-payload.v1.schema.json) (draft 2020-12)
- 레퍼런스 구현: `Nova/debug/DebugAnalyzer.php::analyze()` (nova_builder repo)
- 소비 구현: `Nova/debug/assets/debug.js` — `normalizeDebugPayload()` (v1 → 렌더러 뷰 모델 변환)
- 이전 버전: v0 (`schemaVersion` 필드 없음 또는 0) — 최상위에 20여 개 스칼라를 평면 나열하고
  `data[]`/`files[]`만 배열이었다. v1부터 모든 출력 경로(ext 저장 JSON, in-page
  `window.__debugData`, 텍스트 로그)가 동일한 구조를 공유한다.

---

## 1. 최상위 구조

```
{
  "schemaVersion": 1,
  "meta":       { ... },
  "summary":    { ... },
  "thresholds": { ... },
  "files":      [ ... ],
  "frames":     [ ... ],
  "entries":    [ ... ],
  "timeline":   [ ... ],
  "x-nova":     { ... }   // 선택 — 벤더 확장
}
```

required: `schemaVersion, meta, summary, thresholds, files, frames, entries, timeline`.
`x-nova`는 선택이며, 벤더(Nova) 고유 값이 있을 때만 포함된다.

---

## 2. `meta` — 요청 메타데이터

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | ✓ | 요청 식별자 |
| `generator` | string | ✓ | 생산자 이름/버전, 예: `nova-debug/20260618a` |
| `request.uri` | string | ✓ | 요청 URI |
| `request.date` | string | ✓ | 서버 로컬시각 `Y-m-d H:i:s` |
| `php.version` | string | ✓ | `PHP_VERSION` |
| `php.opcache` | boolean | ✓ | opcache 활성 여부 |
| `ide.protocol` | string | 선택 | `phpstorm` / `idea` / `vscode` 등 |
| `ide.serverPath` | string | 선택 | 서버측 프로젝트 루트 절대경로 |
| `ide.localPath` | string | 선택 | 로컬(개발자 머신) 프로젝트 루트 절대경로 |
| `ide.project` | string | 선택 | IDE 프로젝트명 |
| `dirRoot` | string | ✓ | `files[].path` / 프레임 파일 경로가 상대경로로 저장된 기준 절대경로 |
| `transport.logApiUrl` | string | 선택 | 로그 조회 API URL. **in-page(`window.__debugData`) 출력에만 포함** — ext 저장 JSON은 생략(아래 참조) |
| `transport.cookieName` | string | ✓ | 디버그 패널 표시상태 쿠키명 |
| `transport.cookieOn` | boolean | ✓ | 요청 시점 쿠키 값 |

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

| 필드 | 타입 | 설명 |
|---|---|---|
| `time.total` | number | 요청 총 소요시간(초). `entries[].time/duration`, `timeline[].start/duration` 퍼센트 계산의 분모 |
| `time.debug` | number | 디버그 라이브러리 자체 처리시간(초) |
| `memory.usage` / `memory.peak` | integer | bytes |
| `queries.count` | integer | 전체 쿼리 수 |
| `queries.time` | number | 쿼리 총 소요시간(초) |
| `queries.slow.count` / `.time` | integer/number | `thresholds.slowQueryTime` 초과 쿼리 |
| `queries.dup.total` | integer | DUP로 표시된 쿼리 개수 |
| `queries.dup.patterns` | integer | DUP fingerprint 그룹 수 |
| `queries.dup.percent` | number | `dup.total / queries.count * 100` (반올림) |
| `queries.loop.total` | integer | LOOP로 표시된 쿼리 개수 |
| `queries.loop.sites` | integer | LOOP 호출 지점 수 (같은 fingerprint + 같은 trace) |
| `queries.loop.byType` | array | `{table, count}` — 호출지점별 테이블/횟수 |
| `queries.avg` / `.max` | number | ms 단위 (초 단위인 다른 시간 필드와 다름 — 기존 UI 표시 관례 유지) |
| `queries.maxIndex` | integer | 최대 소요시간 쿼리의 `entries[].index` |
| `files.count` | integer | "로드된 파일" 개수(`get_included_files()`). `files[]` 배열 길이와 다를 수 있음(§6) |

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
  "type": "query",              // "dump" | "query" | "array"
  "time": 0.02883,               // 요청 시작 대비 오프셋(초)
  "duration": 0.00025,            // 소요시간(초). 대부분 dump는 0
  "label": "QUERY [S]",
  "dump": "SELECT ...",
  "trace": [70, 71, 72, ...],     // frames[] 인덱스 목록, 스택 최상단 먼저
  "array":  { "depth": 1, "count": 8 },        // type=array 일 때만
  "object": { "className": "...", "count": 5 }, // type=dump && 객체일 때만(count는 num_rows 있을 때만)
  "query":  {                                    // type=query 일 때만
    "table": "menu",
    "warn": true,
    "explainHtml": "<table>...</table>",         // 있을 때만 (§7)
    "dup":  { "count": 7, "group": "D1" },       // DUP일 때만
    "loop": { "count": 4, "group": "L1", "sig": "file:line|file:line|..." } // LOOP일 때만
  }
}
```

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

---

## 6. `files[]` / `frames[]` — 파일·프레임 테이블

**`files[]`**: `{path, original?}`. `path`는 `meta.dirRoot` 기준 상대경로(선행 슬래시 포함).
절대경로가 필요하면 `dirRoot + path`로 복원한다(IDE 딥링크 등). `original`은 템플릿 캐시
파일의 원본 경로 매핑이 있을 때만 포함.

**`frames[]`**: 요청 전체에서 유일한 `(file, line, func, args, argsFull)` 조합만 담는
dedup 테이블. `file`은 `files[]` 인덱스(네이티브 함수 등 파일이 없으면 `null`).

**`entries[].trace`**: `frames[]` 인덱스의 정수 배열(스택 최상단이 먼저, v0과 동일 순서).

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

`files[]`는 기본적으로 `get_included_files()` 순서 그대로이며 `summary.files.count`와
길이가 같다. 다만 trace가 참조하는 파일 중 `get_included_files()` 목록에 없는 경로가
있으면(eval된 코드 등 드문 경우) `files[]` 뒤쪽에 추가로 수용한다. **"Files" 탭 등
파일 목록 UI의 카운트 표시는 `summary.files.count` 기준으로 한다** — `files[]` 전체
길이가 아니다. (근거: 실측/코드 검토 결과 이 경로로 추가되는 경우는 사실상 없었으나,
프레임 파일 해석이 실패하지 않도록 방어적으로 열어둔 것.)

---

## 7. `explainHtml` — 의도적으로 남긴 구현 상세 필드

DESIGN.md §9 방향은 "표현값은 서버에서 제거하고 클라이언트가 계산"이었고, 대부분
적용했다(`tl_left/tl_width`, timeline `left/width`, `files[].link/originalLink`).
**`query.explainHtml`만은 예외로 유지한다** — EXPLAIN 결과를 색상 강조된 HTML 테이블로
렌더링하는 로직(`AbstractQueryDriver::getInfoHtml()`)은 DB 드라이버별 EXPLAIN 컬럼
의미(type/key/Extra 등)를 아는 코드이며, 순수 표현(좌표/링크 계산)이 아니라
드라이버 지식이 필요한 데이터 가공이다. 범용 소비자를 위해 원시 EXPLAIN 배열을
같이 보내는 방안도 검토했으나, 필드 하나 늘리는 비용 대비 실익이 낮아 이번
범위에서는 HTML만 유지하고 "구현 상세, 무시 가능"으로 문서화하는 쪽을 택했다.
향후 진짜 프레임워크 중립 소비자가 생기면 `query.explain`(원시 배열)을 추가하는
방향으로 재검토한다.

`explainHtml`은 EXPLAIN이 실제로 산출됐을 때만 포함된다(값이 없을 때는 필드 자체를
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

## 9. `x-nova` — 벤더 확장

```
{ "fileHighlight": { "/Controllers/": "blue", "/Models/": "green", ... } }
```

Nova 프레임워크 고유 값만 담는다. 범용 소비자는 이 키를 무시해도 안전하다.
`fileHighlight` 설정이 없으면 `x-nova` 키 자체가 생략된다.

---

## 10. 소비 구현 노트 (`debug.js`)

`assets/debug.js`의 `normalizeDebugPayload(payload)`가 v1 페이로드를 받아 기존
렌더 코드(`createHelpers`, `renderRow`, `setupTimeline`, `setupFileList` 등)가
기대하는 v0 스타일 평면 뷰 모델로 변환한다. 이 함수 밖의 렌더 코드는 스키마 변경의
영향을 받지 않는다 — 표현값 계산(IDE 링크, 퍼센트 위치, type 표시 문자열)이 전부
이 한 곳에 모여 있다. `window.__debugRender`(in-page)와 `window.__debugLogRender`
(text log 모드) 양쪽 진입점 모두 원본 v1 페이로드를 먼저 `normalizeDebugPayload()`에
통과시킨 뒤 사용한다.

브라우저 확장 패널(`_browser/debug/panel/renderer/*`)의 v1 전환은 별도 작업 범위다
(이 문서/스키마는 그 작업의 기준이 된다).

---

## 변경 이력

- **2026-07-12**: `transport.logApiUrl`을 필수 → 선택으로 변경. ext 저장 JSON은 서버 조회 경로
  노출을 막기 위해 이 필드를 생략한다(in-page 출력은 그대로 포함). 응답 헤더 `X-Nova-Debug-Fetch`
  제거, `ext.token` 인증 추가, ext id를 `bin2hex(random_bytes(8))` 고정 16자 hex로 변경(모두
  전송/보안 계층 변경이며 페이로드 필드 구조 자체는 그대로 — `schemaVersion` 불증가).
