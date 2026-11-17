/**
 * The vault's client (0.9.0-dev.55 on: a connected app's signer, and the
 * fake vault's check of it) hands Web Crypto a plain `Uint8Array`. The DOM
 * library this app compiles with (TypeScript 6) wants one on an ArrayBuffer
 * of its own, so the vendored source would not compile here, though it runs
 * the same: the client copies the bytes onto a buffer of their own first.
 * The phone never signs as a connected app; this only lets the vendored
 * source compile, as the vault's own declarations (its globals.d.ts) do.
 */
interface SubtleCrypto {
  digest(algorithm: AlgorithmIdentifier, data: Uint8Array<ArrayBufferLike>): Promise<ArrayBuffer>;
  importKey(
    format: 'pkcs8' | 'raw',
    keyData: Uint8Array<ArrayBufferLike>,
    algorithm: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  sign(algorithm: AlgorithmIdentifier, key: CryptoKey, data: Uint8Array<ArrayBufferLike>): Promise<ArrayBuffer>;
  verify(
    algorithm: AlgorithmIdentifier,
    key: CryptoKey,
    signature: Uint8Array<ArrayBufferLike>,
    data: Uint8Array<ArrayBufferLike>,
  ): Promise<boolean>;
}
