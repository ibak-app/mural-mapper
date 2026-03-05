'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useProjectStore } from '@/stores/project-store';
import { WallCardPresent } from '@/components/presentation/wall-card-present';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FeedbackStatus } from '@/lib/types';

export default function PresentationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { project, loading, loadProject, updateFeedback } = useProjectStore();

  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  const handleFeedback = (
    wallId: string,
    mockupId: string,
    status: FeedbackStatus,
    comment: string
  ) => {
    updateFeedback(wallId, mockupId, status, comment);
  };

  if (loading || !project) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-sm text-slate-400 tracking-wide">Loading presentation…</p>
        </div>
      </div>
    );
  }

  const sorted = [...project.walls].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (sorted.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-6">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M9.75 9.75a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" />
          </svg>
        </div>
        <p className="text-slate-500 text-sm">No walls to present yet.</p>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft className="w-4 h-4" />}
          onClick={() => router.push(`/project/${projectId}`)}
        >
          Back to project
        </Button>
      </div>
    );
  }

  // Summary counts across all mockups
  const allMockups = sorted.flatMap((w) => w.mockups);
  const totalMockups = allMockups.length;
  const liked = allMockups.filter((m) => m.feedback?.status === 'liked').length;
  const disliked = allMockups.filter((m) => m.feedback?.status === 'disliked').length;
  const pending = totalMockups - liked - disliked;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Top bar: frosted glass ───────────────────────────────────────────── */}
      <header className={cn(
        'sticky top-0 z-30 border-b border-slate-200/80',
        'backdrop-blur-xl backdrop-saturate-150 bg-white/85',
      )}>
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between gap-4">

          {/* Left: back button + project info */}
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Back to project"
              onClick={() => router.push(`/project/${projectId}`)}
              className="flex-shrink-0 w-8 h-8 p-0 rounded-lg"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate leading-tight">{project.name}</p>
              {project.client && (
                <p className="text-xs text-slate-400 truncate leading-tight">{project.client}</p>
              )}
            </div>
          </div>

          {/* Center: wall counter */}
          <div className="hidden sm:flex flex-col items-center flex-shrink-0">
            <span className="text-xs font-medium text-slate-400 tracking-widest uppercase">Walls</span>
            <span className="text-sm font-semibold text-slate-700">{sorted.length}</span>
          </div>

          {/* Right: summary pills */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {liked > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-100">
                <ThumbsUp className="w-3 h-3" />
                {liked} liked
              </span>
            )}
            {disliked > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-600 text-xs font-medium border border-rose-100">
                <ThumbsDown className="w-3 h-3" />
                {disliked} disliked
              </span>
            )}
            {pending > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-xs font-medium border border-slate-200">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
                {pending} pending
              </span>
            )}
          </div>

        </div>
      </header>

      {/* ── Wall cards ──────────────────────────────────────────────────────── */}
      <main className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        {sorted.map((wall, index) => (
          <WallCardPresent
            key={wall.id}
            wall={wall}
            projectId={projectId}
            wallIndex={index}
            totalWalls={sorted.length}
            onFeedback={handleFeedback}
          />
        ))}

        {/* Footer spacer */}
        <div className="pt-8 pb-4 text-center">
          <p className="text-xs text-slate-300 tracking-wide">Wall Studio</p>
        </div>
      </main>

    </div>
  );
}
