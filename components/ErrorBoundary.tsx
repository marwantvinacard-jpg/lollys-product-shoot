import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { captureException } from '../services/monitoring';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

// Without this, any uncaught render error anywhere in the tree crashes the
// entire app to a white screen with no way back for the user. This catches
// it, shows a recoverable screen, and logs the error instead.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Uncaught render error:', error, info.componentStack);
    captureException(error, { componentStack: info.componentStack || undefined });
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#FDFCF8] p-6">
          <div className="max-w-md w-full bg-white rounded-2xl border border-slate-100 shadow-xl p-8 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center text-red-500">
              <AlertTriangle size={26} />
            </div>
            <h1 className="text-lg font-display font-bold text-slate-900 mb-2">Something went wrong</h1>
            <p className="text-sm text-slate-500 mb-6">
              An unexpected error occurred. Your work in progress may not be saved. Reloading usually fixes this.
            </p>
            <button
              onClick={this.handleReload}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
            >
              Reload App
            </button>
            {import.meta.env?.DEV && (
              <pre className="mt-4 text-left text-[10px] text-red-500 bg-red-50/50 rounded-lg p-3 overflow-auto max-h-40">
                {this.state.error.message}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
