import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import fetch from "node-fetch";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnvFile(path.join(__dirname, ".env"));

const PORT = getRequiredEnv("PORT");
const JINA_API_KEY = getRequiredEnv("JINA_API_KEY");
const JINA_EMBEDDING_URL = normalizeBaseUrl(process.env.JINA_EMBEDDING_URL || "https://api.jina.ai/v1/embeddings");
const EMBEDDING_MODEL = getRequiredEnv("JINA_EMBEDDING_MODEL");
const EMBEDDING_DIMENSION = Number(getRequiredEnv("EMBEDDING_DIMENSION"));
const GROQ_API_KEY = getRequiredEnv("GROQ_API_KEY");
const GROQ_CHAT_URL = normalizeBaseUrl(process.env.GROQ_CHAT_URL || "https://api.groq.com/openai/v1/chat/completions");
const CHAT_MODEL = getRequiredEnv("GROQ_CHAT_MODEL");
const QDRANT_URL = normalizeBaseUrl(getRequiredEnv("QDRANT_URL"));
const QDRANT_API_KEY = getRequiredEnv("QDRANT_API_KEY");
const QDRANT_COLLECTION = getRequiredEnv("QDRANT_COLLECTION");
const DEFAULT_MARKDOWN_URL = process.env.MARKDOWN_URL;
const DEFAULT_USER_ID = "default-user";
const AUTH_USERS_FILE = path.join(__dirname, process.env.AUTH_USERS_FILE || "auth-users.json");
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === "true";
const RASA_SERVICE_TOKEN = process.env.RASA_SERVICE_TOKEN;
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || RASA_SERVICE_TOKEN || "local-development-auth-token-secret";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  const allowedOrigins = new Set([FRONTEND_URL, "http://localhost:5173", "http://127.0.0.1:5173"]);
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const userSessions = new Map();
const authUsers = new Map();
const authTokens = new Map();
const googleStates = new Map();

const answerSystemPrompt = `You are an expert documentation assistant.

Use only the provided context to answer the user's question.

Guidelines:
- Answer accurately using the context.
- Include relevant code examples when the context contains them.
- Mention when the answer is not available in the provided context.
- Keep the answer clear and helpful.`;

const compareSystemPrompt = `You compare two markdown documents using only the provided context.

Guidelines:
- Compare purpose, setup, usage, features, and important differences.
- Be clear when the provided context is not enough.
- Keep the response practical and structured.`;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function getUserId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_USER_ID;
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function base64UrlDecode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function signAuthPayload(payload) {
  return crypto.createHmac("sha256", AUTH_TOKEN_SECRET).update(payload).digest("base64url");
}

function createSignedAuthToken(user) {
  const payload = base64UrlEncode({
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  return `${payload}.${signAuthPayload(payload)}`;
}

function readSignedAuthToken(token) {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;
    const expectedSignature = signAuthPayload(payload);
    const expected = Buffer.from(expectedSignature);
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

    const user = base64UrlDecode(payload);
    if (!user.id || !user.email || !user.exp || Date.now() > user.exp) return null;
    return user;
  } catch {
    return null;
  }
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, passwordHash };
}

