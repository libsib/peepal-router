// Copyright (c) 2026 Pradeep
// Licensed under the MIT License

import type { Find } from "./radix.js";

export const ALL_METHOD = "ALL";

class TrieNodes {
  children: Record<string, TrieNodes>;
  isEndOfWord: boolean;
  handlers: Record<string, Function[]> | undefined;
  middlewares: Function[];
  params: Record<string, string>;
  finalHandler: Record<string, Array<Function> | undefined>;
  constructor() {
    this.children = {};
    this.handlers = {};
    this.isEndOfWord = false;
    this.middlewares = [];
    this.params = {};
    this.finalHandler = undefined;
  }
}

export class TrieRouter {
  root: TrieNodes;
  globalMiddlewares: Function[];
  is_gm: boolean = false; // is globalMiddlewares
  isCompiled: boolean;
  find: Function;
  // Set once an ALL route is registered, so the static fast path can skip
  // its ALL fallback lookup entirely in the common case where none exist.
  private hasAllMethod: boolean = false;

  // Method-segregated static lookup maps. A route with no ":" or "*" resolves
  // to exactly one prebuilt result, so it can be answered by a single Map.get
  // instead of walking the trie. Kept per-method so the hot path needs no
  // string concatenation to build a cache key.
  private getStatic: Map<string, Find>;
  private postStatic: Map<string, Find>;
  private putStatic: Map<string, Find>;
  private deleteStatic: Map<string, Find>;
  private patchStatic: Map<string, Find>;
  private allStatic: Map<string, Find>;
  // Anything outside the six above (HEAD, OPTIONS, lowercase methods, ...).
  private otherStatic: Map<string, Map<string, Find>> | null;

  constructor() {
    this.root = new TrieNodes();
    this.globalMiddlewares = [];
    this.isCompiled = false;
    this.find = this.lazyFind;

    this.getStatic = new Map();
    this.postStatic = new Map();
    this.putStatic = new Map();
    this.deleteStatic = new Map();
    this.patchStatic = new Map();
    this.allStatic = new Map();
    this.otherStatic = null;
  }

  // Read-side accessor: returns undefined when the method has no static map
  // yet, so search() can fall straight through to the trie walk.
  private staticMapFor(method: string): Map<string, Find> | undefined {
    switch (method) {
      case "GET":
        return this.getStatic;
      case "POST":
        return this.postStatic;
      case "PUT":
        return this.putStatic;
      case "DELETE":
        return this.deleteStatic;
      case "PATCH":
        return this.patchStatic;
      case ALL_METHOD:
        return this.allStatic;
      default:
        return this.otherStatic ? this.otherStatic.get(method) : undefined;
    }
  }

  // Write-side accessor: used at insert() time, so allocating a map for a
  // rare method is a one-off registration cost, not a per-request one.
  private createStaticMapFor(method: string): Map<string, Find> {
    const existing = this.staticMapFor(method);
    if (existing !== undefined) return existing;

    if (!this.otherStatic) this.otherStatic = new Map();
    const map: Map<string, Find> = new Map();
    this.otherStatic.set(method, map);
    return map;
  }

  // Stores the one result a static route can ever produce, so search() can
  // answer it with a single Map.get and zero allocations.
  //
  // The middleware list is only correct as of now: pushMiddleware() may be
  // called after insert(), which is why it re-runs the collector over every
  // cached entry via rebuildStaticMap().
  private cacheStaticRoute(method: string, path: string, handlers: Function[]): void {
    const map = this.createStaticMapFor(method);
    const entry: Find = {
      params: undefined,
      middlewares: this.collectStaticMiddlewares(path),
      handler: handlers,
    };

    // Both spellings share one entry object, so a later middleware refresh
    // updates them together and repeat lookups return an identical object.
    map.set(path, entry);
    map.set(path === "/" ? "" : path + "/", entry);
  }

  // Reproduces exactly what search()'s walk accumulates for a static path:
  // the global middlewares, then the "*" sibling's middlewares at each level
  // as the walk descends, then the destination node's own middlewares.
  // Middleware bound to an ancestor must NOT leak into descendants, which is
  // why only the final node's own list is appended. This has to stay in
  // lockstep with search() - if that ordering changes, change it here too.
  private collectStaticMiddlewares(path: string): Function[] {
    const middlewares: Function[] = this.is_gm ? this.globalMiddlewares.slice() : [];

    let node = this.root;
    const pathSegments = path.split("/");

    for (let i = 0; i < pathSegments.length; i++) {
      const element = pathSegments[i];
      if (element.length === 0) continue;

      // Defensive: insert() created every segment of this path, so a miss
      // should be unreachable. Bail rather than mis-attribute middleware.
      const child = node.children[element];
      if (!child) break;

      const wildcard = node.children["*"];
      if (wildcard && wildcard.middlewares.length > 0) {
        const mw = wildcard.middlewares;
        for (let j = 0; j < mw.length; j++) middlewares.push(mw[j]);
      }

      node = child;
    }

    const own = node.middlewares;
    if (own && own.length > 0) {
      for (let j = 0; j < own.length; j++) middlewares.push(own[j]);
    }

    return middlewares;
  }

