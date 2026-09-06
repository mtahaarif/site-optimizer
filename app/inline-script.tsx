/**
 * An inline script that runs while the browser parses the HTML.
 *
 * Used for the one thing React cannot do in time: correcting the DOM *before*
 * the first paint, from a source only the browser has (here, the saved theme in
 * localStorage). React itself has not loaded yet at that point, so no component
 * — client or server — can do this job.
 *
 * The `type` swap is the part that is not obvious. React warns in development
 * whenever rendering produces a `<script>` tag, because scripts created by React
 * on the client are never executed: on a soft navigation the browser would
 * insert a dead tag. Rendering it as `text/plain` on the client makes that
 * explicit and silences the warning, while the server still emits a real
 * `text/javascript` tag that runs during parsing. `suppressHydrationWarning`
 * covers the resulting type mismatch.
 *
 * This is the pattern the framework documents for exactly this problem — see
 * node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
