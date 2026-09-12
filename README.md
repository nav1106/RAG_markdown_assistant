# Markdown RAG Chatbot with Rasa, Groq, Jina AI, and Qdrant

This project is a browser-based chatbot that lets a user load a raw markdown document URL and then ask questions about it. The frontend uses React and Vite, while the backend uses Rasa for conversation routing, a Node.js RAG service for retrieval, Jina AI for embeddings, Groq for LLM answers, and Qdrant Cloud for vector storage.

## Overview

The application works like this:

```text
React + Vite frontend
  -> Rasa API server
  -> Rasa action server
  -> Node.js RAG server
  -> Jina AI embeddings + Qdrant retrieval + Groq chat model
  -> answer returned to the chat UI
```

## What each part does

### Frontend: React + Vite

The interface lives in `src/main.jsx` and `src/styles.css`. It lets the user:

- load a markdown document from a raw URL
- view the current document and all loaded sources
- switch documents, summarize, ask questions, and clear chat history
- view source metadata, loading states, and error banners

The app opens with a sign-up/login screen and supports email/password or Google sign-in. Passwords are hashed with Node's `scrypt`; account records are stored in the ignored `markdown-rag-tutorial-demo/auth-users.json` file, while active bearer-token sessions remain in memory. The browser stores only the current session token and theme preference in `localStorage`.

To enable Google sign-in, copy `.env.example` to `.env`, create a Google OAuth web client, and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `FRONTEND_URL`. Add the redirect URI (normally `http://localhost:3000/auth/google/callback`) to the Google Cloud OAuth client's authorized redirect URIs.

Example input:

```text
load this document https://raw.githubusercontent.com/user/repo/main/README.md
```

Example follow-up questions:

```text
What are the prerequisites?
How do I install this?
What are the usage instructions?
```

### Rasa

Rasa decides which intent the user is expressing and triggers the correct action.

Examples:

```text
User gives markdown URL -> action_load_markdown
User asks a doc question -> action_answer_from_markdown
```

Rasa is responsible for routing the conversation; it does not generate the final answer itself.

### Rasa action server

The custom Python action server handles the conversation logic and calls the Node.js RAG server.

Endpoints used:

```text
POST http://localhost:3000/load-document
POST http://localhost:3000/ask
```

### Node.js RAG server

The Node.js service downloads the markdown content, splits it into chunks, creates embeddings with Jina AI, stores and searches vectors in Qdrant, and sends retrieved context to Groq for the final answer.

Endpoints:

```text
GET /health
POST /auth/signup
POST /auth/login
GET /auth/google
GET /auth/google/callback
GET /auth/me
POST /auth/logout
POST /load-document
POST /ask
```

### Hosted AI providers

This project uses hosted providers so it can be deployed for public users:

```text
Groq      -> final chat answer generation
Jina AI   -> markdown/query embeddings
Qdrant    -> vector database
```

## Project structure

```text
RAG_markdown_assistant/
├── chat.html
├── index.html
├── package.json
├── src/
│   ├── main.jsx
│   └── styles.css
├── README.md
├── markdown-rag-tutorial-demo/
│   ├── index.js
│   ├── package.json
│   ├── rag-server.js
│   └── README.md
└── rasa-bot/
    ├── actions/
    │   └── actions.py
    ├── data/
    │   ├── nlu.yml
    │   ├── rules.yml
    │   └── stories.yml
    ├── config.yml
    ├── credentials.yml
    ├── domain.yml
    ├── endpoints.yml
    └── models/
```

## Requirements

Before running the app, install:

- Node.js 18+
- Python 3.10
- Groq API key
- Jina AI API key
- Qdrant Cloud cluster URL and API key
- Rasa
- Rasa SDK

> Important: use Python 3.10 for the Rasa environment. Python 3.12 may cause dependency issues.

## Setup

### 1. Clone or copy the project

Example location:

```bash
C:\Users\YourName\VSCode Folder\RAG_markdown_assistant
```

### 2. Configure hosted AI providers

Copy `markdown-rag-tutorial-demo/.env.example` to `markdown-rag-tutorial-demo/.env`, then add your Groq, Jina AI, and Qdrant values.

Use a new Qdrant collection name when changing embedding models or embedding dimensions.

### 3. Install Node.js dependencies

Install the React frontend dependencies from the project root:

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant"
npm install
```

Install the backend dependencies from the backend folder:

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\markdown-rag-tutorial-demo"
npm install
```

If needed, install Express explicitly:

```bash
npm install express
```

### 4. Set up the Rasa environment

Go to the Rasa folder:

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\rasa-bot"
```

Create a Python 3.10 virtual environment:

```bash
py -3.10 -m venv .venv
```

Activate it:

```powershell
.venv\Scripts\activate
```

Install dependencies:

```bash
python -m pip install --upgrade pip setuptools wheel
pip install rasa==3.6.21
pip install rasa-sdk requests
```

### 5. Train the Rasa model

From inside the `rasa-bot` folder:

```bash
rasa train
```

A trained model should appear in:

```text
rasa-bot/models/
```

## Run the project

You need four terminals plus the browser.

### Terminal 1: start the React frontend

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant"
npm run dev
```

The Vite app runs at the URL shown in the terminal, usually `http://localhost:5173`.

