import react from '@vitejs/plugin-react';

export default {
  plugins: [react()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4000' } },
  test: { environment: 'node' },
};
