// Copyright (c) 2026 Pradeep
// Licensed under the MIT License

export const ALL_METHOD = "ALL";

export interface Find {
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
  root: Node;
  globalMiddlewares: Function[];
  is_gm: boolean = false; // is globalMiddlewares
  isCompiled: boolean;
  find: Function;

  // Precomputed lookup results for static (no ":" / "*") paths, per method.
  private getStatic: Map<string, Find>;
  private postStatic: Map<string, Find>;
  private putStatic: Map<string, Find>;
  private deleteStatic: Map<string, Find>;
  private patchStatic: Map<string, Find>;
  private allStatic: Map<string, Find>;
  // Anything outside the six above (HEAD, OPTIONS, lowercase methods, ...).
  private otherStatic: Map<string, Map<string, Find>> | null;

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

  private uncachedSearch(path: string, method: string): Find {
    let node: Node = this.root;

    let middlewares: Array<Function> = this.is_gm
      ? this.globalMiddlewares.slice()
      : [];
    let params: Record<string, string> | undefined;
    const pathSegments = path.split("/");

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

  private reArrangeHandler(path: string) {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", ALL_METHOD];

    if (this.otherStatic) {
      for (const m of this.otherStatic.keys()) methods.push(m);
    }

    for (const method of methods) {
      const map = this.createStaticMapFor(method);
      const result = this.uncachedSearch(path, method);
      // Never cache a miss: it would shadow the trie walk.
      if (result.handler === undefined) {
        map.delete(path);
        continue;
      }
      map.set(path, result);
    }
  }

  private rebuildStatic() {
    for (const p of this.staticPaths) this.reArrangeHandler(p);
  }

  private getStaticMapFor(method: string): Map<string, Find> | undefined {
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

  private createStaticMapFor(method: string): Map<string, Find> {
    const existing = this.getStaticMapFor(method);
    if (existing !== undefined) return existing;

    if (!this.otherStatic) this.otherStatic = new Map();
    const map: Map<string, Find> = new Map();
    this.otherStatic.set(method, map);
    return map;
  }

  addMiddleware(pattern: string, handlers: Function | Function[]) {
    return this.pushMiddleware(pattern, handlers);
  }

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

      node = node.children[key];
    }

    node.middlewares.push(...handlers);

    node.isEndOfWord = true;
    this.rebuildStatic();
  }

  insert(method: string, pattern: string, handler: Function | Function[]) {
    const is_static = !pattern.includes(":") && !pattern.includes("*");

    if (is_static) this.staticPaths.add(pattern);

    const isNewMethod = this.getStaticMapFor(method) === undefined;
    this.createStaticMapFor(method);

    const handlers = Array.isArray(handler) ? handler : [handler];
    let node = this.root;

    if (pattern === "/") {
      node.isEndOfWord = true;
      node.handlers[method] = handlers;
      if (isNewMethod) this.rebuildStatic();
      else this.reArrangeHandler(pattern);
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

      node = node.children[key];
      if (cleanParam) {
        node.params[method] = cleanParam;
      }
    }
    node.handlers[method] = handlers;
    node.isEndOfWord = true;

    if (isNewMethod) this.rebuildStatic();
    else if (is_static) this.reArrangeHandler(pattern);
  }

  add(method: string, pattern: string, handler: Function | Function[]) {
    return this.insert(method, pattern, handler);
  }

  search(method: string, pattern: string) {
    const staticMap = method === "GET" ? this.getStatic : this.getStaticMapFor(method);
    if (staticMap !== undefined) {
      const result = staticMap.get(pattern);
      if (result !== undefined) return result;
    }

    let node = this.root;
    const pathSegments = pattern.split("/");

    let middlewares: Array<Function> = this.is_gm
      ? this.globalMiddlewares.slice()
      : [];
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

    let middlewares: Array<Function> = this.is_gm
      ? this.globalMiddlewares.slice()
      : [];
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
          return {
            params: params,
            middlewares: middlewares,
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
