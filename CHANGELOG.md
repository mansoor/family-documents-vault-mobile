# Changelog

All notable changes to the Family Vault phone app. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the
app's own, tagged `vX.Y.Z` in this repository.

## [Unreleased]

## [0.1.6] — iteration 4.11: Show mode

### Added
- Show, on each Essential kept on the phone: the document full-screen on
  black, for somebody else to read — at a desk, a gate, a counter. The
  screen goes to full brightness and stays awake; the system bars are
  hidden; it is never captured. It turns with the phone, and a Turn button
  turns it anyway (many phones have auto-rotate off; ID cards are
  landscape). Previous and Next, Larger and Smaller, as well as swipe and
  pinch. Works with no connection; every show is told to the vault.
- Done, Back or a swipe down ends it, and so do going to the back and ten
  minutes. Ending it always leaves the app locked ("Unlock to carry on."),
  without the phone's own prompt, so whoever is holding the phone gets
  nothing more. The brightness is back before anything else; a brightness
  left by the app stopping while showing is put back at the next launch.
- "Tap Done, or press back, to finish." The controls fade after three
  seconds and come back with a tap — never while a screen reader is on.

### Tests
- show.test.tsx: brightness saved then full, restored on exit, background
  and unmount, and after a crash; keep-awake only while showing, out after
  ten minutes; Back to the lock screen; Done always reachable with a
  screen reader; buttons page, zoom and turn; a show records an open.
- Maestro show-mode.yaml: enter, Back, and the lock screen is shown.

## [0.1.5] — iteration 4.10: Essentials in airplane mode

Needs a vault at 0.4.13 or later (the offline grant and the offline set).

### Added
- On this phone, a section of Home. Offered once: "Keep your Essentials
  on this phone? They'll open with no signal — at an airport, a hospital,
  a desk. Anyone who can unlock this phone can open them." Keeping them
  asks for your password once (the vault's offline grant, 30 days). Your
  own Only me Essentials are a separate, explicit choice, only on a phone
  whose fingerprint or face unlock is strong enough.
- Each kept Essential has Open and Show, and how long it is kept for.
  The viewer pages with Previous and Next and sizes with Larger and
  Smaller, as well as swipe and pinch; pages go from the encrypted store to
  memory, never to a file or an image cache.
- Syncing only in front: when the app unlocks, comes back, is pulled to
  refresh, or the connection returns. What the vault no longer lists — un-
  marked, visibility or role changed, a new version — is gone from the
  phone in the same sync. The grant is renewed with one password from
  three days before it lapses.
- Every open of a kept copy, online or not, is told to the vault once it
  can be.
- Removal: a session the vault revoked, signing out, changing vault, or
  somebody else signing in removes every kept copy; so do copies left
  unchecked past the vault's limit (measured on the vault's clock), with a
  warning from 14 days before. A lost connection never removes anything.
- A session that simply expired leaves the copies readable from the
  sign-in screen, behind the lock: "Sign in again to keep these up to
  date. You can still open them." Signing in again renews the grant with
  the password just typed; until there is a grant nothing syncs, so
  nothing kept is removed.

- Your Only me copies, if you keep them: "{n} of your Only me Essentials
  are kept here — Show them" opens them with your fingerprint or face, and
  brings them up to date when online. Without it, every sync still checks
  them against the vault's set by their ids alone: one gone or replaced,
  or no grant, and they are removed whole, to come back the next time.
- A lapsed or ended grant asks on Home for your password once; the copies
  come back with it. A document whose pages the vault is still drawing
  says so. Kept copies show their status worked out for today.

### Fixed
- A session kept from before, and a password sign-in, learn what the vault
  can do at once, not only the next time the app comes to the front.
- Keeping Essentials is the choice of the person who made it: somebody
  else signing in on the phone is offered it afresh, and the password they
  typed is never used for a grant; nor does anybody inherit the last
  person's Only me choice.
- On this phone shows after a cold start with no connection.
- Copies being removed while their store is still opening are removed all
  the same (it is closed first); a removal that fails is tried again at
  the next start.
- The copies' age is recorded as soon as the vault's set is applied; a
  page that fails no longer stops the sync, and opens are always told.
- The Only me download at enrolment follows an everyday sync already
  running instead of being dropped; a wrong password is said before the
  Only me choice is offered.
- When the connection comes back while the app is in front, it syncs.
- Removal notices appear where you are (the sign-in screen after the vault
  signed the phone out) and can be dismissed; nobody who never kept
  anything is told their copies were removed.

### Tests
- Screen tests for keeping, airplane mode, revoke, expiry, signing in
  again (with and without the grant going through), somebody else's
  copies, and the maximum age; the a11y audit covers the new screens.
