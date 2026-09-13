// Read-side access to the user's saved custom AI model library (writes go
// through the createCustomModel/editCustomModelImage/saveCustomModel/
// deleteCustomModel callables in geminiService.ts, never directly to
// Firestore -- see firestore.rules' custom_models match).
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { CustomModel } from '../types';

export const subscribeToMyCustomModels = (uid: string, callback: (models: CustomModel[]) => void) => {
  const q = query(collection(db, 'custom_models'), where('uid', '==', uid), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const models: CustomModel[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        models.push({
          id: doc.id,
          uid: data.uid,
          name: data.name || 'My Model',
          gender: data.gender || 'Unspecified',
          prompt: data.prompt || '',
          imageUrl: data.imageUrl,
          createdAt: data.createdAt?.toMillis?.() || Date.now(),
        });
      });
      callback(models);
    },
    (error) => {
      console.error('Failed to subscribe to custom models', error);
      callback([]);
    }
  );
};
