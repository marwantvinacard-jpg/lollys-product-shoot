import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, Flag, LifeBuoy, Users, CreditCard, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { subscribeToFeatureFlags, DEFAULT_FLAGS, FeatureFlags } from '../services/featureFlags';
import {
  adminSetFeatureFlags,
  adminListSupportTickets,
  adminUpdateSupportTicketStatus,
  adminListCustomModels,
  adminDeleteCustomModel,
  adminListBilling,
  adminGetTodayRateLimits,
  AdminSupportTicket,
  AdminCustomModel,
  AdminBillingEntry,
  AdminRateLimitEntry,
} from '../services/admin';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'flags' | 'tickets' | 'models' | 'usage';

const FLAG_LABELS: Record<keyof FeatureFlags, string> = {
  dashboard: 'Dashboard',
  movieFlow: 'Movie Flow',
  customModelStudio: 'Custom Model Studio',
  imageEditor: 'Image Editor',
  videoEditor: 'Video Editor',
  ambientSound: 'Ambient Sound',
};

export const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose }) => {
  const [tab, setTab] = useState<Tab>('flags');

  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [savingFlag, setSavingFlag] = useState<string | null>(null);

  const [tickets, setTickets] = useState<AdminSupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);

  const [models, setModels] = useState<AdminCustomModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const [billing, setBilling] = useState<AdminBillingEntry[]>([]);
  const [rateLimits, setRateLimits] = useState<AdminRateLimitEntry[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const unsubscribe = subscribeToFeatureFlags(setFlags);
    return unsubscribe;
  }, [isOpen]);

  const loadTickets = async () => {
    setTicketsLoading(true);
    setError(null);
    try {
      setTickets(await adminListSupportTickets());
    } catch (e: any) {
      setError(e?.message || 'Failed to load support tickets.');
    } finally {
      setTicketsLoading(false);
    }
  };

  const loadModels = async () => {
    setModelsLoading(true);
    setError(null);
    try {
      setModels(await adminListCustomModels());
    } catch (e: any) {
      setError(e?.message || 'Failed to load custom models.');
    } finally {
      setModelsLoading(false);
    }
  };

  const loadUsage = async () => {
    setUsageLoading(true);
    setError(null);
    try {
      const [billingData, rateLimitData] = await Promise.all([adminListBilling(), adminGetTodayRateLimits()]);
      setBilling(billingData);
      setRateLimits(rateLimitData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load usage & billing.');
    } finally {
      setUsageLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    if (tab === 'tickets' && tickets.length === 0) loadTickets();
    if (tab === 'models' && models.length === 0) loadModels();
    if (tab === 'usage' && billing.length === 0 && rateLimits.length === 0) loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tab]);

  const toggleFlag = async (key: keyof FeatureFlags) => {
    setSavingFlag(key);
    setError(null);
    try {
      await adminSetFeatureFlags({ [key]: !flags[key] });
    } catch (e: any) {
      setError(e?.message || 'Failed to update flag.');
    } finally {
      setSavingFlag(null);
    }
  };

  const setTicketStatus = async (ticketId: string, status: 'open' | 'closed') => {
    try {
      await adminUpdateSupportTicketStatus(ticketId, status);
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, status } : t)));
    } catch (e: any) {
      setError(e?.message || 'Failed to update ticket.');
    }
  };

  const removeModel = async (modelId: string) => {
    try {
      await adminDeleteCustomModel(modelId);
      setModels((prev) => prev.filter((m) => m.id !== modelId));
    } catch (e: any) {
      setError(e?.message || 'Failed to delete model.');
    }
  };

  if (!isOpen) return null;

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'flags', label: 'Feature Flags', icon: <Flag size={14} /> },
    { id: 'tickets', label: 'Support', icon: <LifeBuoy size={14} /> },
    { id: 'models', label: 'Custom Models', icon: <Users size={14} /> },
    { id: 'usage', label: 'Usage & Billing', icon: <CreditCard size={14} /> },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl border border-slate-100 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-rose-500" />
            <h3 className="font-display font-bold text-slate-900">Admin</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-1 px-6 pt-3 border-b border-slate-100 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg whitespace-nowrap transition-colors ${
                tab === t.id ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-6 space-y-3 flex-1">
          {error && <p className="text-xs text-red-500">{error}</p>}

          {tab === 'flags' && (
            <div className="space-y-2">
              {(Object.keys(FLAG_LABELS) as (keyof FeatureFlags)[]).map((key) => (
                <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-sm text-slate-700 font-medium">{FLAG_LABELS[key]}</span>
                  <button
                    onClick={() => toggleFlag(key)}
                    disabled={savingFlag === key}
                    className={`relative w-11 h-6 rounded-full transition-colors ${flags[key] ? 'bg-emerald-500' : 'bg-slate-300'} disabled:opacity-50`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        flags[key] ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === 'tickets' && (
            <div className="space-y-2">
              <div className="flex justify-end">
                <button onClick={loadTickets} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1">
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
              {ticketsLoading && <Loader2 size={16} className="animate-spin text-slate-400 mx-auto" />}
              {!ticketsLoading && tickets.length === 0 && <p className="text-xs text-slate-400 text-center py-8">No tickets.</p>}
              {tickets.map((t) => (
                <div key={t.id} className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-700">{t.email}</span>
                    <span className="text-slate-400">{new Date(t.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-slate-600">{t.message}</p>
                  <div className="flex items-center justify-between pt-1">
                    <span className={t.status === 'open' ? 'text-amber-600' : 'text-emerald-600'}>{t.status}</span>
                    <button
                      onClick={() => setTicketStatus(t.id, t.status === 'open' ? 'closed' : 'open')}
                      className="text-slate-500 hover:text-slate-800 underline"
                    >
                      Mark {t.status === 'open' ? 'closed' : 'open'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'models' && (
            <div className="space-y-2">
              <div className="flex justify-end">
                <button onClick={loadModels} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1">
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
              {modelsLoading && <Loader2 size={16} className="animate-spin text-slate-400 mx-auto" />}
              {!modelsLoading && models.length === 0 && <p className="text-xs text-slate-400 text-center py-8">No saved models.</p>}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {models.map((m) => (
                  <div key={m.id} className="relative rounded-lg overflow-hidden border border-slate-100 group">
                    <img src={m.imageUrl} alt={m.name} className="w-full aspect-square object-cover" />
                    <div className="p-2 text-xs">
                      <p className="font-medium text-slate-700 truncate">{m.name}</p>
                      <p className="text-slate-400 truncate">{m.uid}</p>
                    </div>
                    <button
                      onClick={() => removeModel(m.id)}
                      className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-white/90 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete this model"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'usage' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button onClick={loadUsage} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1">
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
              {usageLoading && <Loader2 size={16} className="animate-spin text-slate-400 mx-auto" />}
              {!usageLoading && (
                <>
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Today's generations</p>
                    {rateLimits.length === 0 ? (
                      <p className="text-xs text-slate-400">No generations yet today.</p>
                    ) : (
                      <div className="space-y-1">
                        {rateLimits.map((r, i) => (
                          <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-slate-50 border border-slate-100">
                            <span className="text-slate-600 truncate">{r.uid}</span>
                            <span className="text-slate-500">{r.kind}: {r.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Credit balances</p>
                    {billing.length === 0 ? (
                      <p className="text-xs text-slate-400">No purchased credits on any account.</p>
                    ) : (
                      <div className="space-y-1">
                        {billing.map((b) => (
                          <div key={b.uid} className="flex items-center justify-between text-xs p-2 rounded bg-slate-50 border border-slate-100">
                            <span className="text-slate-600 truncate">{b.uid}</span>
                            <span className="text-slate-500">{b.credits} credits</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
