// Ported from diesel's lib/router/trie.test.ts, run against all three lookup
// strategies peepal exposes (search / optimisedSearch / find) since they each
// re-implement the walk independently and can drift out of sync.

import { describe, expect, test, beforeAll } from "bun:test";
import { TrieRouter } from "./router";
import { runResult, chainLength } from "./router.test-utils";

export function describeDieselPortedCases(method: "search" | "optimisedSearch" | "find") {
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
}

// The lazy `middlewares` init only materialises the array once something
// pushes into it, so the lookups that collect nothing are the ones that
// regress. These use dynamic paths on purpose: a static path is served from
// the precomputed cache and never reaches the walk at all. find() is excluded
// because it merges middlewares into the handler chain instead of returning
// them separately.
export function describeLazyMiddlewareCases(
  method: "search" | "optimisedSearch",
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
