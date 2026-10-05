# Changelog

All notable changes to the Family Vault phone app. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the
app's own, tagged `vX.Y.Z` in this repository.

## [Unreleased]

## [0.2.2] — iteration 5.31: identity, paused access, incoming files and notices

Each of these appears only with a vault that has it; with an older vault
(0.4.10 or later, as before) the app is as in 0.2.1.

### Added
- **The Identity card on a person's screen**, with a vault of 0.5.29 or
  later (`member_identity`): their details in sections, every ID number
  and hidden field masked; two IDs of the same kind are told apart by who
  issued them, or a number ("Show passport number, issued by Ireland").
  **Show** asks who is holding the phone: for your own numbers your
  password or a code; for another person's, a code from an authenticator
  app — the vault takes no password for that, so the sheet offers none.
  Somebody whose only second factor is a passkey, which the phone cannot
  use yet, is told to add an authenticator app or to do it in the browser,
  not asked for a code they cannot give. Without two-step sign-in the
  vault's own words say to turn it on, in the browser, and are said aloud.
  **Copy** asks the same; the copy is marked sensitive (Android 13 and
  later show dots, not the number, in the clipboard's preview and a
  keyboard's suggestions) and cleared after a minute, unless the app can
  see something else was copied since. An alarm clears it, so it goes even
  if the app is swiped away, killed or frozen within the minute, or the
  phone sleeps; and when the app starts or comes back, a copy of its own
  left past its minute goes then, and one not yet due has its clear set
  again (a force stop takes the alarm away). Screenshots are refused while the card
  is on the screen — also under a document opened from it, which stays the
  safer side — and allowed again once it is left; two cards at once each
  keep their own shield. Nothing of it is kept: not in a store, a cache or
  the log; with no connection there is no card (A36), and the lock hides
  every number shown. Another person's Only me fields are never shown,
  even if an answer carried them. Read only: details are added and changed
  in the browser.
- **Paused access.** When an owner locks a person's sign-in, or a restore
  pauses it (a vault of 0.5.31 or later), the phone says "An owner has
  paused your access. Ask them if you think this is a mistake." — when the
  vault ends the session (told by push too: the phone signs out at once and
  asks the vault why in the background),
  and at sign-in; after a restore, "Your access is paused after the vault
  was restored. Ask an owner to turn it back on." Not "wrong password",
  and not the words for a session that simply went; a request still under
  way leaves them in place. The kept Essentials go with the session, as for
  every end but an expiry, and a sign-in refused for a lock takes those
  kept after an expiry: the phone has learned of the lock.
- **Two notifications.** "3 documents arrived for you to look at", when
  files sent through a request wait for you to look at (a vault of 0.5.27
  or later; they are looked at in the browser); a message without a count
  shows nothing. And "Something about your details is changing. Open the
  app to see what." for when more people are to see your identity
  details — Home says what. Only a count and the app's own words are ever
  shown, never anything else a message carries. (The vault tells of a
  wider audience in the app and by mail, and sends no such push yet: the
  phone is ready for it.)
- **Home says what a person must be told.** That an owner was given a
  link to reset their password (a vault of 0.5.32 or later), on which day
  by this phone's calendar, and
  what was added to their sign-in since the link was used — passkeys,
  two-step sign-in, share links — until they say "I've seen this"; the
  password is changed in the browser. And that more people will see their
  identity details from a date (a wider audience waiting its 72 hours),
  with the way to their own.

### Changed
- **Reminders from any date**, with a vault of 0.5.16 or later
  (`reminder_dates`). On the card, the promise sits under the date it is
  about once More details is open: Expires's as before, a bill's under its
  Due date — "We'll remind you 7 days and 1 day before its due date." —
  with "We remind you once for this date…", and on an Only me document,
  that the vault can read that one date. Saved, the card's note makes the
  same promise — or, for a due date already gone, says that no reminder is
  set, since the vault makes none. A reminder on Home and in Needs attention reads the date
  it is about ("Due date: 10 Oct, in 7 days"), never "Overdue by 3 days"
  above a bill still ahead; Coming up says under it when it falls due, or
  until when it is put off — so a month's snooze the vault stopped at a
  bill's due date says so. **Scan the new one** is offered only for an
  expiry: a bill is paid, not replaced.
- Built against the vault's shared code of v0.5.32 (was v0.5.19).
- Expo SDK 57's patch releases: expo 57.0.26, expo-constants 57.0.20,
  expo-document-picker 57.0.3, expo-navigation-bar 57.0.3 and expo-router
  57.0.24.

### Fixed
- **Save that waits opens the keyboard on the first field it waits for.**
  When Save opened More details, the field took the focus before it was
  laid out, and Android ignored the keyboard for it: the person saw no
  keyboard, and a Back meant for it asked to leave the scan (the Maestro
  capture flow since 0.2.1). The field now moves to itself once it is laid
  out.

## [0.2.1] — iteration 5.13: a kind's details on the phone

(The app's version stayed 0.2.0 in 5.13; 0.2.2 is the first build to say
0.2.1 or later, and carries this too.)

Iteration 5.13: a kind of document's details on the phone, and who added
each version. And the tab bar's +, as on the web.

### Added
- **The card asks for a kind's details**, with a vault of 0.5.11 or later
  (`custom_types`). More details uses the kind's own name for each field
  ("Passport number", not "Number"), leaves out the fixed fields the kind
  does not use, and adds its own fields, each with the input its kind
  needs: text, a date, a year, a number, an amount, one of its answers, or
  yes/no. The fields it requires are marked "* required"; Save waits for
  them, says which are still needed and goes to the first, and Skip never
  waits. A number or an amount is written with a point: "12,50" is
  refused, never kept as 1250 (as on the web). Numbers open a keyboard of
  numbers on Android too. The details go with the scan, checked on the
  phone against the kinds it last saw — offline too — so the vault
  refuses nothing when it arrives. With an older vault the card is as in
  0.2.0 and nothing new is sent.
- **A scan whose kind changed while it waited is still filed.** If the
  kind lost a field, or an answer, while the scan waited on the phone,
  the vault no longer takes that detail: the scan goes without it, once,
  rather than waiting for a person, and Home says which by its name —
  "The car is in the vault without Fuel: its kind of document no longer
  asks for it."
- **A document's page shows its kind's details**, under the kind's names
  for them. An Only me document's come only from the vault's own answer
  for that document, which opens them for its owner; never from a list or
  a kept copy.
- **Who added each version, and when exactly**: "Added 25 Sept 2026,
  4:12pm by Sarah". A viewer is told only when, as in the vault's activity
  log. An older vault's history reads as before.

### Changed
- **The button in the middle of the tab bar is a +, as on the web**, and
  it opens a menu: **Add a file**, **Camera** and **Add a picture**. It is
  there for everyone who may add documents, also on a phone without a
  scanner, where the menu leaves Camera out; before, such a phone had no
  button at all. Back, a tap outside the menu or Cancel closes it. A
  screen reader hears "Add a document", is taken to the first choice when
  the menu opens and back to the + when it closes; the choices scroll at
  the largest text sizes. A scanner that cannot start still says so.
- **Home no longer has its own Add a file and Add a photo buttons**, which
  floated over Recently added: the + offers both. With no documents yet,
  Home points to the + (a viewer, who cannot add, is told only that there
  are none).
- **The tab bar fits a small phone at Large text.** Needs attention's tab
  is labelled "Attention" (a screen reader still hears "Needs attention",
  and the screen keeps its title); the labels are the web's size; the +
  is 56 across, as on the web, in a slot of its own, so no label runs up
  against it.
- Kinds of document the household has hidden are no longer offered on the
  card, not even among the usual first ones. The vault still lists them
  while a document uses them, so those documents keep their kind.
- Built against the vault's shared code of v0.5.19 (was v0.5.11; before
  that v0.5.0-rc.1).

