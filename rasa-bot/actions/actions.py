import os
from pathlib import Path
import re
import requests
from rasa_sdk import Action, Tracker
from rasa_sdk.executor import CollectingDispatcher


def load_env_file(file_path):
    if not file_path.exists():
        return

    for line in file_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(Path(__file__).resolve().parents[1] / ".env")
RAG_SERVER_URL = os.getenv("RAG_SERVER_URL", "http://localhost:3000")
RAG_SERVICE_TOKEN = os.getenv("RAG_SERVICE_TOKEN") or os.getenv("RASA_SERVICE_TOKEN")



def rag_headers():
    if not RAG_SERVICE_TOKEN:
        return {}
    return {"Authorization": f"Bearer {RAG_SERVICE_TOKEN}"}

def get_user_id(tracker: Tracker):
    return tracker.sender_id or "anonymous-user"


def normalize_document_reference(text):
    normalized = text.lower().strip()
    replacements = {
        "1st": "1", "first": "1", "one": "1",
        "2nd": "2", "second": "2", "two": "2",
        "3rd": "3", "third": "3", "three": "3",
        "4th": "4", "fourth": "4", "four": "4",
        "5th": "5", "fifth": "5", "five": "5",
    }

    for old, new in replacements.items():
        normalized = re.sub(rf"\b{old}\b", new, normalized)

    return normalized


def extract_document_numbers(text):
    normalized = normalize_document_reference(text)
    return re.findall(r"\b[1-5]\b", normalized)


def format_document_list(documents):
    if not documents:
        return "You do not have any loaded documents yet. Send me a raw markdown URL to load one."

    lines = []
    for index, document in enumerate(documents, start=1):
        active_marker = "active" if document.get("isActive") else "loaded"
        name = document.get("name") or document.get("documentId") or "document"
        chunk_count = document.get("chunkCount", 0)
        lines.append(f"{index}. {name} ({active_marker}, {chunk_count} chunks)")

    return "Your loaded documents:\n" + "\n".join(lines)


def ask_rag(user_id, question, timeout=120):
    response = requests.post(
        f"{RAG_SERVER_URL}/ask",
        json={"question": question, "userId": user_id},
        timeout=timeout,
        headers=rag_headers(),
    )
    response.raise_for_status()
    return response.json()


def send_answer(dispatcher, data, prefix=None):
    answer = data.get("answer", "I could not find an answer in the document.")
    document = data.get("document", {})
    name = document.get("name")

    if prefix:
        dispatcher.utter_message(text=f"{prefix}\n\n{answer}")
    elif name:
        dispatcher.utter_message(text=f"Using {name}:\n\n{answer}")
    else:
        dispatcher.utter_message(text=answer)


class ActionLoadMarkdown(Action):
    def name(self):
        return "action_load_markdown"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        message = tracker.latest_message.get("text", "")
        user_id = get_user_id(tracker)
        urls = re.findall(r"https?://\S+", message)

        if not urls:
            dispatcher.utter_message(
                text="I didn't see a URL in that message. Send a raw markdown URL, or type 'help' for examples."
            )
            return []

        try:
            response = requests.post(
                f"{RAG_SERVER_URL}/load-document",
                json={"url": urls[0], "userId": user_id},
                timeout=120,
                headers=rag_headers(),
            )
            response.raise_for_status()
            data = response.json()
            document = data.get("document", {})
            documents = data.get("documents", [])
            name = document.get("name", "document")
            chunk_count = document.get("chunkCount", 0)

            dispatcher.utter_message(
                text=f"Loaded {name} and made it active. I found {chunk_count} chunks. You now have {len(documents)} document(s) loaded."
            )
        except Exception:
            dispatcher.utter_message(
                text="I could not load that markdown file. Make sure the RAG server is running and the URL is a raw markdown file."
            )

        return []


class ActionAnswerFromMarkdown(Action):
    def name(self):
        return "action_answer_from_markdown"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        try:
            data = ask_rag(get_user_id(tracker), tracker.latest_message.get("text", ""))
            send_answer(dispatcher, data)
        except Exception:
            dispatcher.utter_message(
                text="Sorry, I had trouble checking your document. Make sure the RAG server is running and you have loaded a markdown document in this browser session."
            )

        return []


class ActionSummarizeDocument(Action):
    def name(self):
        return "action_summarize_document"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        question = "Summarize the active document. Include its purpose, main features, setup steps, usage instructions, and important notes."
        try:
            data = ask_rag(get_user_id(tracker), question)
            send_answer(dispatcher, data, "Here is a summary of the active document:")
        except Exception:
            dispatcher.utter_message(text="I could not summarize the document. Make sure a document is loaded first.")
        return []


