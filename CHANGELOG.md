# Changelog

All notable changes to the Family Vault phone app. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the
app's own, tagged `vX.Y.Z` in this repository.

## [Unreleased]

## [0.7.1] — pages turn with a swipe and zoom with your fingers

The owner's report of 13 Nov 2026, on a real Android phone: in a
document's Pages, and in Show mode, neither the swipe nor the pinch of
0.5.11 did anything. Same vault as 0.7.0 (0.9.0-dev.37).

### Fixed
- **A sideways swipe turns the page** (left for the next, right for the
  previous, as ‹ and › do), with the page following the finger a little.
  At the first or last page it bounces back. A short drag, or one more up
  and down than across, does not turn it. The swipe was handled by React
  Native's PanResponder, around two scroll views and the picture, and on a
  phone those kept the touches; the page now has Gesture Handler and
  Reanimated, which the touches reach first, under a Gesture Handler root
  around the whole app.
- **Pinch to zoom, smoothly, under your fingers**: from the page's own
  size up to 4×, about the point between your fingers. Let go below its
  own size, it comes back to it; past 4×, back to 4×. Made larger, one
  finger moves it about, no further than its edges. **A double tap** goes
  to 2.5× where you tapped, and again back to the page's own size.
- **Another page starts at its own size**, by a swipe or by ‹ ›.
- **Show mode** has the same: a swipe across turns the page, a swipe down
  still ends it, and a pinch, a finger and a double tap work as in Pages.

### Added
- **Fit page**, between ‹ › and − +: back to the whole page, in the middle,
  in one tap. Named "Fit page" for a screen reader, 48 points square, and
  greyed out at the page's own size.

### Changed
- **− and +** step 1×, 1.5×, 2×, 3× and 4× (3× was the most before), from
  wherever your fingers left it. They and ‹ › are still there for anyone who
  would rather not swipe or pinch, and a screen reader reads each page as
  before.

## [0.7.0] — Sensitive, and the AI reader in Settings

AIR4, the phone's side of the vault's Sensitive flag (AIR2) and its AI
readers (AIR1, AIR3), with a vault of 0.9.0-dev.37. Each part is offered
only where the vault has it, so an older vault looks as before.

### Added
- **Sensitive** on the capture card and in Edit details: *As its kind
  says* — with what that is now, yes or no, in the web's own words — **Yes**
  or **No**, and what it means under it: handled with extra care, never
  sent to a cloud AI reader. Left as its kind says, a document follows its
  kind's default; Edit details sends the choice only when it was changed. A
  teen may mark a paper sensitive, never not (No is offered to a teen only
  where the document is so already), as on the web.
- **A lock** on a sensitive document's page, beside its status: "Sensitive".
- **Sensitive** among Documents' filters: Sensitive, Not sensitive, or
  both, with its chip above the list.
- **More → Settings → Reading**, for owners: the household's AI reader,
  read only — its kind and model (never its key), its address as the host
  alone, whether it runs on your own network or as a cloud service, whether
  it is working, whether papers marked Sensitive are sent to it, and for a
  cloud reader this month's count ("120 of 500 this month"). Changed on the
  web, as the card says. Anybody else sees nothing of it.

### Changed
- Pinned to the vault of 0.9.0-dev.37.

## [0.6.1] — Cancel beside Save, and a clear button in search

The owner's two fixes of 12 Nov 2026. Same vault as 0.6.0 (0.9.0-dev.33).

### Changed
- **New note, Edit note and Edit details**: Cancel and Save sit side by
  side in one row at the foot of the screen. The row stays put while the
  rest scrolls, above Android's Back and Home buttons (or its gesture
  bar) and above the keyboard. Before, Cancel came last on the page and
  could end up behind Android's own buttons.
- **Cancel, or Back, with something changed asks first**: "Leave without
  saving?", with Keep editing and Leave without saving. With nothing
  changed it leaves straight away, as before.

### Added
- **A clear (×) button in every search box** (Documents, Notes, choosing
  a kind or a person, adding documents to a collection): shown while the
  box holds words, named "Clear search", 44 points wide. It empties the box
  and keeps the keyboard open, and the list goes back to everything.

## [0.6.0] — texts: your mobile number, codes by text, and texts you choose

SMS4, the phone's side of the vault's text messages (SMS1–SMS3), with a
vault of 0.9.0-dev.33. Each part is offered only where the vault has it
and an owner has set up texts (SMS Gate, on the web).

### Added
- **Account → Mobile number**: add yours, and confirm it with the code
  texted to it. Nothing else is sent to a number before that. Change it
  (it is confirmed again), or remove it after a question.
- **Account → Codes by text**: a code by text when you sign in, and when
  you set a new password, each turned on after confirming it's you. The
  vault's own warning is beside them: a text is the weakest way to prove
  it's you, so use it as well as a passkey or an authenticator app, not
  instead. An owner without one is told why it can't be turned on.
- **Settings → Texts**: the day's reminders (one text with a count),
  alerts about your account, and a link you shared being opened, each off
  until you turn it on, and **quiet hours** (21:00–08:00 until you choose).
  Until your number is confirmed, it says where to add one.
- **Sign in**: where your second step is a text, the code goes as the
  password is accepted ("We've texted a code to •••456"), with **Text me
  a new code**. Where you have both a text and an authenticator app,
  either one works.
- **Confirm it's you**: **Text a code to •••456** beside the password,
  for an adult or teen who turned on the sign-in code (never an owner's,
  and never for what takes an authenticator code alone).
- **Share → Code by text**: the person's mobile number, and the link's code
  is texted to them when they open it. It is never shown back in full.
- Every texted code's box is marked as a one-time code, so Android offers
  the code from the message as it arrives. There is no SMS permission and
  no reading of messages.

### Changed
- Re-pinned to the vault's **v0.9.0-dev.33**.

## [0.5.11] — the notes editor, scan text, and smoother choosing

