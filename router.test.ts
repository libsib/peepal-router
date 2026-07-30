import { describe, expect, test, beforeAll } from "bun:test";
import { TrieRouter } from "./router";

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

describe("TrieRouter - Basic Routing", () => {

  test("root route", () => {
    const result = router.search("GET", "/");
    expect(runHandlers(result?.handler)).toBe("root");
  });

  test("static route", () => {
    const result = router.search("GET", "/about");
    expect(runHandlers(result?.handler)).toBe("about page");
  });

  test("dynamic route", () => {
    const result = router.search("GET", "/user/123");
    expect(runHandlers(result?.handler)).toBe("dynamic user");
  });

  test("wildcard route", () => {
    const result = router.search("GET", "/files/images/photo.png");
    expect(runHandlers(result?.handler)).toBe("catch all");
  });

  test("multiple methods", () => {
    const getResult = router.search("GET", "/api/data");
    const postResult = router.search("POST", "/api/data");

    expect(runHandlers(getResult?.handler)).toBe("GET handler");
    expect(runHandlers(postResult?.handler)).toBe("POST handler");
  });

  test("method not found", () => {
    const result = router.search("PUT", "/api/data");
    expect(result?.handler).toBeEmpty()
  });

  test("deep dynamic route", () => {
    const result = router.search("GET", "/a/123/c/456/e");
    expect(runHandlers(result?.handler)).toBe("nested");
  });

  test("prefer exact over dynamic", () => {
    const result = router.search("GET", "/user/profile");
    expect(runHandlers(result?.handler)).toBe("static profile");
  });

  test("non-existent route", () => {
    const result = router.search("GET", "/non-existent");
    expect(result?.handler).toBeEmpty()
  });
});

describe("TrieRouter - ALL method fallback", () => {
  let router: TrieRouter;

  beforeAll(() => {
    router = new TrieRouter();
    router.add("ALL", "/x", () => "ALL handler");
    router.add("GET", "/y", () => "GET handler");
    router.add("ALL", "/y", () => "ALL handler");
  });

  test("falls back to ALL handler when method has no specific handler", () => {
    const getResult = router.search("GET", "/x");
    const postResult = router.search("POST", "/x");

    expect(runHandlers(getResult?.handler)).toBe("ALL handler");
    expect(runHandlers(postResult?.handler)).toBe("ALL handler");
  });

  test("prefers specific-method handler over ALL handler", () => {
    const result = router.search("GET", "/y");
    expect(runHandlers(result?.handler)).toBe("GET handler");
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
        r.addMiddleware('/user/*', () => "/user* level")
        r.addMiddleware('/user/name', () => '/user/* and /user/name')
        r.add('GET', '/user/name', () => 'handler')
    })

    test("should only contain global if no handler for a path or method", () => {
        let rs = r.search('POST', '/users/name') // method won't match
        let outputs = rs?.handler?.map(fn => fn())
        expect(outputs).toEqual(["global"])

        rs = r.search('GET', '/users/name') // path wont match
        outputs = rs.handler?.map(fn => fn())
        expect(outputs).toEqual(["global"])
    })

    test("collects all matching middleware", () => {
        const result = r.search('GET', '/user/name')
        const outputs = result?.handler?.map(fn => fn())
        expect(outputs).toEqual(["global", "/user* level", '/user/* and /user/name', 'handler'])
    })

    test("collect only users/ level handlers", () => {
        const rs = r.search('GET', '/users')
        const outputs = rs.handler?.map(fn => fn())
        expect(outputs).toEqual(['global','users level'])
    })

 })

// ---------------------------------------------------------------------------
// Ported from diesel's lib/router/trie.test.ts
// Diesel fixed the middleware-scoping bug (620b6e1) but never fixed the
// backtracking bug (still fails on diesel's own suite too - "fix/router-backtracking"
// branch didn't actually land a fix). Both scenarios are run against all three
// lookup strategies peepal exposes (search / optimisedSearch / find) since they
// each re-implement the walk independently and can drift out of sync.
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
      expect(result.handler?.length).toBe(1);
    });

    test("should include wildcard middleware for matching descendant", () => {
      const result = (r as any)[method]("GET", "/user/me");
      // 1 middleware + 1 handler
      expect(result.handler?.length).toBe(2);
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
      const handler = result.handler ?? [];
      expect(handler[handler.length - 1]?.()).toBe("settings");
    });

    test("should match /users/123/posts (dynamic branch)", () => {
      const result = (r as any)[method]("GET", "/users/123/posts");
      const handler = result.handler ?? [];
      expect(handler[handler.length - 1]?.()).toBe("posts");
    });

    // known gap: the trie doesn't retry the ":" branch after the static "me"
    // branch dead-ends past its first segment. Not fixed yet - see PR #1 review.
    test.todo("should match /users/me/posts by backtracking off the static 'me' branch", () => {
      const result = (r as any)[method]("GET", "/users/me/posts");
      const handler = result.handler ?? [];
      expect(handler[handler.length - 1]?.()).toBe("posts");
    });
  });
}