  // Middleware can be registered after the routes it applies to, so every
  // precollected list is recomputed whenever the middleware set changes.
  // Registration-time cost only - it keeps the request path a pure lookup.
  private rebuildStaticMap(): void {
    const maps: Map<string, Find>[] = [
      this.getStatic,
      this.postStatic,
      this.putStatic,
      this.deleteStatic,
      this.patchStatic,
      this.allStatic,
    ];

    if (this.otherStatic) {
      for (const m of this.otherStatic.values()) maps.push(m);
    }

    for (let i = 0; i < maps.length; i++) {
      for (const [path, entry] of maps[i]) {
        entry.middlewares = this.collectStaticMiddlewares(path);
      }
    }
  }

  addMiddleware(pattern: string, handlers: Function | Function[]) {
    return this.pushMiddleware(pattern, handlers);
  }

  pushMiddleware(pattern: string, handlers: Function | Function[]) {
    if (!Array.isArray(handlers)) handlers = [handlers];
    if (pattern === "/") {
      this.globalMiddlewares.push(...handlers);
      this.is_gm = true;
      this.rebuildStaticMap();
      return;
    }

    let node = this.root;
    const pathSegments = pattern.split("/").filter(Boolean);

    for (const element of pathSegments) {
      let key = element;
      if (element.startsWith(":")) {
        key = ":";
      }

      if (!node.children[key]) node.children[key] = new TrieNodes();

      node = node.children[key];
    }

    node.middlewares.push(...handlers);

    node.isEndOfWord = true;

    this.rebuildStaticMap();
  }

  insert(method: string, pattern: string, handler: Function | Function[]) {
    const handlers = Array.isArray(handler) ? handler : [handler];
    let node = this.root;

    if (method === ALL_METHOD) this.hasAllMethod = true;

    if (pattern === "/") {
      node.isEndOfWord = true;
      node.handlers[method] = handlers;
      this.cacheStaticRoute(method, "/", handlers);
      return;
    }

    const pathSegments = pattern.split("/").filter(Boolean);
    // Determined during the walk rather than by scanning the raw pattern, so
    // it agrees exactly with how the trie interprets each segment: only a
    // segment starting with ":" is a param, and only a segment that is
    // exactly "*" is a wildcard. "/a:b" is a static segment to the trie, so
    // it must stay eligible for the static fast path too.
    let isStatic = true;

    for (let i = 0; i < pathSegments.length; i++) {
      const element = pathSegments[i];
      let key = element;
      let cleanParam = "";
      if (element.startsWith(":")) {
        key = ":";
        cleanParam = element.slice(1);
        isStatic = false;
      } else if (element === "*") {
        isStatic = false;
      }

      if (!node.children[key]) node.children[key] = new TrieNodes();

      node = node.children[key];
      if (cleanParam) {
        node.params[method] = cleanParam;
      }
    }
    node.handlers[method] = handlers;
    node.isEndOfWord = true;

    if (isStatic) {
      // Rebuilt from the filtered segments so duplicate/trailing slashes are
      // collapsed into the same canonical key a request path would produce.
      this.cacheStaticRoute(method, "/" + pathSegments.join("/"), handlers);
    }
  }

  add(method: string, pattern: string, handler: Function | Function[]) {
    return this.insert(method, pattern, handler);
  }

  search(method: string, pattern: string) {
    // Static fast path. A route with no ":" or "*" has exactly one possible
    // result, fully precomputed at registration time - so this is one
    // Map.get and a return, with no split(), no params object, no middleware
    // array and no result literal allocated.
    //
    // A miss is always safe: it falls through to the walk below, which stays
    // the single source of truth for dynamic routes. And a hit always agrees
    // with the walk, because the walk prefers an exact static child at every
    // level, so it could only ever have reached this same node.
    // The size checks matter: a method with no static routes at all (an API
    // where every POST route is dynamic, say) would otherwise pay a string
    // hash per request to miss an empty map. `size` is just a field read.
    const staticMap = this.staticMapFor(method);
    if (staticMap !== undefined && staticMap.size !== 0) {
      const hit = staticMap.get(pattern);
      if (hit !== undefined) return hit;
    }
    // Mirrors the walk's `handlers[method] || handlers[ALL_METHOD]` fallback.
    if (this.hasAllMethod && method !== ALL_METHOD && this.allStatic.size !== 0) {
      const allHit = this.allStatic.get(pattern);
      if (allHit !== undefined) return allHit;
    }

    let node = this.root;
    const pathSegments = pattern.split("/");

    let middlewares: Array<Function> = this.is_gm ? this.globalMiddlewares.slice() : [];
    let params: Record<string, string> | undefined;

    for (let i = 0; i < pathSegments.length; i++) {
      const element = pathSegments[i];
      if (element.length === 0) {
        continue;
      }

      const wildcard = node.children["*"];
      if (node.children[element]) {
        if (wildcard && wildcard.middlewares.length > 0) {
          const mw = wildcard.middlewares;
          for (let j = 0; j < mw.length; j++) middlewares.push(mw[j]);
        }
        node = node.children[element]!;
      } else if (node.children[":"]) {
        if (wildcard && wildcard.middlewares.length > 0) {
          const mw = wildcard.middlewares;
          for (let j = 0; j < mw.length; j++) middlewares.push(mw[j]);
        }
        node = node.children[":"];
        if (!params) params = {};
        params[node.params[method]] = element;
      } else if (wildcard) {
        node = wildcard;
        break;
      } else {
        return { params: params, middlewares: middlewares, handler: undefined };
      }
    }

    // only the final matched node's own middlewares apply - middleware
    // bound to an ancestor on the walk must not leak into its descendants.
    if (node?.middlewares?.length > 0) {
      const mw = node.middlewares;
      for (let j = 0; j < mw.length; j++) {
        middlewares.push(mw[j]);
      }
    }

    const methodHandler = node.handlers[method] || node.handlers[ALL_METHOD];
    return {
      params: params,
      middlewares: middlewares,
      handler: methodHandler,
    };
  }

