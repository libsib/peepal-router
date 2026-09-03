/** Isolates the static-cache effect: static-only vs param-only vs miss-only. */
import { TrieRouter } from '../../src/router';
import { performance } from 'perf_hooks';
import { existsSync } from 'fs';

const ITERATIONS = Number(process.env.ITERATIONS ?? 1_000_000);
const WARMUP = 10_000;

const BASELINE_PATH = new URL('../baseline/router.ts', import.meta.url);
let Baseline: any = null;
if (existsSync(BASELINE_PATH)) ({ TrieRouter: Baseline } = await import('../baseline/router.ts'));

function mockMiddleware() {}
function mockHandler() {}

// same routing table as peepal-bench.ts
function seed(router: any): void {
  router.pushMiddleware('/', mockMiddleware);
  router.pushMiddleware('/api', mockMiddleware);
  router.pushMiddleware('/api/v1', mockMiddleware);
  for (let i = 0; i < 500; i++) {
    if (i % 10 === 0) {
      router.pushMiddleware(`/api/v1/resource${i}`, mockMiddleware);
      router.pushMiddleware(`/api/v1/resource${i}/:id`, mockMiddleware);
    }
    router.add('GET', `/api/v1/resource${i}`, mockHandler);
    router.add('GET', `/api/v1/resource${i}/:id`, mockHandler);
    router.add('POST', `/api/v1/resource${i}/:id/action`, mockHandler);
    router.add('DELETE', `/api/v1/resource${i}/:id/action/:subId`, mockHandler);
  }
}

const MIXES: Record<string, string[]> = {
  'static only  (cache hit)': [],
  'param only   (cache miss)': [],
  'unknown path (cache miss)': ['/api/v1/missing/route/entirely', '/static/images/notfound.png', '/a/b/c/d/e'],
};
for (let i = 0; i < 500; i++) {
  if (i % 25 === 0) {
    MIXES['static only  (cache hit)']!.push(`/api/v1/resource${i}`);
    MIXES['param only   (cache miss)']!.push(`/api/v1/resource${i}/999`);
    MIXES['param only   (cache miss)']!.push(`/api/v1/resource${i}/999/action`);
  }
}

const cur = new TrieRouter(); seed(cur);
const base = Baseline ? (() => { const b = new Baseline(); seed(b); return b; })() : null;

// `sink` is consumed after the loop so the engine cannot elide the lookup.
let sink = 0;
function run(router: any, paths: string[]): number {
  const n = paths.length;
  for (let i = 0; i < WARMUP; i++) {
    const r = router.search('GET', paths[i % n]!);
    if (r.handler !== undefined) sink++;
    sink += r.middlewares.length;
  }
  const t0 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const r = router.search('GET', paths[i % n]!);
    if (r.handler !== undefined) sink++;
    sink += r.middlewares.length;
  }
  const ms = performance.now() - t0;
  return ms;
}

console.log(`search() | 500 resources | ${ITERATIONS.toLocaleString()} iterations each\n`);
console.log('mix'.padEnd(27) + 'working tree'.padStart(16) + 'baseline'.padStart(16) + '   delta');
for (const [label, paths] of Object.entries(MIXES)) {
  // alternate order and take the best of 3 for each side, to blunt JIT/GC drift
  let a = Infinity, b = Infinity;
  for (let rep = 0; rep < 3; rep++) {
    if (rep % 2 === 0) { a = Math.min(a, run(cur, paths)); if (base) b = Math.min(b, run(base, paths)); }
    else { if (base) b = Math.min(b, run(base, paths)); a = Math.min(a, run(cur, paths)); }
  }
  const aOps = ITERATIONS / (a / 1000), bOps = ITERATIONS / (b / 1000);
  const pct = ((aOps / bOps - 1) * 100);
  console.log(
    label.padEnd(27) +
    `${Math.floor(aOps).toLocaleString()} ops`.padStart(16) +
    `${Math.floor(bOps).toLocaleString()} ops`.padStart(16) +
    `   ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
  );
}
if (sink === -1) console.log('unreachable');
