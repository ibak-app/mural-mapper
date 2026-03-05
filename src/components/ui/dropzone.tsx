

import { useCallback, useState, type DragEvent, useRef } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DropzoneProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  label?: string;
  supportText?: string;
  acceptedTypes?: string[];
  disabled?: boolean;
}

export function Dropzone({
  onFiles,
  accept = 'image/*',
  multiple = true,
  label = 'Drop your images here',
  supportText = 'or click to browse files',
  acceptedTypes = ['PNG', 'JPG', 'WEBP', 'TIFF'],
  disabled = false,
}: DropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (disabled) return;
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) onFiles(multiple ? files : [files[0]]);
    },
    [onFiles, multiple, disabled],
  );

  const handleClick = () => !disabled && inputRef.current?.click();

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload images"
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={handleDrop}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      className={cn(
        'relative rounded-2xl p-10 text-center outline-none transition-all duration-200',
        'border-2 border-dashed',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        dragOver
          ? 'border-indigo-400 bg-gradient-to-br from-indigo-50 to-violet-50 scale-[1.01] shadow-[0_0_0_4px_rgba(79,70,229,0.12)]'
          : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) onFiles(files);
          e.target.value = '';
        }}
      />

      <div
        className={cn(
          'inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4 transition-all',
          dragOver
            ? 'gradient-primary shadow-lg shadow-indigo-500/35 animate-pulse-glow'
            : 'bg-gradient-to-br from-indigo-50 to-violet-50 shadow-sm',
        )}
      >
        <Upload className={cn('w-6 h-6', dragOver ? 'text-white' : 'text-indigo-600')} />
      </div>

      <p className={cn('mb-1 text-[15px] font-semibold tracking-tight transition-colors', dragOver ? 'text-indigo-600' : 'text-slate-900')}>
        {dragOver ? 'Release to upload' : label}
      </p>
      <p className="mb-5 text-[13px] text-slate-400">
        {dragOver ? 'Files will be added to your project' : supportText}
      </p>

      {acceptedTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 justify-center">
          {acceptedTypes.map((type) => (
            <span
              key={type}
              className={cn(
                'px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-wider border transition-colors',
                dragOver
                  ? 'bg-indigo-100/60 text-indigo-600 border-indigo-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200',
              )}
            >
              {type}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
