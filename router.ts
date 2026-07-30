// Copyright (c) 2026 Pradeep
// Licensed under the MIT License

class TrieNodes {
  children: Record<string, TrieNodes>;
  isEndOfWord: boolean;
  handlers: Record<string, Function> | undefined;
  middlewares: Function[];
  paramName: string;
  finalHandler: Record<string, Array<Function> | undefined>;
  constructor() {
    this.children = {};
    this.handlers = {};
    this.isEndOfWord = false;
    this.middlewares = [];
    this.paramName = "";
    this.finalHandler = undefined;
  }
}

//
export class TrieRouter {
  root: TrieNodes;
  globalMiddlewares: Function[];
  isCompiled: boolean;
  find: Function;
  constructor() {
    this.root = new TrieNodes();
    this.globalMiddlewares = [];
    this.isCompiled = false;
    this.find = this.lazyFind;
  }

  addMiddleware(pattern: string, handlers: Function | Function[]) {
    return this.pushMiddleware(pattern, handlers);
  }

  pushMiddleware(pattern: string, handlers: Function | Function[]) {
    if (!Array.isArray(handlers)) handlers = [handlers];
    if (pattern === "/") {
      this.globalMiddlewares.push(...handlers);
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
  }

  insert(method: string, pattern: string, handler: Function) {
    let node = this.root;

    if (pattern === "/") {
      node.isEndOfWord = true;
      node.handlers[method] = handler;
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

      if (!node.children[key]) node.children[key] = new TrieNodes();

      node = node.children[key];
      if (cleanParam) {
        node.paramName = cleanParam;
      }
    }
    node.handlers[method] = handler;
    node.isEndOfWord = true;
  }

  add(method: string, pattern: string, handler: Function) {
    return this.insert(method, pattern, handler);
  }

  search(method: string, pattern: string) {
    let node = this.root;
    const pathSegments = pattern.split("/");

    let collected: Array<Function> | undefined;
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
          if (!collected) collected = this.globalMiddlewares.slice();
          for (let j = 0; j < mw.length; j++) collected.push(mw[j]);
        }
        node = node.children[element]!;
      } else if (node.children[":"]) {
        if (wildcard && wildcard.middlewares.length > 0) {
          const mw = wildcard.middlewares;
          if (!collected) collected = this.globalMiddlewares.slice();
          for (let j = 0; j < mw.length; j++) collected.push(mw[j]);
        }
        node = node.children[":"];
        if (!params) params = {};
        params[node.paramName] = element;
      } else if (wildcard) {
        node = wildcard;
        break;
      } else {
        return {
          params: params,
          handler: this.globalMiddlewares,
        };
      }
    }

    // only the final matched node's own middlewares apply - middleware
    // bound to an ancestor on the walk must not leak into its descendants.
    if (node?.middlewares?.length > 0) {
      const mw = node.middlewares;
      if (!collected) collected = this.globalMiddlewares.slice();
      for (let j = 0; j < mw.length; j++) {
        collected.push(mw[j]);
      }
    }

    // find for the exact method, falling back to a handler registered for ALL methods
    const methodHandler = node.handlers[method] || node.handlers["ALL"];
    if (methodHandler) {
      if (!collected) collected = this.globalMiddlewares.slice();
      collected.push(methodHandler);
    }

    return {
      params: params,
      handler: collected,
    };
  }

  optimisedSearch(method: string, pattern: string) {
    let node = this.root;
    let element = "";

    let collected: Array<Function> | undefined;
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
            if (!collected) collected = this.globalMiddlewares.slice();
            for (let j = 0; j < mw.length; j++) collected.push(mw[j]);
          }
          node = node.children[element];
        } else if (node.children[":"]) {
          if (wildcard && wildcard.middlewares.length > 0) {
            const mw = wildcard.middlewares;
            if (!collected) collected = this.globalMiddlewares.slice();
            for (let j = 0; j < mw.length; j++) collected.push(mw[j]);
          }
          node = node.children[":"];
          if (!params) params = {};
          params[node.paramName] = element;
        } else if (wildcard) {
          node = wildcard;
          break;
        } else {
          return { params: params, handler: this.globalMiddlewares };
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
      if (!collected) collected = this.globalMiddlewares.slice();
      for (let j = 0; j < mw.length; j++) {
        collected.push(mw[j]);
      }
    }

    const methodHandler = node.handlers[method] || node.handlers["ALL"];
    if (methodHandler) {
      if (!collected) collected = this.globalMiddlewares.slice();
      collected.push(methodHandler);
    }
    return {
      params: params,
      handler: collected,
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
        params[node.paramName] = element;
      } else if (node.children["*"]) {
        node = node.children["*"];
        break;
      } else {
        return {
          params: params,
          handler: node?.finalHandler?.[method] ?? node?.finalHandler?.["ALL"],
        };
      }
    }
    return {
      params: params,
      handler: node?.finalHandler?.[method] ?? node?.finalHandler?.["ALL"],
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
        const finalHandler = [...ownMiddlewares, node.handlers[method]];
        node.finalHandler[method] = finalHandler;
      }
      // node.middlewares=undefined
      // node.handlers=undefined
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
