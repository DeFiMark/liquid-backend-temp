import { v4 as uuidv4 } from 'uuid';

interface NonceEntry {
  address: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const nonceStore = new Map<string, NonceEntry>();

// Periodic cleanup of expired nonces
setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of nonceStore) {
    if (now > new Date(entry.expirationTime).getTime()) {
      nonceStore.delete(nonce);
    }
  }
}, 60_000);

export function generateChallenge(address: string): {
  nonce: string;
  issuedAt: string;
  expirationTime: string;
} {
  const nonce = uuidv4();
  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(Date.now() + NONCE_TTL_MS).toISOString();

  nonceStore.set(nonce, { address, nonce, issuedAt, expirationTime });

  return { nonce, issuedAt, expirationTime };
}

export function consumeNonce(nonce: string): NonceEntry | null {
  const entry = nonceStore.get(nonce);
  nonceStore.delete(nonce); // single-use: always delete

  if (!entry) return null;
  if (Date.now() > new Date(entry.expirationTime).getTime()) return null;

  return entry;
}

// Exported for testing
export function _getNonceStore(): Map<string, NonceEntry> {
  return nonceStore;
}
