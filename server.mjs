import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import pg from "pg";

const { Pool } = pg;
const port = Number(process.env.PORT || 10000);
const publicDir = join(process.cwd(), "public");
const apiOrigins = new Set([
  "https://2dam.github.io",
  "https://mindset1000.onrender.com",
  ...(process.env.CORS_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean),
]);
const personas = {
  sun: "손자 (전략과 상황 판단)",
  nietzsche: "프리드리히 니체 (자기 기준과 가치)",
  adler: "알프레드 아들러 (관계와 용기)",
  lincoln: "에이브러햄 링컨 (설득과 통합)",
};
const allowedPersonaIds = new Set(Object.keys(personas));

function normalizeAdvisor(advisor) {
  if (!advisor || typeof advisor !== "object") return null;
  const id = Number.isInteger(Number(advisor.id)) && Number(advisor.id) > 0 ? Number(advisor.id) : null;
  const name = typeof advisor.name === "string" ? advisor.name.trim().slice(0, 120) : "";
  const category = typeof advisor.category === "string" ? advisor.category.trim().slice(0, 80) : "";
  const bio = typeof advisor.bio === "string" ? advisor.bio.trim().slice(0, 500) : "";
  const lens = typeof advisor.lens === "string" ? advisor.lens.trim().slice(0, 80) : "";
  const occupation = typeof advisor.occupation === "string" ? advisor.occupation.trim().slice(0, 100) : "";
  const industry = typeof advisor.industry === "string" ? advisor.industry.trim().slice(0, 100) : "";
  const country = typeof advisor.country === "string" ? advisor.country.trim().slice(0, 100) : "";
  const birthYear = Number.isFinite(Number(advisor.birthYear)) ? Number(advisor.birthYear) : null;
  const personaId = typeof advisor.persona === "string" && allowedPersonaIds.has(advisor.persona) ? advisor.persona : "nietzsche";
  if (!name) return null;
  return { id, name, category, bio, lens, occupation, industry, country, birthYear, personaId };
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

let pool;
let schemaReady;
const rateBuckets = new Map();

function json(response, data, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(data));
}

