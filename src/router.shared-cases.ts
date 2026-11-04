// Ported from diesel's lib/router/trie.test.ts, run against both lookup entry
// points peepal exposes (search, and find which aliases it) so the alias stays
// verified alongside search.

import { describe, expect, test, beforeAll } from "bun:test";
import { TrieRouter } from "./router";
import { runResult, chainLength } from "./router.test-utils";

export function describeDieselPortedCases(method: "search" | "find") {
  describe(`TrieRouter.${method} - path mid check (ported from diesel)`, () => {
    let r: TrieRouter;

    beforeAll(() => {
      r = new TrieRouter();
      // /pradeep middleware only, it shouldn't run for /pradeep/ok
      r.addMiddleware("/pradeep", () => {});
      r.add("GET", "/pradeep/ok", () => "ok");

      r.addMiddleware("/user/*", () => {});
      r.add("GET", "/user/me", () => "me");
    });

    test("should not include static-path middleware in child route", () => {
      const result = (r as any)[method]("GET", "/pradeep/ok");
      // only the route's own handler, no leaked "/pradeep" middleware
      expect(chainLength(result)).toBe(1);
    });

    test("should include wildcard middleware for matching descendant", () => {
      const result = (r as any)[method]("GET", "/user/me");
      // 1 middleware + 1 handler
      expect(chainLength(result)).toBe(2);
    });
  });

  // Node.children is keyed by raw path segments. It has to be null-prototype:
  // with a plain {}, children["__proto__"] resolves to an inherited object and
  // the walk steps into it, so GET /__proto__ used to throw.
  describe(`TrieRouter.${method} - Object.prototype keys as path segments`, () => {
    const PROTO_KEYS = [
      "__proto__",
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "isPrototypeOf",
    ];

    test("a request for a prototype key misses instead of throwing", () => {
      const r = new TrieRouter();
      r.add("GET", "/about", () => "about");

      for (const key of PROTO_KEYS) {
        const result = (r as any)[method]("GET", `/${key}`);
        expect(result.handler).toBeUndefined();
      }
    });

    test("a prototype key deeper in the path also misses", () => {
      const r = new TrieRouter();
      r.add("GET", "/a/b", () => "ab");

      for (const key of PROTO_KEYS) {
        expect((r as any)[method]("GET", `/a/${key}`).handler).toBeUndefined();
        expect((r as any)[method]("GET", `/a/${key}/c`).handler).toBeUndefined();
      }
    });

    test("a prototype key is captured as a normal param value", () => {
      const r = new TrieRouter();
      r.add("GET", "/user/:id", () => "user");

      for (const key of PROTO_KEYS) {
        const result = (r as any)[method]("GET", `/user/${key}`);
        expect(runResult(result)).toBe("user");
        expect(result.params).toEqual({ id: key });
      }
    });

    test("a route literally named after a prototype key still works", () => {
      const r = new TrieRouter();
      r.add("GET", "/__proto__", () => "proto");
      r.add("GET", "/constructor/edit", () => "ctor");

      expect(runResult((r as any)[method]("GET", "/__proto__"))).toBe("proto");
      expect(runResult((r as any)[method]("GET", "/constructor/edit"))).toBe("ctor");
    });
  });

  describe(`TrieRouter.${method} - dynamic backtracking (ported from diesel)`, () => {
    let r: TrieRouter;

    beforeAll(() => {
      r = new TrieRouter();
      r.add("GET", "/users/:id/posts", () => "posts");
      r.add("GET", "/users/me/settings", () => "settings");
    });

    test("should match /users/me/settings (static branch)", () => {
      const result = (r as any)[method]("GET", "/users/me/settings");
      expect(runResult(result)).toBe("settings");
    });

    test("should match /users/123/posts (dynamic branch)", () => {
      const result = (r as any)[method]("GET", "/users/123/posts");
      expect(runResult(result)).toBe("posts");
    });

    // known gap (shared with diesel): the trie doesn't retry the ":" branch
    // after the static "me" branch dead-ends past its first segment.
    test.todo("should match /users/me/posts by backtracking off the static 'me' branch", () => {
      const result = (r as any)[method]("GET", "/users/me/posts");
      expect(runResult(result)).toBe("posts");
    });
  });

  describe(`TrieRouter.${method} - per-method params`, () => {
    test("different param names for same path shape across different methods works correctly", () => {
      const r = new TrieRouter();
      r.add("GET", "/user/:id", () => "get");
      r.add("DELETE", "/user/:user_id", () => "delete");

      expect((r as any)[method]("GET", "/user/123").params).toEqual({ id: "123" });
      expect((r as any)[method]("DELETE", "/user/123").params).toEqual({ user_id: "123" });
    });

    test("three methods sharing identical path shape with distinct param names works correctly", () => {
      const r = new TrieRouter();
      r.add("GET", "/item/:itemId", () => "get");
      r.add("PUT", "/item/:updateId", () => "put");
      r.add("DELETE", "/item/:deleteId", () => "delete");

      expect((r as any)[method]("GET", "/item/9").params).toEqual({ itemId: "9" });
      expect((r as any)[method]("PUT", "/item/9").params).toEqual({ updateId: "9" });
      expect((r as any)[method]("DELETE", "/item/9").params).toEqual({ deleteId: "9" });
    });

    // known gap (shared with diesel): a node at a given tree position can be
    // shared by routes that diverge further down for the SAME method - only
    // one params[method] slot exists there, so whichever route was inserted
    // last wins the name for all of them.
    test.todo("should keep distinct param names for the same method on diverging branches", () => {
      const r = new TrieRouter();
      r.add("GET", "/user/:id/profile", () => "profile");
      r.add("GET", "/user/:name/settings", () => "settings");

      expect((r as any)[method]("GET", "/user/123/profile").params).toEqual({ id: "123" });
      expect((r as any)[method]("GET", "/user/123/settings").params).toEqual({ name: "123" });
    });
  });

  // A route registered under ALL is found by any method, because the handler
  // lookup falls back to the ALL slot. The param NAME has no such fallback:
  // it is stored under the registering method and read back under the
  // requesting one, so a cross-method match used to name the param
  // "undefined" instead of "id".
  describe(`TrieRouter.${method} - params on an ALL route matched by another method`, () => {
    test("keeps the param name when ALL is matched by a different method", () => {
      const r = new TrieRouter();
      r.add("ALL", "/a/:id", () => "all");

      expect((r as any)[method]("POST", "/a/9").params).toEqual({ id: "9" });
    });

    // the walk still enters the param branch when a paramChild exists for a
    // different method, but no name is registered for the requested one -
    // that must not invent a key rather than naming the param "undefined".
    test("adds no param key when the method has no name registered", () => {
      const r = new TrieRouter();
      r.add("GET", "/a/:id", () => "g");

      const result = (r as any)[method]("POST", "/a/9");
      expect(result.params).toBeUndefined();
    });
  });

  // Methods outside GET/POST/PUT/DELETE/PATCH/ALL get their slot from the
  // shared `nextMethodId` counter instead of a constant. Nothing else in the
  // suite registers one, so a counter that starts at or below METHOD_ALL used
  // to hand the first custom method the ALL slot - and every one of these
  // assertions passed anyway, because they were all testing the six constants.
  describe(`TrieRouter.${method} - methods outside the six built-in slots`, () => {
    test("a custom method does not answer other methods", () => {
      const r = new TrieRouter();
      r.add("HEAD", "/x", () => "head");

      expect(runResult((r as any)[method]("HEAD", "/x"))).toBe("head");
      for (const other of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
        expect(runResult((r as any)[method](other, "/x"))).toBeNull();
      }
    });

    // if two custom methods ever shared a slot the later add would silently
    // win for both, so assert each one still answers with its own handler.
    test("custom methods keep separate slots", () => {
      const r = new TrieRouter();
      const methods = ["HEAD", "OPTIONS", "PURGE", "LOCK"];
      for (const m of methods) r.add(m, "/z", () => m);

      for (const m of methods) {
        expect(runResult((r as any)[method](m, "/z"))).toBe(m);
      }
      expect(runResult((r as any)[method]("GET", "/z"))).toBeNull();
    });

    // the collision case that motivated this block: a custom method must not
    // land in the ALL slot, in either registration order.
    test("a custom method neither overwrites nor is shadowed by ALL", () => {
      const r = new TrieRouter();
      r.add("ALL", "/y", () => "all");
      r.add("HEAD", "/y", () => "head");

      expect(runResult((r as any)[method]("HEAD", "/y"))).toBe("head");
      expect(runResult((r as any)[method]("GET", "/y"))).toBe("all");

      const reversed = new TrieRouter();
      reversed.add("HEAD", "/y", () => "head");
      reversed.add("ALL", "/y", () => "all");

      expect(runResult((reversed as any)[method]("HEAD", "/y"))).toBe("head");
      expect(runResult((reversed as any)[method]("GET", "/y"))).toBe("all");
    });

    // params are keyed by slot too, so the same collision would corrupt them.
    test("a custom method keeps its own param names", () => {
      const r = new TrieRouter();
      r.add("HEAD", "/c/:id", () => "head");

      expect((r as any)[method]("HEAD", "/c/9").params).toEqual({ id: "9" });
      expect(runResult((r as any)[method]("GET", "/c/9"))).toBeNull();
    });
  });
}

