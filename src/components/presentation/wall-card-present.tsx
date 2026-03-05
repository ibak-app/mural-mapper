

import { useState } from 'react';
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider';
import { ThumbsUp, ThumbsDown, MessageSquare } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Wall, FeedbackStatus } from '@/lib/types';

interface WallCardPresentProps {
  wall: Wall;
  projectId: string;
  wallIndex: number;
  totalWalls: number;
  onFeedback: (wallId: string, mockupId: string, status: FeedbackStatus, comment: string) => void;
}

const STATUS_DOT: Record<FeedbackStatus | 'none', string> = {
  none: 'bg-slate-300',
  liked: 'bg-emerald-500',
  disliked: 'bg-rose-500',
};

const STATUS_BADGE: Record<'liked' | 'disliked', string> = {
  liked: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  disliked: 'bg-rose-50 text-rose-600 border border-rose-100',
};

/** Renders the before/after compare slider when a render is available,
 *  or falls back to showing just the original wall photo. */
function WallImage({
  projectId,
  wallId,
  mockupId,
  wallName,
  mockupName,
}: {
  projectId: string;
  wallId: string;
  mockupId: string;
  wallName: string;
  mockupName: string;
}) {
  const [renderFailed, setRenderFailed] = useState(false);

  const originalSrc = `/api/projects/${projectId}/walls/${wallId}/image`;
  const renderSrc = `/api/projects/${projectId}/walls/${wallId}/mockups/${mockupId}/render`;

  if (renderFailed) {
    // Render 404'd or errored — show original only
    return (
      <img
        src={originalSrc}
        alt={`${wallName} — ${mockupName} (original)`}
        className="max-w-full max-h-[520px] w-auto object-contain rounded-xl shadow-md"
      />
    );
  }

  return (
    <>
      {/* Hidden img used purely to detect 404 on the render URL */}
      <img
        src={renderSrc}
        alt=""
        aria-hidden
        className="hidden"
        onError={() => setRenderFailed(true)}
      />

      {/* Only show the compare slider if render hasn't failed yet */}
      {!renderFailed && (
        <div className="w-full max-h-[520px] rounded-xl overflow-hidden shadow-md">
          <ReactCompareSlider
            style={{ width: '100%', maxHeight: '520px' }}
            itemOne={
              <ReactCompareSliderImage
                src={originalSrc}
                alt={`${wallName} — original`}
              />
            }
            itemTwo={
              <ReactCompareSliderImage
                src={renderSrc}
                alt={`${wallName} — ${mockupName} mockup`}
                onError={() => setRenderFailed(true)}
              />
            }
          />
        </div>
      )}
    </>
  );
}

