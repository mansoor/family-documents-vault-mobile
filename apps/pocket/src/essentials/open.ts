import { MemoryEssentialsStore, type EssentialsStore } from './store';

export type Tier = 'everyday' | 'private';

/** The web build keeps nothing offline; a store in memory stands in. */
export async function openEssentials(_tier: Tier, _hex: string): Promise<EssentialsStore> {
  return new MemoryEssentialsStore();
}

export async function deleteEssentials(_tier: Tier): Promise<void> {}
