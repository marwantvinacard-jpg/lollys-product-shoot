/// <reference types="vite/client" />

// Staging support (see services/firebase.ts): set these on a Vercel Preview
// environment to point that build at a separate Firebase project instead of
// the one baked into firebase-applet-config.json. All optional -- an unset
// var falls back to the committed config, as in Production.
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_DATABASE_ID?: string;
  readonly VITE_SENTRY_DSN?: string;
}