class ActionExtractCommands(Action):
    def name(self):
        return "action_extract_commands"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        question = "Extract all setup, installation, run, test, and deployment commands from the active document. Group them by purpose and explain when to use each one."
        try:
            data = ask_rag(get_user_id(tracker), question)
            send_answer(dispatcher, data, "Commands I found in the active document:")
        except Exception:
            dispatcher.utter_message(text="I could not extract commands. Make sure a document is loaded first.")
        return []


class ActionShowTroubleshooting(Action):
    def name(self):
        return "action_show_troubleshooting"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        question = "Find troubleshooting guidance, common errors, prerequisites, warnings, and failure points in the active document. If the document does not include troubleshooting, say that clearly and suggest what to verify."
        try:
            data = ask_rag(get_user_id(tracker), question)
            send_answer(dispatcher, data, "Troubleshooting guidance:")
        except Exception:
            dispatcher.utter_message(text="I could not find troubleshooting guidance. Make sure a document is loaded first.")
        return []


class ActionExplainSetup(Action):
    def name(self):
        return "action_explain_setup"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        question = "Explain the setup or getting started steps from the active document in a clear numbered order. Include required tools, install commands, configuration, and run commands if present."
        try:
            data = ask_rag(get_user_id(tracker), question)
            send_answer(dispatcher, data, "Setup steps from the active document:")
        except Exception:
            dispatcher.utter_message(text="I could not explain setup steps. Make sure a document is loaded first.")
        return []


class ActionCompareDocuments(Action):
    def name(self):
        return "action_compare_documents"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        message = tracker.latest_message.get("text", "")
        numbers = extract_document_numbers(message)
        payload = {
            "userId": get_user_id(tracker),
            "question": "Compare these documents by purpose, setup, usage, features, and important differences.",
        }

        if len(numbers) >= 2:
            payload["leftDocumentId"] = numbers[0]
            payload["rightDocumentId"] = numbers[1]

        try:
            response = requests.post(f"{RAG_SERVER_URL}/compare-documents", json=payload, timeout=120, headers=rag_headers())
            response.raise_for_status()
            data = response.json()
            documents = data.get("documents", [])
            names = " and ".join([doc.get("name", "document") for doc in documents])
            answer = data.get("answer", "I could not compare those documents.")
            dispatcher.utter_message(text=f"Comparison for {names}:\n\n{answer}")
        except Exception:
            dispatcher.utter_message(text="I could not compare documents. Load at least two documents, then try 'compare document 1 and document 2'.")

        return []


class ActionResetDocuments(Action):
    def name(self):
        return "action_reset_documents"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        try:
            response = requests.post(
                f"{RAG_SERVER_URL}/reset-active-document",
                json={"userId": get_user_id(tracker)},
                timeout=60,
                headers=rag_headers(),
            )
            response.raise_for_status()
            dispatcher.utter_message(text="The active document has been removed. Type 'list documents' to see what is still loaded, or send a new raw markdown URL.")
        except Exception:
            dispatcher.utter_message(text="I could not reset your documents right now. Make sure the RAG server is running.")
        return []


class ActionListDocuments(Action):
    def name(self):
        return "action_list_documents"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        try:
            response = requests.get(
                f"{RAG_SERVER_URL}/documents",
                params={"userId": get_user_id(tracker)},
                timeout=30,
                headers=rag_headers(),
            )
            response.raise_for_status()
            documents = response.json().get("documents", [])
            dispatcher.utter_message(text=format_document_list(documents))
        except Exception:
            dispatcher.utter_message(text="I could not fetch your document list right now. Make sure the RAG server is running.")
        return []


class ActionSwitchDocument(Action):
    def name(self):
        return "action_switch_document"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        message = tracker.latest_message.get("text", "")
        user_id = get_user_id(tracker)
        cleaned = re.sub(r"(?i)\b(switch|change|select|use|open|to|document|doc|file|active|the)\b", " ", message)
        cleaned = normalize_document_reference(" ".join(cleaned.split()).strip())

        if not cleaned:
            dispatcher.utter_message(text="Tell me which document to switch to. You can say 'switch to 1' or 'switch to README.md'.")
            return []

        try:
            response = requests.post(
                f"{RAG_SERVER_URL}/switch-document",
                json={"userId": user_id, "documentId": cleaned},
                timeout=30,
                headers=rag_headers(),
            )
            response.raise_for_status()
            active_document = response.json().get("activeDocument", {})
            name = active_document.get("name", "that document")
            dispatcher.utter_message(text=f"Switched to {name}. Ask me a question about it whenever you're ready.")
        except Exception:
            dispatcher.utter_message(text="I could not find that document in your session. Type 'list documents' to see what is loaded.")

        return []



