import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 10000);
const publicDir = join(process.cwd(), "public");
const sessions = new Map();

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function json(response, data, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function room(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { messages: [], members: [], schedule: null, social: null, progress: { completed: 0 } });
  }
  return sessions.get(id);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleWorkspace(request, response, url) {
  if (request.method === "GET") {
    const sessionId = url.searchParams.get("sessionId") || "wisdom-7f3a";
    return json(response, { session: { id: sessionId }, ...room(sessionId) });
  }
  if (request.method !== "POST") return json(response, { error: "method not allowed" }, 405);
  const body = await readBody(request);
  const sessionId = body.sessionId || "wisdom-7f3a";
  const state = room(sessionId);
  if (body.type === "message") state.messages.push({ role: body.role, display_name: body.displayName, body: String(body.body || ""), created_at: new Date().toISOString() });
  if (body.type === "schedule") state.schedule = body;
  if (body.type === "social") state.social = body;
  if (body.type === "invite") state.members.push({ email: body.email, role: body.role || "author" });
  if (body.type === "progress") state.progress = { completed: Number(body.completed) || 0 };
  return json(response, { ok: true });
}

async function serve(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/workspace") return handleWorkspace(request, response, url);
    const route = url.pathname === "/" ? "/index.html" : url.pathname === "/en" || url.pathname === "/en/" ? "/en.html" : url.pathname;
    const safePath = normalize(route).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(publicDir, safePath);
    if (!filePath.startsWith(publicDir)) return json(response, { error: "not found" }, 404);
    const data = await readFile(filePath);
    response.writeHead(200, { "content-type": types[extname(filePath).toLowerCase()] || "application/octet-stream", "cache-control": "public, max-age=300" });
    response.end(data);
  } catch {
    try {
      const fallback = await readFile(join(publicDir, "index.html"));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(fallback);
    } catch {
      json(response, { error: "not found" }, 404);
    }
  }
}

createServer(serve).listen(port, "0.0.0.0", () => {
  console.log(`Mindset 1000 listening on ${port}`);
});