The owner's asks of 12 Nov 2026.

### Added
- **The notes editor matches the web's**: a toolbar — bold, italic,
  underline, struck through, headings 1 to 3, bulleted and numbered lists,
  a checklist, a quote, a link and Clear formatting — acting where the
  cursor is, and **Write / Preview**, the preview drawn as the note's page
  draws it. In New note and a note's Edit.
- **Scan text** into a note: a page through the phone's scanner, its words
  read by the phone's own text recognition (ML Kit, through
  expo-text-extractor, on the phone: nothing
  is sent anywhere) and put where the cursor is. The scan is not kept.

### Changed
- **What it is** and **Whose it is** scroll sideways, smoothly, with ⋯
  always in sight: past the screen's edge they were cut off, and a drag
  could land as a tap on another choice.
- **The pages turn with a swipe** left or right (as ‹ and › do), the swipe
  taken before the picture can keep it; zoomed in, the picture scrolls.

## [0.5.10] — your password and two-step sign-in, from the phone

The owner's ask of 12 Nov 2026.

### Added
- **Account → Your password**: change it from the phone (the password now,
  and the new one, ten characters at least). Your Only me documents come
  with it; your other devices are signed out.
- **Account → Two-step sign-in**: set it up from the phone, after
  confirming it is you — open your vault in the authenticator app on this
  phone (or copy its key), then type the code it shows. Turned off with a
  code, unless your household asks you to keep it (owners).
- **Sign in → Forgot your password?**: the address you sign in with, and a
  link to set a new one comes by email, as from the web.

## [0.5.9] — back, and close

The owner's ask of 12 Nov 2026.

### Added
- A **←** at the left of the row with ✎ and ⋯, on a document's page (a
  note's too) and a collection's: back where it was opened from.
  Android's back still does the same.
- A **✕** on the pages, in the top corner beside the document's name:
  closes them, back where they were opened from.

## [0.5.8] — The household

The owner's decision of 11 Nov 2026, with a vault of 0.9.0-dev.32.

### Added
- **The household** as whose a document is, on the capture card and in
  Edit details, beside each person and Not sure yet. A kind that usually
  belongs to the household (a utility bill) starts with it; a document
  that is the household's no longer asks for a person.
- A document's page says **The household** where a person's name would be.
- Documents' filters offer **The household** beside the family.

### Changed
- Pinned to the vault of 0.9.0-dev.32.

## [0.5.7] — a link shown again

The owner's choice of 11 Nov 2026, with a vault of 0.9.0-dev.30.

### Added
- **Show the link**, in More → Sharing: a link you made, and its PIN or
  the password the vault made up, shown again after confirming it is you,
  with Send and Copy. Links made before your vault kept a copy are shown
  once only, and have no Show the link.
- A link just made says it can be seen again in Sharing, where the vault
  keeps it.

