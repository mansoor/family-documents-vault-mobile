import * as shared from '@fdv/shared';
import * as Brightness from 'expo-brightness';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import * as KeepAwake from 'expo-keep-awake';
import * as NavigationBar from 'expo-navigation-bar';
import * as Network from 'expo-network';
import * as ScreenCapture from 'expo-screen-capture';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { openPrivateCopies } from '../essentials/copies';
import { openEssentials } from '../essentials/open';
import i18n from '../i18n';
import { KeyRing } from '../lock/keys';
import snapshots from './node-snapshots.json';
import { sharedCases } from './shared-cases';

/**
 * The probes: what the phone actually does, measured on the phone, so the
 * iterations after the spike are built on facts. Each returns PASS or FAIL
 * with numbers and short notes — timings and booleans, never content — and
 * the table is exported into FINDINGS.
 */
export interface ProbeResult {
  id: string;
  pass: boolean | null; // null: needs the person holding the phone to judge
  notes: string[];
  numbers: Record<string, number>;
}

export interface Probe {
  id: string;
  title: string;
  run: (ctx: { vault: string }) => Promise<ProbeResult>;
}

const result = (id: string, pass: boolean | null, notes: string[] = [], numbers: Record<string, number> = {}): ProbeResult => ({
  id,
  pass,
  notes,
  numbers,
});

const timed = async <T,>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = Date.now();
  const v = await fn();
  return [v, Date.now() - t];
};

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

