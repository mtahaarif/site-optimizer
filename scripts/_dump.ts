import { runAudit } from '../src/crawler/audit.ts';
const report = await runAudit({ startUrl: process.argv[2]!, maxPages: 30 }, () => {});
const out = 'C:/Users/tahaa/AppData/Local/Temp/claude/d--Work-SiteChecker/adf9f2a8-44af-4ccc-bf51-7db798f4241c/scratchpad/report.json';
(await import('node:fs')).writeFileSync(out, JSON.stringify(report, null, 2));
console.log('SCORE', report.score, '| pages', report.counts.htmlPages,
  '| failed', report.counts.checksFailed, '|', JSON.stringify(report.severity));
