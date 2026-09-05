'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuditReport } from '@/src/crawler/audit.ts';
import { scoreBand, shortUrl } from '../../ui.tsx';

/**
 * Site Visualization — the internal link graph we already build for PageRank,
 * rendered as a force-directed map. Node size = PageRank (importance), colour =
 * page score, orphans ringed. Everything here is a view over data the crawl
 * already produced; only the canvas is new.
 */

type Node = {
  i: number; url: string; title: string | null;
  r: number; score: number; pageRank: number; inDegree: number;
  x: number; y: number; vx: number; vy: number;
};

const MAX_NODES = 300;

export function SiteGraph({ report }: { report: AuditReport }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ node: Node; sx: number; sy: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0); // bumped on pan/zoom to force a redraw

  // Build nodes (top MAX_NODES by PageRank) and the edges among them.
  const { nodes, edges } = useMemo(() => {
    const html = report.pages.filter((p) => p.isHtml);
    const ranked = [...html].sort((a, b) => b.pageRank - a.pageRank).slice(0, MAX_NODES);
    const keep = new Map(ranked.map((p, idx) => [report.pages.indexOf(p), idx]));
    const ns: Node[] = ranked.map((p, idx) => ({
      i: idx, url: p.url, title: p.title,
      r: 3 + Math.sqrt(Math.max(0, p.pageRank)) * 13,
      score: p.score, pageRank: p.pageRank, inDegree: p.inDegree ?? 0,
      x: Math.cos((idx / ranked.length) * Math.PI * 2) * 260,
      y: Math.sin((idx / ranked.length) * Math.PI * 2) * 260,
      vx: 0, vy: 0,
    }));
    const es: Array<[number, number]> = [];
    for (const [from, to] of report.graph?.edges ?? []) {
      const a = keep.get(from); const b = keep.get(to);
      if (a !== undefined && b !== undefined && a !== b) es.push([a, b]);
    }
    return { nodes: ns, edges: es };
  }, [report]);

  // Force layout — bounded synchronous relaxation, then freeze.
  useEffect(() => {
    if (nodes.length === 0) return;
    const adj = edges;
    const ITER = 160;
    const k = 90; // ideal spring length
    for (let step = 0; step < ITER; step++) {
      // repulsion (O(n^2), fine at <=300 nodes)
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const na = nodes[a]!, nb = nodes[b]!;
          let dx = na.x - nb.x, dy = na.y - nb.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.01; }
          const force = 2600 / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * force, fy = (dy / d) * force;
          na.vx += fx; na.vy += fy; nb.vx -= fx; nb.vy -= fy;
        }
      }
      // springs
      for (const [a, b] of adj) {
        const na = nodes[a]!, nb = nodes[b]!;
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const f = (d - k) * 0.02;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        na.vx += fx; na.vy += fy; nb.vx -= fx; nb.vy -= fy;
      }
      // gravity to center + integrate + damp
      for (const n of nodes) {
        n.vx += -n.x * 0.002; n.vy += -n.y * 0.002;
        n.x += n.vx * 0.85; n.y += n.vy * 0.85;
        n.vx *= 0.82; n.vy *= 0.82;
      }
    }
    setReady(true);
  }, [nodes, edges]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr; canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { scale, ox, oy } = viewRef.current;
      const cx = w / 2 + ox, cy = h / 2 + oy;
      const T = (n: Node) => ({ x: cx + n.x * scale, y: cy + n.y * scale });

      // Canvas cannot resolve CSS var(); read the live palette so the graph
      // repaints correctly in whichever theme is active.
      const cs = getComputedStyle(document.documentElement);
      const rgb = (name: string): [number, number, number] => {
        const parts = cs.getPropertyValue(name).trim().split(/\s+/).map(Number);
        return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
      };
      const css = (name: string) => { const [r, g, b] = rgb(name); return `rgb(${r},${g},${b})`; };
      const ink = rgb('--ink');
      const bandColor = (score: number) =>
        score >= 75 ? css('--accent') : score >= 50 ? css('--warning') : score >= 25 ? css('--critical') : css('--blocker');

      // edges
      ctx.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},0.12)`;
      ctx.lineWidth = 1;
      for (const [a, b] of edges) {
        const pa = T(nodes[a]!), pb = T(nodes[b]!);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
      // nodes
      for (const n of nodes) {
        const p = T(n);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2, n.r * scale), 0, Math.PI * 2);
        ctx.fillStyle = bandColor(n.score);
        ctx.fill();
        if (n.inDegree === 0) { // orphan ring
          ctx.strokeStyle = css('--blocker');
          ctx.lineWidth = 2; ctx.stroke();
        }
        if (hover && hover.node.i === n.i) {
          ctx.strokeStyle = css('--ink');
          ctx.lineWidth = 2; ctx.stroke();
        }
      }
    };
    draw();
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    window.addEventListener('themechange', draw);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('themechange', draw);
    };
  }, [nodes, edges, ready, hover, tick]);

  // Interaction: pan, wheel-zoom, hover.
  function toWorld(clientX: number, clientY: number) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const { scale, ox, oy } = viewRef.current;
    const cx = rect.width / 2 + ox, cy = rect.height / 2 + oy;
    return { x: (clientX - rect.left - cx) / scale, y: (clientY - rect.top - cy) / scale, sx: clientX - rect.left, sy: clientY - rect.top };
  }
  function nearest(wx: number, wy: number): Node | null {
    let best: Node | null = null, bd = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d < bd && d < (n.r + 6) / viewRef.current.scale) { bd = d; best = n; }
    }
    return best;
  }


  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-[13px] leading-relaxed text-muted">
          {nodes.length} pages · {edges.length} internal links. Node size is PageRank importance,
          colour is the page score, a <span className="text-blocker">red ring</span> marks an orphan
          (no internal links point to it). Drag to pan, scroll to zoom.
        </p>
        <button
          onClick={() => { viewRef.current = { scale: 1, ox: 0, oy: 0 }; setTick((t) => t + 1); }}
          className="border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:border-ink hover:text-ink"
        >
          Reset view
        </button>
      </div>

      <div className="relative border border-line bg-surface">
        <canvas
          ref={canvasRef}
          className="block h-[560px] w-full cursor-grab touch-none"
          onMouseDown={(e) => { dragRef.current = { x: e.clientX, y: e.clientY }; }}
          onMouseUp={() => { dragRef.current = null; }}
          onMouseLeave={() => { dragRef.current = null; setHover(null); }}
          onMouseMove={(e) => {
            if (dragRef.current) {
              viewRef.current.ox += e.clientX - dragRef.current.x;
              viewRef.current.oy += e.clientY - dragRef.current.y;
              dragRef.current = { x: e.clientX, y: e.clientY };
              setTick((t) => t + 1);
              return;
            }
            const w = toWorld(e.clientX, e.clientY);
            const n = nearest(w.x, w.y);
            setHover(n ? { node: n, sx: w.sx, sy: w.sy } : null);
          }}
          onWheel={(e) => {
            const factor = e.deltaY < 0 ? 1.1 : 0.9;
            viewRef.current.scale = Math.min(4, Math.max(0.2, viewRef.current.scale * factor));
            setTick((t) => t + 1);
          }}
        />
        {hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-[280px] border border-ink bg-surface p-2.5"
            style={{ left: Math.min(hover.sx + 12, 9999), top: hover.sy + 12 }}
          >
            <div className="truncate font-mono text-[11px] text-ink">{shortUrl(hover.node.url, 44)}</div>
            {hover.node.title && <div className="mt-0.5 truncate text-[12px] text-muted">{hover.node.title}</div>}
            <div className="mt-1.5 flex gap-3 font-mono text-[10px] text-muted">
              <span>score <span className="text-ink" style={{ color: scoreBand(hover.node.score).color }}>{hover.node.score.toFixed(0)}</span></span>
              <span>PR <span className="text-ink">{hover.node.pageRank.toFixed(3)}</span></span>
              <span>in <span className="text-ink">{hover.node.inDegree}</span></span>
            </div>
          </div>
        )}
        {nodes.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-[13px] text-muted">
            No link graph — re-run the audit to build it.
          </div>
        )}
      </div>
    </div>
  );
}
