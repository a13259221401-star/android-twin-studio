import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.PHONE_MIRROR_API_PORT || 8787);
const apiTarget = `http://127.0.0.1:${apiPort}`;
const apiWebSocketTarget = `ws://127.0.0.1:${apiPort}`;

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
        target: apiWebSocketTarget,
        ws: true,
      },
      '/screen': {
        target: apiWebSocketTarget,
        ws: true,
      },
      '/api': apiTarget,
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
