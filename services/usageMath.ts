// Pure usage-history math, deliberately free of any import (Firebase
// included) so it's unit testable in isolation. usageTracker.ts imports
// `db` from ./firebase, which establishes live Firestore/Auth connections
// at module load -- fine for the running app, but those connections never
// tear down in a test process, hanging the whole run even after the tests
// themselves finish instantly.

export interface UsageRecord {
  id: string;
  timestamp: number;
  type: 'image' | 'video' | 'text';
  model: string;
  tokensUsed: number;
  cost: number;
  details: string;
  username?: string;
}

export const calculateTotalCost = (history: UsageRecord[]): number =>
  history.reduce((total, record) => total + record.cost, 0);

export const calculateTotalTokens = (history: UsageRecord[]): number =>
  history.reduce((total, record) => total + record.tokensUsed, 0);
