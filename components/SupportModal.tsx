import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, LifeBuoy, Send, CheckCircle2, Clock } from 'lucide-react';
import { Button } from './Button';
import { submitSupportTicket, subscribeToMyTickets, SupportTicket } from '../services/support';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
  email: string;
}

export const SupportModal: React.FC<SupportModalProps> = ({ isOpen, onClose, uid, email }) => {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);

  useEffect(() => {
    if (!isOpen || !uid) return;
    const unsubscribe = subscribeToMyTickets(uid, setTickets);
    return unsubscribe;
  }, [isOpen, uid]);

  useEffect(() => {
    if (!isOpen) {
      setMessage('');
      setError(null);
      setJustSubmitted(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await submitSupportTicket(uid, email, message);
      setMessage('');
      setJustSubmitted(true);
      setTimeout(() => setJustSubmitted(false), 4000);
    } catch (err: any) {
      setError(err?.message || 'Failed to send. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-100 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <LifeBuoy size={18} className="text-rose-500" />
            <h3 className="font-display font-bold text-slate-900">Help &amp; Support</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Describe your issue</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="What happened? Include what you were doing when it happened."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all resize-none"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            {justSubmitted && (
              <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 size={14} /> Sent — we'll get back to you at {email}.
              </p>
            )}
            <Button type="submit" isLoading={submitting} disabled={!message.trim()} variant="primary" size="sm" className="w-full bg-slate-900 hover:bg-slate-800">
              <Send size={14} className="mr-1.5" /> Send
            </Button>
          </form>

          {tickets.length > 0 && (
            <div className="space-y-2 pt-4 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Your previous tickets</p>
              {tickets.map((t) => (
                <div key={t.id} className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`inline-flex items-center gap-1 font-medium ${t.status === 'open' ? 'text-amber-600' : 'text-emerald-600'}`}>
                      <Clock size={11} /> {t.status === 'open' ? 'Open' : 'Closed'}
                    </span>
                    <span className="text-slate-400">{new Date(t.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-slate-600 line-clamp-2">{t.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
