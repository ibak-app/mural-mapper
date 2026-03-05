'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useProjectStore } from '@/stores/project-store';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { ArrowLeft, FileDown, Image, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ExportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { project, loading, loadProject } = useProjectStore();

  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [includeOriginals, setIncludeOriginals] = useState(true);
  const [includeMockups, setIncludeMockups] = useState(true);

  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  if (loading || !project) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-sm text-slate-400 tracking-wide">Loading project…</p>
        </div>
      </div>
    );
  }

  const sorted = [...project.walls].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const totalMockups = sorted.reduce((s, w) => s + w.mockups.length, 0);
  const liked = sorted.reduce(
    (s, w) => s + w.mockups.filter((m) => m.feedback?.status === 'liked').length,
    0
  );
  const disliked = sorted.reduce(
    (s, w) => s + w.mockups.filter((m) => m.feedback?.status === 'disliked').length,
    0
  );

  const generatePDF = async () => {
    setGenerating(true);
    setDone(false);
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      // ── Cover page ──────────────────────────────────────────────────────
      pdf.setFillColor(30, 41, 59);
      pdf.rect(0, 0, pageW, pageH, 'F');

      // Subtle accent strip
      pdf.setFillColor(79, 70, 229);
      pdf.rect(0, 0, 6, pageH, 'F');

      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(34);
      pdf.text(project.name, pageW / 2, pageH / 2 - 16, { align: 'center' });

      if (project.client) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(15);
        pdf.setTextColor(148, 163, 184);
        pdf.text(project.client, pageW / 2, pageH / 2 + 4, { align: 'center' });
      }

      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, pageW / 2, pageH / 2 + 18, { align: 'center' });
      pdf.text('Wall Studio', pageW / 2, pageH - 12, { align: 'center' });

      // ── Table of contents ───────────────────────────────────────────────
      pdf.addPage();
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pageW, pageH, 'F');

      pdf.setFillColor(248, 250, 252);
      pdf.rect(0, 0, pageW, 38, 'F');

      pdf.setTextColor(30, 41, 59);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(20);
      pdf.text('Table of Contents', 22, 24);

      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.4);
      pdf.line(0, 38, pageW, 38);

      pdf.setFontSize(10);
      let tocY = 54;
      let pageNum = 3;
      for (const wall of sorted) {
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(51, 65, 85);
        pdf.text(wall.name, 22, tocY);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`${wall.mockups.length} variant${wall.mockups.length !== 1 ? 's' : ''}`, 22, tocY + 5);
        pdf.setTextColor(100, 116, 139);
        pdf.text(`${pageNum}`, pageW - 22, tocY, { align: 'right' });
        pdf.setDrawColor(241, 245, 249);
        pdf.line(22, tocY + 9, pageW - 22, tocY + 9);
        tocY += 16;
        pageNum +=
          includeOriginals && includeMockups
            ? 1 + wall.mockups.length
            : includeOriginals
            ? 1
            : wall.mockups.length;
      }

      // ── Per-wall pages ──────────────────────────────────────────────────
      for (const wall of sorted) {
        if (includeOriginals) {
          pdf.addPage();
          pdf.setFillColor(248, 250, 252);
          pdf.rect(0, 0, pageW, pageH, 'F');

          pdf.setFillColor(255, 255, 255);
          pdf.rect(0, 0, pageW, 36, 'F');
          pdf.setDrawColor(226, 232, 240);
          pdf.line(0, 36, pageW, 36);

          pdf.setTextColor(30, 41, 59);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(14);
          pdf.text(wall.name, 20, 20);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(148, 163, 184);
          pdf.text('Original', 20, 29);

          try {
            const imgRes = await fetch(`/api/projects/${projectId}/walls/${wall.id}/image`);
            const imgBlob = await imgRes.blob();
            const imgData = await blobToDataURL(imgBlob);
            const maxW = pageW - 40;
            const maxH = pageH - 52;
            const ratio = Math.min(maxW / wall.width, maxH / wall.height);
            const imgW = wall.width * ratio;
            const imgH = wall.height * ratio;
            pdf.addImage(imgData, 'JPEG', (pageW - imgW) / 2, 42, imgW, imgH);
          } catch {
            pdf.setTextColor(148, 163, 184);
            pdf.text('(Image could not be loaded)', pageW / 2, pageH / 2, { align: 'center' });
          }
        }

        if (includeMockups) {
          for (const mockup of wall.mockups) {
            pdf.addPage();
            pdf.setFillColor(248, 250, 252);
            pdf.rect(0, 0, pageW, pageH, 'F');

            pdf.setFillColor(255, 255, 255);
            pdf.rect(0, 0, pageW, 36, 'F');
            pdf.setDrawColor(226, 232, 240);
            pdf.line(0, 36, pageW, 36);

            pdf.setTextColor(30, 41, 59);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(14);
            pdf.text(wall.name, 20, 20);

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(100, 116, 139);
            pdf.text(mockup.name, 20, 29);

            // Feedback badge
            const st = mockup.feedback?.status;
            if (st === 'liked' || st === 'disliked') {
              const badgeColor: [number, number, number] = st === 'liked' ? [16, 185, 129] : [244, 63, 94];
              pdf.setFillColor(...badgeColor);
              const badgeLabel = st === 'liked' ? 'LIKED' : 'DISLIKED';
              const badgeX = pageW - 22 - pdf.getStringUnitWidth(badgeLabel) * 9 * 0.352778 - 6;
              pdf.roundedRect(badgeX, 22, pdf.getStringUnitWidth(badgeLabel) * 9 * 0.352778 + 6, 10, 2, 2, 'F');
              pdf.setTextColor(255, 255, 255);
              pdf.setFontSize(8);
              pdf.text(badgeLabel, badgeX + 3, 29);
              pdf.setTextColor(100, 116, 139);
              pdf.setFontSize(9);
            }

            // Comment
            if (mockup.feedback?.comment) {
              pdf.setTextColor(71, 85, 105);
              pdf.setFontSize(8);
              pdf.text(`"${mockup.feedback.comment}"`, 20, pageH - 14);
            }

            try {
              // Use the render endpoint for mockup images
              const renderUrl = `/api/projects/${projectId}/walls/${wall.id}/mockups/${mockup.id}/render`;
              const imgRes = await fetch(renderUrl);
              if (!imgRes.ok) throw new Error('Render not available');
              const imgBlob = await imgRes.blob();
              const imgData = await blobToDataURL(imgBlob);
              const maxW = pageW - 40;
              const maxH = pageH - 52;
              const ratio = Math.min(maxW / wall.width, maxH / wall.height);
              const imgW = wall.width * ratio;
              const imgH = wall.height * ratio;
              pdf.addImage(imgData, 'PNG', (pageW - imgW) / 2, 42, imgW, imgH);
            } catch {
              // Fallback to original wall image
              try {
                const fallbackRes = await fetch(`/api/projects/${projectId}/walls/${wall.id}/image`);
                const fallbackBlob = await fallbackRes.blob();
                const fallbackData = await blobToDataURL(fallbackBlob);
                const maxW = pageW - 40;
                const maxH = pageH - 52;
                const ratio = Math.min(maxW / wall.width, maxH / wall.height);
                const imgW = wall.width * ratio;
                const imgH = wall.height * ratio;
                pdf.addImage(fallbackData, 'JPEG', (pageW - imgW) / 2, 42, imgW, imgH);
              } catch {
                pdf.setTextColor(148, 163, 184);
                pdf.text('(Mockup render not available)', pageW / 2, pageH / 2, { align: 'center' });
              }
            }
          }
        }
      }

      // ── Summary page ────────────────────────────────────────────────────
      pdf.addPage();
      pdf.setFillColor(30, 41, 59);
      pdf.rect(0, 0, pageW, pageH, 'F');

      pdf.setFillColor(79, 70, 229);
      pdf.rect(0, 0, 6, pageH, 'F');

      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(24);
      pdf.text('Feedback Summary', pageW / 2, 36, { align: 'center' });

      const stats: [string, string, [number, number, number]][] = [
        [`${sorted.length}`, 'Walls', [99, 102, 241]],
        [`${totalMockups}`, 'Variants', [148, 163, 184]],
        [`${liked}`, 'Liked', [16, 185, 129]],
        [`${disliked}`, 'Disliked', [244, 63, 94]],
      ];
      const boxW = (pageW - 60) / stats.length;
      stats.forEach(([num, label, color], i) => {
        const bx = 20 + i * (boxW + 8);
        const by = pageH / 2 - 24;
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(bx, by, boxW, 44, 4, 4, 'F');
        pdf.setFillColor(...color);
        pdf.roundedRect(bx, by, boxW, 4, 2, 2, 'F');
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(22);
        pdf.text(num, bx + boxW / 2, by + 22, { align: 'center' });
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(100, 116, 139);
        pdf.text(label, bx + boxW / 2, by + 34, { align: 'center' });
      });

      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text('Wall Studio', pageW / 2, pageH - 12, { align: 'center' });

      pdf.save(`${project.name.replace(/\s+/g, '_')}_mockups.pdf`);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      alert('Failed to generate PDF: ' + (err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const canGenerate = includeOriginals || includeMockups;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Top bar: frosted glass ───────────────────────────────────────────── */}
      <header className={cn(
        'sticky top-0 z-30 border-b border-slate-200/80',
        'backdrop-blur-xl backdrop-saturate-150 bg-white/85',
      )}>
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center gap-3">
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
            <p className="text-xs text-slate-400 leading-tight">Export</p>
          </div>
        </div>
      </header>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">

        {/* ── PDF Report card ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-5 border-b border-slate-100">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0 border border-indigo-100">
                <FileDown className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">PDF Report</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Generate a landscape A4 PDF with a cover page, table of contents, wall images, and a feedback summary.
                </p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 pt-5">

            {/* Options */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Include</p>

              {/* Original wall photos toggle */}
              <label className="flex items-center gap-3 group cursor-pointer select-none">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={includeOriginals}
                  onClick={() => setIncludeOriginals((v) => !v)}
                  className={cn(
                    'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all',
                    includeOriginals
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-slate-300 group-hover:border-slate-400 bg-white',
                  )}
                >
                  {includeOriginals && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </button>
                <span className="text-sm text-slate-700">Original wall photos</span>
              </label>

              {/* Mockup renders toggle */}
              <label className="flex items-center gap-3 group cursor-pointer select-none">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={includeMockups}
                  onClick={() => setIncludeMockups((v) => !v)}
                  className={cn(
                    'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all',
                    includeMockups
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-slate-300 group-hover:border-slate-400 bg-white',
                  )}
                >
                  {includeMockups && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </button>
                <span className="text-sm text-slate-700">Mockup renders with feedback</span>
              </label>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { value: sorted.length, label: 'Walls', valueClass: 'text-slate-700' },
                { value: totalMockups, label: 'Variants', valueClass: 'text-slate-700' },
                { value: liked, label: 'Liked', valueClass: 'text-emerald-600' },
                { value: disliked, label: 'Disliked', valueClass: 'text-rose-600' },
              ].map((stat) => (
                <div key={stat.label} className="bg-slate-50 rounded-xl px-4 py-3 text-center border border-slate-100">
                  <p className={cn('text-xl font-bold', stat.valueClass)}>{stat.value}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Generate button */}
            <button
              onClick={generatePDF}
              disabled={generating || !canGenerate}
              className={cn(
                'w-full flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl text-sm font-semibold transition-all',
                done
                  ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-200'
                  : generating || !canGenerate
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-200',
              )}
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating PDF…
                </>
              ) : done ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  PDF Downloaded
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  Download PDF
                </>
              )}
            </button>

          </CardContent>
        </Card>

        {/* ── Individual exports card ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-5 border-b border-slate-100">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 border border-slate-200">
                <Image className="w-5 h-5 text-slate-500" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Individual Downloads</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Download original photos and mockup renders.
                </p>
              </div>
            </div>
          </CardHeader>

          <div className="divide-y divide-slate-100">
            {sorted.map((wall) => (
              <div key={wall.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">{wall.name}</p>
                  <p className="text-xs text-slate-400">
                    {wall.mockups.length} variant{wall.mockups.length !== 1 ? 's' : ''}
                    {wall.width && wall.height ? ` · ${wall.width}×${wall.height}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <a
                    href={`/api/projects/${projectId}/walls/${wall.id}/image`}
                    download={`${wall.name.replace(/\s+/g, '_')}_original.jpg`}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
                      'border border-slate-200 text-slate-600',
                      'hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all',
                    )}
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    Original
                  </a>
                  {wall.mockups.map((m) => (
                    <a
                      key={m.id}
                      href={`/api/projects/${projectId}/walls/${wall.id}/mockups/${m.id}/render`}
                      download={`${wall.name.replace(/\s+/g, '_')}_${m.name.replace(/\s+/g, '_')}.png`}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
                        'border border-indigo-200 text-indigo-600 bg-indigo-50/50',
                        'hover:border-indigo-400 hover:bg-indigo-50 transition-all',
                      )}
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      {m.name}
                    </a>
                  ))}
                </div>
              </div>
            ))}

            {sorted.length === 0 && (
              <div className="px-7 py-10 text-center text-sm text-slate-400">
                No walls found in this project.
              </div>
            )}
          </div>
        </Card>

        <div className="pb-4 text-center">
          <p className="text-xs text-slate-300 tracking-wide">Wall Studio</p>
        </div>
      </main>
    </div>
  );
}