  optimisedSearch(method: string, pattern: string) {
    let node = this.root;
    let element = "";

    let middlewares: Array<Function> = this.is_gm ? this.globalMiddlewares.slice() : [];
    let params: Record<string, string> | undefined;

    for (let i = 0; i <= pattern.length; i++) {
      const char = pattern[i];

      if (char === "/" || i === pattern.length) {
        if (element.length === 0) continue;

        const wildcard = node.children["*"];
        // node search
        if (node.children[element]) {
          if (wildcard && wildcard.middlewares.length > 0) {
            const mw = wildcard.middlewares;
            for (let j = 0; j < mw.length; j++) middlewares.push(mw[j]);
          }
          node = node.children[element];
        } else if (node.children[":"]) {
          if (wildcard && wildcard.middlewares.length > 0) {
            const mw = wildcard.middlewares;
            for (let j = 0; j < mw.length; j++) middlewares.push(mw[j]);
          }
          node = node.children[":"];
          if (!params) params = {};
          params[node.params[method]] = element;
        } else if (wildcard) {
          node = wildcard;
          break;
        } else {
          return { params: params, middlewares: middlewares, handler: undefined };
        }

        element = "";
      } else {
        // element = element.concat(char)
        element += char;
      }
    }

    // only the final matched node's own middlewares apply - middleware
    // bound to an ancestor on the walk must not leak into its descendants.
    if (node?.middlewares?.length > 0) {
      const mw = node.middlewares;
      for (let j = 0; j < mw.length; j++) {
        middlewares.push(mw[j]);
      }
    }

    const methodHandler = node.handlers[method] || node.handlers[ALL_METHOD];
    return {
      params: params,
      middlewares: middlewares,
      handler: methodHandler,
    };
  }

  // unstable API
  compiledFind(method: string, pattern: string) {
    let node = this.root;
    const pathSegments = pattern.split("/");

    let params: Record<string, string> | undefined;

    for (let i = 0; i < pathSegments.length; i++) {
      const element = pathSegments[i];
      if (element.length === 0) {
        continue;
      }

      if (node.children[element]) {
        node = node.children[element]!;
      } else if (node.children[":"]) {
        node = node.children[":"];
        if (!params) params = {};
        params[node.params[method]] = element;
      } else if (node.children["*"]) {
        node = node.children["*"];
        break;
      } else {
        return {
          params: params,
          middlewares: undefined,
          handler: node?.finalHandler?.[method] ?? node?.finalHandler?.[ALL_METHOD],
        };
      }
    }
    return {
      params: params,
      middlewares: undefined,
      handler: node?.finalHandler?.[method] ?? node?.finalHandler?.[ALL_METHOD],
    };
  }
  // unstabel api
  private lazyFind(method: string, pattern: string) {
    this.compile();

    this.find = this.compiledFind;
    return this.compiledFind(method, pattern);
  }

  compile() {
    this.compileNode(this.root, this.globalMiddlewares);
  }

  // unstable api
  // Compile method which will compile all these routes once our application registers all it's route.
  private compileNode(node: TrieNodes, inheritedMiddlewares: Array<Function>) {
    // a node's own middlewares apply only to itself, they must not be
    // inherited by descendants - mirrors search()'s scoping.
    if (node.isEndOfWord) {
      if (!node.finalHandler) node.finalHandler = {};
      const ownMiddlewares = [...inheritedMiddlewares, ...node?.middlewares];
      for (const method in node.handlers) {
        const finalHandler = [...ownMiddlewares, ...node.handlers[method]];
        node.finalHandler[method] = finalHandler;
      }
    }

    // a "*" child cascades to its non-wildcard siblings' descendants,
    // regardless of which branch search()/find() actually takes at runtime.
    const wildcard = node.children["*"];
    for (const key in node.children) {
      const childInherited =
        wildcard && key !== "*" && wildcard.middlewares.length > 0
          ? [...inheritedMiddlewares, ...wildcard.middlewares]
          : inheritedMiddlewares;
      this.compileNode(node.children[key], childInherited);
    }
  }
}