### Changed
- Pinned to the vault of 0.9.0-dev.30 (its client reads `libphonenumber-js`,
  now in the app's licences).

## [0.5.6] — the vault's name on every page, and notes three ways

The owner's notes of 11 Nov 2026.

### Changed
- **A bar at the top of every page**: the vault's name, the bell and
  Settings, higher than Home had them. A page's own title, and its
  buttons (Edit, ⋯), are below it; the bell is no longer beside each
  tab's title. No back arrows: Android's back goes back. Show mode, the
  pages, the camera and the edit pages keep the whole screen.
- **Documents**: the search box and the filters open from a magnifier
  beside the title, and close with ✕ (what was typed goes); chips for
  the filters in use stay in sight.
- **A link just made**: Send and Copy come first; the link and its PIN or
  password are behind an eye.

### Added
- **Notes three ways**, one button beside the + going round them, and
  remembered on this phone: **Sticky** (squares, two to a row, the ⋯ on
  each corner), **List** (each name on one line, cut with …), and
  **Detailed** (as before).
- **What you looked for in your notes**, kept on this phone (each person's
  apart), behind the clock beside the box: tap one to look again;
  **Forget these searches**, asked first.

## [0.5.5] — Essentials on Home, and the counts in threes

The owner's notes on 0.5.4 (11 Nov 2026).

### Added
- **Essentials** on Home, a section of their own above Recently added:
  five at most, each a row (a tap opens it, its ⋯ the rest), and **See
  all**, which opens Documents narrowed to the Essentials (a chip takes
  that off). Without a connection, those kept on this phone, as before.
- **Tags on a note**, on its edit page, as a document's.

### Changed
- **Home's counts are three or six**: four did not fit a large phone.
  Where the vault keeps notes and collections, a second row of three:
  notes, people and collections, each opening its page; otherwise the
  three, as before. Two to a row at the largest text.
- **Collections** has no bar above its title, as Notes and the other
  pages have none: its title, with the + beside it, is the page's.

## [0.5.4] — a tidier phone

The owner's list of 11 Nov 2026.

### Changed
- **Home** counts your notes too, beside documents, expiring soon and need
  details: four on one row, two rows of two when the text is large. A tap
  opens Notes.
- **A row's ⋯ has Share instead of Open**: a tap on the row opens it
  already. The order is Show, Share, Save a copy, then the rest.
- **Documents keeps to documents**: notes are under Notes, so they are
  not listed, counted or offered as a kind there (a vault of
  0.9.0-dev.28 or later; an older one lists them as before).
- **Notes**: each shows only the first line of its words, and has a ⋯
  with Edit, Share and Add to a collection. New note is a small **+**
  beside the bell.
- **A note's page** is laid out as a document's: its words first, who can
  see it below them, and when it was edited, and by whom, at the foot.
- **Collections**: the **+** beside the title makes one, and a row has no
  › (its name says there is more in it).
- **A collection's page** has ✎ Edit and ⋯ in its header, as a
  document's: Share and Delete are in the ⋯. Who sees what in it is
  behind the ⓘ beside who it is for.

### Added
- **Tags** in Documents' filters: the most used as chips, the rest under
  More, several at once, any of them (a vault of 0.9.0-dev.28 or later).
- Pinned to the vault of 0.9.0-dev.28, which leaves the notes out of
  Documents and filters by several tags.

## [0.5.3] — reminders you set yourself, and sharing

### Added
- **Remind me**, in a document's ⋯: in a week, a month or 3 months, or on
  a day you type, with a note if you like. It is in Needs attention when
  its day comes, and under Coming up until then.
- In Needs attention, a reminder you set yourself shows its note and has
  **Delete**, asked first. Those made from a document's dates stay.
- **Share**, from the phone (the owner's ask of 11 Nov 2026): one sheet for
  a document (from its ⋯), a note, or a collection (from its page). Whom
  the link is for; when it stops (Tonight, Friday 5 pm, In a week, or a
  day and time); view only or download; how often it opens; and a PIN or
  a password the vault makes up. A collection's says which of its
  documents go, ticked as the web ticks them, and whether the link keeps
  up with it, and always asks to confirm it is you. The link, and its PIN
  or password, are shown once: **Send** opens the phone's share menu, and
  **Copy** keeps it on the clipboard for a minute. An Only me document is
  shared only where the household allows it.
- **Sharing**, in More: every link that still works, newest first, with
  whom it is for, when it stops and how often it was opened, each with
  **End this link**, asked first.

### Changed
- Pinned to the vault of 0.9.0-dev.27, whose client sets and removes
  these reminders.

## [0.5.2] — what could be made or seen, now changed too

The owner's review of 11 Nov 2026: a note could be made on the phone but
never edited. The rest of the app was checked for the same kind of gap,
and these are filled in:

### Added
- **Edit a note:** the pencil on a note opens its title and its words.
  The title is changed only by the note's owner, and only when it was
  changed; anybody else who may change the note changes its words.
- **A document's own note**, written and changed in Edit details.
- **Tags**, added and taken off in Edit details.
- **No longer needed**, from a document's ⋯, with why if you like; and
  **Needed again**, which brings its reminders back.
- **The Trash**, in More: what was moved there, newest first, each with
  **Restore**. Removing anything for good stays in the browser.
- **Collections:** **New collection** (a name, what it is for, who it is
  for), and on a collection you made, the pencil to change it and the bin
  to delete it, asked first; its documents stay where they are.

### Not on the phone yet
- Reminders you set yourself, which need the vault's client to offer them
  first; adding or changing people; and passwords, passkeys and two-step,
  which stay in the browser.

## [0.5.1] — the + fans out

### Changed
- **The + opens its choices around it:** Add a file, Camera and Add a
  picture fan out in a semicircle above it, and the + turns into an ✕
  that closes them (as do Back and a tap anywhere else). They spring out
  of the + and fold back into it; with Remove animations on, they appear
  and go at once.

## [0.5.0] — the redesign (redesign R7)

The phone app, redesigned from the ground up (0.4.1 to 0.4.6): compact,
with more on every screen. In short:
- **Smaller type and less empty space** on every screen: a list is one
  card with hairlines between its rows. Large text and 200% system text
  still work.
- **Tabs: Home · Documents · + · Notes · More.** People moved to More (it
  stays a tab on a vault without notes). **Needs attention** is behind a
  **bell**, which shows a count when something is due.
- **Home, at a glance:**
  - alerts you can hide for a day, a week, 30 days or until something
    changes;
  - how many documents, how many are expiring soon and how many need
    details, each opening Documents filtered to them;
  - the Essentials on one line;
  - the five most recently added.

  Nothing on Home says "nothing to do".
- **Documents:** search and sorting in one place, and **filters that slide
  out from the side**:
  - whose, kind, dates (added, issued or expires), status and who can see
    it;
  - several at once on a vault of 0.9.0-dev.26 or later;
  - "Show N documents" before you leave the panel;
  - the filters that are on, as chips you can take off one by one.
- **Long lists of choices on one line**, with ⋯ opening a picker you can
  search.
- **Asked before anything is lost:** every destructive action has a
  confirmation that says what will happen.
- **Needs attention:** Now and Coming up, with Scan the new one, Done and
  Later on each row.
- **A document's page:** the actions in one row, its details in two
  columns and the rest in one card; Edit details and ⋯ in the header.
- **Dark theme** throughout, following the phone.

### Added
- An emulator run for this release, against the vault the app is pinned
  to, after a reminder is set on the passport for today:
  - Home shows it as an alert, hidden for a week from its ✕;
  - the bell counts it;
  - in Needs attention it is under Now, is put off a week from Later, and
    is then under Coming up;
  - the bell has no number afterwards;
  - the filters, the document's page and Needs attention are captured in
    dark.

  With the filter walk of 0.4.5, the run takes screenshots of every
  redesigned screen in light and dark.

## [0.4.6] — Needs attention and a document, compact (redesign R6)

### Changed
- **Needs attention** (from the bell) shows **Now** or **Coming up**, one at
  a time, each with how many, as one card of rows. Each row has its actions
  on it: **Scan the new one** for a document running out, **Done**, and
  **Later**, which asks how long (a week or a month). Tapping a row opens
  the document.
- Where the vault counts, Needs attention says how many documents need
  details, with **Review them**, which opens Documents filtered to them.
- The screen's name is no longer said twice, and with nothing due and
  nothing coming up it says just that.
- **A document's page is compact**, as in the mockup: its picture, its
  name, one line of whose it is, what kind and who can see it, and its
  status (and Essential). Then one row of round actions (Show, Pages, Save
  copy, New version), its details in two columns, and one card of lines:
  Who can see it, Tags, Collections, Versions (opened in place) and
  Essential. Who added it and when is at the foot.
- **Edit details is the pencil in the header**, and **Move to the Trash is
  under the header's ⋯**, still asking first.

## [0.4.5] — filters from the side (redesign R5)

### Added
- **Filters, from a button beside the search box.** It opens a panel
  from the side, grouped:
  - **Whose**;
  - **Kind**: three on the line, the rest under ⋯, found by words;
  - **Dates**: added, issued or expires, with quick ranges (Expired, Next
    30 or 90 days, This year, Last year…), or From and To typed as the
    card takes dates ("14 Mar 2031", "Mar 2031");
  - **Status**;
  - **Who can see it**.

  "Show N documents" says how many before you leave the panel; "Clear
  all" starts again. Closed without Show, nothing changes.
- **What's on shows under the box** as chips, each taken off with its
  ✕, and the filter button says how many are on.
- On a vault of 0.9.0-dev.26 or later, you can choose several in each
  group (Sam's or Leo's, passports or licences), and filter by dates.
  The filters narrow your search too. On an older vault, one choice in
  each group, and no dates; the panel says so.

### Changed
- **Sorting is one button**, by the count, with its choices in a picker.
  The rows of chips under the search box are gone.
- The app is tested against the vault of 0.9.0-dev.26.

### Fixed
- **In date finds what is in date.** It asked for documents with nothing
  to renew, so a passport valid for years was never among them. Those
  have their own choice now, Nothing to renew, as on the web.

## [0.4.4] — Home, at a glance (redesign R4)

### Changed
- **Alerts you can hide.** What needs doing now shows on Home as alerts:
  - a reminder that's due, with **Open** and **Scan the new one**;
  - documents with no name, with **Name them**;
  - files waiting in your Inbox, with **Open your Inbox in the browser**.

  Each one's **✕** hides it on this phone for a day, a week, 30 days, or
  until something changes, with **Undo** for a moment after. A
  reminder's daily countdown doesn't count as a change, but a new date
  does. Three show at most; the rest are behind the bell.
- **Nothing says "nothing to do".** The "Needs attention" heading and
  "Nothing needs you right now" are gone; the bell carries what's due.
- **At a glance**, on a vault of 0.6.0 or later: how many documents, how
  many expire soon, and how many need details. Each opens Documents,
  narrowed to them.
- **Your Essentials on one line**: three of those kept on this phone, then
  how many more.
- **Recently added** shows the five added last; **See all** opens
  Documents.
- Notices that must be read stay as they were: a password reset, more
  people seeing identity details, and what an owner has limited.

## [0.4.3] — Documents, Notes, and the bell (redesign R3)

### Changed
- **The tabs are Home, Documents, +, Notes and More.**
  - **Documents** is one place for finding things. With the search box
    empty, it lists every document, 50 at a time, sorted and narrowed as
    All documents was. Type words, and it finds them as Search did,
    including the second look through your own Only me documents.
    Sorting, status and who can see it wait until the box is empty.
  - **Notes** has its own tab, instead of a row in More. People is now
    the row in More. On a vault without notes (before 0.9.0), People is
    the tab instead.
- **Needs attention is a bell** at the top of Home, Documents, Notes,
  People and More, instead of a tab. When something is due, the bell shows how
  many; when nothing is, it shows no number. A screen reader says it in
  words. The bell opens Needs attention, and Back comes back.
- Tab names are a little smaller, so "Documents" fits its tab at Large
  text.

## [0.4.2] — choices on one line, and asked before anything is lost (redesign R2)

### Changed
- **Choices on one line.** On the capture card and in Edit details:
  - "What it is" shows the three kinds you file most, and "Whose it is"
    shows you first. What's chosen always sits on the line.
  - **⋯** opens a sheet with every kind (grouped as in the browser, with
    a box to find one) or every person.
  - The rows of chips that ran down the screen are gone.
- **Smaller chips**: 32 high. They're still easy to press.

### Added
- **Asked before anything is lost.** One question, the same everywhere,
  says what will happen, what stays, and who else it touches, with the
  action in red and Cancel:
  - **Remove from this collection** (it used to happen at once). It
    names the collection, and says so when the collection is shared
    outside the family.
  - **Stop keeping it as an Essential**, from the document's page or its
    ⋯: phones that keep it remove their copy.
  - **Sign out**, now also asked when no scan is waiting.
  - Signing out another device, switching to another vault, removing the
    copies kept for no signal, and **Move to the Trash** asked before;
    they now use the same question.

## [0.4.1] — more on every screen (redesign R1)

### Changed
- **A compact scale, everywhere.** The first step of the redesign:
  - smaller type: words 14, secondary lines 12, small labels 11, titles
    22;
  - every gap and margin a step tighter;
  - a document's row 52 high, with a smaller picture;
  - other rows (More, Notes, People, choices in a sheet) a step lower
    too.

  Large text, the phone's own font size, and light and dark (following
  the phone, or as set in Settings) all work as before. Every button
  is still big enough to press.
- **A list is one card.** Documents on Home, All documents, Search, a
  person's page and a collection's page sit in one card, parted by thin
  lines, instead of a card per document.

## [0.4.0] — the polished app (polish P11)

The polish from 0.3.4 to 0.3.14, finished. In short:
- **The look:** the vault's own typefaces, spacing and corners, one way of
  drawing each row, sheet and chip, and a **dark theme** that follows the
  phone (or is set in Settings).
- **More** in People's place, with **All documents**, **Collections**,
  **Notes**, People, your Inbox, Account and Settings.
- **A document's page, finished:**
  - **Edit details**, **Who can see it** and **Move to the Trash** from the
    phone;
  - a new version's details confirmed, and older versions with their own;
  - its tags and collections.
- **What the vault read** of a scan you sent to your Inbox, confirmed on
  the phone.
- **The family's clock** for every date and time, grey rows while a list
  loads, and **Try again** wherever something can't load.
- **The vault's shield** as the icon and splash; a buzz on Save, on a scan
  and on Done; **Remove animations** respected; checked with TalkBack and
  at 200% text.

### Added
- Emulator runs for this release, against the vault the app is pinned to:
  - All documents sorted by title;
  - Who can see it changed and changed back;
  - a document's name corrected with Edit details, which the run then
    finds in the vault;
  - More with Collections and Notes;
  - the dark theme set from Settings.

  The run also takes screenshots of the lists in light and dark (with
  "Allow screenshots" on; a document's pages and the card are never
  captured).

## [0.3.14] — the finish (polish P10)

### Changed
- **The app's own icon and splash.** Until now they were the Expo
  template's. They now use the vault's shield, as the browser shows it:
  - white on the vault's green for the icon, and on Android's round and
    themed icons;
  - the shield on the page's own colour for the splash, light or dark as
    the phone is set.
- **Felt as well as seen:** a short buzz when you Save (the capture card,
  Edit details, New note, Who can see it), when a scan's pages are taken
  in, and when a reminder is Done. The phone's own touch-feedback setting
  decides whether it's felt, and each is still said in words.
- **Remove animations** is respected: with it on, screens change at once
  and sheets appear without fading in.
- **TalkBack:** the test build's banner is no longer read as a heading on
  every screen, and it's spoken as words rather than spelled out. All
  documents and a person's page are now checked like every other screen.
  Every control says what it is, and every control is big enough to
  press.
- **200% text:** the person chips' initials grow with the letter instead
  of being cut off. The banner follows the app's Large text. The 200%
  emulator run now also covers More, All documents, a document and its
  Edit details, Notes with New note, and Collections.

## [0.3.13] — collections and notes (polish P9)

### Added
- **Collections**, in More, for everyone who makes them (not viewers),
  where the vault has collections.
  - The list shows each collection you may see: how many of its documents
    you can see, who it's for, whether you made it, and whether it's
    shared outside the family.
  - A collection's page shows its documents, 50 at a time, in the order
    they went in, with the same rows as everywhere else. It says who it's
    for, and that a collection never shows anyone a document they
    couldn't see already.
  - For the collection you made:
    - **Add documents** offers the newest, or finds them by words. Tick
      the ones you want; those already in it say so. The vault's warning
      about who else will now see them is shown.
    - **Remove from this collection** is in each row's ⋯. The document
      stays in the vault.
  - Making, sharing and checklists stay in the browser.
- **Notes**, in More, on a vault of 0.9.0.
  - Your notes, newest first, each named by its title or its first words,
    with when it last changed and, when it isn't for the whole family,
    who can see it.
  - **Find in notes** narrows them. A note opens like any document.
  - **New note** asks for a title, who can see it and the words. It warns
    when the words look like a password or a PIN, and an Only me note
    says that its title isn't sealed. Saved, it opens.

## [0.3.12] — a document, changed from the phone (polish P8)

### Added
- **Edit details** on a document's page, for whoever may change it. It
  asks what the capture card asks, already filled in:
  - what it is and whose it is;
  - its name, and the fields its kind shows (issued by, number, dates,
    where the paper is kept);
  - the kind's own details.

  **Save** checks what the card checks and says what's still needed, in
  the kind's own words. Empty a field and it's taken away. On a vault
  that keeps each version's details, saving also confirms them for the
  newest version. If someone changed the document meanwhile, nothing is
  overwritten: the phone says so and shows it as it is now.
- **Who can see it** can be changed from the page: press the chip and
  choose, as the browser allows you (Everyone in the family, Adults only,
  Only me). Making a document Only me while you have share links to it
  asks whether they end or keep working, where the household lets them.
- **Move to the Trash**, after an "are you sure?". It can be brought back
  from the Trash in the browser. A teen can do this only for their own
  documents.
- A document's **tags** and the **collections** it's in are shown on its
  page.
- Home, Needs attention, Search and All documents look again when a
  document changes or goes to the Trash.

## [0.3.11] — all your documents (polish P7)

### Added
- **All documents**: every document you may see, in one list, with the
  same rows as Home and Search, each with its picture. You reach it with
  **See all** beside Recently added on Home, or from More.
  - **Sort** by when a document was added, by title, or by when it
    expires.
  - **Narrow** by whose it is, its kind, its status (Expired, Expiring
    soon, Needs details, In date, No longer needed) and who can see it.
    Press a chosen chip again to let go of it.
  - The first 50 come at once, and the next 50 as you scroll to the end.
  - The list says when nothing matches, and how to widen it. It shows
    grey rows while it loads, and Try again when it can't load.
  - Search keeps its own job: words first.

## [0.3.10] — More (polish P6)

### Changed
- **A More tab in People's place.** The tabs are now Home, Search, the +,
  Needs attention and **More**. More leads to:
  - **People**, as before;
  - **your Inbox**, with how many wait there, opened in the browser
    (where the vault has one and you may add documents);
  - **Account**;
  - **Settings**.

  Collections and notes join it later in the polish. The gear on Home
  still opens Settings.
- **Account** holds what was at the top of Settings: which vault this
  phone uses and how it's reached, the versions (seven taps still open
  Timings), who is signed in, **Use another vault**, what a guest may see
  and until when, and **Signed-in devices**. Settings holds only settings,
  and Sign out.
