import { useEffect, useRef } from "react";

type Properties = {
    transcript: string;
    isRecording: boolean;
    isRinging: boolean;
};

export default function TranscriptionPanel({ transcript, isRecording, isRinging }: Properties) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new text arrives
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [transcript]);

    return (
        <div className="flex h-full flex-col bg-white border-l border-gray-200">
            <div className="border-b border-gray-200 p-4">
                <h3 className="text-lg font-semibold text-gray-900">
                    Live Transcription
                </h3>
                <div className="mt-2 flex items-center">
                    <div className={`h-2 w-2 rounded-full mr-2 ${
                        isRinging ? 'bg-yellow-500 animate-pulse' : 
                        isRecording ? 'bg-green-500 animate-pulse' : 
                        'bg-gray-400'
                    }`} />
                    <span className="text-sm text-gray-600">
                        {isRinging ? 'Ringing...' : 
                         isRecording ? 'Recording' : 
                         'Ready'}
                    </span>
                </div>
            </div>
            
            <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4"
            >
                {transcript ? (
                    <div className="space-y-2">
                        <p className="text-gray-900 leading-relaxed whitespace-pre-wrap">
                            {transcript}
                        </p>
                        {isRecording && (
                            <div className="flex items-center text-sm text-gray-500">
                                <div className="animate-pulse">●</div>
                                <span className="ml-2">Listening...</span>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center text-gray-500">
                        <div className="text-center">
                            <div className="text-4xl mb-2">🎤</div>
                            <p className="text-sm">
                                {isRinging ? 'Ringing...' : 
                                 isRecording ? 'Start speaking to see transcription...' : 
                                 'Click "Call" to start transcription'}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
