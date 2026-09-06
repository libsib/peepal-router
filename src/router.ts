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

class Node {
  children: Record<string, Node>;
  isEndOfWord: boolean;
  handlers: Record<string, Function[]> | undefined;
  middlewares: Function[];
  params: Record<string, string>;
  finalHandler: Record<string, Array<Function> | undefined>;
  
  //
  paramChild: Node | undefined;
  wildcardChild: Node | undefined;
  
  constructor() {
    // don't use {} here , it has Object.prototype
    // so /__proto__ or /constructor gives back an object not undefined
    // and then search walks into it and crashes
    this.children = Object.create(null);
    this.handlers = {};
    this.isEndOfWord = false;
    this.middlewares = [];
    this.params = {};
    this.finalHandler = undefined;
    this.wildcardChild = undefined;
    this.paramChild = undefined;
  }
}

export class TrieRouter {
  root: Node;
  globalMiddlewares: Function[];
  is_gm: boolean = false; // is globalMiddlewares
  isCompiled: boolean;
  find: Function;

  // pre-computed lookup results for static (no ":" / "*") paths, per method.
  private getStatic: Map<string, Result>;
  private postStatic: Map<string, Result>;
  private putStatic: Map<string, Result>;
  private deleteStatic: Map<string, Result>;
  private patchStatic: Map<string, Result>;
  private allStatic: Map<string, Result>;
  // anything outside the six above (HEAD, OPTIONS, lowercase methods, ...).
  private otherStatic: Map<string, Map<string, Result>> | null;

  private staticPaths: Set<string>;

  constructor() {
    this.root = new Node();
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
    this.staticPaths = new Set();
  }

  /**
   * Walks the trie for a path, bypassing the static cache.
   * @param path - request path, e.g. "/users/1"
   * @param method - HTTP method, or ALL_METHOD
   * @returns params, middlewares, and the matched handler (undefined on a miss)
   */
  private uncachedSearch(path: string, method: string): Result {
    let node: Node = this.root;

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
        if (params === undefined) params = {};
        params[node.params[method]] = element;
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

    const methodHandler = node.handlers[method] || node.handlers[ALL_METHOD];
    return {
      params: params,
      middlewares: middlewares ?? this.defaultMiddlewares(),
      handler: methodHandler,
    };
  }

  private collectStaticMiddlewares(path: string) {
    // will imple myself , don't touch it.
  }
  
  /**
   * Recomputes the static cache entry for one path, for every known method.
   * A method with no handler is dropped so it falls through to the trie walk.
   * @param path - static path to recompute
   */
  private reArrangeHandler(path: string) {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", ALL_METHOD];

    if (this.otherStatic) {
      for (const m of this.otherStatic.keys()) methods.push(m);
    }

    for (const method of methods) {
      const map = this.getOrCreateStaticMapFor(method);
      const result = this.uncachedSearch(path, method);
      // if the handler doesn't exist it means , the user hasn't registered the api for that method
      // so we can delete that path for that method map ( it's safe )
      if (result.handler === undefined) {
        map.delete(path);
        continue;
      }
      map.set(path, result);
    }
  }

  /**
   * Recomputes the static cache for every registered static path.
   */
  private rebuildStatic() {
    for (const p of this.staticPaths) this.reArrangeHandler(p);
  }

