# Failure states

Every way the app can fail that the person sees, where they meet it, and
the words it uses — taken from the catalogue (`apps/pocket/src/i18n/en-GB.json`),
so they are the words on the screen. Anything the vault refuses with a
reason of its own is shown in the vault's words, verbatim (`errors/words.ts`).

Written by `node apps/pocket/scripts/failure-states.mjs`; CI fails if it is out of date.

| Situation | Where | Key | Words |
| --- | --- | --- | --- |
| Reaching the vault | Connect | `connect.invalid` | That doesn't look like an address. It's the one you open in your browser, such as vault.example.com. |
|  |  | `connect.notAVault` | That address answered, but it isn't a Family Document Vault. Check the address — it's the one you open in your browser. |
|  |  | `connect.unreachable` | Can't reach {{host}}. Is this phone on the same Wi-Fi as the vault, or connected to your VPN? |
|  |  | `connect.setupRequired` | This vault hasn't been set up yet. Finish setting it up in a browser on a computer, then come back. |
|  |  | `connect.serverTooOld` | Your vault is on version {{server}}. This app needs {{needed}} or newer. Whoever looks after the vault can update it — it usually takes a few minutes. |
|  |  | `connect.clientTooOld` | This version of the app is too old for your vault. It needs {{needed}} or newer; you have {{client}}. Update the app to carry on. |
|  |  | `connect.apiVersion` | This vault speaks a different version of the app's language ({{server}}). Update the app, or ask whoever looks after the vault. |
|  |  | `connect.askHttp` | {{host}} doesn't use a secure connection. On your own Wi-Fi that's usually fine; anywhere else, other people on the network could see what you send. Use it on this Wi-Fi? |
|  |  | `connect.refusePublicHttp` | The app only uses an unencrypted address inside your home network. Ask whoever runs the vault for its https:// address. |
|  |  | `connect.refuseMobileData` | This vault's address isn't secure, so the app only uses it on Wi-Fi. |
|  |  | `connect.stranger` | Something else is answering at {{host}} — not the vault you signed in to. Nothing was sent. If the vault was reinstalled, sign in again. |
|  |  | `connect.reinstalled` | This vault has been reinstalled since you last signed in. Sign in again. |
|  |  | `connect.certificateUntrusted` | This phone doesn't trust your vault's certificate yet. If your vault makes its own certificate, install it on this phone once — here's how. |
|  |  | `connect.certificateWrongName` | Your vault's certificate is for a different name. Use the address the certificate was made for — the one your browser shows when you open the vault. |
|  |  | `connect.certificateExpired` | Your vault's certificate has run out — or this phone's date is wrong. Check the date in the phone's settings; if it is right, whoever looks after the vault can renew the certificate. |
|  |  | `connect.captivePortal` | Something answered, but it looks like a Wi-Fi sign-in page. Finish signing in to the Wi-Fi, then try again. |
|  |  | `connect.linkJoin` | Invitations are accepted in the browser. Open it there, then come back and sign in. |
|  |  | `connect.linkReset` | Password resets are finished in the browser. Open it there, then come back and sign in. |
|  |  | `connect.linkShared` | That's a link for someone outside the family. It opens in the browser. |
| The vault not answering | The tabs, Notes, Documents, People | `reach.noNetwork` | This phone is offline. Showing what's saved on it. |
|  |  | `reach.unreachable` | Can't reach your vault right now. Check you're on a network that can reach it. |
|  |  | `reach.wifiOnly` | This vault is used only on Wi-Fi. Join your Wi-Fi to reach it. |
|  |  | `reach.stranger` | Something other than your vault is answering at its address on this network. |
|  |  | `reach.showingSaved` | Offline: showing what's saved on this phone. |
| Signing in | Sign in | `signIn.signedOutHere` | You've been signed out on this phone. Sign in again to carry on. |
|  |  | `signIn.passkeyOnly` | You sign in with a passkey. The app can't use passkeys yet, so set a password in the browser (Settings → Password), then sign in here with it. |
|  |  | `signIn.startAgain` | Start again from your password. |
|  |  | `signIn.paused` | An owner has paused your access. Ask them if you think this is a mistake. |
|  |  | `signIn.pausedRestored` | Your access is paused after the vault was restored. Ask an owner to turn it back on. |
|  |  | `signIn.accessEnded` | Your access to this family's vault has ended. Ask them to renew it if you still need it. |
| Any request that fails (wordsFor) | Every screen | `errors.offline` | Can't reach your vault right now. Check you're on a network that can reach it. |
|  |  | `errors.noNetwork` | This phone is offline. Connect to Wi-Fi or mobile data, then try again. |
|  |  | `errors.timeout` | Your vault took too long to answer. Try again in a moment. |
|  |  | `errors.rateLimited` | Too many tries. Wait a minute, then try again. / Too many tries. Wait {{count}} minutes, then try again. |
|  |  | `errors.unavailable` | Your vault is busy or starting up. Try again in a moment. |
|  |  | `errors.internal` | Something went wrong on your vault. Try again in a moment; if it keeps happening, whoever looks after the vault can have a look. |
|  |  | `errors.storageUnreachable` | Your vault can't reach the place it keeps its files right now. Anything waiting on this phone is kept, and sent when it can. |
|  |  | `errors.sessionEnded` | You were signed out. Sign in again to carry on. |
|  |  | `errors.paused` | An owner has paused your access. Ask them if you think this is a mistake. |
|  |  | `errors.accessEnded` | Your access to this family's vault has ended. Ask them to renew it if you still need it. |
|  |  | `errors.stepUp` | Confirm it's you to carry on. |
|  |  | `errors.twoStep` | Turn on two-step sign-in in the browser to see this. |
|  |  | `errors.setupRequired` | This vault hasn't been set up yet. Open it in the browser first. |
|  |  | `errors.unexpected` | Something went wrong between this phone and your vault. Try again in a moment; if it keeps happening, whoever looks after the vault can have a look. |
|  |  | `errors.stranger` | Nothing was sent: something other than your vault is answering at its address on this network. |
|  |  | `errors.wifiOnly` | Nothing was sent: this vault is only used on Wi-Fi. Join your Wi-Fi, then try again. |
|  |  | `errors.invalidCredentials` | That email and password don't match. Check them and try again. |
|  |  | `errors.notFound` | That isn't there any more, or it isn't yours to see. |
|  |  | `errors.previewPending` | The vault is still drawing the pages. Try again in a minute. |
|  |  | `errors.noPreview` | The vault can't draw pages for this file. Save a copy to open it. |
|  |  | `errors.uploadInProgress` | This is still on its way to the vault. Try again in a moment. |
|  |  | `errors.invalidExtra` | One of its details isn't one its kind of document takes any more. |
|  |  | `errors.batchEnded` | The batch it was going into has ended. Remove it here and scan it again. |
|  |  | `errors.batchFull` | The batch it was going into is full. Remove it here and scan it again. |
|  |  | `errors.alreadyDecided` | It's already been dealt with in your Inbox. |
|  |  | `errors.createInProgress` | Your vault is still saving this from an earlier try. It's sent again in a moment. |
|  |  | `errors.createdNotVisible` | This reached your vault, and is now kept private by the person it's about. |
|  |  | `errors.earlierVersion` | An earlier version of this is already in your vault. |
|  |  | `errors.changedElsewhere` | This was changed somewhere else, so nothing was saved. Look at it again, then try again. |
|  |  | `errors.linksChoice` | You have share links to this document. Say whether they end or keep working, then try again. |
|  |  | `errors.sensitiveConfirm` | This is sensitive, so nothing was shared. Say you mean to share it, then try again. |
|  |  | `errors.sensitiveStillShared` | This paper is sensitive and still shared outside the family. See More → Sharing to keep or end its links. |
|  |  | `errors.general` | That didn't work. Try again in a moment. |
| The lock | Lock screen, Settings | `lock.tooMany` | Too many tries. Unlock with your phone's PIN or pattern instead. |
|  |  | `lock.noScreenLock` | To lock the app and keep documents on this phone, set a screen lock in your phone's settings first. Everything else works as it is. |
|  |  | `lock.weakBiometrics` | This phone's face or fingerprint unlock isn't strong enough to protect your Only me documents, so they can't be kept here. |
|  |  | `lock.enrolmentChanged` | The fingerprints or faces on this phone changed, so your Only me copies were removed to be safe. They'll come back next time you're online. |
| Scanning and filing | Capture, the card | `capture.pageLimit` | 20 pages is the most one document takes. |
|  |  | `capture.tooBig` | This file is too big to add from a phone (over 25 MB). Add it from a computer instead. |
|  |  | `capture.noSpace` | Your phone is out of space, so this scan couldn't be kept. Free some space and scan again. |
|  |  | `capture.unreadable` | This scan couldn't be read. Try scanning it again. |
|  |  | `capture.signedOut` | Sign in again to save this scan. |
|  |  | `capture.offlineSkip` | No connection, and this phone hasn't seen the vault's choices yet. Skip keeps the scan: you can name it when you're back online. |
|  |  | `capture.offlineInbox` | No connection, and this phone hasn't seen the vault's choices yet. Send to my Inbox keeps the scan: it goes when you're back online, and you finish it in the browser. |
|  |  | `capture.queueUnavailable` | Couldn't keep it on this phone just now. Try Save again in a moment. |
|  |  | `capture.notAllowed` | Your account can open documents but not add them. Ask whoever runs the vault. |
|  |  | `capture.stillNeeded` | Still needed: {{fields}}. Fill it in, or skip for now. / Still needed: {{fields}}. Fill them in, or skip for now. |
|  |  | `capture.stillNeededInbox` | Still needed: {{fields}}. Fill it in, or send it to your Inbox for now. / Still needed: {{fields}}. Fill them in, or send it to your Inbox for now. |
|  |  | `capture.notADate` | That isn't a date we can read. A date, a month (March 2031) or a year. |
|  |  | `capture.notAYear` | That should be a year, such as 2026. |
|  |  | `capture.decimalPoint` | Use a point for a decimal, such as 3.5. |
|  |  | `capture.notANumber` | That should be a number, such as 42. |
|  |  | `capture.pencePoint` | Use a point for pence, such as 12.50. |
|  |  | `capture.notAnAmount` | That should be an amount, such as 12.50. |
| Scans on their way | Home, the queue | `queue.busy` | The vault is busy. Trying again in a moment. |
|  |  | `queue.notYet` | Not sent yet. Your scan is safe on this phone and will go by itself. |
|  |  | `queue.couldNotSend` | Couldn't send this scan. It's still on this phone. |
|  |  | `queue.tooBigForVault` | This file is bigger than your vault accepts ({{limit}}). Try fewer pages, or a smaller file. |
|  |  | `queue.wrongKind` | The vault can't keep this kind of file. It takes PDFs, photos (JPEG, PNG, HEIC, TIFF), Word and Excel files. |
|  |  | `queue.refused` | The vault didn't take it: {{reason}} |
|  |  | `queue.needsYou` | Needs you |
|  |  | `queue.storage` | The vault can't reach where it keeps files right now. Your scan is safe here and will try again. |
|  |  | `queue.noLongerAdd` | You can no longer add documents to this vault. Ask an owner. |
|  |  | `queue.ownerGone` | The person it was for is no longer in the family. Choose someone else, or save it without a person — it keeps who can see it. |
|  |  | `queue.versionRefused` | The vault didn't let you add a new version of this document. Whoever it belongs to can. |
|  |  | `queue.goesWithout` | It will go without {{names}}: its kind of document no longer asks for it. / It will go without {{names}}: its kind of document no longer asks for them. |
|  |  | `queue.filedWithout` | {{title}} is in the vault without {{names}}: its kind of document no longer asks for it. / {{title}} is in the vault without {{names}}: its kind of document no longer asks for them. |
| A list or a page that would not load | Home, Search, Needs attention, People, a person, a document | `states.loadFailed` | Couldn't load this. Try again in a moment. |
| What the vault read | Home, after Send to my Inbox | `vaultRead.slow` | The vault hasn't finished reading it yet. It's safe in your Inbox, where you can finish it. |
|  |  | `vaultRead.couldNotRead` | The vault couldn't read its pages. |
|  |  | `vaultRead.duplicate` | The vault already has this very file. |
|  |  | `vaultRead.finishThere` | Finish it in your Inbox in the browser, where you can change any of it. |
| A new version's details | A document | `renewal.changed` | This document was changed somewhere else, so nothing was saved and it has been loaded again. Check what the new version says against it. |
|  |  | `renewal.undoOpen` | The last change from a new version can still be undone. Try again in a few minutes. |
|  |  | `renewal.kept` | That can't be undone now: the document has changed since. |
|  |  | `renewal.notUndoable` | That can't be undone any more. |
| The scanner | Home | `home.scannerFailed` | The scanner couldn't start on this phone. Add a photo or a file instead — the first scan also needs an internet connection to set the scanner up. |
|  |  | `home.savedOffline` | Saved on this phone. It'll go to the vault as soon as there's a connection. |
|  |  | `home.savedInboxOffline` | Saved on this phone. It'll go to your Inbox as soon as there's a connection. |
|  |  | `home.savedInboxFiled` | Saved as a document only you can see. Add its details on the web. |
|  |  | `home.vaultWait` | The vault asked us to wait {{count}} second. Trying again then. / The vault asked us to wait {{count}} seconds. Trying again then. |
|  |  | `home.offline` | Offline: showing what's saved on this phone. It may be out of date. |
| Essentials kept for no signal | Home, a kept Essential, Sign in | `essentials.wrongPassword` | That password isn't right. |
|  |  | `essentials.noConnection` | No connection. Try again when the phone is online. |
|  |  | `essentials.failed` | That didn't work. Try again. |
|  |  | `essentials.connectBy` | Connect by {{date}} to keep these on this phone. |
|  |  | `essentials.renew` | Confirm it's you to keep your Essentials up to date on this phone. |
|  |  | `essentials.signInToSync` | Sign in again to keep these up to date. You can still open them. |
|  |  | `essentials.removedAge` | These copies went a long time without checking in with the vault, so they've been removed. They'll come back when you're online. |
|  |  | `essentials.removedSignedOut` | This phone was signed out of the vault, so the documents kept on it have been removed. |
|  |  | `essentials.shortOfSpace` | Your phone is short of space, so some Essentials couldn't be kept. |
|  |  | `essentials.offlineBanner` | No connection. Showing what's kept on this phone. Checked {{when}}. |
|  |  | `essentials.notKept` | This one isn't kept on this phone, so it needs a connection. |
|  |  | `essentials.noPreview` | Word and Excel files can't be shown on the phone. Connect and save a copy to open it. |
|  |  | `essentials.pending` | The vault is still preparing this document's pages. They'll be kept here the next time the phone is online. |
|  |  | `essentials.privateChanged` | A fingerprint or face was added or changed on this phone, so your Only me copies were removed. They'll be kept again when you're online. |
|  |  | `essentials.privateUnavailable` | This phone's fingerprint or face unlock can't open your Only me copies. |
| Show mode | Show | `show.notKept` | This one isn't kept on this phone, so it can't be shown without a connection. |
|  |  | `show.pending` | The vault is still preparing this document's pages. Try again in a minute. |
|  |  | `show.noPreview` | This document can't be shown on the phone. |
| Confirm it is you | The step-up sheet | `stepUp.failed` | That didn't match. Try again. |
|  |  | `stepUp.codeOnly` | This needs the code from your authenticator app: your password won't do here. |
|  |  | `stepUp.noCode` | This needs a code from an authenticator app, and this phone can't use your passkey. Add an authenticator app in Settings in the browser, or do this in the browser with your passkey. |
| Identity details | A person, the Identity card | `identity.needsConnection` | Identity details need a connection. They are never kept on this phone. |
|  |  | `identity.failed` | Identity details couldn't be read. Try again in a moment. |
|  |  | `identity.copyFailed` | This phone would not copy it. Show it instead. |
|  |  | `identity.gone` | There is no {{label}} to show any more. |
|  |  | `identity.twoStepHint` | You can turn it on in the browser, in Settings, then try again here. |
| A document | Document | `document.conflict` | Someone changed this while you were looking. Here's the latest. |
|  |  | `document.needsConnection` | Changes need a connection. |
|  |  | `document.notFound` | This document isn't there any more, or it isn't yours to see. |
|  |  | `document.notConfirmed` | It wasn't confirmed that it's you, so the pages aren't shown. |
|  |  | `document.saveWarning` | The copy you save is outside the vault, where the vault can't protect it. |
|  |  | `document.saveFailed` | The copy couldn't be saved. Try again. |
|  |  | `document.pageFailed` | The pages couldn't be fetched. Check the connection and try again. |
|  |  | `document.pending` | The vault is still preparing this document's pages. Try again in a minute. |
|  |  | `document.noPreview` | This document's pages can't be shown on the phone. Save a copy to open it. |
|  |  | `document.recordNoPreview` | No preview. This is {{format}}, kept as it is: the vault doesn’t open, read or draw it. Save a copy to open it in the app it’s for. Your patient portal’s PDF is the readable copy. |
|  |  | `document.failed` | That didn't work. Try again. |
| Changing a document | Edit details | `edit.stillNeeded` | Still needed: {{fields}}. |
|  |  | `edit.changed` | Someone changed this document while you were editing. Here it is as it is now: check it and save again. |
| Emergency information | More → Emergency information, a person, Share with a clinician | `emergency.needsConnection` | Emergency information is never kept on this phone. Connect to see it. |
|  |  | `emergency.none` | {{name}}’s emergency information isn’t shared with you. |
|  |  | `emergency.nobody` | No emergency information is shared with you yet. |
|  |  | `emergency.someFailed` | Some people’s pages couldn’t be loaded. |
|  |  | `emergency.empty` | Nothing entered yet. |
|  |  | `emergency.tickOne` | Tick at least one part to show. |
|  |  | `emergency.linkLocked` | Stopped: what it asks for was wrong too many times |
|  |  | `emergency.linkPaused` | Paused: whoever made it can’t sign in just now |
|  |  | `emergency.linkUsedUp` | Used up: opened as many times as it allows |
|  |  | `emergency.linkEnded` | Ended |
| Collections | Collections, a collection | `collections.needsConnection` | Collections need a connection to the vault. |
|  |  | `collection.gone` | This collection isn't there any more, or isn't one you can see. |
| Downloading as one ZIP | Documents → Choose, a collection’s ⋯ → Download | `download.needsConnection` | Downloading needs a connection to the vault. |
|  |  | `download.failed` | The download couldn’t be made. Try again. |
|  |  | `download.noFile` | This document has no file to download. |
|  |  | `download.nothingChosen` | None of these has a file you can download: a note you can’t open, or a document kept without its file, isn’t included. |
|  |  | `download.nothingInCollection` | Nothing in this collection has a file you can download: a note you can’t open, or a document kept without its file, isn’t included. |
|  |  | `download.tooLarge` | That is more than one download holds: {{documents}} documents or {{gb}} GB. Choose fewer, or download everything from Export on the web. |
|  |  | `download.tooLargePlain` | That is more than one download holds. Choose fewer, or download everything from Export on the web. |
|  |  | `download.ticketGone` | The download ran out before it could start. Try Download again. |
| Sharing | More → Sharing | `sharing.needsConnection` | Sharing needs a connection to the vault. |
| Changing a link | More → Sharing → Change | `changeLink.latest` | It can last until {{end}} at the latest: as long as a link may from when it was made. |
|  |  | `changeLink.passwordShort` | At least 8 characters. Something they can type, and you can say to them. |
| My cabinet | Documents → Cabinet, a cabinet, a drawer, a folder | `cabinet.needsConnection` | Showing your cabinet needs a connection to your vault. |
|  |  | `cabinet.showingLast` | Offline: showing your cabinet as it was when last opened. |
|  |  | `cabinet.empty` | Your cabinet is empty. Arrange it on the web, and it shows here. |
|  |  | `cabinet.allHidden` | Every cabinet is hidden. Show one again on the web. |
|  |  | `cabinet.noCabinet` | This vault doesn't have cabinets yet. |
|  |  | `cabinet.gone` | This isn't in your cabinet any more. It may have been taken out or hidden on the web. |
|  |  | `cabinet.folderGone` | This folder isn't in your cabinet. It may have been taken out or hidden, or the label may be someone else's. |
|  |  | `cabinet.questionRefused` | This folder asks for something you can't see any more. Change it on the web. |
| Scanning a folder label | Scan a folder label | `cabinet.otherVault` | This label is from another vault ({{host}}). It opens only there. |
|  |  | `cabinet.notALabel` | That code isn't a folder label. |
|  |  | `cabinet.noCamera` | There's no camera here to scan with. |
|  |  | `cabinet.cameraOff` | The camera is off for this app. Turn it on in the phone's settings to scan a label. |
| Notes | Notes, New note | `notesList.needsConnection` | Your notes need a connection to your vault. You can still write a new one: it's sent once the vault can be reached. |
|  |  | `newNote.tooLong` | Too long to save: {{count}} characters. |
|  |  | `newNote.offline` | Your vault can't be reached right now. This note is kept on this phone, and sent once it can be. |
|  |  | `newNote.notKept` | This phone couldn't keep the note to send later. Copy your words somewhere safe, then try again. |
|  |  | `newNote.sendingNow` | This note is on its way to your vault now. Open it from Notes once it's there to change it. |
|  |  | `newNote.gone` | This note has reached your vault. Open it from Notes to change it there. |
|  |  | `newNote.notWithItSending` | This note started on its way to your vault as it was, so your change didn't go with it. Save it as a new note to keep it, or Cancel. |
|  |  | `newNote.notWithItGone` | This note reached your vault as it was, so your change didn't go with it. Save it as a new note to keep it, or Cancel. |
|  |  | `newNote.sentOnce` | This note was sent once and we haven't heard back yet. If you change it, we first make sure that one reached your vault, then ask about your changes. |
| Notes written offline | Notes, New note | `notesList.waiting` | Waiting to send |
|  |  | `notesList.unsure` | Might already be in your vault |
|  |  | `notesList.unsureWhy` | We sent this but didn't hear back. Check Notes first. If it isn't there, send it again. |
|  |  | `notesList.couldNotSend` | Couldn't send — {{reason}} |
|  |  | `notesList.unreadable` | Couldn't read this note |
|  |  | `notesList.deleteSending` | It's on its way to your vault now, so it can't be deleted here. Once it's there, delete it from its page. |
|  |  | `notesList.deleteWordsUnsure` | “{{name}}” might already be in your vault. Deleting it here only removes it from this phone: if it's in Notes, it stays there. This can't be undone. |
|  |  | `notesList.narrowed` | “{{name}}” was sent as Only me: you can no longer make notes Adults only. |
|  |  | `notesList.arrived` | In your vault, with its earlier words |
|  |  | `notesList.arrivedWhy` | Your note reached the vault with its earlier words. Send your changes as a new note? |
|  |  | `notesList.arrivedWhyReused` | An earlier version of this note is already in your vault. Send your changes as a new note? |
|  |  | `notesList.arrivedWhyHidden` | Your note reached the vault with its earlier words, and is now kept private by the person it's about. Send your changes as a new note? |
|  |  | `notesList.discardWords` | “{{name}}” is in your vault with its earlier words, and stays there. Your changes are only on this phone: discarding them can't be undone. |
|  |  | `notesList.hidden` | “{{name}}” reached your vault. It's now kept private by the person it's about, so it isn't in your list. |
|  |  | `notesList.putIntoChanged` | That note was changed somewhere else since, so your changes weren't put in. Send them as a new note, or discard them. |
|  |  | `edit.noteOffline` | Changing a note needs a connection to your vault. New notes can be written now, and are sent later. |
| A row’s ⋯ | Home, Search, a person | `row.collectionGone` | “{{name}}” is not there any more, so nothing went into it. |
| A note’s link | Document | `notes.openFailed` | This phone couldn't open that link. |
| Search, Needs attention, People | Tabs | `search.needsConnection` | Search needs a connection. Your Essentials are under On this phone. |
|  |  | `search.sealedNone` | Nothing in your private document matched. / Nothing in your {{count}} private documents matched. |
|  |  | `attention.needsConnection` | Changes need a connection. |
|  |  | `attention.failed` | That didn't work. Try again. |
|  |  | `people.needsConnection` | People need a connection. |
| Notifications | Settings → Notifications | `push.iphone` | On iPhone, reminders come by email. |
|  |  | `push.oldVault` | This vault can't send reminders to phones yet. Updating it will fix that. |
|  |  | `push.noDistributor` | To get reminders on this phone, install a free notification app such as ntfy, then come back. The daily email still works either way. |
|  |  | `push.permissionOff` | Notifications are off for this app. You can turn them on in your phone's settings. |
|  |  | `push.failed` | Notifications couldn't be set up: {{why}} |
|  |  | `push.failedNetwork` | there was no connection. |
|  |  | `push.failedAction` | the notification app needs you to open it first. |
|  |  | `push.failedOther` | the notification app said no. |
|  |  | `push.unreachable` | Couldn't reach your vault. Try again when you're online. |
| Settings | Settings | `settings.notSecure` | Not secure: reached without encryption, on your home network only. |
|  |  | `settings.changeVaultWords` | Changing the vault signs you out and removes everything kept on this phone. |
|  |  | `settings.changeVaultWaiting` | A scan hasn't reached this vault yet. It will be removed too. / {{count}} scans haven't reached this vault yet. They will be removed too. |
|  |  | `settings.changeVaultNotes` | A note written on this phone hasn't reached this vault, or may be on its way. It will be removed from this phone, and can't be got back. / {{count}} notes written on this phone haven't reached this vault, or may be on their way. They will be removed from this phone, and can't be got back. |
|  |  | `settings.notesWaiting` | A note you wrote hasn't reached the vault yet. / {{count}} notes you wrote haven't reached the vault yet. |
|  |  | `settings.onItsWay` | One is already on its way and will reach the vault. / {{count}} are already on their way and will reach the vault. |
|  |  | `settings.devicesUnreachable` | Couldn't reach your vault to list them. Try again when you're online. |
|  |  | `settings.offlineNone` | Nothing is kept on this phone. You can keep the Essentials here from Home. |
|  |  | `settings.offlineRemoveWords` | They are deleted from this phone now, and your vault is told this phone keeps nothing. You can keep them again later. |
