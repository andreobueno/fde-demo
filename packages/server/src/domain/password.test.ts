import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from './password.js';

const parameters = { cost: 1024, blockSize: 8, parallelization: 1 };

describe('password hashing', () => {
  it('verifies the correct password and rejects others', () => {
    const encoded = hashPassword('correct-horse-battery', parameters);
    expect(verifyPassword('correct-horse-battery', encoded)).toBe(true);
    expect(verifyPassword('correct-horse-batterz', encoded)).toBe(false);
  });

  it('never stores the password and salts every hash', () => {
    const first = hashPassword('correct-horse-battery', parameters);
    const second = hashPassword('correct-horse-battery', parameters);
    expect(first).not.toContain('correct-horse-battery');
    expect(first).not.toEqual(second);
    expect(first.startsWith('scrypt$1024$8$1$')).toBe(true);
  });

  it('rejects passwords shorter than the minimum length', () => {
    expect(() => hashPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1), parameters)).toThrow();
  });

  it('rejects malformed or truncated stored hashes', () => {
    const encoded = hashPassword('correct-horse-battery', parameters);
    expect(verifyPassword('correct-horse-battery', 'plaintext')).toBe(false);
    expect(verifyPassword('correct-horse-battery', encoded.slice(0, -4))).toBe(false);
    expect(verifyPassword('correct-horse-battery', encoded.replace('scrypt', 'md5'))).toBe(false);
  });
});