function getPool() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error("DATABASE_URL is not configured"), { status: 503 });
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(`
      CREATE TABLE IF NOT EXISTS workspace_sessions (
        session_id TEXT PRIMARY KEY,
        state JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS workspace_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES workspace_sessions(session_id) ON DELETE CASCADE,
        client_message_id TEXT,
        reply_to_id TEXT REFERENCES workspace_messages(id) ON DELETE SET NULL,
        role TEXT NOT NULL CHECK (role IN ('subscriber', 'persona', 'author')),
        display_name TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (session_id, client_message_id)
      );
      CREATE INDEX IF NOT EXISTS workspace_messages_session_created
        ON workspace_messages(session_id, created_at, id);
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function readBody(request, maxBytes = 32_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("요청 내용이 너무 큽니다."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("요청 형식이 올바르지 않습니다."), { status: 400 });
  }
}

function validateSessionId(value) {
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
}

function checkRateLimit(request, sessionId) {
  const forwarded = request.headers["x-forwarded-for"];
  const ip = (typeof forwarded === "string" ? forwarded.split(",")[0] : request.socket.remoteAddress) || "unknown";
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
  for (const [key, limit, windowMs] of [[`ip:${ip}`, 12, 60_000], [`session:${sessionId}`, 8, 60_000]]) {
    const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    rateBuckets.set(key, bucket);
  }
  return true;
}

async function getWorkspace(sessionId) {
  await ensureSchema();
  const database = getPool();
  await database.query("INSERT INTO workspace_sessions(session_id) VALUES ($1) ON CONFLICT DO NOTHING", [sessionId]);
  const [sessionResult, messagesResult] = await Promise.all([
    database.query("SELECT state FROM workspace_sessions WHERE session_id = $1", [sessionId]),
    database.query(`SELECT id, role, display_name, body, created_at
                    FROM workspace_messages WHERE session_id = $1
                    ORDER BY created_at, id`, [sessionId]),
  ]);
  const state = sessionResult.rows[0]?.state || {};
  return {
    session: { id: sessionId },
    members: state.members || [],
    schedule: state.schedule || null,
    social: state.social || null,
    progress: state.progress || { completed: 0 },
    messages: messagesResult.rows,
  };
}

async function handleWorkspace(request, response, url) {
  if (request.method === "GET") {
    const sessionId = url.searchParams.get("sessionId");
    if (!validateSessionId(sessionId)) return json(response, { error: "대화 ID가 올바르지 않습니다." }, 400);
    return json(response, await getWorkspace(sessionId));
  }
  if (request.method !== "POST") return json(response, { error: "지원하지 않는 요청입니다." }, 405);
  const body = await readBody(request);
  if (!validateSessionId(body.sessionId)) return json(response, { error: "대화 ID가 올바르지 않습니다." }, 400);
  if (body.type === "message") return json(response, { error: "메시지는 /api/chat으로 보내주세요." }, 410);
  const allowedTypes = new Set(["schedule", "social", "invite", "progress"]);
  if (!allowedTypes.has(body.type)) return json(response, { error: "지원하지 않는 요청입니다." }, 400);

  await ensureSchema();
  const database = getPool();
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO workspace_sessions(session_id) VALUES ($1) ON CONFLICT DO NOTHING", [body.sessionId]);
    const current = await client.query("SELECT state FROM workspace_sessions WHERE session_id = $1 FOR UPDATE", [body.sessionId]);
    const state = current.rows[0].state || {};
    if (body.type === "schedule") state.schedule = {
      title: String(body.title || "").slice(0, 200), contact: String(body.contact || "").slice(0, 200),
      date: String(body.date || "").slice(0, 80), place: String(body.place || "").slice(0, 300), goal: String(body.goal || "").slice(0, 2000),
    };
    if (body.type === "social") state.social = {
      service: String(body.service || "").slice(0, 80), content: String(body.content || "").slice(0, 6000),
    };
    if (body.type === "invite") {
      state.members ||= [];
      if (typeof body.email === "string" && body.email.length <= 254) state.members.push({ email: body.email, role: "author" });
    }
    if (body.type === "progress") state.progress = { completed: Math.max(0, Math.min(100, Number(body.completed) || 0)) };
    await client.query("UPDATE workspace_sessions SET state = $2::jsonb, updated_at = NOW() WHERE session_id = $1", [body.sessionId, JSON.stringify(state)]);
    await client.query("COMMIT");
    return json(response, { ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function makeInstructions(persona, state, advisor) {
  const selected = personas[persona] || personas.nietzsche;
  const context = [];
  if (state?.schedule) context.push(`일정 정보: ${JSON.stringify(state.schedule)}`);
  if (state?.social) context.push(`대화 분석 자료: ${JSON.stringify(state.social)}`);
  return [
    advisor
      ? `당신은 Mindset 1000의 ${advisor.name} 전담 한국어 자문 파트너입니다. 이번 응답의 선택 인물은 정확히 ${advisor.name}${advisor.id ? ` (카탈로그 ${advisor.id}번)` : ""}입니다. 분야: ${advisor.category || "미지정"}; 직업: ${advisor.occupation || "미지정"}; 세부 분야: ${advisor.industry || "미지정"}; 활동 지역: ${advisor.country || "미지정"}; 출생 연도: ${advisor.birthYear ?? "미상"}; 핵심 관점: ${advisor.lens || "이 인물의 알려진 사상과 전문 분야"}. 프로필: ${advisor.bio || "추가 소개 없음"}. 답변은 이 선택 인물의 알려진 생애와 사상, 전문 분야에서 구별되는 관점을 사용하세요. 프로필로 확인되지 않는 구체적인 주장을 지어내지 말고, 알려진 정보가 부족하면 그 한계를 밝히세요. ${personas[advisor.personaId]}는 내부 기본 관점 분류일 뿐입니다. 답변을 그 인물의 조언처럼 만들거나 이름을 대체하지 말고, 응답 화자는 항상 ${advisor.name}으로 유지하세요.`
      : `당신은 Mindset 1000의 한국어 자문 파트너이며, ${selected}의 사고방식을 바탕으로 조언합니다.`,
    "역사적 인물을 실제로 흉내 내거나 그 인물의 직접 인용인 것처럼 꾸미지 말고, 그 관점을 현대의 상황에 적용하세요.",
    "이전 대화의 맥락을 이어받아 답하세요. 사용자의 말을 요약한 뒤, 이유를 설명하고 지금 실행할 수 있는 구체적인 다음 행동이나 문장을 제안하세요.",
    "관련 정보가 부족하면 한 번에 초점을 둔 후속 질문을 하나 하세요. 질문을 이미 받은 뒤에는 같은 질문이나 일반적인 문장을 반복하지 마세요.",
    "답변은 한국어로, 보통 2~5개의 짧은 문장으로 작성하고 사용자의 요청을 직접 다루세요.",
    context.length ? `세션에 저장된 참고 자료:\n${context.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

async function createModelReply({ persona, state, history, advisor }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw Object.assign(new Error("AI_API_NOT_CONFIGURED"), { status: 503 });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-6-luna",
      instructions: makeInstructions(persona, state, advisor),
      input: history.map((message) => ({
        role: message.role === "subscriber" ? "user" : "assistant",
        content: message.body,
      })),
      max_output_tokens: 800,
      store: false,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`OpenAI request failed with status ${response.status}`);
    error.status = 502;
    error.providerStatus = response.status;
    throw error;
  }
  const text = (data.output || []).flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n").trim();
  if (!text) throw Object.assign(new Error("The model returned no text"), { status: 502 });
  return text.slice(0, 8000);
}

