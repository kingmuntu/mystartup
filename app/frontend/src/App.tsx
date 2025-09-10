import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { GroundingFiles } from "@/components/ui/grounding-files";
import GroundingFileView from "@/components/ui/grounding-file-view";
import StatusMessage from "@/components/ui/status-message";
import TranscriptionPanel from "@/components/ui/transcription-panel";

import useRealTime from "@/hooks/useRealtime";
import useAudioRecorder from "@/hooks/useAudioRecorder";
import useAudioPlayer from "@/hooks/useAudioPlayer";
import useTranscription from "@/hooks/useTranscription";

import { GroundingFile, ToolResult } from "./types";

import logo from "./assets/logo.svg";

function App() {
    const [isRecording, setIsRecording] = useState(false);
    const [isRinging, setIsRinging] = useState(false);
    const [groundingFiles, setGroundingFiles] = useState<GroundingFile[]>([]);
    const [selectedFile, setSelectedFile] = useState<GroundingFile | null>(null);
    const ringingAudioRef = useRef<HTMLAudioElement | null>(null);

    const { startSession, addUserAudio, inputAudioBufferClear } = useRealTime({
        onWebSocketOpen: () => console.log("WebSocket connection opened"),
        onWebSocketClose: () => console.log("WebSocket connection closed"),
        onWebSocketError: event => console.error("WebSocket error:", event),
        onReceivedError: message => console.error("error", message),
        onReceivedResponseAudioDelta: message => {
            isRecording && playAudio(message.delta);
        },
        onReceivedInputAudioBufferSpeechStarted: () => {
            stopAudioPlayer();
        },
        onReceivedExtensionMiddleTierToolResponse: message => {
            const result: ToolResult = JSON.parse(message.tool_result);

            const files: GroundingFile[] = result.sources.map(x => {
                return { id: x.chunk_id, name: x.title, content: x.chunk };
            });

            setGroundingFiles(prev => [...prev, ...files]);
        }
    });

    const { reset: resetAudioPlayer, play: playAudio, stop: stopAudioPlayer } = useAudioPlayer();
    
    // Transcription hook
    const { 
        transcript, 
        sendAudioChunk, 
        clearTranscript, 
        appendToTranscript 
    } = useTranscription({
        isRecording,
        onTranscriptionUpdate: (text, isFinal) => {
            console.log("🔄 Transcription update received:", { text, isFinal });
            appendToTranscript(text, isFinal);
        },
        onError: (error) => {
            console.error("🚨 Transcription error in App:", error);
        }
    });

    const { start: startAudioRecording, stop: stopAudioRecording } = useAudioRecorder({ 
        onAudioRecorded: addUserAudio,
        onTranscriptionAudio: sendAudioChunk
    });

    const onToggleListening = async () => {
        if (!isRecording && !isRinging) {
            // Start ringing sound
            setIsRinging(true);
            
            // Create and play ringing audio
            if (!ringingAudioRef.current) {
                ringingAudioRef.current = new Audio('/phone.mp3');
                ringingAudioRef.current.loop = true;
                ringingAudioRef.current.volume = 0.7; // Set volume
                
                // Add error handling
                ringingAudioRef.current.onerror = (e) => {
                    console.error('Audio loading error:', e);
                    // Fallback: continue without sound
                    setTimeout(() => {
                        setIsRinging(false);
                        startSession();
                        startAudioRecording();
                        resetAudioPlayer();
                        setIsRecording(true);
                    }, 2000);
                };
                
                ringingAudioRef.current.oncanplaythrough = () => {
                    console.log('Audio loaded successfully');
                };
            }
            
            console.log('Attempting to play ringing sound...');
            try {
                await ringingAudioRef.current.play();
                console.log('Ringing sound started');
            } catch (error) {
                console.error('Audio play error:', error);
                // Fallback: continue without sound
                setTimeout(() => {
                    setIsRinging(false);
                    startSession();
                    startAudioRecording();
                    resetAudioPlayer();
                    setIsRecording(true);
                }, 2000);
                return;
            }
            
            // After 2 seconds, stop ringing and start recording
            setTimeout(async () => {
                if (ringingAudioRef.current) {
                    ringingAudioRef.current.pause();
                    ringingAudioRef.current.currentTime = 0;
                }
                setIsRinging(false);
                
                console.log("🎯 Starting recording session...");
                startSession();
                await startAudioRecording();
                resetAudioPlayer();
                clearTranscript(); // Clear previous transcript
                setIsRecording(true);
                console.log("✅ Recording session started");
            }, 2000);
        } else if (isRecording) {
            await stopAudioRecording();
            stopAudioPlayer();
            inputAudioBufferClear();
            setIsRecording(false);
        }
    };

    const { t } = useTranslation();

    return (
        <div className="flex min-h-screen bg-gray-100 text-gray-900">
            {/* Left Panel - Conversation Area */}
            <div className="flex flex-1 flex-col">
                <div className="p-4 sm:absolute sm:left-4 sm:top-4">
                    <img src={logo} alt="Azure logo" className="h-16 w-16" />
                </div>
                <main className="flex flex-grow flex-col items-center justify-center">
                    <h1 className="mb-8 bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-4xl font-bold text-transparent md:text-7xl">
                        {t("app.title")}
                    </h1>
                    <div className="mb-4 flex flex-col items-center justify-center">
                        <Button
                            onClick={onToggleListening}
                            className={`h-12 w-60 ${isRecording ? "bg-red-600 hover:bg-red-700" : "bg-purple-500 hover:bg-purple-600"} ${isRinging ? "opacity-75 cursor-not-allowed" : ""}`}
                            aria-label={isRecording ? t("app.endCall") : t("app.call")}
                            disabled={isRinging}
                        >
                            {isRecording ? (
                                t("app.endCall")
                            ) : isRinging ? (
                                "Ringing..."
                            ) : (
                                t("app.call")
                            )}
                        </Button>
                        <StatusMessage isRecording={isRecording} isRinging={isRinging} />
                    </div>
                    <GroundingFiles files={groundingFiles} onSelected={setSelectedFile} />
                </main>

                <footer className="py-4 text-center">
                    <p>{t("app.footer")}</p>
                </footer>
            </div>

            {/* Right Panel - Transcription */}
            <div className="w-96">
                <TranscriptionPanel 
                    transcript={transcript} 
                    isRecording={isRecording} 
                    isRinging={isRinging} 
                />
            </div>

            <GroundingFileView groundingFile={selectedFile} onClosed={() => setSelectedFile(null)} />
        </div>
    );
}

export default App;
