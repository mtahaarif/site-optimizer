'use client';

import { useState } from 'react';

/** Generated llms.txt with copy / download — the same generate-and-apply pattern as the robots manager. */
export function LlmsFile({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={async () => {
            try { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ }
          }}
          className="border border-ink bg-ink px-4 py-1.5 text-[12.5px] font-medium text-ground transition-opacity hover:opacity-90">
          {copied ? 'Copied' : 'Copy file'}
        </button>
        <button
          onClick={() => {
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'llms.txt'; a.click();
            URL.revokeObjectURL(url);
          }}
          className="border border-line px-4 py-1.5 text-[12.5px] text-muted transition-colors hover:border-ink hover:text-ink">
          Download
        </button>
      </div>
      {/* Names the directory, not just the URL. "The root of your site" reads as
          the project root, where the file is not served by any framework — the
          most common way this ends up returning 404 after being generated. */}
      <p className="mt-2 text-[12px] leading-relaxed text-muted">
        It has to be served at <span className="font-mono text-ink">/llms.txt</span>. On Next.js
        that means saving it as <span className="font-mono text-ink">public/llms.txt</span> —
        a file in the project root is not served. On Astro or Vite use{' '}
        <span className="font-mono text-ink">public/</span> too; on a plain static host, the
        directory you deploy.
      </p>
      <pre className="scroll-x mt-3 max-h-[320px] overflow-y-auto border border-line bg-ground p-3 font-mono text-[11.5px] leading-relaxed text-ink">
{content}
      </pre>
    </div>
  );
}
