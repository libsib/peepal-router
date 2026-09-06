# Changelog

All notable changes to `peepal-router` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.5] - 2026-09-06

### Performance

- The per-method static caches are now null-prototype objects instead of
  `Map`s. Property access is a little cheaper than `Map.get` here, and a cache
  hit returns without touching the trie at all.

  No throughput figure is given: the effect is small enough that it sits inside
  the run-to-run variance of the benchmarks, and it only applies to the share of
  traffic that hits static routes. Treat this as neutral-to-slightly-positive
  rather than a speedup you can plan around.

  The caches are keyed by raw request paths, so they use `Object.create(null)`
  for the same reason `children` does - a plain `{}` would make `/__proto__`
  resolve to an inherited object.

## [0.6.4] - 2026-09-06

### Fixed

- **A request for `/__proto__`, `/constructor`, `/toString` or any other
  `Object.prototype` key crashed the lookup.** Node children were stored in a
  plain `{}`, so `children["__proto__"]` returned an inherited object rather
  than `undefined`; the walk stepped into it and threw on the next segment.
  Affected `search()`, `optimisedSearch()` and `find()`, at any depth. Children
  are now stored in a null-prototype object.

  Any client could trigger this, and an uncaught throw takes down most Node
  servers, so upgrading from 0.6.3 or earlier is recommended.

### Performance

- Each node now holds direct references to its `":"` and `"*"` children, so a
  walk reads a field instead of doing a dictionary lookup on `children`. Both
  children remain in `children` as well, which compilation still iterates.

  No throughput figure is given: the effect is small enough to sit inside
  benchmark variance. These branches only run when the static-child lookup
  misses, and the static lookup itself uses a dynamic key, so it cannot become
  a field.

  Verified to return identical handlers, params and middleware counts across
  every path in the benchmark table.

### Changed

- The internal `hasWildcardChild` flag is replaced by a `wildcardChild` node
  reference. Both are internal to the trie and neither is part of the public
  API.

## [0.6.3] - 2026-09-06

### Performance

- `optimisedSearch()` now reads the per-method static cache before walking the
  trie, as `search()` already did. A static path costs one cache lookup instead
  of a full character scan.

  No throughput figure is given. The gain scales with how much of your traffic
  hits static routes; an all-dynamic table sees roughly none.

### Changed

- Repeated `optimisedSearch()` calls for the same static path now return the
  same cached `Result` object rather than a freshly built one. Mutating a
  returned result would affect later lookups for that path. `search()` has
  behaved this way since 0.6.0; this makes the two consistent.

## [0.6.2] - 2026-09-05

Metadata only. No code changes: the published `dist` is byte-identical to
0.6.1, so upgrading cannot alter routing behaviour or performance.

### Changed

- The repository moved from `pradeepbgs/peepal-router` to
  `libsib/peepal-router`. The `homepage`, `bugs` and `repository` fields in
  `package.json` now point at the new location.
- Dropped a README reference to an image that was never part of the published
  package, so it rendered broken on npm.

## [0.6.1] - 2026-09-05

No routing behaviour changes: the same request matches the same handler with
the same params as in 0.6.0. This release is the wildcard and child-lookup
optimisation, plus a type-only rename. See the frozen-array note below for the
one observable difference.

### Performance

Two dictionary lookups removed from the per-segment walk. No throughput
figures are given - see the note at the foot of this file.

- Nodes now record whether they have a `"*"` child, so `children["*"]` is only
  looked up when a wildcard actually exists. Previously every path segment paid
  for that lookup whether or not any wildcard was registered.
- Child lookups were being performed twice per branch, once to test and once to
  assign. They are now hoisted into a local and reused.
- A lookup that collects no middleware, on a router with no global middlewares
  registered, returns a shared frozen empty array rather than allocating one.
  The returned array is frozen, so callers that previously mutated it in place
  will now throw.

### Changed

- **Breaking (types only):** the exported `Find` interface is now `Result`. The
  shape is unchanged. Only affects TypeScript consumers who imported the name;
  runtime behaviour and the `TrieRouter` API are unaffected.
- `dist` is emitted as a single file (`index.js` + `index.d.ts`).
- All public `TrieRouter` methods carry JSDoc.

## [0.6.0] - 2026-09-03

### Added

- A `RadixRouter` implementation alongside the trie, with benchmark coverage.

### Performance

- Static routes (no `:` or `*`) resolve from a per-method precomputed map,
  bypassing the trie walk entirely.

### Fixed

- The `optimisedSearch` benchmark loop was timing `find()` rather than
  `optimisedSearch()`.

## [0.5.2] - 2026-08-20

### Performance

- `search()` and `optimisedSearch()` no longer copy the global middleware array
  when none are registered.

### Fixed

- Added the missing `.js` extension on the relative export in `src/index.ts`,
  which broke resolution under Node's ESM loader.

### Documentation

- README corrected to match the actual router API and return types.

## [0.5.0] - 2026-08-08

### Added

- `add()` and `insert()` accept `Function | Function[]`, so a route can be
  registered with a handler chain directly.

## [0.4.0] - 2026-08-08

### Added

- Per-method route params, so the same path shape can name its param
  differently for each HTTP method.

### Fixed

- Middleware is scoped to the matched node and its wildcard, rather than
  leaking into descendants.
- `ALL` method routes fall through correctly when no method-specific handler
  is registered.

## [0.3.0] - 2026-02-28

### Added

- `optimisedSearch()`, which scans the path character by character instead of
  splitting it into segments.

## [0.2.1] - 2026-02-24

Initial published releases.

## A note on performance claims

Earlier versions of this file carried specific throughput percentages. They
have been removed. The benchmarks they came from loaded two builds of the
router into one process, which pollutes the call sites being measured, and
rerunning the same comparisons under different harnesses produced results that
disagreed in both magnitude and sign. The changes themselves are sound and
verified for correctness; the numbers attached to them were not reliable enough
to publish. Benchmark your own routing table if throughput matters to you.

[0.6.5]: https://github.com/libsib/peepal-router/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/libsib/peepal-router/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/libsib/peepal-router/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/libsib/peepal-router/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/libsib/peepal-router/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/libsib/peepal-router/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/libsib/peepal-router/compare/v0.5.0...v0.5.2
[0.5.0]: https://github.com/libsib/peepal-router/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/libsib/peepal-router/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/libsib/peepal-router/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/libsib/peepal-router/releases/tag/v0.2.1