function verifyPassword(password, record) {
  const candidate = crypto.scryptSync(password, record.salt, 64);
  const stored = Buffer.from(record.passwordHash, "hex");
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

function saveAuthUsers() {
  const users = Object.fromEntries([...authUsers.entries()].map(([email, user]) => [email, user]));
  fs.writeFileSync(AUTH_USERS_FILE, JSON.stringify(users, null, 2), { encoding: "utf8", mode: 0o600 });
}

function loadAuthUsers() {
  if (!fs.existsSync(AUTH_USERS_FILE)) return;
  try {
    const users = JSON.parse(fs.readFileSync(AUTH_USERS_FILE, "utf8"));
    for (const [email, user] of Object.entries(users)) authUsers.set(email, user);
  } catch (error) {
    console.error("Could not read stored auth users:", error.message);
  }
}

function createOrUpdateGoogleUser(profile) {
  const email = normalizeEmail(profile.email);
  const existing = authUsers.get(email);
  const user = existing || { id: `user-${crypto.randomUUID()}`, email, provider: "google" };
  user.name = profile.name || email.split("@")[0];
  user.picture = profile.picture || user.picture;
  authUsers.set(email, user);
  saveAuthUsers();
  return user;
}

function createAuthResponse(user) {
  const token = createSignedAuthToken(user);
  return { token, user: { id: user.id, name: user.name, email: user.email, picture: user.picture } };
}

function getAuthenticatedUser(req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const tokenUser = readSignedAuthToken(token);
  if (!tokenUser) return null;
  return [...authUsers.values()].find((user) => user.id === tokenUser.id) || tokenUser;
}

function getServiceUserId(req, suppliedUserId) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!RASA_SERVICE_TOKEN || token !== RASA_SERVICE_TOKEN) return null;
  return getUserId(suppliedUserId);
}
function resolveUserId(req, suppliedUserId) {
  const authenticatedUser = getAuthenticatedUser(req);
  if (authenticatedUser) return authenticatedUser.id;
  const serviceUserId = getServiceUserId(req, suppliedUserId);
  if (serviceUserId) return serviceUserId;
  if (REQUIRE_AUTH) {
    const error = new Error("Please sign in again before using this document workspace.");
    error.statusCode = 401;
    throw error;
  }
  return getUserId(suppliedUserId);
}

function sendEndpointError(res, error, fallbackStatus = 500) {
  return res.status(error.statusCode || fallbackStatus).json({ error: error.message });
}
loadAuthUsers();

function getOrCreateSession(userId) {
  if (!userSessions.has(userId)) userSessions.set(userId, { activeDocumentId: null });
  return userSessions.get(userId);
}

function getDocumentName(url) {
  try {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    return decodeURIComponent(pathParts.at(-1) || "markdown-document.md");
  } catch {
    return "markdown-document.md";
  }
}

function createDocumentId(url, userId) {
  const name = getDocumentName(url)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "document";
  const hash = crypto.createHash("sha1").update(`${userId}:${url}`).digest("hex").slice(0, 8);
  return `${name}-${hash}`;
}

function getChunkHeading(content) {
  const heading = content.split("\n").map((line) => line.trim()).find((line) => line.startsWith("#"));
  return heading ? heading.replace(/^#+\s*/, "") : null;
}

function serializeDocument(document, activeDocumentId) {
  return {
    documentId: document.documentId,
    name: document.documentName || document.name,
    sourceUrl: document.sourceUrl,
    chunkCount: document.chunkCount,
    loadedAt: document.createdAt || document.loadedAt,
    isActive: document.documentId === activeDocumentId,
  };
}

async function qdrantRequest(pathname, options = {}) {
  const response = await fetch(`${QDRANT_URL}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "api-key": QDRANT_API_KEY,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qdrant request failed: ${response.status} ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function ensureQdrantCollection() {
  const collectionPath = `/collections/${encodeURIComponent(QDRANT_COLLECTION)}`;
  const response = await fetch(`${QDRANT_URL}${collectionPath}`, { headers: { "api-key": QDRANT_API_KEY } });

  if (!response.ok) {
    if (response.status !== 404) {
      const text = await response.text();
      throw new Error(`Could not inspect Qdrant collection: ${response.status} ${text}`);
    }

    await qdrantRequest(collectionPath, {
      method: "PUT",
      body: JSON.stringify({ vectors: { size: EMBEDDING_DIMENSION, distance: "Cosine" } }),
    });
  } else {
    const data = await response.json();
    const existingSize = data.result?.config?.params?.vectors?.size;
    if (existingSize && Number(existingSize) !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Qdrant collection ${QDRANT_COLLECTION} uses vector size ${existingSize}, but EMBEDDING_DIMENSION is ${EMBEDDING_DIMENSION}. Use a new QDRANT_COLLECTION name or recreate the collection.`
      );
    }
  }

  await ensurePayloadIndexes();
}

