import type { DocumentView, VersionView } from '@fdv/shared';
import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import CaptureScreen from '../app/capture';
import { DocumentDetail } from '../documents/detail';
import type { Tier } from '../essentials/open';
import { EssentialPages } from '../essentials/pages';
import { MemoryEssentialsStore } from '../essentials/store';
import { LockGate } from '../lock/gate';
import { KeyRing } from '../lock/keys';
import type { ShowPlatform } from '../show/platform';
import { ShowMode } from '../show/show';
import type { EssentialsDeps } from '../state/essentials';
import { useLock, type LockDeps } from '../state/lock';
import { useVault } from '../state/vault';
import type { CaptureDeps } from '../state/capture';
import { renderApp, signedIn, testCapture } from './render';
import { back, useTopRoute } from './router';
import { nextEtag, type TestVault } from './vault';

/** Show mode's phone side, doing nothing: these tests are about what is shown. */
export const quietPlatform: ShowPlatform = {
  brightness: async () => 0.5,
  setBrightness: async () => undefined,
  restoreBrightness: async () => undefined,
  keepAwake: async () => undefined,
  orientation: async () => undefined,
  immersive: async () => undefined,
  screenReader: async () => false,
  onScreenReader: () => () => undefined,
};

/** The app as the routes lay it out: the screen started on, and whatever was pushed over it. */
export function LookupApp(props: { start: ReactElement }) {
  const top = useTopRoute();
  const { phase } = useVault();
  const { status } = useLock();
  if (phase !== 'ready' || status === 'checking') return <LockGate>{null}</LockGate>;
  const id = top?.params.id ?? '';
  const online = top?.params.online === '1';
  const content =
    top?.pathname === '/document/[id]' ? (
      <DocumentDetail id={id} />
    ) : top?.pathname === '/essential/[id]' ? (
      <EssentialPages id={id} online={online} />
    ) : top?.pathname === '/show/[id]' ? (
      <ShowMode id={id} online={online} onLeave={back} platform={quietPlatform} />
    ) : top?.pathname === '/capture' ? (
      <CaptureScreen />
    ) : (
      props.start
    );
  return <LockGate>{content}</LockGate>;
}

/** A document the vault has, with one version (sensitive: its pages ask to confirm it is you). */
export function libraryDoc(
  t: TestVault,
  over: Partial<DocumentView> & { id: string },
  version: Partial<VersionView> & { sensitive?: boolean } = {},
): DocumentView {
  const doc = {
    title: 'A document',
    type_key: 'passport',
    owner_member_id: 'fake-member',
    category: 'identity',
    visibility: 'household',
    issued: null,
    expires: null,
    identifier: null,
    issued_by: null,
    physical_location: null,
    is_essential: false,
    tags: [],
    notes: null,
    extra: {},
    status: { value: 'valid', label: '' },
    versions: 1,
    latest_version_id: `${over.id}-v1`,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    deleted_at: null,
    etag: nextEtag(),
    ...over,
  } as DocumentView;
  const { sensitive, ...v } = version;
  const ver = {
    id: `${over.id}-v1`,
    document_id: over.id,
    version_no: 1,
    filename: `${over.id}.pdf`,
    mime: 'application/pdf',
    byte_size: 1234,
    sha256: 'x',
    page_count: 2,
    ocr_status: 'done',
    uploaded_at: '2026-09-01T00:00:00Z',
    preview_pages: 2,
    ...v,
  } as VersionView;
  t.library.documents.set(doc.id, doc);
  t.library.versions.set(doc.id, [ver]);
  t.library.content.set(ver.id, new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  if (sensitive) t.library.sensitive.add(ver.id);
  return doc;
}

/** The phone's lock (a fake that always opens) and its kept Essentials, in memory. */
export function phoneParts(stores = new Map<Tier, MemoryEssentialsStore>()) {
  const lock: Partial<LockDeps> = {
    auth: { level: async () => 'strong', authenticate: async () => 'ok' },
    keys: new KeyRing(),
    screen: { prevent: async () => undefined, allow: async () => undefined },
    exitApp: () => undefined,
    autoPrompt: false,
  };
  const essentials: Partial<EssentialsDeps> = {
    io: {
      open: async (tier: Tier) => {
        let s = stores.get(tier);
        if (!s) {
          s = new MemoryEssentialsStore();
          stores.set(tier, s);
        }
        return s;
      },
      remove: async (tier: Tier) => void stores.delete(tier),
    },
  };
  return { lock, essentials, stores };
}

/** Signed in, the app unlocked, on `start`. */
export async function unlocked(
  t: TestVault,
  start: ReactElement,
  opts: {
    parts?: ReturnType<typeof phoneParts>;
    capture?: Partial<CaptureDeps>;
    before?: () => void | Promise<void>;
  } = {},
) {
  const parts = opts.parts ?? phoneParts();
  await signedIn(t);
  // Signed in, before the app starts: the vault's side of things set up.
  await opts.before?.();
  const app = await renderApp(<LookupApp start={start} />, {
    fetch: t.fetch,
    lock: parts.lock,
    essentials: parts.essentials,
    capture: opts.capture ?? testCapture(),
  });
  await fireEvent.press(await screen.findByTestId('lock-unlock'));
  return { app, parts };
}
