/**
 * Internal PageRank over the crawled link graph.
 *
 * Supplies page importance when Search Console is not connected, and sharpens it
 * when it is. It also produces two findings no meta-tag checker can: which pages
 * the site's own architecture starves of link equity, and which pages are
 * orphaned outright.
 */

export interface LinkGraph {
  /** every internal URL discovered, canonicalised */
  nodes: string[];
  /** followed internal edges, from -> to; nofollow links are excluded upstream */
  edges: Array<[from: string, to: string]>;
}

export interface PageRankResult {
  /** url -> rank, normalised so the maximum is 1 */
  rank: Map<string, number>;
  /** url -> count of distinct internal pages linking to it */
  inDegree: Map<string, number>;
  /** reachable from no other page — invisible to crawlers following links */
  orphans: string[];
  iterations: number;
  converged: boolean;
}

const DAMPING = 0.85;

export function computePageRank(
  graph: LinkGraph,
  opts: { maxIterations?: number; tolerance?: number } = {},
): PageRankResult {
  const maxIterations = opts.maxIterations ?? 100;
  const tolerance = opts.tolerance ?? 1e-6;

  const nodes = [...new Set(graph.nodes)];
  const n = nodes.length;
  const index = new Map(nodes.map((u, i) => [u, i]));

  if (n === 0) {
    return { rank: new Map(), inDegree: new Map(), orphans: [], iterations: 0, converged: true };
  }

  const outLinks: number[][] = Array.from({ length: n }, () => []);
  const inDegreeSets: Array<Set<number>> = Array.from({ length: n }, () => new Set());

  for (const [from, to] of graph.edges) {
    const f = index.get(from);
    const t = index.get(to);
    if (f === undefined || t === undefined || f === t) continue; // ignore self-links
    outLinks[f]!.push(t);
    inDegreeSets[t]!.add(f);
  }

  let rank = new Array<number>(n).fill(1 / n);
  let iterations = 0;
  let converged = false;

  for (; iterations < maxIterations; iterations++) {
    const next = new Array<number>(n).fill((1 - DAMPING) / n);

    // Dangling nodes (no outgoing internal links) would leak rank out of the
    // system; redistribute their mass uniformly instead.
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (outLinks[i]!.length === 0) dangling += rank[i]!;
    }
    const danglingShare = (DAMPING * dangling) / n;

    for (let i = 0; i < n; i++) {
      const outs = outLinks[i]!;
      if (outs.length === 0) continue;
      const share = (DAMPING * rank[i]!) / outs.length;
      for (const t of outs) next[t]! += share;
    }
    for (let i = 0; i < n; i++) next[i]! += danglingShare;

    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(next[i]! - rank[i]!);
    rank = next;

    if (delta < tolerance) {
      converged = true;
      iterations++;
      break;
    }
  }

  const max = Math.max(...rank);
  const rankMap = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const orphans: string[] = [];

  for (let i = 0; i < n; i++) {
    const url = nodes[i]!;
    rankMap.set(url, max > 0 ? rank[i]! / max : 0);
    const deg = inDegreeSets[i]!.size;
    inDegree.set(url, deg);
    if (deg === 0) orphans.push(url);
  }

  return { rank: rankMap, inDegree, orphans, iterations, converged };
}
