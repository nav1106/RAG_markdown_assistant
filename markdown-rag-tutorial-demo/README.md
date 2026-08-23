## Markdown RAG Assistant – Proof of Concept

This project demonstrates how to turn any markdown file into a conversational, AI-powered documentation assistant using Retrieval-Augmented Generation (RAG), LangChain.js, and using [IBM Granite 3.3 model](https://ollama.com/library/granite3.3) via Ollama.

### What Is It?
- Conversational Q&A via CLI: Ask questions about a markdown document and get accurate, context-aware answers on a command line interface.
- RAG Pipeline: Combines smart retrieval of relevant document sections with advanced language model generation for precise responses.
- Easy to Try: Just provide a public URL to a markdown file—no need to clone repositories or set up tokens.

### How Does It Work?
- Input: The CLI prompts you for a markdown file URL (e.g., a raw GitHub .md file).
- Processing: The assistant downloads the file, splits it into chunks, and creates embeddings for fast search.
- Chat: Ask questions in the terminal. The assistant finds the most relevant content and generates an answer using a local LLM.

### Prerequisites
- [Node.js v18+](https://nodejs.org/en)
- [Ollama](https://ollama.com/) installed and running locally with Granite 3.3 model pulled on your machine:

```
ollama pull granite3.3:2b
```

- Project dependencies installed:

```
npm install
```

### Usage
- Start Ollama if not already running:

```
ollama serve
```

- Run the assistant:

```
node index.js
```

- Enter a public markdown file URL when prompted.
- Ask questions about the document in the CLI. Type exit to quit.

This POC is a starting point for building smarter, more interactive documentation. Try it out and imagine the possibilities!
