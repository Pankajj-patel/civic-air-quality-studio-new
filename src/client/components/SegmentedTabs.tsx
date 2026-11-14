import React, { useRef } from 'react';

export interface TabOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedTabsProps<T extends string> {
  ariaLabel: string;
  options: readonly TabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}

export function SegmentedTabs<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  className = '',
}: SegmentedTabsProps<T>): React.ReactElement {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    let nextIdx = -1;
    if (e.key === 'ArrowRight') {
      nextIdx = (idx + 1) % options.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (idx - 1 + options.length) % options.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = options.length - 1;
    }
    if (nextIdx >= 0) {
      e.preventDefault();
      onChange(options[nextIdx].value);
      buttonRefs.current[nextIdx]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg ${className}`}
    >
      {options.map((opt, idx) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              buttonRefs.current[idx] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              selected
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
