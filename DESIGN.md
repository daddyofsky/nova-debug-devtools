# Nova Debug DevTools Extension — 설계서

브라우저 DevTools 패널에서 Nova Debug JSON을 렌더링하는 확장 + 서버 라이브러리 연동 설계.

- 타겟: Chrome + Firefox (양쪽 모두)
- 전달 방식: 응답 헤더 + 조회 엔드포인트 (Clockwork 방식)
- 서버: 기존 `Nova/debug` 라이브러리 in-place 확장, debug.js 인페이지 렌더링은 폴백으로 유지
- 현재 상태: Phase 1~3 완료 + 스키마 v1 표준화(§9) + 보안 라운드(토큰/쿠키 폴백, §6) 완료 → **v1.0.0** 릴리즈 (2026-07-12)

---

## 1. 전체 아키텍처

```
┌─ Browser ─────────────────────────────────────────────┐
│                                                        │
│  DevTools Panel (Nova Debug)                           │
│    │  ① 패널 열림 → background에 tabId 등록            │
│    ▼                                                   │
│  Background                                            │
│    │  ② 해당 tab 요청에 X-Nova-Debug: 1 헤더 주입      │
│    ▼                                                   │
│  Page ──── HTTP Request ──────────────────────────►    │
│                                              Server    │
│                                                │       │
│         ◄── Response + X-Nova-Debug-Id ───────┘       │
│    │  ③ devtools.network.onRequestFinished            │
│    │     응답 헤더에서 Id 감지 (조회 URL은 확장 설정)   │
│    ▼                                                   │
│  Background ── ④ fetch(조회 endpoint) ──► Server      │
│    │                                    (저장된 JSON)  │
│    ▼                                                   │
│  Panel ── ⑤ 요청 행 추가 + 상세 렌더링                 │
└────────────────────────────────────────────────────────┘
```

### 런타임 자동 협상 (폴백 원리)

서버는 요청 헤더 `X-Nova-Debug` 의 존재로 모드를 결정한다.

| 상황 | 요청 헤더 | 서버 동작 |
|---|---|---|
| 확장 설치 + 패널 열림 | `X-Nova-Debug: 1` | **ext 모드**: JSON 저장 + `X-Nova-Debug-Id` 응답 헤더. 인페이지 출력 없음 |
| 확장 미설치 / 패널 닫힘 | 없음 | **기존 동작 그대로**: GET HTML → debug.js 인페이지 렌더링, POST/AJAX → log 모드 |

- 새 코드 경로는 요청 헤더가 있을 때만 활성 → 기존 프로젝트 무영향
- 프로젝트별 설정 선택 불필요, 요청 단위 자동 결정

---

## 2. 프로토콜

### 2.1 요청 헤더 (확장 → 서버)

```
X-Nova-Debug: 1
```

- background가 패널이 열린 tab의 요청에만 주입 (main_frame, sub_frame, xhr/fetch 등 전체 리소스 타입 중 문서/XHR 계열만)
- 옵션 페이지의 **호스트 테이블(`hostMap`)** 에서 `enabled`인 호스트에만 주입 (개발자 신호 유출 방지, §4.3)
- **`ext.tokens` 설정 시**: 값이 `"1"` 고정이 아니라 서버 `ext.tokens` 항목 중 하나와 정확히
  일치해야 한다(`hash_equals`). `ext.tokens` 미설정(기본값 `[]`)이면 기존처럼 헤더 존재 여부만으로
  협상된다(하위호환) — 확장은 옵션 페이지(또는 팝업)에서 호스트별 토큰을 `hostMap[host].token`
  (없으면 전역 토큰)으로 설정하고, 헤더 값을 `"1"` 대신 그 토큰으로 주입해야 한다.
- **복수 토큰 (`ext.tokens`)**: 팀원별로 서로 다른 토큰을 발급하고 싶을 때 사용하는 배열 설정.
  각 항목은 `token`(필수) + `label`(선택, 식별용 — 로깅/노출에는 아직 미사용) + `ip`(선택, `REMOTE_ADDR`
  정규식)로 구성된다. `ip`를 지정한 토큰은 헤더 값 일치에 더해 요청 IP가 그 패턴에도 매치해야
  유효하다 — 예: 재택 IP가 유동적인 팀원에게는 `ip` 없이 토큰만 발급하고, 고정 IP 팀원에게는
  `ip`로 한 번 더 조인다.

