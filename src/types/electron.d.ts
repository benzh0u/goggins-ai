import { QwenActivitySummary, CoachMessage, ConversationState, VoiceStatus } from "./activity"

export interface ElectronAPI {
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  toggleWindow: () => Promise<void>
  quitApp: () => Promise<void>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  centerAndShowWindow: () => Promise<void>

  // StayHard API
  setStayHardEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  getStayHardStatus: () => Promise<{
    enabled: boolean
    latestActivity: QwenActivitySummary | null
    latestMessage: CoachMessage | null
  }>
  getLatestActivity: () => Promise<QwenActivitySummary | null>
  getLatestMessage: () => Promise<CoachMessage | null>
  onCoachMessage: (callback: (msg: CoachMessage) => void) => () => void
  chat: (message: string) => Promise<{ text: string; timestamp: string }>
  setMouthOpen: (isOpen: boolean) => Promise<{ success: boolean; error?: string }>
  
  // Voice/Conversation API
  voiceToggleListening: (enabled: boolean) => Promise<{ success: boolean; isListening?: boolean; error?: string }>
  voiceGetStatus: () => Promise<VoiceStatus>
  onConversationStateChanged: (callback: (data: VoiceStatus) => void) => () => void
  onConversationSpeak: (callback: (data: { text: string; audioPath: string; timestamp: string }) => void) => () => void
  onAudioStopImmediately: (callback: () => void) => () => void
  onTranscriptionPartial: (callback: (text: string) => void) => () => void
  notifyAudioPlaybackStarted: () => void
  notifyAudioPlaybackEnded: () => void
  
  // LLM Config API (for ModelSelector)
  getCurrentLlmConfig: () => Promise<{ provider: "ollama" | "gemini"; model: string; isOllama: boolean }>
  getAvailableOllamaModels: () => Promise<string[]>
  testLlmConnection: () => Promise<{ success: boolean; error?: string }>
  switchToOllama: (model: string, url: string) => Promise<{ success: boolean; error?: string }>
  switchToGemini: (apiKey?: string) => Promise<{ success: boolean; error?: string }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
