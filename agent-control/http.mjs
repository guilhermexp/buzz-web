import { HttpError } from "./lib.mjs";

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/** CORS decision for an exact-origin allowlist. Returns headers to add (possibly none). */
export function corsHeaders(origin, allowedOrigins) {
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Expose-Headers": "Content-Disposition, Content-Length",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function sendJson(response, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...extraHeaders,
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

export function sendError(response, error, extraHeaders = {}) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : "internal_error";
  const message = error instanceof HttpError ? error.message : "Agent control request failed";
  if (response.headersSent) {
    response.destroy();
    return;
  }
  sendJson(response, status, { error: { code, message } }, extraHeaders);
}

export function securityHeaders() {
  return SECURITY_HEADERS;
}

/**
 * Minimal method+pattern router. Patterns use `:name` segments; parameters are URI-decoded
 * and must not contain `/`.
 */
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const names = [];
    const source = pattern
      .split("/")
      .map((segment) => {
        if (!segment.startsWith(":")) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(segment.slice(1));
        return "([^/]+)";
      })
      .join("/");
    this.routes.push({ method, regex: new RegExp(`^${source}$`), names, handler });
    return this;
  }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const found = route.regex.exec(pathname);
      if (!found) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.names.forEach((name, index) => {
        params[name] = decodeURIComponent(found[index + 1]);
      });
      return { handler: route.handler, params };
    }
    if (pathMatched) throw new HttpError(405, "method_not_allowed", "Method not allowed");
    throw new HttpError(404, "not_found", "Not found");
  }
}
