#!/usr/bin/env sh
# A Maestro flow failed (4.8): keep what the screen held and what the app
# said, then carry on so the other flows still run. The app blocks
# screenshots (FLAG_SECURE), so the view tree is the evidence.
name="$1"
touch "$name-failed"
adb shell uiautomator dump /sdcard/ui.xml </dev/null >/dev/null 2>&1 && adb pull /sdcard/ui.xml "ui-$name.xml" </dev/null >/dev/null 2>&1
adb logcat -d -s ReactNativeJS:V ReactNative:V </dev/null > "rn-$name.log" 2>/dev/null
grep -o 'content-desc="[^"]*"\|resource-id="[^"]*"' "ui-$name.xml" 2>/dev/null | head -60 || true
# A flow that failed in airplane mode leaves the emulator there: the next
# flow starts connected, or it fails for this one's reason (run 36150521107).
adb shell cmd connectivity airplane-mode disable </dev/null >/dev/null 2>&1 || true
exit 0
