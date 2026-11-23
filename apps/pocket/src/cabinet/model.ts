import { serverOriginFrom } from '@fdv/client';
import {
  ARRANGE_BY_LEVELS,
  CABINET_LEVELS,
  CABINET_NODE_ID,
  type Cabinet,
  type CabinetDrawer,
  type CabinetFolder,
  type CabinetLayout,
  type CabinetLevel,
  type Capabilities,
  type FolderDivider,
} from '@fdv/shared';

/**
 * My cabinet on the phone (C5; the vault's C1 to C3): the person's own
 * cabinets, drawers and folders, browsed one level at a time. Arranging is
 * done on the web; the phone reads the layout as it is, and shows what is
 * not hidden.
 */

/** What the vault offers of it, by its capability flags. Off: the phone looks as before. */
export interface CabinetGate {
  /** The cabinet itself (0.9.0-dev.42, C1). */
  on: boolean;
  /** A folder opened by the vault, with its dividers and pins (dev.44, C2). */
  dividers: boolean;
  /** Folder labels with a code, and where the original is (dev.50, C3). */
  labels: boolean;
  /**
   * Cabinet levels (dev.90): a layout's `levels` (null: arranged by hand),
   * a drawn cabinet's own arrangement, a folder's dividers of up to two
   * levels with each leaf's `path`; and browsing passes over a cabinet's
   * only drawer and a drawer's only folder, as the web does since dev.89.
   */
  levels: boolean;
  /** Who issued it as a level (dev.91): issuer folders, named by the household's list. */
  issuer: boolean;
}

export function cabinetGate(caps: Capabilities | null | undefined): CabinetGate {
  const f = caps?.features;
  const on = f?.cabinets === true;
  return {
    on,
    dividers: on && f?.cabinet_dividers === true,
    labels: on && f?.original_place === true,
    levels: on && f?.cabinet_levels === true,
    issuer: on && f?.cabinet_issuer === true,
  };
}

/**
 * What a layout is arranged by: its levels ("Topic › Year › Person"),
 * `hand` for one arranged by hand, `web` for levels this app doesn't know
 * (a newer vault's: said neutrally, never as by hand); null where nothing
 * is said.
 *
 * A vault with levels (dev.90) says `levels`, null for by hand. An older
 * one said which of its three ways (`arranged_by`, now deprecated), read
 * here as that way's levels — said in the same words — and nothing for
 * none.
 */
export type Arranged = CabinetLevel[] | 'hand' | 'web';

export function arrangedOf(layout: CabinetLayout | null, gate: Pick<CabinetGate, 'levels'>): Arranged | null {
  if (!layout) return null;
  if (gate.levels) {
    const levels: unknown = layout.levels;
    if (levels === null || levels === undefined) return 'hand';
    const known = (l: unknown): l is CabinetLevel =>
      typeof l === 'string' && (CABINET_LEVELS as readonly string[]).includes(l);
    return Array.isArray(levels) && levels.length > 0 && levels.every(known) ? [...levels] : 'web';
  }
  // An older vault's way, by its name: never trusted to be one of the three.
  const way: unknown = (layout as { arranged_by?: unknown }).arranged_by;
  if (typeof way !== 'string' || !Object.prototype.hasOwnProperty.call(ARRANGE_BY_LEVELS, way)) return null;
  const levels = (ARRANGE_BY_LEVELS as Readonly<Record<string, readonly CabinetLevel[] | undefined>>)[way];
  return levels ? [...levels] : null;
}

/**
 * How one cabinet is arranged, where it is not the default's (dev.90), as
 * the web marks it: its own levels below it, or arranged by hand beside the
 * drawn ones. Null: it follows the default, or the whole layout is by hand,
 * or the vault has no levels.
 */
export function cabinetMark(cabinet: Cabinet, arranged: Arranged | null, gate: Pick<CabinetGate, 'levels'>): 'own' | 'hand' | null {
  if (!gate.levels || arranged === null || arranged === 'hand') return null;
  if (!cabinet.drawn) return 'hand';
  return cabinet.drawn.levels ? 'own' : null;
}

/**
 * A cabinet's drawers as browsed (dev.89, with levels): one drawer is
 * passed over, its folders shown at once (`only`); else each drawer, one of
 * a single folder a row of its own that opens that folder (`folder`). The
 * stored cabinet keeps every level: only browsing passes them over, so a
 * paper that brings a second drawer or folder just adds it. An older vault,
 * every drawer as it is.
 */
export type DrawerRows =
  | { kind: 'only'; drawer: CabinetDrawer }
  | { kind: 'drawers'; rows: { drawer: CabinetDrawer; folder: CabinetFolder | null }[] };

export function drawerRows(cabinet: Cabinet, gate: Pick<CabinetGate, 'levels'>): DrawerRows {
  const drawers = cabinet.drawers;
  if (gate.levels && drawers.length === 1 && drawers[0]) return { kind: 'only', drawer: drawers[0] };
  return {
    kind: 'drawers',
    rows: drawers.map((drawer) => ({
      drawer,
      folder: gate.levels && drawer.folders.length === 1 ? (drawer.folders[0] ?? null) : null,
    })),
  };
}

