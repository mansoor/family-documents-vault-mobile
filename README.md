# Family Vault — the phone app

The Android (and later iPhone) companion to
[Family Document Vault](https://github.com/mansoor/family-documents-vault):
capture a document in three taps, keep Essentials on the phone for when there
is no signal, and show an ID at a counter.

This repository is private. It consumes the public repository's
platform-neutral packages (`@fdv/shared`, `@fdv/client`) as a git submodule at
`vendor/fdv`, and never the other way round.

## The builds

| Build | Name on the phone | What it is for |
| --- | --- | --- |
| dev | FV dev | Development: the JavaScript comes from the laptop (Metro, port 8081). |
| preview | FV test | A test build with everything inside it and a **TEST BUILD** banner. |
| e2e | FV e2e | The emulator's build, with fake fixtures (from 4.5). |
| release | Family Vault | The real app, signed with the owner's key (from the Phase 4 exit). |

Each has its own id, so they can sit on one phone side by side.

**Test builds talk to throwaway vaults only** — a stack started for the test,
on port 8099, never the family's own vault on 8080.

## Installing a test build on an Android phone

1. On the phone, open the repository's **Releases** page and download the APK
   from **preview-latest** (or **dev-latest**).
2. Allow your browser to install apps when Android asks ("Install unknown
   apps" for that browser), then open the APK.
3. The phone reaches the throwaway vault at `http://<laptop's address>:8099`
   on the same Wi-Fi. The laptop needs inbound firewall rules for TCP 8099
   (the vault) and TCP 8081 (Metro, dev builds only), private networks only.

APKs are built by GitHub Actions (`android.yml`), never on the laptop: run it
by hand from the Actions tab, or push a `v*` tag for a preview build.

## Working on it

Node 22 and pnpm 9.15.9. Clone with `--recurse-submodules` into a path without
spaces (Gradle, Metro and pnpm dislike them), then:

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

`vendor/fdv` is the public repository, pinned. Its push URL is disabled on
purpose: changes to the server or the shared packages go through the public
repository and its pull requests, and are pinned here afterwards. CI refuses
a pin that is neither on the public `develop` nor a release tag.

## Trying it in a browser

The web build runs the same screens against a real vault, which is how
the sign-in flow is tested in CI. It is for development only: the phone
app is the product.

```bash
cd apps/pocket
pnpm web:export
FDV_DEV_API=http://localhost:8099 node scripts/serve-web.mjs
```

Open http://localhost:8098 and give the app that same address,
`localhost:8098`: the server passes `/api/` through to the vault, so the
browser talks to one origin and the vault needs no CORS rules. It listens
on loopback only unless `HOST` says otherwise.

`pnpm web:e2e` builds the export and runs the Playwright test in
`e2e-web/` against `FDV_DEV_API` (default `http://localhost:8099`). On a
fresh vault it sets one up first; for a vault that is already set up, set
`FDV_E2E_EMAIL` and `FDV_E2E_PASSWORD`.
