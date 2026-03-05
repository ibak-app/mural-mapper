

import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';

interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  variant?: 'default' | 'dark';
  className?: string;
  'aria-label'?: string;
}

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  variant = 'default',
  className,
  'aria-label': ariaLabel,
}: SliderProps) {
  const isDark = variant === 'dark';

  return (
    <SliderPrimitive.Root
      className={cn('relative flex items-center select-none touch-none w-full h-5', className)}
      value={[value]}
      onValueChange={([v]) => onValueChange(v)}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
    >
      <SliderPrimitive.Track
        className={cn(
          'relative grow rounded-full h-1.5',
          isDark ? 'bg-white/10' : 'bg-slate-200',
        )}
      >
        <SliderPrimitive.Range
          className={cn(
            'absolute h-full rounded-full',
            isDark ? 'bg-indigo-400' : 'bg-indigo-500',
          )}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          'block w-4 h-4 rounded-full shadow-md transition-transform',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
          'hover:scale-110 active:scale-95',
          isDark
            ? 'bg-white border-2 border-indigo-400 focus-visible:ring-offset-[#13131f]'
            : 'bg-white border-2 border-indigo-500',
        )}
      />
    </SliderPrimitive.Root>
  );
}
