# Peepal Router

A fast and minimal Trie based HTTP router.

The name comes from the **Peepal (Sacred fig) tree**, known for its deep roots and branching structure. Just like the tree, Peepal Router organizes routes in a Trie, so path matching stays fast and predictable with very low overhead.

* Trie based routing, zero dependencies, very small footprint
* Dynamic params, wildcards, and middleware chaining
* Works on any JavaScript engine — Node.js, Bun, Deno, and others
* TypeScript types included

---

## Install

```bash
npm install peepal-router
```

---

## Quick start

```js
import { TrieRouter } from "peepal-router";

const router = new TrieRouter();

router.add("GET", "/users/:id", () => "user profile");

const match = router.find("GET", "/users/42");

for (const fn of match.handler) fn();
```

Create a router, register routes with `add()`, then look one up with `find()`.
A match gives you back `params`, `middlewares` and `handler`. If nothing
matches, `handler` is `undefined` — that is your 404.

---

## Route params

```js
router.add("GET", "/users/:id/posts/:postId", () => "post");

router.find("GET", "/users/42/posts/7");
// params: { id: "42", postId: "7" }
```

Any segment starting with `:` is a param. Peepal Router parses them for you
and hands them back in `params`. When a route has no params, `params` is
`undefined` instead of an empty object, so nothing is allocated for static
routes.

---

## Wildcards

```js
router.add("GET", "/static/*", () => "file");

// matches:
//   /static/app.js
//   /static/css/style.css
//   /static/images/logo.png
```

`*` matches the rest of the path, however many segments deep it goes.

---

## Middleware

```js
// global — runs for every route
router.pushMiddleware("/", () => console.log("global"));

// whole subtree — runs for /users and everything under it
router.pushMiddleware("/users/*", () => console.log("users middleware"));

// that exact path only — not its children
router.pushMiddleware("/admin", () => console.log("admin middleware"));
```

Middleware on `/` is global. Anything else is bound to **that exact node**, so
middleware on `/admin` does *not* run for `/admin/settings`. To cover a whole
subtree, mount it with a wildcard: `/users/*`. `addMiddleware` is an alias for
`pushMiddleware`.

---

## Any method

```js
import { TrieRouter, ALL_METHOD } from "peepal-router";

router.add(ALL_METHOD, "/health", () => "ok");
```

`ALL_METHOD` registers a fallback for that path. It matches any method that
doesn't already have its own handler there.

---

## Looking up a route

```js
router.pushMiddleware("/", globalMw);
router.pushMiddleware("/users/*", usersMw);
router.add("GET", "/users/:id", userHandler);

router.search("GET", "/users/42");
// { params: { id: "42" }, middlewares: [globalMw, usersMw], handler: [userHandler] }
```

`search()` walks the trie (static paths are served from a precomputed cache)
and returns `params`, the matching `middlewares`, and the route `handler`
separately — run the middlewares, then the handler. `find()` is a thin alias of
`search()` with the identical return shape.

---

## Full example

```js
import { TrieRouter } from "peepal-router";

const router = new TrieRouter();

router.pushMiddleware("/", () => console.log("global"));
router.pushMiddleware("/api/*", () => console.log("api middleware"));

router.add("GET", "/api/users/:id", () => console.log("user handler"));

const res = router.find("GET", "/api/users/100");

if (res.handler) {
  for (const fn of res.handler) fn();
} else {
  console.log("404");
}
```

---

## API

| Method | What it does |
| --- | --- |
| `add(method, path, handler \| handler[])` | Register a route. `insert()` is an alias. |
| `pushMiddleware(path, mw \| mw[])` | Register middleware. `addMiddleware()` is an alias. |
| `search(method, path)` | Look up a route. Returns `params`, `middlewares`, and `handler`. |
| `find(method, path)` | Alias of `search()`. |

All lookups return the same shape:

```ts
{
  params: Record<string, string> | undefined;
  middlewares: Function[] | undefined;
  handler: Function[] | undefined;   // undefined = no match
}
```

---

## Performance

Peepal Router is built for speed and low allocation on the hot path:

* No unnecessary allocations while matching
* Minimal lookup overhead
* Fast static and dynamic matching
* Lightweight, cache friendly structure

---

## Roadmap

* Route priority improvements
* Optional parameter support
* Regex based params
* Zero allocation path parser
* Extended benchmarking

---

## Contributing

Contributions, ideas, and performance improvements are welcome. Found a bug or
a speedup? Open an issue or send a pull request.

---

## License

MIT © Pradeep Kumar — [github.com/pradeepbgs/peepal-router](https://github.com/pradeepbgs/peepal-router)