export function WallCardPresent({
  wall,
  projectId,
  wallIndex,
  totalWalls,
  onFeedback,
}: WallCardPresentProps) {
  const [activeTab, setActiveTab] = useState(0);

  const mockup = wall.mockups[activeTab];

  if (!mockup) {
    return (
      <Card className="p-10 text-center text-slate-400 text-sm">
        No mockups for this wall.
      </Card>
    );
  }

  const feedback = mockup.feedback ?? { status: 'none' as FeedbackStatus, comment: '' };
  const isLiked = feedback.status === 'liked';
  const isDisliked = feedback.status === 'disliked';

  return (
    <Card className="overflow-hidden">

      {/* ── Card header ──────────────────────────────────────────────────── */}
      <header className="px-7 pt-6 pb-4 flex items-start justify-between gap-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          {/* Wall index badge */}
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold flex items-center justify-center select-none border border-indigo-100">
            {wallIndex + 1}
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900 leading-tight">{wall.name}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {wall.mockups.length} variant{wall.mockups.length !== 1 ? 's' : ''}
              {' · '}{totalWalls} walls total
            </p>
          </div>
        </div>

        {/* Status dots for all mockups */}
        <div className="flex items-center gap-1.5 pt-1 flex-shrink-0">
          {wall.mockups.map((m) => {
            const st = m.feedback?.status ?? 'none';
            return (
              <span
                key={m.id}
                className={cn('w-2.5 h-2.5 rounded-full transition-colors', STATUS_DOT[st])}
                title={`${m.name}: ${st}`}
              />
            );
          })}
        </div>
      </header>

      {/* ── Mockup tabs (only when multiple) ─────────────────────────────── */}
      {wall.mockups.length > 1 && (
        <div className="px-7 bg-slate-50/60 border-b border-slate-100">
          <div className="flex gap-0 -mb-px overflow-x-auto">
            {wall.mockups.map((m, i) => {
              const st = m.feedback?.status ?? 'none';
              const isActive = activeTab === i;
              return (
                <button
                  key={m.id}
                  onClick={() => setActiveTab(i)}
                  className={cn(
                    'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap',
                    'transition-colors border-b-2',
                    isActive
                      ? 'text-indigo-600 border-indigo-600 bg-white'
                      : 'text-slate-500 border-transparent hover:text-slate-700 hover:border-slate-300',
                  )}
                >
                  <span
                    className={cn('w-2 h-2 rounded-full flex-shrink-0 transition-colors', STATUS_DOT[st])}
                  />
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Wall image / before-after slider ─────────────────────────────── */}
      <div className="px-7 py-6 bg-slate-50/60 flex items-center justify-center min-h-[260px]">
        <WallImage
          key={`${wall.id}-${activeTab}`}
          projectId={projectId}
          wallId={wall.id}
          mockupId={mockup.id}
          wallName={wall.name}
          mockupName={mockup.name}
        />
      </div>

      {/* ── Feedback section ─────────────────────────────────────────────── */}
      <div className="px-7 py-5 border-t border-slate-100 space-y-4">

        {/* Mockup label + status badge + action buttons */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {mockup.name}
            </span>
            {feedback.status !== 'none' && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
                  STATUS_BADGE[feedback.status as 'liked' | 'disliked'],
                )}
              >
                {isLiked ? (
                  <ThumbsUp className="w-3 h-3" />
                ) : (
                  <ThumbsDown className="w-3 h-3" />
                )}
                {isLiked ? 'Liked' : 'Disliked'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">

            {/* Like button */}
            <button
              onClick={() =>
                onFeedback(
                  wall.id,
                  mockup.id,
                  isLiked ? 'none' : 'liked',
                  feedback.comment ?? ''
                )
              }
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all',
                isLiked
                  ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-200'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50',
              )}
            >
              <ThumbsUp className="w-4 h-4 flex-shrink-0" />
              Like
            </button>

            {/* Dislike button */}
            <button
              onClick={() =>
                onFeedback(
                  wall.id,
                  mockup.id,
                  isDisliked ? 'none' : 'disliked',
                  feedback.comment ?? ''
                )
              }
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all',
                isDisliked
                  ? 'bg-rose-500 border-rose-500 text-white shadow-sm shadow-rose-200'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-rose-400 hover:text-rose-600 hover:bg-rose-50',
              )}
            >
              <ThumbsDown className="w-4 h-4 flex-shrink-0" />
              Dislike
            </button>

          </div>
        </div>

        {/* Comment textarea */}
        <div className="relative">
          <div className="absolute left-3 top-3 text-slate-300 pointer-events-none">
            <MessageSquare className="w-4 h-4" />
          </div>
          <textarea
            className={cn(
              'w-full text-sm text-slate-700 placeholder-slate-400',
              'bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-3 resize-none',
              'focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400',
              'transition-all',
            )}
            rows={2}
            placeholder="Add a comment or note for this variant…"
            value={feedback.comment ?? ''}
            onChange={(e) =>
              onFeedback(wall.id, mockup.id, feedback.status, e.target.value)
            }
          />
        </div>

      </div>

    </Card>
  );
}
