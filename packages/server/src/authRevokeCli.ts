import { openDb, type Db } from './db.js';
import { revokeAccessTokens } from './repo/accessTokens.js';

const args = process.argv.slice(2);
const [analystId] = args;
let db: Db | undefined;
try {
  if (args.length !== 1 || !analystId?.trim()) throw new Error('Invalid arguments.');
  db = openDb();
  const count = revokeAccessTokens(db, analystId);
  console.log(`Revoked ${count} access token(s) for analyst ${analystId}.`);
} catch {
  console.error('Token revocation failed. Usage: auth:revoke <analyst-id>. Check the analyst and database.');
  process.exitCode = 1;
} finally {
  db?.close();
}
