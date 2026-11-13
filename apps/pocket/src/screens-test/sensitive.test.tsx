import type { AiReaderView, DocumentTypeView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useEffect, useRef, useState } from 'react';
import DocumentsScreen from '../app/(tabs)/documents';
import CaptureScreen from '../app/capture';
import EditScreen from '../app/edit/[id]';
import { fixtureScanner } from '../capture/scanner';
import { chooseType, newDraft, toMetadata, type Household } from '../capture/draft';
import { DocumentDetail } from '../documents/detail';
import { draftOf, editBody } from '../documents/edit';
import { countOn, listQuery, NO_FILTERS, searchQuery } from '../documents/filter-model';
import { AiReaderCard, hostOf } from '../settings/ai-reader-card';
import { useCapture } from '../state/capture';
import { useVault } from '../state/vault';
import { audit } from '../test-support/a11y';
import { jpeg } from '../test-support/capture';
import { libraryDoc, openSearch, unlocked } from '../test-support/lookup';
import { installed, renderApp, signedIn, testCapture } from '../test-support/render';
import { push, resetRoutes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * Sensitive on the phone (AIR4; the vault's AIR2, 0.9.0-dev.34, and AIR3,
 * 0.9.0-dev.37): As its kind says, Yes or No on the capture card and in
 * Edit details; a lock on a sensitive document's page; Sensitive among
 * Documents' filters; and the household's AI reader, read only, in
 * Settings → Reading for an owner.
 */

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.9.0-dev.37: Sensitive, V1's filters, and the AI reader in Settings; `older`, one before them. */
function vault(older = false): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: older ? '0.9.0-dev.33' : '0.9.0-dev.37',
    features: {
      ...caps0519().features,
      document_table: true,
      document_filters: true,
      ...(older
        ? {}
        : {
            sensitive_documents: true,
            ai_reader_settings: true,
            ai_reader_kinds: ['ollama', 'anthropic', 'openai_compatible'],
            ai_reader_send_sensitive: true,
          }),
    },
  });
  return t;
}

const kind = (key: string, sensitive: boolean): DocumentTypeView =>
  ({
    key,
    label: key,
    category: 'household',
    fields: [],
    expiry_driver: null,
    reminder_leads: [],
    usually_essential: false,
    default_visibility: 'household',
    sensitive_default: sensitive,
  }) as DocumentTypeView;

const h: Household = {
  types: [kind('passport', true), kind('warranty', false)],
  members: [{ id: 'me', display_name: 'Mansoor' }],
  me: { member_id: 'me', role: 'owner' },
  issuedBy: true,
  details: false,
  sensitive: true,
};

describe('the card’s Sensitive, as the vault takes it', () => {
  it('left as its kind says, it is not sent; Yes or No is; an older vault is never sent it', () => {
    const d = chooseType(newDraft('camera' as never, h.me), 'warranty', h);
    expect(d.sensitive).toBeNull();
    expect(toMetadata(d, h).metadata).not.toHaveProperty('sensitive');
    expect(toMetadata({ ...d, sensitive: true }, h).metadata).toMatchObject({ sensitive: true });
    expect(toMetadata({ ...d, sensitive: false }, h).metadata).toMatchObject({ sensitive: false });
    expect(toMetadata({ ...d, sensitive: true }, { ...h, sensitive: false }).metadata).not.toHaveProperty('sensitive');
    // Kept when the kind changes: As its kind says follows the kind.
    expect(chooseType({ ...d, sensitive: true }, 'passport', h).sensitive).toBe(true);
  });

  it('a teen may make a paper sensitive, never not', () => {
    const teen = { ...h, me: { member_id: 'me', role: 'teen' as const } };
    const d = { ...chooseType(newDraft('camera' as never, teen.me), 'warranty', teen), sensitive: false };
    expect(toMetadata(d, teen).problem?.field).toBe('sensitive');
  });

  it('edited: sent only when it changed, as the web sends it', () => {
    const doc = { type_key: 'warranty', owner_member_id: 'me', sensitive: null, visibility: 'household', is_essential: false, extra: {} } as never;
    const d = draftOf(doc);
    expect(d.sensitive).toBeNull();
    expect(editBody(d, h, { confirm: false, sensitiveWas: null }).body).not.toHaveProperty('sensitive');
    expect(editBody({ ...d, sensitive: true }, h, { confirm: false, sensitiveWas: null }).body).toMatchObject({ sensitive: true });
    expect(editBody({ ...d, sensitive: null }, h, { confirm: false, sensitiveWas: true }).body).toMatchObject({ sensitive: null });
    // A teen's paper already marked No stays theirs to keep so: nothing is refused, nothing is sent.
    const teen = { ...h, me: { member_id: 'me', role: 'teen' as const } };
    const no = { ...d, sensitive: false };
    const out = editBody(no, teen, { confirm: false, sensitiveWas: false });
    expect(out.problem).toBeNull();
    expect(out.body).not.toHaveProperty('sensitive');
  });
});

