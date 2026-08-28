import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api/capabilities': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/api/settings': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/pose': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
      },
      '/screen': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
      },
      '/api': 'http://127.0.0.1:8787',
      '/mirror-runtime': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: true,
        rewrite: (requestPath) => requestPath.replace(/^\/mirror-runtime/, ''),
      },
      '/': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: true,
        rewriteWsOrigin: true,
        bypass: (request) => {
          const requestUrl = request.url || '/';
          const parsed = new URL(requestUrl, 'http://127.0.0.1');
          const isScrcpyStream =
            request.headers.upgrade?.toLowerCase() === 'websocket' &&
            parsed.searchParams.get('action') === 'stream';
          return isScrcpyStream ? undefined : requestUrl;
        },
      },
    },
  },
});
