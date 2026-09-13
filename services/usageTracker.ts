import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { UsageRecord } from './usageMath';

export type { UsageRecord } from './usageMath';

const STORAGE_KEY = 'lollys_api_usage_history';
const BALANCE_KEY = 'lollys_api_balance';

export const getBalance = (): number => {
  try {
    const data = localStorage.getItem(BALANCE_KEY);
    return data ? parseFloat(data) : 100.00; // Default $100 starting balance
  } catch (e) {
    return 100.00;
  }
};

export const setBalance = (amount: number) => {
  localStorage.setItem(BALANCE_KEY, amount.toString());
  window.dispatchEvent(new CustomEvent('balance-updated', { detail: amount }));
};

export const deductBalance = (amount: number) => {
  const current = getBalance();
  setBalance(current - amount);
};

// Local storage fallback for getUsageHistory
export const getUsageHistory = (): UsageRecord[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load usage history', e);
    return [];
  }
};

// Add a real-time Firestore listener for all records across all accounts
export const subscribeToUsageHistory = (callback: (records: UsageRecord[]) => void) => {
  try {
    const q = query(collection(db, 'lollys_api_usage_history'), orderBy('timestamp', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const records: UsageRecord[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        records.push({
          id: doc.id,
          timestamp: data.timestamp || Date.now(),
          type: data.type || 'image',
          model: data.model || 'unknown',
          tokensUsed: data.tokensUsed || 0,
          cost: data.cost || 0,
          details: data.details || '',
          username: data.username || 'unknown',
        });
      });
      callback(records);
    }, (error) => {
      console.error('Firestore snapshot listener failed, using local history as fallback:', error);
      callback(getUsageHistory());
    });
  } catch (e) {
    console.error('Failed to subscribe to firestore usage history:', e);
    return () => {};
  }
};

export const addUsageRecord = async (record: Omit<UsageRecord, 'id' | 'timestamp'>) => {
  const recordId = crypto.randomUUID();
  const timestamp = Date.now();
  
  const newRecord: UsageRecord = {
    ...record,
    id: recordId,
    timestamp: timestamp,
  };

  try {
    // 1. Save to LocalStorage for offline and instant local caching
    const history = getUsageHistory();
    history.unshift(newRecord);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    
    // Deduct balance locally
    deductBalance(record.cost);
    
    // Dispatch local event for local observers
    window.dispatchEvent(new CustomEvent('usage-updated', { detail: newRecord }));

    // 2. Persist to Firestore for global access across accounts (with username)
    await addDoc(collection(db, 'lollys_api_usage_history'), {
      id: recordId,
      timestamp: timestamp,
      type: record.type,
      model: record.model,
      tokensUsed: record.tokensUsed,
      cost: record.cost,
      details: record.details,
      username: record.username || 'unknown',
    });
  } catch (e) {
    console.error('Failed to save usage record to Firestore:', e);
  }
};

// History deletion is disabled in firestore.rules for audit/security purposes.
// This function will clear the local storage only, but live firestore records remain permanent.
export const clearUsageHistory = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('usage-updated'));
  } catch (e) {
    console.error('Failed to clear local usage history', e);
  }
};

export { calculateTotalCost, calculateTotalTokens } from './usageMath';
