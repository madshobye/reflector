const http = require("http");
const { URL } = require("url");

const PORT = 8787;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

async function handleRss(req, res, requestUrl) {
  const feedUrl = requestUrl.searchParams.get("url");
  if (!feedUrl) {
    sendJson(res, 400, { ok: false, error: "Missing url parameter" });
    return;
  }

  let parsed;
  try {
    parsed = new URL(feedUrl);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: "Invalid feed URL" });
    return;
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    sendJson(res, 400, { ok: false, error: "Only http/https feeds are allowed" });
    return;
  }

  try {
    const upstream = await fetch(feedUrl, {
      headers: {
        "Accept": "application/rss+xml, application/xml, text/xml, application/atom+xml, text/plain, */*",
        "User-Agent": "reflector-rss-proxy/1.0"
      }
    });

    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        ok: false,
        error: "Upstream HTTP " + upstream.status
      });
      return;
    }

    const xml = await upstream.text();
    if (!xml) {
      sendJson(res, 502, { ok: false, error: "Upstream returned empty body" });
      return;
    }

    sendJson(res, 200, { ok: true, xml });
  } catch (err) {
    sendJson(res, 502, {
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/rss") {
    await handleRss(req, res, requestUrl);
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`RSS proxy listening on http://127.0.0.1:${PORT}`);
});