### Terminal 2: start the RAG server

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\markdown-rag-tutorial-demo"
node rag-server.js
```

The server runs at:

```text
http://localhost:3000
```

### Terminal 3: start the Rasa action server

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\rasa-bot"
.venv\Scripts\activate
rasa run actions
```

The action server listens at:

```text
http://localhost:5055
```

### Terminal 4: start the Rasa API server

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\rasa-bot"
.venv\Scripts\activate
rasa run --enable-api --cors "*"
```

The API server runs at:

```text
http://localhost:5005
```

### Browser: open the chatbot

Open the Vite URL from Terminal 1. `chat.html` is retained as the legacy interface; the React app is the active frontend.

## How to use it

Type a raw markdown URL to load a document:

```text
load this document https://raw.githubusercontent.com/expressjs/express/master/Readme.md
```

Wait for the bot to confirm the document loaded, then ask questions such as:

```text
What are the basic usage instructions?
How do I install it?
What are the prerequisites?
```

## Example flow

```text
User: load this document https://raw.githubusercontent.com/expressjs/express/master/Readme.md
Bot: Document loaded successfully. I found 15 chunks. You can ask questions now.
User: What are the basic usage instructions?
Bot: [Answer generated from the markdown document]
```

## Important ports

```text
3000  -> Node.js RAG server
5005  -> Rasa API server
5055  -> Rasa action server
```

If a port is already in use, check it with:

```bash
netstat -ano | findstr :5005
```

Then stop the process:

```bash
taskkill /PID YOUR_PID_HERE /F
```

## How it works internally

### Loading a document

When the user sends a markdown URL, the React frontend sends the message to Rasa through the REST channel.

Rasa detects the `provide_markdown_url` intent and triggers `action_load_markdown`.

That action calls:

```text
POST http://localhost:3000/load-document
```

The RAG server downloads the markdown file, splits it into chunks, creates embeddings with Jina AI, and stores those vectors in Qdrant Cloud with metadata such as `userId`, `documentId`, `documentName`, `sourceUrl`, `chunkIndex`, `heading`, and `createdAt`.

### Asking a question

When the user asks a question, Rasa detects the most relevant intent and runs the matching custom action.

For a normal documentation question, Rasa runs `action_answer_from_markdown`, which calls:

```text
POST http://localhost:3000/ask
```

The RAG server embeds the question with Jina AI, searches Qdrant for the most relevant chunks from the active document, sends that context to Groq, and returns the generated answer to Rasa. Rasa then sends the answer back to the React frontend.

### Smart conversation flows

Rasa also handles controlled flows such as:

```text
summarize current document
list loaded documents
switch document
compare two documents
reset current document
explain setup steps
extract commands
show troubleshooting steps
```

This makes Rasa the conversation controller, while Groq only generates answers from retrieved context.

## Security notes

- Real secrets belong in `.env` files only.
- `.env`, `auth-users.json`, Rasa models, Rasa cache, Python cache files, `node_modules`, and `dist` are ignored by git.
- `markdown-rag-tutorial-demo/.env.example`, `rasa-bot/.env.example`, and the root `.env.example` are safe templates for other users.
- For production, set `REQUIRE_AUTH=true` in `markdown-rag-tutorial-demo/.env`.
- Use the same long random secret for `RASA_SERVICE_TOKEN` in the RAG server and `RAG_SERVICE_TOKEN` in the Rasa action server.

## Troubleshooting

- If the chatbot says it cannot reach Rasa, confirm the Rasa API server is running on port 5005.
- If document loading fails, confirm the RAG server is running on port 3000 and the URL is a raw markdown URL.
- If answers fail after changing embedding models, use a new Qdrant collection name or recreate the collection so the vector dimension matches `EMBEDDING_DIMENSION`.
- If Groq or Jina requests fail, check that `GROQ_API_KEY`, `GROQ_CHAT_MODEL`, `JINA_API_KEY`, `JINA_EMBEDDING_MODEL`, and `EMBEDDING_DIMENSION` are set in `markdown-rag-tutorial-demo/.env`.
- If a port is blocked, check the active process and terminate it before restarting the relevant service.

## Current limitations

- Email/password auth is local-file based and should be replaced with a managed auth provider before a serious production launch.
- Rasa action server and RAG server are still separate local services until Docker/cloud deployment is added.
- File upload is paused in the React frontend while the app is routed through Rasa-first document flows.
- More Rasa NLU examples and tests should be added as the supported conversation flows grow.

## Possible improvements

- Add Docker Compose for local development.
- Deploy the frontend and backend services to cloud platforms.
- Add citations showing which markdown chunks were used.
- Add managed production auth.
- Add automated tests for Rasa actions and RAG API endpoints.
- Add file upload through a Rasa-compatible backend flow.

## Stopping the project

Stop each running server by pressing `Ctrl + C` in its terminal.

Stop these running commands:

```text
node rag-server.js
rasa run actions
rasa run --enable-api --cors "*"
npm run dev
```

## Restarting later

Run these again in separate terminals:

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\markdown-rag-tutorial-demo"
node rag-server.js
```

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\rasa-bot"
.venv\Scripts\activate
rasa run actions
```

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\rasa-bot"
.venv\Scripts\activate
rasa run --enable-api --cors "*"
```

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant"
npm run dev
```

Then open the Vite URL, usually:

```text
http://localhost:5173
```

## License

This project is intended for development and experimentation. See the included project files for exact license terms where applicable.


