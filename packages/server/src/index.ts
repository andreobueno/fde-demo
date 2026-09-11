import { openDb } from './db.js';
import { createApp } from './http/app.js';

const port = Number(process.env.PORT ?? 4000);
const db = openDb();
const app = createApp(db);

app.listen(port, () => {
  console.log(`KYC server listening on http://localhost:${port}`);
});
