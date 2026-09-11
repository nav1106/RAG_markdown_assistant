import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import fetch from "node-fetch";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OllamaEmbeddings, ChatOllama } from "@langchain/ollama";
import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = getRequiredEnv("PORT");
const OLLAMA_BASE_URL = getRequiredEnv("OLLAMA_BASE_URL");
const EMBEDDING_MODEL = getRequiredEnv("EMBEDDING_MODEL");
const EMBEDDING_DIMENSION = Number(getRequiredEnv("EMBEDDING_DIMENSION"));
const CHAT_MODEL = getRequiredEnv("CHAT_MODEL");
const QDRANT_URL = normalizeBaseUrl(getRequiredEnv("QDRANT_URL"));
const QDRANT_API_KEY = getRequiredEnv("QDRANT_API_KEY");
const QDRANT_COLLECTION = getRequiredEnv("QDRANT_COLLECTION");
const DEFAULT_MARKDOWN_URL = process.env.MARKDOWN_URL;
const DEFAULT_USER_ID = "default-user";

const userSessions = new Map();

const embeddings = new OllamaEmbeddings({
  model: EMBEDDING_MODEL,
  baseUrl: OLLAMA_BASE_URL,
});

const llm = new ChatOllama({
  model: CHAT_MODEL,
  temperature: 0.1,
  baseUrl: OLLAMA_BASE_URL,
});

const promptTemplate = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are an expert documentation assistant.

Use only the provided context to answer the user's question.

Context:
{context}

Guidelines:
- Answer accurately using the context.
- Include relevant code examples when the context contains them.
- Mention when the answer is not available in the provided context.
- Keep the answer clear and helpful.`,
  ],
  ["human", "{question}"],
]);

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

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function getUserId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_USER_ID;
}

function getOrCreateSession(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      activeDocumentId: null,
    });
  }

  return userSessions.get(userId);
}

function getSession(userId) {
  return userSessions.get(userId) || null;
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
  const hash = crypto
    .createHash("sha1")
    .update(`${userId}:${url}`)
    .digest("hex")
    .slice(0, 8);

  return `${name}-${hash}`;
}

function getChunkHeading(content) {
  const heading = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));

  return heading ? heading.replace(/^#+\s*/, "") : null;
}

function serializeDocument(document, activeDocumentId) {
  return {
    documentId: document.documentId,
    name: document.documentName,
    sourceUrl: document.sourceUrl,
    chunkCount: document.chunkCount,
    loadedAt: document.createdAt,
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

  const response = await fetch(`${QDRANT_URL}${collectionPath}`, {
    headers: {
      "api-key": QDRANT_API_KEY,
    },
  });

  if (!response.ok) {
    if (response.status !== 404) {
      const text = await response.text();
      throw new Error(`Could not inspect Qdrant collection: ${response.status} ${text}`);
    }

    await qdrantRequest(collectionPath, {
      method: "PUT",
      body: JSON.stringify({
        vectors: {
          size: EMBEDDING_DIMENSION,
          distance: "Cosine",
        },
      }),
    });
  }

  await ensurePayloadIndexes();
}

async function ensurePayloadIndexes() {
  const indexedFields = ["userId", "documentId", "documentName", "sourceUrl"];

  for (const fieldName of indexedFields) {
    try {
      await qdrantRequest(
        `/collections/${encodeURIComponent(QDRANT_COLLECTION)}/index?wait=true`,
        {
          method: "PUT",
          body: JSON.stringify({
            field_name: fieldName,
            field_schema: "keyword",
          }),
        }
      );
    } catch (error) {
      if (!String(error.message).includes("already exists")) {
        throw error;
      }
    }
  }
}

function createFilter(conditions) {
  return {
    must: conditions.map(([key, value]) => ({
      key,
      match: { value },
    })),
  };
}

async function deleteExistingDocumentChunks(userId, documentId) {
  await qdrantRequest(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({
      filter: createFilter([
        ["userId", userId],
        ["documentId", documentId],
      ]),
    }),
  });
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
    const body = {
      filter: createFilter([["userId", userId]]),
      limit: 100,
      with_payload: true,
      with_vector: false,
    };

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
      continue;
    }

    existing.chunkCount += 1;
  }

  const documents = Array.from(documentsById.values()).sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt))
  );

  if (!session.activeDocumentId && documents.length) {
    session.activeDocumentId = documents.at(-1).documentId;
  }

  return documents.map((document) => serializeDocument(document, session.activeDocumentId));
}

async function findDocument(userId, identifier) {
  if (!identifier) return null;

  const documents = await listDocuments(userId);
  const normalizedIdentifier = String(identifier).trim().toLowerCase();
  if (!normalizedIdentifier) return null;

  if (/^\d+$/.test(normalizedIdentifier)) {
    return documents[Number(normalizedIdentifier) - 1] || null;
  }

  return documents.find((document) => {
    const name = document.name.toLowerCase();
    const id = document.documentId.toLowerCase();
    return id === normalizedIdentifier || name === normalizedIdentifier || name.includes(normalizedIdentifier);
  }) || null;
}

async function switchActiveDocument(userId, identifier) {
  const session = getOrCreateSession(userId);
  const document = await findDocument(userId, identifier);

  if (!document) {
    throw new Error("I could not find that document for this user.");
  }

  session.activeDocumentId = document.documentId;

  return {
    userId,
    activeDocument: document,
    documents: await listDocuments(userId),
  };
}

async function downloadMarkdown(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download markdown: ${response.status} ${response.statusText}`
    );
  }

  return response.text();
}

