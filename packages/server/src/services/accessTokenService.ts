import { closeSync, fsyncSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Db } from '../db.js';
import { issueAccessToken, type AccessTokenMetadata } from '../repo/accessTokens.js';

export function issueAccessTokenFile(db: Db, analystId: string, outputFile: string): AccessTokenMetadata {
  if (!outputFile.trim()) throw new Error('An output file is required.');
  let created = false;
  try {
    return db.transaction(() => {
      const { token, ...metadata } = issueAccessToken(db, analystId);
      const fd = openSync(outputFile, 'wx', 0o600);
      created = true;
      try {
        writeFileSync(fd, `${token}\n`, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      return metadata;
    }).immediate();
  } catch (error) {
    if (created) unlinkSync(outputFile);
    throw error;
  }
}
