import {
  formatDate,
  localToday,
  shareEndWords,
  whenExactly,
  whenWords,
  zoneOffsetWords,
  zoneShortName,
} from '@fdv/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readPrefs, writePrefs } from '../platform/prefs';
import { useVault } from './vault';

/**
 * Every time the phone shows, on the family's clock (P5; the web's since
 * 0.9.0, the owner's ask of 23 Oct 2026): the family's time zone (set in
 * the browser's Settings, else the server's FDV_TIMEZONE, else UTC), as
 * the vault's profile says it, whatever zone this phone is in. "Today" is
 * the family's day too: an expiry, a snooze for a week.
 *
 * Where the phone's clock reads otherwise at that moment, a time says
 * which clock it is on ("5:25pm PDT"), so somebody travelling is never
 * misled; in the same zone, nothing is added. A date without a time (an
 * expiry, a birthday) is the same day everywhere and never goes through a
 * zone.
 *
 * The zone is kept on the phone for each vault, so it is the family's
 * offline too. A vault before 0.9.0 says none: then the phone's own.
 */

/** The zone this phone keeps its clock in: "Europe/London". */
export function phoneZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const KEPT = 'family-zones';
let now: string | null = null;

/** The family's zone as last heard, for words said outside a screen (a kept Essential's status). */
export function familyZoneNow(): string {
  return now ?? phoneZone();
}

const ZoneContext = createContext<string | null>(null);

export function FamilyTimeProvider(props: { children: ReactNode }) {
  const { vault, who, offline, withTokenQuick } = useVault();
  const origin = vault?.origin ?? null;
  const [zone, setZone] = useState<string | null>(() =>
    origin ? (readPrefs<Record<string, string>>(KEPT, {})[origin] ?? null) : null,
  );
  // Another vault: its own kept zone, until it says.
  const [forOrigin, setForOrigin] = useState(origin);
  if (forOrigin !== origin) {
    setForOrigin(origin);
    setZone(origin ? (readPrefs<Record<string, string>>(KEPT, {})[origin] ?? null) : null);
  }
  const signedIn = !!who;
  useEffect(() => {
    if (!origin || !signedIn || offline) return;
    let stopped = false;
    withTokenQuick((a, token) => a.profile(token))
      .then((p) => {
        if (stopped || !p.timezone) return;
        setZone(p.timezone);
        try {
          writePrefs(KEPT, { ...readPrefs<Record<string, string>>(KEPT, {}), [origin]: p.timezone });
        } catch {
          // Asked again next time.
        }
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [origin, signedIn, offline, withTokenQuick]);
  useEffect(() => {
    now = zone;
  }, [zone]);
  return <ZoneContext.Provider value={zone}>{props.children}</ZoneContext.Provider>;
}

/** The family's zone: the vault's, as last heard here, else this phone's. */
export function useFamilyZone(): string {
  return useContext(ZoneContext) ?? phoneZone();
}

/** Whether a zone's clock reads as this phone's at a moment: no name is needed then. */
function sameClock(zone: string, at: Date): boolean {
  const here = phoneZone();
  if (zone === here) return true;
  try {
    return zoneOffsetWords(zone, at) === zoneOffsetWords(here, at);
  } catch {
    return true;
  }
}

/** " PDT" after a time on the family's clock, where this phone's reads otherwise; "" where they agree. */
export function zoneNote(zone: string, at: Date | string = new Date()): string {
  const when = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(when.getTime()) || sameClock(zone, when)) return '';
  try {
    return ` ${zoneShortName(zone, when)}`;
  } catch {
    return '';
  }
}

const hasTime = (words: string) => /\d:\d\d/.test(words);

/** "26 Sept 2026, 3:12pm" on the family's clock, and its zone where the phone's differs. */
export function exactWords(iso: string, zone: string): string {
  return `${whenExactly(iso, zone)}${zoneNote(zone, iso)}`;
}

/** "yesterday, 4:12pm" on the family's clock and calendar, and its zone where the phone's differs. */
export function relativeWords(iso: string, zone: string, at: Date = new Date()): string {
  const words = whenWords(iso, at, zone);
  return hasTime(words) ? `${words}${zoneNote(zone, iso)}` : words;
}

/** "3 Oct 2026": the day a moment fell on, on the family's calendar. A day names no zone. */
export function dayWords(at: string | number, zone: string): string {
  return formatDate({ date: localToday(zone, new Date(at)), precision: 'day' });
}

/** "Friday 3 October at 17:00" on the family's clock, and its zone where the phone's differs. */
export function endWords(at: Date, zone: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  try {
    return `${shareEndWords(at, zone, opts)}${zoneNote(zone, at)}`;
  } catch {
    return shareEndWords(at, 'UTC', opts);
  }
}
