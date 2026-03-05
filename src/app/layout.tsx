import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mural Mapper — Wall Studio',
  description: 'Map artwork onto walls with perspective correction, light matching, and realistic compositing.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ colorScheme: 'light' }}>
      <body className="font-[Inter,system-ui,-apple-system,sans-serif] antialiased">

        {/* Top accent bar */}
        <div
          aria-hidden="true"
          className="fixed top-0 left-0 right-0 h-[2px] z-[9999]"
          style={{ background: 'linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #a855f7 100%)' }}
        />

        {/* Top nav */}
        <header className="fixed top-[2px] left-0 right-0 h-[52px] z-[1000] flex items-center justify-between px-6 border-b border-[var(--border-default)] shadow-xs glass">
          <a href="/" className="flex items-center gap-2.5 no-underline select-none">
            <div className="w-[30px] h-[30px] rounded-lg gradient-primary flex items-center justify-center shrink-0 shadow-[0_2px_8px_rgba(79,70,229,0.35)]">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="5.5" height="5.5" rx="1.5" fill="white" opacity="0.9" />
                <rect x="8.5" y="2" width="5.5" height="5.5" rx="1.5" fill="white" opacity="0.6" />
                <rect x="2" y="8.5" width="5.5" height="5.5" rx="1.5" fill="white" opacity="0.6" />
                <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5" fill="white" opacity="0.9" />
              </svg>
            </div>
            <span className="text-[15px] font-bold tracking-tight text-[var(--text-primary)]">
              Mural Mapper
            </span>
          </a>
        </header>

        <main className="pt-[54px] min-h-screen bg-[var(--bg-base)]">
          {children}
        </main>

      </body>
    </html>
  );
}
