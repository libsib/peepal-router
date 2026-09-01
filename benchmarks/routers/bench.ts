import { PeepalRouter, PeepalCompiledRouter } from './peepal';
import { PeepalRadixRouter } from './radix';
import { Rou3Router } from './rou3';
import { FindMyWayRouter } from './find-my-way';
import type { RouterInstance } from './interface';

// Configuration
const NUM_ROUTES = 3000;
const CATEGORY_ITERATIONS = 500_000;
const LATENCY_SAMPLES = 100_000;

const dummyHandler = () => "ok";

// Utilities

function forceGC(): void {
  if (global.gc) {
    global.gc();
  }
}

function getMemoryUsageMB(): number {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

function percentile(sorted: Float64Array, p: number): number {
  const idx = Math.floor(sorted.length * p);
  return sorted[idx]!;
}

// Route Generators

function makeRoutes(n: number): string[] {
  const routes: string[] = [];
  for (let i = 0; i < n; i++) {
    // Standard static and single parameter routes
    routes.push(`/api/users/${i}`);
    routes.push(`/api/posts/${i}/comments/:id`);

    // Deeply nested static routes
    routes.push(`/shop/categories/electronics/devices/mobile/products/${i}`);

    // Multiple consecutive parameters
    routes.push(`/flights/:departure/:destination/:date/seat/${i}`);

    // Wildcard / catch-all routes
    routes.push(`/cdn/${i}/assets/*`);
  }
  return routes;
}

type PathCategory = "static" | "param" | "wildcard" | "miss";

function makeLookupPathSets(n: number): Record<PathCategory, string[]> {
  const sets: Record<PathCategory, string[]> = {
    static: new Array(CATEGORY_ITERATIONS),
    param: new Array(CATEGORY_ITERATIONS),
    wildcard: new Array(CATEGORY_ITERATIONS),
    miss: new Array(CATEGORY_ITERATIONS),
  };

  for (let i = 0; i < CATEGORY_ITERATIONS; i++) {
    const id = (Math.random() * n) | 0;

    // alternate between the two static-route shapes registered above
    sets.static[i] = i % 2 === 0
      ? `/api/users/${id}`
      : `/shop/categories/electronics/devices/mobile/products/${id}`;

    // alternate between the two param-route shapes registered above
    sets.param[i] = i % 2 === 0
      ? `/api/posts/${id}/comments/999`
      : `/flights/JFK/LHR/20261201/seat/${id}`;

    sets.wildcard[i] = `/cdn/${id}/assets/some/deep/nested/path.js`;

    // intentional 404 misses to test worst case traversal
    sets.miss[i] = `/api/unknown/path/that/does/not/exist/${id}`;
  }

  return sets;
}

// Benchmark Stages

function benchmarkInsert(router: RouterInstance, routes: string[], name: string): void {
  forceGC();
  const memBefore = getMemoryUsageMB();

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < routes.length; i++) {
    router.add("GET", routes[i]!, dummyHandler);
  }
  const t1 = process.hrtime.bigint();

  const memAfter = getMemoryUsageMB();
  const ms = Number(t1 - t0) / 1_000_000;
  const memDelta = memAfter - memBefore;

  console.log(`${name} insert: ${ms.toFixed(2)} ms | Memory Delta: +${memDelta.toFixed(2)} MB`);
}

function benchmarkLookup(router: RouterInstance, paths: string[], name: string): void {
  // Warmup the JIT compiler
  const warmupCount = Math.min(100_000, paths.length);
  for (let i = 0; i < warmupCount; i++) {
    router.find("GET", paths[i]!);
  }

  forceGC();
  const t0 = process.hrtime.bigint();

  for (let i = 0; i < paths.length; i++) {
    router.find("GET", paths[i]!);
  }

  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1_000_000;
  const rps = (paths.length / (ms / 1000)).toFixed(0);

  console.log(`${name} lookup: ${ms.toFixed(2)} ms | RPS: ${rps}`);
}

function benchmarkParamAccess(router: RouterInstance, paths: string[], name: string): void {
  const warmupCount = Math.min(100_000, paths.length);
  for (let i = 0; i < warmupCount; i++) {
    router.find("GET", paths[i]!);
  }

  forceGC();
  const t0 = process.hrtime.bigint();

  for (let i = 0; i < paths.length; i++) {
    const r = router.find("GET", paths[i]!);
    if (r && r.params) {
      const _ = r.params.id ?? r.params.departure;
    }
  }

  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1_000_000;
  console.log(`${name} param access: ${ms.toFixed(2)} ms`);
}

function latencyTest(router: RouterInstance, paths: string[], name: string): void {
  const samples = new Float64Array(LATENCY_SAMPLES);

  const warmupCount = Math.min(100_000, paths.length);
  for (let i = 0; i < warmupCount; i++) {
    router.find("GET", paths[i]!);
  }

  forceGC();

  for (let i = 0; i < LATENCY_SAMPLES; i++) {
    const idx = (Math.random() * paths.length) | 0;

    const t0 = process.hrtime.bigint();
    router.find("GET", paths[idx]!);
    const t1 = process.hrtime.bigint();

    // Store in microseconds for better precision reading
    samples[i] = Number(t1 - t0) / 1000;
  }

  samples.sort();

  console.log(
    `${name} latency (μs) ` +
    `p50=${percentile(samples, 0.5).toFixed(2)} ` +
    `p90=${percentile(samples, 0.9).toFixed(2)} ` +
    `p99=${percentile(samples, 0.99).toFixed(2)} ` +
    `p99.9=${percentile(samples, 0.999).toFixed(2)}`
  );
}

// Runner

function runSuite(title: string, routes: string[], lookupBase: number): void {
  console.log(`\n===== ${title} =====`);

  const pathSets = makeLookupPathSets(lookupBase);
  const categories: PathCategory[] = ["static", "param", "wildcard", "miss"];

  const routers: Record<string, RouterInstance> = {
    "Peepal(search)": new PeepalRouter(),
    "Peepal(find)": new PeepalCompiledRouter(),
    Radix: new PeepalRadixRouter(),
    Rou3: new Rou3Router(),
    FindMyWay: new FindMyWayRouter(),
  };

  console.log("\n--- Insertion Phase ---");
  for (const [name, r] of Object.entries(routers)) {
    benchmarkInsert(r, routes, name);
  }

  for (const category of categories) {
    const paths = pathSets[category];

    console.log(`\n--- Lookup Phase (${category}) ---`);
    for (const [name, r] of Object.entries(routers)) {
      benchmarkLookup(r, paths, name);
    }

    console.log(`\n--- Parameter Access Phase (${category}) ---`);
    for (const [name, r] of Object.entries(routers)) {
      benchmarkParamAccess(r, paths, name);
    }

    console.log(`\n--- Latency Phase (${category}) ---`);
    for (const [name, r] of Object.entries(routers)) {
      latencyTest(r, paths, name);
    }
  }
}

// Execute

runSuite("ROUTER COMPARISON STRESS TEST", makeRoutes(NUM_ROUTES), NUM_ROUTES);
