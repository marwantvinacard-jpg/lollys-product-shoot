import React, { useEffect, useState } from 'react';
import { subscribeToUsageHistory, UsageRecord, calculateTotalCost, calculateTotalTokens } from '../services/usageTracker';
import { CREDIT_PACK_OPTIONS, subscribeToCreditBalance, startCheckout } from '../services/billing';
import { Activity, DollarSign, Database, Clock, Lock, User as UserIcon, Coins, AlertCircle } from 'lucide-react';
import { Button } from './Button';

interface DashboardProps {
  uid?: string;
}

export const Dashboard: React.FC<DashboardProps> = ({ uid }) => {
  const [history, setHistory] = useState<UsageRecord[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const [credits, setCredits] = useState<number | null>(null);
  const [checkoutLoadingPack, setCheckoutLoadingPack] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    // Subscribe to Firestore updates in real-time across all users
    const unsubscribe = subscribeToUsageHistory((data) => {
      setHistory(data);
      setTotalCost(calculateTotalCost(data));
      setTotalTokens(calculateTotalTokens(data));
      setIsLoading(false);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!uid) return;
    const unsubscribe = subscribeToCreditBalance(uid, setCredits);
    return unsubscribe;
  }, [uid]);

  const handleBuyCredits = async (packId: string) => {
    setCheckoutError(null);
    setCheckoutLoadingPack(packId);
    try {
      await startCheckout(packId);
      // startCheckout redirects the page on success; nothing else to do here.
    } catch (err: any) {
      setCheckoutError(err?.message || 'Failed to start checkout. Please try again.');
      setCheckoutLoadingPack(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <h2 className="text-3xl font-display font-bold text-slate-800 flex items-center gap-3">
          <Activity className="text-rose-500" size={32} />
          API Usage Dashboard
        </h2>
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 rounded-full border border-slate-200">
          <Lock size={14} className="text-slate-500" />
          <span>Permanent Audit Log (Immutable)</span>
        </div>
      </div>

      {/* Credits & Billing */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-12">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <Coins size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Purchased Credits</p>
              <p className="text-3xl font-bold text-slate-900">{credits === null ? '...' : credits.toLocaleString()}</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 max-w-xs">
            Everyone gets a free daily generation allowance. Credits kick in automatically once that's used up for the day.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {CREDIT_PACK_OPTIONS.map((pack) => (
            <div key={pack.id} className="rounded-xl border border-slate-200 p-4 flex flex-col items-center text-center gap-2">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pack.label}</p>
              <p className="text-2xl font-bold text-slate-900">{pack.credits.toLocaleString()}</p>
              <p className="text-xs text-slate-500">credits</p>
              <Button
                onClick={() => handleBuyCredits(pack.id)}
                isLoading={checkoutLoadingPack === pack.id}
                disabled={!!checkoutLoadingPack}
                variant="outline"
                size="sm"
                className="w-full mt-2 border-slate-200"
              >
                ${pack.priceUsd}
              </Button>
            </div>
          ))}
        </div>
        {checkoutError && (
          <p className="text-xs text-red-500 mt-3 flex items-start gap-1.5">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {checkoutError}
          </p>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600">
            <DollarSign size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Total Est. Cost</p>
            <p className="text-3xl font-bold text-slate-900">
              {isLoading ? '...' : `$${totalCost.toFixed(2)}`}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
            <Database size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Tokens Used</p>
            <p className="text-3xl font-bold text-slate-900">
              {isLoading ? '...' : totalTokens.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
            <Activity size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">API Calls</p>
            <p className="text-3xl font-bold text-slate-900">
              {isLoading ? '...' : history.length}
            </p>
          </div>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Clock size={18} className="text-slate-500" />
            Request History
          </h3>
          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
            Shared Multi-User Log
          </span>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Time</th>
                <th className="px-6 py-3">User</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Model</th>
                <th className="px-6 py-3">Details</th>
                <th className="px-6 py-3 text-right">Tokens</th>
                <th className="px-6 py-3 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin"></div>
                      <span>Loading immutable generation log from Firestore...</span>
                    </div>
                  </td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                    No API usage recorded yet.
                  </td>
                </tr>
              ) : (
                history.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-slate-600">
                      {new Date(record.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="flex items-center gap-1.5 font-medium text-slate-800 bg-slate-50 px-2 py-1 rounded-md border border-slate-100 w-fit">
                        <UserIcon size={12} className="text-slate-400" />
                        {record.username || 'unknown'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        record.type === 'image' ? 'bg-blue-100 text-blue-700' :
                        record.type === 'video' ? 'bg-purple-100 text-purple-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {record.type.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-700 font-medium">
                      {record.model}
                    </td>
                    <td className="px-6 py-4 text-slate-600 max-w-xs truncate" title={record.details}>
                      {record.details}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-slate-700">
                      {record.tokensUsed.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-medium text-slate-900">
                      ${record.cost.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