async function handleChat(request, response) {
  if (request.method !== "POST") return json(response, { error: "지원하지 않는 요청입니다." }, 405);
  const body = await readBody(request);
  const { sessionId, persona, message, clientMessageId } = body;
  const advisor = normalizeAdvisor(body.advisor);
  if (!validateSessionId(sessionId)) return json(response, { error: "대화 ID가 올바르지 않습니다." }, 400);
  if (typeof clientMessageId !== "string" || !/^[a-f0-9-]{36}$/i.test(clientMessageId)) return json(response, { error: "메시지 ID가 올바르지 않습니다." }, 400);
  if (typeof message !== "string" || !message.trim() || message.length > 3000) return json(response, { error: "메시지는 1~3,000자로 입력해 주세요." }, 400);
  if (!process.env.OPENAI_API_KEY) return json(response, { error: "AI 응답을 아직 설정하지 않았습니다. 운영자에게 API 키 설정을 요청해 주세요." }, 503);
  if (!checkRateLimit(request, sessionId)) return json(response, { error: "메시지를 너무 자주 보냈습니다. 잠시 후 다시 시도해 주세요." }, 429);

  await ensureSchema();
  const database = getPool();
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [sessionId]);
    await client.query("INSERT INTO workspace_sessions(session_id) VALUES ($1) ON CONFLICT DO NOTHING", [sessionId]);
    const stateResult = await client.query("SELECT state FROM workspace_sessions WHERE session_id = $1", [sessionId]);
    let userMessage = (await client.query(
      "SELECT id, role, display_name, body, created_at FROM workspace_messages WHERE session_id = $1 AND client_message_id = $2",
      [sessionId, clientMessageId],
    )).rows[0];
    if (!userMessage) {
      userMessage = {
        id: randomUUID(), role: "subscriber", display_name: "지혜의 여행자", body: message.trim(), client_message_id: clientMessageId,
      };
      const inserted = await client.query(`INSERT INTO workspace_messages
        (id, session_id, client_message_id, role, display_name, body)
        VALUES ($1, $2, $3, 'subscriber', $4, $5)
        RETURNING id, role, display_name, body, created_at`,
      [userMessage.id, sessionId, clientMessageId, userMessage.display_name, userMessage.body]);
      userMessage = inserted.rows[0];
    }
    const existingReply = (await client.query(
      "SELECT id, role, display_name, body, created_at FROM workspace_messages WHERE session_id = $1 AND reply_to_id = $2 ORDER BY created_at DESC LIMIT 1",
      [sessionId, userMessage.id],
    )).rows[0];
    if (existingReply) {
      await client.query("COMMIT");
      return json(response, { userMessage, assistantMessage: existingReply });
    }
    const historyResult = await client.query(`SELECT role, body FROM (
      SELECT role, body, created_at, id FROM workspace_messages WHERE session_id = $1
      ORDER BY created_at DESC, id DESC LIMIT 30
    ) recent ORDER BY created_at, id`, [sessionId]);
    const assistantText = await createModelReply({
      persona,
      state: stateResult.rows[0]?.state || {},
      history: historyResult.rows,
      advisor,
    });
    const displayName = advisor ? advisor.name : (personas[persona] || personas.nietzsche);
    const assistantResult = await client.query(`INSERT INTO workspace_messages
      (id, session_id, reply_to_id, role, display_name, body)
      VALUES ($1, $2, $3, 'persona', $4, $5)
      RETURNING id, role, display_name, body, created_at`,
    [randomUUID(), sessionId, userMessage.id, displayName, assistantText]);
    await client.query("COMMIT");
    return json(response, { userMessage, assistantMessage: assistantResult.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.message === "AI_API_NOT_CONFIGURED") return json(response, { error: "AI 응답을 아직 설정하지 않았습니다. 운영자에게 API 키 설정을 요청해 주세요." }, 503);
    if (error.message === "DATABASE_URL is not configured") return json(response, { error: "대화 저장소가 아직 설정되지 않았습니다. 운영자에게 데이터베이스 설정을 요청해 주세요." }, 503);
    console.error("Chat request failed:", error.providerStatus || error.message);
    return json(response, { error: "답변을 만들지 못했습니다. 입력 내용은 저장되지 않았으니 잠시 후 다시 보내 주세요." }, error.status || 502);
  } finally {
    client.release();
  }
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (origin && apiOrigins.has(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "Content-Type");
  }
}

