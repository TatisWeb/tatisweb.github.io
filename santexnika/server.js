"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const fss = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const ROOT = __dirname;
loadDotEnv();
const DATA_DIR = path.join(ROOT, "data");
const NEWS_FILE = path.join(DATA_DIR, "news.json");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const SYNC_FILE = path.join(DATA_DIR, "vk-sync.json");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const sessions = new Map();
const leadRate = new Map();
let syncState = { lastSync: null, status: "not_started", message: "" };
let writeQueue = Promise.resolve();

function loadDotEnv() {
  try {
    const text = require("node:fs").readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value.replace(/\\n/g, "\n");
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Не удалось прочитать .env:", error.message);
  }
}

function env(name, fallback = "") {
  return (process.env[name] || fallback).trim();
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function safeText(value, limit = 1200) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, limit);
}

function readJson(file, fallback) {
  return fs.readFile(file, "utf8").then((text) => JSON.parse(text)).catch((error) => {
    if (error.code === "ENOENT") return fallback;
    console.error(`Не удалось прочитать ${path.basename(file)}:`, error.message);
    return fallback;
  });
}

function writeJson(file, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, serialized, "utf8");
    await fs.rename(temporary, file);
  });
  return writeQueue;
}

async function readBody(req, limit = 24_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Слишком большой запрос"), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Некорректный JSON"), { status: 400 });
  }
}

function phoneHref(value) {
  return value.replace(/[^\d+]/g, "");
}

