import { guestEndWords, type Me } from '@fdv/shared';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Notice, Text } from '../ui';
import { useVault } from '../state/vault';

/**
 * What you may see (5.36): an owner may limit a viewer to some documents
 * (5.33), and a guest — somebody from outside the family, a viewer on the
 * wire — is always limited, until a day an owner sets (5.34). GET /me says
 * so in the person's own words ("You can see: …"), and a guest's end; a
 * vault before 0.5.33 says neither, and nothing is shown.
 */
export interface MyAccess {
  /** The vault's sentence: "You can see: Tax return documents for Ahmed and your own." */
  summary: string | null;
  /**
   * A guest's end, and the clock it is said on: the family's when the phone
   * can learn it (GET /profile), and otherwise this phone's, named.
   */
  ends: { at: string; zone: string; family: boolean } | null;
}

/** The zone this phone keeps its clock in. */
const phoneZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** A zone this phone can say times in. */
function known(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/**
 * What GET /me says of what this person may see; null when it says
 * nothing (somebody not limited, or an older vault). `familyZone` asks the
 * vault for the household's clock, only for a guest's end.
 */
export async function myAccess(
  me: Pick<Me, 'restriction' | 'kind' | 'access_expires_at'> | null,
  familyZone: () => Promise<string | null | undefined>,
): Promise<MyAccess | null> {
  if (!me) return null;
  const summary = me.restriction?.summary || null;
  const end = me.kind === 'guest' && me.access_expires_at ? me.access_expires_at : null;
  if (!summary && !end) return null;
  if (!end) return { summary, ends: null };
  const zone = known(await familyZone().catch(() => null));
  return { summary, ends: zone ? { at: end, zone, family: true } : { at: end, zone: phoneZone(), family: false } };
}

/** "Your access to this vault ends Friday 4 December 2026 at 23:59 (Europe/London, the family's clock)." */
export function endsWords(ends: NonNullable<MyAccess['ends']>, t: TFunction): string {
  const when = guestEndWords(ends.at, ends.zone);
  return t(ends.family ? 'access.endsFamily' : 'access.endsPhone', { when, zone: ends.zone });
}

function Lines(props: { access: MyAccess; testID: string }) {
  const { t } = useTranslation();
  const { summary, ends } = props.access;
  return (
    <>
      {summary ? <Text testID={`${props.testID}-summary`}>{summary}</Text> : null}
      {ends ? (
        <Text weight="600" testID={`${props.testID}-ends`}>
          {endsWords(ends, t)}
        </Text>
      ) : null}
    </>
  );
}

/** On Home, above the lists: what you can see, and a guest's end. */
export function AccessNotice(props: { access: MyAccess }) {
  const { t } = useTranslation();
  const { summary, ends } = props.access;
  const words = [summary, ends ? endsWords(ends, t) : null].filter(Boolean).join(' ');
  return (
    <Notice tone="info" testID="home-access" announce={words}>
      <Lines access={props.access} testID="home-access" />
    </Notice>
  );
}

/** In Settings: the same, as a card of its own, asked of the vault when Settings opens. */
export function AccessCard() {
  const { t } = useTranslation();
  const { withToken, offline } = useVault();
  const [access, setAccess] = useState<MyAccess | null>(null);
  const load = useCallback(async () => {
    try {
      setAccess(
        await withToken(async (a, token) =>
          myAccess(await a.me(token), async () => (await a.profile(token)).timezone),
        ),
      );
    } catch {
      // Offline or signed out: the banner or the sign-in screen says so.
    }
  }, [withToken]);
  useEffect(() => {
    // Asked when Settings opens, and when the connection returns; set when the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);
  if (!access) return null;
  return (
    <Card>
      <Text variant="title">{t('access.title')}</Text>
      <Lines access={access} testID="settings-access" />
    </Card>
  );
}
