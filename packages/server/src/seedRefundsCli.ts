import { openDb } from './db.js';
import { seedRefunds } from './seedRefunds.js';

const db = openDb();
try {
  console.log(`Added ${seedRefunds(db)} fictional refunds; existing decisions and audit history retained.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Refund seeding failed.');
  process.exitCode = 1;
} finally {
  db.close();
}
