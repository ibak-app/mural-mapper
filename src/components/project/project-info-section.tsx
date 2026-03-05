

import { useState, useRef } from 'react';
import { Check, Loader2, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';

interface ProjectInfoSectionProps {
  project: Project;
  onUpdate: (updates: Partial<Project>) => Promise<void>;
}

// ─── Save indicator ───────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved';

function useSaveIndicator(): [SaveState, () => void] {
  const [state, setState] = useState<SaveState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = () => {
    setState('saving');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setState('saved');
      timerRef.current = setTimeout(() => setState('idle'), 1800);
    }, 350);
  };

  return [state, trigger];
}

// ─── Editable Field ───────────────────────────────────────────────────────────

function EditableField({
  value,
  onChange,
  onSave,
  placeholder,
  className,
  inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: (v: string) => void;
  placeholder: string;
  className?: string;
  inputClassName?: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div className={cn('relative group', className)}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onSave(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className={cn(
          'w-full bg-transparent focus:outline-none transition-all',
          'placeholder:text-slate-300',
          'border-b-2',
          focused
            ? 'border-indigo-500'
            : 'border-transparent group-hover:border-slate-200',
          inputClassName,
        )}
      />
      {/* Edit pencil hint */}
      {!focused && (
        <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-50 transition-opacity pointer-events-none">
          <Pencil className="w-3 h-3 text-slate-400" />
        </div>
      )}
    </div>
  );
}

// ─── Editable Notes ───────────────────────────────────────────────────────────

function EditableNotes({
  value,
  onChange,
  onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: (v: string) => void;
}) {
  const [open, setOpen] = useState(!!value);
  const [focused, setFocused] = useState(false);

  return (
    <div className="mt-3">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className={cn(
            'text-xs text-slate-400 hover:text-indigo-500 flex items-center gap-1.5',
            'transition-colors font-medium',
          )}
        >
          <span className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-indigo-100 hover:text-indigo-500 transition-colors">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
              <path d="M4 1v6M1 4h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          Add notes
        </button>
      ) : (
        <div className="relative group">
          <textarea
            value={value}
            placeholder="Project notes, brief, or context…"
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              onSave(value);
            }}
            rows={value ? Math.min(Math.max(value.split('\n').length, 2), 6) : 2}
            className={cn(
              'w-full bg-slate-50/60 text-sm text-slate-600 placeholder:text-slate-300',
              'resize-none focus:outline-none rounded-xl px-3 py-2.5 transition-all border',
              focused
                ? 'border-indigo-300 bg-white shadow-sm shadow-indigo-50 ring-2 ring-indigo-100'
                : 'border-slate-100 hover:border-slate-200',
            )}
          />
        </div>
      )}
    </div>
  );
}

// ─── Project Info Section ─────────────────────────────────────────────────────

export function ProjectInfoSection({ project, onUpdate }: ProjectInfoSectionProps) {
  const [name, setName] = useState(project.name);
  const [client, setClient] = useState(project.client);
  const [notes, setNotes] = useState(project.notes);
  const [saveState, triggerSave] = useSaveIndicator();

  const prevValues = useRef({
    name: project.name,
    client: project.client,
    notes: project.notes,
  });

  const saveIfChanged = async (field: 'name' | 'client' | 'notes', value: string) => {
    if (value === prevValues.current[field]) return;
    prevValues.current[field] = value;
    triggerSave();
    await onUpdate({ [field]: value });
  };

  return (
    <section className="space-y-1">
      {/* Project name */}
      <EditableField
        value={name}
        onChange={setName}
        onSave={(v) => saveIfChanged('name', v)}
        placeholder="Project name"
        inputClassName="text-2xl font-bold text-slate-800 py-1 pr-6 tracking-tight"
      />

      {/* Client */}
      <EditableField
        value={client}
        onChange={setClient}
        onSave={(v) => saveIfChanged('client', v)}
        placeholder="Client name"
        inputClassName="text-sm text-slate-500 py-0.5 pr-6"
      />

      {/* Notes */}
      <EditableNotes
        value={notes}
        onChange={setNotes}
        onSave={(v) => saveIfChanged('notes', v)}
      />

      {/* Auto-save indicator */}
      <div
        className={cn(
          'flex items-center gap-1.5 text-[11px] transition-all duration-300 pt-1',
          saveState === 'idle' ? 'opacity-0' : 'opacity-100',
        )}
      >
        {saveState === 'saving' ? (
          <>
            <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />
            <span className="text-slate-400 font-medium">Saving…</span>
          </>
        ) : (
          <>
            <Check className="w-3 h-3 text-emerald-500" strokeWidth={2.5} />
            <span className="text-emerald-600 font-medium">Saved</span>
          </>
        )}
      </div>
    </section>
  );
}
