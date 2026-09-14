import { defineConfig } from 'vitest/config';

// Runs only tests/rules/** against the Firestore emulator (needs a JRE and
// `firebase emulators:start --only firestore` running on 127.0.0.1:8080).
// Kept separate from vitest.config.ts so `npm test` never hangs waiting for
// an emulator that isn't there.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
