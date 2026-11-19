import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineWebViteConfig } from '@rexezuge/tooling/vite';

const apiTarget = 'http://localhost:8787';

// Management + proxy API prefixes live under `/user`, `/v1`, `/anthropic`,
// `/gemini`. No SPA route shares those prefixes, so every match proxies to
// the worker without an `Accept` bypass.
const apiProxy = { target: apiTarget, changeOrigin: true };

export default defineWebViteConfig({
  plugins: [react(), tailwindcss()],
  proxy: {
    '/user': apiProxy,
    '/v1': apiProxy,
    '/anthropic': apiProxy,
    '/gemini': apiProxy,
  },
  // Resolved against the directory the build runs in (`apps/web`), so the
  // default `dist/index.html` is `apps/web/dist/index.html`.
  spaShell: { path: '../../apps/api/src/generated/spa-shell.ts' },
});
