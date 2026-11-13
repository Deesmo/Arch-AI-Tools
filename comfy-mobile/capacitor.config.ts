import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration.
 *
 * - `webDir` is the Vite build output (`npm run build`).
 * - The app talks to a *remote* ComfyUI server (configured in-app), so no
 *   `server.url` is set here; the bundle is served from the device.
 * - Plain `http://` ComfyUI servers on a LAN need cleartext/ATS exceptions on
 *   the native side; see README "Native networking notes".
 */
const config: CapacitorConfig = {
  appId: 'dev.archtools.comfymobile',
  appName: 'Comfy Mobile',
  webDir: 'dist',
  backgroundColor: '#202020',
  ios: {
    contentInset: 'never',
    backgroundColor: '#202020',
  },
  android: {
    backgroundColor: '#202020',
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
};

export default config;
