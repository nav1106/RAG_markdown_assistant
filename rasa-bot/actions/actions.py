import re
import requests
from rasa_sdk import Action, Tracker
from rasa_sdk.executor import CollectingDispatcher

RAG_SERVER_URL = "http://localhost:3000"


def get_user_id(tracker: Tracker):
    return tracker.sender_id or "anonymous-user"


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

            dispatcher.utter_message(
                text=f"Document loaded successfully for your session. I found {data.get('chunkCount')} chunks. You can ask questions now."
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
            dispatcher.utter_message(text=answer)
        except Exception:
            dispatcher.utter_message(
                text="Sorry, I had trouble checking your document. Make sure the RAG server is running and you have loaded a markdown document in this browser session."
            )

        return []
