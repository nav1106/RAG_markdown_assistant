import re
import requests
from rasa_sdk import Action, Tracker
from rasa_sdk.executor import CollectingDispatcher

RAG_SERVER_URL = "http://localhost:3000"


def get_user_id(tracker: Tracker):
    return tracker.sender_id or "anonymous-user"



def normalize_document_reference(text):
    normalized = text.lower().strip()

    replacements = {
        "1st": "1",
        "first": "1",
        "one": "1",
        "2nd": "2",
        "second": "2",
        "two": "2",
        "3rd": "3",
        "third": "3",
        "three": "3",
        "4th": "4",
        "fourth": "4",
        "four": "4",
        "5th": "5",
        "fifth": "5",
        "five": "5",
    }

    for old, new in replacements.items():
        normalized = re.sub(rf"\b{old}\b", new, normalized)

    return normalized
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


class ActionLoadMarkdown(Action):
    def name(self):
        return "action_load_markdown"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        message = tracker.latest_message.get("text", "")
        user_id = get_user_id(tracker)

        urls = re.findall(r"https?://\S+", message)

        if not urls:
            dispatcher.utter_message(
                text="I didn't see a URL in that message. If you want to load a document, send a raw markdown URL. If you meant to ask a question, try rephrasing it."
            )
            return []

        url = urls[0]

        try:
            response = requests.post(
                f"{RAG_SERVER_URL}/load-document",
                json={"url": url, "userId": user_id},
                timeout=120,
            )
            response.raise_for_status()
            data = response.json()
            document = data.get("document", {})
            documents = data.get("documents", [])
            name = document.get("name", "document")
            chunk_count = document.get("chunkCount", 0)

            dispatcher.utter_message(
                text=f"Loaded {name} for your session and made it active. I found {chunk_count} chunks. You now have {len(documents)} document(s) loaded."
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
        question = tracker.latest_message.get("text", "")
        user_id = get_user_id(tracker)

        try:
            response = requests.post(
                f"{RAG_SERVER_URL}/ask",
                json={"question": question, "userId": user_id},
                timeout=120,
            )
            response.raise_for_status()
            data = response.json()

            answer = data.get("answer", "I could not find an answer in the document.")
            document = data.get("document", {})
            name = document.get("name")

            if name:
                dispatcher.utter_message(text=f"Using {name}:\n\n{answer}")
            else:
                dispatcher.utter_message(text=answer)
        except Exception:
            dispatcher.utter_message(
                text="Sorry, I had trouble checking your document. Make sure the RAG server is running and you have loaded a markdown document in this browser session."
            )

        return []


class ActionListDocuments(Action):
    def name(self):
        return "action_list_documents"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        user_id = get_user_id(tracker)

        try:
            response = requests.get(
                f"{RAG_SERVER_URL}/documents",
                params={"userId": user_id},
                timeout=30,
            )
            response.raise_for_status()
            documents = response.json().get("documents", [])
            dispatcher.utter_message(text=format_document_list(documents))
        except Exception:
            dispatcher.utter_message(
                text="I could not fetch your document list right now. Make sure the RAG server is running."
            )

        return []


class ActionSwitchDocument(Action):
    def name(self):
        return "action_switch_document"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker, domain):
        message = tracker.latest_message.get("text", "")
        user_id = get_user_id(tracker)

        cleaned = re.sub(r"(?i)\b(switch|change|select|use|open|to|document|doc|file|active|the)\b", " ", message)
        cleaned = " ".join(cleaned.split()).strip()
        cleaned = normalize_document_reference(cleaned)

        if not cleaned:
            dispatcher.utter_message(
                text="Tell me which document to switch to. You can say something like 'switch to 1' or 'switch to README.md'."
            )
            return []

        try:
            response = requests.post(
                f"{RAG_SERVER_URL}/switch-document",
                json={"userId": user_id, "documentId": cleaned},
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            active_document = data.get("activeDocument", {})
            name = active_document.get("name", "that document")

            dispatcher.utter_message(text=f"Switched to {name}. Ask me a question about it whenever you're ready.")
        except Exception:
            dispatcher.utter_message(
                text="I could not find that document in your session. Type 'list documents' to see what is loaded."
            )

        return []