### Fixed
- **A teen's scan of a kind kept for the adults is their own Only me**
  (the owner's decision A71, vault 0.5.19). A teen cannot file Adults
  only, so the card started such a kind — a social security card, a bank
  statement — at Everyone, and the phone sent that, viewers included. It
  starts at their Only me now, as on the web; Everyone is still theirs to
  choose. An adult's is Adults only, as before. A scan already waiting on
  the phone goes as it was saved.
- **An Essential's status with no connection agrees with the vault's.**
  The phone worked it out from the expiry date alone, so a kept passport
  with no number said "Valid for 3 years" where the vault said "Needs a
  passport number". The kinds are now kept with what each requires, and
  the status is worked out by the vault's own rule. For an Only me
  document, whose details are sealed and never kept on the phone, the
  vault's Needs info stands, unless its expiry has since come near or
  passed, which comes first.

## [0.2.0] — Phase 4 — Pocket

The family vault in a pocket, for Android: scan a document and file it
from the sofa, with its details, exactly once whatever the connection
does; look anything up; keep the Essentials for when there is no signal
and show an ID at a counter; hear about reminders through a notification
app of your own. Works with a vault of 0.4.10 or later; notifications
need 0.4.14. Everything in 0.1.1–0.1.10 below.

### Added
- **The owner's signed build.** `release.yml` builds
  `io.github.mansoor.familyvault` signed with the owner's own key (four
  repository secrets), minified, arm64, checks the signature with
  apksigner — never a debug key — and attaches it to a private GitHub
  Release: `v0.2.0-rc` first, `v0.2.0` after the exit demonstration.
