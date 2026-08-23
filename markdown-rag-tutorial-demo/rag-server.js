import express from "express";
import fetch from "node-fetch";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OllamaEmbeddings, ChatOllama } from "@langchain/ollama";
import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";
const CHAT_MODEL = process.env.CHAT_MODEL || "granite3.3:2b";
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

function getUserId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_USER_ID;
}

function getSession(userId) {
  return userSessions.get(userId) || null;
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

  const docs = [
    new Document({
      pageContent: markdown,
      metadata: { source: url, userId },
    }),
  ];

  const chunks = await splitter.splitDocuments(docs);
  const vectorStore = await MemoryVectorStore.fromDocuments(chunks, embeddings);

  const session = {
    vectorStore,
    activeSourceUrl: url,
    activeChunkCount: chunks.length,
    loadedAt: new Date().toISOString(),
  };

  userSessions.set(userId, session);

  return {
    userId,
    sourceUrl: session.activeSourceUrl,
    chunkCount: session.activeChunkCount,
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

async function answerQuestion(question, userId) {
  const session = getSession(userId);

  if (!session?.vectorStore) {
    throw new Error(
      "No markdown document is loaded for this user yet. Call POST /load-document first."
    );
  }

  const retriever = session.vectorStore.asRetriever({ k: 5 });
  const relevantDocs = await retriever.getRelevantDocuments(question);
  const context = relevantDocs.map((doc) => doc.pageContent).join("\n\n");

  const promptMessages = await promptTemplate.formatMessages({
    context,
    question,
  });

  const response = await llm.invoke(promptMessages);
  const answer = normalizeModelResponse(response);

  return {
    answer,
    userId,
    sourceUrl: session.activeSourceUrl,
    retrievedChunks: relevantDocs.length,
  };
}

app.get("/health", (req, res) => {
  const sessions = Array.from(userSessions.entries()).map(([userId, session]) => ({
    userId,
    documentLoaded: Boolean(session.vectorStore),
    sourceUrl: session.activeSourceUrl,
    chunkCount: session.activeChunkCount,
    loadedAt: session.loadedAt,
  }));

  res.json({
    ok: true,
    sessionCount: userSessions.size,
    sessions,
    chatModel: CHAT_MODEL,
    embeddingModel: EMBEDDING_MODEL,
  });
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

app.post("/ask", async (req, res) => {
  const { question, userId: rawUserId } = req.body;
  const userId = getUserId(rawUserId);

  if (!question || typeof question !== "string") {
    return res.status(400).json({
      error:
        'Request body must include a question, for example: { "question": "How do I install this?" }',
    });
  }

  try {
    const result = await answerQuestion(question, userId);
    return res.json(result);
  } catch (error) {
    console.error("Failed to answer question:", error);

    return res.status(500).json({
      error: error.message,
    });
  }
});

app.listen(PORT, async () => {
  console.log(`RAG server is running at http://localhost:${PORT}`);
  console.log(`Using Ollama at ${OLLAMA_BASE_URL}`);
  console.log(`Chat model: ${CHAT_MODEL}`);
  console.log(`Embedding model: ${EMBEDDING_MODEL}`);

  if (!DEFAULT_MARKDOWN_URL) {
    console.log(
      "No default markdown URL set. Call POST /load-document before asking questions."
    );
    return;
  }

  try {
    console.log(`Loading default markdown document: ${DEFAULT_MARKDOWN_URL}`);
    const result = await buildVectorStoreFromMarkdown(DEFAULT_MARKDOWN_URL, DEFAULT_USER_ID);
    console.log(`Loaded ${result.chunkCount} chunks from ${result.sourceUrl}`);
  } catch (error) {
    console.error("Failed to load default markdown document:", error);
  }
});
