import { contextBridge, ipcRenderer } from "electron"
import { QwenActivitySummary, CoachMessage, VoiceStatus } from "../src/types/activity"

// Types for the exposed Electron API
interface ElectronAPI {
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
  chat: (message: string) => Promise<{ text: string; timestamp: string; audioPath?: string }>
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

// Expose the Electron API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  toggleWindow: () => ipcRenderer.invoke("toggle-window"),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
  moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
  moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
  moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
  centerAndShowWindow: () => ipcRenderer.invoke("center-and-show-window"),

  // StayHard API
  setStayHardEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("stayhard:set-enabled", enabled),
  getStayHardStatus: () => ipcRenderer.invoke("stayhard:get-status"),
  getLatestActivity: () => ipcRenderer.invoke("stayhard:get-latest-activity"),
  getLatestMessage: () => ipcRenderer.invoke("stayhard:get-latest-message"),
  onCoachMessage: (callback: (msg: CoachMessage) => void) => {
    const subscription = (_: any, msg: CoachMessage) => callback(msg)
    ipcRenderer.on("coach:new-message", subscription)
    return () => {
      ipcRenderer.removeListener("coach:new-message", subscription)
    }
  },
  chat: (message: string) => ipcRenderer.invoke("stayhard:chat", message),
  setMouthOpen: (isOpen: boolean) => ipcRenderer.invoke("mouth:set-open", isOpen),
  
  // Voice/Conversation API
  voiceToggleListening: (enabled: boolean) => 
    ipcRenderer.invoke("voice:toggle-listening", enabled),
  voiceGetStatus: () => ipcRenderer.invoke("voice:get-status"),
  onConversationStateChanged: (callback: (data: VoiceStatus) => void) => {
    const subscription = (_: any, data: VoiceStatus) => callback(data)
    ipcRenderer.on("conversation:state-changed", subscription)
    return () => {
      ipcRenderer.removeListener("conversation:state-changed", subscription)
    }
  },
  onConversationSpeak: (callback: (data: { text: string; audioPath: string; timestamp: string }) => void) => {
    const subscription = (_: any, data: { text: string; audioPath: string; timestamp: string }) => callback(data)
    ipcRenderer.on("conversation:speak", subscription)
    return () => {
      ipcRenderer.removeListener("conversation:speak", subscription)
    }
  },
  onAudioStopImmediately: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("audio:stop-immediately", subscription)
    return () => {
      ipcRenderer.removeListener("audio:stop-immediately", subscription)
    }
  },
  onTranscriptionPartial: (callback: (text: string) => void) => {
    const subscription = (_: any, text: string) => callback(text)
    ipcRenderer.on("transcription:partial", subscription)
    return () => {
      ipcRenderer.removeListener("transcription:partial", subscription)
    }
  },
  
  // Audio playback notifications (CRITICAL for preventing echo)
  notifyAudioPlaybackStarted: () => ipcRenderer.send("audio:playback-started"),
  notifyAudioPlaybackEnded: () => ipcRenderer.send("audio:playback-ended"),
  
  // LLM Config API
  getCurrentLlmConfig: () => ipcRenderer.invoke("llm:get-current-config"),
  getAvailableOllamaModels: () => ipcRenderer.invoke("llm:get-available-ollama-models"),
  testLlmConnection: () => ipcRenderer.invoke("llm:test-connection"),
  switchToOllama: (model: string, url: string) => ipcRenderer.invoke("llm:switch-to-ollama", model, url),
  switchToGemini: (apiKey?: string) => ipcRenderer.invoke("llm:switch-to-gemini", apiKey)
} as ElectronAPI)