export const PROBES: Probe[] = [
  {
    id: 'P1',
    title: '@fdv/shared under Hermes',
    async run() {
      const here = sharedCases(shared);
      const expected = snapshots as Record<string, string>;
      const diffs = Object.keys(expected).filter((k) => here[k] !== expected[k]);
      return result(
        'P1',
        diffs.length === 0,
        diffs.map((k) => `${k}: phone "${here[k]}" vs node "${expected[k]}"`),
        { cases: Object.keys(expected).length, differences: diffs.length },
      );
    },
  },
  {
    id: 'P2',
    title: 'Web APIs the client needs',
    async run({ vault }) {
      const notes: string[] = [];
      const ok = (name: string, fn: () => boolean) => {
        try {
          if (!fn()) notes.push(`${name}: wrong answer`);
        } catch (err) {
          notes.push(`${name}: ${errorOf(err)}`);
        }
      };
      ok('URLSearchParams', () => {
        const p = new URLSearchParams();
        p.set('q', 'a b');
        p.append('tag', 'x');
        p.append('tag', 'y');
        return p.toString() === 'q=a+b&tag=x&tag=y';
      });
      ok('TextEncoder', () => new TextDecoder().decode(new TextEncoder().encode('Zoë ✓')) === 'Zoë ✓');
      ok('AbortController', () => {
        const c = new AbortController();
        c.abort();
        return c.signal.aborted;
      });
      ok('FormData', () => typeof FormData === 'function');
      ok('getRandomValues', () => Crypto.getRandomValues(new Uint8Array(16)).some((b) => b !== 0));
      try {
        const res = await expoFetch(`${vault}/api/v1/capabilities`, { method: 'GET' });
        if (!res.ok) notes.push(`expo/fetch GET: ${res.status}`);
        const body = await expoFetch(`${vault}/api/v1/capture`, {
          method: 'POST',
          body: new Uint8Array([1, 2, 3]),
          headers: { 'content-type': 'application/octet-stream' },
        });
        // Unauthenticated: 401 proves the body went out and came back as an answer.
        if (body.status !== 401) notes.push(`expo/fetch with bytes: ${body.status}, expected 401`);
      } catch (err) {
        notes.push(`expo/fetch: ${errorOf(err)}`);
      }
      return result('P2', notes.length === 0, notes);
    },
  },
  {
    id: 'P4',
    title: 'SecureStore behind a fingerprint',
    async run() {
      const key = 'probe.auth';
      const notes: string[] = [];
      const numbers: Record<string, number> = {};
      try {
        numbers.canUseBiometrics = SecureStore.canUseBiometricAuthentication() ? 1 : 0;
        const [, writeMs] = await timed(() =>
          SecureStore.setItemAsync(key, 'x'.repeat(64), {
            requireAuthentication: true,
            authenticationPrompt: 'Probe P4: write',
          }),
        );
        numbers.writeMs = writeMs;
        const [value, readMs] = await timed(() =>
          SecureStore.getItemAsync(key, { requireAuthentication: true, authenticationPrompt: 'Probe P4: read' }),
        );
        numbers.readMs = readMs;
        notes.push(value?.length === 64 ? 'read back 64 bytes' : `read back ${value?.length ?? 'nothing'}`);
        notes.push('Record by hand: did the write prompt? did the read? was the PIN offered? which biometric?');
        notes.push('Then enrol a new fingerprint and run P4 again: does the read throw?');
      } catch (err) {
        notes.push(`threw: ${errorOf(err)}`);
      }
      return result('P4', null, notes, numbers);
    },
  },
  {
    id: 'P5',
    title: 'SecureStore, this device only',
    async run() {
      const key = 'probe.device';
      const value = Array.from(Crypto.getRandomValues(new Uint8Array(48)), (b) => b.toString(16).padStart(2, '0')).join('');
      try {
        await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
        const back = await SecureStore.getItemAsync(key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
        await SecureStore.deleteItemAsync(key);
        return result('P5', back === value, [back === value ? 'round trip ok' : 'value changed']);
      } catch (err) {
        return result('P5', false, [errorOf(err)]);
      }
    },
  },
  {
    id: 'P6',
    title: 'SQLCipher',
    async run() {
      const notes: string[] = [];
      const numbers: Record<string, number> = {};
      const keyHex = Array.from(Crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
      const wrongHex = 'ab'.repeat(32);
      const name = 'probe.db';
      try {
        await SQLite.deleteDatabaseAsync(name).catch(() => undefined);
        const db = await SQLite.openDatabaseAsync(name);
        await db.execAsync(`PRAGMA key = "x'${keyHex}'"; create table blobs (id integer primary key, data blob);`);
        const big = Crypto.getRandomValues(new Uint8Array(1024 * 1024));
        const [, writeMs] = await timed(() => db.runAsync('insert into blobs (id, data) values (1, ?)', big));
        numbers.write1MbMs = writeMs;
        await db.runAsync('insert into blobs (id, data) values (2, ?)', big.subarray(0, 300 * 1024));
        await db.closeAsync();

        try {
          const wrong = await SQLite.openDatabaseAsync(name);
          await wrong.execAsync(`PRAGMA key = "x'${wrongHex}'"`);
          await wrong.getFirstAsync('select count(*) as n from blobs');
          notes.push('a wrong key READ the database');
          await wrong.closeAsync();
        } catch {
          notes.push('wrong key refused');
        }

        const right = await SQLite.openDatabaseAsync(name);
        await right.execAsync(`PRAGMA key = "x'${keyHex}'"`);
        const [row, readMs] = await timed(() => right.getFirstAsync<{ data: Uint8Array }>('select data from blobs where id = 2'));
        numbers.read300KbMs = readMs;
        const [, uriMs] = await timed(async () => {
          const bytes = row?.data ?? new Uint8Array();
          let s = '';
          for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return `data:image/jpeg;base64,${btoa(s)}`;
        });
        numbers.dataUriMs = uriMs;
        await right.closeAsync();
        await SQLite.deleteDatabaseAsync(name);
        const ok = notes.includes('wrong key refused') && (row?.data?.length ?? 0) === 300 * 1024;
        return result('P6', ok, notes, numbers);
      } catch (err) {
        return result('P6', false, [...notes, errorOf(err)], numbers);
      }
    },
  },
  {
    id: 'P7',
    title: 'Show mode: screenshots, brightness, awake, orientation, bars',
    async run() {
      const notes: string[] = [];
      try {
        await ScreenCapture.preventScreenCaptureAsync('probe');
        notes.push('screenshots blocked for 10 s: try one now');
        await new Promise((r) => setTimeout(r, 10_000));
        await ScreenCapture.allowScreenCaptureAsync('probe');
        const before = await Brightness.getBrightnessAsync();
        await Brightness.setBrightnessAsync(1);
        await new Promise((r) => setTimeout(r, 1_500));
        await Brightness.restoreSystemBrightnessAsync();
        notes.push(`brightness ${before.toFixed(2)} → 1 → system`);
        await KeepAwake.activateKeepAwakeAsync('probe');
        await KeepAwake.deactivateKeepAwake('probe');
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        await ScreenOrientation.unlockAsync();
        await NavigationBar.setVisibilityAsync('hidden');
        await new Promise((r) => setTimeout(r, 1_500));
        await NavigationBar.setVisibilityAsync('visible');
        notes.push('keep-awake, orientation and bar calls returned; judge by eye');
        return result('P7', null, notes);
      } catch (err) {
        return result('P7', false, [...notes, errorOf(err)]);
      }
    },
  },
  {
    id: 'P8',
    title: 'Does a fetched response land in the cache directory?',
    async run({ vault }) {
      try {
        const res = await fetch(`${vault}/favicon.svg`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const marker = Array.from(bytes.subarray(0, 64), (b) => String.fromCharCode(b)).join('');
        let found = 0;
        let scanned = 0;
        const walk = (dir: Directory) => {
          for (const entry of dir.list()) {
            if (entry instanceof Directory) walk(entry);
            else if (entry instanceof File && entry.size < 5_000_000) {
              scanned += 1;
              const text = Array.from(entry.bytesSync().subarray(0, 200_000), (b) => String.fromCharCode(b)).join('');
              if (marker.length > 16 && text.includes(marker)) found += 1;
            }
          }
        };
        walk(Paths.cache);
        return result('P8', found === 0, [found ? `${found} cached file(s) hold the response` : 'no copy found'], {
          status: res.status,
          filesScanned: scanned,
        });
      } catch (err) {
        return result('P8', false, [errorOf(err)]);
      }
    },
  },
  {
    id: 'P9',
    title: 'Network and airplane mode',
    async run() {
      try {
        const state = await Network.getNetworkStateAsync();
        const airplane = await Network.isAirplaneModeEnabledAsync();
        return result('P9', true, [
          `type ${state.type}`,
          `connected ${String(state.isConnected)}`,
          `internet ${String(state.isInternetReachable)}`,
          `airplane ${String(airplane)}`,
        ]);
      } catch (err) {
        return result('P9', false, [errorOf(err)]);
      }
    },
  },
  {
    id: 'P10',
    title: 'ML Kit, first use offline',
    async run() {
      return result('P10', null, [
        'By hand: clear Google Play services data for the scanner module if possible, turn the network off, and tap Scan on the spike screen. Record the error and how long it took.',
        'Then with the network on: how long did the first scan take to open (module download)?',
      ]);
    },
  },
  {
    id: 'P11',
    title: 'Preview build cold start in airplane mode',
    async run() {
      return result('P11', null, [
        'By hand: airplane mode on, force-stop the app, open it. The spike screen and the last run should appear.',
      ]);
    },
  },
  {
    id: 'P12',
    title: 'Predictive back',
    async run() {
      return result('P12', null, [
        'By hand: on the Probes screen, swipe back from the edge. Does it animate a preview, or go straight back?',
      ]);
    },
  },
  {
    id: 'L1',
    title: 'Offline Essentials store under SQLCipher (4.8)',
    async run() {
      const hex = await new KeyRing().openEveryday();
      const started = Date.now();
      const store = await openEssentials('everyday', hex);
      const opened = Date.now() - started;
      const page = Crypto.getRandomValues(new Uint8Array(200_000));
      await store.putDocument({ id: 'probe-l1', version_id: 'probe-l1-v1', view: '{}', pages: 1, kept_at: Date.now() });
      const wrote = Date.now();
      await store.putPage('probe-l1-v1', 1, page);
      const back = await store.page('probe-l1-v1', 1);
      const read = Date.now() - wrote;
      const same = back !== null && back.length === page.length && back.every((b, i) => b === page[i]);
      await store.removeDocument('probe-l1');
      await store.close();
      // A plain SQLite file starts "SQLite format 3"; an encrypted one does not.
      const file = new File(SQLite.defaultDatabaseDirectory as string, 'essentials.db');
      const head = Array.from((await file.bytes()).slice(0, 15), (b) => String.fromCharCode(b)).join('');
      const encrypted = head !== 'SQLite format 3';
      return result(
        'L1',
        same && encrypted,
        [same ? 'A 200 KB page came back as written.' : 'The page did not come back as written.', encrypted ? 'The file is not readable without its key.' : 'The file is plain SQLite!'],
        { open_ms: opened, write_read_ms: read },
      );
    },
  },
  {
    id: 'L2',
    title: 'Only me key and a fingerprint change (4.8)',
    async run() {
      const copies = await openPrivateCopies(new KeyRing(), i18n.t('lock.privatePrompt'));
      switch (copies.kind) {
        case 'ok':
          await copies.store.close();
          return result('L2', null, [
            'The Only me key opened (made on the first run).',
            "Now add a fingerprint (or change the face) in the phone's settings, and run this again: it should say the copies were removed.",
          ]);
        case 'changed':
          return result('L2', true, [i18n.t('lock.enrolmentChanged'), 'Only the Only me copies were removed.']);
        case 'unavailable':
          return result('L2', null, [i18n.t('lock.weakBiometrics')]);
        default:
          return result('L2', null, ['Not confirmed: run it again, and confirm with a fingerprint or face.']);
      }
    },
  },
];
