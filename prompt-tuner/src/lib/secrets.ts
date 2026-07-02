/**
 * Encrypted-at-rest persistence for store blobs that contain API keys.
 *
 * In the packaged desktop app the Electron `secrets` bridge (see preload.js)
 * seals the serialized blob with the OS credential store (DPAPI on Windows), so
 * keys aren't sitting in localStorage in plaintext. Outside Electron (plain
 * `next dev` in a browser) the bridge is absent and we transparently fall back
 * to plaintext — behavior identical to before.
 *
 * Migration is automatic: a legacy plaintext blob (no prefix) is read as-is and
 * re-sealed encrypted on the next save.
 */

const PREFIX = "enc:v1:";

interface SecretsBridge {
  available(): Promise<boolean>;
  encrypt(plaintext: string): Promise<string | null>;
  decrypt(b64: string): Promise<string | null>;
}

function bridge(): SecretsBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { secrets?: SecretsBridge }).secrets ?? null;
}

/**
 * Serialize `value` to JSON and write it to localStorage under `key`,
 * OS-encrypting it first when the bridge is available. Best-effort: any failure
 * falls back to storing plaintext so settings are never lost.
 */
export async function sealToStorage(key: string, value: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  const json = JSON.stringify(value);
  const b = bridge();
  if (b) {
    try {
      const enc = await b.encrypt(json);
      if (enc) {
        localStorage.setItem(key, PREFIX + enc);
        return;
      }
    } catch {
      // fall through to plaintext
    }
  }
  localStorage.setItem(key, json);
}

/**
 * Read and parse the blob stored under `key`, decrypting first if it was
 * sealed. Returns null when absent or unreadable.
 */
export async function openFromStorage<T = unknown>(key: string): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;

  if (raw.startsWith(PREFIX)) {
    const b = bridge();
    if (!b) return null; // sealed but no bridge to open it — shouldn't happen in-app
    try {
      const dec = await b.decrypt(raw.slice(PREFIX.length));
      if (dec == null) return null;
      return JSON.parse(dec) as T;
    } catch {
      return null;
    }
  }

  // Legacy plaintext (or browser dev) — parse directly; re-sealed on next save.
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
