import { openDb, type Db } from './db.js';
import { issueAccessTokenFile } from './services/accessTokenService.js';

const args = process.argv.slice(2);
const [analystId, outputFile] = args;
let db: Db | undefined;
try {
  if (args.length !== 2 || !analystId?.trim() || !outputFile?.trim()) {
    throw new Error('Invalid arguments.');
  }
  db = openDb();
  const metadata = issueAccessTokenFile(db, analystId, outputFile);
  console.log(`Token written to ${outputFile}; expires at ${metadata.expiresAt}.`);
} catch {
  console.error('Token issuance failed. Usage: auth:issue <analyst-id> <output-file>. Check the analyst, database and a new writable file path.');
  process.exitCode = 1;
} finally {
  db?.close();
}
