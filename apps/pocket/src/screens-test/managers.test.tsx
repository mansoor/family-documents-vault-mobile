import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Text } from 'react-native';
import CollectionsScreen from '../app/collections';
import { managersShown } from '../collections/rules';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { back, push, resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

type Switches = { may_change_audience?: boolean; may_delete?: boolean; may_choose_managers?: boolean };
type Kept = {
  name: string;
  audience: string;
  owner_member_id: string;
  managers?: { member_id: string; may_change_audience: boolean; may_delete: boolean; may_choose_managers: boolean }[];
};

/**
 * A vault of 0.9.0-dev.40 — collections, checklists and, unless `managers`
 * is false, collection managers — and the family: Sam and Pat (adults), Kim
 * (a teen), Val (a viewer). The person signed in is `role`.
 */
function vault(over: { managers?: boolean; role?: 'owner' | 'adult' | 'teen' } = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    features: {
      ...caps0519().features,
      notes: true,
      collections: true,
      collection_checklist: true,
      ...(over.managers === false ? {} : { collection_managers: true }),
    },
  });
  t.vault.state.members.push(
    { id: 'sam', display_name: 'Sam', role: 'adult', is_me: false },
    { id: 'kim', display_name: 'Kim', role: 'teen', is_me: false },
    { id: 'pat', display_name: 'Pat', role: 'adult', is_me: false },
    { id: 'val', display_name: 'Val', role: 'viewer', is_me: false },
  );
  if (over.role) t.vault.state.role = over.role;
  return t;
}

const manager = (member_id: string, s: Switches = {}) => ({
  member_id,
  may_change_audience: s.may_change_audience === true,
  may_delete: s.may_delete === true,
  may_choose_managers: s.may_choose_managers === true,
  added_at: '2026-11-13T00:00:00Z',
});

/** "Trip", for everyone in the family, made by `owner`, with `managers`. */
function trip(t: TestVault, owner: string, managers: ReturnType<typeof manager>[] = []): Kept {
  t.vault.state.collections.push({
    id: 'trip',
    name: 'Trip',
    description: null,
    audience: 'everyone',
    owner_member_id: owner,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    revision: 1,
    deleted: false,
    items: [],
    managers,
  } as never);
  return t.vault.state.collections.at(-1) as unknown as Kept;
}

async function openTrip(t: TestVault) {
  push({ pathname: '/collection/[id]', params: { id: 'trip' } });
  await unlocked(t, <Text>Collections</Text>);
  await screen.findByTestId('collection-line');
}

/** Its Managers, from the row on its page. */
async function openManagers() {
  await fireEvent.press(screen.getByTestId('collection-managers'));
  await waitFor(() =>
    expect(routes().at(-1)).toEqual({ pathname: '/managers/[id]', params: { id: 'trip', name: 'Trip' } }),
  );
  await screen.findByTestId('managers-always');
}

/** Delete, in the page's ⋯ — if it has one. */
async function deleteOffered(): Promise<boolean> {
  const more = screen.queryByTestId('collection-more');
  if (!more) return false;
  await fireEvent.press(more);
  const offered = (await screen.findByTestId('collection-more-sheet')) && screen.queryByTestId('collection-delete') !== null;
  await fireEvent.press(screen.getByTestId('collection-more-cancel'));
  return offered;
}

const disabled = (id: string) => screen.getByTestId(id).props.disabled === true;

