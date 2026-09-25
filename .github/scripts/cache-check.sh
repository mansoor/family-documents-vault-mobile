#!/usr/bin/env sh
# After the flows (4.8): no document page, picture or PDF sits in any of the
# app's HTTP or image caches. The emulator's google_apis image lets adb run
# as root, so the app's own folders can be read without making any build
# debuggable (which would also make React Native look for a dev server).
set -eu
APP=io.github.mansoor.familyvault.e2e
DATA=/data/data/$APP

adb root >/dev/null
adb wait-for-device
adb shell find "$DATA/cache" "$DATA/files" -type f 2>/dev/null | tr -d '\r' > app-files.txt || true
echo "The app's files after the flows:"
cat app-files.txt
test -s app-files.txt || { echo "nothing listed under $DATA: is adb root allowed on this image?"; exit 1; }

bad=""
while IFS= read -r f; do
  case "$f" in
    *http*|*okhttp*|*image_manager*|*expo-image*|*fresco*|*WebView*) ;;
    *) continue ;;
  esac
  head=$(adb shell head -c 4 "$f" | od -An -tx1 | tr -d ' \n')
  case "$head" in
    ffd8ff*|25504446*|89504e47*) bad="$bad $f" ;;
  esac
done < app-files.txt

if [ -n "$bad" ]; then
  echo "Document or picture bytes in a cache:$bad"
  exit 1
fi
echo "No document or picture bytes in any HTTP or image cache." >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