function publicConfig() {
  const phone = env("STORE_PHONE", "+7 (960) 359-37-39");
  return {
    storeName: env("STORE_NAME", "Дом Сантехники"),
    city: env("STORE_CITY", "Балаково"),
    phone,
    phoneHref: phoneHref(phone),
    email: env("STORE_EMAIL", "dom-santehniki@mail.ru"),
    vkUrl: env("VK_PUBLIC_URL", "https://vk.ru/houseplumbers"),
    whatsappUrl: env("WHATSAPP_PUBLIC_URL", "https://wa.me/79603593739?text=%D0%97%D0%B4%D1%80%D0%B0%D0%B2%D1%81%D1%82%D0%B2%D1%83%D0%B9%D1%82%D0%B5!%20%D0%A5%D0%BE%D1%87%D1%83%20%D1%83%D1%82%D0%BE%D1%87%D0%BD%D0%B8%D1%82%D1%8C%20%D0%BF%D0%BE%20%D1%81%D0%B0%D0%BD%D1%82%D0%B5%D1%85%D0%BD%D0%B8%D0%BA%D0%B5."),
    telegramPublicUrl: env("TELEGRAM_PUBLIC_URL", ""),
    maxPublicUrl: env("MAX_PUBLIC_URL", ""),
    addresses: [
      env("STORE_ADDRESS_1", "Трнавская ул., 73/1"),
      env("STORE_ADDRESS_2", "Степная ул., 52"),
    ],
    hours: {
      weekdays: env("STORE_HOURS_WEEKDAYS", "Пн–Пт: 09:00–19:00"),
      weekends: env("STORE_HOURS_WEEKENDS", "Сб–Вс: 09:00–17:00"),
    },
    notifications: {
      telegram: Boolean(env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_CHAT_ID")),
      max: Boolean(env("MAX_BOT_TOKEN") && env("MAX_CHAT_ID")),
    },
    vkLive: Boolean(env("VK_ACCESS_TOKEN") && env("VK_GROUP_ID", "223639597")),
  };
}

function isAdmin(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  return true;
}

function safeCompare(a, b) {
  const hash = (value) => crypto.createHash("sha256").update(String(value)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function getVkKeywords(name, fallback) {
  const list = env(name, fallback).split(",").map((item) => item.trim().toLocaleLowerCase("ru-RU")).filter(Boolean);
  return list;
}

function extractPhoto(post) {
  const attachments = Array.isArray(post.attachments) ? post.attachments : [];
  for (const attachment of attachments) {
    const photo = attachment && attachment.type === "photo" ? attachment.photo : null;
    if (!photo || !Array.isArray(photo.sizes)) continue;
    const sizes = [...photo.sizes].sort((a, b) => (b.width || 0) - (a.width || 0));
    if (sizes[0] && sizes[0].url) return sizes[0].url;
  }
  return "";
}

function textToTitle(text) {
  const first = safeText(text, 1800).split(/\n|[.!?]\s/).map((line) => line.trim()).find(Boolean) || "Новости магазина";
  return first.length > 74 ? `${first.slice(0, 71).trimEnd()}…` : first;
}

async function resolveVkGroupId(token) {
  const explicit = env("VK_GROUP_ID", "223639597").replace(/[^0-9]/g, "");
  if (explicit) return explicit;
  const screenName = env("VK_GROUP_SCREEN_NAME", "houseplumbers");
  const url = new URL("https://api.vk.com/method/groups.getById");
  url.searchParams.set("group_id", screenName);
  url.searchParams.set("access_token", token);
  url.searchParams.set("v", env("VK_API_VERSION", "5.199"));
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.error_msg || `VK API: ${response.status}`);
  const group = Array.isArray(data.response) ? data.response[0] : data.response;
  if (!group || !group.id) throw new Error("Не удалось определить ID сообщества ВКонтакте");
  return String(group.id);
}

async function syncVkWall() {
  const token = env("VK_ACCESS_TOKEN");
  if (!token) {
    syncState = { ...syncState, status: "not_configured", message: "Добавьте VK_ACCESS_TOKEN в .env" };
    return { ok: false, message: syncState.message };
  }
  try {
    const groupId = await resolveVkGroupId(token);
    const url = new URL("https://api.vk.com/method/wall.get");
    url.searchParams.set("owner_id", `-${groupId}`);
    url.searchParams.set("count", String(Math.min(100, Number(env("VK_SYNC_COUNT", "50")) || 50)));
    url.searchParams.set("filter", "owner");
    url.searchParams.set("access_token", token);
    url.searchParams.set("v", env("VK_API_VERSION", "5.199"));
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error?.error_msg || `VK API: ${response.status}`);

    const posts = payload.response?.items || [];
    const include = getVkKeywords("VK_INCLUDE_KEYWORDS", "сантех,смесител,ванн,душ,раковин,унитаз,мебел,акци,скидк,доставк,поступлен,инсталляц,керамогранит,труб,отоплен,комплект,кран,зеркал,полотенцесушител,grohe,gappo,azario,abber,viant,briz");
    const exclude = getVkKeywords("VK_EXCLUDE_KEYWORDS", "розыгрыш победител,поздравляем победител,вакансия");
    const matched = posts.filter((post) => {
      const text = safeText(post.text, 6000).toLocaleLowerCase("ru-RU");
      if (!text) return false;
      const included = include.length === 0 || include.some((keyword) => text.includes(keyword));
      const excluded = exclude.some((keyword) => text.includes(keyword));
      return included && !excluded;
    });

    const current = await readJson(NEWS_FILE, []);
    const knownVkIds = new Set(current.filter((item) => item.vkPostId).map((item) => String(item.vkPostId)));
    const imported = matched.map((post) => {
      const text = safeText(post.text, 1800);
      return {
        id: `vk-${groupId}_${post.id}`,
        vkPostId: `${groupId}_${post.id}`,
        title: textToTitle(text),
        text,
        date: new Date((post.date || 0) * 1000).toISOString(),
        source: "vk",
        sourceUrl: `https://vk.ru/houseplumbers?w=wall-${groupId}_${post.id}`,
        image: extractPhoto(post),
        category: "Из сообщества",
        visible: true,
        pinned: false,
      };
    });
    const added = imported.filter((item) => !knownVkIds.has(String(item.vkPostId)));
    const merged = [...current, ...added]
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 200);
    await writeJson(NEWS_FILE, merged);

    syncState = {
      lastSync: new Date().toISOString(),
      status: "ok",
      message: `Проверено ${posts.length}, по фильтру ${matched.length}, добавлено ${added.length}`,
      checked: posts.length,
      matched: matched.length,
      added: added.length,
    };
    await writeJson(SYNC_FILE, syncState);
    console.log(`[VK] ${syncState.message}`);
    return { ok: true, ...syncState };
  } catch (error) {
    syncState = { lastSync: new Date().toISOString(), status: "error", message: safeText(error.message, 240) };
    await writeJson(SYNC_FILE, syncState);
    console.error("[VK] sync failed:", error.message);
    return { ok: false, ...syncState };
  }
}