describe('a collection page, by what the vault says the person may do (app 0.10.0)', () => {
  it('its maker: every action, and Managers, nobody yet', async () => {
    const t = vault();
    trip(t, 'fake-member');
    await openTrip(t);
    expect(screen.getByTestId('collection-edit')).toBeTruthy();
    expect(screen.getByTestId('collection-add')).toBeTruthy();
    expect(screen.getByTestId('collection-checklist-fill')).toBeTruthy();
    expect(screen.queryByTestId('collection-manager-note')).toBeNull();
    expect(screen.getByTestId('collection-managers-line')).toHaveTextContent('Nobody else manages it yet.');
    expect(await deleteOffered()).toBe(true);
    expect(audit()).toEqual([]);
  });

  it('a manager: documents, checklist, name and words — who it’s for as plain words, and no Delete', async () => {
    const t = vault({ role: 'adult' });
    const kept = trip(t, 'sam', [manager('fake-member')]);
    await openTrip(t);
    expect(screen.getByTestId('collection-manager-note')).toHaveTextContent(/chose you to manage it/);
    expect(screen.getByTestId('collection-add')).toBeTruthy();
    expect(screen.getByTestId('collection-checklist-fill')).toBeTruthy();
    expect(screen.getByTestId('collection-managers-line')).toHaveTextContent('Fake Owner');
    expect(await deleteOffered()).toBe(false);

    await fireEvent.press(screen.getByTestId('collection-edit'));
    expect(await screen.findByTestId('collection-form-audience-fixed')).toHaveTextContent('Everyone in the family');
    expect(screen.queryByTestId('collection-form-adults')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('collection-form-name'), 'Our trip');
    await fireEvent.press(screen.getByTestId('collection-form-save'));
    expect(await screen.findByTestId('collection-said')).toHaveTextContent('Saved.');
    expect(kept.name).toBe('Our trip');
    expect(kept.audience).toBe('everyone');
  });

  it('a manager let change who it’s for and delete it: offered both, never Only me', async () => {
    const t = vault({ role: 'adult' });
    const kept = trip(t, 'sam', [manager('fake-member', { may_change_audience: true, may_delete: true })]);
    await openTrip(t);
    expect(await deleteOffered()).toBe(true);
    await fireEvent.press(screen.getByTestId('collection-edit'));
    await fireEvent.press(await screen.findByTestId('collection-form-adults'));
    expect(screen.queryByTestId('collection-form-only_me')).toBeNull();
    await fireEvent.press(screen.getByTestId('collection-form-save'));
    await screen.findByTestId('collection-said');
    expect(kept.audience).toBe('adults');
  });

  it('somebody of the family who neither made nor manages it: nothing to change, who manages it read', async () => {
    const t = vault({ role: 'adult' });
    trip(t, 'sam', [manager('kim')]);
    await openTrip(t);
    expect(screen.queryByTestId('collection-edit')).toBeNull();
    expect(screen.queryByTestId('collection-add')).toBeNull();
    expect(screen.queryByTestId('collection-checklist-fill')).toBeNull();
    expect(await deleteOffered()).toBe(false);
    expect(screen.getByTestId('collection-managers-line')).toHaveTextContent('Kim');
  });

  it('the list of collections says which the person manages', async () => {
    const t = vault({ role: 'adult' });
    trip(t, 'sam', [manager('fake-member')]);
    await unlocked(t, <CollectionsScreen />);
    expect(await screen.findByTestId('collection-trip')).toHaveTextContent(/You manage it/);
  });
});

describe('an older vault, without managers', () => {
  /** As a vault before 0.9.0-dev.40 answers: no `my_powers`, no `managers`. */
  function older(t: TestVault) {
    const inner = t.fetch;
    t.fetch = async (url, init) => {
      const res = await inner(url, init);
      if (!/\/api\/v1\/collections(\/[^/?]+)?(\?.*)?$/.test(url) || !res.ok) return res;
      const body = (await res.json()) as Record<string, unknown> & { items?: Record<string, unknown>[] };
      const strip = (c: Record<string, unknown>) => {
        delete c.my_powers;
        delete c.managers;
      };
      strip(body);
      if (url.includes('/collections?') || url.endsWith('/collections')) body.items?.forEach(strip);
      return { ...res, json: async () => body, text: async () => JSON.stringify(body) } as typeof res;
    };
  }

  it('its maker keeps every action, and no Managers', async () => {
    const t = vault({ managers: false });
    older(t);
    trip(t, 'fake-member');
    await openTrip(t);
    expect(screen.getByTestId('collection-edit')).toBeTruthy();
    expect(screen.getByTestId('collection-add')).toBeTruthy();
    expect(await deleteOffered()).toBe(true);
    expect(screen.queryByTestId('collection-managers')).toBeNull();
    await fireEvent.press(screen.getByTestId('collection-edit'));
    expect(await screen.findByTestId('collection-form-only_me')).toBeTruthy();
    expect(t.calls.some((c) => c.includes('/managers'))).toBe(false);
  });

  it('anybody else changes nothing, as before', async () => {
    const t = vault({ managers: false, role: 'adult' });
    older(t);
    trip(t, 'sam', [manager('fake-member', { may_delete: true })]);
    await openTrip(t);
    expect(screen.queryByTestId('collection-edit')).toBeNull();
    expect(screen.queryByTestId('collection-add')).toBeNull();
    expect(await deleteOffered()).toBe(false);
    expect(screen.queryByTestId('collection-managers')).toBeNull();
  });
});

