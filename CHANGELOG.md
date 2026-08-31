# Changelog

이 문서는 Nova Debug DevTools 확장의 릴리즈 이력을 기록한다.

## [2.1.1] - 2026-08-31

### 개선

- 호스트(도메인) 지정에 와일드카드·정규식 패턴 지원 — `*.example.com`(자신 + 모든 서브도메인, match pattern 관례), 라벨 내 `*` glob(`dev-*.example.com`, `.` 제외 임의 문자), `/정규식/`(호스트명 전체 매칭). 정확한 hostname 항목이 패턴 항목보다 항상 우선하며, 아이콘 상태·헤더 주입(Chrome DNR/Firefox webRequest)·popup·panel(IDE 매핑, 오픈 캡쳐)·단축키 토글 전부에 적용. Chrome DNR은 `*.foo.com`을 `requestDomains`(서브도메인 자동 매칭)로, 그 외 패턴은 `regexFilter`로 등록하고 RE2 미지원 정규식은 제외 후 콘솔에 로그. popup·단축키로 패턴 매칭 사이트를 토글하면 패턴 항목은 건드리지 않고 해당 호스트의 정확 항목(패턴 설정 상속)으로 오버라이드

### 수정

- Firefox에서 `about:newtab` 등 새 탭이 활성화(진한) 아이콘으로 표시되던 문제 수정 — v2.1.0 아이콘 상태 기능 추가 시 `manifest.firefox.json`의 `action.default_icon`이 흐린(off) 아이콘으로 교체되지 않아, 탭별 `setIcon`이 닿지 않는 새 탭(미리 로드되어 `tabs.onUpdated`가 발화하지 않음)이 기본값인 진한 아이콘으로 남던 문제

## [2.1.0] - 2026-08-01

코드 리뷰로 드러난 v2 전환 이후의 안정성 문제를 수정했다.

### 보안

- Queries 탭 XSS 수정 — 테이블별/순서기준 뷰의 통계·행 렌더링에서 이스케이프 누락 필드(`table`/`time`/`count`/`maxIndex`/loop 그룹명 등) 전부에 `escHtml` 적용

### 안정성

- MV3 SW 재시작 시 popup/단축키로 켠(devtools 미등록) 탭의 헤더 주입이 사라지던 문제 수정 — `storage.session`에 대상 탭을 기록해두고 재시작 후 복원(`restorePersistedTabs`)
- DNR rule 갱신 직렬화 — `enableViaDnr`/`disableViaDnr`가 동시 호출되면 스냅샷-갱신 경합으로 rule이 유실될 수 있어 큐로 순서를 강제
- devtools 재연결 안정화 — REGISTER/PANEL_SHOWN 전송 실패 시 재연결 예약 경로로 전환, entries 트리밍 시 `ownFetchUrls` 누적 정리, `summary.queries`/`.slow`/`.files` 부재 방어

### 렌더링 성능

- 요청 목록 증분 렌더 — 신규 요청이 끝에 추가되는 경우 DOM 전체 재구성 대신 append만 수행
- Queries 탭 순서기준 뷰 지연 빌드 — 첫 진입 시 테이블별 뷰만 그리고 순서기준은 실제 전환 시점에 빌드
- 상세 영역 불필요한 재렌더 스킵 — 목록만 바뀐 notify에서 선택된 요청의 상세 내용이 그대로면 재렌더(깜빡임)를 건너뜀

### 수정

- `summary.queries.avg`/`.max` 단위 버그 수정 — 스키마상 초 단위인데 ms로 오인해 그대로 출력하던 문제, 표시 직전 `*1000` 변환 적용
- SQL 포매터 문자열 리터럴 처리 — 리터럴 내부의 따옴표/괄호/키워드가 절 분할·서브쿼리 추출 로직에 잘못 노출되던 문제 수정
- options/popup 설정 유실 방지 — 옵션 페이지는 편집 중 외부 변경을 조용히 덮어쓰지 않도록 dirty 추적 추가, popup은 로드 완료 전 토글/저장 비활성화 및 저장 실패 시 상태 롤백

### 테스트 인프라