// The lazy `middlewares` init only materialises the array once something
// pushes into it, so the lookups that collect nothing are the ones that
// regress. These use dynamic paths on purpose: a static path is served from
// the precomputed cache and never reaches the walk at all.
export function describeLazyMiddlewareCases(
  method: "search" | "find",
) {
  describe(`TrieRouter.${method} - lazy middleware init`, () => {
    const call = (r: TrieRouter, path: string) =>
      (r as any)[method]("GET", path);

    test("global middlewares survive a match that collects nothing else", () => {
      const r = new TrieRouter();
      r.addMiddleware("/", () => "global");
      r.add("GET", "/user/:id", () => "handler");

      const result = call(r, "/user/123");
      expect(result.middlewares?.map((fn: Function) => fn())).toEqual([
        "global",
      ]);
      expect(runResult(result)).toBe("handler");
    });

    test("wildcard middleware is collected on the static branch too", () => {
      const r = new TrieRouter();
      r.addMiddleware("/user/*", () => "wildcard");
      r.add("GET", "/user/me/:x", () => "handler");

      const result = call(r, "/user/me/1");
      expect(result.middlewares?.map((fn: Function) => fn())).toEqual([
        "wildcard",
      ]);
    });

    test("a match with no middleware anywhere returns an empty list", () => {
      const r = new TrieRouter();
      r.add("GET", "/user/:id", () => "handler");

      expect(call(r, "/user/123").middlewares).toEqual([]);
    });

    test("global middlewares are still returned on a miss", () => {
      const r = new TrieRouter();
      r.addMiddleware("/", () => "global");
      r.add("GET", "/user/:id", () => "handler");

      const result = call(r, "/nope/nope");
      expect(result.handler).toBeUndefined();
      expect(result.middlewares?.map((fn: Function) => fn())).toEqual([
        "global",
      ]);
    });

    test("the shared empty list is not mutated by a caller", () => {
      const r = new TrieRouter();
      r.add("GET", "/user/:id", () => "handler");

      const first = call(r, "/user/1");
      expect(() => first.middlewares.push(() => "leak")).toThrow();
      expect(call(r, "/user/2").middlewares).toEqual([]);
    });

    // the static cache is populated by uncachedSearch, so a cache hit is the
    // only way to exercise that walk's lazy init.
    test("cached static routes keep their global middlewares", () => {
      const r = new TrieRouter();
      r.addMiddleware("/", () => "global");
      r.add("GET", "/about", () => "handler");

      const result = r.search("GET", "/about");
      expect(result.middlewares?.map((fn: Function) => fn())).toEqual([
        "global",
      ]);
      expect(runResult(result)).toBe("handler");
    });

    test("cached static route with no middleware returns an empty list", () => {
      const r = new TrieRouter();
      r.add("GET", "/about", () => "handler");

      expect(r.search("GET", "/about").middlewares).toEqual([]);
    });
  });
}
