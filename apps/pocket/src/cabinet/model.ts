import { serverOriginFrom } from '@fdv/client';
import {
  CABINET_NODE_ID,
  type Cabinet,
  type CabinetDrawer,
  type CabinetFolder,
  type CabinetLayout,
  type Capabilities,
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
}

export function cabinetGate(caps: Capabilities | null | undefined): CabinetGate {
  const f = caps?.features;
  const on = f?.cabinets === true;
  return { on, dividers: on && f?.cabinet_dividers === true, labels: on && f?.original_place === true };
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
