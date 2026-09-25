#!/usr/bin/env sh
# The kept Essentials' databases on the phone (4.10): "present" after they
# were kept, "absent" after the vault revoked the session. Read as root, as
# the cache check does.
set -eu
APP=io.github.mansoor.familyvault.e2e
adb root >/dev/null
adb wait-for-device
adb shell find "/data/data/$APP" -name 'essentials*' </dev/null 2>/dev/null | tr -d '\r' > essentials-files.txt || true
echo "Essentials files on the phone ($1 expected):"
cat essentials-files.txt
kept=$(grep -cE '/essentials(-private)?\.db$' essentials-files.txt || true)
case "$1" in
  present) test "$kept" -ge 1 ;;
  absent)
    test "$kept" -eq 0
    echo "A revoked session left no kept Essentials on the phone." >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    ;;
  *) echo "present or absent?"; exit 2 ;;
esac
