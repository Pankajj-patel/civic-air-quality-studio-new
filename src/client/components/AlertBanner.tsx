import React from 'react';
import { AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';

interface AlertBannerProps {
  variant?: 'error' | 'success' | 'info';
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({
  variant = 'error',
  message,
  onRetry,
  retryLabel = 'Retry',
}) => {
  const isError = variant === 'error';
  const isSuccess = variant === 'success';
  const styleClass = isError
    ? 'border-red-200 bg-red-50 text-red-900'
    : isSuccess
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : 'border-slate-200 bg-slate-50 text-slate-800';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`p-3.5 rounded-lg border text-xs flex items-center justify-between gap-3 ${styleClass}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {isSuccess ? (
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
        ) : (
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
        )}
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 rounded-md shrink-0"
        >
          <RotateCcw className="w-3 h-3" aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  );
};