- `test/validate-payload.py`에 format 검증 활성화 (`rfc3339-validator` 의존성 가드 포함) — 이에 맞춰 픽스처의 `meta.request.date`를 실제 RFC 3339 형식으로 정정

## [2.0.0] - 2026-07-17

### 페이로드 스키마 v2 승격 (breaking)

`meta.php` 제거가 breaking이라 스키마를 v2로 승격했다. 버전 정책 신설: **스키마 vN ↔ 확장 N.x.x** (v1=1.x.x, v2=2.x.x — SCHEMA.md §13). 확장은 v2 전용으로 동작하며 v1 페이로드는 "지원하지 않는 스키마 버전" 안내 + Raw 탭 확인으로 처리된다(v1 분기/폴백 없음). 서버 생산자(nova-debug-php)의 v2 전환 전까지는 구버전 서버와 조합 시 이 안내가 표시된다.

- 런타임 중립화 — `meta.php` 제거 → `meta.runtime{name,version}` + 최상위 `x-php{opcache}` 벤더 확장
- `entries[].type` 개방 구조 — enum(dump/query/array) → 소문자 패턴 문자열 + 알려진 타입별 if/then 검증. 미지 타입 소비 규칙(label+dump+trace generic 렌더)과 타입 등록 절차를 SCHEMA.md에 명문화
- `query.explain` 원시 구조 추가 — `format: table|text|json` 3형식으로 모든 DB 엔진 실행계획 수용. `explainHtml`은 deprecated 병행 유지
- 최상위 optional `request` 섹션 — method/status/contentType + GET/POST/쿠키/세션/요청·응답 헤더 + `route`/`handler`(라우트·핸들러 표시 문자열). 민감 키 마스킹(`"***"`)·truncate 규칙 명세
- `log`/`exception` entry 타입 — PSR-3 8레벨 + 예외 체인(previous) 구조화, `summary.logs{count,byLevel}` 집계 추가
- `query.bindings`/`query.connection` 추가 — prepared statement 파라미터 목록, 다중 DB 커넥션 구분 라벨
- `entries[].truncated` 추가 — dump가 생산자 측에서 truncate됐는지 표시
- 검증 도구 신설: `test/validate-payload.py`(jsonschema draft 2020-12) + positive/negative 픽스처 세트, 스키마 파일명 `debug-payload.v2.schema.json`으로 변경

### 패널 (v2 소비)

- 헤더 요약을 `meta.runtime` 기반으로 교체 (php → "PHP 8.5.1" 표기 유지, 타 런타임은 name 그대로)
- 미지 entry 타입 generic 렌더러 — 알려지지 않은 type은 label + dump + trace + 타입명 뱃지로 표시 (log/exception도 전용 렌더 전까지 이 경로)
- EXPLAIN 렌더 3형식 — `query.explain`의 table(기존 테이블 스타일)/text(pre)/json(pre) 렌더, `explainHtml`과 공존 시 explain 우선
- Queries 탭에 커넥션 뱃지·bindings 표시 추가 (`query.connection`/`query.bindings` 소비)
- Dumps 탭에 TRUNCATED 뱃지 추가 (`entries[].truncated` 소비)
- Files 탭 경로 하이라이트 복원 — `x-nova.fileHighlight`(경로 부분문자열 → 색상명) 소비, debug.js 와 동일한 10색 팔레트(라이트/다크). 링크 기본 스타일도 웹버전과 동일하게 조정(밑줄 제거, dim 색, hover 파랑)
- Raw 탭 JSON 토글 아이콘 폭 축소 — 한 글자 폭(12px)만 차지하고 토글 없는 리프 라인도 같은 폭으로 들여써 동일 레벨 항목이 정렬되도록 수정
- preview 하네스 `?fixture=` 픽스처 선택 지원 (test/fixtures/fixtures.js)

### 옵션 페이지

- 확장 이름/버전 헤더 표시 (manifest 기준) — 다크 테마에서는 흰색(invert) 아이콘으로 교체 표시
- 섹션 카드형 레이아웃으로 재디자인 — 패널과 동일한 `--nd-*` 변수 팔레트 공유, 하단 고정 저장 바
- 테마 설정을 옵션 페이지 자체에도 적용 (auto=OS 다크 모드, 라디오 선택 즉시 미리보기)

