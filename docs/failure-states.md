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
| Signing in | Sign in | `signIn.signedOutHere` | You've been signed out on this phone. Sign in again to carry on. |
|  |  | `signIn.passkeyOnly` | You sign in with a passkey. The app can't use passkeys yet, so set a password in the browser (Settings → Password), then sign in here with it. |
|  |  | `signIn.startAgain` | Start again from your password. |
| Any request that fails (wordsFor) | Every screen | `errors.offline` | Can't reach your vault right now. Check this phone's connection, then try again. |
|  |  | `errors.timeout` | Your vault took too long to answer. Try again in a moment. |
|  |  | `errors.rateLimited` | Too many tries. Wait a minute, then try again. / Too many tries. Wait {{count}} minutes, then try again. |
|  |  | `errors.unavailable` | Your vault is busy or starting up. Try again in a moment. |
|  |  | `errors.internal` | Something went wrong on your vault. Try again in a moment; if it keeps happening, whoever looks after the vault can have a look. |
|  |  | `errors.storageUnreachable` | Your vault can't reach the place it keeps its files right now. Anything waiting on this phone is kept, and sent when it can. |
|  |  | `errors.sessionEnded` | You were signed out. Sign in again to carry on. |
|  |  | `errors.stepUp` | Confirm it's you to carry on. |
|  |  | `errors.setupRequired` | This vault hasn't been set up yet. Open it in the browser first. |
|  |  | `errors.unexpected` | Something went wrong between this phone and your vault. Try again in a moment; if it keeps happening, whoever looks after the vault can have a look. |
|  |  | `errors.stranger` | Nothing was sent: something other than your vault is answering at its address on this network. |
|  |  | `errors.wifiOnly` | Nothing was sent: this vault is only used on Wi-Fi. Join your Wi-Fi, then try again. |
|  |  | `errors.invalidCredentials` | That email and password don't match. Check them and try again. |
|  |  | `errors.notFound` | That isn't there any more, or it isn't yours to see. |
|  |  | `errors.previewPending` | The vault is still drawing the pages. Try again in a minute. |
|  |  | `errors.noPreview` | The vault can't draw pages for this file. Save a copy to open it. |
|  |  | `errors.uploadInProgress` | This is still on its way to the vault. Try again in a moment. |
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
|  |  | `capture.queueUnavailable` | Couldn't keep it on this phone just now. Try Save again in a moment. |
|  |  | `capture.notAllowed` | Your account can open documents but not add them. Ask whoever runs the vault. |
| Scans on their way | Home, the queue | `queue.busy` | The vault is busy. Trying again in a moment. |
|  |  | `queue.notYet` | Not sent yet. Your scan is safe on this phone and will go by itself. |
|  |  | `queue.tooBigForVault` | This file is bigger than your vault accepts ({{limit}}). Try fewer pages, or a smaller file. |
|  |  | `queue.wrongKind` | The vault can't keep this kind of file. It takes PDFs, photos (JPEG, PNG, HEIC, TIFF), Word and Excel files. |
|  |  | `queue.refused` | The vault didn't take it: {{reason}} |
|  |  | `queue.needsYou` | Needs you |
|  |  | `queue.storage` | The vault can't reach where it keeps files right now. Your scan is safe here and will try again. |
|  |  | `queue.noLongerAdd` | You can no longer add documents to this vault. Ask an owner. |
|  |  | `queue.ownerGone` | The person it was for is no longer in the family. Choose someone else, or save it without a person — it keeps who can see it. |
|  |  | `queue.versionRefused` | The vault didn't let you add a new version of this document. Whoever it belongs to can. |
| The scanner | Home | `home.scannerFailed` | The scanner couldn't start on this phone. Add a photo or a file instead — the first scan also needs an internet connection to set the scanner up. |
|  |  | `home.savedOffline` | Saved on this phone. It'll go to the vault as soon as there's a connection. |
|  |  | `home.offline` | No connection. What you see may be out of date. |
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
| A document | Document | `document.conflict` | Someone changed this while you were looking. Here's the latest. |
|  |  | `document.needsConnection` | Changes need a connection. |
|  |  | `document.notFound` | This document isn't there any more, or it isn't yours to see. |
|  |  | `document.notConfirmed` | It wasn't confirmed that it's you, so the pages aren't shown. |
|  |  | `document.saveWarning` | The copy you save is outside the vault, where the vault can't protect it. |
|  |  | `document.saveFailed` | The copy couldn't be saved. Try again. |
|  |  | `document.pageFailed` | The pages couldn't be fetched. Check the connection and try again. |
|  |  | `document.pending` | The vault is still preparing this document's pages. Try again in a minute. |
|  |  | `document.noPreview` | This document's pages can't be shown on the phone. Save a copy to open it. |
|  |  | `document.failed` | That didn't work. Try again. |
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
|  |  | `settings.onItsWay` | One is already on its way and will reach the vault. / {{count}} are already on their way and will reach the vault. |
|  |  | `settings.devicesUnreachable` | Couldn't reach your vault to list them. Try again when you're online. |
|  |  | `settings.offlineNone` | Nothing is kept on this phone. You can keep the Essentials here from Home. |
|  |  | `settings.offlineRemoveWords` | They are deleted from this phone now, and your vault is told this phone keeps nothing. You can keep them again later. |
