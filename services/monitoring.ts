// Error monitoring, in two layers:
//
// 1. Always on: every uncaught error is written to Firestore's client_errors
//    collection (write-only from the client -- see firestore.rules). Works
//    immediately with infrastructure this app already has, no external
//    account needed, so bugs get captured starting today.
// 2. Optional upgrade: if VITE_SENTRY_DSN is set, the same errors also go to
//    Sentry for a real dashboard/alerting/stack-trace-symbolication
//    experience. Completely inert (and the SDK is never even downloaded)
//    until that's configured -- see .env.local.example.
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

let sentryInitialized = false;
let globalHandlersInstalled = false;
let errorReportCount = 0;
const MAX_REPORTS_PER_SESSION = 20; // guard against a render-loop flooding Firestore with writes

export const initMonitoring = async (): Promise<void> => {
  installGlobalErrorHandlers();

  const dsn = import.meta.env?.VITE_SENTRY_DSN;
  if (!dsn || sentryInitialized) return;
  sentryInitialized = true;

  try {
    const Sentry = await import('@sentry/react');
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
      // Don't fingerprint/report the app's own "[ignoring loop detection]"
      // marker errors any differently -- they're regular user-facing errors,
      // just tagged for an unrelated internal reason.
    });
  } catch (e) {
    console.warn('Sentry failed to initialize; continuing with the Firestore-only error log.', e);
  }
};

// Catches errors React's ErrorBoundary can't: anything thrown outside a
// render (an async handler, a stray promise rejection, a timer callback).
const installGlobalErrorHandlers = () => {
  if (globalHandlersInstalled || typeof window === 'undefined') return;
  globalHandlersInstalled = true;

  window.addEventListener('error', (event) => {
    captureException(event.error || event.message, { source: 'window.onerror' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    captureException(event.reason, { source: 'unhandledrejection' });
  });
};

export const captureException = async (error: unknown, context?: Record<string, unknown>): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  if (errorReportCount < MAX_REPORTS_PER_SESSION) {
    errorReportCount++;
    try {
      await addDoc(collection(db, 'client_errors'), {
        message,
        stack: stack || null,
        context: context || null,
        url: typeof window !== 'undefined' ? window.location.href : 'unknown',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      // Monitoring failing silently should never break the app itself.
      console.warn('Failed to log error to Firestore', e);
    }
  }

  const dsn = import.meta.env?.VITE_SENTRY_DSN;
  if (!dsn) return;
  try {
    const Sentry = await import('@sentry/react');
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Same reasoning: never let monitoring itself throw.
  }
};
