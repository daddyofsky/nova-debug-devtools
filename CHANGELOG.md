# Changelog

이 문서는 Nova Debug DevTools 확장의 릴리즈 이력을 기록한다.

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