### 2.2 응답 헤더 (서버 → 확장)

```
X-Nova-Debug-Id: 260712_014215_3956137818287cf6
```

- `Id`: 요청 식별자. `date('ymd_His')` + `_` + `bin2hex(random_bytes(8))`(16자 hex, 추측 불가). 형식: `\d{6}_\d{6}_[0-9a-f]{16}`
- 헤더 전송 시점: `DebugCollector::init()` 에서 즉시 전송 (id는 init 시점에 확정됨). `headers_sent()` 이면 해당 요청은 헤더 미전송으로 종료 — 주석 마커 폴백은 보류 확정(§7), initExt 조기 전송으로 실패 조건이 사실상 소멸
- **`X-Nova-Debug-Fetch` 헤더는 제거됨(2026-07-12)**. 조회 URL을 응답 헤더로 노출하던 방식은
  서버 내부 경로 정보 유출이라 판단해 폐기 — 확장은 자체 설정(기본 경로 + origin별 오버라이드)으로
  `{log.apiUrl}` 경로를 직접 구성한다(§2.3). **확장 측 구현 완료(2026-07-12)**: `lib/protocol.js`의
  `effectiveFetchPath()`/`effectiveToken()`, options/popup의 전역·origin별 설정 UI, 헤더 주입
  토큰화(§4.3) 참조.

### 2.3 조회 엔드포인트

```
GET {log.apiUrl}?fetch={id}
→ 200 application/json  (저장된 디버그 JSON 원본)
→ 403 (isAllowed() 실패 또는 ext.tokens 불일치)
→ 404 (만료/없음/id 형식 불일치)
```

- 기존 `assets/log.php` 에 `fetch` 액션 추가 (신규 파일 없이 기존 apiUrl 재사용)
- 인증: `Debug::isAllowed()` (전역 IP) **AND** `Debug::isExtTokenValid()` (`ext.tokens`
  설정 시 요청 헤더 `X-Nova-Debug` 값이 토큰과 `hash_equals` 일치해야 함 — 항목에 `ip`가
  있으면 그 토큰은 `REMOTE_ADDR`이 해당 패턴에도 매치해야 함) + `Debug::isEnabled()` 게이트.
  미설정이면 기존처럼 IP만으로 통과(하위호환) — id 추측 공격 차단이 목적이므로
  운영에서는 `ext.tokens` 설정을 권장한다.
- **토큰 게이트는 `fetch` 액션 전용이 아니라 `log.php` 최상단(2026-07-12)**: `isEnabled`/`isAllowed`
  바로 다음에 `isExtTokenValid()` 를 적용해 로그 뷰어 액션(`action=list`/`read`)까지 포함한 전체
  진입점이 토큰 필수가 된다. `Debug::hasExtToken()`(`ext.tokens` 설정 여부)이
  false면 `isExtTokenValid()` 가 자동으로 true 를 반환해 기존 동작 그대로 통과(하위호환).
- **토큰 쿠키 폴백(2026-07-12)**: `isExtTokenValid()`는 요청 헤더(`X-Nova-Debug`) 값을 먼저 검사하고,
  헤더가 없거나 불일치하면 토큰 쿠키(신규 설정 `ext.tokenCookie`, 기본값 `NOVA_DEBUG_TOKEN` — 기존
  `cookieName`(`DO`, 디버그바 표시 여부용)와는 용도가 다른 별개 쿠키)의 값으로 동일 검증(`ext.tokens`
  의 `ip` 패턴 조임 포함)을 재시도한다. 헤더 우선, 쿠키는 확장이 헤더를 주입할 수 없는 브라우저
  직접 접속(비-확장 경로) 전용 보조 수단이다. `log.php`는 최상단에서 `isExtTokenValid()`를 그대로
  호출하므로 쿠키 폴백이 코드 변경 없이 자동 적용된다.
- CORS 불필요: background가 host_permissions 로 fetch (확장 권한이 CORS 우회)