- The tabs have a little more room. The app's own typeface is wider than
  Android's, and "Attention" at Large text now fits its tab with room to
  spare on a 360 dp phone.
- The spike screens are in development builds only. A test build you
  install no longer shows them in Settings.

## [0.3.9] — loading, failures, and the family's clock (polish P5)

### Changed
- **While a list loads, you see it coming.** Home, Search, Needs attention,
  People, a person's page and a document show grey rows the shape of
  what is coming, instead of nothing. They don't move, and a screen reader
  hears "Loading" once.
- **A list that couldn't load says so.** When something other than the
  connection goes wrong, the screen says "Couldn't load this. Try again in
  a moment.", or the vault's own words for its answer, with **Try again**.
  Before, it showed nothing at all. The app's log records what kind of
  failure it was, never its words. No connection is still the offline
  notice, as before, and being signed out still goes to Sign in.
- **Every time is on the family's clock**, as the browser shows it since
  0.9.0: the family's time zone from the vault, whatever zone this phone is
  in. Where the phone's clock reads otherwise, a time says which clock it
  is on ("6:00pm PST"). It covers:
  - a version's "Added…" and a note's "Edited…";
  - when a document was marked no longer needed;
  - Home's notices, and when your devices were last used;
  - an Essential's checked and kept-until dates;
  - "today" for snoozes, the card's dates and an Essential's status
    offline.

  A date without a time, such as an expiry, is the same day everywhere.
  The phone keeps the family's zone for each vault, so it holds offline
  too. A vault before 0.9.0 says none, so the phone's own zone is used.