describe('Managers (app 0.10.0)', () => {
  it('its maker makes somebody a manager, turns a switch on, and takes them away, asked first', async () => {
    const t = vault();
    const kept = trip(t, 'fake-member');
    await openTrip(t);
    await openManagers();
    expect(screen.getByTestId('managers-none')).toHaveTextContent('Nobody else manages it yet.');

    // Anybody of the family with a sign-in who sees it; never a viewer.
    await fireEvent.press(screen.getByTestId('managers-choose'));
    const picker = await screen.findByTestId('managers-picker');
    expect(within(picker).queryByText('Val')).toBeNull();
    expect(within(picker).getByText('Kim')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('managers-person-sam'));
    expect(await screen.findByTestId('managers-new')).toHaveTextContent(/Sam will manage it/);
    // Its maker may give all three, each off until turned on.
    for (const s of ['may_change_audience', 'may_delete', 'may_choose_managers']) {
      expect(screen.getByTestId(`managers-new-${s}`).props.value).toBe(false);
    }
    await fireEvent(screen.getByTestId('managers-new-may_delete'), 'valueChange', true);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('managers-add'));
    expect(await screen.findByTestId('managers-said')).toHaveTextContent('Sam now manages “Trip”.');
    expect(kept.managers).toEqual([
      expect.objectContaining({ member_id: 'sam', may_delete: true, may_change_audience: false, may_choose_managers: false }),
    ]);
    expect(screen.queryByTestId('managers-new')).toBeNull();

    // A switch turned on.
    await fireEvent(screen.getByTestId('managers-sam-may_choose_managers'), 'valueChange', true);
    expect(await screen.findByTestId('managers-said')).toHaveTextContent(
      'Sam: can also delete it and choose managers.',
    );
    expect(kept.managers?.[0]?.may_choose_managers).toBe(true);

    // Taken away, asked first: Cancel keeps them.
    await fireEvent.press(screen.getByTestId('managers-remove-sam'));
    const question = await screen.findByTestId('managers-remove-question');
    expect(within(question).getByText('Remove Sam as a manager?')).toBeTruthy();
    expect(within(question).getByText(/Sam will still see “Trip”/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('managers-remove-cancel'));
    expect(kept.managers).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('managers-remove-sam'));
    await fireEvent.press(await screen.findByTestId('managers-remove-yes'));
    expect(await screen.findByTestId('managers-said')).toHaveTextContent('Sam no longer manages “Trip”.');
    expect(kept.managers).toEqual([]);
    expect(screen.getByTestId('managers-none')).toBeTruthy();

    // Back on its page, it is looked at again.
    await back();
    await screen.findByTestId('collection-managers-line');
  });

  it('a manager who may not choose managers reads who does what: no switches, no Add, no Remove', async () => {
    const t = vault({ role: 'adult' });
    trip(t, 'sam', [manager('fake-member'), manager('kim', { may_delete: true })]);
    await openTrip(t);
    await openManagers();
    expect(screen.getByTestId('managers-fake-member-words')).toHaveTextContent(
      'Can add and remove documents, and rename it',
    );
    expect(screen.getByTestId('managers-kim-words')).toHaveTextContent('Can also delete it');
    expect(screen.queryByTestId('managers-kim-may_delete')).toBeNull();
    expect(screen.queryByTestId('managers-choose')).toBeNull();
    expect(screen.queryByTestId('managers-remove-kim')).toBeNull();
  });

  it('a manager who may choose managers gives only what they may do themselves', async () => {
    const t = vault({ role: 'adult' });
    const kept = trip(t, 'sam', [manager('fake-member', { may_choose_managers: true, may_delete: true }), manager('kim')]);
    await openTrip(t);
    await openManagers();
    // Kim's switches: who it's for is not theirs to give; the other two are.
    expect(disabled('managers-kim-may_change_audience')).toBe(true);
    expect(disabled('managers-kim-may_delete')).toBe(false);
    expect(disabled('managers-kim-may_choose_managers')).toBe(false);
    expect(screen.getByTestId('managers-remove-kim')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('managers-choose'));
    await fireEvent.press(await screen.findByTestId('managers-person-pat'));
    await screen.findByTestId('managers-new');
    expect(screen.queryByTestId('managers-new-may_change_audience')).toBeNull();
    await fireEvent(screen.getByTestId('managers-new-may_delete'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('managers-add'));
    expect(await screen.findByTestId('managers-said')).toHaveTextContent('Pat now manages “Trip”.');
    expect(kept.managers?.find((m) => m.member_id === 'pat')).toEqual(
      expect.objectContaining({ may_delete: true, may_change_audience: false }),
    );
  });

  it('an owner, while its maker can no longer change it: Remove, and nothing more', async () => {
    const t = vault();
    const sam = t.vault.state.members.find((m) => m.id === 'sam');
    if (sam) sam.role = null;
    const kept = trip(t, 'sam', [manager('pat')]);
    await openTrip(t);
    // Nobody may change it; an owner may delete it.
    expect(screen.queryByTestId('collection-edit')).toBeNull();
    expect(screen.queryByTestId('collection-add')).toBeNull();
    expect(await deleteOffered()).toBe(true);
    await openManagers();
    expect(screen.getByTestId('managers-pat-words')).toBeTruthy();
    expect(screen.queryByTestId('managers-pat-may_delete')).toBeNull();
    expect(screen.queryByTestId('managers-choose')).toBeNull();
    await fireEvent.press(screen.getByTestId('managers-remove-pat'));
    await fireEvent.press(await screen.findByTestId('managers-remove-yes'));
    expect(await screen.findByTestId('managers-said')).toHaveTextContent('Pat no longer manages “Trip”.');
    expect(kept.managers).toEqual([]);
  });

  it('not shown to whoever the vault tells nothing of them (a viewer, a guest), nor by an older vault', () => {
    const caps = capabilities({ features: { ...caps0519().features, collections: true, collection_managers: true } });
    const seen = { mine: false, audience: 'everyone' as const, managers: [{ ...manager('pat'), display_name: 'Pat' }] };
    expect(managersShown(caps, 'adult', seen)).toBe(true);
    expect(managersShown(caps, 'viewer', { ...seen, managers: null })).toBe(false);
    expect(managersShown(capabilities({ features: { ...caps0519().features, collections: true } }), 'adult', seen)).toBe(
      false,
    );
    // Nobody manages it, and the person may do nothing about it: nothing to show.
    expect(managersShown(caps, 'adult', { ...seen, managers: [] })).toBe(false);
  });
});