#### 2.3.1 토큰 쿠키 직접 설정 (확장 없이 브라우저 직접 접속)

확장을 설치하지 않고 브라우저로 직접 접속(헤더를 보낼 수 없는 경로)해도 토큰 검증을 통과시키려면
DevTools 콘솔에서 토큰 쿠키를 직접 심는다. 서버는 이 쿠키를 심어주지 않는다 — 심어주면 그 자체가
토큰 배포 경로가 되어 유출 위험이 커지기 때문에, 개발자가 알고 있는 토큰 값을 스스로 설정해야 한다.

```js
document.cookie = 'NOVA_DEBUG_TOKEN=<발급받은 토큰 값>'
```

- 쿠키명은 `ext.tokenCookie` 설정값(기본 `NOVA_DEBUG_TOKEN`)을 따른다 — 디버그바 표시 여부용 기존
  `cookieName`(`DO`)과는 별개이므로 혼용하지 않는다.
- 보안 주의: HTTP(비-HTTPS) 사이트에서는 쿠키 값이 네트워크상 평문으로 전송된다. 신뢰할 수 있는
  네트워크에서만 사용하고, 공용/외부 네트워크에서는 피한다.

### 2.4 저장

- 파일: `{log.dir}/ext.{id}.json` — 요청당 1파일
- 기존 `DebugLog::cleanup()` 채널에 `ext` 추가, lifetime은 신규 설정 `ext.lifetime` (기본 1800초)
- 내용: `DebugAnalyzer::analyze()` 결과 JSON (v1 표준 스키마 — SCHEMA.md/schema/debug-payload.v1.schema.json 참조)
- 최상위 `schemaVersion: 1` (2026-07-12 스키마 표준화 완료, §9). 패널은 v1 네이티브 소비, 확장은 `schemaVersion !== 1`이면 Raw 탭+경고로 우아하게 처리

---

## 3. 서버 측 변경 (Nova/debug)

### 3.1 Debug.php — 설정 추가

```php
// ext — 브라우저 확장 연동
'ext.enabled'       => true,
'ext.requestHeader' => 'X-Nova-Debug',      // HTTP_X_NOVA_DEBUG
'ext.idHeader'      => 'X-Nova-Debug-Id',
'ext.tokens'        => [],                  // 기본 [] = 미설정(IP만으로 opt-in, 하위호환)
                                             // 복수 토큰: [['token'=>'...', 'label'=>'daddy', 'ip'=>'/^192\.168\./'], ...]
'ext.tokenCookie'   => 'NOVA_DEBUG_TOKEN',  // 헤더 미일치/부재 시 폴백 검증에 쓰는 쿠키명(§2.3.1)
'ext.lifetime'      => 1800,
```

```php
public static function isExtensionMode(): bool
// ext.enabled && isset($_SERVER['HTTP_X_NOVA_DEBUG']) && isExtTokenValid() && isAllowed()

public static function isExtTokenValid(): bool
// 요청 헤더 값으로 먼저 검사(ext.tokens 항목 중 하나라도 hash_equals 매치 && (ip 미지정 또는
// REMOTE_ADDR이 ip 패턴 매치)면 true).
// 헤더가 미일치/부재면 ext.tokenCookie 쿠키 값으로 동일 검증 재시도(§2.3.1).
// ext.tokens가 미설정이면 true(하위호환)

public static function isInlineFallbackAllowed(): bool
// ext.only=true면 무조건 false. 그 외엔 (토큰 미설정 || isExtTokenValid()) && !isExtensionMode()
// — 토큰 설정 서버라도 유효한 토큰 쿠키가 있으면 비-확장 브라우저에서 인페이지 폴백 허용
```

### 3.2 DebugCollector::init() — 모드 분기 추가

```
ext 모드일 때:
  $log = true, $output = false        // 저장만, 인페이지 출력 없음
  id = date('ymd_His') . '_' . bin2hex(random_bytes(8))  // 16자 hex, 고정 길이
  X-Nova-Debug-Id 응답 헤더 전송 (headers_sent() 가드)
비-ext 모드: 기존 분기 그대로 (변경 없음)
```

### 3.3 DebugRenderer — 저장 경로 추가

