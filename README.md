# Markdown RAG Chatbot with Rasa, LangChain.js, and Ollama

This project is a browser-based chatbot that lets a user load a raw markdown document URL and then ask questions about it. The frontend is a simple HTML chat UI, while the backend uses Rasa for conversation routing, a Node.js RAG service for retrieval, and Ollama for local embeddings and LLM inference.

## Overview

The application works like this:

```text
chat.html
  -> Rasa API server
  -> Rasa action server
  -> Node.js RAG server
  -> Ollama
  -> answer returned to the chat UI
```

## What each part does

### Frontend: `chat.html`

This file contains the visual chatbot interface. It lets the user:

- load a markdown document by sending a raw markdown URL
- ask questions about the currently loaded document
- view answers in a chat-style interface

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

The Node.js service downloads the markdown content, splits it into chunks, creates embeddings, retrieves the most relevant chunks, and sends them to the local model for an answer.

Endpoints:

```text
GET /health
POST /load-document
POST /ask
```

### Ollama

Ollama runs the local models used by the RAG pipeline.

This project uses:

```text
nomic-embed-text
granite3.3:2b
```

## Project structure

```text
RAG_markdown_assistant/
├── chat.html
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
- Ollama
- Rasa
- Rasa SDK

> Important: use Python 3.10 for the Rasa environment. Python 3.12 may cause dependency issues.

## Setup

### 1. Clone or copy the project

Example location:

```bash
C:\Users\YourName\VSCode Folder\RAG_markdown_assistant
```

### 2. Install Ollama models

Start Ollama, then pull the required models:

```bash
ollama pull granite3.3:2b
ollama pull nomic-embed-text
```

Check installed models:

```bash
ollama list
```

### 3. Install Node.js dependencies

From the project root:

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

You need three terminals plus the browser.

### Terminal 1: start the RAG server

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\markdown-rag-tutorial-demo"
node rag-server.js
```

The server runs at:

```text
http://localhost:3000
```

### Terminal 2: start the Rasa action server

```bash
cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\rasa-bot"
.venv\Scripts\activate
rasa run actions
```

The action server listens at:

```text
http://localhost:5055
```

### Terminal 3: start the Rasa API server

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

Open:

```text
C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\chat.html
```

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
11434 -> Ollama
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

When the user sends a markdown URL, Rasa detects the `provide_markdown_url` intent and triggers `action_load_markdown`.

That action calls:

```text
POST http://localhost:3000/load-document
```

The RAG server downloads the markdown file, chunks it, creates embeddings, and stores the document in memory for the current user session.

### Asking a question

When the user asks a question, Rasa detects the `ask_documentation` intent and runs `action_answer_from_markdown`.

That action calls:

```text
POST http://localhost:3000/ask
```

The Node.js RAG service retrieves the most relevant chunks and asks the LLM for an answer based only on that context.

## Troubleshooting

- If the chatbot says the document failed to load, confirm the RAG server is running on port 3000.
- If the bot is unresponsive, confirm both the Rasa action server and API server are running.
- If Ollama is not responding, make sure the model pull completed and `ollama serve` is active.
- If a port is blocked, check the active process and terminate it before restarting the relevant service.

## License

This project is intended for local development and experimentation. See the included project files for exact license terms where applicable.


The RAG server retrieves the most relevant markdown chunks and sends them to Ollama with the question.

Ollama generates the final answer, which is returned to Rasa and displayed in the browser.

Why Rasa Is Used
----------------

Rasa manages the conversation flow.

The LLM generates answers, but Rasa decides what should happen next.

For example:

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   If the user sends a URL -> load the document  If the user asks a question -> answer from the document  If the user says hello -> greet them   `

This makes the chatbot easier to control, test, and extend.

Current Limitations
-------------------

*   The vector store is stored in memory.
    
*   If the RAG server restarts, the document must be loaded again.
    
*   The project currently supports one active document at a time.
    
*   The frontend is a simple HTML page.
    
*   The Rasa training data is small and can be improved with more examples.
    

Possible Improvements
---------------------

*   Add persistent vector storage using FAISS, Chroma, Qdrant, or pgvector.
    
*   Support multiple documents.
    
*   Add file upload support.
    
*   Add citations showing which markdown chunks were used.
    
*   Improve the frontend design.
    
*   Add authentication.
    
*   Add Docker setup.
    
*   Add tests for the Rasa actions and RAG API.
    
*   Deploy the frontend and backend services.
    

Stopping The Project
--------------------

Stop each running server by pressing:

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   Ctrl + C   `

Stop these terminals:

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   node rag-server.js  rasa run actions  rasa run --enable-api --cors "*"   `

Ollama can usually stay running in the background.

Restarting Later
----------------

Run these again:

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\markdown-rag-tutorial-demo"  node rag-server.js   `

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\rasa-bot"  .venv\Scripts\activate  rasa run actions   `

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   cd "C:\Users\YourName\VSCode Folder\RAG_markdown_assistant\rasa-bot"  .venv\Scripts\activate  rasa run --enable-api --cors "*"   `

Then open:

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   chat.html   `

Load a markdown URL again and start asking questions.