async function sendTelegram(text) {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chatId = env("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return { status: "not_configured" };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API: ${response.status}`);
  return { status: "sent" };
}

async function sendMax(text) {
  const token = env("MAX_BOT_TOKEN");
  const chatId = env("MAX_CHAT_ID");
  if (!token || !chatId) return { status: "not_configured" };
  const url = new URL("https://platform-api2.max.ru/messages");
  url.searchParams.set("chat_id", chatId);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Authorization": token, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.message || result.description || `MAX API: ${response.status}`);
  return { status: "sent" };
}

function formatLead(lead) {
  const config = publicConfig();
  return [
    `Новая заявка с сайта «${config.storeName}»`,
    `Имя: ${lead.name}`,
    `Телефон: ${lead.phone}`,
    lead.topic ? `Интересует: ${lead.topic}` : "",
    lead.product ? `Товар: ${lead.product}` : "",
    lead.comment ? `Комментарий: ${lead.comment}` : "",
    `Время: ${new Date(lead.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Saratov" })}`,
  ].filter(Boolean).join("\n");
}

function checkRate(ip) {
  const now = Date.now();
  const entry = leadRate.get(ip) || { start: now, count: 0 };
  if (now - entry.start > 15 * 60 * 1000) {
    entry.start = now;
    entry.count = 0;
  }
  entry.count += 1;
  leadRate.set(ip, entry);
  return entry.count <= 6;
}

async function handleLead(req, res) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!checkRate(ip)) return json(res, 429, { ok: false, message: "Слишком много попыток. Позвоните нам, пожалуйста." });
  const body = await readBody(req, 12_000);
  if (safeText(body.website, 240)) return json(res, 200, { ok: true, stored: false }); // honeypot

  const name = safeText(body.name, 90);
  const phone = safeText(body.phone, 40);
  const topic = safeText(body.topic, 120);
  const product = safeText(body.product, 180);
  const comment = safeText(body.comment, 1000);
  const digits = phone.replace(/\D/g, "");
  if (name.length < 2 || digits.length < 7 || digits.length > 15 || body.consent !== true) {
    return json(res, 400, { ok: false, message: "Проверьте имя, номер телефона и согласие на обработку данных." });
  }

  const lead = { id: crypto.randomUUID(), name, phone, topic, product, comment, createdAt: new Date().toISOString() };
  const leads = await readJson(LEADS_FILE, []);
  leads.unshift(lead);
  await writeJson(LEADS_FILE, leads.slice(0, 1000));

  const message = formatLead(lead);
  const deliveries = await Promise.all([
    sendTelegram(message).catch((error) => ({ status: "failed", reason: safeText(error.message, 180) })),
    sendMax(message).catch((error) => ({ status: "failed", reason: safeText(error.message, 180) })),
  ]);
  console.log(`[LEAD] ${lead.id}: telegram=${deliveries[0].status}, max=${deliveries[1].status}`);
  return json(res, 201, { ok: true, stored: true, notifications: { telegram: deliveries[0].status, max: deliveries[1].status } });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/config") return json(res, 200, publicConfig());
  if (req.method === "GET" && pathname === "/api/health") {
    const persisted = await readJson(SYNC_FILE, syncState);
    syncState = { ...syncState, ...persisted };
    const config = publicConfig();
    return json(res, 200, {
      ok: true,
      notifications: config.notifications,
      vk: { connected: config.vkLive, ...syncState },
    });
  }
  if (req.method === "GET" && pathname === "/api/products") {
    return json(res, 200, await readJson(path.join(DATA_DIR, "products.json"), []));
  }
  if (req.method === "GET" && pathname === "/api/news") {
    const items = await readJson(NEWS_FILE, []);
    const visible = items.filter((item) => item.visible !== false)
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || new Date(b.date || 0) - new Date(a.date || 0));
    const limit = Math.max(1, Math.min(30, Number(url.searchParams.get("limit") || 6)));
    return json(res, 200, visible.slice(0, limit));
  }
  if (req.method === "POST" && pathname === "/api/leads") return handleLead(req, res);

  if (pathname === "/api/admin/login" && req.method === "POST") {
    const password = env("ADMIN_PASSWORD");
    if (!password) return json(res, 503, { ok: false, message: "Администратор сайта ещё не настроен. Добавьте ADMIN_PASSWORD в .env." });
    const body = await readBody(req, 3000);
    if (!safeCompare(body.password || "", password)) return json(res, 401, { ok: false, message: "Неверный пароль." });
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    return json(res, 200, { ok: true, token });
  }

  if (pathname.startsWith("/api/admin/")) {
    if (!isAdmin(req)) return json(res, 401, { ok: false, message: "Нужен вход администратора." });
    if (pathname === "/api/admin/news" && req.method === "GET") {
      const items = await readJson(NEWS_FILE, []);
      return json(res, 200, items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)));
    }
    if (pathname === "/api/admin/news" && req.method === "POST") {
      const body = await readBody(req, 12_000);
      const title = safeText(body.title, 120);
      const text = safeText(body.text, 1800);
      if (title.length < 3 || text.length < 3) return json(res, 400, { ok: false, message: "Заполните заголовок и текст новости." });
      const items = await readJson(NEWS_FILE, []);
      const item = {
        id: `local-${crypto.randomUUID()}`,
        title,
        text,
        date: new Date().toISOString(),
        source: "local",
        sourceUrl: env("VK_PUBLIC_URL", "https://vk.ru/houseplumbers"),
        category: safeText(body.category || "Новости магазина", 60),
        visible: body.visible !== false,
        pinned: false,
      };
      items.unshift(item);
      await writeJson(NEWS_FILE, items.slice(0, 200));
      return json(res, 201, { ok: true, item });
    }
    if (pathname === "/api/admin/sync" && req.method === "POST") {
      const result = await syncVkWall();
      return json(res, result.ok ? 200 : 502, result);
    }
    const match = pathname.match(/^\/api\/admin\/news\/([^/]+)$/);
    if (match && req.method === "PATCH") {
      const id = decodeURIComponent(match[1]);
      const body = await readBody(req, 12_000);
      const items = await readJson(NEWS_FILE, []);
      const item = items.find((entry) => entry.id === id);
      if (!item) return json(res, 404, { ok: false, message: "Публикация не найдена." });
      if (body.title !== undefined) item.title = safeText(body.title, 120);
      if (body.text !== undefined) item.text = safeText(body.text, 1800);
      if (body.visible !== undefined) item.visible = Boolean(body.visible);
      if (body.pinned !== undefined) item.pinned = Boolean(body.pinned);
      if (body.category !== undefined) item.category = safeText(body.category, 60);
      await writeJson(NEWS_FILE, items);
      return json(res, 200, { ok: true, item });
    }
    if (match && req.method === "DELETE") {
      const id = decodeURIComponent(match[1]);
      const items = await readJson(NEWS_FILE, []);
      const next = items.filter((item) => item.id !== id);
      if (next.length === items.length) return json(res, 404, { ok: false, message: "Публикация не найдена." });
      await writeJson(NEWS_FILE, next);
      return json(res, 200, { ok: true });
    }
  }
  return json(res, 404, { ok: false, message: "Не найдено." });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webp": "image/webp",
};

