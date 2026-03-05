

import { type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  maxWidth?: number | string;
  hideCloseButton?: boolean;
  footer?: ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  maxWidth = 480,
  hideCloseButton = false,
  footer,
}: DialogProps) {
  const maxWidthValue = typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[9000] bg-[rgba(15,15,30,0.55)] backdrop-blur-sm"
          style={{ animation: 'radix-overlay-show 0.18s ease both' }}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[9001] w-[calc(100%-32px)] bg-white rounded-2xl overflow-hidden',
            'shadow-[0_24px_64px_rgba(0,0,0,0.18),0_8px_24px_rgba(0,0,0,0.10)]',
            'border border-white/80',
          )}
          style={{
            maxWidth: maxWidthValue,
            animation: 'radix-content-show 0.22s cubic-bezier(0.34, 1.56, 0.64, 1) both',
          }}
        >
          {/* Gradient accent bar */}
          <div aria-hidden="true" className="h-[3px] bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-500" />

          {/* Header */}
          {(title || !hideCloseButton) && (
            <div className="flex items-start justify-between px-6 pt-5 gap-3">
              <div className="flex-1 min-w-0">
                {title && (
                  <DialogPrimitive.Title className="text-base font-bold text-slate-900 tracking-tight leading-snug">
                    {title}
                  </DialogPrimitive.Title>
                )}
                {description && (
                  <DialogPrimitive.Description className="mt-1 text-[13px] text-slate-500 leading-normal">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              {!hideCloseButton && (
                <DialogPrimitive.Close asChild>
                  <button
                    className="shrink-0 w-7 h-7 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors cursor-pointer"
                    aria-label="Close"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </DialogPrimitive.Close>
              )}
            </div>
          )}

          {/* Body */}
          <div className="px-6 py-5">{children}</div>

          {/* Footer */}
          {footer && (
            <div className="px-6 pb-5 pt-0 border-t border-slate-100 bg-slate-50/50 flex gap-2 justify-end py-4">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
