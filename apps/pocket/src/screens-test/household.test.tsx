import type { DocumentTypeView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import DocumentsScreen from '../app/(tabs)/documents';
import EditScreen from '../app/edit/[id]';
import { chooseOwner, chooseType, HOUSEHOLD, newDraft, toMetadata, type Household } from '../capture/draft';
import { DocumentDetail } from '../documents/detail';
import { draftOf, editBody } from '../documents/edit';
import { audit } from '../test-support/a11y';
import { libraryDoc, openSearch, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * The household as whose a document is (a vault of 0.9.0-dev.32; the
 * owner's decision of 11 Nov 2026): a third answer beside each person and
 * Not sure yet, which a kind that usually belongs to the household starts
 * with; the household's documents found from the filters.
 */

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

function vault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0',
    features: {
      ...caps0519().features,
      document_table: true,
      document_filters: true,
      household_owner: true,
    },
  });
  return t;
}

const kind = (key: string, belongs: 'person' | 'household'): DocumentTypeView =>
  ({
    key,
    label: key === 'utility_bill' ? 'Utility / bill' : 'Passport',
    category: 'household',
    fields: [],
    expiry_driver: null,
    reminder_leads: [],
    usually_essential: false,
    default_visibility: 'household',
    belongs_to: belongs,
  }) as DocumentTypeView;

const h: Household = {
  types: [kind('utility_bill', 'household'), kind('passport', 'person')],
  members: [{ id: 'me', display_name: 'Mansoor' }],
  me: { member_id: 'me', role: 'owner' },
  issuedBy: true,
  details: true,
  householdOwner: true,
};

describe('the card: The household, as whose a document is', () => {
  it('a bill starts as the household’s; a passport as Not sure yet; a person chosen is the household’s no longer', () => {
    const bill = chooseType(newDraft('camera' as never, h.me), 'utility_bill', h);
    expect(bill.household).toBe(true);
    expect(toMetadata(bill, h).metadata).toMatchObject({ household_owned: true });
    expect(toMetadata(bill, h).metadata.owner_member_id).toBeUndefined();
    const passport = chooseType(newDraft('camera' as never, h.me), 'passport', h);
    expect(passport.household).toBe(false);
    const mine = chooseOwner(bill, 'me', h);
    expect(mine).toMatchObject({ ownerId: 'me', household: false });
    expect(chooseOwner(mine, HOUSEHOLD, h)).toMatchObject({ ownerId: null, household: true });
    // An older vault is never sent it.
    expect(toMetadata(bill, { ...h, householdOwner: false }).metadata.household_owned).toBeUndefined();
  });

  it('edited: said either way where the vault keeps it', () => {
    const doc = { type_key: 'utility_bill', owner_member_id: null, household_owned: true, visibility: 'household', is_essential: false, extra: {} } as never;
    const d = draftOf(doc);
    expect(d.household).toBe(true);
    expect(editBody(d, h, { confirm: false }).body).toMatchObject({ owner_member_id: null, household_owned: true });
    expect(editBody(chooseOwner(d, null, h), h, { confirm: false }).body).toMatchObject({ household_owned: false });
  });
});

describe('a household’s document, on its page and in Edit details', () => {
  it('says The household where a person’s name would be; Edit keeps it chosen', async () => {
    const t = vault();
    libraryDoc(t, { id: 'bill', title: 'Water bill', type_key: 'utility_bill', owner_member_id: null, household_owned: true } as never);
    await unlocked(t, <DocumentDetail id="bill" />);
    expect(await screen.findByTestId('document-subline')).toHaveTextContent(/^The household · /);

    push({ pathname: '/edit/[id]', params: { id: 'bill' } });
    await unlocked(t, <EditScreen />);
    const chip = await screen.findByTestId(`edit-owner-${HOUSEHOLD}`);
    expect(chip.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(audit()).toEqual([]);
  });
});

describe('Documents: the household’s, from the filters', () => {
  it('offered beside the family, and asked for as member_id=household', async () => {
    const t = vault();
    t.vault.state.documents.push({ id: 'p1', title: 'Passport', type_key: 'passport', owner_member_id: 'fake-member', tags: [], extra: {} } as never);
    await unlocked(t, <DocumentsScreen />);
    await openSearch();
    await fireEvent.press(screen.getByTestId('documents-filters'));
    await fireEvent.press(await screen.findByTestId('filter-person-household'));
    await fireEvent.press(screen.getByTestId('filters-apply'));
    await waitFor(() =>
      expect(
        t.calls
          .filter((c) => c.startsWith(`GET ${ORIGIN}/api/v1/documents?`))
          .map((c) => new URL(c.slice(4)).searchParams.get('member_id'))
          .includes('household'),
      ).toBe(true),
    );
    expect(await screen.findByTestId('documents-chip-people')).toHaveTextContent('The household');
  });
});