/** The card, the way the + opens it: the scanner has just said Done. */
function Scanned() {
  const capture = useCapture();
  const { who } = useVault();
  const [open, setOpen] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!who || started.current) return;
    started.current = true;
    void capture.start('scan').then((o) => setOpen(o === 'card'));
  }, [who, capture]);
  return open ? <CaptureScreen /> : null;
}

async function card(t: TestVault) {
  await signedIn(t);
  const phone = testCapture({ scanner: fixtureScanner([{ kind: 'pages', pages: [{ uri: 'cache:/scan/1.jpg' }] }]) });
  phone.files.set('cache:/scan/1.jpg', jpeg('card.jpg'));
  await renderApp(<Scanned />, { fetch: t.fetch, capture: phone });
  await screen.findByText('What it is');
}

describe('the capture card', () => {
  it('asks Sensitive: As its kind says, with what that is now, Yes or No', async () => {
    const t = vault();
    await card(t);
    // No kind yet: as its kind says is yes, the safer answer.
    expect(await screen.findByTestId('sensitive-kind')).toHaveTextContent('As its kind says (yes)');
    expect(screen.getByTestId('sensitive-kind').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByText('Handled with extra care. Never sent to a cloud AI reader.')).toBeTruthy();
    // A bill is not sensitive by default: the words follow the kind.
    await fireEvent.press(screen.getByTestId('types-more'));
    await fireEvent.changeText(screen.getByTestId('types-search'), 'Utility');
    await fireEvent.press(await screen.findByText('Utility / bill'));
    expect(screen.getByTestId('sensitive-kind')).toHaveTextContent('As its kind says (no)');
    await fireEvent.press(screen.getByTestId('sensitive-yes'));
    expect(screen.getByTestId('sensitive-yes').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('sensitive-no')).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it('is not asked by an older vault', async () => {
    const t = vault(true);
    await card(t);
    await screen.findByTestId('visibility-household');
    expect(screen.queryByTestId('sensitive')).toBeNull();
  });
});

describe('a sensitive document, on its page and in Edit details', () => {
  it('a lock says Sensitive; Edit offers the three, and sends Yes', async () => {
    const t = vault();
    const edits: Record<string, unknown>[] = [];
    const inner = t.fetch;
    t.fetch = async (url, init) => {
      if (init.method === 'PATCH' && /\/api\/v1\/documents\/[^/]+$/.test(url) && typeof init.body === 'string') {
        edits.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return inner(url, init);
    };
    libraryDoc(t, {
      id: 'bill',
      title: 'Water bill',
      type_key: 'utility_bill',
      // A bill's Due date is required.
      extra: { due_date: { date: '2026-12-01', precision: 'day' } },
      sensitive: null,
      sensitive_effective: false,
    } as never);
    libraryDoc(t, { id: 'pass', title: 'Passport', type_key: 'passport', sensitive: null, sensitive_effective: true } as never);
    await unlocked(t, <DocumentDetail id="pass" />);
    expect(await screen.findByTestId('document-sensitive')).toHaveTextContent('Sensitive');
    expect(screen.getByTestId('document-sensitive').props.accessibilityLabel).toBe('Sensitive');

    push({ pathname: '/edit/[id]', params: { id: 'bill' } });
    await unlocked(t, <EditScreen />);
    const asKind = await screen.findByTestId('edit-sensitive-kind');
    expect(asKind).toHaveTextContent('As its kind says (no)');
    expect(asKind.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    await fireEvent.press(screen.getByTestId('edit-sensitive-yes'));
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).toMatchObject({ sensitive: true });
  });

  it('a document not sensitive has no lock; nor does any on an older vault', async () => {
    const t = vault();
    libraryDoc(t, { id: 'bill', title: 'Water bill', type_key: 'utility_bill', sensitive: null, sensitive_effective: false } as never);
    await unlocked(t, <DocumentDetail id="bill" />);
    await screen.findByTestId('document-subline');
    expect(screen.queryByTestId('document-sensitive')).toBeNull();

    const old = vault(true);
    libraryDoc(old, { id: 'pass', title: 'Passport', type_key: 'passport' });
    await unlocked(old, <DocumentDetail id="pass" />);
    await screen.findByTestId('document-subline');
    expect(screen.queryByTestId('document-sensitive')).toBeNull();
  });
});

describe('Documents: Sensitive, among the filters', () => {
  it('asked as sensitive=yes,no where the vault takes it, and counted as one filter', () => {
    const f = { ...NO_FILTERS, sensitive: ['yes' as const] };
    expect(countOn(f)).toBe(1);
    const apart = { tags: true, notes: true, sensitive: true };
    expect(listQuery(f, { sort: 'recent', table: true, several: true, apart })).toMatchObject({ sensitive: 'yes' });
    expect(listQuery({ ...f, sensitive: ['yes', 'no'] }, { sort: 'recent', table: true, several: true, apart })).toMatchObject({
      sensitive: 'yes,no',
    });
    expect(searchQuery(f, { several: true, categoryOf: () => null, apart })).toMatchObject({ sensitive: 'yes' });
    // An older vault is never asked.
    expect(listQuery(f, { sort: 'recent', table: true, several: true, apart: { tags: true, notes: true } })).not.toHaveProperty(
      'sensitive',
    );
  });

  it('offered in the slide-out, and said on its chip', async () => {
    const t = vault();
    t.vault.state.documents.push({ id: 'p1', title: 'Passport', type_key: 'passport', owner_member_id: 'fake-member', tags: [], extra: {} } as never);
    await unlocked(t, <DocumentsScreen />);
    await openSearch();
    await fireEvent.press(screen.getByTestId('documents-filters'));
    await fireEvent.press(await screen.findByTestId('filter-sensitive-yes'));
    await fireEvent.press(screen.getByTestId('filters-apply'));
    await waitFor(() =>
      expect(
        t.calls
          .filter((c) => c.startsWith(`GET ${ORIGIN}/api/v1/documents?`))
          .map((c) => new URL(c.slice(4)).searchParams.get('sensitive'))
          .includes('yes'),
      ).toBe(true),
    );
    expect(await screen.findByTestId('documents-chip-sensitive')).toHaveTextContent('Sensitive');
  });

  it('not offered by an older vault', async () => {
    const t = vault(true);
    await unlocked(t, <DocumentsScreen />);
    await openSearch();
    await fireEvent.press(screen.getByTestId('documents-filters'));
    await screen.findByTestId('filter-status-expired');
    expect(screen.queryByTestId('filter-sensitive-yes')).toBeNull();
  });
});

/** The reader as a vault of 0.9.0-dev.37 answers it: Anthropic, a cloud service, its Test passed. */
const cloudReader = (over: Partial<AiReaderView> = {}): AiReaderView => ({
  source: 'settings',
  kinds: ['ollama', 'anthropic', 'openai_compatible'],
  env: null,
  reader: {
    kind: 'anthropic',
    base_url: null,
    model: 'claude-haiku-4-5',
    timeout_seconds: 120,
    runs_at: 'cloud',
    api_key: 'set',
    api_key_last4: 'wxyz',
    monthly_cap: 500,
    status: 'ok',
    last_tested_at: '2026-11-13T09:00:00Z',
    last_problem: null,
    updated_at: '2026-11-13T09:00:00Z',
  },
  https_only: false,
  send_sensitive: true,
  month: { month: '2026-11', sent: 120, cap: 500, warned: false },
  ...over,
});

describe('Settings → Reading: the AI reader, read only', () => {
  it('an owner sees which reader, where it runs, whether sensitive papers go, and the month; never the key', async () => {
    const t = vault();
    t.vault.state.aiReader = cloudReader();
    await unlocked(t, <AiReaderCard />);
    expect(await screen.findByTestId('ai-reader-reader')).toHaveTextContent(/Anthropic · claude-haiku-4-5$/);
    expect(screen.getByTestId('ai-reader-address')).toHaveTextContent(/api\.anthropic\.com/);
    expect(screen.getByTestId('ai-reader-where')).toHaveTextContent(/A cloud service/);
    expect(screen.getByTestId('ai-reader-sensitive')).toHaveTextContent(/Sent to it too/);
    expect(screen.getByTestId('ai-reader-month')).toHaveTextContent(/120 of 500 this month/);
    expect(screen.getByTestId('ai-reader-on-web')).toHaveTextContent('Change these on the web.');
    expect(screen.queryByText(/wxyz/)).toBeNull();
  });

  it('a reader on your own network: its host alone, no month, sensitive papers read at home', async () => {
    const t = vault();
    const view = cloudReader({ send_sensitive: false });
    t.vault.state.aiReader = {
      ...view,
      reader: { ...view.reader!, kind: 'ollama', base_url: 'http://192.168.1.30:11434', model: 'qwen2.5:3b-instruct', runs_at: 'own_network', status: 'untested' },
    };
    await unlocked(t, <AiReaderCard />);
    expect(await screen.findByTestId('ai-reader-reader')).toHaveTextContent(/Local \(Ollama\) · qwen2\.5:3b-instruct$/);
    expect(screen.getByTestId('ai-reader-address')).toHaveTextContent(/192\.168\.1\.30:11434/);
    expect(screen.getByTestId('ai-reader-where')).toHaveTextContent(/On your own network/);
    expect(screen.getByTestId('ai-reader-status')).toHaveTextContent(/Not tested yet/);
    expect(screen.getByTestId('ai-reader-sensitive')).toHaveTextContent(/Read on your own network/);
    expect(screen.queryByTestId('ai-reader-month')).toBeNull();
  });

  it('none set up says so; the address is only ever its host', async () => {
    expect(hostOf('https://llm.example.org:8443')).toBe('llm.example.org:8443');
    expect(hostOf(null)).toBeNull();
    const t = vault();
    await unlocked(t, <AiReaderCard />);
    expect(await screen.findByTestId('ai-reader-none')).toHaveTextContent('No AI reader is set up.');
  });

  it('not shown to anybody but an owner, nor by an older vault', async () => {
    const t = vault();
    t.vault.state.role = 'adult';
    t.vault.state.aiReader = cloudReader();
    await unlocked(t, <AiReaderCard />);
    await waitFor(() => expect(t.calls.some((c) => c.includes('/api/v1/me'))).toBe(true));
    expect(screen.queryByTestId('ai-reader')).toBeNull();
    expect(t.calls.some((c) => c.includes('/household/reading/ai-reader'))).toBe(false);

    const old = vault(true);
    await unlocked(old, <AiReaderCard />);
    expect(screen.queryByTestId('ai-reader')).toBeNull();
    expect(old.calls.some((c) => c.includes('/household/reading/ai-reader'))).toBe(false);
  });
});