async function ensurePayloadIndexes() {
  const indexedFields = ["userId", "documentId", "documentName", "sourceUrl"];

  for (const fieldName of indexedFields) {
    try {
      await qdrantRequest(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/index?wait=true`, {
        method: "PUT",
        body: JSON.stringify({ field_name: fieldName, field_schema: "keyword" }),
      });
    } catch (error) {
      if (!String(error.message).includes("already exists")) throw error;
    }
  }
}

function createFilter(conditions) {
  return { must: conditions.map(([key, value]) => ({ key, match: { value } })) };
}

async function deleteExistingDocumentChunks(userId, documentId) {
  await qdrantRequest(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({ filter: createFilter([["userId", userId], ["documentId", documentId]]) }),
  });
}

async function deleteUserDocuments(userId) {
  await qdrantRequest(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({ filter: createFilter([["userId", userId]]) }),
  });
  userSessions.set(userId, { activeDocumentId: null });
}

async function deleteActiveDocument(userId) {
  const session = getOrCreateSession(userId);
  const documents = await listDocuments(userId);
  const activeDocument = await findDocument(userId, session.activeDocumentId) || documents.at(-1);

  if (!activeDocument) throw new Error("No active document is loaded for this user.");

  await deleteExistingDocumentChunks(userId, activeDocument.documentId);

  session.activeDocumentId = null;
  const remainingDocuments = await listDocuments(userId);

  return {
    userId,
    removedDocument: activeDocument,
    activeDocument: remainingDocuments.find((document) => document.isActive) || null,
    documents: remainingDocuments,
  };
}

async function upsertChunks(chunks, vectors, metadata) {
  const points = chunks.map((chunk, index) => ({
    id: crypto.randomUUID(),
    vector: vectors[index],
    payload: {
      userId: metadata.userId,
      documentId: metadata.documentId,
      documentName: metadata.documentName,
      sourceUrl: metadata.sourceUrl,
      chunkIndex: index,
      heading: getChunkHeading(chunk.pageContent),
      content: chunk.pageContent,
      createdAt: metadata.createdAt,
    },
  }));

  await qdrantRequest(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({ points }),
  });
}

async function scrollUserPoints(userId) {
  const points = [];
  let offset = null;

  do {
    const body = { filter: createFilter([["userId", userId]]), limit: 100, with_payload: true, with_vector: false };
    if (offset) body.offset = offset;

    const data = await qdrantRequest(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points/scroll`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    points.push(...(data.result.points || []));
    offset = data.result.next_page_offset || null;
  } while (offset);

  return points;
}

async function listDocuments(userId) {
  const session = getOrCreateSession(userId);
  const points = await scrollUserPoints(userId);
  const documentsById = new Map();

  for (const point of points) {
    const payload = point.payload || {};
    const documentId = payload.documentId;
    if (!documentId) continue;

    const existing = documentsById.get(documentId);
    if (!existing) {
      documentsById.set(documentId, {
        documentId,
        documentName: payload.documentName,
        sourceUrl: payload.sourceUrl,
        chunkCount: 1,
        createdAt: payload.createdAt,
      });
    } else {
      existing.chunkCount += 1;
    }
  }

  const documents = Array.from(documentsById.values()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (!session.activeDocumentId && documents.length) session.activeDocumentId = documents.at(-1).documentId;
  return documents.map((document) => serializeDocument(document, session.activeDocumentId));
}

async function findDocument(userId, identifier) {
  if (!identifier) return null;

  const documents = await listDocuments(userId);
  const normalizedIdentifier = String(identifier).trim().toLowerCase();
  if (!normalizedIdentifier) return null;

  if (/^\d+$/.test(normalizedIdentifier)) return documents[Number(normalizedIdentifier) - 1] || null;

  return documents.find((document) => {
    const name = document.name.toLowerCase();
    const id = document.documentId.toLowerCase();
    return id === normalizedIdentifier || name === normalizedIdentifier || name.includes(normalizedIdentifier);
  }) || null;
}

async function switchActiveDocument(userId, identifier) {
  const session = getOrCreateSession(userId);
  const document = await findDocument(userId, identifier);
  if (!document) throw new Error("I could not find that document for this user.");

  session.activeDocumentId = document.documentId;
  return { userId, activeDocument: document, documents: await listDocuments(userId) };
}

async function downloadMarkdown(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download markdown: ${response.status} ${response.statusText}`);
  return response.text();
}

async function buildVectorStoreFromMarkdown(url, userId) {
  const markdown = await downloadMarkdown(url);
  return buildVectorStoreFromMarkdownContent(markdown, url, userId);
}

async function buildVectorStoreFromMarkdownContent(markdown, url, userId, documentName = getDocumentName(url)) {
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 150, separators: ["\n\n", "\n", " ", ""] });
  const documentId = createDocumentId(url, userId);
  const createdAt = new Date().toISOString();
  const docs = [new Document({ pageContent: markdown, metadata: { source: url, userId, documentId, documentName } })];
  const chunks = await splitter.splitDocuments(docs);
  const vectors = await embedTexts(chunks.map((chunk) => chunk.pageContent), "retrieval.passage");

  await deleteExistingDocumentChunks(userId, documentId);
  await upsertChunks(chunks, vectors, { userId, documentId, documentName, sourceUrl: url, createdAt });

  const session = getOrCreateSession(userId);
  session.activeDocumentId = documentId;

  return {
    userId,
    document: { documentId, name: documentName, sourceUrl: url, chunkCount: chunks.length, loadedAt: createdAt, isActive: true },
    documents: await listDocuments(userId),
  };
}

function extractEmbeddings(data) {
  if (!Array.isArray(data?.data)) throw new Error("Jina did not return embeddings data.");
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

async function embedTexts(input, task) {
  const texts = Array.isArray(input) ? input : [input];
  const response = await fetch(JINA_EMBEDDING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      task,
      dimensions: EMBEDDING_DIMENSION,
      embedding_type: "float",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Jina embedding request failed: ${response.status} ${JSON.stringify(data)}`);
  const vectors = extractEmbeddings(data);
  return Array.isArray(input) ? vectors : vectors[0];
}

async function createChatCompletion(messages) {
  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      temperature: 0.1,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Groq chat request failed: ${response.status} ${JSON.stringify(data)}`);
  return data.choices?.[0]?.message?.content?.trim() || "I could not generate an answer from the retrieved context.";
}

async function searchDocumentContext(userId, documentId, query, limit = 5) {
  const questionVector = await embedTexts(query, "retrieval.query");
  const data = await qdrantRequest(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points/search`, {
    method: "POST",
    body: JSON.stringify({
      vector: questionVector,
      filter: createFilter([["userId", userId], ["documentId", documentId]]),
      limit,
      with_payload: true,
      with_vector: false,
    }),
  });

  return data.result || [];
}

async function answerQuestion(question, userId, documentId) {
  const session = getOrCreateSession(userId);
  const documents = await listDocuments(userId);
  const targetDocument = documentId
    ? await findDocument(userId, documentId)
    : await findDocument(userId, session.activeDocumentId) || documents.at(-1);

  if (!targetDocument) throw new Error("No markdown document is loaded for this user yet. Call POST /load-document first.");

  session.activeDocumentId = targetDocument.documentId;
  const relevantDocs = await searchDocumentContext(userId, targetDocument.documentId, question, 5);
  const context = relevantDocs.map((point) => point.payload?.content).filter(Boolean).join("\n\n");
  const answer = await createChatCompletion([
    { role: "system", content: `${answerSystemPrompt}\n\nContext:\n${context}` },
    { role: "user", content: question },
  ]);

  return {
    answer,
    userId,
    document: targetDocument,
    retrievedChunks: relevantDocs.length,
  };
}

async function compareDocuments(userId, leftIdentifier, rightIdentifier, question) {
  const documents = await listDocuments(userId);
  if (documents.length < 2) throw new Error("Load at least two documents before comparing them.");

  const leftDocument = leftIdentifier ? await findDocument(userId, leftIdentifier) : documents[0];
  const rightDocument = rightIdentifier ? await findDocument(userId, rightIdentifier) : documents[1];
  if (!leftDocument || !rightDocument) throw new Error("I could not find the documents to compare.");
  if (leftDocument.documentId === rightDocument.documentId) throw new Error("Choose two different documents to compare.");

  const compareQuestion = question || "Compare these two documents by purpose, setup, usage, features, and important differences.";
  const leftDocs = await searchDocumentContext(userId, leftDocument.documentId, compareQuestion, 6);
  const rightDocs = await searchDocumentContext(userId, rightDocument.documentId, compareQuestion, 6);
  const leftContext = leftDocs.map((point) => point.payload?.content).filter(Boolean).join("\n\n");
  const rightContext = rightDocs.map((point) => point.payload?.content).filter(Boolean).join("\n\n");
  const answer = await createChatCompletion([
    { role: "system", content: `${compareSystemPrompt}\n\nDocument A context:\n${leftContext}\n\nDocument B context:\n${rightContext}` },
    { role: "user", content: compareQuestion },
  ]);

  return {
    answer,
    userId,
    documents: [leftDocument, rightDocument],
    retrievedChunks: leftDocs.length + rightDocs.length,
  };
}

app.get("/health", async (req, res) => {
  res.json({ ok: true, qdrantCollection: QDRANT_COLLECTION, chatModel: CHAT_MODEL, embeddingModel: EMBEDDING_MODEL });
});

app.post("/auth/signup", (req, res) => {
  const { name, email: rawEmail, password } = req.body;
  const email = normalizeEmail(rawEmail);
  if (!name?.trim() || !email || !password) return res.status(400).json({ error: "Name, email, and password are required." });
  if (password.length < 8) return res.status(400).json({ error: "Use a password with at least 8 characters." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (authUsers.has(email)) return res.status(409).json({ error: "An account with that email already exists." });

  const user = { id: `user-${crypto.randomUUID()}`, name: name.trim(), email, ...createPasswordRecord(password) };
  authUsers.set(email, user);
  saveAuthUsers();
  return res.status(201).json(createAuthResponse(user));
});

app.post("/auth/login", (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = authUsers.get(email);
  if (!user || !verifyPassword(req.body.password || "", user)) return res.status(401).json({ error: "The email or password is incorrect." });
  return res.json(createAuthResponse(user));
});

app.get("/auth/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(503).send("Google sign-in is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the backend .env file.");
  const state = crypto.randomBytes(24).toString("hex");
  googleStates.set(state, Date.now());
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: GOOGLE_REDIRECT_URI, response_type: "code", scope: "openid email profile", state, access_type: "offline", prompt: "select_account" });
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/auth/google/callback", async (req, res) => {
  const { code, state } = req.query;
  const issuedAt = googleStates.get(state);
  googleStates.delete(state);
  if (!code || !issuedAt || Date.now() - issuedAt > 10 * 60 * 1000) return res.status(400).send("The Google sign-in request expired. Please try again.");

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: GOOGLE_REDIRECT_URI, grant_type: "authorization_code" }) });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokenData.error_description || "Google token exchange failed.");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.email) throw new Error("Google did not return an email address.");
    const authResponse = createAuthResponse(createOrUpdateGoogleUser(profile));
    const redirectParams = new URLSearchParams({ auth_token: authResponse.token, auth_user: JSON.stringify(authResponse.user) });
    return res.redirect(`${FRONTEND_URL}/?${redirectParams}`);
  } catch (error) {
    return res.status(502).send(`Google sign-in failed: ${error.message}`);
  }
});

