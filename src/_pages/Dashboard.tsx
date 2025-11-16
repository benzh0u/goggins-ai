import React, { useState, useEffect, useRef } from "react"
import StayHardToggle from "../components/Coach/StayHardToggle"
import { CoachMessage } from "../types/activity"
import { useAudioManager } from "../contexts/AudioManagerContext"

const Dashboard: React.FC = () => {
  const [stayHardEnabled, setStayHardEnabled] = useState(false)
  const [chatInput, setChatInput] = useState("")
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: "user" | "goggins"; text: string; timestamp: string }>
  >([])
  const [chatLoading, setChatLoading] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  
  // Global audio manager - ensures only ONE audio plays at a time
  const { playAudio } = useAudioManager()

  // Load initial status
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const status = await window.electronAPI.getStayHardStatus()
        setStayHardEnabled(status.enabled)
      } catch (error) {
        console.error("Error loading status:", error)
      }
    }
    loadStatus()
  }, [])

  // Listen for partial transcriptions (user speaking)
  useEffect(() => {
    const unsubscribePartial = window.electronAPI.onTranscriptionPartial((text: string) => {
      console.log("[Dashboard] 📝 Partial transcription:", text)
      // Optional: Show partial transcript in UI for feedback
    })
    return unsubscribePartial
  }, [])

  // Listen for conversation speak events (voice responses from Goggins)
  useEffect(() => {
    const unsubscribeSpeak = window.electronAPI.onConversationSpeak((data: { text: string; audioPath: string; timestamp: string }) => {
      console.log("[Dashboard] 🔊 Conversation speak event received:", data.text)
      
      // Add Goggins response to chat
      setChatMessages((msgs) => [
        ...msgs,
        { role: "goggins", text: data.text, timestamp: data.timestamp }
      ])
      
      // Play audio using global audio manager
      if (data.audioPath) {
        playAudio(data.audioPath, data.text)
      } else {
        console.log("[Dashboard] ⚠️  No audio path in conversation speak event")
      }
    })
    return unsubscribeSpeak
  }, [playAudio])

  // Listen for automatic coach messages
  useEffect(() => {
    const unsubscribe = window.electronAPI.onCoachMessage((msg: CoachMessage) => {
      // Add automatic message to chat
      setChatMessages((msgs) => [
        ...msgs,
        { role: "goggins", text: msg.text, timestamp: msg.timestamp }
      ])
      
      // Play audio using global audio manager
      if (msg.audioPath) {
        playAudio(msg.audioPath, msg.text)
      } else {
        console.log("[Dashboard] ⚠️  No audio path provided in message")
      }
    })
    return unsubscribe
  }, [playAudio])

  // Handle StayHard toggle - automatically enables/disables voice listening
  const handleToggle = async (enabled: boolean) => {
    try {
      const result = await window.electronAPI.setStayHardEnabled(enabled)
      if (result.success) {
        setStayHardEnabled(enabled)
        
        // Automatically enable/disable voice listening with Stay Hard
        try {
          const voiceResult = await window.electronAPI.voiceToggleListening(enabled)
          if (voiceResult.success) {
            console.log(`[Dashboard] Voice listening ${enabled ? 'enabled' : 'disabled'} automatically with Stay Hard`)
          } else {
            console.warn(`[Dashboard] Failed to ${enabled ? 'enable' : 'disable'} voice:`, voiceResult.error)
          }
        } catch (voiceError) {
          console.error("[Dashboard] Error toggling voice:", voiceError)
        }
      } else {
        console.error("Failed to toggle StayHard:", result.error)
      }
    } catch (error) {
      console.error("Error toggling StayHard:", error)
    }
  }

  // Handle chat
  const handleChatSend = async () => {
    if (!chatInput.trim() || chatLoading) return

    const userMessage = chatInput.trim()
    setChatMessages((msgs) => [
      ...msgs,
      { role: "user", text: userMessage, timestamp: new Date().toISOString() }
    ])
    setChatInput("")
    setChatLoading(true)

    try {
      const response = await window.electronAPI.chat(userMessage)
      setChatMessages((msgs) => [
        ...msgs,
        { role: "goggins", text: response.text, timestamp: response.timestamp }
      ])
      
      // Play audio using global audio manager
      if ((response as any).audioPath) {
        playAudio((response as any).audioPath, response.text)
      } else {
        console.log("[Dashboard] ⚠️  No audio in chat response")
      }
    } catch (error) {
      setChatMessages((msgs) => [
        ...msgs,
        {
          role: "goggins",
          text: "Error: Could not get response. Stay hard anyway.",
          timestamp: new Date().toISOString()
        }
      ])
    } finally {
      setChatLoading(false)
      chatInputRef.current?.focus()
    }
  }

  // Update window dimensions
  useEffect(() => {
    if (!containerRef.current) return

    const updateHeight = () => {
      if (!containerRef.current) return
      const height = containerRef.current.scrollHeight
      const width = containerRef.current.scrollWidth
      window.electronAPI?.updateContentDimensions({ width, height })
    }

    const resizeObserver = new ResizeObserver(() => {
      updateHeight()
    })

    updateHeight()
    resizeObserver.observe(containerRef.current)

    const mutationObserver = new MutationObserver(() => {
      updateHeight()
    })

    mutationObserver.observe(containerRef.current, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    })

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [isChatOpen, chatMessages])

  return (
    <div ref={containerRef} className="min-h-0 dark bg-transparent w-full">
      {/* Minimal Bar UI - ShadCN Style */}
      <div className={`liquid-glass-bar draggable-area px-3 py-2 flex items-center gap-2 w-fit max-w-full ${isChatOpen ? 'rounded-t-lg rounded-b-none border-b-0' : 'rounded-lg'}`}>
        {/* Chat Button */}
        <button
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-8 px-3 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border"
        >
          Chat
        </button>

        {/* Stay Hard Toggle - Compact (Voice auto-enabled) */}
        <button
          onClick={() => handleToggle(!stayHardEnabled)}
          className={`inline-flex items-center justify-center rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-8 px-3 border ${
            stayHardEnabled
              ? "bg-green-600 hover:bg-green-700 text-white border-green-500/50"
              : "bg-destructive hover:bg-destructive/90 text-destructive-foreground border-destructive/50"
          }`}
        >
          {stayHardEnabled ? "🎤 Stay Hard ON" : "Stay Hard OFF"}
        </button>

        {/* Exit Button */}
        <button
          onClick={() => window.electronAPI.quitApp()}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-8 px-3 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border"
        >
          Exit
        </button>
      </div>

      {/* Chat Section - Expandable - Tab Popup Style */}
      {isChatOpen && (
        <div className="bg-black/80 backdrop-blur-md border border-t-0 border-border rounded-b-lg -mt-[1px] p-4 flex flex-col gap-3 w-full">
          <div className="flex-1 overflow-y-auto mb-2 p-4 rounded-lg border border-border/50 max-h-64 min-h-[120px] bg-black/40">
            {chatMessages.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center mt-8">
                Chat with David Goggins AI. Stay focused. Stay hard.
              </div>
            ) : (
              chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`w-full flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-3`}
                >
                  <div
                    className={`max-w-[80%] px-3 py-2 rounded-md text-sm shadow-sm border ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground ml-12 border-border"
                        : "bg-destructive text-destructive-foreground mr-12 border-destructive/50"
                    }`}
                    style={{ wordBreak: "break-word", lineHeight: "1.5" }}
                  >
                    {msg.text}
                  </div>
                </div>
              ))
            )}
            {chatLoading && (
              <div className="flex justify-start mb-3">
                <div className="bg-muted text-muted-foreground px-3 py-2 rounded-md text-sm border border-border shadow-sm mr-12">
                  Thinking...
                </div>
              </div>
            )}
          </div>
          <form
            className="flex gap-2 items-center"
            onSubmit={(e) => {
              e.preventDefault()
              handleChatSend()
            }}
          >
            <input
              ref={chatInputRef}
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Type your message..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={chatLoading}
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-9 px-3 bg-destructive text-destructive-foreground hover:bg-destructive/90 border border-destructive/50"
              disabled={chatLoading || !chatInput.trim()}
              tabIndex={-1}
              aria-label="Send"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 19.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z"
                />
              </svg>
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

export default Dashboard
