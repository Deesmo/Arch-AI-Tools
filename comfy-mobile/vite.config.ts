import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` is required so the built bundle works when Capacitor serves it
// from the device filesystem (capacitor://localhost / https://localhost).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