  /**
   * Looks up the static cache map for a method.
   * @param method - HTTP method, or ALL_METHOD
   * @returns the map, or undefined if the method has none yet
   */
  private getStaticMapFor(method: string): Map<string, Result> | undefined {
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

  /**
   * Like getStaticMapFor, but creates the map under otherStatic when missing.
   * @param method - HTTP method, or ALL_METHOD
   * @returns the method's static cache map
   */
  private getOrCreateStaticMapFor(method: string): Map<string, Result> {
    const existing = this.getStaticMapFor(method);
    if (existing !== undefined) return existing;

    if (!this.otherStatic) this.otherStatic = new Map();
    const map: Map<string, Result> = new Map();
    this.otherStatic.set(method, map);
    return map;
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

    node.isEndOfWord = true;
    this.rebuildStatic();
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
    let node = this.root;

    if (pattern === "/") {
      node.isEndOfWord = true;
      node.handlers[method] = handlers;
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
        node.params[method] = cleanParam;
      }
    }
    node.handlers[method] = handlers;
    node.isEndOfWord = true;

    if (isNewMethod) this.rebuildStatic();
    if (is_static) this.reArrangeHandler(pattern);
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
   * Looks up a route: static cache first, trie walk on a miss.
   * @param method - HTTP method
   * @param pattern - request path
   * @returns params, middlewares, and the matched handler (undefined on a miss)
   */
  search(method: string, pattern: string) {
    const staticMap =
      method === "GET" ? this.getStatic : this.getStaticMapFor(method);
    if (staticMap !== undefined) {
      const result = staticMap.get(pattern);
      if (result !== undefined) return result;
    }

    let node = this.root;
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
        if (params === undefined) params = {};
        params[node.params[method]] = element;
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

    const methodHandler = node.handlers[method] || node.handlers[ALL_METHOD];
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

  /**
   * Like search, but scans the path char by char instead of splitting it.
   * @param method - HTTP method
   * @param pattern - request path
   * @returns params, middlewares, and the matched handler (undefined on a miss)
   */
  optimisedSearch(method: string, pattern: string) {
    const staticMap =
      method === "GET" ? this.getStatic : this.getStaticMapFor(method);
    if (staticMap !== undefined) {
      const result = staticMap.get(pattern);
      if (result !== undefined) return result;
    }

    let node = this.root;
    let element = "";

    let middlewares: Array<Function> | undefined;
    let params: Record<string, string> | undefined;

    for (let i = 0; i <= pattern.length; i++) {
      const char = pattern[i];

      if (char === "/" || i === pattern.length) {
        if (element.length === 0) continue;

        // node search
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
          if (params === undefined) params = {};
          params[node.params[method]] = element;
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
      if (middlewares === undefined) {
        middlewares = this.is_gm ? this.globalMiddlewares.slice() : [];
      }
      for (let j = 0; j < mw.length; j++) {
        middlewares.push(mw[j]);
      }
    }

    const methodHandler = node.handlers[method] || node.handlers[ALL_METHOD];
    return {
      params: params,
      middlewares: middlewares ?? this.defaultMiddlewares(),
      handler: methodHandler,
    };
  }

  /**
   * Looks up a route using precompiled handler chains; needs compile() first.
   * Middlewares are already baked into the chain, so none are returned.
   * @param method - HTTP method
   * @param pattern - request path
   * @returns params and the compiled handler chain (undefined on a miss)
   * @remarks unstable API
   */
  compiledFind(method: string, pattern: string) {
    let node = this.root;
    const pathSegments = pattern.split("/");

    let params: Record<string, string> | undefined;

    for (let i = 0; i < pathSegments.length; i++) {
      const element = pathSegments[i];
      if (element.length === 0) {
        continue;
      }

      let next = node.children[element];
      if (next !== undefined) {
        node = next;
      } else if (node.paramChild !== undefined) {
        node = node.paramChild;
        if (params === undefined) params = {};
        params[node.params[method]] = element;
      } else if (node.wildcardChild !== undefined) {
        node = node.wildcardChild;
        break;
      } else {
        return {
          params: params,
          middlewares: undefined,
          handler:
            node?.finalHandler?.[method] ?? node?.finalHandler?.[ALL_METHOD],
        };
      }
    }
    return {
      params: params,
      middlewares: undefined,
      handler: node?.finalHandler?.[method] ?? node?.finalHandler?.[ALL_METHOD],
    };
  }
  /**
   * First find() call: compiles the trie, swaps find() for compiledFind, then delegates.
   * @param method - HTTP method
   * @param pattern - request path
   * @returns the same shape as compiledFind
   * @remarks unstable API
   */
  private lazyFind(method: string, pattern: string) {
    this.compile();

    this.find = this.compiledFind;
    return this.compiledFind(method, pattern);
  }

  /**
   * Bakes middlewares into each route's handler chain, ready for compiledFind.
   */
  compile() {
    this.compileNode(this.root, this.globalMiddlewares);
  }

  /**
   * Recursively builds finalHandler for a node and its descendants.
   * @param node - node to compile
   * @param inheritedMiddlewares - middlewares inherited from ancestors
   * @remarks unstable API
   */
  private compileNode(node: Node, inheritedMiddlewares: Array<Function>) {
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
    const wildcard = node.wildcardChild;
    for (const key in node.children) {
      const childInherited =
        wildcard && key !== "*" && wildcard.middlewares.length > 0
          ? [...inheritedMiddlewares, ...wildcard.middlewares]
          : inheritedMiddlewares;
      this.compileNode(node.children[key], childInherited);
    }
  }
}