app.get("/auth/me", (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  return res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.post("/auth/logout", (req, res) => {
  const authorization = req.headers.authorization || "";
  if (authorization.startsWith("Bearer ")) authTokens.delete(authorization.slice(7));
  return res.json({ ok: true });
});

app.get("/documents", async (req, res) => {
  const userId = resolveUserId(req, req.query.userId);
  try {
    res.json({ userId, documents: await listDocuments(userId) });
  } catch (error) {
    sendEndpointError(res, error);
  }
});

app.post("/load-document", async (req, res) => {
  const { url, userId: rawUserId } = req.body;
  const userId = resolveUserId(req, rawUserId);
  if (!url || typeof url !== "string") return res.status(400).json({ error: 'Request body must include a markdown URL, for example: { "url": "https://example.com/README.md" }' });

  try {
    const result = await buildVectorStoreFromMarkdown(url, userId);
    return res.json({ message: "Markdown document loaded successfully.", ...result });
  } catch (error) {
    console.error("Failed to load markdown document:", error);
    return sendEndpointError(res, error);
  }
});

app.post("/load-markdown", async (req, res) => {
  const { markdown, name, sourceUrl, userId: rawUserId } = req.body;
  const userId = resolveUserId(req, rawUserId);
  if (!markdown || typeof markdown !== "string") return res.status(400).json({ error: "Request body must include markdown content." });

  const documentName = typeof name === "string" && name.trim() ? name.trim() : "uploaded-document.md";
  const documentUrl = typeof sourceUrl === "string" && sourceUrl.trim() ? sourceUrl.trim() : `upload://${documentName}`;

  try {
    const result = await buildVectorStoreFromMarkdownContent(markdown, documentUrl, userId, documentName);
    return res.json({ message: "Uploaded markdown document loaded successfully.", ...result });
  } catch (error) {
    console.error("Failed to load uploaded markdown document:", error);
    return sendEndpointError(res, error);
  }
});

app.post("/switch-document", async (req, res) => {
  const { userId: rawUserId, documentId } = req.body;
  const userId = resolveUserId(req, rawUserId);
  if (!documentId || typeof documentId !== "string") return res.status(400).json({ error: 'Request body must include a documentId, name, or list number, for example: { "documentId": "README.md" }' });

  try {
    const result = await switchActiveDocument(userId, documentId);
    return res.json({ message: "Active document switched successfully.", ...result });
  } catch (error) {
    return sendEndpointError(res, error, 404);
  }
});

app.post("/reset-active-document", async (req, res) => {
  const { userId: rawUserId } = req.body;
  const userId = resolveUserId(req, rawUserId);

  try {
    const result = await deleteActiveDocument(userId);
    return res.json({ message: "The active document was removed.", ...result });
  } catch (error) {
    console.error("Failed to reset active document:", error);
    return sendEndpointError(res, error);
  }
});
app.post("/reset-documents", async (req, res) => {
  const { userId: rawUserId } = req.body;
  const userId = resolveUserId(req, rawUserId);

  try {
    await deleteUserDocuments(userId);
    return res.json({ message: "Your loaded documents were cleared.", userId, documents: [] });
  } catch (error) {
    console.error("Failed to reset documents:", error);
    return sendEndpointError(res, error);
  }
});

app.post("/compare-documents", async (req, res) => {
  const { userId: rawUserId, leftDocumentId, rightDocumentId, question } = req.body;
  const userId = resolveUserId(req, rawUserId);

  try {
    const result = await compareDocuments(userId, leftDocumentId, rightDocumentId, question);
    return res.json(result);
  } catch (error) {
    console.error("Failed to compare documents:", error);
    return sendEndpointError(res, error);
  }
});

app.post("/ask", async (req, res) => {
  const { question, userId: rawUserId, documentId } = req.body;
  const userId = resolveUserId(req, rawUserId);
  if (!question || typeof question !== "string") return res.status(400).json({ error: 'Request body must include a question, for example: { "question": "How do I install this?" }' });

  try {
    const result = await answerQuestion(question, userId, documentId);
    return res.json(result);
  } catch (error) {
    console.error("Failed to answer question:", error);
    return sendEndpointError(res, error);
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  return sendEndpointError(res, error);
});
app.listen(PORT, "0.0.0.0", async () => {
  await ensureQdrantCollection();
  console.log(`RAG server is running on port ${PORT}`);
  console.log(`Using Groq chat model ${CHAT_MODEL}`);
  console.log(`Using Jina embedding model ${EMBEDDING_MODEL}`);
  console.log(`Using Qdrant collection ${QDRANT_COLLECTION}`);

  if (!DEFAULT_MARKDOWN_URL) {
    console.log("No default markdown URL set. Call POST /load-document before asking questions.");
    return;
  }

  try {
    console.log("Loading default markdown document from MARKDOWN_URL");
    const result = await buildVectorStoreFromMarkdown(DEFAULT_MARKDOWN_URL, DEFAULT_USER_ID);
    console.log(`Loaded ${result.document.chunkCount} chunks from ${result.document.sourceUrl}`);
  } catch (error) {
    console.error("Failed to load default markdown document:", error);
  }
});