### 빌드

- 릴리즈 패키지에서 로컬 작업 문서(TODO.md·COMPARISON.md·PLAN-*.md) 제외 — 1.0.3 이하 zip/xpi에 포함되던 문제 수정

## [1.0.3] - 2026-07-17

### Queries 탭

- 기본 뷰를 순서기준 → 테이블별로 변경 (뷰 토글 버튼 순서도 테이블별 우선으로 정렬)

### Firefox

- manifest에 `data_collection_permissions` 선언 추가 — 데이터 수집 없음(`none`) 명시 (Firefox 부가 기능 배포 요구사항)

### 문서

- README 언어 중립화 — 특정 프레임워크 종속 표현을 제거하고 페이로드 스키마 v1 준수만으로 어떤 백엔드에서도 사용 가능함을 명시. PHP 레퍼런스 구현 [nova-debug-php](https://github.com/daddyofsky/nova-debug-php)의 Packagist 설치(`composer require daddyofsky/nova-debug`) 안내 추가

## [1.0.2] - 2026-07-15

### 캡쳐 트리거

- 캡쳐(헤더 주입)를 Nova Debug 패널 탭이 표시된 동안만 수행하도록 변경 — 패널을 보고 있지 않은 탭의 불필요한 서버 수집 제거
- 호스트별 "오픈 캡쳐"(`captureOnOpen`) 설정 추가 — 켜면 DevTools가 열려 있는 동안 항상 캡쳐. 옵션 페이지 호스트 테이블 또는 패널 툴바 "Always (DevTools open)" 체크박스에서 설정 (변경은 다음 DevTools 오픈부터 적용)
- 체크박스 hover/토글 시 현재 캡쳐 모드와 적용 시점 안내를 체크박스 왼쪽에 잠시 표시

### 단축키

- 현재 사이트 on/off 토글 단축키 추가 — Firefox `Cmd+F12`(Win/Linux `Ctrl+F12`), Chrome `Cmd+Shift+K`(Win/Linux `Ctrl+Shift+K`)
- 옵션 페이지 "단축키" 섹션 추가 — 현재 단축키 표시, Firefox는 페이지에서 직접 변경·기본값 복원, Chrome은 브라우저 단축키 설정 열기 버튼 제공

### 버그 수정

- Firefox: DevTools 재오픈 시 이전 세션의 캡쳐 상태가 남아 패널 표시 전부터 캡쳐되던 문제 수정
- Firefox: 패널 첫 화면에서 "Always (DevTools open)" 체크박스가 비활성으로 잘못 표시되던 문제 수정
- Firefox: 체크박스 토글 시 적용 시점 안내가 표시되지 않던 문제 수정

## [1.0.1] - 2026-07-13

### 툴바

- 사이트별 사용 여부에 따라 툴바 아이콘 구분 표시 — 켜진 사이트의 탭은 진한 기본 아이콘, 꺼져 있거나 지원하지 않는 페이지는 흐린 아이콘(`icons/icon*-off.png`). popup·옵션에서 on/off 변경 시 열린 탭 전체에 즉시 반영 (Firefox `tabs` 권한 추가)

### DevTools 패널

- DevTools 탭 아이콘 dark 테마 대응 — 테마가 dark면 흑백 반전 아이콘(`icons/icon*-invert.png`)을 사용해 어두운 탭 배경에서도 아이콘이 보이도록 수정 (아이콘은 DevTools 오픈 시점 테마 기준, 테마 변경 시 DevTools 재오픈 필요. Chrome은 패널 아이콘 미표시)
- Firefox에서 문서 요청 entry가 목록에 나타났다 바로 사라지는 버그 수정 — 내비게이션 시 목록 정리가 새 페이지의 entry(문서 + 후속 ajax)를 지우지 않도록 보존 (Chrome 동작 불변)
- Firefox에서 Preserve log 미사용 시 이전 페이지 요청이 새 요청 추가 후에야 뒤늦게 지워지던 문제 수정 — Chrome과 동일하게 내비게이션 커밋 시점에 즉시 정리 (Firefox `webNavigation` 권한 추가)

### 보안

- 서버 레거시 단일 토큰 설정 `ext.token` 제거 — 복수 토큰 `ext.tokens`([{token, label?, ip?}])로 통일 (서버측 `Nova/debug` 라이브러리 변경). 옵션 페이지·문서의 안내 문구도 `ext.tokens` 기준으로 정리

## [1.0.0] - 2026-07-12

최초 릴리즈. Chrome/Firefox DevTools 안에서 Nova Debug 서버 출력을 요청별 패널로 조회하는 확장.

### DevTools 패널

- 요청 목록: method/URL/시간(토글 가능) 컬럼 + 뱃지(쿼리 수, SLOW `S{n}`, ERROR, REDIRECT), 필터 입력(method/url), Clear, Preserve log(내비게이션 간 목록 유지)
- 상세 탭: Dumps / Queries / Files / Timeline / Raw — 각 탭 카운트 표시, Files/Queries 등은 탭별 검색 입력 지원
- 상세 헤더 요약: `PHP {version}` / `T {ms}` / `M {memory}` 컴팩트 표시
- Dumps 탭: PIN(행 클릭으로 고정)·LOOP·DUP·SLOW 필터 칩(개수 표시, PIN reset), +/- 로 trace 펼치기/접기
- Queries 탭: SQL 포맷팅, 순서기준/테이블별 보기 토글, DUP/LOOP 뱃지, Duplicate/Loop/Slow 집계 라인
- 행 단위 복사(📋)와 Raw 탭 JSON 전체 복사, JSON 트리 뷰(Raw 탭)
- trace 항목 → IDE 딥링크(phpstorm/idea/vscode 등)
- 테마: `auto`(DevTools 테마 연동)/`light`/`dark`

### 프로토콜

- 요청 헤더 `X-Nova-Debug`(값 = 토큰) 협상으로 서버가 확장 모드를 자동 인식 — 확장 미설치/패널 미사용 시 서버는 기존 동작(인페이지 렌더링) 그대로 유지
- 응답 헤더 `X-Nova-Debug-Id` 단일 헤더로 요청 식별자만 전달 — 조회 URL은 서버가 노출하지 않고 확장이 자체 설정(호스트별 오버라이드 + 기본 경로)으로 구성
- 표준 페이로드 스키마 v1 채택 (`SCHEMA.md`, `schema/debug-payload.v1.schema.json`) — 프레임(`frames[]`) dedup으로 trace 데이터 중복 제거, 구조화된 entry 타입(dump/query/array 등)

### 보안

- 토큰 인증: 공통 토큰(전역) + 호스트별 오버라이드, 옵션 페이지에서 자동 생성·복사 지원
- 서버는 팀원별 복수 토큰(`ext.tokens`, 토큰별 IP 조임) 및 토큰 쿠키 폴백을 지원 (서버측 `Nova/debug` 라이브러리 기능)

### 설정

- 옵션 페이지: 호스트 단일 테이블(`hostMap`) — on/off, IDE 매핑(protocol/localPath/project), fetch 경로, 토큰 오버라이드를 도메인만 입력해 한 번에 관리. 구버전 `hostAllowList`/`ideMap` 설정은 최초 로드 시 자동 마이그레이션
- 팝업: 현재 사이트 간이 설정(사이트 on/off, IDE 매핑) — HTTP(비-HTTPS) 사이트에는 평문 노출 경고
- Chrome "파일 열기 확인" 창 대응 안내(접이식) — macOS `defaults write` 명령과 Windows `.reg` 생성기를 옵션 페이지에서 바로 복사

### IDE 연동

- phpstorm/idea/vscode 및 커스텀 프로토콜 지원
- 숨김 iframe으로 프로토콜 링크 실행 (Firefox 방문 기록 초기화 회피)

### 배포

- Chrome + Firefox 양쪽 Manifest V3 지원
- `build.sh` 로 Chrome용 zip / Firefox용 xpi 패키징