async function serve(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    applyCors(request, response);
    if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
      response.writeHead(204);
      return response.end();
    }
    if (url.pathname === "/api/health") return json(response, {
      status: "ok",
      chatReady: Boolean(process.env.DATABASE_URL && process.env.OPENAI_API_KEY),
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      modelConfigured: Boolean(process.env.OPENAI_API_KEY),
    });
    if (url.pathname === "/api/chat") return await handleChat(request, response);
    if (url.pathname === "/api/workspace") return await handleWorkspace(request, response, url);
    const route = url.pathname === "/" ? "/index.html" : url.pathname === "/en" || url.pathname === "/en/" ? "/en.html" : url.pathname;
    const safePath = normalize(route).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(publicDir, safePath);
    if (!filePath.startsWith(publicDir)) return json(response, { error: "페이지를 찾을 수 없습니다." }, 404);
    const data = await readFile(filePath);
    const extension = extname(filePath).toLowerCase();
    const cacheControl = extension === ".html" ? "no-store, no-cache, must-revalidate" : "public, max-age=300";
    response.writeHead(200, { "content-type": types[extension] || "application/octet-stream", "cache-control": cacheControl });
    response.end(data);
  } catch (error) {
    console.error("Request failed:", error.message);
    if (response.headersSent) return response.end();
    return json(response, { error: error.message || "요청을 처리하지 못했습니다." }, error.status || 500);
  }
}

createServer(serve).listen(port, "0.0.0.0", () => {
  console.log(`Mindset 1000 listening on ${port}`);
});

