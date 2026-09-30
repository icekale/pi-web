import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { localTarget, loopbackProxyHref, proxyLocal, rewriteHtml, rewriteLocation, rewriteSetCookie } = await jiti.import("./local-proxy.ts");

test("local proxy only targets 127.0.0.1 and refuses its own port", () => {
  const ok = localTarget("http://pi.example/api/local/8080/app?x=1", "30141");
  assert.equal(ok.url, "http://127.0.0.1:8080/app?x=1");
  assert.equal(localTarget("http://pi.example/api/local/8080//evil", "30141").status, 400);
  assert.equal(localTarget("http://pi.example:30141/api/local/30141/", "30141").status, 403);
  assert.equal(localTarget("http://pi.example/api/local/nope", "30141").status, 400);
});

test("loopback links clicked in pi-web open through the proxy", () => {
  assert.equal(loopbackProxyHref("http://127.0.0.1:8080/app?x=1"), "/api/local/8080/app?x=1");
  assert.equal(loopbackProxyHref("http://localhost:3000/"), "/api/local/3000/");
  assert.equal(loopbackProxyHref("https://example.com/x"), "https://example.com/x");
});

test("local proxy rewrites browser links back onto itself", () => {
  assert.equal(rewriteLocation("http://127.0.0.1:8080/next", 8080, "/"), "/api/local/8080/next");
  assert.equal(rewriteLocation("/next", 8080, "/"), "/api/local/8080/next");
  assert.equal(rewriteLocation("https://example.com/x", 8080, "/"), "https://example.com/x");
  const html = rewriteHtml(`<head><base href="http://127.0.0.1:8080/"></head><a href="/item">x</a>`, 8080);
  assert.match(html, /<base href="\/api\/local\/8080\/">/);
  assert.match(html, /href="\/api\/local\/8080\/item"/);
  assert.doesNotMatch(html, /href="\/api\/local\/8080\/api\/local/);
  assert.equal(rewriteSetCookie("sid=1; Domain=127.0.0.1; Path=/", 8080), "sid=1; Path=/api/local/8080/");
});

test("local proxy forwards the page and drops the outer password", async () => {
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(200, { "content-type": "text/html", "set-cookie": "sid=1; Path=/" });
    res.end(`<head></head><a href="${req.url}">ok</a>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await proxyLocal(new Request(`http://pi.example:30141/api/local/${port}/`, {
      headers: { authorization: "Basic cGk6c2VjcmV0" },
    }));
    assert.equal(response.status, 200);
    assert.match(await response.text(), new RegExp(`href="/api/local/${port}/"`));
    assert.equal(response.headers.get("set-cookie"), `sid=1; Path=/api/local/${port}/`);
  } finally {
    server.close();
  }
});
