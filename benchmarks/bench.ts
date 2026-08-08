import { TrieRouter } from '../src/router';
import { performance } from 'perf_hooks';

const router = new TrieRouter();

function mockMiddleware() {}
function mockHandler() {}

// Global and high level middlewares
router.pushMiddleware("/", mockMiddleware);
router.pushMiddleware("/api", mockMiddleware);
router.pushMiddleware("/api/v1", mockMiddleware);

console.log("Generating massive routing table with deep middlewares...");

const testPaths: string[] = [];

for (let i = 0; i < 500; i++) {
  // Inject middlewares deep into the branches to force array allocations
  if (i % 10 === 0) {
    router.pushMiddleware(`/api/v1/resource${i}`, mockMiddleware);
    router.pushMiddleware(`/api/v1/resource${i}/:id`, mockMiddleware);
  }

  router.add("GET", `/api/v1/resource${i}`, mockHandler);
  router.add("GET", `/api/v1/resource${i}/:id`, mockHandler);
  router.add("POST", `/api/v1/resource${i}/:id/action`, mockHandler);
  router.add("DELETE", `/api/v1/resource${i}/:id/action/:subId`, mockHandler);
  
  // Select paths that heavily utilize the deep middlewares
  if (i % 25 === 0) {
    testPaths.push(`/api/v1/resource${i}`);
    testPaths.push(`/api/v1/resource${i}/999`);
    testPaths.push(`/api/v1/resource${i}/999/action`);
    testPaths.push(`/api/v1/resource${i}/999/action/888`);
  }
}

testPaths.push("/api/v1/missing/route/entirely");
testPaths.push("/static/images/notfound.png");

const ITERATIONS = 1000000;
const pathCount = testPaths.length;

console.log(`Warming up engine with ${pathCount} distinct paths...`);
for (let i = 0; i < 10000; i++) {
  const path = testPaths[i % pathCount];
  router.search("POST", path!);
  router.find("POST", path);
  router.optimisedSearch("POST", path!)
}

console.log(`Running intense benchmark with ${ITERATIONS} iterations...`);

const startSearch = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const path = testPaths[i % pathCount];
  router.search("POST", path!);
}
const endSearch = performance.now();
const timeSearch = endSearch - startSearch;

const startFind = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const path = testPaths[i % pathCount];
  router.find("POST", path);
}
const endFind = performance.now();
const timeFind = endFind - startFind;

const startOptimisedSearch = performance.now()
for (let i = 0; i < ITERATIONS; i++) {
  const path = testPaths[i % pathCount];
  router.find("POST", path);
}
const endOptimisedSearch = performance.now();
const timeOptimisedSearch = endOptimisedSearch - startOptimisedSearch;

const searchOpsPerSec = Math.floor(ITERATIONS / (timeSearch / 1000));
const findOpsPerSec = Math.floor(ITERATIONS / (timeFind / 1000));
const OptimisedSearchOpsPerSec = Math.floor(ITERATIONS / (timeOptimisedSearch / 1000));

console.log("=====================================");
console.log(`Old Search Method Time: ${timeSearch.toFixed(2)} ms`);
console.log(`Old Search Speed: ${searchOpsPerSec.toLocaleString()} ops/sec`);

console.log("=====================================");
console.log(`New Find Method Time:   ${timeFind.toFixed(2)} ms`);
console.log(`New Find Speed: ${findOpsPerSec.toLocaleString()} ops/sec`);
console.log("=====================================");

console.log("=====================================");
console.log(`New Optimised Search Time:   ${timeOptimisedSearch.toFixed(2)} ms`);
console.log(`New optimisedSearch Speed: ${OptimisedSearchOpsPerSec.toLocaleString()} ops/sec`);
console.log("=====================================");

// const multiplier = (findOpsPerSec / searchOpsPerSec).toFixed(2);
// console.log(`Result: With deep middlewares the new find method is ${multiplier}x faster.`);