import { describe, expect, test, beforeAll } from "bun:test";
import { TrieRouter, ALL_METHOD } from "./router";

let router: TrieRouter;

beforeAll(() => {
  router = new TrieRouter();

  router.add("GET", "/", () => "root");
  router.add("GET", "/about", () => "about page");
  router.add("GET", "/user/profile", () => "static profile");
  router.add("GET", "/user/:id", () => "dynamic user");
  router.add("GET", "/files/*", () => "catch all");

  router.add("GET", "/api/data", () => "GET handler");
  router.add("POST", "/api/data", () => "POST handler");

  router.add("GET", "/a/:b/c/:d/e", () => "nested");
  router.add("GET", "/orgs/:orgId/teams/:teamId", () => "team");
});

const runHandlers = (handlers: any) => {
  if (!handlers) return null;
  let result: any;
  for (const h of handlers) {
    result = h();
  }
  return result;
};

// search()/optimisedSearch() return {params, middlewares, handler} (matching
// diesel's Find contract), while find()/compiledFind() still return the
// middlewares+handler merged into a single `handler` array. These two
// helpers work with either shape so the same assertions can run against all
// three lookup strategies.
const runResult = (result: any) => {
  const mws = result?.middlewares ?? [];
  const h = result?.handler;
  const handlers = h == null ? [] : Array.isArray(h) ? h : [h];
  const fns = [...mws, ...handlers];
  if (!fns.length) return null;
  let out: any;
  for (const fn of fns) out = fn();
  return out;
};

const chainLength = (result: any) => {
  const mws = result?.middlewares ?? [];
  const h = result?.handler;
  const handlerCount = h == null ? 0 : Array.isArray(h) ? h.length : 1;
  return mws.length + handlerCount;
};

describe("TrieRouter - Basic Routing", () => {

  test("should match org/team route (multiple params deep)", () => {
    const result = router.search("GET", "/orgs/apple/teams/design");
    expect(runResult(result)).toBe("team");
    expect(result.params).toEqual({ orgId: "apple", teamId: "design" });
  });

  test("root route", () => {
    const result = router.search("GET", "/");
    expect(runResult(result)).toBe("root");
  });

  test("static route", () => {
    const result = router.search("GET", "/about");
    expect(runResult(result)).toBe("about page");
  });

  test("dynamic route", () => {
    const result = router.search("GET", "/user/123");
    expect(runResult(result)).toBe("dynamic user");
  });

  test("wildcard route", () => {
    const result = router.search("GET", "/files/images/photo.png");
    expect(runResult(result)).toBe("catch all");
  });

  test("multiple methods", () => {
    const getResult = router.search("GET", "/api/data");
    const postResult = router.search("POST", "/api/data");

    expect(runResult(getResult)).toBe("GET handler");
    expect(runResult(postResult)).toBe("POST handler");
  });

  test("method not found", () => {
    const result = router.search("PUT", "/api/data");
    expect(result?.handler).toBeUndefined();
  });

  test("deep dynamic route", () => {
    const result = router.search("GET", "/a/123/c/456/e");
    expect(runResult(result)).toBe("nested");
  });

  test("prefer exact over dynamic", () => {
    const result = router.search("GET", "/user/profile");
    expect(runResult(result)).toBe("static profile");
  });

  test("non-existent route", () => {
    const result = router.search("GET", "/non-existent");
    expect(result?.handler).toBeUndefined();
  });
});

describe("ALL_METHOD fallback", () => {
  let router: TrieRouter;
  beforeAll(() => {
    router = new TrieRouter();
    router.add(ALL_METHOD, "/health", () => "any-method handler");
    router.add("GET", "/health", () => "GET-specific handler");
  });

  test("an exact method handler takes priority over ALL_METHOD", () => {
    const result = router.search("GET", "/health");
    expect(runResult(result)).toBe("GET-specific handler");
  });

  test("methods without their own handler fall back to ALL_METHOD", () => {
    const result = router.search("POST", "/health");
    expect(runResult(result)).toBe("any-method handler");
  });
});

describe("TrieRouter - Middleware Order", () => {

  let router: TrieRouter;

  beforeAll(() => {
    router = new TrieRouter();

    router.addMiddleware("/", () => "mw1");
    router.addMiddleware("/", () => "mw2");

    router.add("GET", "/", () => "handler");
  });

  test("middleware order", () => {
    const result = router.find("GET", "/");
    const outputs = result?.handler?.map((fn: () => any) => fn());
    expect(outputs).toEqual(["mw1", "mw2", "handler"]);
  });
});

describe('Middleware Path Matching', () => {

    let r : TrieRouter

    beforeAll(() => {
        r = new TrieRouter()
        r.addMiddleware('/', () => "global")
        r.addMiddleware('/users', () => 'users level')
        r.addMiddleware('/user/*', () => "/user/* level")
        r.addMiddleware('/user/name', () => '/user/* and /user/name')
        r.add('GET', '/user/name', () => 'handler')
    })

    test("should only contain global if no handler for a path or method", () => {
        let rs = r.search('POST', '/users/name') // method won't match
        let outputs = rs?.middlewares?.map(fn => fn())
        expect(outputs).toEqual(["global"])
        expect(rs?.handler).toBeUndefined()

        rs = r.search('GET', '/users/name') // path wont match
        outputs = rs.middlewares?.map(fn => fn())
        expect(outputs).toEqual(["global"])
        expect(rs?.handler).toBeUndefined()
    })

    test("collects all matching middleware", () => {
        const result = r.search('GET', '/user/name')
        const outputs = runResult(result)
        expect(outputs).toBe('handler')
        expect(result?.middlewares?.map(fn => fn())).toEqual(["global", "/user/* level", '/user/* and /user/name'])
    })

    test("collect only users/ level handlers", () => {
        const rs = r.search('GET', '/users')
        const outputs = rs.middlewares?.map(fn => fn())
        expect(outputs).toEqual(['global','users level'])
        expect(rs?.handler).toBeUndefined()
    })

 })

describe("wildcard and dynamic middlewares combined", () => {
  let router: TrieRouter;
  beforeAll(() => {
    router = new TrieRouter();
    router.addMiddleware("/user/*", () => "/user/* middleware");
    router.addMiddleware("/user/:id", () => "/user/:id middleware");
    router.addMiddleware("/user/static", () => "/user/static middleware");
    router.add("GET", "/user/:id", () => "dynamic handler");
    router.add("GET", "/user/static", () => "static handler");
  });

  test("dynamic branch gets wildcard + its own middleware", () => {
    const result = router.search("GET", "/user/123");
    expect(result.middlewares?.map((fn) => fn())).toEqual([
      "/user/* middleware",
      "/user/:id middleware",
    ]);
    expect(runResult(result)).toBe("dynamic handler");
  });

  test("static sibling gets wildcard + its own middleware, not the dynamic one", () => {
    const result = router.search("GET", "/user/static");
    expect(result.middlewares?.map((fn) => fn())).toEqual([
      "/user/* middleware",
      "/user/static middleware",
    ]);
    expect(runResult(result)).toBe("static handler");
  });
});

// ---------------------------------------------------------------------------
// Ported from diesel's lib/router/trie.test.ts, run against all three lookup
// strategies peepal exposes (search / optimisedSearch / find) since they each
// re-implement the walk independently and can drift out of sync.
// ---------------------------------------------------------------------------

const LOOKUP_METHODS = ["search", "optimisedSearch", "find"] as const;

for (const method of LOOKUP_METHODS) {
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
