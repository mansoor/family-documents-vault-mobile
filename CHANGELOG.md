# Changelog

All notable changes to the Family Vault phone app. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the
app's own, tagged `vX.Y.Z` in this repository.

## [Unreleased]

## [0.27.0] — Getting back in without your second step

Re-pinned to the vault's **v0.9.0-dev.104**, which adds recovery codes and
security questions to stand in for a lost second step, and refuses a
sign-in whose code by text can't be sent instead of letting the password
alone in. Everything new is offered only where the vault says it has it
(`features.recovery_codes`, `features.security_questions`); on an older
vault the phone is as it was. The phone's minimum vault stays 0.4.10.

### Added
- **Use a recovery code, or Answer your security questions, when signing
  in.** Under the code, where the vault says either may stand in. Each
  asks for a new password too, which replaces the old one there and then;
  a password the household's rules refuse is said by it, in the vault's
  words. Signed in so, your authenticator app, passkeys and codes by text
  are taken away and every other device is signed out, as on the web.
- **A code by text that can't be sent no longer lets you in on the
  password alone.** Sign in says so in the vault's words and offers what
  may stand in; if a passkey of yours would do, it points you to the
  browser, as the app can't use passkeys yet. Recovered on another device
  and not finished there, Sign in says that too.
- **Set up two-step sign-in again** after getting back in that way: an
  authenticator app, or codes by text (not for owners), then ten new
  recovery codes, shown once — Copy (cleared from the clipboard in a
  minute) or Share or save — and the app goes on once you tap I've kept
  them. If they can't be made, Make my recovery codes tries again. Setting
  up two-step sign-in when the vault asks for it now makes them too.
- **Account → Recovery codes**: how many are left, a warning when two or
  fewer are, and new ones made after confirming it's you (asked first: the
  old ones stop working). Turning on two-step sign-in or codes by text in
  Account makes ten, if you have none yet.
- **Account → Security questions**: three, chosen from a list or in your
  own words, set or changed after confirming it's you and removed after
  asking first; your answers are never shown again, and the card says
  plainly that relatives may know such answers.
- Recovery codes and security answers are never in a screenshot, a screen
  recording or the recent apps view while they show.

## [0.26.0] — Recent's Added and Opened, tags as other apps offer them, and the keyboard out of the way

Re-pinned to the vault's **v0.9.0-dev.103**, which remembers the documents
each person opens (0.9.0-dev.102) and the tags used most recently
(0.9.0-dev.103), as its web uses them. Each is used only where the vault
says it has it (`features.recently_opened`, `features.recent_tags`): an
older vault's Home, tags and filters are as they were. The phone's minimum
vault stays 0.4.10.

### Added
- **Home's Recently added is now Recent, with two tabs, Added and
  Opened**, in the same place, as on the web. Added is what it always was;
  Opened is the five documents you opened most recently — yours alone,
  never anybody else's, and only those you may still open. The tab you
  chose last is where Home starts, on this phone. Nothing opened yet says
  so; each row has the same ⋯ as Added's, Print included. On an older
  vault it stays Recently added, with no tabs.
- **Opening a document's page tells the vault**, once as it opens: never
  for a list, a refresh, or coming back to it from a screen it opened, and
  never a note. If the vault can't be told, nothing is said: the page is
  open all the same.
- **Tags as other apps offer them.** In Edit details and in a note, the
  Tags field offers the five tags used most recently as soon as it has the
  focus, as pills just above it under **Recently used**; as you type, the
  tags already used that fit. A screen reader hears that they are there,
  once as they appear. A tap adds one; a new word is added with Add or Done as before. A
  tag the document has is never offered. An older vault offers nothing
  until you type; with no connection, nothing is offered and adding works
  as before.

### Fixed
- **The Documents filter offers a tag added since the app started.** Its
  tags were read once, so a tag put on documents later (on the phone or
  elsewhere) waited for the app to start again; they are now read again
  each time the filters open, and when you come back to Documents after
  changing a document — the most recently used first, where the vault can
  say. While the filters are open the tags keep their order, so none moves
  under your finger; one just added is offered at the end until they are
  opened again.
- **The keyboard no longer hides what you type.** On Android the app is
  drawn edge to edge, where the screen no longer shrinks for the keyboard,
  so a field low on the screen was typed into blind. Now the field being
  typed in is scrolled to just above the keyboard on every screen with
  fields — Edit details (its Tags among them), a note, a new note, a
  collection's checklist, emergency information, the capture card,
  sign-in and connecting, Account and Settings, asking for documents, the
  update screen — and every sheet or side panel with a field rises with
  the keyboard (sharing, a link's changes, a collection, a clinician's
  link, "Confirm it's you", the filters' and Activity's panels, and the
  rest), the field given the focus brought to the top of what it scrolls.
  Cancel and Save ride on the keyboard, the field kept above them, and a
  sheet leaves no empty band above the keyboard.

## [0.25.0] — Print from the ⋯ menus, and password rules

Re-pinned to the vault's **v0.9.0-dev.98**, which adds password rules an
owner sets in Settings → Security. Print from the menus needs nothing
newer; the rules are said where the vault has them, and an older vault
keeps the ten characters it asked before. The phone's minimum vault stays
0.4.10.

### Added
- **Print in the ⋯ of a document or a note** — on Home (Essentials and
  Recently added), in Documents and in Notes — and in the ⋮ over a
  document's pages, after the other choices. It does what Print on its
  page does, without going there first: a document asks whether to print
  its pages, a sheet of its details or both; a note prints its words. It
  is offered by the page's own rule — a note once it has words, never a
  paper seen only as somebody's caregiver — and needs a connection, as on
  its page.
- Anything **Sensitive** says first to keep the printout safe, as on its
  page; Cancel goes back to the choices and prints nothing. An Essential's
  or an Only me document's pages ask "Confirm it's you" before they are
  read, and a note that asks (Only me, or an Essential) asks before its
  words are read — in Notes' ⋯, a Confirm it's you button where the vault
  gave nothing without it.

