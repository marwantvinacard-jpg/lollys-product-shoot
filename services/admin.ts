// Thin client wrappers around the admin-only callables in
// functions/src/index.ts. Every one of these is independently gated
// server-side by an email allowlist (requireAdmin) -- ADMIN_EMAILS here only
// controls whether the Admin nav item is shown in the UI, never who can
// actually call these. Keep this list in sync with the one in
// functions/src/index.ts.
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { FeatureFlags } from './featureFlags';

export interface AdminSupportTicket {
  id: string;
  uid: string;
  email: string;
  message: string;
  status: 'open' | 'closed';
  createdAt: number;
}

export interface AdminCustomModel {
  id: string;
  uid: string;
  name: string;
  gender: string;
  imageUrl: string;
  createdAt: number;
}

export interface AdminBillingEntry {
  uid: string;
  credits: number;
}

export interface AdminRateLimitEntry {
  uid: string;
  kind: string;
  count: number;
}

export const ADMIN_EMAILS = new Set(['marwan.tvinacard@gmail.com']);
export const isAdminEmail = (email?: string | null): boolean => !!email && ADMIN_EMAILS.has(email.toLowerCase());

export const adminSetFeatureFlags = async (flags: Partial<FeatureFlags>): Promise<void> => {
  await httpsCallable(functions, 'adminSetFeatureFlags')(flags);
};

export const adminListSupportTickets = async (): Promise<AdminSupportTicket[]> => {
  const { data } = await httpsCallable(functions, 'adminListSupportTickets')();
  return data as AdminSupportTicket[];
};

export const adminUpdateSupportTicketStatus = async (ticketId: string, status: 'open' | 'closed'): Promise<void> => {
  await httpsCallable(functions, 'adminUpdateSupportTicketStatus')({ ticketId, status });
};

export const adminListCustomModels = async (): Promise<AdminCustomModel[]> => {
  const { data } = await httpsCallable(functions, 'adminListCustomModels')();
  return data as AdminCustomModel[];
};

export const adminDeleteCustomModel = async (modelId: string): Promise<void> => {
  await httpsCallable(functions, 'adminDeleteCustomModel')({ modelId });
};

export const adminListBilling = async (): Promise<AdminBillingEntry[]> => {
  const { data } = await httpsCallable(functions, 'adminListBilling')();
  return data as AdminBillingEntry[];
};

export const adminGetTodayRateLimits = async (): Promise<AdminRateLimitEntry[]> => {
  const { data } = await httpsCallable(functions, 'adminGetTodayRateLimits')();
  return data as AdminRateLimitEntry[];
};