describe("the vault's own words when it refuses", () => {
  it('422: a manager may not leave its maker outside it', async () => {
    const t = vault({ role: 'adult' });
    trip(t, 'sam', [manager('fake-member', { may_change_audience: true })]);
    await openTrip(t);
    const sam = t.vault.state.members.find((m) => m.id === 'sam');
    if (sam) sam.role = 'teen';
    await fireEvent.press(screen.getByTestId('collection-edit'));
    await fireEvent.press(await screen.findByTestId('collection-form-adults'));
    await fireEvent.press(screen.getByTestId('collection-form-save'));
    expect(await screen.findByTestId('collection-form-problem')).toHaveTextContent(
      'That would leave Sam unable to see their own collection.',
    );
  });

  it('409: somebody made a manager meanwhile', async () => {
    const t = vault();
    const kept = trip(t, 'fake-member');
    await openTrip(t);
    await openManagers();
    await fireEvent.press(screen.getByTestId('managers-choose'));
    await fireEvent.press(await screen.findByTestId('managers-person-pat'));
    kept.managers = [manager('pat')];
    await fireEvent.press(await screen.findByTestId('managers-add'));
    expect(await screen.findByTestId('managers-problem')).toHaveTextContent('Pat already manages this collection.');
  });

  it('403: a switch the person no longer has', async () => {
    const t = vault({ role: 'adult' });
    const kept = trip(t, 'sam', [manager('fake-member', { may_choose_managers: true, may_delete: true }), manager('kim')]);
    await openTrip(t);
    await openManagers();
    // Sam took Delete away meanwhile.
    kept.managers = [manager('fake-member', { may_choose_managers: true }), manager('kim')];
    await fireEvent(screen.getByTestId('managers-kim-may_delete'), 'valueChange', true);
    expect(await screen.findByTestId('managers-problem')).toHaveTextContent(
      'You can only let a manager do what you can do yourself.',
    );
  });
});