## [0.3.8] — light or dark (polish P4)

### Added
- **A dark theme**, the web's soft one: a slate-blue page, cards a little
  lighter, soft light words, the brand's green lightened, and warm warning
  and error colours. Every colour passes the same contrast checks as the
  light theme. By default the app follows the phone's own setting, and
  changes with it. Settings → **Light or dark** can fix it to **Light** or
  **Dark** instead; this phone remembers the choice.
- Scans, page previews and photos stay on white paper in the dark, and Show
  mode keeps its own black. The status bar, the window behind each screen
  and the back arrow follow the theme. Large text works the same in both.

## [0.3.7] — what the vault read (polish P3)

With a vault that reads what comes into the Inbox and files it from a card
(`batch_review`, 0.7.0 or later). With an older one, Send to my Inbox works
as before.

### Added
- **What the vault read of a scan sent to your Inbox**, on Home under the
  Saved line. While the vault reads it, Home says "The vault is reading
  your scan…". Then it shows what it read: what it is, whose it is, the
  issuer, the dates and the number. It also says, in the vault's words,
  anything the vault isn't sure of. The vault reads the scan; the phone
  never does.
- **File it like this.** When the vault calls the scan Ready, it can be
  filed from the phone. The phone files exactly what the browser files
  for a card nobody changed, with the batch's defaults. Then Home says
  what it was filed as, with **Open it**.
