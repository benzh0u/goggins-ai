import React, { createContext, useContext, useRef, ReactNode } from "react"

interface AudioManagerContextType {
  playAudio: (audioPath: string, text: string) => Promise<void>
  stopAudio: () => void
  isPlaying: () => boolean
}

const AudioManagerContext = createContext<AudioManagerContextType | undefined>(undefined)

interface AudioManagerProviderProps {
  children: ReactNode
}

export const AudioManagerProvider: React.FC<AudioManagerProviderProps> = ({ children }) => {
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const isPlayingRef = useRef<boolean>(false)

  const stopAudio = () => {
    if (currentAudioRef.current) {
      console.log("[AudioManager] 🛑 Stopping current audio")
      currentAudioRef.current.pause()
      currentAudioRef.current.currentTime = 0
      currentAudioRef.current = null
      isPlayingRef.current = false
      
      // Notify electron that playback ended
      if (window.electronAPI) {
        window.electronAPI.notifyAudioPlaybackEnded()
        window.electronAPI.setMouthOpen(false).catch((err) => {
          console.error("[AudioManager] Error closing mouth on stop:", err)
        })
      }
    }
  }

  const playAudio = async (audioPath: string, text: string): Promise<void> => {
    // CRITICAL: Stop any previous audio first (immediate interruption)
    stopAudio()

    console.log(`[AudioManager] 🔊 Playing audio: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`)
    
    const audio = new Audio(audioPath)
    currentAudioRef.current = audio
    isPlayingRef.current = true

    audio.onplay = () => {
      console.log("[AudioManager] ✓ AUDIO PLAYBACK STARTED 🎵")
      if (window.electronAPI) {
        window.electronAPI.notifyAudioPlaybackStarted()
        window.electronAPI.setMouthOpen(true).catch((error) => {
          console.error("[AudioManager] Error opening mouth:", error)
        })
      }
    }

    audio.onended = () => {
      console.log("[AudioManager] ✓ Audio playback completed")
      currentAudioRef.current = null
      isPlayingRef.current = false
      if (window.electronAPI) {
        window.electronAPI.notifyAudioPlaybackEnded()
        window.electronAPI.setMouthOpen(false).catch((error) => {
          console.error("[AudioManager] Error closing mouth:", error)
        })
      }
    }

    audio.onerror = (error) => {
      console.error("[AudioManager] ✗ Audio playback error:", error)
      currentAudioRef.current = null
      isPlayingRef.current = false
      if (window.electronAPI) {
        window.electronAPI.notifyAudioPlaybackEnded()
        window.electronAPI.setMouthOpen(false).catch((err) => {
          console.error("[AudioManager] Error closing mouth on error:", err)
        })
      }
    }

    audio.onpause = () => {
      // Only trigger callbacks if this was an intentional pause (not from stop)
      if (currentAudioRef.current === audio) {
        currentAudioRef.current = null
        isPlayingRef.current = false
        if (window.electronAPI) {
          window.electronAPI.notifyAudioPlaybackEnded()
          window.electronAPI.setMouthOpen(false).catch((error) => {
            console.error("[AudioManager] Error closing mouth on pause:", error)
          })
        }
      }
    }

    try {
      await audio.play()
    } catch (error) {
      console.error("[AudioManager] ✗ Failed to play audio:", error)
      currentAudioRef.current = null
      isPlayingRef.current = false
      if (window.electronAPI) {
        window.electronAPI.notifyAudioPlaybackEnded()
        window.electronAPI.setMouthOpen(false).catch((err) => {
          console.error("[AudioManager] Error closing mouth on play error:", err)
        })
      }
    }
  }

  const isPlaying = (): boolean => {
    return isPlayingRef.current
  }

  const value: AudioManagerContextType = {
    playAudio,
    stopAudio,
    isPlaying
  }

  return (
    <AudioManagerContext.Provider value={value}>
      {children}
    </AudioManagerContext.Provider>
  )
}

export const useAudioManager = (): AudioManagerContextType => {
  const context = useContext(AudioManagerContext)
  if (context === undefined) {
    throw new Error("useAudioManager must be used within an AudioManagerProvider")
  }
  return context
}

