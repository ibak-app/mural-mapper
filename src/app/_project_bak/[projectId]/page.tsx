'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Upload,
  Layout,
  Paintbrush,
  Presentation,
  FileDown,
  Plus,
  Trash2,
  Loader2,
} from 'lucide-react';
import { useProjectStore } from '@/stores/project-store';
import { GalleryGrid } from '@/components/gallery/gallery-grid';
import { ProjectInfoSection } from '@/components/project/project-info-section';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ─── Workflow Stepper ─────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Upload', desc: 'Add wall photos', icon: Upload },
  { label: 'Arrange', desc: 'Order your walls', icon: Layout },
  { label: 'Edit', desc: 'Apply designs', icon: Paintbrush },
  { label: 'Present', desc: 'Share with client', icon: Presentation },
];

function WorkflowStepper({ activeStep }: { activeStep: number }) {
  return (
    <div className="flex items-center">
      {STEPS.map((step, i) => {
        const isActive = i === activeStep;
        const isDone = i < activeStep;
        const isLast = i === STEPS.length - 1;

        return (
          <div key={step.label} className="flex items-center">
            <div className="flex items-center gap-2 px-2 py-1.5">
              {/* Circle indicator */}
              <div
                className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all',
                  isDone
                    ? 'bg-indigo-600 text-white'
                    : isActive
                    ? 'bg-indigo-600 text-white ring-2 ring-indigo-200 ring-offset-1'
                    : 'bg-slate-100 text-slate-400',
                )}
              >
                {isDone ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path
                      d="M2 5l2.5 2.5L8 3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>

              {/* Label */}
              <div className="hidden sm:block">
                <div
                  className={cn(
                    'text-xs font-semibold leading-none',
                    isActive ? 'text-indigo-700' : isDone ? 'text-slate-600' : 'text-slate-400',
                  )}
                >
                  {step.label}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-none">{step.desc}</div>
              </div>
            </div>

            {!isLast && (
              <div
                className={cn(
                  'h-px w-5 mx-0.5 shrink-0 transition-colors',
                  i < activeStep ? 'bg-indigo-400' : 'bg-slate-200',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  onBack,
  projectName,
}: {
  onBack: () => void;
  projectName: string;
}) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-slate-400">
      <button
        onClick={onBack}
        className="hover:text-indigo-600 transition-colors flex items-center gap-1 font-medium"
      >
        <ArrowLeft className="w-3 h-3" />
        Projects
      </button>
      <span className="text-slate-300">/</span>
      <span className="text-slate-600 font-semibold truncate max-w-[180px]">{projectName}</span>
    </nav>
  );
}

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafbfc]" style={{ colorScheme: 'light' }}>
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
        <span className="text-sm">Loading project…</span>
      </div>
    </div>
  );
}

// ─── Project Page ─────────────────────────────────────────────────────────────

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const {
    project,
    loading,
    loadProject,
    updateProject,
    addWall,
    removeWall,
    updateWall,
    reorderWalls,
  } = useProjectStore();
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  const handleDeleteProject = async () => {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    setDeleting(true);
    await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    router.push('/');
  };

  const handleAddWalls = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        await addWall(file, file.name.replace(/\.[^.]+$/, ''));
      }
    },
    [addWall],
  );

  const handleEditWall = (wallId: string) => {
    router.push(`/project/${projectId}/edit/${wallId}`);
  };

  // Derive active workflow step from project state
  const activeStep = (() => {
    if (!project) return 0;
    if (project.walls.length === 0) return 0;
    const hasDesigns = project.walls.some((w) => w.mockups.length > 0);
    if (!hasDesigns) return 1;
    const hasFeedback = project.walls.some((w) =>
      w.mockups.some((m) => m.feedback?.status !== 'none'),
    );
    return hasFeedback ? 3 : 2;
  })();

  if (loading || !project) return <LoadingState />;

  return (
    <div className="min-h-screen pb-24 bg-[#fafbfc]" style={{ colorScheme: 'light' }}>

      {/* Top header bar */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-sm border-b border-slate-100 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <Breadcrumb
            onBack={() => router.push('/')}
            projectName={project.name}
          />
          <WorkflowStepper activeStep={activeStep} />
        </div>
      </div>

      {/* Page body */}
      <div className="max-w-6xl mx-auto px-6">

        {/* Project info section */}
        <div className="pt-8 pb-6 border-b border-slate-100">
          <ProjectInfoSection project={project} onUpdate={updateProject} />
        </div>

        {/* Gallery section */}
        <section className="pt-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-bold text-slate-800">Wall Photos</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {project.walls.length === 0
                  ? 'No photos yet — upload some below'
                  : `${project.walls.length} photo${project.walls.length !== 1 ? 's' : ''}`}
              </p>
            </div>

            {project.walls.length > 0 && (
              <span className="text-[11px] text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full font-medium">
                Drag to reorder
              </span>
            )}
          </div>

          <GalleryGrid
            walls={project.walls}
            projectId={projectId}
            onAddWalls={handleAddWalls}
            onRemoveWall={removeWall}
            onRenameWall={(wallId, name) => updateWall(wallId, { name })}
            onEditWall={handleEditWall}
            onReorder={reorderWalls}
          />
        </section>
      </div>

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-sm border-t border-slate-100 shadow-[0_-1px_16px_rgba(0,0,0,0.06)]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          {/* Left: delete */}
          <Button
            variant="ghost"
            size="sm"
            icon={deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            onClick={handleDeleteProject}
            disabled={deleting}
            className="text-slate-400 hover:text-red-500 hover:bg-red-50"
          >
            {deleting ? 'Deleting…' : 'Delete project'}
          </Button>

          {/* Right: main actions */}
          <div className="flex items-center gap-2.5">
            <Button
              variant="secondary"
              size="sm"
              icon={<FileDown className="w-3.5 h-3.5" />}
              onClick={() => router.push(`/project/${projectId}/export`)}
            >
              Export PDF
            </Button>

            <Button
              variant="primary"
              size="sm"
              icon={<Presentation className="w-3.5 h-3.5" />}
              onClick={() => router.push(`/project/${projectId}/present`)}
            >
              Present to Client
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
