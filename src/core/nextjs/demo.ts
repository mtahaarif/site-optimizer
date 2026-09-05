/**
 * Live smoke test: fingerprint real deployed Next.js sites.
 *   node packages/core/src/nextjs/demo.ts [url ...]
 */
import { fingerprintNext, countUnresolvedSuspense, type RawResponse } from './detect.ts';

const TARGETS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['https://nextjs.org', 'https://vercel.com', 'https://ui.shadcn.com'];

async function grab(url: string): Promise<RawResponse> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; SiteCheckerBot/0.1)' },
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { url: res.url, status: res.status, headers, html: await res.text() };
}

const kb = (n: number) => (n / 1024).toFixed(1) + ' KB';

for (const target of TARGETS) {
  try {
    const raw = await grab(target);
    const fp = fingerprintNext(raw);

    console.log('\n' + '='.repeat(74));
    console.log(target + '  ->  ' + raw.status + '  (' + kb(raw.html.length) + ' HTML)');
    console.log('='.repeat(74));
    console.log('  next.js      :', fp.isNext ? 'yes' : 'no');
    console.log('  router       :', fp.router);
    console.log('  buildId      :', fp.buildId ?? '-');
    console.log('  strategy     :', fp.strategy.toUpperCase());
    for (const e of fp.strategyEvidence) console.log('      evidence :', e);
    console.log('  cache        :', JSON.stringify(fp.cache));

    if (fp.flight) {
      console.log('  RSC flight   :', fp.flight.chunkCount + ' chunks, ' + kb(fp.flight.bytes) +
        ' (' + ((fp.flight.bytes / raw.html.length) * 100).toFixed(0) + '% of HTML)' +
        (fp.flight.hasUnresolvedSuspense
          ? '  [' + countUnresolvedSuspense(raw.html) + ' UNRESOLVED Suspense]'
          : '  [all boundaries resolved]'));
    }
    if (fp.pagesData) console.log('  __NEXT_DATA__:', JSON.stringify(fp.pagesData));

    const nextImgs = fp.images.filter((i) => i.isNextImage);
    console.log('  images       :', fp.images.length + ' total, ' + nextImgs.length + ' via next/image');
    for (const img of fp.images.slice(0, 3)) {
      console.log('      - ' + (img.isNextImage ? 'next/image' : 'raw <img>  ') +
        ' loading=' + (img.loading ?? '-') +
        ' fetchpriority=' + (img.fetchPriority ?? '-') +
        ' sizes=' + (img.sizes ? 'yes' : 'no') +
        ' dims=' + (img.width && img.height ? img.width + 'x' + img.height : 'MISSING') +
        ' preloaded=' + img.preloaded);
    }

    console.log('  fonts        : ' + fp.fonts.selfHostedFiles.length + ' self-hosted, ' +
      fp.fonts.externalStylesheets.length + ' external blocking, ' +
      fp.fonts.selfHostedClasses.length + ' next/font classes');
    console.log('  middleware   :', JSON.stringify(fp.middleware));
    console.log('  route JS     :', fp.routeScripts.length + ' chunks');
    if (fp.blockingScripts.length) console.log('  BLOCKING JS  :', fp.blockingScripts.length, fp.blockingScripts.slice(0, 2));
  } catch (err) {
    console.log('\n' + target + '  -> FAILED: ' + (err as Error).message);
  }
}
