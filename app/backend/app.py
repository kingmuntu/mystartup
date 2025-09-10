import logging
import os
from pathlib import Path
import json
import base64
import asyncio
import threading
import time

import aiohttp
from aiohttp import web, WSMsgType
from azure.core.credentials import AzureKeyCredential
from azure.identity import AzureDeveloperCliCredential, DefaultAzureCredential
from azure.cognitiveservices.speech import SpeechConfig, SpeechRecognizer, ResultReason, CancellationReason
from dotenv import load_dotenv

from ragtools import attach_rag_tools
from rtmt import RTMiddleTier

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voicerag")


# -------------------------------
# WebSocket Route: Real-Time Transcription
# -------------------------------
class TranscriptionManager:
    def __init__(self, ws):
        self.ws = ws
        self.speech_recognizer = None
        self.loop = asyncio.get_event_loop()
        self.is_running = False
        
    async def initialize_speech_recognizer(self):
        """Initialize Azure Speech SDK recognizer"""
        try:
            # Get API key and region from environment variables
            speech_key = os.getenv("api_key")
            service_region = os.getenv("region")
            
            if not speech_key or not service_region:
                raise ValueError("Please set api_key and region in your .env file")
            
            # Create speech configuration
            speech_config = SpeechConfig(subscription=speech_key, region=service_region)
            speech_config.speech_recognition_language = "en-US"
            
            # Create recognizer using default microphone
            self.speech_recognizer = SpeechRecognizer(speech_config=speech_config)
            
            # Set up event handlers
            self.speech_recognizer.recognizing.connect(self._recognizing_handler)
            self.speech_recognizer.recognized.connect(self._recognized_handler)
            self.speech_recognizer.canceled.connect(self._canceled_handler)
            self.speech_recognizer.session_stopped.connect(self._session_stopped_handler)
            
            logger.info("Azure Speech SDK initialized successfully")
            return True
            
        except Exception as e:
            logger.error("Failed to initialize Azure Speech SDK: %s", e)
            await self.ws.send_json({
                "type": "error",
                "text": f"Failed to initialize speech recognition: {str(e)}"
            })
            return False
    
    def _recognizing_handler(self, evt):
        """Handle partial recognition results"""
        asyncio.run_coroutine_threadsafe(self._send_message({
            "type": "partial_transcript",
            "text": evt.result.text
        }), self.loop)
    
    def _recognized_handler(self, evt):
        """Handle final recognition results"""
        if evt.result.reason == ResultReason.RecognizedSpeech:
            asyncio.run_coroutine_threadsafe(self._send_message({
                "type": "final_transcript",
                "text": evt.result.text
            }), self.loop)
        elif evt.result.reason == ResultReason.NoMatch:
            logger.info("No speech recognized")
    
    def _canceled_handler(self, evt):
        """Handle recognition cancellations/errors"""
        error_msg = f"Recognition canceled. Reason: {evt.reason}"
        if evt.reason == CancellationReason.Error:
            error_msg += f" Error details: {evt.error_details}"
        
        logger.error(error_msg)
        asyncio.run_coroutine_threadsafe(self._send_message({
            "type": "error",
            "text": error_msg
        }), self.loop)
    
    def _session_stopped_handler(self, evt):
        """Handle session stop"""
        logger.info("Speech recognition session stopped")
        asyncio.run_coroutine_threadsafe(self._send_message({
            "type": "info",
            "text": "Session stopped"
        }), self.loop)
    
    async def _send_message(self, message):
        """Send message to WebSocket client"""
        try:
            await self.ws.send_json(message)
        except Exception as e:
            logger.error("Failed to send message to client: %s", e)
    
    def start_recognition(self):
        """Start continuous speech recognition"""
        if self.speech_recognizer and not self.is_running:
            try:
                self.speech_recognizer.start_continuous_recognition()
                self.is_running = True
                logger.info("Started continuous speech recognition")
            except Exception as e:
                logger.error("Failed to start speech recognition: %s", e)
    
    def stop_recognition(self):
        """Stop continuous speech recognition"""
        if self.speech_recognizer and self.is_running:
            try:
                self.speech_recognizer.stop_continuous_recognition()
                self.is_running = False
                logger.info("Stopped continuous speech recognition")
            except Exception as e:
                logger.error("Failed to stop speech recognition: %s", e)

