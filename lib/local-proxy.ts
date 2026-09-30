const DROP_REQUEST = new Set([
  "authorization",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const HTML_LIMIT = 2_000_000;

export function loopbackProxyHref(href: string | undefined): string | undefined {
  if (!href) return href;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "http:" && url.protocol !== "https:") return href;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return href;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) return href;
  return `/api/local/${port}${url.pathname}${url.search}${url.hash}`;
}

export function localTarget(
  requestUrl: string,
  ownPort: string,
): { port: number; url: string } | { error: string; status: number } {
  const incoming = new URL(requestUrl);
  const rest = incoming.pathname.startsWith("/api/local/")
    ? incoming.pathname.slice("/api/local/".length)
    : "";
  const slash = rest.indexOf("/");
  const portText = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "/" : rest.slice(slash);
  if (!/^[1-9]\d{0,4}$/.test(portText)) return { error: "Bad port", status: 400 };
  const port = Number(portText);
  if (port > 65535 || String(port) === ownPort) return { error: "Port not allowed", status: 403 };
  if (!path.startsWith("/") || path.startsWith("//")) return { error: "Bad path", status: 400 };
  const url = new URL(`http://127.0.0.1:${port}${path}${incoming.search}`);
  if (url.hostname !== "127.0.0.1" || Number(url.port) !== port) {
    return { error: "Bad target", status: 400 };
  }
  return { port, url: url.toString() };
}

export function rewriteLocation(location: string, port: number, currentPath: string): string {
  const prefix = `/api/local/${port}`;
  if (location.startsWith("/") && !location.startsWith("//")) return `${prefix}${location}`;
  try {
    const url = new URL(location, `http://127.0.0.1:${port}${currentPath}`);
    if ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && Number(url.port) === port) {
      return `${prefix}${url.pathname}${url.search}`;
    }
  } catch {
    // Leave non-URL redirects untouched.
  }
  return location;
}

export function rewriteHtml(html: string, port: number): string {
  const prefix = `/api/local/${port}`;
  let text = html
    .replaceAll(`http://127.0.0.1:${port}`, prefix)
    .replaceAll(`http://localhost:${port}`, prefix);
  const root = new RegExp(String.raw`(\s(?:href|src|action|poster)\s*=\s*)(["'])\/(?!\/|api\/local\/${port}(?:\/|["']))`, "gi");
  text = text.replace(root, `$1$2${prefix}/`);
  text = text.replace(
    new RegExp(String.raw`(url\(\s*["']?)\/(?!\/|api\/local\/${port}(?:\/|["']))`, "gi"),
    `$1${prefix}/`,
  );
  return text.replace(/<head[^>]*>/i, (head) => `${head}<base href="${prefix}/">`);
}

export function rewriteSetCookie(cookie: string, port: number): string {
  const prefix = `/api/local/${port}`;
  const stripped = cookie.replace(/;\s*Domain=[^;]*/i, "");
  if (!/;\s*Path=/i.test(stripped)) return `${stripped}; Path=${prefix}/`;
  return stripped.replace(/;\s*Path=([^;]*)/i, (_match, path: string) => {
    const next = path.trim().startsWith("/") ? path.trim() : `/${path.trim()}`;
    return `; Path=${prefix}${next}`;
  });
}

export async function proxyLocal(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const target = localTarget(request.url, incoming.port || (incoming.protocol === "https:" ? "443" : "80"));
  if ("error" in target) return new Response(target.error, { status: target.status });

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!DROP_REQUEST.has(key.toLowerCase())) headers.append(key, value);
  });
  headers.set("host", `127.0.0.1:${target.port}`);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target.url, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    return new Response("Local service unavailable", { status: 502 });
  }

  const responseHeaders = new Headers();
  const currentPath = new URL(target.url).pathname;
  upstream.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (name === "set-cookie" || name === "content-length" || name === "content-encoding" || name === "transfer-encoding" || name === "connection") return;
    if (name === "location") {
      responseHeaders.append("location", rewriteLocation(value, target.port, currentPath));
      return;
    }
    responseHeaders.append(key, value);
  });
  const cookies = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  for (const cookie of cookies) responseHeaders.append("set-cookie", rewriteSetCookie(cookie, target.port));

  const type = upstream.headers.get("content-type") ?? "";
  if (!/text\/html|text\/css/i.test(type) || !upstream.body) {
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  }
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > HTML_LIMIT) {
    return new Response(bytes, { status: upstream.status, headers: responseHeaders });
  }
  const text = new TextDecoder().decode(bytes);
  const body = /text\/html/i.test(type)
    ? rewriteHtml(text, target.port)
    : text.replaceAll(`http://127.0.0.1:${target.port}`, `/api/local/${target.port}`);
  return new Response(body, { status: upstream.status, headers: responseHeaders });
}
