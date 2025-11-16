import React, { useState, useEffect } from 'react'
import { ConversationState } from '../../types/activity'

interface VoiceControlProps {
  className?: string
}

export const VoiceControl: React.FC<VoiceControlProps> = ({ className = '' }) => {
  // Initialize as false - will be updated by status check
  const [isListening, setIsListening] = useState(false)
  const [conversationState, setConversationState] = useState<ConversationState>('monitoring')
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt'>('prompt')
  const [sttConnected, setSttConnected] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    // Check if electron API is available
    if (!window.electronAPI) {
      console.warn('[VoiceControl] Electron API not available')
      return
    }

    // Function to update status
    const updateStatus = async () => {
      try {
        const status = await window.electronAPI.voiceGetStatus()
        setIsListening(status.isListening || false)
        setConversationState(status.conversationState || 'monitoring')
        setSttConnected(status.sttConnected !== undefined ? status.sttConnected : true)
      } catch (error: any) {
        console.error('[VoiceControl] Error getting voice status:', error)
        setIsListening(false)
        setSttConnected(false)
      }
    }

    // Get initial voice status
    updateStatus()

    // Poll for status changes periodically (in case Stay Hard is toggled)
    const statusInterval = setInterval(updateStatus, 2000) // Check every 2 seconds

    // Listen for conversation state changes
    const unsubscribe = window.electronAPI.onConversationStateChanged((data: any) => {
      setConversationState(data.state || 'monitoring')
      setIsListening(data.isListening || false)
    })

    return () => {
      clearInterval(statusInterval)
      unsubscribe()
    }
  }, [])

  const handleToggleListening = async () => {
    if (!window.electronAPI) return

    try {
      const newState = !isListening
      const result = await window.electronAPI.voiceToggleListening(newState)
      if (result.success && result.isListening !== undefined) {
        setIsListening(result.isListening)
      }
    } catch (error) {
      console.error('[VoiceControl] Error toggling listening:', error)
    }
  }

  const getStateLabel = (): string => {
    // If voice is off, always show "Voice Off" regardless of conversation state
    if (!isListening) {
      return 'Voice Off'
    }
    
    switch (conversationState) {
      case 'monitoring':
        return 'Ready - Speak to Goggins'
      case 'conversation':
        return '🎤 YOUR TURN - Speak now!'
      case 'responding':
        return '🔊 Goggins speaking - WAIT'
      default:
        return 'Ready - Speak to Goggins'
    }
  }

  const getStateColor = (): string => {
    switch (conversationState) {
      case 'monitoring':
        return isListening ? 'text-green-400' : 'text-gray-400'
      case 'conversation':
        return 'text-blue-400'
      case 'responding':
        return 'text-purple-400'
      default:
        return 'text-gray-400'
    }
  }

  const getMicIcon = (): string => {
    if (!isListening) return '🔇'
    if (conversationState === 'conversation') return '🎤'
    if (conversationState === 'responding') return '🔊'
    return '👂'
  }

  return (
    <div className={`flex items-center space-x-3 ${className}`}>
      {/* Status Indicator */}
      <div className="flex items-center space-x-2">
        <span className="text-2xl">{getMicIcon()}</span>
        <span className={`text-sm font-medium ${getStateColor()}`}>
          {getStateLabel()}
        </span>
      </div>

      {/* Toggle Button */}
      <button
        onClick={handleToggleListening}
        className={`
          px-4 py-2 rounded-lg font-medium text-sm
          transition-all duration-200
          ${isListening
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-gray-600 hover:bg-gray-700 text-white'
          }
        `}
        aria-label={isListening ? 'Turn off voice listening' : 'Turn on voice listening'}
      >
        {isListening ? 'Voice ON' : 'Voice OFF'}
      </button>

      {/* Detailed Status Indicator with clear turn-taking feedback */}
      {isListening && (
        <div className="text-xs flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${
              conversationState === 'conversation' ? 'bg-green-400 animate-pulse' : 
              conversationState === 'responding' ? 'bg-red-400 animate-pulse' : 
              'bg-blue-400'
            }`}></span>
            <span className={
              conversationState === 'conversation' ? 'text-green-300 font-semibold' :
              conversationState === 'responding' ? 'text-red-300 font-semibold' :
              'text-gray-400'
            }>
              {conversationState === 'monitoring' && '💬 Voice active - say something to Goggins'}
              {conversationState === 'conversation' && '✅ YOUR TURN - Speak now, Goggins is listening'}
              {conversationState === 'responding' && '⏳ WAIT - Goggins is speaking (don\'t interrupt)'}
            </span>
          </div>
        </div>
      )}

      {/* Warning if voice is on but Whisper isn't connected */}
      {isListening && sttConnected === false && (
        <div className="text-xs text-yellow-400">
          ⚠️ Whisper unavailable - listening disabled
        </div>
      )}

      {/* Permission Status (if needed) */}
      {permissionStatus === 'denied' && (
        <div className="text-xs text-red-400">
          Microphone permission denied
        </div>
      )}
    </div>
  )
}