- Maestro: offline-essential.yaml (keep with the password, airplane mode,
  cold start, unlock, page 1) and essentials-revoked.yaml (the vault
  revokes the session through its API; the sign-in screen offers nothing
  kept, and CI finds no Essentials database left on the phone).

## [0.1.4] — iteration 4.8: the lock and the encrypted stores

### Added
- The app locks. It asks for the phone's fingerprint or face — or its PIN
  or pattern, always allowed instead — when it starts with somebody signed
  in, and when it comes back after longer away than you chose in Settings:
  immediately, after a minute (the default) or after five. Signing in with
  your password counts as unlocking. Back on the lock screen leaves the
  app, and nothing of the app is behind it. The scanner, the file and photo
  pickers, and the phone's own prompt are not "away".
- "Too many tries. Unlock with your phone's PIN or pattern instead."
- A phone with no screen lock has no app lock and will keep nothing
  offline; Settings says so, and everything else works as it did.
- The app is kept out of screenshots, screen recordings and the recent apps
  view while it is open. Settings → Allow screenshots lets the lists and
  Settings be captured; the card, and later documents' pages, never are.
- The encrypted stores the offline Essentials will live in (4.10):
  essentials.db for household and adults-only Essentials, under a key read
  when the app unlocks and dropped when it locks; and essentials-private.db
  for your own Only me Essentials, if you choose to keep them, under a key
  behind strong biometrics only, which the phone throws away when a
  fingerprint or face is added or changed — then only those copies are
  removed, to be fetched again online. A phone whose face or fingerprint
  unlock isn't strong enough cannot keep Only me copies, and Settings says
  so. SQLCipher with the raw key, temporary tables in memory, deleted rows
  overwritten; nothing is encrypted by hand.
- A new installation keeps none of the previous one's keys (the queue's and
  the stores' included), on phones that keep the keystore across a
  reinstall.
- Probes L1 (the store under SQLCipher, read back, and not plain SQLite on
  disk) and L2 (the Only me key, and what a new fingerprint does to it).

### Fixed
- A scan saved while the app was still opening its queue at start (most
  likely just after install or a restart) was kept but never listed as
  waiting: the queue could be opened twice when the app came to the front
  at start. It now opens once, and is tried again on coming back only
  after it failed.

### Tests
- The e2e build has a fake phone lock, opened by a tap. Maestro's lock
  flow: not asked again after signing in, locked at a cold start, locked
  after 70 s away, and Back leaves. The capture flow unlocks after its cold
  restart. After the flows, CI reads the app's folders as root and fails if
  any HTTP or image cache holds document or picture bytes.

## [0.1.3] — iteration 4.5: the queue in airplane mode

### Added
- The card works with no connection. The kinds of document and the
  family's people are kept on the phone (in the encrypted queue) each time
  the vault is reached, so a scan made in airplane mode is filed with its
  details and goes as it is once the connection is back: "Saved on this
  phone. It'll go to the vault as soon as there's a connection." A phone
  that has never seen them offers Skip.
- Home says where each capture stands: Waiting to send, Sending…, or Needs
  you — and why: no connection yet, a busy vault, a vault that can't reach
  where it keeps files. The queue sends the moment the connection comes
  back, on the phone and in the browser alike.
- Needs you comes with choices, none of which makes a scan less private:
  Remove it; for a scan whose person has left the family, give it to
  someone else or to nobody (an Only me scan can only stay yours).
- Scans belong to whoever made them. Signed out, they wait, and the
  sign-in screen says how many; signed in as someone else, Home asks
  whether to remove the other person's scans from this phone. Signing out
  with scans still waiting asks whether to keep them for next time.
- Scan the new one: from a reminder on Home, a renewed document goes in
  as the next version of the same one, and its reminder is done.
- An e2e build (x86_64, a fixture scanner) and a Maestro flow on an
  emulator: a scan saved in airplane mode, the app killed, the connection
  back — exactly one document in the vault, with the card's fields.

## [0.1.2] — iteration 4.4: scan, confirm, saved

### Added
- Scan a document with the camera button at the bottom of Home: ML Kit's
  document scanner finds the edges and flattens the pages, several in one
  go. Or add a file (a PDF, a photo, a Word or Excel file, up to 25 MB) or
  a photo from the phone; on the web build, and on a phone whose scanner
  cannot start, those are the ways in.
