# Nova Debug DevTools Extension

서버의 디버그 출력(쿼리·덤프·트레이스·타임라인)을 브라우저 DevTools 안에서 요청별 패널로 조회하는 확장입니다. Chrome(MV3)과 Firefox를 모두 지원합니다.

특정 언어·프레임워크에 종속되지 않습니다. 서버가 표준 페이로드 스키마([SCHEMA.md](SCHEMA.md), [schema/debug-payload.v2.schema.json](schema/debug-payload.v2.schema.json))에 맞는 JSON을 생산하기만 하면 어떤 백엔드에서도 그대로 사용할 수 있습니다. PHP용 레퍼런스 구현으로 [nova-debug-php](https://github.com/daddyofsky/nova-debug-php)([`daddyofsky/nova-debug`](https://packagist.org/packages/daddyofsky/nova-debug))가 있습니다.

## 동작 방식

```
DevTools 패널 열림
  → 확장이 해당 탭 요청에 X-Nova-Debug: {token} 헤더 주입
  → 서버가 디버그 JSON을 저장하고 X-Nova-Debug-Id 응답 헤더로 식별자만 전달
  → 확장이 설정된 조회 endpoint 에서 JSON을 가져와 패널에 렌더링
```

- 요청 헤더가 있을 때만 확장 모드가 활성화되므로, 확장 미설치/패널 미사용 환경은 서버의 기존 동작(예: 인페이지 렌더링)이 그대로 유지됩니다.
- 조회 URL은 서버가 노출하지 않고 확장 설정(호스트별 오버라이드 + 기본 경로)으로 구성합니다.
- 서버측에는 접근 게이트(디버그 on/off + IP allowlist + 토큰 검증)를 두는 것을 권장합니다.

## 주요 기능

- **요청 목록** — method/URL/시간 컬럼, 쿼리 수·SLOW·ERROR·REDIRECT 뱃지, 필터, Preserve log
- **Dumps 탭** — PIN·LOOP·DUP·SLOW 필터 칩, trace 펼치기/접기
- **Queries 탭** — SQL 포맷팅, 순서/테이블별 보기, Duplicate·Loop·Slow 집계
- **Files / Timeline / Raw 탭** — 탭별 검색, JSON 트리 뷰, 전체 복사
- **IDE 딥링크** — trace 항목 클릭으로 PhpStorm/IDEA/VS Code 등에서 해당 라인 열기
- **테마** — DevTools 테마 연동(auto) / light / dark
- **캡쳐 제어** — 사이트별 on/off(툴바 아이콘 상태 표시), 패널 표시 중에만 캡쳐(기본) 또는 호스트별 "DevTools 열림 동안 항상 캡쳐", on/off 단축키

## 설치

[Releases](../../releases)에서 최신 버전을 받아 설치합니다.

- **Chrome**: `nova-debug-chrome-{version}.zip` 압축 해제 → `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램을 로드"
- **Firefox**: `nova-debug-firefox-{version}.xpi` → `about:addons` → 파일에서 부가 기능 설치

## 서버 연동

서버는 언어와 무관하게 다음 두 가지만 구현하면 됩니다.

1. **헤더 협상** — 요청 헤더 `X-Nova-Debug`(값 = 토큰)를 검증하고, 디버그 JSON을 저장한 뒤 응답 헤더 `X-Nova-Debug-Id`로 식별자를 반환
2. **조회 endpoint** — 식별자로 저장된 JSON(스키마 v2)을 반환

PHP는 레퍼런스 구현 [nova-debug-php](https://github.com/daddyofsky/nova-debug-php)가 둘 다 제공하므로 바로 사용할 수 있습니다.

```sh
composer require daddyofsky/nova-debug
```

**TODO** — 다른 서버 언어(Node.js, Python, Go 등)용 수집 라이브러리와 DB 환경별 쿼리 분석(EXPLAIN) 드라이버는 별도 개발이 필요합니다. 단, 확장 자체는 스키마 v2 JSON만 받으면 동작하므로 라이브러리 없이 직접 구현해도 무방합니다.

자세한 프로토콜과 페이로드 스펙은 [DESIGN.md](DESIGN.md)와 [SCHEMA.md](SCHEMA.md)를 참고하세요.

## 빌드

```sh
./build.sh   # release/ 에 Chrome zip + Firefox xpi 생성
```

## 문서

- [DESIGN.md](DESIGN.md) — 아키텍처·프로토콜 설계
- [SCHEMA.md](SCHEMA.md) — 페이로드 스키마 v2 스펙
- [CHANGELOG.md](CHANGELOG.md) — 릴리즈 이력

## License

[MIT](LICENSE)
