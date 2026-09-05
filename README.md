# Peepar

A fast and minimal Trie based HTTP router.

Peepar name is inspired by the **Peepal (Sacred fig) tree**, known for its deep roots and branching structure. Just like the tree, Peepar organizes routes using a Trie data structure, enabling fast and predictable path matching with very low overhead.

---

## Features

* Trie based routing for fast lookups
* Zero dependencies
* Very small footprint
* Middleware chaining support
* Dynamic route parameters
* Wildcard route matching
* Works in Node.js and Bun
* TypeScript types included
* Inbuilt params parsing

---

## Installation

```bash
npm install peepal-router
```

---

## Basic Usage

```js
import { TrieRouter } from "peepal-router";

const router = new TrieRouter();

// Global middleware
function globalMiddleware1() { return "global middleware"; }
function globalMiddleware2() { return "global middleware 2"; }
router.pushMiddleware("/", globalMiddleware1);
router.pushMiddleware("/", globalMiddleware2);

function homeHandler() { return "home"; }
router.add("GET", "/", homeHandler);

const matched = router.search("GET", "/");
```

Output:

```js
{
  params: undefined,
  middlewares: [globalMiddleware1, globalMiddleware2],
  handler: [homeHandler]
}
```

```js
// Route specific middleware
function userMiddleware(ctx) {
  console.log("/users middleware");
}
router.pushMiddleware("/users", userMiddleware);

function userHandler() { return "user profile"; }
router.add("GET", "/users/:id", userHandler);

const result = router.find("GET", "/users/42");
```

Output:

```js
{
  params: { id: "42" },
  middlewares: undefined,
  handler: [globalMiddleware1, globalMiddleware2, userMiddleware, userHandler]
}
```

`find()` (and its unstable `compiledFind()` backing) pre-bakes middlewares and the handler into one array at compile time, so `middlewares` is always `undefined` there. `search()`/`optimisedSearch()` keep them separate instead - see the shape above.

> **Note:** the first call to `find()` compiles the trie once and permanently
> switches the router over to `compiledFind()`. Any `add()`/`insert()`/
> `pushMiddleware()` calls made *after* that first `find()` call won't be
> picked up unless you call `router.compile()` again. Register all routes
> and middleware before the first `find()` call, or stick to `search()` /
> `optimisedSearch()` if routes are added dynamically at runtime.

---

## Middleware
 - peepar supports global and route specific middleware

Global middleware:

```js
router.pushMiddleware("/", (ctx) => {
  console.log("global middleware");
});
```

Route specific middleware:

```js
router.pushMiddleware("/users", (ctx) => {
  console.log("/users middleware");
});
```

---

## Wildcard Routes

```js
router.add("GET", "/static/*", () => "HTML page");
```

Matches:

* /static/app.js
* /static/css/style.css
* /static/images/logo.png

---

## Performance

Peepar is designed for speed and low allocation during hot path. we try to minimise allocation and make our router fast as much as possible.

Key design goals:

* Try to Avoid unnecessary allocations in hot path
* Minimal overhead during lookup
* Fast static and dynamic route matching
* Lightweight and cache friendly structure

---

## API

### router.add(method, path, handler | handler[])
### router.insert(method, path, handler | handler[])

Register a route. Accepts one handler or an array of handlers for the same route/method.

Use `ALL_METHOD` (exported from the package) as the method to register a
fallback handler that matches any method that doesn't have its own handler
for that path:

```js
import { TrieRouter, ALL_METHOD } from "peepal-router";

router.add(ALL_METHOD, "/health", () => "ok");
```

### router.pushMiddleware(path, middleware | middleware[])
### router.addMiddleware(path, middleware | middleware[])

Register middleware for a path, or globally when `path` is `"/"`.
`addMiddleware` is just an alias for `pushMiddleware`. Only the middleware
bound to a matched node (plus any wildcard ancestor) is included - middleware
registered on a static ancestor path does not leak into its descendants.

### router.search(method, path)
### router.optimisedSearch(method, path)

Walk the trie on every call and return middlewares and the route handler
separately:

```ts
{
  params: Record<string, string> | undefined;
  middlewares: Function[];       // never undefined, may be empty
  handler: Function[] | undefined;
}
```

`optimisedSearch` is functionally identical to `search` - it just parses the
path without `split("/")`, avoiding an intermediate array allocation.

### router.find(method, path)
### router.compile()

`find()` bakes each route's middlewares and handlers into a single array
ahead of time. The first call to `find()` runs `compile()` for you and
switches the router to the compiled lookup path (`compiledFind`) from then
on:

```ts
{
  params: Record<string, string> | undefined;
  middlewares: undefined;        // always undefined - already merged into handler
  handler: Function[] | undefined; // middlewares + route handler(s), in order
}
```

Call `router.compile()` yourself if you add routes/middleware after having
already called `find()` once, so the compiled tree picks them up.

---

## Example

```js
import { TrieRouter } from "peepal-router";

const router = new TrieRouter();

router.pushMiddleware("/", () => console.log("global"));
router.pushMiddleware("/api/*", () => console.log("api middleware"));

router.add("GET", "/api/users/:id", () => console.log("user handler"));

const res = router.find("GET", "/api/users/100");

for (const fn of res.handler) {
  fn();
}
```

---

## Roadmap

* Route priority improvements
* Param parsing inbuilt in search method
* Optional parameter support
* Regex based params
* Zero allocation path parser
* Extended benchmarking

---

## Contributing

Contributions, ideas, and performance improvements are welcome.

If you find a bug or want to improve performance, open an issue or submit a pull request.

---

## License

MIT

---

## Author

Pradeep Kumar

GitHub: [https://github.com/pradeepbgs/peepal-router](https://github.com/pradeepbgs/peepal-router)