- `printDebugOutput()`: ext 모드 시 `logOutput()` 대신 `extOutput()` — `ext.{id}.json` 에 JSON 기록 (streaming 방식 재사용)
- `error()` / `redirect()`: ext 모드에서도 데이터는 저장 + 헤더 전송. 화면 출력은 유지 (에러 화면은 사용자에게 보여야 함). 패널에는 ERROR/REDIRECT 행으로 강조 표시

### 3.4 assets/log.php — fetch 액션 추가

```
?fetch={id} → isEnabled/isAllowed/isExtTokenValid 검사 → {log.dir}/ext.{id}.json 반환
id 검증: /^\d{6}_\d{6}_[0-9a-f]{16}$/ (경로 조작 차단, 고정 길이)
```

### 3.5 debug.js — v1 스키마 소비 (폴백 유지)

- 스키마 v1 전환(2026-07-12)에 따라 `normalizeDebugPayload()` 내부 어댑터로 v1을 소비 — 렌더 로직·화면 결과는 기존과 동일

---

## 4. 확장 구조

### 4.1 디렉터리

```
debug/
├── manifest.json            # Chrome MV3 기준
├── manifest.firefox.json    # Firefox 차이분 (build.sh가 병합)
├── build.sh                 # chrome zip / firefox xpi 패키징
├── DESIGN.md / SCHEMA.md / CHANGELOG.md
├── lib/
│   └── protocol.js          # 헤더명·메시지 타입·hostMap 유틸(마이그레이션 포함) 상수
│                             # (폴리필 미사용 — 양쪽 브라우저 모두 promise 기반 MV3 API 직접 사용, §4.2)
├── background/
│   ├── main.js              # 패널 연결 관리, fetch 프록시
│   └── header-inject.js     # 헤더 주입 (브라우저별 구현 분기)
├── devtools/
│   ├── devtools.html        # devtools_page
│   └── devtools.js          # panels.create('Nova Debug', ...)
├── panel/
│   ├── panel.html
│   ├── panel.js             # 요청 목록 + 상세 뷰 컨트롤러
│   ├── panel.css
│   └── renderer/            # debug.js 에서 이식한 렌더 코어
│       ├── sql-formatter.js
│       ├── row-renderer.js    # dump/trace 행 렌더링 + PIN/LOOP/DUP/SLOW 필터, 복사
│       ├── query-renderer.js  # Queries 탭(순서기준/테이블별) 렌더링
│       ├── timeline.js
│       ├── json-view.js       # Raw 탭 JSON 트리 뷰 + 전체 복사
│       └── ide-link.js        # phpstorm:// 등 IDE 링크 생성
├── popup/
│   ├── popup.html           # 현재 사이트 on/off + IDE 매핑 간이 편집
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html         # 호스트 테이블(hostMap) 통합 관리 + 테마/토큰 등 전역 설정
│   └── options.js
├── icons/                   # 16/32/48/128
└── schema/
    └── debug-payload.v1.schema.json
```

### 4.2 manifest 전략

- **양쪽 모두 MV3** (Firefox 115+ MV3 안정 지원, 기존 downloader의 strict_min_version 과 동일선. Firefox는 `browser_specific_settings.gecko.id`/`strict_min_version` 추가 필요)
- Chrome: `background.service_worker` (단일 파일, `importScripts` 로 protocol.js 등 로드) / Firefox: `background.scripts` 배열(`lib/protocol.js`, `background/header-inject.js`, `background/main.js` 순, event page) — build.sh 가 `manifest.firefox.json` 을 `manifest.json` 자리에 교체하는 방식으로 병합
- 공통 키 (양쪽 manifest 동일):

```json
{
  "manifest_version": 3,
  "devtools_page": "devtools/devtools.html",
  "action": { "default_popup": "popup/popup.html", "default_icon": { "...": "icons/icon*.png" } },
  "icons": { "16": "icons/icon16.png", "32": "...", "48": "...", "128": "..." },
  "permissions": ["storage", "scripting", "clipboardWrite"],
  "host_permissions": ["<all_urls>"],
  "options_ui": { "page": "options/options.html", "open_in_tab": true }
}
```

