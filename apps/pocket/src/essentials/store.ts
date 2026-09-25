/**
 * The phone's offline copies of Essentials (4.8; filled from 4.10).
 *
 * Two stores, each its own SQLCipher database under its own key: the
 * everyday Essentials (household and adults-only) in essentials.db, and
 * the person's own Only me ones, if they choose to keep them, in
 * essentials-private.db. What they hold: the documents, their pages as the
 * vault drew them (JPEGs), when each was opened here, and where syncing
 * got to. There is no hand-written encryption anywhere: SQLCipher does it,
 * page by page, under the key.
 */

export interface OfflineDocument {
  id: string;
  version_id: string;
  /** The document as the vault last described it (DocumentView), as JSON. */
  view: string;
  pages: number;
  kept_at: number;
}

/**
 * One opening of a kept copy, as the vault is told it (POST /offline/opens):
 * its own id, so sending it twice records it once.
 */
export interface OfflineOpenRecord {
  id: string;
  document_id: string;
  version_id: string;
  at: number;
  mode: 'view' | 'show';
  online: boolean;
}

export interface EssentialsStore {
  documents(): Promise<OfflineDocument[]>;
  document(id: string): Promise<OfflineDocument | null>;
  putDocument(doc: OfflineDocument): Promise<void>;
  /** The document and its pages. */
  removeDocument(id: string): Promise<void>;
  page(versionId: string, n: number): Promise<Uint8Array | null>;
  putPage(versionId: string, n: number, jpeg: Uint8Array): Promise<void>;
  /** Opened here: told to the vault next time there is a connection. */
  recordOpen(open: OfflineOpenRecord): Promise<void>;
  opens(): Promise<OfflineOpenRecord[]>;
  /** Told, and the vault has them: forgotten here. */
  clearOpens(ids: string[]): Promise<void>;
  state(key: string): Promise<string | null>;
  setState(key: string, value: string): Promise<void>;
  close(): Promise<void>;
}

/** Everything in memory: the web build, and the tests' reference. */
export class MemoryEssentialsStore implements EssentialsStore {
  private docs = new Map<string, OfflineDocument>();
  private pageMap = new Map<string, Uint8Array>();
  private openLog: OfflineOpenRecord[] = [];
  private kv = new Map<string, string>();

  async documents() {
    return [...this.docs.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  async document(id: string) {
    return this.docs.get(id) ?? null;
  }
  async putDocument(doc: OfflineDocument) {
    const before = this.docs.get(doc.id);
    // A new version's pages replace the old version's.
    if (before && before.version_id !== doc.version_id) this.dropPages(before.version_id);
    this.docs.set(doc.id, { ...doc });
  }
  async removeDocument(id: string) {
    const doc = this.docs.get(id);
    if (doc) this.dropPages(doc.version_id);
    this.docs.delete(id);
  }
  async page(versionId: string, n: number) {
    const p = this.pageMap.get(`${versionId}|${n}`);
    return p ? new Uint8Array(p) : null;
  }
  async putPage(versionId: string, n: number, jpeg: Uint8Array) {
    this.pageMap.set(`${versionId}|${n}`, new Uint8Array(jpeg));
  }
  async recordOpen(open: OfflineOpenRecord) {
    if (!this.openLog.some((o) => o.id === open.id)) this.openLog.push({ ...open });
  }
  async opens() {
    return [...this.openLog].sort((a, b) => a.at - b.at);
  }
  async clearOpens(ids: string[]) {
    this.openLog = this.openLog.filter((o) => !ids.includes(o.id));
  }
  async state(key: string) {
    return this.kv.get(key) ?? null;
  }
  async setState(key: string, value: string) {
    this.kv.set(key, value);
  }
  async close() {}

  private dropPages(versionId: string) {
    for (const k of [...this.pageMap.keys()]) if (k.startsWith(`${versionId}|`)) this.pageMap.delete(k);
  }
}
