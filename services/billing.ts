// Client-side wrapper around the billing callable functions
// (functions/src/index.ts's getCreditBalance / createCheckoutSession).
// Real money only moves once you've set up a real Stripe account and
// replaced the placeholder price IDs in CREDIT_PACKS there -- see that
// file's comment for the exact setup steps. Until then, createCheckoutSession
// throws a clear "not configured yet" error instead of silently failing.
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { functions, db } from './firebase';

export interface CreditPackOption {
  id: string;
  credits: number;
  priceUsd: number;
  label: string;
}

// Mirrors functions/src/index.ts's CREDIT_PACKS for display purposes only --
// the server is the source of truth for what a pack actually costs/grants.
export const CREDIT_PACK_OPTIONS: CreditPackOption[] = [
  { id: 'small', credits: 100, priceUsd: 5, label: 'Starter' },
  { id: 'medium', credits: 500, priceUsd: 20, label: 'Growth' },
  { id: 'large', credits: 1500, priceUsd: 50, label: 'Studio' },
];

export const getCreditBalance = async (): Promise<number> => {
  const call = httpsCallable(functions, 'getCreditBalance');
  const { data }: any = await call({});
  return data.credits ?? 0;
};

// Real-time balance updates (e.g. right after a purchase completes and the
// Stripe webhook credits the account) without a manual refresh.
export const subscribeToCreditBalance = (uid: string, callback: (credits: number) => void) => {
  return onSnapshot(
    doc(db, 'billing', uid),
    (snap) => callback(snap.exists() ? (snap.data()?.credits ?? 0) : 0),
    (error) => {
      console.error('Failed to subscribe to credit balance', error);
      callback(0);
    }
  );
};

export const startCheckout = async (packId: string): Promise<void> => {
  const call = httpsCallable(functions, 'createCheckoutSession');
  const { data }: any = await call({
    packId,
    successUrl: `${window.location.origin}${window.location.pathname}?checkout=success`,
    cancelUrl: `${window.location.origin}${window.location.pathname}?checkout=cancelled`,
  });
  window.location.href = data.url;
};
