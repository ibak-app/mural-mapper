

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leadingIcon?: ReactNode;
  trailingElement?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, leadingIcon, trailingElement, id: idProp, disabled, ...props }, ref) => {
    const generatedId = useId();
    const inputId = idProp ?? generatedId;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-slate-600 tracking-wide uppercase">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leadingIcon && (
            <span className="absolute left-3 text-slate-400 pointer-events-none flex items-center">
              {leadingIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            className={cn(
              'w-full h-9 rounded-xl border text-sm text-slate-800 placeholder-slate-400',
              'bg-slate-50 hover:bg-white px-3.5',
              'outline-none ring-0 focus:ring-2 transition-all duration-150 ease-out',
              error
                ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
                : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-100',
              leadingIcon && 'pl-9',
              trailingElement && 'pr-10',
              disabled && 'opacity-50 cursor-not-allowed bg-slate-100',
              className,
            )}
            {...props}
          />
          {trailingElement && (
            <span className="absolute right-3 text-slate-400 flex items-center">{trailingElement}</span>
          )}
        </div>
        {error && <p className="text-xs text-red-600 flex items-center gap-1">{error}</p>}
        {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
    );
  },
);

Input.displayName = 'Input';