- 브라우저별 추가 permissions: Chrome은 `declarativeNetRequestWithHostAccess`(세션 규칙 헤더 주입), Firefox는 `webRequest`+`webRequestBlocking`(§4.3)
- `host_permissions: ["<all_urls>"]` 는 실제로는 옵션(hostMap)에서 `enabled`인 호스트에만 헤더 주입/fetch 가 동작하도록 코드에서 제한. (optional_host_permissions 로 좁히는 안은 Phase 3 검토 후 보류 — Firefox는 팝업의 사이트 토글 ON 시점에 `permissions.request` 로 개별 origin 요청, §4.3/팝업 참조)

### 4.3 헤더 주입 — 브라우저별 분기

| | Chrome | Firefox |
|---|---|---|
| 방식 | declarativeNetRequest **session rule** (`condition.tabIds`) | `webRequest.onBeforeSendHeaders` (blocking) |
| 활성화 | 패널 open 시 rule 추가, close 시 제거 | 패널 open 시 listener 등록 (tabId 필터) |

- Firefox MV3의 DNR은 `tabIds` 조건 미지원 이슈가 있어 webRequest blocking(Firefox는 MV3에서도 지원) 사용
- `header-inject.js` 가 두 구현을 감싸서 background/main.js 에는 `enable(tabId)/disable(tabId)` 만 노출
- **주입 값 토큰화(2026-07-12)**: `ext.tokens` 도입에 따라 정적 값 `"1"` 고정 대신 host별 유효
  토큰(`tokenForHost()`)을 주입한다. Chrome DNR은 탭당 rule 1개 고정 대신, 탭당 rule id 블록
  (`DNR_RULE_ID_BASE + tabId*100` ~ `+99`)을 예약해 **토큰 값이 같은 host끼리 그룹화 → 그룹당
  rule 1개**로 생성한다(대부분 전역 토큰 하나뿐이라 사실상 기존과 동일하게 rule 1개). Firefox
  webRequest 폴백은 `hostMap`(호스트별 enabled/토큰 오버라이드)과 전역 토큰 캐시를 유지해 요청마다
  host에 맞는 토큰 값을 헤더에 설정한다.
- **저장소 모델 통합(2026-07-12)**: 종전 `hostAllowList`(허용 origin 배열) + `ideMap`(origin별 IDE
  매핑) 이원 관리를 단일 `hostMap`(hostname → `{enabled, protocol, localPath, project, fetchPath,
  token}`)으로 통합했다. 키는 스킴·포트 없는 hostname만 사용(Chrome DNR `requestDomains`가 host
  기준인 것과 정합). 레거시 키는 `lib/protocol.js`의 `migrateToHostMap()`이 최초 로드 시 1회
  변환해 `hostMap`에 저장하며, 이후에는 읽지 않는다(레거시 키 자체는 롤백 여지를 위해 삭제하지
  않음).

### 4.4 패널 라이프사이클 & 메시지 흐름

```
panel open
  → port = runtime.connect({name:'nova-debug'})  + {tabId: devtools.inspectedWindow.tabId}
  → background: enable(tabId)
panel: devtools.network.onRequestFinished(req)
  → req.response.headers 에서 X-Nova-Debug-Id 탐색 (응답 헤더 협상은 이 1개로 통일)
  → 조회 URL = effectiveFetchPath(요청 origin) + ?fetch={id}  (확장 자체 설정으로 구성, §2.2)
  → port.postMessage({type:'fetch', url, headerValue: effectiveToken(origin)})
    → background fetch (X-Nova-Debug 토큰 헤더 첨부) → JSON 응답
  → 패널 목록에 행 추가 (method, url, status, 시간, 쿼리수, 경고수)
panel close / port disconnect
  → background: disable(tabId), 미사용 rule/listener 정리
```

- 페이지 내비게이션 시: 목록 유지(누적) + "Preserve log" 토글 (Network 탭과 동일 UX)

### 4.5 패널 UI

