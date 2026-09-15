import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface ScryptParameters {
  cost: number;
  blockSize: number;
  parallelization: number;
}

export const DEFAULT_SCRYPT_PARAMETERS: ScryptParameters = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
};

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_ENCODED_HASH_LENGTH = 256;
const MAX_SCRYPT_COST = DEFAULT_SCRYPT_PARAMETERS.cost;
const MAX_SCRYPT_BLOCK_SIZE = DEFAULT_SCRYPT_PARAMETERS.blockSize;
const MAX_SCRYPT_PARALLELIZATION = DEFAULT_SCRYPT_PARAMETERS.parallelization;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

function parametersAreSupported(parameters: ScryptParameters): boolean {
  return Number.isInteger(parameters.cost)
    && parameters.cost > 1
    && (parameters.cost & (parameters.cost - 1)) === 0
    && parameters.cost <= MAX_SCRYPT_COST
    && Number.isInteger(parameters.blockSize)
    && parameters.blockSize > 0
    && parameters.blockSize <= MAX_SCRYPT_BLOCK_SIZE
    && Number.isInteger(parameters.parallelization)
    && parameters.parallelization > 0
    && parameters.parallelization <= MAX_SCRYPT_PARALLELIZATION;
}

function derive(password: string, salt: Buffer, parameters: ScryptParameters): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: parameters.cost,
    r: parameters.blockSize,
    p: parameters.parallelization,
    maxmem: 256 * parameters.cost * parameters.blockSize,
  });
}

export function hashPassword(
  password: string,
  parameters: ScryptParameters = DEFAULT_SCRYPT_PARAMETERS,
): string {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Passwords must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (!parametersAreSupported(parameters)) {
    throw new Error('Unsupported scrypt parameters.');
  }
  const salt = randomBytes(SALT_LENGTH);
  const key = derive(password, salt, parameters);
  const { cost, blockSize, parallelization } = parameters;
  return [
    'scrypt',
    cost,
    blockSize,
    parallelization,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export function verifyPassword(password: string, encoded: string): boolean {
  if (encoded.length > MAX_ENCODED_HASH_LENGTH) return false;
  const parts = encoded.split('$');
  if (parts.length !== 6) return false;
  const [scheme, cost, blockSize, parallelization, salt, key] = parts;
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const parameters = {
    cost: Number(cost),
    blockSize: Number(blockSize),
    parallelization: Number(parallelization),
  };
  if (!parametersAreSupported(parameters)) return false;
  const decodedSalt = Buffer.from(salt, 'base64');
  if (decodedSalt.length !== SALT_LENGTH) return false;
  const expected = Buffer.from(key, 'base64');
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const actual = derive(password, decodedSalt, parameters);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const DECOY_HASH = hashPassword('unused-decoy-password', DEFAULT_SCRYPT_PARAMETERS);

export function spendVerificationWork(password: string): void {
  verifyPassword(password, DECOY_HASH);
}