/**
 * A folder's dividers grouped by their first step (dev.90), as the web
 * groups them: the leaves of two steps under their first's tab ("Bank
 * statement", then "2025", "2024"); one of one step, Everything else
 * (`rest`) and a folder's one list (`all`), each a group of its own. A
 * vault without levels sends no `path`: every divider its own group, as
 * before.
 */
export interface DividerGroup {
  key: string;
  name: string;
  /** Each leaf, and its name inside the group: its steps after the first. */
  leaves: { divider: FolderDivider; label: string }[];
  /** A tab of its own holding leaves, not one divider. */
  grouped: boolean;
  count: number;
}

export function dividerGroups(dividers: readonly FolderDivider[]): DividerGroup[] {
  const out: DividerGroup[] = [];
  for (const d of dividers) {
    const first = d.path && d.path.length > 1 ? d.path[0] : undefined;
    const last = out[out.length - 1];
    const label = first
      ? (d.path ?? [])
          .slice(1)
          .map((step) => step.name)
          .join(' · ') || d.name
      : d.name;
    if (first && last?.grouped && last.key === first.key) {
      last.leaves.push({ divider: d, label });
      last.count += d.count;
    } else {
      out.push({
        key: first?.key ?? d.key,
        name: first?.name ?? d.name,
        leaves: [{ divider: d, label }],
        grouped: first !== undefined,
        count: d.count,
      });
    }
  }
  return out;
}

/** The layout with what is hidden taken out, at every level: what is shown while browsing. */
export function shownLayout(layout: CabinetLayout | null): Cabinet[] {
  return (layout?.cabinets ?? [])
    .filter((c) => !c.hidden)
    .map((c) => ({
      ...c,
      drawers: c.drawers.filter((d) => !d.hidden).map((d) => ({ ...d, folders: d.folders.filter((f) => !f.hidden) })),
    }));
}

export type Found =
  | { kind: 'cabinet'; cabinet: Cabinet }
  | { kind: 'drawer'; cabinet: Cabinet; drawer: CabinetDrawer }
  | { kind: 'folder'; cabinet: Cabinet; drawer: CabinetDrawer; folder: CabinetFolder };

/** A cabinet, drawer or folder of the shown layout, by its id (unique in the layout); null when it is not shown. */
export function findNode(cabinets: readonly Cabinet[], id: string): Found | null {
  for (const cabinet of cabinets) {
    if (cabinet.id === id) return { kind: 'cabinet', cabinet };
    for (const drawer of cabinet.drawers) {
      if (drawer.id === id) return { kind: 'drawer', cabinet, drawer };
      for (const folder of drawer.folders) {
        if (folder.id === id) return { kind: 'folder', cabinet, drawer, folder };
      }
    }
  }
  return null;
}

/** What a scanned code is. */
export type LabelRead =
  /**
   * A folder label of this vault: open the folder (whether it is in this person's cabinet is the folder's to say).
   * `elsewhere`: printed from another address of this vault, known by the folder being the person's own.
   */
  | { kind: 'folder'; id: string; elsewhere?: true }
  /** A folder label of another vault: said, and nothing is asked of that vault. */
  | { kind: 'other_vault'; host: string }
  /** Anything else. */
  | { kind: 'not_label' };

const FOLDER_PATH = /^\/folder\/([^/?#]+)\/?(?:[?#].*)?$/;

/**
 * A scanned code read as a folder label (C3): a label holds only
 * `{vault}/folder/{id}` (`folderLabelUrl`). It opens the folder when the
 * address is this vault's; also when the label's folder is one of this
 * person's own — the same vault, printed from another address it is reached
 * by (a folder's id is random, and unique in its layout). Anything else is
 * another vault's, said so; the phone never asks that address anything.
 * Parsed by hand: React Native's URL is only partly there.
 */
export function readLabel(text: string, vaultOrigin: string | null, cabinets: readonly Cabinet[] | null): LabelRead {
  const typed = text.trim();
  const scheme = /^(https?):\/\//i.exec(typed);
  if (!scheme) return { kind: 'not_label' };
  const address = serverOriginFrom(typed);
  if (!address) return { kind: 'not_label' };
  const rest = typed.slice(scheme[0].length);
  const cut = rest.search(/[/?#]/);
  const m = FOLDER_PATH.exec(cut === -1 ? '' : rest.slice(cut));
  if (!m) return { kind: 'not_label' };
  let id: string;
  try {
    id = decodeURIComponent(m[1] as string);
  } catch {
    return { kind: 'not_label' };
  }
  if (!CABINET_NODE_ID.test(id)) return { kind: 'not_label' };
  const here = vaultOrigin ? serverOriginFrom(vaultOrigin)?.origin : undefined;
  if (address.origin === here) return { kind: 'folder', id };
  if (cabinets && findNode(cabinets, id)?.kind === 'folder') return { kind: 'folder', id, elsewhere: true };
  return { kind: 'other_vault', host: address.host };
}

/** Where to arrange it: the vault's own Documents page, showing the cabinet, with Arrange open. */
export function arrangeUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/documents?show=cabinet&arrange=1`;
}
