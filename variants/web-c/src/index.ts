import { createApiClient } from './api/client.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const apiUrl = (process.env.KYC_API_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');

const app = createApp({ api: createApiClient(apiUrl) });
app.listen(port, () => {
  console.log(`web-c listening on http://localhost:${port} (API: ${apiUrl})`);
});