- The Maestro flows run on the release tags.

### Fixed
- **The phone kept the vault's answers in its HTTP cache.** The app's
  fetch keeps a disk cache in the app's cache folder and ignored the
  app's "don't cache": after a vault was upgraded the app went on saying
  its old version for five minutes; the check that the phone is still
  talking to your vault over plain http could be answered from that
  cache after the phone changed networks; and lists of documents and
  people stayed on the phone after signing out. Every request now asks
  for no kept answer and keeps none, and what earlier versions kept is
  removed at launch, at sign-out and when the vault ends the session.
  With a vault of 0.5.0 or later, the vault says the same.
- **The vault is asked again when there is a reason, not every time the
  app comes to the front.** Over https the app reads what the vault can
  do at launch, after signing in, after five minutes away, or when it had
  found no connection; a vault of 0.5.0 or later says its version with
  every answer, so an upgrade is noticed from what the app already asks.
  Over plain http nothing changes: the check that this is still your
  vault happens as before.
- **Turning Essential off asks to confirm it's you**, as a vault of
  0.5.3 or later requires: it takes a check away from the document.
  Turning it on asks nothing. Before, such a vault refused the change
  with "Confirm it's you to carry on." and no way to.

## [0.1.10] — iteration 4.17: accessibility, copy and the failure states

(0.1.10 rather than 0.1.11: Expo SDK 58, iteration 4.16, waits until it is
released.)

### Changed
- **Every failure in words, one voice.** No connection, a timeout, too
  many tries (with how long to wait), a session that is over, a request to
  confirm it's you, an answer that isn't the vault's: the app's own words.
  Anything else the vault refuses is said in the vault's words, as it
  wrote them; never a code, never "error". A test reads the app's and its
  client's code for every error they act on and fails if one has no words.
- The accessibility audit every screen test runs now also fails a status
  shown by colour alone; the Licences list is read one package at a time.

### Added
- `docs/failure-states.md`: every failure the person can meet, where, and
  the exact words — written from the catalogue, checked in CI.
- A Maestro flow at the phone's largest text with Large text on: Home,
  Settings and the capture card are all still reached.

## [0.1.9] — iteration 4.15: address, certificates, Settings and Back

### Added
- **Settings, in full.**
  - The vault: its address, "Not secure" when it is reached without
    encryption, and "Use another vault", which signs out and removes
    everything kept on this phone for this one (scans still waiting
    included, after saying how many).
  - Signed-in devices, named as the vault names them: this phone marked,
    the ones keeping Essentials said, any other signed out from here.
  - Offline copies: how many, how much room, when last checked, whether
    your own Only me documents are among them (switched with your
    password), and Remove offline copies — the vault is told this phone
    keeps nothing now.
  - About: the versions, the licences of everything the app is made of
    (listed from the build itself), and "More settings are in the browser".
- **A link pasted as the address.** An invitation or a password reset
  link becomes the vault's address, with the browser to finish it; a share
  link is for the browser only. The secret in the link is never kept.
