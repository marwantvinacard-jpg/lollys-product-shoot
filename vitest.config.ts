import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Separate from vite.config.ts (rather than adding a `test` block there) so
// the app's own dev/build config stays untouched by test-only concerns.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    // Several modules (services/firebase.ts -> firebase/auth) touch `window`
    // at import time, so tests need a browser-like global environment even
    // when the function under test is plain logic.
    environment: 'happy-dom',
    globals: false,
    // tests/rules/** needs the Firestore emulator and is run separately via
    // `npm run test:rules` (vitest.rules.config.ts) -- left in the default
    // run, it hangs `npm test` waiting for a connection to 127.0.0.1:8080.
    exclude: ['**/node_modules/**', 'tests/rules/**'],
  },
});
