export const runHandlers = (handlers: any) => {
  if (!handlers) return null;
  let result: any;
  for (const h of handlers) {
    result = h();
  }
  return result;
};

// search() (and its alias find()) return {params, middlewares, handler},
// matching diesel's Find contract. These helpers flatten that shape so the
// same assertions can run against either entry point.
export const runResult = (result: any) => {
  const mws = result?.middlewares ?? [];
  const h = result?.handler;
  const handlers = h == null ? [] : Array.isArray(h) ? h : [h];
  const fns = [...mws, ...handlers];
  if (!fns.length) return null;
  let out: any;
  for (const fn of fns) out = fn();
  return out;
};

export const chainLength = (result: any) => {
  const mws = result?.middlewares ?? [];
  const h = result?.handler;
  const handlerCount = h == null ? 0 : Array.isArray(h) ? h.length : 1;
  return mws.length + handlerCount;
};
