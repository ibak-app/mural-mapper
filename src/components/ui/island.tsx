

import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface IslandProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'light' | 'dark';
}

export const Island = forwardRef<HTMLDivElement, IslandProps>(
  ({ className, variant = 'light', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl shadow-lg',
        variant === 'dark'
          ? 'bg-[rgba(10,10,20,0.82)] backdrop-blur-xl border border-white/[0.08] text-slate-200'
          : 'bg-white/80 backdrop-blur-xl border border-white/50 text-slate-800',
        className,
      )}
      {...props}
    />
  ),
);
Island.displayName = 'Island';
