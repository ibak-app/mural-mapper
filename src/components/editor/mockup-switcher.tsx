

import { Copy, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MockupTab {
  id: string;
  name: string;
}

interface MockupSwitcherProps {
  mockups: MockupTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClone: (id: string) => void;
}

export function MockupSwitcher({ mockups, activeId, onSelect, onCreate, onClone }: MockupSwitcherProps) {
  return (
    <div className="flex items-center shrink-0 overflow-x-auto h-[38px] bg-[#0f0f1a] border-b border-white/[0.07]" style={{ scrollbarWidth: 'none' }}>
      <div className="flex items-center h-full">
        {mockups.map((m) => {
          const isActive = activeId === m.id;
          return (
            <div key={m.id} className="relative flex items-center h-full group">
              <button
                onClick={() => onSelect(m.id)}
                className={cn(
                  'relative flex items-center h-full px-4 text-xs font-medium transition-colors whitespace-nowrap',
                  isActive ? 'text-indigo-300' : 'text-white/38 hover:text-white/65',
                )}
              >
                {m.name}
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-indigo-600 shadow-[0_0_6px_rgba(79,70,229,0.6)]" />
                )}
              </button>

              {isActive && (
                <button
                  onClick={() => onClone(m.id)}
                  className="flex items-center justify-center w-5 h-5 rounded mr-1 text-white/25 hover:text-indigo-300 hover:bg-indigo-500/15 transition-all"
                  title="Clone this mockup"
                >
                  <Copy className="w-3 h-3" />
                </button>
              )}

              <div className="absolute right-0 top-2 bottom-2 w-px bg-white/[0.06]" />
            </div>
          );
        })}
      </div>

      <button
        onClick={onCreate}
        className="flex items-center gap-1.5 mx-2 px-3 h-6 rounded-full text-xs font-semibold shrink-0 bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/28 hover:border-indigo-500 hover:text-indigo-200 transition-all"
        title="New mockup variant"
      >
        <Plus className="w-3 h-3" />
        New
      </button>
    </div>
  );
}
