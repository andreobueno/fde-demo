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
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

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
  const [scheme, cost, blockSize, parallelization, salt, key] = encoded.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const parameters = {
    cost: Number(cost),
    blockSize: Number(blockSize),
    parallelization: Number(parallelization),
  };
  if (!Object.values(parameters).every((value) => Number.isInteger(value) && value > 0)) return false;
  const expected = Buffer.from(key, 'base64');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = derive(password, Buffer.from(salt, 'base64'), parameters);
  return timingSafeEqual(expected, actual);
}

const DECOY_HASH = hashPassword('unused-decoy-password', DEFAULT_SCRYPT_PARAMETERS);

export function spendVerificationWork(password: string): void {
  verifyPassword(password, DECOY_HASH);
}
