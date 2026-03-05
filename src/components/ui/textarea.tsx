

import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, rows = 4, id: idProp, disabled, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = idProp ?? generatedId;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={textareaId} className="text-xs font-semibold text-slate-600 tracking-wide uppercase">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          disabled={disabled}
          className={cn(
            'w-full rounded-xl border text-sm text-slate-800 placeholder-slate-400',
            'bg-slate-50 hover:bg-white px-3.5 py-2.5 resize-y leading-relaxed',
            'outline-none ring-0 focus:ring-2 transition-all duration-150 ease-out',
            error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
              : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-100',
            disabled && 'opacity-50 cursor-not-allowed bg-slate-100',
            className,
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
    );
  },
);

Textarea.displayName = 'Textarea';