async def handle_transcribe_ws(request):
    """
    WebSocket route for real-time speech transcription using Azure Speech SDK.
    """
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    logger.info("WebSocket /transcribe/ws connected from %s", request.remote)
    
    # Initialize transcription manager
    transcription_manager = TranscriptionManager(ws)
    
    # Initialize Azure Speech SDK
    if not await transcription_manager.initialize_speech_recognizer():
        return ws
    
    # Start continuous recognition
    transcription_manager.start_recognition()

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    logger.info("Received message type: %s", type(data).__name__)
                    
                    if data.get("action") == "close":
                        logger.info("Client requested close")
                        break
                        
                except json.JSONDecodeError as e:
                    logger.error("Failed to parse JSON message: %s", e)
                    await ws.send_json({
                        "type": "error",
                        "text": f"Invalid JSON: {str(e)}"
                    })
                    
            elif msg.type == WSMsgType.ERROR:
                logger.error("WebSocket connection closed with exception %s", ws.exception())
                break
            elif msg.type == WSMsgType.CLOSE:
                logger.info("WebSocket connection closed by client")
                break
                
    except Exception as e:
        logger.error("Error in transcription WebSocket: %s", e)
        await ws.send_json({
            "type": "error",
            "text": f"Server error: {str(e)}"
        })
    finally:
        # Stop recognition and cleanup
        transcription_manager.stop_recognition()
        logger.info("WebSocket /transcribe/ws closed")
        
    return ws


# -------------------------------
# Health Check
# -------------------------------
async def handle_health(request):
    return web.json_response({"status": "ok", "message": "Backend running"})


# -------------------------------
# Application Factory
# -------------------------------
async def create_app():
    if not os.environ.get("RUNNING_IN_PRODUCTION"):
        logger.info("Running in development mode, loading from .env file")
        load_dotenv()
    
    # Load .env file explicitly for transcription
    load_dotenv()

    llm_key = os.environ.get("AZURE_OPENAI_API_KEY")
    search_key = os.environ.get("AZURE_SEARCH_API_KEY")

    credential = None
    if not llm_key or not search_key:
        if tenant_id := os.environ.get("AZURE_TENANT_ID"):
            logger.info("Using AzureDeveloperCliCredential with tenant_id %s", tenant_id)
            credential = AzureDeveloperCliCredential(tenant_id=tenant_id, process_timeout=60)
        else:
            logger.info("Using DefaultAzureCredential")
            credential = DefaultAzureCredential()

    llm_credential = AzureKeyCredential(llm_key) if llm_key else credential
    search_credential = AzureKeyCredential(search_key) if search_key else credential
    
    app = web.Application()

    # ----------------- RTMiddleTier Setup -----------------
    rtmt = RTMiddleTier(
        credentials=llm_credential,
        endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        deployment=os.environ["AZURE_OPENAI_REALTIME_DEPLOYMENT"],
        voice_choice=os.environ.get("AZURE_OPENAI_REALTIME_VOICE_CHOICE") or "alloy"
    )

    rtmt.system_message = """
        You are an Econet AI Customer Service assistant. You always start with the Greeting, 
        'Welcome to Econet Wireless Customer Service Representative. 
        You are speaking with Emmy an AI, whom am I speaking with and where are you calling from?' 
        After they answer, you then ask, 'How can I help you today [customer name]?' After listening to the query you will ask for the customers mobile number, repeat the number so the customer confirms,  
        Refer to customer with their name
        Handling customer queries:
        Refer to the knowledge on how to asist on the specific customer query
        Only answer questions and assist customer queries based on information you searched in the knowledge base, 
        accessible with the 'search' tool. 

        The user is listening to answers with audio, so it's *super* important that answers 
        are as short as possible, a single sentence if at all possible. 

        Never read file names or source names or keys out loud. 

        Always follow these steps: 
        1. Always use the 'search' tool to check the knowledge base before answering a question. 
        2. Always use the 'report_grounding' tool to report the source of information from the knowledge base. 
        3. Produce an answer that's as short as possible. If the answer isn't in the knowledge base, 
           say you will escalate this to your supervisor.
    """.strip()

    attach_rag_tools(
        rtmt,
        credentials=search_credential,
        search_endpoint=os.environ.get("AZURE_SEARCH_ENDPOINT"),
        search_index=os.environ.get("AZURE_SEARCH_INDEX"),
        semantic_configuration=os.environ.get("AZURE_SEARCH_SEMANTIC_CONFIGURATION") or None,
        identifier_field=os.environ.get("AZURE_SEARCH_IDENTIFIER_FIELD") or "chunk_id",
        content_field=os.environ.get("AZURE_SEARCH_CONTENT_FIELD") or "chunk",
        embedding_field=os.environ.get("AZURE_SEARCH_EMBEDDING_FIELD") or "text_vector",
        title_field=os.environ.get("AZURE_SEARCH_TITLE_FIELD") or "title",
        use_vector_query=(os.getenv("AZURE_SEARCH_USE_VECTOR_QUERY", "true") == "true")
    )

    rtmt.attach_to_app(app, "/realtime")

    # ----------------- Static + Routes -----------------
    current_directory = Path(__file__).parent
    app.add_routes([
        web.get("/", lambda _: web.FileResponse(current_directory / "static/index.html")),
        web.get("/health", handle_health),
        web.get("/transcribe/ws", handle_transcribe_ws),
    ])
    app.router.add_static("/", path=current_directory / "static", name="static")

    return app


# -------------------------------
# Main Entry
# -------------------------------
if __name__ == "__main__":
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", 8000)) 
    web.run_app(create_app(), host=host, port=port)
