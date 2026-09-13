// Firestore-backed feature flags: a single admin-managed document
// (feature_flags/config) that every client subscribes to in real time, so a
// feature can be toggled off for everyone without a redeploy. Toggle values
// from the Firebase console (Firestore Database > feature_flags > config) --
// there's no admin UI for this yet. See firestore.rules for the read-only
// access rule.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

export interface FeatureFlags {
  dashboard: boolean;
  movieFlow: boolean;
  customModelStudio: boolean;
  imageEditor: boolean;
  videoEditor: boolean;
  ambientSound: boolean;
}

// imageEditor/videoEditor default off: those components aren't part of the
// current build (kept out to fit the deploy size budget -- see README), so
// the flag would gate UI for editors that don't exist yet. Flip them on only
// once ImageEditor.tsx/VideoEditor.tsx are wired back into ProductCard.tsx.
// Everything else defaults "on."
export const DEFAULT_FLAGS: FeatureFlags = {
  dashboard: true,
  movieFlow: true,
  customModelStudio: true,
  imageEditor: false,
  videoEditor: false,
  ambientSound: false,
};

export const subscribeToFeatureFlags = (callback: (flags: FeatureFlags) => void) => {
  return onSnapshot(
    doc(db, 'feature_flags', 'config'),
    (snap) => {
      if (!snap.exists()) { callback(DEFAULT_FLAGS); return; }
      callback({ ...DEFAULT_FLAGS, ...(snap.data() as Partial<FeatureFlags>) });
    },
    (error) => {
      console.error('Failed to subscribe to feature flags, using defaults', error);
      callback(DEFAULT_FLAGS);
    }
  );
};