```
┌──────────────────────────────────────────────────┐
│ [🗑 clear] [☑ preserve] [filter____] [PHP·T·M] │
├──────────────┬───────────────────────────────────┤
│ 요청 목록     │ 상세 (선택 요청, 헤더에 PHP·T·M 요약)│
│ GET /order   │ ┌ Tabs ─────────────────────────┐ │
│ POST /api/.. │ │ Dumps │ Queries │ Files │      │ │
│ ...          │ │        Timeline │ Raw          │ │
│              │ └───────────────────────────────┘ │
│              │  - Dumps: label/type/dump/trace,  │
│              │    PIN/LOOP/DUP/SLOW 필터 칩       │
│              │    (기존 d-row 렌더링 이식)        │
│              │  - Queries: SQL 포맷팅+EXPLAIN,    │
│              │    slow/tooMany 경고 강조          │
│              │  - trace 파일 → phpstorm:// 링크   │
└──────────────┴───────────────────────────────────┘
```

- 데이터 스키마는 `window.__debugData` 와 동일하므로 debug.js 의 렌더 로직(SQLFormatter, trace HTML, timeline)을 renderer/ 로 이식
- 테마: `devtools.panels.themeName` 연동 (기존 DT 쿠키 auto/light/dark 로직 대체)
- IDE 링크: 기존 `getIdeLink()` 로직을 JS로 이식. 서버는 `ide.serverPath` 만 meta 로 전달(미설정 시 생략), `localPath`/`project`/`protocol` 은 확장 옵션의 **호스트 표(hostMap)** 에서 설정 — 로컬 개발 환경이 개발자마다 다르기 때문. 옵션 페이지는 호스트 허용 여부(enabled)와 IDE 매핑을 한 표에서 함께 관리한다(2026-07-12 통합, §4.3)

---

## 5. 코드 공유 전략 (debug.js ↔ panel renderer)

### 5.1 Phase 1–2: 복사 이식

- debug.js 는 그대로 두고, 렌더 코어(SQLFormatter, row/trace/timeline 렌더링)를 panel/renderer/ 로 이식
- 이 시점의 이중화는 허용 (패널 UI는 목록형이라 어차피 구조가 다름)

### 5.2 Phase 3: 코어 분리 (선택)

- `Nova/debug/assets/` 를 `debug-core.js`(순수 렌더 함수) + `debug-page.js`(Shadow DOM 부트스트랩) 로 분리
- 확장 build.sh 가 debug-core.js 를 복사해 번들 → 단일 소스 유지
- 분리 비용 대비 실익을 Phase 2 종료 시점에 재평가

---

## 6. 보안

| 항목 | 대응 |
|---|---|
| 조회 endpoint 무단 접근 | `Debug::isEnabled()` + `isAllowed()` (전역 IP) + `isExtTokenValid()` (`ext.tokens` 설정 시) — id 추측만으로는 조회 불가 |
| 토큰 설정 시 비-확장 경로 우회 열람 | `ext.tokens` 가 설정되면(`Debug::hasExtToken()`) 인페이지 폴백(`isInlineFallbackAllowed()`)과 `log.php` 의 로그 뷰어 액션(list/read)까지 포함한 모든 디버그 표면에 토큰이 필수가 된다 — 헤더 없이 브라우저로 직접 접속해 IP 게이트만으로 디버그 데이터를 열람하던 경로 차단(2026-07-12) |
| 토큰 설정 서버 + 확장 미설치 브라우저 접속 | 토큰 쿠키(`ext.tokenCookie`, 2026-07-12)를 직접 설정하면 헤더 없이도 `isExtTokenValid()` 통과 → 인페이지 폴백/로그 뷰어 열람 가능. `ext.only=true` 면 쿠키가 있어도 인페이지 폴백은 항상 차단(확장 전용 강제). 쿠키는 서버가 심어주지 않고 개발자가 브라우저에서 직접 설정해야 하며, HTTP(비-HTTPS) 사이트에서는 쿠키 값이 평문으로 전송되니 신뢰할 수 있는 네트워크에서만 사용한다 |
| 토큰 유출 시 확산 범위 | `ext.tokens`로 팀원별 토큰 분리 발급 가능. 특정 토큰에 `ip` 정규식을 지정하면 그 토큰은 고정 IP에서만 유효 — 유출돼도 다른 네트워크에서는 통과 불가 |
| id 추측 | `bin2hex(random_bytes(8))` 16자 hex 접미사(고정 길이), 파일명 정규식 검증, 조회 자체가 IP AND 토큰 이중 게이트 |
| 경로 조작 | id 형식 화이트리스트 (`\d{6}_\d{6}_[0-9a-f]{16}`), `log.dir` 밖 접근 불가 |
| 디버그 파일 잔존 | ext 채널 cleanup, `ext.lifetime` (기본 30분) |
| 개발자 신호 유출 | 헤더 주입을 옵션의 허용 호스트로 제한 |
| 서버 내부 경로 노출 | 조회 URL을 응답 헤더로 노출하지 않음(`X-Nova-Debug-Fetch` 제거, 2026-07-12) — 확장이 자체 설정으로 경로 구성 |
| 운영 환경 노출 | `ext.enabled` + 기존 `enabled` 이중 게이트 + `ext.tokens` 설정 시 IP 유출만으로는 협상 불가 (운영은 어차피 debug off) |

