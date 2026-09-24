# Changelog

All notable changes to the Family Vault phone app. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the
app's own, tagged `vX.Y.Z` in this repository.

## [Unreleased]

## [0.1.1] — iteration 4.2: connect and sign in

### Added
- Connect: type the vault's address and the app finds it, trying https
  first. Every way it can fail has its own sentence: not a vault, a vault
  too old for the app (with both versions and a link to the upgrade
  steps), an app too old for the vault, a vault not yet set up (opens it
  in the browser).
- Plain http only to a private address, never on mobile data, and only
  after a one-time question per vault. Nothing but the capability check
  is sent to it before the answer is yes. From then on no token goes to
  an http vault until it has shown the installation id recorded the first
  time (checked again after 5 minutes, a network change, or coming back
  to the app). Over https, a new installation id means the vault was
  reinstalled: sign in again.
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

## [0.1.0] — iteration 4.0: the scanner spike

Not tagged separately: its builds are `dev-latest` and `preview-latest` at
17c81ad. The workspace, the one native build, CI with the Android builds,
the scanner and PDF spike, and the probes P1–P12 for the owner's session.
