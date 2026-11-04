// Copyright (c) 2026 Pradeep
// Licensed under the MIT License

export const ALL_METHOD = "ALL";

// shared and frozen array for returning midl with 0 func
const NO_MIDDLEWARES: readonly Function[] = Object.freeze([]);

export interface Result {
  params: Record<string, string> | undefined;
  middlewares: Function[] | undefined;
  handler: Array<Function> | undefined;
}

export type StaticMapType = Record<string, Result>

// method slots. keep them non-negative ints - V8 keeps those in the elements
// store, but -1 is the name "-1" and makes every miss a named lookup.
// 0 is never written to, so an unknown method reads a hole.
const METHOD_UNKNOWN = 0;
const METHOD_GET = 1;
const METHOD_POST = 2;
const METHOD_PUT = 3;
const METHOD_DELETE = 4;
const METHOD_PATCH = 5;
const METHOD_ALL = 6;

// slots for methods outside the six above (HEAD, OPTIONS, lowercase, ...).
// an id is only an index, so sharing the counter across routers is harmless.
// must stay past METHOD_ALL, or the first custom method takes the ALL slot.
const extraMethodIds = new Map<string, number>();
let nextMethodId = 7;

/**
 * Maps a method to its handler slot. Does not register unknown methods, so it
 * is safe on the read path - an unregistered method gets METHOD_UNKNOWN, which
 * no handler is ever stored under.
 * @param method - HTTP method, or ALL_METHOD
 * @returns the slot index, or METHOD_UNKNOWN
 */
const lookupMethodId = (method: string): number => {
  if (method === "GET") return METHOD_GET;
  if (method === "POST") return METHOD_POST;
  if (method === "PUT") return METHOD_PUT;
  if (method === "DELETE") return METHOD_DELETE;
  if (method === "PATCH") return METHOD_PATCH;
  if (method === ALL_METHOD) return METHOD_ALL;
  const id = extraMethodIds.get(method);
  return id === undefined ? METHOD_UNKNOWN : id;
};

/**
 * Like lookupMethodId, but hands a fresh slot to a method seen for the first
 * time. Only for the registration path.
 * @param method - HTTP method, or ALL_METHOD
 * @returns the slot index, always a real one
 */
const getOrCreateMethodId = (method: string): number => {
  const id = lookupMethodId(method);
  if (id !== METHOD_UNKNOWN) return id;
  const fresh = nextMethodId++;
  extraMethodIds.set(method, fresh);
  return fresh;
};

class Node {
  children: Record<string, Node>;
  // stores handlers by method slot (see lookupMethodId)
  handlers: Record<number, Function[]> | undefined;
  middlewares: Function[];
  // stores the param name for this node, by method slot
  params: Record<number, string>;

  paramChild: Node | undefined;
  wildcardChild: Node | undefined;
  
  constructor() {
    // don't use {} here , it has Object.prototype
    // so /__proto__ or /constructor gives back an object not undefined
    // and then search walks into it and crashes
    this.children = Object.create(null);
    this.handlers = {};
    this.middlewares = [];
    this.params = {};
    this.wildcardChild = undefined;
    this.paramChild = undefined;
  }
}

export class TrieRouter {
  root: Node;
  globalMiddlewares: Function[];
  is_gm: boolean = false; // is globalMiddlewares

  // pre-computed lookup results for static (no ":" / "*") paths, per method.
  private getStatic: StaticMapType;
  private postStatic: StaticMapType;
  private putStatic: StaticMapType;
  private deleteStatic: StaticMapType;
  private patchStatic: StaticMapType;
  private allStatic: StaticMapType;
  // anything outside the six above (HEAD, OPTIONS, lowercase methods, ...).
  private otherStatic: Record<string, StaticMapType> | null;

  private staticPaths: Set<string>;

  constructor() {
    this.root = new Node();
    this.globalMiddlewares = [];

    this.getStatic = Object.create(null);
    this.postStatic = Object.create(null);
    this.putStatic = Object.create(null);
    this.deleteStatic = Object.create(null);
    this.patchStatic = Object.create(null);
    this.allStatic = Object.create(null);
    this.otherStatic = null;
    this.staticPaths = new Set();
  }

  /**
   * Alias for insert.
   * @param method - HTTP method, or ALL_METHOD to match any
   * @param pattern - route pattern; ":name" is a param, "*" a wildcard
   * @param handler - one handler or an array of them
   */
  add(method: string, pattern: string, handler: Function | Function[]) {
    return this.insert(method, pattern, handler);
  }