---

## 7. 단계별 계획

### Phase 1 — 프로토콜 + 골격 (E2E 관통) ✅ 완료 (2026-07-11)
- 서버: ext 모드 분기, 응답 헤더, ext.{id}.json 저장, log.php fetch 액션
- 확장: manifest(양 브라우저) + devtools 패널 생성 + 헤더 주입 + 요청 목록 + raw JSON 뷰
- 검증: nova_builder 로컬에서 GET/POST/AJAX 각각 패널 수신 확인, 확장 off 시 기존 동작 무변화 확인
- 실환경 트러블슈팅 이력 (원인·수정 모두 반영 완료):
  1. ext 헤더 미전송 — init()이 shutdown 단계라 headers_sent. → `DebugCollector::initExt()` 조기 초기화를 부트스트랩(configure 직후)에서 호출
  2. log.php 부트스트랩 require 실패 — dirname(SCRIPT_FILENAME,3)이 이 배포(docroot=public+symlink)에서 오지정. → realpath(`dirname(__DIR__,2)`) 폴백
  3. allowedIps 에 현 개발망(192.168.64.1) 누락 → 추가
  4. MV3 서비스워커 유휴 종료로 패널 port 단절("disconnected port object") → fetch를 one-shot sendMessage 로, port 자동 재연결, 워커 기동 시 잔존 DNR rule 정리
  5. AJAX 요청 저장 실패(404) — 기존 잠복 버그: facade에 `getDebugDataForJson()` 위임 누락으로 debug 모드 AJAX 응답이 fatal → terminate 미도달. → facade 위임 복원 + ext 모드에선 `__debug__` 본문 임베드 생략

### Phase 2 — 렌더러 이식 ✅ 완료 (2026-07-11)
- Dumps/Queries/Files/Timeline/Raw 탭(Summary는 별도 탭 대신 상세 헤더 컴팩트 요약 `PHP·T·M`로 통합, §4.5), SQL 포맷팅, trace, IDE 링크(도메인별 매핑 옵션), 테마 실시간 연동
- error/redirect 행 강조, 요청 목록 뱃지(Q/W/ERR/RDR)
- 사용자 피드백 3라운드 반영: 목록/상세 스플리터(비율 storage 저장), 행 클릭=pin(trace 표시) 통합·+/-=trace 펼침, QUERY 선택 시 포맷 표시(CSS inline↔block+pre), Queries 탭=간결 목록+[순서기준|테이블별] 토글(EXPLAIN 제거), PIN·LOOP·DUP 필터 칩 + PIN reset, Timeline 레인 분리 배치(grid dense)+hover SQL 레이어+단계 배경 (zoom 은 제거 확정 — 스플리터·hover 레이어가 대체)

