import { describe, expect, test, beforeAll } from "bun:test";
import { TrieRouter, ALL_METHOD } from "./router";
import { runResult } from "./router.test-utils";
import {
  describeDieselPortedCases,
  describeLazyMiddlewareCases,
} from "./router.shared-cases";

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

describe("TrieRouter.search - Basic Routing", () => {

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

describe("TrieRouter.search - ALL_METHOD fallback", () => {
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

describe("TrieRouter.search - Middleware Path Matching", () => {

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

describe("TrieRouter.search - wildcard and dynamic middlewares combined", () => {
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

describeDieselPortedCases("search");
describeLazyMiddlewareCases("search");