async function buildVectorStoreFromMarkdown(url, userId) {
  const markdown = await downloadMarkdown(url);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ["\n\n", "\n", " ", ""],
  });

  const documentId = createDocumentId(url, userId);
  const documentName = getDocumentName(url);
  const createdAt = new Date().toISOString();

  const docs = [
    new Document({
      pageContent: markdown,
      metadata: { source: url, userId, documentId, documentName },
    }),
  ];

  const chunks = await splitter.splitDocuments(docs);
  const vectors = await embeddings.embedDocuments(chunks.map((chunk) => chunk.pageContent));

  await deleteExistingDocumentChunks(userId, documentId);
  await upsertChunks(chunks, vectors, {
    userId,
    documentId,
    documentName,
    sourceUrl: url,
    createdAt,
  });

  const session = getOrCreateSession(userId);
  session.activeDocumentId = documentId;

  return {
    userId,
    document: {
      documentId,
      name: documentName,
      sourceUrl: url,
      chunkCount: chunks.length,
      loadedAt: createdAt,
      isActive: true,
    },
    documents: await listDocuments(userId),
  };
}

function normalizeModelResponse(response) {
  if (typeof response.content === "string") {
    return response.content;
  }

  if (Array.isArray(response.content)) {
    return response.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }

  return String(response.content ?? "");
}

async function answerQuestion(question, userId, documentId) {
  const session = getOrCreateSession(userId);
  const targetDocument = documentId
    ? await findDocument(userId, documentId)
    : await findDocument(userId, session.activeDocumentId) || (await listDocuments(userId)).at(-1);

  if (!targetDocument) {
    throw new Error(
      "No markdown document is loaded for this user yet. Call POST /load-document first."
    );
  }

  session.activeDocumentId = targetDocument.documentId;

  const questionVector = await embeddings.embedQuery(question);
  const data = await qdrantRequest(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points/search`, {
    method: "POST",
    body: JSON.stringify({
      vector: questionVector,
      filter: createFilter([
        ["userId", userId],
        ["documentId", targetDocument.documentId],
      ]),
      limit: 5,
      with_payload: true,
      with_vector: false,
    }),
  });

  const relevantDocs = data.result || [];
  const context = relevantDocs.map((point) => point.payload?.content).filter(Boolean).join("\n\n");

  const promptMessages = await promptTemplate.formatMessages({
    context,
    question,
  });

  const response = await llm.invoke(promptMessages);
  const answer = normalizeModelResponse(response);

  return {
    answer,
    userId,
    document: targetDocument,
    retrievedChunks: relevantDocs.length,
  };
}

app.get("/health", async (req, res) => {
  try {
    res.json({
      ok: true,
      qdrantCollection: QDRANT_COLLECTION,
      chatModel: CHAT_MODEL,
      embeddingModel: EMBEDDING_MODEL,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/documents", async (req, res) => {
  const userId = getUserId(req.query.userId);

  try {
    res.json({
      userId,
      documents: await listDocuments(userId),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/load-document", async (req, res) => {
  const { url, userId: rawUserId } = req.body;
  const userId = getUserId(rawUserId);

  if (!url || typeof url !== "string") {
    return res.status(400).json({
      error:
        'Request body must include a markdown URL, for example: { "url": "https://example.com/README.md" }',
    });
  }

  try {
    const result = await buildVectorStoreFromMarkdown(url, userId);

    return res.json({
      message: "Markdown document loaded successfully.",
      ...result,
    });
  } catch (error) {
    console.error("Failed to load markdown document:", error);

    return res.status(500).json({
      error: error.message,
    });
  }
});

app.post("/switch-document", async (req, res) => {
  const { userId: rawUserId, documentId } = req.body;
  const userId = getUserId(rawUserId);

  if (!documentId || typeof documentId !== "string") {
    return res.status(400).json({
      error: 'Request body must include a documentId, name, or list number, for example: { "documentId": "README.md" }',
    });
  }

  try {
    const result = await switchActiveDocument(userId, documentId);
    return res.json({
      message: "Active document switched successfully.",
      ...result,
    });
  } catch (error) {
    return res.status(404).json({
      error: error.message,
    });
  }
});

app.post("/ask", async (req, res) => {
  const { question, userId: rawUserId, documentId } = req.body;
  const userId = getUserId(rawUserId);

  if (!question || typeof question !== "string") {
    return res.status(400).json({
      error:
        'Request body must include a question, for example: { "question": "How do I install this?" }',
    });
  }

  try {
    const result = await answerQuestion(question, userId, documentId);
    return res.json(result);
  } catch (error) {
    console.error("Failed to answer question:", error);

    return res.status(500).json({
      error: error.message,
    });
  }
});

app.listen(PORT, async () => {
  await ensureQdrantCollection();

  console.log(`RAG server is running at http://localhost:${PORT}`);
  console.log(`Using Ollama at ${OLLAMA_BASE_URL}`);
  console.log(`Using Qdrant collection ${QDRANT_COLLECTION}`);

  if (!DEFAULT_MARKDOWN_URL) {
    console.log(
      "No default markdown URL set. Call POST /load-document before asking questions."
    );
    return;
  }

  try {
    console.log(`Loading default markdown document from MARKDOWN_URL`);
    const result = await buildVectorStoreFromMarkdown(DEFAULT_MARKDOWN_URL, DEFAULT_USER_ID);
    console.log(`Loaded ${result.document.chunkCount} chunks from ${result.document.sourceUrl}`);
  } catch (error) {
    console.error("Failed to load default markdown document:", error);
  }
});

