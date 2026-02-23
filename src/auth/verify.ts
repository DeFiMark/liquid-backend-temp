import { SiweMessage } from 'siwe';
import { baseClient } from '../lib/base-client.js';
import { consumeNonce } from './challenge.js';
import type { Hex } from 'viem';

export async function verifySiweMessage(
  message: string,
  signature: string
): Promise<{ address: `0x${string}`; chainId: number; eoa?: string }> {
  const siweMessage = new SiweMessage(message);

  // Validate domain
  const expectedDomain = process.env.APP_DOMAIN;
  if (expectedDomain && siweMessage.domain !== expectedDomain) {
    throw new Error('Domain mismatch');
  }

  // Validate chain ID
  if (siweMessage.chainId !== 8453) {
    throw new Error('Invalid chain ID — expected 8453 (Base)');
  }

  // Validate and consume nonce
  const nonceEntry = consumeNonce(siweMessage.nonce);
  if (!nonceEntry) {
    throw new Error('Invalid or expired nonce');
  }

  const address = siweMessage.address as `0x${string}`;

  // Verify signature — viem handles both EOA and EIP-1271 (smart wallets)
  const isValid = await baseClient.verifyMessage({
    address,
    message,
    signature: signature as Hex,
  });

  if (!isValid) {
    throw new Error('Invalid signature');
  }

  return {
    address,
    chainId: siweMessage.chainId,
  };
}
