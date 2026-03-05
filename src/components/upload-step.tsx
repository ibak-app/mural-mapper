

import { useCallback, useState, useRef, type DragEvent } from 'react';
import { ImagePlus, Paintbrush, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface UploadStepProps {
  onComplete: (wallImage: HTMLImageElement, artImage: HTMLImageElement) => void;
}

function ImageDropzone({
  label,
  icon: Icon,
  image,
  onFile,
}: {
  label: string;
  icon: typeof ImagePlus;
  image: string | null;
  onFile: (file: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith('image/')) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.click(); }}
      className={cn(
        'relative flex-1 min-h-[280px] rounded-2xl border-2 border-dashed transition-all cursor-pointer overflow-hidden',
        'flex flex-col items-center justify-center gap-3',
        image ? 'border-indigo-300 bg-indigo-50/30' : dragOver
          ? 'border-indigo-400 bg-indigo-50 scale-[1.01]'
          : 'border-slate-200 bg-slate-50/50 hover:border-slate-300',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />

      {image ? (
        <>
          <img src={image} alt={label} className="absolute inset-0 w-full h-full object-contain p-4" />
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
            <span className="bg-black/60 backdrop-blur text-white text-xs px-2.5 py-1 rounded-full font-medium">
              {label}
            </span>
            <span className="bg-indigo-600 text-white text-[10px] px-2 py-0.5 rounded-full font-semibold">
              Change
            </span>
          </div>
        </>
      ) : (
        <>
          <div className={cn(
            'w-16 h-16 rounded-2xl flex items-center justify-center',
            dragOver ? 'gradient-primary shadow-lg' : 'bg-gradient-to-br from-indigo-50 to-violet-50',
          )}>
            <Icon className={cn('w-7 h-7', dragOver ? 'text-white' : 'text-indigo-600')} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-800">{label}</p>
            <p className="text-xs text-slate-400 mt-0.5">Drop image or click to browse</p>
          </div>
        </>
      )}
    </div>
  );
}

export function UploadStep({ onComplete }: UploadStepProps) {
  const [wallSrc, setWallSrc] = useState<string | null>(null);
  const [artSrc, setArtSrc] = useState<string | null>(null);
  const wallImgRef = useRef<HTMLImageElement | null>(null);
  const artImgRef = useRef<HTMLImageElement | null>(null);

  const handleFile = (type: 'wall' | 'art') => (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (type === 'wall') {
        setWallSrc(url);
        wallImgRef.current = img;
      } else {
        setArtSrc(url);
        artImgRef.current = img;
      }
    };
    img.src = url;
  };

  const canContinue = wallSrc && artSrc;

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 animate-fade-in">
      <div className="text-center mb-10">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Mural Mapper</h1>
        <p className="text-sm text-slate-500 mt-2">
          Upload a wall photo and the artwork you want to place on it
        </p>
      </div>

      <div className="flex gap-5">
        <ImageDropzone
          label="Wall Photo"
          icon={ImagePlus}
          image={wallSrc}
          onFile={handleFile('wall')}
        />
        <ImageDropzone
          label="Artwork"
          icon={Paintbrush}
          image={artSrc}
          onFile={handleFile('art')}
        />
      </div>

      <div className="mt-8 flex justify-center">
        <Button
          size="lg"
          disabled={!canContinue}
          onClick={() => {
            if (wallImgRef.current && artImgRef.current) {
              onComplete(wallImgRef.current, artImgRef.current);
            }
          }}
          icon={<ArrowRight className="w-4 h-4" />}
        >
          Place Artwork on Wall
        </Button>
      </div>
    </div>
  );
}
