import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** index.html must not stick in the phone cache, or a refresh keeps the old bundle. */
function noStoreIndex(): Plugin {
  const set = (req: { url?: string }, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    const path = req.url?.split('?')[0] ?? '';
    if (path === '/' || path.endsWith('/index.html') || path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  };
  return {
    name: 'no-store-index',
    configureServer(server) {
      server.middlewares.use(set);
    },
    configurePreviewServer(server) {
      server.middlewares.use(set);
    },
  };
}

// `base: './'` is required so the built bundle works when Capacitor serves it
// from the device filesystem (capacitor://localhost / https://localhost).
export default defineConfig({
  base: './',
  plugins: [react(), noStoreIndex()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
