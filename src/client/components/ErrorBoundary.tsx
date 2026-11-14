import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected rendering error occurred.',
    };
  }

  public componentDidCatch(error: Error): void {
    console.error('[ErrorBoundary]', error);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, message: '' });
    this.props.onReset?.();
  };

  public render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="bg-white border border-red-200 rounded-xl p-8 max-w-xl mx-auto my-8 space-y-4"
        >
          <div className="flex items-center gap-2.5 text-red-800">
            <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
            <h2 className="text-base font-semibold">Unable to display this workspace section</h2>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{this.state.message}</p>
          <button
            type="button"
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Recover View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
