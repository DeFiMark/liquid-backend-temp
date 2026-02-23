import { describe, it, expect, beforeEach } from 'vitest';
import { encrypt, decrypt } from '../lib/encryption.js';

describe('Encryption Service', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-key-for-encryption';
    delete process.env.ENCRYPTION_KEY;
  });

  it('encrypts and decrypts a short string', () => {
    const plaintext = 'hello';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('encrypts and decrypts a long string', () => {
    const plaintext = 'a'.repeat(10000);
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('encrypts and decrypts special characters', () => {
    const plaintext = '🔥 héllo wörld! @#$%^&*()';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('encrypts and decrypts JSON', () => {
    const obj = { name: 'John', ssn: '123-45-6789', nested: { key: true } };
    const plaintext = JSON.stringify(obj);
    const result = decrypt(encrypt(plaintext));
    expect(JSON.parse(result)).toEqual(obj);
  });

  it('produces different ciphertexts for same input (random IV)', () => {
    const plaintext = 'same input';
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');
    parts[2] = 'ff' + parts[2].slice(2);
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('throws on tampered auth tag', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');
    parts[1] = 'ff' + parts[1].slice(2);
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('throws on invalid format', () => {
    expect(() => decrypt('invalid')).toThrow('Invalid encrypted format');
    expect(() => decrypt('a:b')).toThrow('Invalid encrypted format');
  });

  it('works with explicit ENCRYPTION_KEY', () => {
    const crypto = require('crypto');
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    const plaintext = 'with explicit key';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('throws when no key available', () => {
    delete process.env.JWT_SECRET;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY or JWT_SECRET required');
  });
});