  /**
   * Registers a handler for a method and path pattern.
   * @param method - HTTP method, or ALL_METHOD to match any
   * @param pattern - route pattern; ":name" is a param, "*" a wildcard
   * @param handler - one handler or an array of handlers
   */
  insert(method: string, pattern: string, handler: Function | Function[]) {
    const is_static = !pattern.includes(":") && !pattern.includes("*");

    if (is_static) this.staticPaths.add(pattern);

    const isNewMethod = this.getStaticMapFor(method) === undefined;
    this.getOrCreateStaticMapFor(method);

    const handlers = Array.isArray(handler) ? handler : [handler];
    const methodId = getOrCreateMethodId(method);
    let node = this.root;

    if (pattern === "/") {
      node.handlers[methodId] = handlers;
      if (isNewMethod) this.rebuildStatic();
      this.reArrangeHandler(pattern);
      return;
    }

    const pathSegments = pattern.split("/").filter(Boolean);

    for (let i = 0; i < pathSegments.length; i++) {
      const element = pathSegments[i];
      let key = element;
      let cleanParam = "";
      if (element.startsWith(":")) {
        key = ":";
        cleanParam = element.slice(1);
      }

      if (!node.children[key]) node.children[key] = new Node();

      // Add child to parent node;
      if (key === '*') node.wildcardChild = node.children[key];
      if (key === ':') node.paramChild = node.children[key];

      node = node.children[key];
      if (cleanParam) {
        node.params[methodId] = cleanParam;
      }
    }
    node.handlers[methodId] = handlers;

    if (isNewMethod) this.rebuildStatic();
    if (is_static) this.reArrangeHandler(pattern);
  }

  /**
   * Alias for pushMiddleware.
   * @param pattern - path to bind to; "/" makes it global
   * @param handlers - one middleware or an array of handlers
   */
  addMiddleware(pattern: string, handlers: Function | Function[]) {
    return this.pushMiddleware(pattern, handlers);
  }

  /**
   * Binds middleware to a path, then rebuilds the static cache.
   * @param pattern - path to bind to; "/" makes it global
   * @param handlers - one middleware or an array of middlewares
   */
  pushMiddleware(pattern: string, handlers: Function | Function[]) {
    if (!Array.isArray(handlers)) handlers = [handlers];
    if (pattern === "/") {
      this.globalMiddlewares.push(...handlers);
      this.is_gm = true;
      this.rebuildStatic();
      return;
    }

    let node = this.root;
    const pathSegments = pattern.split("/").filter(Boolean);

    for (const element of pathSegments) {
      let key = element;
      if (element.startsWith(":")) {
        key = ":";
      }

      if (!node.children[key]) node.children[key] = new Node();

      // Add child to parent node;
      if (key === '*') node.wildcardChild = node.children[key];
      if (key === ':') node.paramChild = node.children[key];

      node = node.children[key];
    }

    node.middlewares.push(...handlers);

    this.rebuildStatic();
  }

  /**
   * Looks up a route: static cache first, trie walk on a miss.
   * @param method - HTTP method
   * @param pattern - request path
   * @returns params, middlewares, and the matched handler (undefined on a miss)
   */
  search(method: string, pattern: string) {
    const staticMap =
      method === "GET" ? this.getStatic : this.getStaticMapFor(method);
    if (staticMap !== undefined) {
      const result = staticMap[pattern];
      if (result !== undefined) return result;
    }

    let node = this.root;
    const methodId = lookupMethodId(method);
    const pathSegments = pattern.split('/');

    let middlewares: Array<Function> | undefined;
    let params: Record<string, string> | undefined;

    for (let i = 0; i < pathSegments.length; i++) {
      const element = pathSegments[i];
      if (element.length === 0) {
        continue;
      }

      let next = node.children[element];
      if (next !== undefined) {
        if (node.wildcardChild !== undefined) {
          const mw = node.wildcardChild.middlewares;
          if (mw.length > 0) {
            if (middlewares === undefined) {
              middlewares = this.is_gm ? this.globalMiddlewares.slice() : [];
            }
            for (let j = 0; j < mw.length; j++) middlewares.push(mw[j]);
          }
        }
        node = next;
      } else if (node.paramChild !== undefined) {
        if (node.wildcardChild !== undefined) {
          const mw = node.wildcardChild.middlewares;
          if (mw.length > 0) {
            if (middlewares === undefined) {
              middlewares = this.is_gm ? this.globalMiddlewares.slice() : [];
            }
            for (let j = 0; j < mw.length; j++) middlewares.push(mw[j]);
          }
        }
        node = node.paramChild;
        const paramName = node.params[methodId] ?? node.params[METHOD_ALL];
        if (paramName !== undefined) {
          if (params === undefined) params = {};
          params[paramName] = element;
        }
      } else if (node.wildcardChild !== undefined) {
        node = node.wildcardChild;
        break;
      } else {
        return {
          params: params,
          middlewares: middlewares ?? this.defaultMiddlewares(),
          handler: undefined,
        };
      }
    }

    // only the final matched node's own middlewares apply - middleware
    // bound to an ancestor on the walk must not leak into its descendants.
    if (node?.middlewares?.length > 0) {
      const mw = node.middlewares;
      if (middlewares === undefined) {
        middlewares = this.is_gm ? this.globalMiddlewares.slice() : [];
      }
      for (let j = 0; j < mw.length; j++) {
        middlewares.push(mw[j]);
      }
    }

    const methodHandler = node.handlers[methodId] ?? node.handlers[METHOD_ALL];
    return {
      params: params,
      middlewares: middlewares ?? this.defaultMiddlewares(),
      handler: methodHandler,
    };
  }