- **Finish in the browser.** A scan the vault isn't sure about, one it
  already has, a probable new version of a document, or pages it couldn't
  read are finished in the browser, at that very item. There, any detail
  can be changed. Nothing is ever filed unasked.
- If the vault takes longer than 3 minutes to read it, Home says it's
  safe in your Inbox, where you can finish it.

## [0.3.6] — new versions, confirmed (polish P2)

With a vault of 0.9.0 (0.9.0-dev.25 or later), which keeps each version's
own details. With an older vault nothing below appears, and the app works
as before.

### Added
- **What a new version says.** A new version starts with the details of
  the one before, unconfirmed, and the vault reads its pages. A document's
  page now shows **The new version says:**, with each detail its pages
  read differently and what it was. For example: "Expires 1 Mar 2035 (was
  1 Mar 2025)". Sure readings are ticked. Weak ones are marked "check
  this" and left for you to tick. **Use these** makes the ticked ones the
  new version's own. The vault makes the reminders again from the new
  date, and **Undo** takes it back for 5 minutes. **Not now** puts it
  away for that version. Nothing changes until you choose. The card shows
  only to someone who may change the document. While the vault is still
  reading the pages, the page says so. If the document was changed
  somewhere else meanwhile, nothing is saved, the page says why, and it
  loads again.
- **After Scan the new one**, Home says when the new version is in the
  vault, with **See what it says**, which opens the document.
- **Older versions in a document's history** show their own details
  (issuer, dates and the kind's own fields, as they were when a newer
  version replaced them), and **Its pages** opens that version's pages,
  confirming it's you where the newest version's pages would ask.
  A version replaced before 0.9.0 says its details weren't kept.

## [0.3.5] — the look (polish P1)

The first step of the polish towards 0.4.0. Nothing new to do: the same
screens, drawn as the project's design says.

### Changed
- **The app's own typefaces.** Headings are in Fraunces and everything
  else in Figtree, as on the web. Both were already inside the app, but
  nothing used them, so every screen drew in the phone's own font.
- **One way to draw each thing.** Every document in a list (Home, Search,
  a person's page) is the same row: a picture of its newest page where the
  list knows it, or a tile showing what kind of thing it is (a search
  result), then its name and status. Search's chips are the capture card's,
  with an edge you can see. Every question or set of choices over a screen
  (the ⋯ menu, Add, signing out, changing vault, removing offline copies,
  confirming it's you, Essentials' password, a note's link) is one sheet,
  with rounder corners and a slight lift off the page. Back closes it; a tap
  on the shade still closes the menus, and still doesn't close a question.
- **Spacing and corners from the shared scale**, as the web and the
  prototype space things. A few 2-point gaps under a name became 4.
- The capture card's messages for a detail it can't read (a date, a year,
  a number or an amount) come from the app's words, unchanged.

## [0.3.4] — the vault's shared code of v0.9.0-dev.25

A patch for a vault of 0.9.0. It still works with a vault of 0.8.0 and
0.7.0 (and, as before, 0.4.10 or later), where nothing below appears.

### Changed
- Built against the vault's shared code of v0.9.0-dev.25 (was
  v0.8.0-dev.8), and Expo SDK 57's latest patches (expo 57.0.32, with
  @expo/metro-runtime, expo-build-properties, expo-constants,
  expo-dev-client, expo-image-picker, expo-router and expo-sharing), as
  expo-doctor asks.
- A vault of 0.9.0 keeps each version's own details, and a new version
  starts from the one before's until somebody confirms them. The phone
  doesn't show either yet. It changes a document only by its Essential
  switch, one field at a time, so it never confirms a version's details
  for anyone.