### Changed
- **Change your password follows the household's password rules** where
  the vault has them: the line under the new password says them ("At
  least 12 characters, with a number. Not a common password, nor your
  name or email address."), what the password still lacks is said as you
  type, and Change it waits until it has the length and mix asked for.
  Whether it is common is the vault's to say: its refusal is shown in its
  own words under the new password, never as a wrong password now.

## [0.24.0] — Back and ⋮ on a document's pages, and System health

Re-pinned to the vault's **v0.9.0-dev.97**, whose web renames Security &
health to System health. Nothing here needs the newer vault. The phone's
minimum vault stays 0.4.10.

### Changed
- **A document's pages have ← Back before the name** in place of the ✕
  in the corner. It goes back where the pages were opened from, as the ✕
  did: a document's page, or On this phone.
- **Security & health in Settings is now called System health**, as on
  the web. What it shows an owner is unchanged.

### Added
- **A ⋮ in the corner of a document's pages** opens the same choices as
  the document's ⋯ in a list — Show, Share, Save a copy, Add a new version,
  Essential and Add to a collection, each for whoever may — with the same
  questions and "Confirm it's you" as there. A kept Essential note's pages
  offer Edit first, as its ⋯ in Notes does. It is there for whoever is
  signed in: a kept Essential read while signed out has none.

## [0.23.0] — Visibility, a note's Sensitive while it is edited, and printing what is Sensitive

Re-pinned to the vault's **v0.9.0-dev.96**, which makes the same changes
on the web. Nothing here needs the newer vault: a note's words and its
Sensitive were already saved together. The phone's minimum vault stays
0.4.10.

### Changed
- **"Who can see it" is now called Visibility**, wherever it names who in
  the family may open a document or a note: the line on a document's and a
  note's page and the choice it opens, a new note, the capture card, the
  filters, and a printed details sheet. Who can see someone's emergency
  information and a caregiver's medical papers keep their own words: they
  are about something else.
- **The Visibility line no longer says Everyone, Adults or Only me beside
  its name**: the line under the title already says it. A line that can't
  be changed from here (a viewer's, or with no connection) still says it,
  as it opens nothing.
- **A note's Sensitive is switched while you edit it**, beside its tags,
  and saved with its words when you press Save — one save, so a note that
  asks "Confirm it's you" asks once for both. Cancel leaves it as it was. A
  note's page no longer has the switch: it only says **Sensitive** beside
  the note's status. The rules are as before: a teen can make their own
  note sensitive but only an adult can make it not sensitive, a switch left
  alone never undoes somebody else's change, and if links outside the
  family still give the note, you are asked after saving whether to keep
  or end them. **Essential** stays a switch on the note's page.

### Added
- **Printing something Sensitive says so first**: "This is marked
  Sensitive. Keep the printout somewhere safe and shred it when you no
  longer need it." For a note it is asked with **Print** and **Cancel**;
  for a document it is at the top of What to print. Cancel prints nothing,
  and nothing more is asked of you than before. The printout's heading says
  Sensitive too ("Adults only · Sensitive"), even when only a document's
  pages are printed.

## [0.22.0] — My cabinet arranged by levels, browsed on the phone

Re-pinned to the vault's **v0.9.0-dev.91**. The vault now arranges a
cabinet by 2 to 5 levels the person chooses and orders (Topic, Person,
Year, Kind and Who issued it), a cabinet may have its own arrangement, and
a folder's papers may be divided by two levels. This app browses all of
it; arranging stays on the web, one tap away as before. Each change needs
the vault's own (`features.cabinet_levels`, `features.cabinet_issuer`): an
older vault's cabinet looks as it did. The phone's minimum vault stays
0.4.10.

### Added
- **A level with only one group is passed over while browsing**, as on the
  web: a cabinet with one drawer opens straight on its folders, under "In
  the 2026 drawer.", and its line says how many folders it holds; a drawer
  with one folder is one row, "2024 › Me", that opens the folder. Back
  from the folder goes straight back to the cabinet. Nothing is saved: a
  paper that brings a second drawer or folder just adds it. The folder's
  path still names every level.
- **Dividers by two levels**: a folder divided by, say, Who issued it and
  then year shows a tab for each issuer, with its years inside it, each
  with how many papers are behind it; the first with papers opens already.
  A step with only one value is passed over, a folder with one value at
  every step is one plain list, and past a hundred dividers the smallest
  are behind **Everything else**.
- **What a cabinet is arranged by**, beside its total: "Arranged by Topic ›
  Year › Person", or "Arranged by hand" ("Arranged on the web" for a level
  this app doesn't know yet); a cabinet with its own
  arrangement says **Own arrangement**, and one arranged by hand beside the
  drawn ones says so, on its line and on its own screen.
- **Who issued it** in what a folder holds, by the household's own names
  ("P60 from Barclays."), and "with no issuer given" for a folder of papers
  with none; the household's names are asked for once, and only by a folder
  that names an issuer. Folders for the household and for Not sure yet say
  so too.

### Changed
- An older vault's arrangement is said in the same words as levels
  ("Arranged by Person › Kind").

## [0.21.0] — Notes that ask "Confirm it's you", Essential notes kept offline, and printing

Re-pinned to the vault's **v0.9.0-dev.87**. The vault now asks "Confirm it's
you" before an Only me or an Essential note's words are read or saved, as
it does for a document's pages; this app asks with it. The phone's minimum
vault stays 0.4.10: an older vault's notes simply never ask.

### Added
- **Notes that ask "Confirm it's you"**: opening an Only me or an Essential
  note, or changing one, asks once (then not again for five minutes).
  Cancelled, the note's page says so, with **Confirm it's you** to ask
  again, and nothing asks by itself meanwhile. Sensitive alone never asks.
  In Notes, such a note shows its title and date, a lock and "Confirm it's
  you to read it", never its words.
- **Essential and Sensitive on a note**, on its page, by the documents' rules
  (a vault of 0.9.0-dev.87): turning Essential off asks first, and confirms
  it's you; a teen can make a note sensitive, never not; made sensitive while
  a link outside the family still gives it, it asks whether to end the link.
  Notes show Essential and Sensitive on their line in Notes.
- **Essential notes kept on the phone**, words and all, in the same encrypted
  stores as the kept Essentials (an Only me one with the Only me ones, opened
  with a fingerprint or face). They are listed under On this phone and open
  on their own page with no connection, behind the same lock. One no longer
  Essential, moved to the Trash or gone from sight leaves the phone at the
  next sync (straight away when changed on this phone), and they all go on
  signing out, as the Essentials do. A note kept here shows its words from
  the phone while "Confirm it's you" is waiting. Kept notes are named by
  their title (or "Untitled note") on Home and under On this phone, never
  by their first words; an Only me note changed while its store is closed
  catches up the next time it is opened.
- **Print**: a document (its pages, a sheet of its details, or both; pages
  that ask "Confirm it's you" ask first; the first 20 pages at most, and the
  printout says when some were left out or couldn't be read), a note, a collection's contents as
  a table (with a box to tick beside each, if wanted) and the Activity log
  as its filters show it. It uses the phone's own print screen, which can
  also save a PDF, with nothing of the app around the page, the family's
  dates, and the vault's name and when it was printed at the foot. Never a
  PIN or a link.
- **My cabinet's total**: how many documents it holds, each once; how many
  are in no folder, which opens them as a list (**Not in any folder**); and
  how many are in more than one, which is why the folders add up to more.
- **A PIN on a request for documents**, as on a share link, where the vault
  offers one: made up by the vault, shown once with the link, never with a
  password. A request's PIN can be kept, changed for a new one or taken
  away when it is changed.
- **Security & health** in Settings, for owners (a vault with it): the last
  backup and its copy off-site, the restore drill, the activity log's
  nightly check, failed sign-ins and sign-ins used from two places, each
  fine or what to do, as the web says it; Activity opens from it.

### Changed
- **The release build reaches a vault over https only**: no plain
  `http://`, and Connect asks for the vault's https address instead of
  trying. It still accepts a certificate installed on the phone by hand (a
  vault that makes its own), for now: one switch makes it strict before the
  app goes live, and Connect then says plainly that such a certificate
  can't be used. The test builds keep plain http on the home network and a
  certificate installed by hand, for the throwaway vaults they reach.
- A code given twice is told apart by the vault's own reason for it, as well
  as by its words.

## [0.20.0] — An app too old for the vault says so, and signing in as the vault of 0.9.0 asks

Re-pinned to the vault's **v0.9.0-dev.79**. A vault from 0.9.0-dev.79 on
tells a phone app older than it works with to update; this app now listens,
everywhere, and says so on one screen. Signing in follows the vault's
0.9.0 rules: two-step sign-in for owners (and adults, where the household
asks), too many tries, a code taken once, and this phone remembered.

### Added
- **"Update the app"**, over everything else, when the app is too old for
  the vault: whenever the app reads what the vault can do (as it starts,
  coming back to the front, Try again), and whenever the vault answers any
  request, a renewal of the session included, that it wants a newer app.
  It says so plainly, with the version the vault needs and this one; **Update
  the app** opens this app's releases page; **Try again** looks again; **Show
  what's kept on this phone** opens the kept Essentials, which need no
  vault; **Sign out** still works, and says first that the kept Essentials
  go with it (signed out already: **Use a different vault**). Nothing kept
  on the phone is removed, and nobody is signed out by it. It covers the
  screens rather than closing them: a scan's card, a note or an edit being
  written stays as it was, and once updated, the app carries on where it
  was.
- **"Your vault needs updating"**, the same way, when the vault is older than
  the app works with: whoever runs the vault updates it (**Show how**).
- **Set up two-step sign-in** when the vault asks it first (an owner, or an
  adult where the household asks every adult): its own screen, before the
  tabs, with the authenticator app set up right there, as in Settings, or a
  passkey in the browser and then **Carry on**. A sign-in that has two-step
  sign-in but used the password alone types a code to carry on. Started
  again before it is set up, the app shows this screen at once, never the
  tabs first.
- **Too many tries** at signing in: how long to wait, in minutes or seconds
  (read from the vault's own words where the browser hides the header),
  and Sign in waits until then.
- A second step that is **a passkey alone**: the app can't use passkeys
  yet, and says to sign in in the browser, or to add an authenticator app
  there.
- **This phone remembered** by the vault: its proof that it signed in before
  is kept in the phone's keystore, one per vault, through signing out, and
  sent with the password, so failed tries from anywhere else never make it
  wait. A vault reinstalled at the same address gets none of the old one's.
- Connect: an app too old for the vault offers **Update the app** too.
- Failure states: the update screens, two-step sign-in to set up first, the
  wait after too many tries, a passkey as the only second step, and a code
  used already.

### Changed
- A code from the authenticator app given twice says **"That code was used
  already. Wait for the next one."**
- Scans and notes waiting on the phone keep waiting while the app is to be
  updated or two-step sign-in set up first — nothing is tried meanwhile, and
  a note's day under its key starts only with a try that could make it —
  and go once it is: neither is a refusal of them. A new note saved then
  waits on the phone too.

## [0.19.0] — Emergency information changed on the phone, who sees it, and the wallet card

Re-pinned to the vault's **v0.9.0-dev.66**. A person's emergency
information is now changed on the phone as on the web (H4): what is on it,
who can see it, and a wallet card to print. It needs the vault's
emergency information (`features.emergency_info`, 0.9.0-dev.47 on), as the
page itself always has.

### Added
- **Edit emergency information**, on a person's emergency page, for the
  person and the owners (the vault decides; nobody else sees Edit). Every
  part the web's editor has, as one compact form with Cancel and Save at its
  foot: blood type; allergies, medications, conditions, doctors and who to
  call, each entry with its name and the web's other parts (a medication's
  dose as written, a doctor's practice, who somebody is, a phone, a note);
  insurance (insurer, member ID, group number, the insurer's phone); and
  anything else, in your own words. A page with nothing on it offers **Add
  emergency information**. The date of birth comes from the family's
  details, and the form says so.
- An entry with something typed but no name is said where it is ("Give it
  a name, or leave the entry out."), and nothing is sent until it is put
  right; an empty one is left out. Lists stop at the most the vault keeps.
- Removing an entry with anything in it, and clearing a part (a list of
  two or more, the insurance, anything else), is asked first; nothing goes
  until Save, and Cancel with something changed asks before leaving.
- Saved from the version read: if somebody else changed it meanwhile,
  nothing of theirs is written over without your knowing. What you typed
  stays in the form, and it says so: Save again puts yours in place of
  theirs, or Cancel and open it again to see theirs first. The page says
  "Saved." and shows it read again.
- **Who can see it**, for whoever chooses (the person, signed in as a
  grown-up; an owner for anybody else): only them and the owners, every
  adult too, or everyone in the family, and these people too, named from
  the family's adults and teens. The person and the owners always can, and
  so can a caregiver they keep. Somebody named before who can no longer
  be (made a viewer or an owner since) is taken off, and the form says
  who. A choice that takes it from anybody says, above Save, that they lose
  any export they made of it.
- **Print a wallet card**, for anybody who sees what is on the page: tick
  what goes on it (what a stranger needs first, ticked to begin with), see
  it as it will print, and **Share or print**: a PDF made on the phone, the
  size of a bank card on an A4 page, for the phone's own share sheet — a
  printer, Files, another app — and then gone from the phone. It needs
  nothing but the paper: no link and no code to scan, and no connection.
  Letters the printed card can't draw (it uses the PDF's own Helvetica) are
  said before it is made. Line breaks in what was typed are kept on the
  card.
- Failure states: changing emergency information (no connection, an entry
  without a name, changed somewhere else, a list at its most) and the
  wallet card (nothing ticked, letters it can't print, not made).

### Changed
- "Change it on the web" is gone from the emergency page: everything it
  was for is on the phone. The words on an empty page no longer send you to
  the web.
- Changing emergency information, or who sees it, needs a connection, and
  says so plainly; what was typed stays in the form until you leave it. As
  before, the page itself is never kept on the phone, so with no connection
  there is nothing to show; screenshots stay blocked on the page and in its
  editor; the clinician's links are as in 0.18.0.

### Fixed
- **Links, PINs and passwords can no longer be selected** wherever the
  phone shows one: a link made or revealed in Sharing or from a document, a
  request's link and password, a new PIN or password after Change, a
  clinician's link's PIN or password, and the two-step sign-in code to type.
  A long press and the phone's own Copy left them on the clipboard for good;
  now only Copy puts them there, and clears it a minute later.

## [0.18.1] — Notes stays a tab when the phone is offline

Still pinned to the vault's **v0.9.0-dev.65**.

### Fixed
- **Notes no longer turns into People when the vault can't be reached.**
  Which of the two is a tab was decided by what the vault said since the
  app started, so a phone started with no connection showed People, though
  notes can be written offline (0.13.0). The phone now keeps what each
  vault last said about itself, and uses it until the vault answers again:
  Notes on a vault that keeps notes, People on one before 0.9.0, online or
  not. With nothing heard from the vault at all (a new install started
  offline), Notes. More lists People whenever Notes is the tab.
- What the phone kept about a vault goes with it when the vault is
  forgotten (Change server).

## [0.18.0] — Asking for documents, changing any link, and papers from a folder

Re-pinned to the vault's **v0.9.0-dev.65**. Requests to send documents are
made and changed on the phone, as on the web (RQ); a document's own links
and a clinician's link are changed where they are listed (LK); and the
folder a paper came from opens the papers from it (C4). Each waits for the
vault's say-so, and without it the phone is as 0.17.0.

### Added
- **Ask for documents** (vault 0.5.21 on; `features.upload_requests`), in
  More → Sharing, for owners and adults: the web's form on the phone — what
  you are asking for, a message and the things to send (up to 10), who it
  is for and, for whoever looks at what comes in, whose documents they
  probably are; when it stops (Tonight, Friday 5 pm, In a week or another
  day, never past the longest the vault allows); a password the vault makes
  up or one you type, a code emailed to them where the vault can send one
  (and why not, where it can't), this browser only, and only so many
  visits; how many files and how much, PDFs and photos or Word and Excel
  too, and closing once they press Finish; and who looks at what comes in.
  What needs putting right is said where it is, and Make the link moves to
  the first of it. A typed password is 8 to 64 characters. Made, the link
  and its password are shown once, with Send, Copy and Email the link where
  the vault can, and what the request will do said under them; neither can
  be selected, so nothing is left on the clipboard but what Copy clears.
- **Change a request** (vault 0.9.0-dev.49, `features.link_changes`): on
  the phone's own form, filled in as the request is now. Its title,
  message, whom it is for, when it stops (never past the latest from when it
  was made), its password (whoever asked only), its visits, what it takes
  and whether it closes once sent can change; what it asks for, who looks
  at what comes in, its emailed code and "this browser only" stay as made,
  and are said. Only what is changed is sent; anything that lets it do more
  asks to confirm it's you, and a new password the vault made up is shown
  once. A request changed or ended meanwhile is read again and the form
  starts again from it, saying so, so nothing somebody else changed is
  undone; a connection coming back never starts it again by itself. Sharing
  says what was changed.
- **A document's own links, on its page** (with `features.link_changes`),
  as the web's Share a link lists them: each that still works, newest first,
  whom it is for, when it stops, how often it was opened and who opened it,
  with **Change** where the vault lets you and **End this link**, asked
  first. On a sensitive paper of your own, links somebody else made stay
  under Shared outside the family, listed once.
- **Change on a clinician's link**, on a person's emergency page, while it
  works: whom it is for, when it stops, how often it opens, its PIN or
  password. It stays to view, always.
- **The papers from a folder** (vault 0.9.0-dev.52, `features.source_folders`):
  a document's "Came from the folder" opens Documents with the papers from
  that folder, said as a chip ("From the folder ‘Taxes/2025’") whose ✕
  shows everything. With it on, the sort says "Newest first by the paper’s
  date", as the vault sorts a folder's papers. The search looks through
  every document, and says so while the chip is on. A folder, a status or
  the Essentials asked for from elsewhere is taken once: clearing its chip
  stays cleared, and asking again brings it back.
- Failure states: asking for documents (what needs putting right, no
  emailed code here, a request that can't be changed or has ended, a link
  that isn't https://), and the search beside a folder's chip.

### Changed
- Sharing's **Ask for documents** and a request's **Change** open the
  phone's own form, not the web.
- The client's Web Crypto declaration is gone: the vault's client of
  dev.63 on signs nothing, so it compiles here as it is. Connected apps
  that act as themselves (dev.65) leave no person on their lines; the
  phone's Activity already reads those as "anybody else".

## [0.17.0] — Activity, who opened a link, yearly reviews and where a paper came from

Re-pinned to the vault's **v0.9.0-dev.61**. Where the vault has them, the
phone shows the activity log and a document's own Activity (DA), who opened
a link (H5), a yearly review to turn on (H3) and the folder a paper came
from (C4), and starts a sensitive link carefully, as the web does. Every
vault keeps an activity log, so Activity is in More on any of them; the
rest waits for the vault's say-so, and without it the phone is as 0.16.0.

### Added
- **Activity** (the vault's activity log; a document's own since 0.9.0-dev.54,
  `features.document_activity`). In More, for owners, adults and teens as
  on the web: everything anybody has done in the vault, newest first, in
  the vault's own sentences and exactly when on the household's clock —
  added, changed, looked at, downloaded, shared, a link opened, emailed or
  taken back. A line about a document opens it. **Filters** slide out from
  the side, as Documents' do: who (each of the family, or anybody else,
  such as a link), what happened, and from and to which day on the
  household's calendar; each filter on is a chip to take off, and the list
  says how many of those loaded match. **Show older** loads more. Read only.
- **A document's own Activity**, a line on its page: the same screen with
  only the lines about that document — its own links and collections'
  links that gave it too — said by a chip ("About ‘Passport’", or "About a
  sensitive document"), whose × shows everything. When nothing is about it
  yet, it says so. A viewer has none, as on the web.
- **Who opened it** (vault 0.9.0-dev.51, `features.share_opens`). Under a
  link in More → Sharing that has been opened, for whoever made it and the
  owners: **Who opened it (N)**, closed at first, lists each time it was
  opened and the browser it was opened in — never an address. A
  clinician's link on a person's emergency page has the same disclosure,
  closed at first, in place of the openings always shown.
- **Shared outside the family**, on a sensitive document of your own: every
  link to it somebody else made, who made it, whether it still works, and
  who opened each, when.
- **A yearly review, turned on** (vault 0.9.0-dev.46, `features.health_kinds`).
  On an advance directive, a healthcare proxy or a HIPAA authorization,
  **Remind us to review it every year** on its page: first on the next
  anniversary of the day it was signed (or a year from today), and said
  ("Next review: 10 Mar 2027"). Turning it off asks first, in the words
  Needs attention uses. Shown wherever one is on, so it can be turned off.
- **Came from the folder** (vault 0.9.0-dev.52, `features.source_folders`):
  on a document's page, the folder a paper was filed from ("Taxes/2025"),
  and **Forget it…** for whoever may change it, asked first, which takes
  it off for everyone.
- Where the vault emailed a link is said on its row in Sharing, for
  whoever sees the link (vault 0.9.0-dev.54).
- Failure states: Activity without a connection, nothing in it yet,
  nothing matching the filters, and a link not opened yet.

### Changed
- **A sensitive document's link starts careful** (vault 0.9.0-dev.51): View
  only, for a week, and says why; one the vault can't show starts as
  download. A collection's link with a sensitive one ticked starts the same
  way, unless a file it can't show is ticked too: then it starts as
  download. Choosing View or download yourself stands.
- **Moving a sensitive document to the Trash** says that older backups
  still hold it until they age out, and for how long the vault keeps its
  nightly ones, where the vault has said.
- **Add a file** offers health record files from a patient portal — XML
  (C-CDA), JSON (FHIR), DICOM images and ZIPs — where the vault keeps them
  as they are, each sent as the type the vault keeps it as; a hospital
  CD's image with no ending can be chosen too, and the vault knows it.
- The client's Web Crypto declaration stays: the vault's client of dev.61
  still needs it to compile here.

## [0.16.0] — Downloads as a ZIP, changing a link, and requests

Re-pinned to the vault's **v0.9.0-dev.60**. Where the vault has them, the
phone downloads several documents, or a whole collection, as one ZIP (DL),
changes a link after it is made (LK), and lists the requests to send
documents with the links, as the web's Sharing does (RQ). A vault without
these is shown exactly as by 0.15.0.

### Added
- **Download from Documents** (vault 0.9.0-dev.48, `features.zip_download`).
  **Choose**, beside the search, turns the rows into boxes to tick, with
  how many are chosen and **Download** at the foot of the screen. One
  document with a file comes as itself, as Save a copy gives it; several
  come as one ZIP with an index saying what each is, named as the vault
  names it ("Family documents 2026-11-17.zip"). As on the web, the vault
  is asked for a one-time download first: a Sensitive one among them asks
  to confirm it's you, as an Only me or an Essential one does (cancelled,
  nothing is downloaded and the choice stays), and too many for one
  download says to choose fewer or use Export on the web. The ZIP — up to
  1 GB — then streams straight into a file, never through the app's
  memory; a one-time download that ran out is asked for once more, and a
  connection lost part-way says so and leaves nothing. The file goes to
  the phone's share sheet, the usual way for a file, and nothing is left
  on the phone; the first time, it says the copy is outside the vault.
  What a search or a filter leaves out is unticked, so nothing unseen is
  downloaded, and one search result chosen — a sealed one too — comes as
  itself.
- **Download on a collection**, in its ⋯: everything in it you may
  download, as one ZIP named for it, asking first when a Sensitive document
  is in it. An empty collection offers none.
- **Change a link** (vault 0.9.0-dev.49, `features.link_changes`). In More
  → Sharing, a link you made — or, for an owner, anybody's — has
  **Change**, which opens the form it was made with, filled in: who it is
  for, when it stops (As now, Tonight, Friday 5 pm, In a week or another
  day, never past the latest it may go to from when it was made), View
  only or View and download, how many times it opens, its PIN or password,
  and whether its page shows the title. Only what is changed is sent. A
  change that lets it do more asks to confirm it's you. A new PIN or a
  password the vault made up is shown once, with Copy, and Show the link
  shows it again. An owner changing somebody else's link changes all but
  its PIN or password, and a code by email or text, or "This browser only",
  stays as it was made; the form says so. A clinician's link stays to
  view. A link changed meanwhile, or ended, is read again, so Change
  starts from it as it is now.
- **Requests to send documents in Sharing** (vault 0.5.21 on; as a list of
  their own since 0.9.0-dev.53, RQ), for whoever may ask for them: what
  was asked for, who it is for, who asked when it was somebody else, what
  came in and the visits used, and where it stands in words, under Working
  now and No longer working. **Show the link** shows a request's link and
  its password again after confirming it's you, to send, copy or **Email
  the link** where the vault can (never what it asks for, nor its
  password). **End this request** is asked first, and what was sent stays.
  An owner turns on a request a restore paused. **Change** opens the
  request's form on the web, and **Ask for documents on the web** starts
  a new one there.
- **Links that no longer work** stay in Sharing under No longer working,
  20 at first and then Show N more, with how long the household keeps
  them. A link ended here moves there.
- **Settings → Links and requests that no longer work** (vault
  0.9.0-dev.53, `features.ended_sharing`): an owner chooses how long they
  are kept — 30 days, 90 (the default), a year, or never — and a shorter
  time is asked first, saying what goes the next night. An adult reads it.
- Failure states: downloading without a connection, nothing in the
  choice or the collection with a file, too much for one download, a
  one-time download that ran out, a document with no file, and a link's
  end past its latest.

### Changed
- The vault's client of dev.55 on hands Web Crypto a plain `Uint8Array`,
  which TypeScript 6's DOM library refuses: a declaration lets the vendored
  source compile here. The phone never signs as a connected app.

## [0.15.0] — Health on the phone

Re-pinned to the vault's **v0.9.0-dev.53**. Where the vault keeps them, the
phone shows each person's emergency information and makes a link for a
clinician (H4), shows the health kinds and their reminders as the vault
words them (H3), and never tries to draw a health record kept as it is
(H5). A document no longer needed says why behind an (i). A vault without
these is shown exactly as by 0.14.0.

### Added
- **Emergency information** (vault 0.9.0-dev.47, `features.emergency_info`),
  from **More → Emergency information** and from a person's page. More lists
  the family whose page you may read, you first, each with what is on it;
  anybody the vault doesn't show you is left out. A page shows what was typed,
  in the vault's order — date of birth, blood type, allergies, medications,
  conditions, insurance, doctors, emergency contacts and anything else — then
  the person's advance directive, healthcare proxy and insurance card, which
  open, who can see it, and that it is not medical advice. Read only on the
  phone: **Change it on the web** opens the person's page in the browser.
  Never kept on the phone, and screenshots are refused while it shows.
- **Share with a clinician**, for whoever chooses who sees the page (the
  person, or an owner for a child): a link to look at the parts ticked and
  nothing else, for 1 to 24 hours (4 unless changed), with a PIN to tell them
  unless you choose a password or nothing, who it is for, and whether the
  page before it opens says whose it is. The vault asks who is holding the
  phone first. Made, it is shown once: Send, Copy the link, the PIN apart,
  and Email the link where the vault can. The person and the owners see each
  link — working, paused, used up, ended or taken back — when it was opened
  and from what browser, and **Take back** any not ended or taken back,
  asked first. Links that couldn't be read say so, with Try again; a page
  in More's list that couldn't be read leaves the others listed, with a
  note and Try again. Nothing on the page can be selected and copied.
- **A yearly review** of an advance directive, a healthcare proxy or a HIPAA
  authorization shows on Home and in Needs attention as "Yearly review · Due
  today". Done brings the next one a year on; it never offers Scan the new
  one, and removing it is **Turn off**, asked first.

### Changed
- **No longer needed opens on asking** (vault 0.9.0-dev.53, the owner's ask).
  On a document's page, the **(i)** beside "No longer needed" opens and
  closes what is said about it, closed at first: "No longer needed since 30
  Oct 2026 · Replaced by … · Needed again", why, and "Nothing reminds anyone
  of it. Marked by Sam." with **Change why**, which changes why and keeps
  what replaced it.
- **A kind's own names for its details** on a document's page: an advance
  directive's date is "Signed", an insurance card's issuer its "Insurer", and
  a detail the kind hides is not shown.
- **Health records kept as they are** (vault 0.9.0-dev.51: XML, JSON, DICOM
  and ZIP files): their page says there is no preview and why, with no
  picture, Pages or Show; **Save a copy** gives the file to open in the app
  it's for. An older version kept so says the same, and Show from a row's ⋯
  says it can't be shown. A list's picture the vault doesn't have falls back
  to the file's icon.
- The health kinds (vault 0.9.0-dev.46) come from the vault — their names,
  details and reminders — and Next refill or Next dose due never offers
  Scan the new one.

### Fixed
- **A teen's own vaccination record starts as Everyone**, as the vault
  starts it (H3), so their parents can see it; the card says why, and Only
  me can still be chosen. Before, the phone filed it as Only me, by the rule
  for a teen's other sensitive papers.
- **Who can see a new scan is left to the vault** unless somebody chose it
  on the card (or it starts as Only me): the card shows where it will
  start, and the vault starts it by its own rule when it arrives. A scan
  kept offline across an 18th birthday now starts as the vault says then.

## [0.14.0] — My cabinet on the phone

Re-pinned to the vault's **v0.9.0-dev.51**. Where the vault has My cabinet
(`features.cabinets`, from 0.9.0-dev.42), Documents can show the same
documents as the person files them, cabinet by cabinet, and a printed
folder label opens its folder. The cabinet is browsed here and arranged on
the web. A vault without cabinets shows Documents exactly as 0.13.1 did.

### Added
- **List and Cabinet** under the Documents title, as the web's Table and
  Cabinet. Cabinet shows the person's own cabinets; a cabinet opens its
  drawers, a drawer its folders (each with how many documents it holds), and
  a folder its documents. Back goes up a level. What is hidden on the web is
  left out. The choice is remembered on this phone. Opening Documents from
  Home's numbers, an alert or the Essentials still shows the list, and the
  magnifier on Cabinet opens the list with its search.
- **A folder** says where it is (Cabinet › Drawer), what it holds in a
  sentence ("P60s, for Sam."), and how many. The documents pinned there come
  first, then its dividers, newest first: years by themselves, or the
  folder's own date ranges. Each divider says how many are behind it and
  opens to show them, 50 at a time; the first with any is open already.
  Each document opens its own page. On a vault with cabinets but no
  dividers (0.9.0-dev.42 and dev.43), a folder lists its question's
  documents, newest first, from the documents list; a question that list
  refuses says so, with no Try again.
- Every screen showing the cabinet shares one request: a change asks the
  vault once for the cabinet and once for its counts, however many are open.
- **Arrange your cabinet on the web**, under the cabinets, opens the vault's
  own Arrange page in the browser. An empty cabinet says so.
- **Scan a folder label** (the code button beside the search, on a vault
  that prints labels: `features.original_place`, dev.50). A label's code
  holds only `{vault}/folder/{id}`. A label of this vault opens its folder in
  place of the scanner, including one printed from another address of the
  same vault when the folder is the person's own (the folder then says so,
  once). Another vault's label says
  "This label is from another vault (…). It opens only there.", and anything
  else says it isn't a folder label, each with Scan another. Nothing is ever
  asked of an address in a code. The camera is asked for the first time;
  turned off for the app, the scanner says where to turn it on. The camera
  looks only while the scanner is in front and the app is open: behind the
  lock or its cover it is off, and a code seen then opens nothing. Not in
  the web build, whose scanner would fetch its code reader from elsewhere.
- **A link to a folder** in the app's own scheme (`familyvault://folder/{id}`)
  opens it while signed in, as any of the app's screens' links do.
- **Where the original is**, on a document's page (vault dev.50): its place
  in a cabinet, then the words written for it ("Study › Drawer 2 › Tax 2025
  · behind the blue divider"), as the vault answers them to whoever sees
  where originals are kept. When it is the person's own folder, it opens.
- Failure states: the cabinet without a connection, an empty or hidden
  cabinet, a folder not in the person's cabinet, a folder whose question
  can't be asked any more, another vault's label, a code that is no label,
  no camera, and the camera turned off.

### Changed
- `expo-camera` (SDK 57) for the scanner: the camera only. Its config plugin
  asks for no microphone and no audio recording.
- The phone's theme takes every colour role the vault's tokens have,
  `paperInk` (C3's labels) among them.
- About lists `expo-camera` and what it brings (`barcode-detector`,
  `zxing-wasm` for the web build).

## [0.13.1] — A note whose answer was lost is sent again safely

Re-pinned to the vault's **v0.9.0-dev.45**, which keeps a new note's
Idempotency-Key (`features.idempotent_create`): the same key and the same
body again make nothing new. Notes written offline (0.13.0) now use it fully.
A vault without it is answered exactly as by 0.13.0.

### Changed
- **The key is decided by what the vault says now.** Every try asks the vault
  first, and that answer — never one from before it, nor a guess while the
  app is still starting — decides whether the note goes under its key. With
  no answer, nothing is sent. A note that went once under its key never goes
  without one: should the vault say it keeps none now, it's "Might already be
  in your vault". What the vault last said is kept on the phone as a hint for
  what Notes offers, never to decide a send.
- **The words a note first went with are kept with its key.** Once a note has
  been sent under its key, what went — title, words, whose and who can see
  it — is kept with the key, in the note's encrypted bytes on the phone,
  before anything goes, and every later try sends exactly that. A note
  changed meanwhile goes again with the words it first went with, which
  settles safely whether the first try landed. New note says so when such a
  note is opened.
- **"Still being made", "busy" and a 5xx are not refusals.** The vault's `409
  idempotency_in_progress`, `503 busy_try_again` and any 5xx (a gateway's
  502 or 504 among them) are sent again under the same key after the vault's
  Retry-After, waiting twice as long each time, at most 5 minutes apart —
  for as long as the vault keeps the key. A change made meanwhile keeps the
  wait the vault asked for.
- **The vault keeps a key 24 hours**: a note is never sent again by itself
  more than 23 hours after its first try, nor with the phone's clock put back
  before that try. It's "Might already be in your vault" then.
- **Send again settles it, while it can.** "Might already be in your vault",
  still within its key's day on a vault that keeps keys: Send again goes
  under the same key with the words it first went with, so the vault's
  answer settles it — one note, never two. After that day, or to a vault
  that keeps no key, Send again is a new note, as before.
- **Refused outright on its first try** (any 4xx but signed out, a timeout,
  "still being made" and too many tries): nothing was made, so the note can
  be put right — shortened, say — and goes as it is then. Refused on a later
  try, that says nothing of the first: "Might already be in your vault", its
  key and its day kept.
- A note cut off while sending (the app closed) goes again under its key
  only if that try went with one; otherwise it's "Might already be in your
  vault".
- New note puts the note in the phone's queue before anything goes, so an
  app closed mid-Save never loses it.
- A failed SSL read in the middle of an answer is "might have arrived": only
  a refused handshake or certificate means a try never left.

### Added
- **"In your vault, with its earlier words"**: a note the vault has as it first
  went, changed on the phone since, says "Your note reached the vault with
  its earlier words. Send your changes as a new note?". When the vault said
  where it is, and who can see it is unchanged, **Put my changes in that
  note** comes first; then Send as a new note (the change, under a new key)
  and Discard changes, asked first. Nothing happens by itself. A vault that
  kept other words under the key (`422 idempotency_key_reused`) says an
  earlier version is already there, with the same choice; for a note
  unchanged since, those are its words, and it's sent.
- **Reached the vault, kept private since**: a note the vault made and its
  writer can no longer see (`404 created_not_visible` — the person it's
  about made it Only me) is sent: Notes says it reached the vault and is now
  kept private by the person it's about — kept on the phone until Notes has
  said it. It's never sent again.
- A row that asks something — "Might already be in your vault", or "In your
  vault, with its earlier words" — reads its question to a screen reader
  with it; the bin on the latter is "Discard your changes to …".
- Words for the vault's new answers, should one ever be shown:
  `idempotency_in_progress`, `busy_try_again`, `created_not_visible` and
  `idempotency_key_reused`.

## [0.13.0] — Notes written offline, and a clear word when the vault can't be reached

The owner's requests after installing 0.12.0. The vault pin is unchanged
(v0.9.0-dev.43).

### Added
- **New notes while offline.** With no connection, or somewhere the vault
  can't be reached, New note still saves: the note is kept on this phone, in
  the same encrypted queue scans wait in (SQLCipher, key in the phone's
  keystore), behind the app's lock, and only ever shown to — and changed or
  deleted by — the person who wrote it. It's sent by itself once the vault
  answers: when the app comes back to the front, when the network changes,
  when the vault answers again, and by retries that wait longer each time.
  Once the vault has it, it's removed from the phone and is an ordinary note.
  Who can see it is what was chosen; unreadable or missing, it's Only me.
- **Waiting to send**, at the top of Notes: each note not sent yet, opened to
  change it before it goes (nothing is sent while it's open), or deleted
  from the phone, asked first. "Sending…" while a try is under way: nothing
  can be changed or deleted then, so what goes is what was last saved.
- **Never guessed: "Might already be in your vault".** The vault doesn't yet
  take an idempotency key for a new note, so when a try went out and no
  answer came back — given up on in time, the connection lost, a failure the
  phone can't name, or a 5xx — the note says "We sent this but didn't hear
  back. Check Notes first. If it isn't there, send it again." with Open
  Notes, Send again (as a new note) and Delete. It's never sent again by
  itself. A try that never left the phone — the vault didn't answer just
  before, the address not found, the connection refused, a certificate
  refused, no network — stays Waiting to send and goes by itself. A note left
  "Sending…" by an app that closed becomes "Might already be in your vault".
- **Ready for a vault that takes the key**: each note carries a client id;
  a vault that says `features.idempotent_create` gets it as the POST's
  Idempotency-Key, and then a lost answer is simply sent again by itself.
- **Couldn't send — {reason}**, with Try again and Delete, when the vault
  refuses a note for a reason trying again can't fix. A note for Adults only
  from somebody who can no longer choose that (their role) is sent as Only
  me — narrower, never wider — and Notes says so; any other refusal leaves
  their choice as it was. A note whose words on the phone can't be read says
  "Couldn't read this note", with Delete.
- **A clear word when the vault can't be reached.** A slim line above the tab
  bar, after two seconds out of reach, says which it is — "This phone is
  offline", "This vault is used only on Wi-Fi", something else answering at
  its address, or "Can't reach your vault right now. Check you're on a
  network that can reach it." — with Try again, said aloud on iOS and
  Android, and goes by itself when the vault answers: the app looks again on
  a network change, back in front, and after 10 s, 20 s, 40 s, then every
  minute — not while the phone has no network at all. Documents, Notes and
  People keep what they already show, with "Offline: showing what's saved
  on this phone."

### Changed
- **Requests give up after 15 s** with no answer (they waited 20 s). One slow
  answer is said as slow, with Try again, and the vault is looked at again:
  only when that look fails too is it "can't reach your vault", so the line
  doesn't come and go. Looks that overlap are one look. Downloads (a file, a
  page) wait 15 s to start, then only give up when nothing has come for
  30 s. Uploads, sent in one piece, keep their deadline sized to the file;
  the scan queue's retries are as before. Thumbnails stay with the phone's
  own image loader.
- A gateway's 502, 503 or 504, or a 5xx without the vault's own words,
  counts as "can't reach your vault".
- A failure with no network at all says "This phone is offline", and one with
  a network says the vault can't be reached on it (`errors.noNetwork`, and new
  words for `errors.offline`).
- **A collection's Managers is in its ⋯**, with who manages it, for whoever
  saw it before; the page itself holds its documents, and its checklist.
- **Add documents and Fill from a checklist** sit side by side on one line
  each on a 360 dp phone: less room at their sides, the same height and type.
  At a large text size the second goes under the first, never cut.
- Changing a note already in the vault says plainly that it needs a
  connection; only new notes are kept to send later.
- Signing out with notes not sent says so, and Remove them takes them off the
  phone. Change vault counts every note written here for that vault —
  anybody's, on its way or not, never what they say — and removes them,
  asked first.

## [0.12.0] — Caregivers, and the question at 18

The vault's **caregivers and turning 18** (0.9.0-dev.43, H1b) on the phone:
somebody of the family can be let see a person's medical papers, read-only,
and a person who is 18 is asked once whether their medical papers stay
visible to the family.

### Added
- **More → Caregivers**, for owners, adults and teens: "Let someone see my
  medical papers" — choose somebody who signs in as an owner or an adult,
  and the phone says plainly what they'll see before it's done. Each
  caregiver is listed with what they see; Revoke asks first. A caregiver an
  owner named for you shows Keep, which asks first, as it adds your Only me
  papers to what they see.
- **Who looked**: who opened, saved or looked at the pages of which of your
  papers as a caregiver, and when; a line opens the paper.
- **Papers you can see as a caregiver**, on the same screen: whose, See them,
  and Stop seeing them, asked first.
- **On a person's page**, for the person, an owner, or one of their
  caregivers: their caregivers. An owner names one for somebody without a
  sign-in there, and sees who looked — never which Only me paper. More →
  Caregivers lists the family for an owner, each opening their page.
- **Shared with you as caregiver**: a paper you see only because of a grant
  is marked so in Documents, on Home, in a search, on its page and over its
  pages, and never said to be Only me. It offers Pages and Save a copy, and
  nothing else: no edit, share, link, email, collection, Who can see it,
  Trash, new version, renewal, no longer needed, reminder, notes, Show,
  Essential or Sensitive. It's never offered in a collection's Add
  documents, isn't counted in Home's numbers or Essentials, and isn't
  "Only me" in the Documents filter, which means your own.
- **Only real looks in "Who looked".** The vault writes down each time a
  caregiver opens a paper, so the phone never asks for one of them except
  when you open it: a list shows no picture of it, its ⋯ doesn't ask the
  vault for it, and a search knows it from its person's list.
- **The question at 18**, a card on Home: "Keep your medical papers visible
  to the family, or make them Only me?" Keep them visible, or Make them
  Only me, which asks first and says what changes: how many papers, that
  nobody else in the family can open them, owners included, and that links
  you made to them end. Nothing changes until you answer.
- **An owner's cards** for somebody turned 18: with no sign-in, ask them in
  person, then "They want them kept as they are" (an owner can only keep
  them, and the card says the answer can't be changed), or Name a caregiver
  on their page; still signing in as a teen,
  change their role in the browser first.

### Changed
- A vault without caregivers is unchanged: nothing new is shown or asked.
- Re-pinned to the vault's **v0.9.0-dev.43** (caregivers and turning 18).

## [0.11.0] — What Sensitive protects, when it's shared

The vault's **what Sensitive protects** (0.9.0-dev.41, H1a) on the phone: a
sensitive paper is asked about before it goes outside the family, its title
is kept off the page a link opens, and a paper made sensitive while it's
shared asks what becomes of its links.

### Added
- **Asked before it's shared.** Making a link to a sensitive document asks
  first, in the web's words: "This document is sensitive. A link lets
  somebody outside the family open it. Share it anyway?" A collection's link
  with sensitive documents ticked says how many, and each one is marked
  Sensitive in the list. Cancel shares nothing.
- **"Show its title on the link page"**, a new switch when making a link.
  It's off for a sensitive document, so the page the recipient opens says
  "A document"; any other document's title shows, unless you turn it off.
  For a collection's link it covers its sensitive papers, those put in later
  too. Under it: a file someone downloads keeps its own details, such as a
  PDF's title or a photo's data, while a link to view only shows the pages.
- **Putting a sensitive document into a collection whose link keeps up with
  it** asks first, from a document's ⋯ and from a collection's Add
  documents. A checklist's add is never asked: the vault puts the paper in
  but leaves it out of the link, and the phone says so, as before.
- **Turn back on**, in More → Sharing, for a link a restore paused, for an
  owner, on a vault that asks about sensitive documents. One that gives a
  sensitive document asks first.
- **Made sensitive while it's shared?** Saving Edit details that makes a
  paper sensitive, while links outside the family still give it, saves it
  and then asks: "This paper is shared outside the family by 2 links. Keep
  them, or end them now?" Ending them takes back its own links and takes it
  out of any collection's link, and the phone says which. The save is never
  held up.

### Changed
- **A teen's or a grown-up child's own sensitive papers start as Only me**
  on the capture card, as the vault starts them, and the card says why. They
  can still choose who can see it before they save. A card opened with no
  connection follows what the vault said last.
- If the vault asks about a sensitive document the phone didn't know was
  sensitive, its question is shown and the link is made once you answer.
- A vault without what Sensitive protects is unchanged: nothing more is
  asked or sent.
- Re-pinned to the vault's **v0.9.0-dev.41** (what Sensitive protects).

## [0.10.1] — the + and a cold start, steady on a busy phone

Two faults that made the Maestro run fail now and then, on changes that had
nothing to do with them. Both could happen on a phone too.

### Fixed
- **The +'s choices could open unseen.** With Remove animations on, a +
  opened before it had heard the phone's setting started to fan out, was
  then told to stand still, and was left with File, Camera and Picture
  there but invisible. Each part now starts from what the phone last said,
  and the + keeps the way it opened until it closes.
- **A rare crash on opening, on Android 14 and later.** The system's
  memory sampling (GWP-ASan) could walk off the end of Hermes's own stack
  as it noted where memory was freed. The app now opts out of it.

## [0.10.0] — Collection managers

The vault's **collection managers** (0.9.0-dev.40) on the phone: the person
who made a collection can choose others in the family to manage it with
them, and what each of them may do.

### Added
- **Managers**, a row on a collection's page under its actions, for the
  family who see it: who manages it besides the person who made it. It opens
  a screen that lists each manager and what they may do. Every manager can
  always add and remove documents, fill it from a checklist, and rename it;
  three switches, off until turned on, let one do more: **Can also change
  who it's for**, **Can also delete it** and **Can also choose managers**.
- Whoever may choose managers — the person who made it, or a manager they
  let — makes someone a manager (picked from the family the vault offers:
  people with a sign-in who can already see it), turns each switch on or
  off, and removes a manager, asked first. A switch you can't do yourself is
  never offered to give.
- An owner, while the person who made a collection can no longer change it,
  sees Remove beside each manager, and nothing more.
- The list of collections says "You manage it", and a collection's page
  says when someone else made it and chose you.

### Changed
- A collection's page offers each action by what the vault says you may do
  with it now, not by whether you made it: Add documents, removing a
  document, Fill from a checklist, the pencil (name and words), who it's for
  — plain words when it isn't yours to change, and never Only me unless you
  made it — and Delete, only to whoever may delete it. Add to a collection,
  in a document's ⋯, offers the collections you manage too.
- What the vault refuses is said in its own words: not allowed, already a
  manager, someone who can't be one, or a change that would leave the
  person who made it unable to see their own collection.
- An older vault, without managers, keeps the rules as they were: only the
  person who made a collection changes it.
- Re-pinned to the vault's **v0.9.0-dev.40** (collection managers).

## [0.9.0] — Email the link

The vault's **Email the link** (0.9.0-dev.39) on the phone: the vault
emails a share link to the person it is for, through the mail server of
whoever runs it. Another way to send a link, never in place of copying it.

### Added
- **Email the link** after "The link is made", and in More → Sharing →
  Show the link, beside Send the link…, Copy the link and Copy the PIN or
  password, which all stay as they were. Type their address and, if you
  like, a short message — up to 300 characters and five lines, with no web
  addresses or website names — then **Send** (Cancel beside it). It says
  "Sent to j•••@example.com" and how many more times it can be emailed
  today; a link emailed before says where, masked.
- What is wrong with the address or the message is said on the phone, by
  the vault's own rules, before anything is sent: the message as you type
  it, the address at Send.
- Past the first 15 minutes after making the link, the vault asks to
  confirm it's you first, with the same sheet as Show the link.
- What the vault refuses — a link paused or ended, one made before it kept
  copies, too many emails today (3 a link, 20 a person), no mail server —
  is said in its own words. Copy and Send stay whatever it says.
- Offered only where it can work: the vault has its operator's mail server
  (`share_link_email`), and the link is one you made that it can email
  (`emailable`). Otherwise it is simply not there.

### Changed
- Re-pinned to the vault's **v0.9.0-dev.39** (email a share link). Its
  other change — a kept checklist with no lines is no checklist — the phone
  already treated as none.

## [0.8.1] — shorter words after hiding an alert

### Changed
- After hiding a Home alert, the line says only "Hidden. It comes back in a
  week." (the owner, 13 Nov 2026), with Undo counting down for a minute.

## [0.8.0] — Fill a collection from a checklist

What the family asked for after the app's demo: the web's **Fill from a
checklist** (the vault's C1), on the phone, where it is handiest on the
go. Offered only where the vault has it (`collection_checklist`), to an
owner, an adult or a teen, so an older vault looks as before.

### Added
- **Fill from a checklist** on a collection's page, beside Add documents,
  for the person who made the collection. Paste or type the list you were
  given — one thing a line, "Documents for Mansoor" as a heading — and
  **Read the list**: the vault reads it with plain rules and says back
  what it understood of each line, how it stands (Found 1 of 2, Missing,
  Choose which, Not understood) and the documents it found, ticked, with
  their title, date and whose. Tick or untick any of them.
- **A line it could not read is opened** to choose its kind, whose it is
  and how many (each from a list), or to skip it; it is looked for again
  at once. Any other line has **Change**.
- **Add 2 found** at the foot, beside Cancel, asks first — "Add 2
  documents to “Mortgage”?", saying so too for a collection shared outside
  the family — then adds them in one go and keeps the list on the
  collection; or **Keep the list without adding**. With nothing ticked it
  is **Keep the list**. Leaving with something changed asks first.
- **Add it** beside a missing paper: a file or a picture (or the camera,
  on a phone with the scanner), through the usual card. Once it has gone
  to the vault, the checklist looks again and finds it.
- **The checklist kept on a collection** is one line on its page —
  "Checklist · 2 of 4 found · 1 new match" — which opens its lines; the
  family who see the collection can read it. Its maker goes on to
  **Review and add** or **Change the checklist**, or **Clear the
  checklist**, asked first (the collection's documents stay in it).
- What the vault says when it can't — only the collection's maker may fill
  it; the list could not be read just now — is said in its own words.

### Changed
- Re-pinned to the vault's **v0.9.0-dev.38** (neutral wording in
  notifications and email, H2, which changes nothing on the phone).

### Changed
- **Undo after hiding a Home alert lasts a minute.** It counts down
  ("Undo (45s)") and then the line goes; it no longer stays until the app
  is closed. A hidden alert is still under the bell. Screen readers hear
  the line once, not every second.

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
