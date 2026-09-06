# Changelog

All notable changes to `peepal-router` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.3] - 2026-09-06

### Performance

- `optimisedSearch()` now reads the per-method static cache before walking the
  trie, as `search()` already did. A static path costs one `Map` lookup instead
  of a full character scan.

  Measured on the benchmark table (21 of 82 paths cacheable), 1M iterations x
  11 reps, alternating order, medians:

  | runtime | before | after | |
  | --- | --- | --- | --- |
  | node 24 (V8) | 3,840,894 ops/s | 4,268,566 ops/s | +11% |
  | bun 1.4 (JSC) | 3,813,394 ops/s | 4,557,841 ops/s | +20% |

  The gain scales with how much of your traffic hits static routes; an
  all-dynamic table sees roughly none.

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

Measured against 0.6.0 on a param-heavy table, 400k iterations x 21 reps,
alternating order, medians:

| lookup | node 24 (V8) | bun 1.4 (JSC) |
| --- | --- | --- |
| `search` | +12% | +8% |
| `optimisedSearch` | +10% | +3% |
| `find` | +6% | +4% |

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

[0.6.3]: https://github.com/libsib/peepal-router/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/libsib/peepal-router/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/libsib/peepal-router/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/libsib/peepal-router/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/libsib/peepal-router/compare/v0.5.0...v0.5.2
[0.5.0]: https://github.com/libsib/peepal-router/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/libsib/peepal-router/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/libsib/peepal-router/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/libsib/peepal-router/releases/tag/v0.2.1
