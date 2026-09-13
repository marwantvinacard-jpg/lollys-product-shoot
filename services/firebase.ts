import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import firebaseConfigFile from '../firebase-applet-config.json';

// Staging support: when VITE_FIREBASE_PROJECT_ID (and friends) are set --
// e.g. on a Vercel Preview deployment's environment variables, pointed at a
// second, isolated Firebase project -- they take priority over the
// committed firebase-applet-config.json, so staging traffic never touches
// production Auth/Firestore/Storage. Leave them unset (as in Production) to
// use the checked-in config as before.
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || firebaseConfigFile.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfigFile.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || firebaseConfigFile.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfigFile.storageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfigFile.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || firebaseConfigFile.appId,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore with custom database ID from config if present
const db = getFirestore(app, env.VITE_FIREBASE_DATABASE_ID || (firebaseConfigFile as any).firestoreDatabaseId || '(default)');

// Callable functions (functions/src/index.ts) -- this is how every AI call
// now reaches Gemini/Veo/fal.ai. The client never holds those API keys.
const functions = getFunctions(app);

// Real user accounts (replaces the hardcoded client-side login in App.tsx).
const auth = getAuth(app);

// Validate connection on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test_connection', 'ping'));
  } catch (error) {
    // Gracefully catch offline or initial connection negotiation states
    if (error instanceof Error) {
      if (error.message.includes('the client is offline') || error.message.includes('unavailable')) {
        console.warn("Firestore running in offline/cached mode or waiting for connection.");
      }
    }
  }
}
// Skip in tests: this is a real network call, and Firestore's SDK can spend
// a long time in retry/backoff before settling in a sandboxed test process
// with no real connectivity, hanging the whole run for something this file's
// own unit tests don't need. `import.meta.env.MODE` is 'test' under Vitest.
if (import.meta.env?.MODE !== 'test') {
  testConnection();
}

export { app, db, functions, auth };
