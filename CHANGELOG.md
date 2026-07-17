# Changelog

이 문서는 Nova Debug DevTools 확장의 릴리즈 이력을 기록한다.

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
