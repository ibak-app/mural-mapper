'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useProjectStore } from '@/stores/project-store';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Columns2, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ComparePage() {
  const { projectId, wallId } = useParams<{ projectId: string; wallId: string }>();
  const router = useRouter();
  const { project, loading, loadProject } = useProjectStore();
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [mode, setMode] = useState<'side-by-side' | 'slider'>('slider');
  const [sliderPos, setSliderPos] = useState(50);
  const sliderRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  const wall = project?.walls.find((w) => w.id === wallId);

  useEffect(() => {
    if (wall && wall.mockups.length >= 1) {
      if (!leftId) setLeftId('original');
      if (!rightId && wall.mockups.length >= 1) setRightId(wall.mockups[0].id);
    }
  }, [wall, leftId, rightId]);

  const handleMouseDown = () => { dragging.current = true; };
  const handleMouseUp = () => { dragging.current = false; };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current || !sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const pos = ((e.clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.max(5, Math.min(95, pos)));
  };

  if (loading || !project || !wall) {
    return <div className="fixed inset-0 bg-gray-900 flex items-center justify-center text-gray-400">Loading...</div>;
  }

  const originalUrl = `/api/projects/${projectId}/walls/${wallId}/image`;
  const options = [
    { id: 'original', name: 'Original' },
    ...wall.mockups.map((m) => ({ id: m.id, name: m.name })),
  ];

  function getImageUrl(id: string | null) {
    if (!id || id === 'original') return originalUrl;
    return `/api/projects/${projectId}/walls/${wallId}/mockups/${id}/render`;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-900">
      {/* Top bar */}
      <div className="bg-gray-800/90 backdrop-blur px-4 py-3 flex items-center justify-between border-b border-white/5 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/project/${projectId}/edit/${wallId}`)}
            className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5 text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Editor
          </button>
          <span className="text-white/20">|</span>
          <h1 className="text-white text-sm font-medium">{wall.name}</h1>
        </div>
        <div className="flex gap-1.5 bg-gray-700/50 rounded-lg p-1">
          <button
            onClick={() => setMode('slider')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              mode === 'slider' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white',
            )}
          >
            <SlidersHorizontal className="w-3 h-3" />
            Slider
          </button>
          <button
            onClick={() => setMode('side-by-side')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              mode === 'side-by-side' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white',
            )}
          >
            <Columns2 className="w-3 h-3" />
            Side by Side
          </button>
        </div>
      </div>

      {/* Main comparison area */}
      <div className="flex-1 flex overflow-hidden">
        {mode === 'side-by-side' ? (
          <>
            <div className="flex-1 flex flex-col items-center justify-center p-6">
              <p className="text-gray-500 text-xs font-medium mb-3 uppercase tracking-wider">
                {options.find((o) => o.id === leftId)?.name}
              </p>
              <img
                src={getImageUrl(leftId)}
                alt="Left"
                className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-2xl"
              />
            </div>
            <div className="w-px bg-white/10" />
            <div className="flex-1 flex flex-col items-center justify-center p-6">
              <p className="text-gray-500 text-xs font-medium mb-3 uppercase tracking-wider">
                {options.find((o) => o.id === rightId)?.name}
              </p>
              <img
                src={getImageUrl(rightId)}
                alt="Right"
                className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-2xl"
              />
            </div>
          </>
        ) : (
          <div
            ref={sliderRef}
            className="flex-1 relative cursor-col-resize select-none flex items-center justify-center"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Left image (full) */}
            <img
              src={getImageUrl(leftId)}
              alt="Before"
              className="max-w-[90%] max-h-[80vh] object-contain rounded-lg"
              style={{ position: 'absolute' }}
            />
            {/* Right image (clipped) */}
            <div
              className="absolute inset-0 flex items-center justify-center overflow-hidden"
              style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
            >
              <img
                src={getImageUrl(rightId)}
                alt="After"
                className="max-w-[90%] max-h-[80vh] object-contain rounded-lg"
              />
            </div>
            {/* Slider handle */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white/80 z-10"
              style={{ left: `${sliderPos}%` }}
              onMouseDown={handleMouseDown}
            >
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center cursor-col-resize">
                <SlidersHorizontal className="w-4 h-4 text-gray-600" />
              </div>
            </div>
            {/* Labels */}
            <div className="absolute top-4 left-4 bg-black/50 backdrop-blur text-white text-xs px-2.5 py-1 rounded-full">
              {options.find((o) => o.id === leftId)?.name}
            </div>
            <div className="absolute top-4 right-4 bg-black/50 backdrop-blur text-white text-xs px-2.5 py-1 rounded-full">
              {options.find((o) => o.id === rightId)?.name}
            </div>
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      <div className="bg-gray-800/90 backdrop-blur px-6 py-4 border-t border-white/5">
        <div className="flex items-center gap-8 justify-center">
          <div>
            <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-widest font-medium">Left</p>
            <div className="flex gap-1.5">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    leftId === opt.id
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
                      : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600 hover:text-white',
                  )}
                  onClick={() => setLeftId(opt.id)}
                >{opt.name}</button>
              ))}
            </div>
          </div>
          <div className="w-px h-8 bg-gray-700" />
          <div>
            <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-widest font-medium">Right</p>
            <div className="flex gap-1.5">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    rightId === opt.id
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
                      : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600 hover:text-white',
                  )}
                  onClick={() => setRightId(opt.id)}
                >{opt.name}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