### Phase 3 — 편의 기능 + 배포 ✅ 완료 (2026-07-11)
- 요청 목록 컬럼 정리(status·id 제거 → 시각/method/URL/뱃지), 뱃지 툴팁, 요청 목록 필터 입력
- 옵션 페이지: 호스트 허용 목록 — **opt-in 정책** (등록된 origin 에만 헤더 주입, 비어 있으면 미주입 — Chrome DNR requestDomains / Firefox 리스너 대조, storage 변경 즉시 반영). 팝업의 사이트 스위치 토글 = 허용 목록 멤버십 (ON 시 Firefox host permission 요청 포함). ※ 초기엔 "비면 전체 허용"이었으나 사용자 확정으로 opt-in 전환 (2026-07-11). **이후 저장소 모델이 `hostMap`(호스트→`{enabled, ...}`)으로 통합되며(§4.3) "허용 목록"은 `hostMap[host].enabled` 플래그로 대체됨 — opt-in 정책 자체는 동일하게 유지**
- build.sh 패키징 (chrome zip / firefox xpi) — Phase 1 에서 구현 완료
- 후속 라운드: SLOW 필터 칩(slowCount/slowTime 원본 판정), **수집 계층을 devtools_page 로 이관** (DevTools 오픈 즉시 ext 모드 전환 + 패널 미선택 중 요청 버퍼링 → 첫 표시 시 목록 반영), IDE 링크 클릭을 inspectedWindow.eval 로 실행 (devtools 패널의 커스텀 프로토콜 차단 우회)
- 후속 라운드 2: Firefox 패널 경로 수정(`panels.create` 는 루트 절대경로 필수 — FF 는 devtools_page 기준 해석), 툴바 action + 팝업(사이트 스위치 토글·IDE 매핑 간이 편집·⚙ 설정), protocol 직접입력(+비표준 프로토콜 URL 형식 버그 수정), **fetch 폴백** — background fetch 실패 시 `scripting.executeScript` 로 inspected 페이지 컨텍스트에서 재시도 (Firefox NetworkError 대응, 페이지 same-origin 이라 CORS/권한 무관)
- ~~headers_sent 폴백(주석 마커)~~ **보류 확정**: initExt 조기 전송으로 실패 조건이 사실상 소멸 — 실사용 미수신 사례 발생 시 재검토
- ~~debug-core.js 공유 리팩토링~~ **분리 유지 확정**: 패널 렌더러가 탭/레인 구조로 크게 분화 — debug.js 는 확장 미설치 폴백으로 동결 유지

---

## 8. 확정 사항 (2026-07-11)

1. **IDE 설정**: 서버는 meta 에 `ide.serverPath` 만 전달 (선택적, 불필요 판명 시 제거 가능). `localPath`/`project`/`protocol` 은 확장 옵션의 도메인별 매핑으로 설정
2. **백필**: 패널 열기 전 요청은 기존 jsonl 로그 뷰어로 커버 (확장에서 별도 백필 없음)
3. **배포**: 수동 설치(zip/xpi) 기준. 스토어 배포는 효용성 검증 + JSON 스키마 표준화(§9) 이후 재검토

---

## 9. 서브 프로젝트: JSON 스키마 표준화 / 라이브러리 범용화

스토어 배포·타 프레임워크 확산의 전제 조건. **Phase 2 완료 후 착수** — 실사용에서 필드 구성이 검증된 뒤 스펙을 고정해야 재작업이 적다.

- **스펙 문서**: 프레임워크 중립 디버그 페이로드 v1 — 요청 meta + entries 배열, entry 타입(dump/query/error/timeline/files) 정의, required/optional 구분, 벤더 확장은 `x-` prefix — ✅ 완료 (`SCHEMA.md`)
- **JSON Schema 파일**: 기계 검증 가능하게 작성, 확장·서버 양쪽 테스트에 사용 — ✅ 완료 (`schema/debug-payload.v1.schema.json`)
- **서버 어댑터 계층**: Collector 결과 → payload 변환부를 인터페이스로 분리, Nova = 레퍼런스 구현. 2번째 구현(예: PSR-15 미들웨어)으로 범용성 검증 — 후속(미착수), 실사용 축적 후 재검토
- **패키징**: composer 패키지화 검토 (framework-agnostic — QueryDriver 분리 구조가 좋은 출발점) — 후속(미착수)
- **선례 연구**: Clockwork metadata 포맷, PHP DebugBar collectors — ✅ 완료 (`COMPARISON.md`)
- 저장 JSON은 최상위 `schemaVersion: 1`을 심어 v0/v1 구분(§2.4) — 스펙 문서·JSON Schema 완료로 v1이 고정 스펙이 되었고, 서버 어댑터 계층·composer 패키징은 스토어 배포 시점에 재검토 대상으로 남음(§8-3)