- **A document no longer needed reads "No longer needed", never
  Expired.** A vault of 0.9.0 can mark a document as kept but no longer
  needed: its expiry then says nothing, and nothing reminds of it. The
  phone shows the vault's word for it, plainly and not as a warning, in
  every list and on its page. A kept Essential marked so reads the same
  with no connection, however long ago its expiry passed (the phone works
  out a kept copy's status itself, and now passes the mark on, as the
  vault does). Its page also says when it was marked and by whom (where
  the vault tells you), why, as written, and what replaced it, which opens
  from there. A replacement you may not see is "another document", as the
  vault names it. Marking a document, or needing it again, is done in the
  browser.
- **A note is shown as a note.** A vault of 0.9.0 keeps notes as
  documents of their own, with no file. A note with no title is named by
  its first words (or "Untitled note"), in search, on Home and on a
  person's page. Its page shows its words, with no Save a copy, Show the
  pages, versions, Add a new version or Essential, and neither does its ⋯.
  Writing and changing a note is done in the browser.
- **The capture card never offers Note as a kind.** The vault lists the
  kind of a note once the family has notes, but a scan is never filed as
  one (the vault refuses it).
- The vault's two new kinds of 0.9.0, a pay statement and an investment
  statement, show by their own names and words, as every kind the vault
  lists does.

## [0.3.3] — a scan is sent again, and a failure says so

A patch for 0.3.2, which sent no scans. It works with the same vaults as
0.3.2: 0.8.0 and 0.7.0 (and, as before, 0.4.10 or later).

### Fixed
- **A scan is sent again.** Since 0.3.2 no scan, renewal or Inbox scan
  left the phone: each one waited under "Not sent yet. Your scan is safe on
  this phone and will go by itself", online or not. The vault's shared
  code of v0.8.0-dev.7 and later draws each upload's multipart boundary
  from Web Crypto's `crypto.getRandomValues`, which Hermes does not have,
  so making the upload's body threw before anything was sent, and the
  queue took that for no connection. The app now gives the shared code
  the phone's own secure random numbers (expo-crypto's) as
  `crypto.getRandomValues`, before anything else loads. The emulator flows
  (Maestro), which had not run since 0.3.0, found it.
- **A scan the phone can't send says so.** Only a missing connection —
  no answer from the vault, a fetch that found no network, a timeout, or
  a vault the phone may not send to here (not the approved one, or off
  Wi-Fi) — still reads "Not sent yet… will go by itself" and goes once
  the connection is back. Any other failure, such as the missing
  `crypto` above, now reads "Couldn't send this scan. It's still on this
  phone." under Needs you, with Try again and Remove it. It is not tried
  again by itself, and the log records what kind of error it was, never
  the scan's details. A refusal or a busy answer from the vault is handled
  as before.

## [0.3.2] — the vault's shared code of v0.8.0-dev.8

A patch for a vault of 0.8.0: nothing new to see, and the app still works
with a vault of 0.7.0 (and, as before, 0.4.10 or later).

### Changed
- Built against the vault's shared code of v0.8.0-dev.8 (was
  v0.8.0-dev.2), and Expo SDK 57's latest patches (expo 57.0.30, with
  @expo/metro-runtime, expo-constants, expo-linking and expo-router), as
  expo-doctor asks.
- **A will, a vehicle's logbook, an employment contract and a property
  deed no longer need an expiry.** The card still offers Expires for them,
  but no longer marks it required, and Save no longer waits for it; on the
  phone, with no connection, one without an expiry reads Valid, not "Needs
  an expiry date", as a vault of 0.8.0 says. One with an expiry given is
  Expiring or Expired as before. Every other kind that expires, and every
  kind of the household's own, still asks for its expiry. The rule is the
  vault's shared code's (`expiryOptional`): the vault still says these
  kinds' expiry is required, as it says of every kind that expires. A
  vault older than 0.8.0 still asks for it: there, such a document stays
  Needs info in the vault while a kept copy reads Valid on the phone.
- **Two new kinds, as a vault of 0.8.0 lists them:** a credit card
  statement (its expiry is the payment's due date, "Payment due", and it is
  asked for) and a school report (no expiry). The phone knows kinds only as
  the vault lists them, so both show by their own names and with their own
  words for their fields, with nothing of the phone's own to change.

## [0.3.1] — the vault's shared code of v0.8.0-dev.2

A patch: nothing new to see, and the app still works with a vault of 0.7.0
(and, as before, 0.4.10 or later).

### Changed
- Built against the vault's shared code of v0.8.0-dev.2 (was
  v0.7.0-dev.12), and Expo SDK 57's latest patches (expo 57.0.28, with
  expo-crypto, expo-dev-client, expo-router, expo-screen-orientation,
  expo-sharing and jest-expo), as expo-doctor asks.
- **The Inbox count on Home is one light count.** Home asks the vault how
  many of your files wait (`GET /api/v1/batches/counts`, after 0.7.0)
  rather than listing every batch to add them up. A vault without it — one
  that answers 404, or 422 as a 0.7.0 candidate up to rc.2 does — is asked
  for the list, as before. Only your own files are counted, as before.
- Home and the capture card's choices use the client's own way of not
  waiting (`token({ wait: 'join' })`) in place of the phone's: they join a
  renewal of the session already on its way, but are answered at once when
  the vault has turned one away for too many tries, and show what the
  phone has meanwhile. Signing out gives a renewal on its way its moment
  the same way. Unlike before, a read of Home's on its own no longer
  starts a renewal that waits out the refusal in the background: Home says
  there is no connection, and asks again the next time it looks, once the
  vault's wait is over. Anything else that waits (the uploader) still says
  "The vault asked us to wait 30 seconds." while it does.

## [0.3.0] — Phase 6, I5: the phone feeds the Inbox

