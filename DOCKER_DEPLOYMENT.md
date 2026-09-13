# Docker And Cloud Deployment Guide

This guide shows how to run the Markdown RAG Assistant with Docker locally, then deploy it for global users.

## What Runs Where

Local Docker Compose starts four services:

- `frontend`: React app served by Nginx on `http://localhost:5173`
- `rag-server`: Node.js RAG API on `http://localhost:3000`
- `rasa-actions`: Python Rasa custom action server on `http://localhost:5055`
- `rasa-api`: Rasa chatbot API on `http://localhost:5005`

In Docker, services talk to each other by container name:

- Rasa actions call `http://rag-server:3000`
- Rasa API calls `http://rasa-actions:5055/webhook`
- The browser still calls `http://localhost:5005` and `http://localhost:3000`

## 1. Install Docker Desktop

1. Install Docker Desktop for Windows.
2. Open Docker Desktop and wait until it says Docker is running.
3. In a terminal, check:

```powershell
docker --version
docker compose version
```

## 2. Prepare Environment Variables

Create this file:

```txt
markdown-rag-tutorial-demo/.env
```

Use `markdown-rag-tutorial-demo/.env.example` as the template.

Required values:

```env
PORT=3000
GROQ_API_KEY=your-groq-api-key
GROQ_CHAT_MODEL=llama-3.1-8b-instant
JINA_API_KEY=your-jina-api-key
JINA_EMBEDDING_MODEL=jina-embeddings-v3
EMBEDDING_DIMENSION=1024
QDRANT_URL=https://your-qdrant-cluster-url
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_COLLECTION=markdown_chunks_jina
RASA_SERVICE_TOKEN=use-a-long-random-secret
REQUIRE_AUTH=false
FRONTEND_URL=http://localhost:5173
```

Keep real API keys only in `.env`. Do not commit `.env`.

## 3. Build And Start Locally

From the project root:

```powershell
cd "C:\Users\NavnitaK\VSCode Folder\RAG_markdown_assistant"
docker compose up --build
```

Open:

```txt
http://localhost:5173
```

To stop everything:

```powershell
docker compose down
```

To reset local Docker containers and the small auth storage volume:

```powershell
docker compose down -v
```

## 4. Test The Local Docker App

In the web app:

1. Send a raw markdown URL.
2. Ask `summarize current document`.
3. Ask `list documents`.
4. Load a second document.
5. Ask `compare document 1 and document 2`.

If something fails, check these URLs:

```txt
http://localhost:3000/health
http://localhost:5005
http://localhost:5173
```

## 5. Production Architecture

For global usage, use:

- Frontend: Vercel or Cloudflare Pages
- RAG server: Render web service
- Rasa API: Render web service
- Rasa actions: Render web service
- Vector database: Qdrant Cloud
- LLM: Groq
- Embeddings: Jina AI

Do not use Ollama for public deployment because Ollama runs on your laptop.

## 6. Deploy Backend On Render

Create three Render web services from the same GitHub repository.

### RAG Server

Settings:

```txt
Root directory: markdown-rag-tutorial-demo
Runtime: Docker
Dockerfile: markdown-rag-tutorial-demo/Dockerfile
```

Environment variables:

```env
PORT=10000
GROQ_API_KEY=your-groq-api-key
GROQ_CHAT_MODEL=llama-3.1-8b-instant
JINA_API_KEY=your-jina-api-key
JINA_EMBEDDING_MODEL=jina-embeddings-v3
EMBEDDING_DIMENSION=1024
QDRANT_URL=https://your-qdrant-cluster-url
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_COLLECTION=markdown_chunks_jina
RASA_SERVICE_TOKEN=the-same-long-secret-used-by-rasa-actions
REQUIRE_AUTH=false
FRONTEND_URL=https://your-frontend-domain
```

After deployment, copy the Render URL. It will look like:

```txt
https://your-rag-server.onrender.com
```

### Rasa Actions

Settings:

```txt
Root directory: rasa-bot
Runtime: Docker
Dockerfile: rasa-bot/Dockerfile.actions
```

Environment variables:

```env
RAG_SERVER_URL=https://your-rag-server.onrender.com
RAG_SERVICE_TOKEN=the-same-long-secret-used-by-rag-server
```

After deployment, copy the Render URL. It will look like:

```txt
https://your-rasa-actions.onrender.com
```

### Rasa API

Settings:

```txt
Root directory: rasa-bot
Runtime: Docker
Dockerfile: rasa-bot/Dockerfile
```

Environment variables:

```env
ACTION_ENDPOINT_URL=https://your-rasa-actions.onrender.com/webhook
```

After deployment, copy the Render URL. It will look like:

```txt
https://your-rasa-api.onrender.com
```

## 7. Deploy Frontend On Vercel

Create a Vercel project from the GitHub repository.

Settings:

```txt
Framework: Vite
Build command: npm run build
Output directory: dist
```

Environment variables:

```env
VITE_RASA_URL=https://your-rasa-api.onrender.com
VITE_RAG_AUTH_URL=https://your-rag-server.onrender.com
```

Redeploy after adding environment variables.

## 8. Update CORS

After the frontend is deployed, set this on the Render RAG server:

```env
FRONTEND_URL=https://your-frontend-domain
```

Then redeploy the RAG server.

## 9. Free-Tier Notes

Render free web services may sleep when idle, so the first message after inactivity can be slow.

Qdrant Cloud keeps the document vectors, so documents can survive server restarts as long as they were saved with the same user ID.

Groq and Jina are hosted APIs, so global users do not depend on your laptop.

## 10. Deployment Checklist

- `.env` files are not committed.
- Qdrant collection matches `EMBEDDING_DIMENSION`.
- RAG server health route works.
- Rasa actions service can call the RAG server.
- Rasa API service can call the Rasa actions service.
- Frontend has the deployed Rasa API URL.
- RAG server has the deployed frontend URL for CORS.

## 11. Render Troubleshooting Notes

If the RAG server fails with `Invalid URL`, check that `QDRANT_URL` is the real Qdrant cluster URL and starts with `https://`.

If the Rasa actions service exits immediately after a successful Docker build, make sure `rasa-bot/Dockerfile.actions` starts the action server with:

```txt
python -m rasa_sdk --actions actions --port ${PORT:-5055}
```

If the Rasa API service fails because Render cannot detect a port, make sure `rasa-bot/Dockerfile` starts Rasa with:

```txt
rasa run --enable-api --cors '*' --interface 0.0.0.0 --port ${PORT:-5005} --endpoints endpoints.cloud.yml
```

The `rasa/rasa` image has its own default entry command, so `rasa-bot/Dockerfile` also needs:

```txt
ENTRYPOINT []
```

Render provides the `PORT` value in production, so these commands must read it instead of only using local ports.

If Render starts Rasa but times out while Rasa is loading the model, keep `rasa-bot/config.yml` lightweight for deployment. This project is mostly rule-based, so the cloud config should use `LogisticRegressionClassifier` plus `RulePolicy` instead of heavier neural policies such as `TEDPolicy` and `UnexpecTEDIntentPolicy`.