  /**
   * Alias for {@link search}. Returns `{ params, middlewares, handler }`.
   * @param method - HTTP method
   * @param pattern - request path
   * @returns params, middlewares, and the matched handler (undefined on a miss)
   */
  find(method: string, pattern: string) {
    return this.search(method, pattern);
  }

  /**
   * Looks up the static cache map for a method.
   * @param method - HTTP method, or ALL_METHOD
   * @returns the map, or undefined if the method has none yet
   */
  private getStaticMapFor(method: string): StaticMapType | undefined {
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
        return this.otherStatic ? this.otherStatic[method] : undefined;
    }
  }

  /**
   * Like getStaticMapFor, but creates the map under otherStatic when missing.
   * @param method - HTTP method, or ALL_METHOD
   * @returns the method's static cache map
   */
  private getOrCreateStaticMapFor(method: string): StaticMapType {
    const existing = this.getStaticMapFor(method);
    if (existing !== undefined) return existing;

    if (!this.otherStatic) this.otherStatic = Object.create(null);
    const map: StaticMapType = Object.create(null);
    this.otherStatic[method] = map;
    return map;
  }

  /**
   * Recomputes the static cache entry for one path, for every known method.
   * A method with no handler is dropped so it falls through to the trie walk.
   * @param path - static path to recompute
   */
  private reArrangeHandler(path: string) {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", ALL_METHOD];

    if (this.otherStatic) {
      for (const key in this.otherStatic) methods.push(key);
    }

    for (const method of methods) {
      const map = this.getOrCreateStaticMapFor(method);
      const result = this.uncachedSearch(path, method);
      // if the handler doesn't exist it means , the user hasn't registered the api for that method
      // so we can delete that path for that method map ( it's safe )
      if (result.handler === undefined) {
        delete map[path];
        continue;
      }
      map[path] = result;
    }
  }

  /**
   * Recomputes the static cache for every registered static path.
   */
  private rebuildStatic() {
    for (const p of this.staticPaths) this.reArrangeHandler(p);
  }

  /**
   * Walks the trie for a path, bypassing the static cache.
   * @param path - request path, e.g. "/users/1"
   * @param method - HTTP method, or ALL_METHOD
   * @returns params, middlewares, and the matched handler (undefined on a miss)
   */
  private uncachedSearch(path: string, method: string): Result {
    let node: Node = this.root;
    const methodId = lookupMethodId(method);

    let middlewares: Array<Function> | undefined;
    let params: Record<string, string> | undefined;
    const pathSegments = path.split("/");

    for (let i = 0; i < pathSegments.length; i++) {
      const element = pathSegments[i];
      if (element.length === 0) {
        continue;
      }

      let next = node.children[element];
      if (next !== undefined) {
        if (node.wildcardChild !== undefined) {
          const mw = node.wildcardChild.middlewares;
          if (mw.length > 0) {
            if (middlewares === undefined) {
              middlewares = this.is_gm ? this.globalMiddlewares.slice() : [];
            }
            for (let j = 0; j < mw.length; j++) middlewares.push(mw[j]);
          }
        }
        node = next;
      } else if (node.paramChild !== undefined) {
        if (node.wildcardChild !== undefined) {
          const mw = node.wildcardChild.middlewares;
          if (mw.length > 0) {
            if (middlewares === undefined) {
              middlewares = this.is_gm ? this.globalMiddlewares.slice() : [];
            }
            for (let j = 0; j < mw.length; j++) middlewares.push(mw[j]);
          }
        }
        node = node.paramChild;
        const paramName = node.params[methodId] ?? node.params[METHOD_ALL];
        if (paramName !== undefined) {
          if (params === undefined) params = {};
          params[paramName] = element;
        }
      } else if (node.wildcardChild !== undefined) {
        node = node.wildcardChild;
        break;
      } else {
        return {
          params: params,
          middlewares: middlewares ?? this.defaultMiddlewares(),
          handler: undefined,
        };
      }
    }

    if (node?.middlewares?.length > 0) {
      const mw = node.middlewares;
      if (middlewares === undefined) {
        middlewares = this.is_gm ? this.globalMiddlewares.slice() : [];
      }
      for (let j = 0; j < mw.length; j++) {
        middlewares.push(mw[j]);
      }
    }

    const methodHandler = node.handlers[methodId] ?? node.handlers[METHOD_ALL];
    return {
      params: params,
      middlewares: middlewares ?? this.defaultMiddlewares(),
      handler: methodHandler,
    };
  }

  /**
   * The middleware list for a lookup that collected none of its own. Global
   * middlewares are copied because callers may mutate the result; with none
   * registered, every such lookup shares one frozen empty array.
   * @returns the middlewares to hand back when none were collected
   */
  private defaultMiddlewares(): Function[] {
    return this.is_gm
      ? this.globalMiddlewares.slice()
      : (NO_MIDDLEWARES as Function[]);
  }

  private collectStaticMiddlewares(path: string) {
    // will imple myself , don't touch it.
  }
}