A new minor version: what it adds needs a vault of 0.7 (0.7.0-dev.12 or
later, with batches). With an older vault (0.4.10 or later, as before) the
app is as in 0.2.3: Skip is still Skip, and Home shows no count.

### Added
- **Send to my Inbox.** On the capture card, Skip becomes **Send to my
  Inbox** for anyone who may add documents (an owner, an adult, a teen): the
  scan goes up to your Inbox instead of becoming a document with no name.
  The vault reads it and suggests what it is, whose it is and its dates;
  you finish it on the web. Home says "Sent to your Inbox. Finish it on the
  web: it will suggest the details." once the vault has it, and a screen
  reader hears it. Nothing of it is shown on the phone afterwards, and
  nothing of it is kept on the phone once it has arrived. Scans sent the
  same day go into one batch, "From my phone, 10 Oct": made by the first,
  or found by its name if it is already there (from another of your
  phones, or a try whose answer was lost). With no connection the scan
  waits on the phone, as every scan does, and goes — into the batch of
  the day it goes — once there is one; a card opened with no connection
  since the app started offers it as the vault last said. Each scan keeps its own key, so one
  sent again after its answer was lost is in the Inbox once. A batch that
  has ended or is full gets a new one, and so does the day's batch removed
  on the web before a scan went into it; a scan removed on the web — itself
  or with its batch — before the phone heard it arrived is simply done,
  never sent again. A vault put back to a version without batches files
  the scan as a document only you can see — never anyone else — and Home
  says "Saved as a document only you can see. Add its details on the web."
  "Back" on the card offers Send to my Inbox too, instead of Save without
  details.
- **The Inbox count on Home**: "3 waiting in your Inbox: review them in
  the browser", with the address it is reviewed at (your vault's /inbox)
  and a button that opens it. Only your own waiting files are counted —
  nobody else's are ever seen — and nothing is shown when none wait, or to
  a viewer or a guest, who are never asked. It is asked again when Home is
  in view again, when the app comes back to the front, and after a scan is
  sent.

### Changed
- Built against the vault's shared code of v0.7.0-dev.12 (was v0.5.37). A
  renewal of a session the vault turns away for too many tries, with a
  short wait, is now waited out and asked again (at most twice) rather than
  reported at once — and Home says "The vault asked us to wait 30 seconds.
  Trying again then." meanwhile. Signing out never waits for it, nor do the
  capture card's choices or Home's refreshes, which use what the phone has.
  Signing out while a renewal is on its way gives it up to 3 seconds, so
  this phone's notifications and its session are ended at the vault too.

## [0.2.3] — iteration 5.36: a menu on every row, what you may see, and notes

Each of these appears only with a vault that has it; with an older vault
(0.4.10 or later, as before) the app is as in 0.2.2, but for the menu on
every row, which offers what that vault allows.

### Added
- **A menu on every row.** A document's ⋯ in a list — Home, Search, a
  person's documents — and a long press on its row open what its page
  offers, without going there first: **Open**, **Show** (an Essential),
  **Save a copy**, **Add a new version**, **Make it Essential** or **Stop
  it being Essential** (an Essential is what a phone keeps for when there
  is no signal), and **Add to a collection** with a vault that has
  collections (0.5.12 or later). Only what would not be refused is
  offered: somebody who changes nothing — a viewer, and so a guest — has
  Open and Save a copy, as on the web; a teen changes only their own. A
  search result's sheet asks the vault for the document as it opens, and
  opened again starts from what it last had, not the list's older copy;
  Essential is changed only once the vault has answered. Add to a
  collection lists the collections you made, says where one is shared
  outside the family — a screen reader hears it with the Add button too —
  and after adding, who else will now see it ("Jane Smith (guest) will be
  able to see this."): the sheet stays open until the vault has answered.
  Collections you made for people you are no longer one of are said to be
  so. A screen reader hears "Actions for “Passport”", starts on the first
  choice, and is taken back to the ⋯ when the sheet closes.
- **What you may see.** When an owner has limited what you can see (a
  vault of 0.5.33 or later), Home and Settings say so in the vault's words:
  "You can see: Tax return documents for Ahmed and your own." A guest — a
  sign-in for somebody outside the family, a vault of 0.5.34 or later — is
  told when their access ends, on the family's clock, named ("… ends Friday
  4 December 2026 at 23:59 (Europe/London, the family's clock)"), or, when
  the phone cannot learn the family's clock, on this phone's, named so.
- **When a guest's access has ended**, the phone says "Your access to this
  family's vault has ended. Ask them to renew it if you still need it." —
  when the vault ends the session (told by push too, once the vault says
  why), and at sign-in once the password is right; not "wrong password",
  and not the words for a session that simply went. Anything kept on the
  phone goes, as for every end but an expiry.
- **Notes on a document**, read only, with a vault of 0.5.35 or later:
  bold, italic, bulleted and numbered lists, checklists (shown, not
  ticked) and headings, drawn from the vault's shared reading of the note
  as the phone's own text — never as HTML, so a `<script>` in a note is
  just those characters. A link goes only to https, http or mailto, shows
  the address it goes to, and asks before it opens ("Open
  https://council.example/pay in your browser?"). An address that could
  pass for somewhere it does not go stays text: one with a hidden or
  direction-changing character, a name before its host, or a host not in
  plain ASCII — the phone's URL parser, unlike a browser's, does not turn
  a host such as a Cyrillic look-alike into punycode, so such a link is
  never one here. Who last changed the note, and when, is said under it.

### Changed
- **The capture card's choices — the family's kinds of document and people —
  are fetched and kept only for someone who may add documents.** A viewer,
  a guest from outside the family among them, keeps nothing of the family
  on their phone; and when the vault ends a session because the person's
  access ended, they were taken out or it was revoked, what the phone kept
  for that person's card goes with it.
- Built against the vault's shared code of v0.5.37 (was v0.5.32).

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
