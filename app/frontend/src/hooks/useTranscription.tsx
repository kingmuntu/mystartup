import { useState, useCallback, useEffect } from "react";
import useWebSocket from "react-use-websocket";

type TranscriptionMessage = {
    type: "partial_transcript" | "final_transcript" | "error" | "info";
    text: string;
    is_final?: boolean;
};

type Parameters = {
    onTranscriptionUpdate?: (text: string, isFinal: boolean) => void;
    onError?: (error: string) => void;
    isRecording?: boolean;
};

export default function useTranscription({
    onTranscriptionUpdate,
    onError,
    isRecording = false
}: Parameters) {
    const [transcript, setTranscript] = useState("");
    const [isConnected, setIsConnected] = useState(false);
    const wsUrl = "/transcribe/ws";
    const shouldConnect = isRecording; // Only connect when recording
    
    console.log("useTranscription: Initializing with URL:", wsUrl, "shouldConnect:", shouldConnect);
    
    const { sendJsonMessage, lastMessage, readyState, getWebSocket } = useWebSocket(wsUrl, {
        onOpen: () => {
            console.log("✅ Transcription WebSocket connected to:", wsUrl);
            setIsConnected(true);
        },
        onClose: (event) => {
            console.log("❌ Transcription WebSocket disconnected:", event.code, event.reason);
            setIsConnected(false);
        },
        onError: (event) => {
            console.error("🚨 Transcription WebSocket error:", event);
            onError?.("Transcription connection error");
        },
        shouldReconnect: () => {
            console.log("🔄 Transcription WebSocket attempting reconnection...");
            return shouldConnect; // Only reconnect if we should be connected
        },
        reconnectAttempts: 3,
        reconnectInterval: 1000,
        share: false, // Don't share connections
        filter: () => shouldConnect, // Only connect when shouldConnect is true
    });

    // Handle incoming transcription messages
    const handleMessage = useCallback((message: MessageEvent) => {
        console.log("📨 Transcription message received:", message.data);
        try {
            const data: TranscriptionMessage = JSON.parse(message.data);
            console.log("📝 Parsed transcription data:", data);
            
            switch (data.type) {
                case "partial_transcript":
                    console.log("🔄 Partial transcript:", data.text);
                    onTranscriptionUpdate?.(data.text, false);
                    break;
                case "final_transcript":
                    console.log("✅ Final transcript:", data.text);
                    onTranscriptionUpdate?.(data.text, true);
                    break;
                case "error":
                    console.error("🚨 Transcription error:", data.text);
                    onError?.(data.text);
                    break;
                case "info":
                    console.log("ℹ️ Transcription info:", data.text);
                    break;
                default:
                    console.warn("⚠️ Unknown transcription message type:", data.type);
            }
        } catch (error) {
            console.error("❌ Failed to parse transcription message:", error, "Raw data:", message.data);
        }
    }, [onTranscriptionUpdate, onError]);

    // Process the last message
    if (lastMessage) {
        handleMessage(lastMessage);
    }

    // Handle connection state changes
    useEffect(() => {
        if (shouldConnect && readyState === WebSocket.OPEN) {
            console.log("🎤 Transcription WebSocket ready for audio");
        } else if (!shouldConnect && readyState === WebSocket.OPEN) {
            console.log("🛑 Closing transcription WebSocket");
            getWebSocket()?.close();
        }
    }, [shouldConnect, readyState, getWebSocket]);

    const sendAudioChunk = useCallback((base64Audio: string) => {
        console.log("🎤 Sending audio chunk, readyState:", readyState, "WebSocket.OPEN:", WebSocket.OPEN);
        if (readyState === WebSocket.OPEN) {
            console.log("📤 Sending audio chunk to transcription service, length:", base64Audio.length);
            sendJsonMessage({
                audio_chunk: base64Audio
            });
        } else {
            console.warn("⚠️ Cannot send audio chunk - WebSocket not open. ReadyState:", readyState);
        }
    }, [sendJsonMessage, readyState]);

    const clearTranscript = useCallback(() => {
        setTranscript("");
    }, []);

    const appendToTranscript = useCallback((text: string, isFinal: boolean = false) => {
        setTranscript(prev => {
            if (isFinal) {
                // For final transcripts, append with a space
                return prev + (prev ? " " : "") + text;
            } else {
                // For partial transcripts, replace the last partial with the new one
                const lines = prev.split('\n');
                const lastLine = lines[lines.length - 1];
                
                // Check if the last line looks like a partial transcript (no ending punctuation)
                const isLastLinePartial = lastLine && !lastLine.match(/[.!?]$/);
                
                if (isLastLinePartial) {
                    lines[lines.length - 1] = text;
                    return lines.join('\n');
                } else {
                    return prev + (prev ? "\n" : "") + text;
                }
            }
        });
    }, []);

    return {
        transcript,
        isConnected,
        sendAudioChunk,
        clearTranscript,
        appendToTranscript
    };
}
