import { openDb } from './db.js';
import { createApp } from './http/app.js';

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST;
const db = openDb();
const app = createApp(db);

const onListening = () => {
  console.log(`KYC server listening on http://${host ?? 'localhost'}:${port}`);
};

if (host) {
  app.listen(port, host, onListening);
} else {
  app.listen(port, onListening);
}
