import { openDb } from './db.js';
import { DEMO_PASSWORD, seedDemoLogins } from './seedLogins.js';

const db = openDb();
try {
  const logins = seedDemoLogins(db);
  console.log(`Seeded ${logins.length} demo logins; existing sessions were signed out.`);
  for (const login of logins) {
    console.log(`  ${login.email}  ${login.role}`);
  }
  console.log(`Shared demo password: ${DEMO_PASSWORD}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Seeding demo logins failed.');
  process.exitCode = 1;
} finally {
  db.close();
}
