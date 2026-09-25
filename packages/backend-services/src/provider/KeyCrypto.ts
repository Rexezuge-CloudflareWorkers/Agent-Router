import { CryptoUtil } from '@agent-router/shared/utils';

function toBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.codePointAt(i) ?? 0;
  return bytes;
}

function fromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary);
}

type EncryptionPurpose = 'provider-keys' | 'codex-oauth';

async function importAesKey(masterKey: string, purpose: EncryptionPurpose): Promise<CryptoKey> {
  const hashHex = await CryptoUtil.sha256Hex(`agent-router-enc:${purpose}:${masterKey}`);
  const raw = new Uint8Array(hashHex.match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? []);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

class KeyCrypto {
  public static async encrypt(plaintext: string, masterKey: string, purpose: EncryptionPurpose): Promise<string> {
    const key = await importAesKey(masterKey, purpose);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));
    const combined = new Uint8Array(iv.length + ciphertext.length);
    combined.set(iv, 0);
    combined.set(ciphertext, iv.length);
    return fromBytes(combined);
  }

  public static async decrypt(payload: string, masterKey: string, purpose: EncryptionPurpose): Promise<string> {
    const combined = toBytes(payload);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const key = await importAesKey(masterKey, purpose);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  }

  public static hintFor(secret: string): string {
    const trimmed = secret.trim();
    return trimmed.length <= 8 ? `…${trimmed.slice(-4)}` : `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
  }
}

export { KeyCrypto };
export type { EncryptionPurpose };
