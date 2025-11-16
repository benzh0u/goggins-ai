import React, { useEffect, useState } from "react"
import { CoachMessage } from "../../types/activity"
import { useAudioManager } from "../../contexts/AudioManagerContext"

interface CoachOverlayProps {
  message: CoachMessage | null
  onDismiss?: () => void
}

const CoachOverlay: React.FC<CoachOverlayProps> = ({ message, onDismiss }) => {
  const [isVisible, setIsVisible] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  const [isUserSpeaking, setIsUserSpeaking] = useState(false)
  const [isGogginsSpeaking, setIsGogginsSpeaking] = useState(false)
  
  // Global audio manager - ensures only ONE audio plays at a time
  const { playAudio, stopAudio, isPlaying } = useAudioManager()

  // Handle audio interruption from user speaking
  useEffect(() => {
    if (!window.electronAPI) return

    // Listen for audio stop command
    const unsubscribeStop = window.electronAPI.onAudioStopImmediately(() => {
      console.log('[CoachOverlay] User interrupted - stopping audio')
      stopAudio()
      setIsUserSpeaking(true)
      
      // Clear user speaking indicator after 2 seconds
      setTimeout(() => setIsUserSpeaking(false), 2000)
    })

    return () => {
      unsubscribeStop()
    }
  }, [stopAudio])

  useEffect(() => {
    if (message) {
      setIsVisible(true)
      setIsExiting(false)

      // Play audio using global audio manager
      if (message.audioPath) {
        setIsGogginsSpeaking(true)
        playAudio(message.audioPath, message.text)
        
        // Monitor playback state to update indicator
        const checkPlaybackInterval = setInterval(() => {
          if (!isPlaying()) {
            setIsGogginsSpeaking(false)
            clearInterval(checkPlaybackInterval)
          }
        }, 500)
        
        // Cleanup interval after reasonable time
        setTimeout(() => clearInterval(checkPlaybackInterval), 10000)
      }

      // Auto-dismiss after 8 seconds
      const timer = setTimeout(() => {
        setIsExiting(true)
        setIsGogginsSpeaking(false)
        setTimeout(() => {
          setIsVisible(false)
          onDismiss?.()
        }, 300) // Fade out duration
      }, 8000)

      return () => {
        clearTimeout(timer)
        setIsGogginsSpeaking(false)
      }
    } else {
      setIsVisible(false)
      setIsGogginsSpeaking(false)
    }
  }, [message, onDismiss, playAudio, isPlaying])

  if (!message || !isVisible) {
    return null
  }

  return (
    <>
      <div
        className={`
          fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50
          max-w-2xl w-full mx-4
          transition-all duration-300
          ${isExiting ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0"}
        `}
      >
        <div className="rounded-lg border border-border bg-card text-card-foreground shadow-lg p-6">
          <div className="flex items-start gap-4">
            <div className="text-3xl flex-shrink-0">🔥</div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  David Goggins
                </span>
                <span className="text-xs text-muted-foreground">
                  Score: {message.score.toFixed(1)}/10
                </span>
                {isGogginsSpeaking && (
                  <span className="text-xs text-red-400 font-semibold animate-pulse">
                    🔊 Goggins speaking - WAIT
                  </span>
                )}
                {!isGogginsSpeaking && !isUserSpeaking && (
                  <span className="text-xs text-green-400 font-semibold">
                    ✅ Your turn - respond now
                  </span>
                )}
                {isUserSpeaking && (
                  <span className="text-xs text-blue-400 font-semibold animate-pulse">
                    🎤 You're speaking...
                  </span>
                )}
              </div>
              <p className="text-base font-semibold text-foreground leading-relaxed">
                {message.text}
              </p>
            </div>
            <button
              onClick={() => {
                // Stop audio using global audio manager
                stopAudio()
                setIsExiting(true)
                setTimeout(() => {
                  setIsVisible(false)
                  onDismiss?.()
                }, 300)
              }}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-8 w-8 text-muted-foreground hover:text-foreground flex-shrink-0"
              aria-label="Dismiss"
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export default CoachOverlay

