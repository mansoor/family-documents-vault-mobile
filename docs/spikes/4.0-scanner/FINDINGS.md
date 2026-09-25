# 4.0 Scanner spike — findings

A scan reaches the vault from the owner's phone: how fast, how well, and what
the phone's platform does underneath. Synthetic documents only.

## The kill criterion (written before the session)

A printed two-page letter on home Wi-Fi, five runs:

- **tap → pages accepted: median ≤ 10.0 s, worst ≤ 12.0 s.** That leaves at
  least 8 s of the exit's 20 for two taps on the card, the PDF and the upload.
- **Edges acceptable on at least 4 of the 5 reference documents:** the
  two-page letter, an ID-sized card, a glossy policy on a patterned table, a
  page in dim lamp light, a creased receipt.
- **The vault's OCR finds the expected words** on the letter and the policy
  (`ocr_status` done).

On a miss: try upstream `react-native-document-scanner-plugin` 2.0.4 and
`@dariyd/react-native-document-scanner` 2.1.1 inside the spike (a day at
most). If it is still a miss, stop and re-plan with the owner: VisionCamera
with OpenCV edge detection is about two weeks, not a quick swap.

## 1. The phone

_To fill in: model, Android version, RAM._

## 2. The documents

| Document | Edges | Deskew | Legible | OCR found |
| --- | --- | --- | --- | --- |
| Two-page letter | | | | |
| ID-sized card | | | | |
| Glossy policy, patterned table | | | | |
| Dim lamp light | | | | |
| Creased receipt | | | | |

## 3. Timing (five runs, the two-page letter)

| Stage | Median | Worst |
| --- | --- | --- |
| tap → scanner shown | | |
| scanner shown → pages accepted | | |
| **tap → pages accepted** | | |
| pages accepted → PDF built | | |
| PDF built → 201 | | |

PDF milliseconds, bytes per page: _to fill in._

## 4. Probes

| Probe | Result | What it decides |
| --- | --- | --- |
| P1 @fdv/shared under Hermes | | Found before the session: Metro does not map `./x.js` to `x.ts`, so the resolver shim in `metro.config.js` is in (Jest needs the same, a `moduleNameMapper`). The on-phone run checks Intl output. |
| P2 Web APIs | | |
| P3 Both upload variants answer 201 | | Which one the capture queue uses (4.4). |
| P4 SecureStore behind a fingerprint | | The lock's design (4.8). |
| P5 SecureStore, this device only | | |
| P6 SQLCipher | | The offline store (4.8, 4.10). |
| P7 Show mode's screen controls | | 4.11. |
| P8 Response bytes in the cache directory | | Whether Essentials' bytes can leak to disk unencrypted. |
| P9 Network and airplane mode | | 4.5's offline states. |
| P10 ML Kit's first use offline | | The failure copy for 4.4. |
| P11 Cold start in airplane mode | | |
| P12 Predictive back | | 4.15. |

Found before the session: Expo's `TextDecoder` decodes UTF-8 only.

## 5. CI

First builds, 24 Sep 2026, commit 17c81ad, ubuntu-latest (2 vCPU), no
Gradle or ccache cache yet (cold):

| Build | Minutes | APK |
|---|---|---|
| dev (debug, arm64) | 17.9 | 143 MB |
| preview (release, minified, arm64) | 20.7 | 53 MB |

Both run in parallel when a tag or a native change triggers them, so a
release costs about 39 runner minutes. Still to measure: the emulator
boot probe.

Warm, with the Gradle cache from those runs (v0.1.1, 24 Sep 2026): dev
19.4 minutes, preview 24.2 — no faster than cold, so the cache does not
pay for itself on a 2-vCPU runner and the budget stays at the cold
figures: GitHub Free's 2,000 private-repo minutes a month cover about 50
releases (both builds each), less what the check job uses.

## 6. ML Kit

_To fill in: what leaves the phone, and first-use behaviour._

## 7. Modules dropped

None so far: every module in the plan installs, and `expo-doctor` passes
21 of 21 checks with them.