- The confirm card comes straight after the scanner's Done — no second
  review screen. The pages are in a strip, each with Move earlier, Move
  later, Remove and Retake, and Add page (20 at most); nothing needs
  dragging. What it is: the kinds of document the family files most, as
  chips, and More… with a search. Whose it is: the family's people (a
  teen's scans are always their own). Who can see this: Everyone, Adults
  only, or Only me — only for your own documents, with the sentence that
  says what Only me means. Essential, from the kind of document. More
  details: the name (made from what you chose unless you type one), who
  issued it (with the family's own issuers to pick from), the number, the
  dates ("14 Mar 2031", "March 2031", "2031"), the expiry date for the
  kinds that expire, and where the original is kept. The reminder it will
  get, in a sentence. Save, or Skip to name it later; Back asks whether to
  save it without details, throw it away, or keep editing.
- Nothing goes to the vault while the card is open. At Save or Skip the
  pages become one PDF (the photos' location and camera details
  removed), and it goes into the phone's own queue, encrypted
  (SQLCipher, under a key in the phone's keystore for this device only);
  the scanner's files are deleted.
- The queue sends one capture at a time while the app is open, with the
  card's details ahead of the file, so a document arrives complete and
  private from its first byte. Each capture has one key, made at Save:
  however often it is tried — a dropped connection, a busy vault, the app
  closed halfway — one scan makes one document. A lost answer is asked
  about before anything is sent again. A busy vault is tried again when
  it says; one that cannot take the file (too big, a kind it does not
  keep, details it refuses) says why in plain words, never "upload
  failed". A capture is only ever sent as the person who made it, to the
  vault it was made for: someone else signing in on the same phone
  leaves it waiting. Nothing is sent while the app is in the background,
  and a large file on a slow connection is given the time it needs.
- Home: "Saved. We'll remind you 9 months and 6 months before it
  expires." (or "It's under Needs a name" after Skip), the captures on
  their way and where each stands, and how many documents need a name.
- Timings: tap the version in Settings seven times. The last twenty
  captures, stage by stage — tap, scanner, pages, card, Save, queued, in
  the vault — shared only through the share sheet, times only.

### Changed
- The app now needs vault 0.4.10 or newer: uploads that can be retried
  safely, the card's details sent with the file, and who issued it.

### Fixed
- The web build failed to start once expo-router's web dialog was in it
  (tslib 2's module wrapper under Metro).

## [0.1.1] — iteration 4.2: connect and sign in

### Added
- Connect: type the vault's address and the app finds it, trying https
  first. Every way it can fail has its own sentence: not a vault, a vault
  too old for the app (with both versions and a link to the upgrade
  steps), an app too old for the vault, a vault not yet set up (opens it
  in the browser).
- Plain http only to a private address, only on Wi-Fi or Ethernet (a
  phone that cannot say which network it is on counts as mobile data),
  and only after a one-time question per vault. Nothing but the
  capability check is sent to it before the answer is yes. From then on
  nothing secret goes to an http vault, on every request and not just at
  Connect, unless the phone is on Wi-Fi or Ethernet and the vault
  answering there has shown the installation id recorded the first time:
  checked again after 5 minutes, after any network change (one Wi-Fi to
  another included), and on coming back to the app. What a stranger at
  the address says is not shown. Over https, a new installation id means
  the vault was reinstalled: sign in again, once, as the new id is
  recorded.
- Sign in with email and password, and the six-digit code when two-step
  sign-in is on. The vault's own words when it says no; a hint when the
  account uses a passkey.
- The session is kept in the phone's keystore (this device only, unlocked
  only) and read before the first screen. A reinstall starts signed out.
- Home: what needs attention and what came in lately, with a banner when
  the vault cannot be reached. Settings: which vault, who is signed in,
  Large text, sign out.
- Every request carries the app's installation id and a User-Agent that
  names the app, its version and the phone model.
- A logger that withholds tokens, passwords, ids, titles, names and
  addresses. Preview and release builds keep only its errors: every other
  console call is removed at build time.
- Tests for every screen: each control has a role, a name and a 44 dp
  target; Large text makes every word 1.3 times the size and cuts none
  short.
- The web build, served with `/api/` passed through to a vault, and a
  Playwright test that connects to a real vault and signs in. CI runs it
  against a vault built from the pinned public commit.

### Fixed
- A screen that asked for a token before the session had been read from
  the keystore was told "signed out", and the session was cleared.
- Babel's config was cached on its first variant, so a preview built in
  the same process as a dev build kept its console calls; Metro's cache
  is now kept per variant as well.
- The Android builds ran Gradle without `APP_VARIANT`, so a preview APK
  bundled the dev configuration: no test banner, console calls kept. The
  0.1.0 preview APK has this; 0.1.1's does not.
- Signing in no longer throws away the access token it was just given,
  and a keystore that cannot be read starts signed out instead of on the
  loading screen for ever.

## [0.1.0] — iteration 4.0: the scanner spike

Not tagged separately: its builds are `dev-latest` and `preview-latest` at
17c81ad. The workspace, the one native build, CI with the Android builds,
the scanner and PDF spike, and the probes P1–P12 for the owner's session.