async function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return serve404(res);
  }
  if (pathname === "/admin" || pathname === "/admin/" || pathname === "/_admin") pathname = "/admin.html";
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/404") pathname = "/404.html";

  // Only public seed data can be read. Lead records, secrets and source code never leave the server.
  if (pathname.startsWith("/data/")) {
    if (!["/data/products.json", "/data/news.json"].includes(pathname)) return serve404(res);
  }
  if (pathname.startsWith("/.env") || pathname === "/server.js" || pathname === "/package.json" || pathname.startsWith("/node_modules/")) return serve404(res);
  if (pathname.includes("..") || pathname.startsWith("//")) return serve404(res);

  const absolute = path.resolve(ROOT, `.${pathname}`);
  if (!absolute.startsWith(`${ROOT}${path.sep}`) && absolute !== path.join(ROOT, "index.html")) return serve404(res);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) return serve404(res);
    const ext = path.extname(absolute).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    };
    if (pathname === "/admin.html") headers["X-Robots-Tag"] = "noindex, nofollow";
    res.writeHead(200, headers);
    fss.createReadStream(absolute).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") return serve404(res);
    console.error("Static error:", error.message);
    return serve404(res);
  }
}

function serve404(res) {
  const file = path.join(ROOT, "404.html");
  fs.readFile(file).then((content) => {
    res.writeHead(404, {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    res.end(content);
  }).catch(() => {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Страница не найдена");
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { ok: false, message: "Метод не поддерживается." });
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error("Request error:", error.stack || error.message);
    if (!res.headersSent) json(res, error.status || 500, { ok: false, message: error.status ? error.message : "Ошибка сервера. Попробуйте ещё раз." });
    else res.end();
  }
});

server.listen(PORT, HOST, async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const existingSync = await readJson(SYNC_FILE, null);
  if (existingSync) syncState = existingSync;
  if (!(await fs.access(LEADS_FILE).then(() => true).catch(() => false))) await writeJson(LEADS_FILE, []);
  console.log(`Сайт «Дом Сантехники» запущен: http://${HOST}:${PORT}`);
  console.log(`Уведомления: Telegram=${Boolean(env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_CHAT_ID"))}, MAX=${Boolean(env("MAX_BOT_TOKEN") && env("MAX_CHAT_ID"))}`);
  if (env("VK_ACCESS_TOKEN")) {
    const minutes = Math.max(5, Number(env("VK_SYNC_INTERVAL_MINUTES", "30")) || 30);
    setTimeout(() => syncVkWall(), 1200);
    setInterval(() => syncVkWall(), minutes * 60 * 1000).unref();
    console.log(`VK-синхронизация: при старте и каждые ${minutes} мин.`);
  } else {
    console.log("VK-синхронизация ожидает VK_ACCESS_TOKEN в .env; публичная витрина новостей загружена из data/news.json.");
  }
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
