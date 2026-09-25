import type { OpenCopy } from '../state/essentials';

/**
 * Pages confirmed and fetched before Show mode opens (4.12), for a
 * document not kept on the phone: held in memory for one Show, never on
 * disk — so Show mode itself never asks anybody to confirm it is them (the
 * phone may be in someone else's hand by then).
 */
const held = new Map<string, OpenCopy>();

export function holdForShow(id: string, copy: OpenCopy): void {
  held.set(id, copy);
}

/** Taken once: a second Show fetches again. */
export function takeForShow(id: string): OpenCopy | null {
  const copy = held.get(id) ?? null;
  held.delete(id);
  return copy;
}
