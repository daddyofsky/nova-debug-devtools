#!/bin/bash
# Nova Debug 확장 패키징 스크립트 (Chrome zip / Firefox xpi)
# 사용법: ./build.sh [output_dir]
#
# manifest.json(Chrome)과 manifest.firefox.json(Firefox)을 각각 스테이징 디렉터리에
# 복사해 압축한다. Firefox 빌드는 manifest.firefox.json 을 manifest.json 자리에 넣는다.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/release}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
STAGE_DIR="$(mktemp -d)"

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$SCRIPT_DIR/manifest.json" | head -1)"
if [ -z "$VERSION" ]; then
  echo "manifest.json 에서 version 을 읽지 못했습니다" >&2
  exit 1
fi

CHROME_ZIP="$OUT_DIR/nova-debug-chrome-$VERSION.zip"
FIREFOX_XPI="$OUT_DIR/nova-debug-firefox-$VERSION.xpi"

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

copy_source() {
  local dest="$1"
  mkdir -p "$dest"
  rsync -a \
    --exclude ".git" \
    --exclude ".idea" \
    --exclude ".mg" \
    --exclude ".DS_Store" \
    --exclude "/test" \
    --exclude "/release" \
    --exclude "DESIGN.md" \
    --exclude "build.sh" \
    --exclude "manifest.firefox.json" \
    --exclude "*.zip" \
    --exclude "*.xpi" \
    "$SCRIPT_DIR/" "$dest/"
}

# Chrome 패키징
rm -f "$CHROME_ZIP"
CHROME_STAGE="$STAGE_DIR/chrome"
copy_source "$CHROME_STAGE"
(cd "$CHROME_STAGE" && zip -r -X "$CHROME_ZIP" . -x '.*' >/dev/null)
echo "Built: $CHROME_ZIP ($(du -sh "$CHROME_ZIP" | cut -f1))"

# Firefox 패키징 (manifest 교체)
rm -f "$FIREFOX_XPI"
FIREFOX_STAGE="$STAGE_DIR/firefox"
copy_source "$FIREFOX_STAGE"
cp "$SCRIPT_DIR/manifest.firefox.json" "$FIREFOX_STAGE/manifest.json"
(cd "$FIREFOX_STAGE" && zip -r -X "$FIREFOX_XPI" . -x '.*' >/dev/null)
echo "Built: $FIREFOX_XPI ($(du -sh "$FIREFOX_XPI" | cut -f1))"