- **Certificates in words.** A vault whose certificate this phone doesn't
  trust yet says so, with how to install it once (Android's steps; the
  iPhone's too); a certificate for another name, or one that has run out,
  says that instead of "can't reach".
- **A Wi-Fi sign-in page** answering instead of the vault is named as one.

### Changed
- Back closes every sheet without doing what it asked (Use another vault,
  Sign out, Confirm it's you), as it already leaves Show mode for the lock
  screen, leaves the app from the lock screen, and asks before a scan on
  the card is thrown away.

## [0.1.8] — iteration 4.14: push on Android

Needs a vault of 0.4.14 or later for notifications; with an older one,
Settings says so.

### Added
- Notifications on this phone, through a free notification app of your
  own such as ntfy (UnifiedPush): nothing goes through Google. Settings →
  Notifications turns them on, after saying what they are; Android asks
  whether the app may notify. With several notification apps it asks which
  one; with none, it says to install one (the daily email works either way).
  - What the phone shows is the app's own words, picked by what happened —
    "3 things need attention", "A new device signed in to your vault",
    "You were signed out on this phone", "Notifications are working." — on
    two channels, Reminders and Security. Nothing the message carries is
    shown, and the vault sends no titles or names in the first place.
  - A tap opens Needs attention, or Settings for a new device, once the app
    is unlocked; never before, and nothing else.
  - Send a test; the daily reminders switch, as the vault keeps it.
  - A new address from the notification app is told to the vault.
- **Signed out by the vault, the copies go at once.** When the vault signs
  this phone out (revoked from another device, say), the Essentials kept for
  no signal are deleted the moment the message arrives, with the app closed.
  The app finishes signing out before it shows anything.

### Changed
- Signing out removes this phone's notifications first, so the vault has no
  reason to tell it "you were signed out". The same person signing in again
  gets them back without asking.
- The lock timeout choices in Settings are named for screen readers.

## [0.1.7] — iteration 4.12: look it up

### Added
- A tab bar: Home, Search, the camera in the middle (for those who may
  add documents), Needs attention and People. Adding a file or a photo
  stays on Home.
- The Document screen, from any list.
  - Its primary action is Show for an Essential and Save a copy for
    everything else.
  - Its pages come from the phone without asking anything when they are
    kept there. Otherwise they come from the vault, and "Confirm it's you"
    (password, or a code from the authenticator app; pasting allowed) is
    asked when the vault wants it, with the vault's own words.
  - Then its details, its status, and who can see it.
  - The Essential switch works online only. A change somebody else made
    meanwhile is shown, not overwritten: "Someone changed this while you
    were looking. Here's the latest."
  - Its versions, and Add a new version.
- Save a copy: to a temporary file, then the phone's share sheet, then
  deleted, whatever happened. A copy left by the app stopping is swept at
  the next launch. The first time, it says "The copy you save is outside
  the vault, where the vault can't protect it."
- Show and the pages work for an Essential that is not kept on the phone
  (or kept in an older version), from the vault. For Show, the pages are
  confirmed and fetched on the Document screen first, so Show mode itself
  never asks anybody to confirm it is them. "Confirm it's you" is withdrawn
  whenever the app locks.
- Search: results a quarter of a second after you stop typing, narrowed
  by person and by kind. Matches inside the pages are shown in bold, never
  as markup. Your own sealed documents are searched in a second pass.
  "Search needs a connection. Your Essentials are under On this phone."
- Needs attention: what is due and what is coming up. Each can be put off
  a week or a month, or marked done, and a document running out can have
  its new one scanned straight in.
- People: the family, each leading to their documents.

### Tests
- document, search, reminders and tabs screen tests, as the plan names
  them, each with the a11y audit.
- Playwright on the web build against a real vault: search, open, the
  pages (confirming it is you if asked), snooze.

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
- "Tap Done, or press back, to finish." The controls fade three seconds
  after the last touch and come back with a tap — never while a screen
  reader or another accessibility service (Switch Access, Voice Access) is
  on; then they sit beside the page, not over it. Made larger, the page
  moves with a finger.
- Ended while signed out (an expired session's kept copies), Show leaves
  the lock screen too, not the sign-in screen.

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
