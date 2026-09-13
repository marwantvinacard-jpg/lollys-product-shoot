// In-app customer support: a minimal ticket system backed directly by
// Firestore (see firestore.rules' support_tickets match) rather than a
// third-party helpdesk -- works immediately with infrastructure this app
// already has, no external account needed. There's no admin UI yet; tickets
// are visible via the Firebase console until one is built.
import { collection, addDoc, onSnapshot, query, where, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export interface SupportTicket {
  id: string;
  uid: string;
  email: string;
  message: string;
  status: 'open' | 'closed';
  createdAt: number;
}

export const submitSupportTicket = async (uid: string, email: string, message: string): Promise<void> => {
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Please describe the issue before sending.');

  await addDoc(collection(db, 'support_tickets'), {
    uid,
    email: email || 'unknown',
    message: trimmed,
    status: 'open',
    createdAt: serverTimestamp(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    page: typeof window !== 'undefined' ? window.location.href : 'unknown',
  });
};

// Real-time listener for the current user's own tickets (rules restrict
// reads to resource.data.uid == request.auth.uid, so this only ever returns
// the signed-in user's tickets regardless of query).
export const subscribeToMyTickets = (uid: string, callback: (tickets: SupportTicket[]) => void) => {
  const q = query(collection(db, 'support_tickets'), where('uid', '==', uid), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const tickets: SupportTicket[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        tickets.push({
          id: doc.id,
          uid: data.uid,
          email: data.email || 'unknown',
          message: data.message || '',
          status: data.status || 'open',
          createdAt: data.createdAt?.toMillis?.() || Date.now(),
        });
      });
      callback(tickets);
    },
    (error) => {
      console.error('Failed to subscribe to support tickets', error);
      callback([]);
    }
  );
};
