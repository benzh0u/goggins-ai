// ipcHandlers.ts

import { ipcMain, app } from "electron"
import { AppState } from "./main"
import { config } from "./config"
import fs from "fs"

export function initializeIpcHandlers(appState: AppState): void {
  // Window dimension updates
  ipcMain.handle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (width && height) {
        appState.setWindowDimensions(width, height)
      }
    }
  )

  // Window movement handlers
  ipcMain.handle("move-window-left", async () => {
    appState.moveWindowLeft()
  })

  ipcMain.handle("move-window-right", async () => {
    appState.moveWindowRight()
  })

  ipcMain.handle("move-window-up", async () => {
    appState.moveWindowUp()
  })

  ipcMain.handle("move-window-down", async () => {
    appState.moveWindowDown()
  })

  ipcMain.handle("center-and-show-window", async () => {
    appState.centerAndShowWindow()
  })

  ipcMain.handle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  ipcMain.handle("quit-app", () => {
    app.quit()
  })

  // StayHard IPC handlers
  ipcMain.handle("stayhard:set-enabled", async (event, enabled: boolean) => {
    try {
      appState.setStayHardEnabled(enabled)
      return { success: true }
    } catch (error: any) {
      console.error("Error setting StayHard enabled:", error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle("stayhard:get-status", async () => {
    try {
      const monitor = appState.getProductivityMonitor()
      if (!monitor) {
        return {
          enabled: false,
          latestActivity: null,
          latestMessage: null
        }
      }

      return {
        enabled: monitor.getIsEnabled(),
        latestActivity: monitor.getLatestActivity(),
        latestMessage: monitor.getLatestCoachMessage()
      }
    } catch (error: any) {
      console.error("Error getting StayHard status:", error)
      return {
        enabled: false,
        latestActivity: null,
        latestMessage: null
      }
    }
  })

  ipcMain.handle("stayhard:get-latest-activity", async () => {
    try {
      const monitor = appState.getProductivityMonitor()
      if (!monitor) {
        return null
      }
      return monitor.getLatestActivity()
    } catch (error: any) {
      console.error("Error getting latest activity:", error)
      return null
    }
  })

  ipcMain.handle("stayhard:get-latest-message", async () => {
    try {
      const monitor = appState.getProductivityMonitor()
      if (!monitor) {
        return null
      }
      return monitor.getLatestCoachMessage()
    } catch (error: any) {
      console.error("Error getting latest message:", error)
      return null
    }
  })

  // Chat handler (for user-initiated chat with Goggins)
  ipcMain.handle("stayhard:chat", async (event, message: string) => {
    try {
      const monitor = appState.getProductivityMonitor()
      if (!monitor) {
        return {
          text: "Stay hard. Focus on your work. That's what matters.",
          timestamp: new Date().toISOString()
        }
      }

      // User-initiated messages always respond immediately (no cooldown)
      // Add user message to history
      const userMessage = {
        role: "user" as const,
        text: message,
        timestamp: new Date().toISOString()
      }
      monitor.addChatMessage(userMessage)

      // Generate response with context
      const response = await monitor.generateChatResponse(message)

      // Generate TTS audio for chat response
      let audioDataUrl: string | undefined
      const ttsHelper = appState.getTTSHelper()
      
      if (config.enableTTS && ttsHelper?.hasTTS()) {
        try {
          console.log(`[ipcHandlers] 🎤 Generating TTS for chat response...`)
          const audioPath = await ttsHelper.generateGogginsVoice(response.text) ?? undefined
          if (audioPath && fs.existsSync(audioPath)) {
            const audioBuffer = fs.readFileSync(audioPath)
            const base64Audio = audioBuffer.toString('base64')
            audioDataUrl = `data:audio/mp3;base64,${base64Audio}`
            console.log(`[ipcHandlers] ✓ Chat TTS audio generated`)
          }
        } catch (ttsError) {
          console.error("[ipcHandlers] ✗ Failed to generate TTS for chat:", ttsError)
        }
      }

      // Add Goggins response to history
      const gogginsMessage = {
        role: "goggins" as const,
        text: response.text,
        timestamp: response.timestamp
      }
      monitor.addChatMessage(gogginsMessage)

      // Return response with audio
      return {
        ...response,
        audioPath: audioDataUrl
      }
    } catch (error: any) {
      console.error("Error in chat handler:", error)
      
      // Provide more helpful error messages
      const errorMessage = error?.message || String(error)
      
      // Check for specific error types
      if (errorMessage.includes("404") || errorMessage.includes("Not Found") || errorMessage.includes("model") && errorMessage.includes("not found")) {
        return {
          text: "Model not found. Please install a llama model in Ollama (e.g., 'ollama pull llama3.2' or 'ollama pull llama2.3'). Stay hard.",
          timestamp: new Date().toISOString()
        }
      }
      
      if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("Cannot connect") || errorMessage.includes("fetch failed")) {
        return {
          text: "Cannot connect to Ollama. Make sure Ollama is running (check 'ollama serve' or start Ollama app). Stay hard.",
          timestamp: new Date().toISOString()
        }
      }
      
      if (errorMessage.includes("timeout") || errorMessage.includes("AbortError")) {
        return {
          text: "Request timed out. Ollama might be slow or busy. Try again. Stay hard.",
          timestamp: new Date().toISOString()
        }
      }
      
      // Generic error with helpful context
      return {
        text: `Error: ${errorMessage}. Check if Ollama is running and the model is installed. Stay hard.`,
        timestamp: new Date().toISOString()
      }
    }
  })

  // Floating mouth control handlers
  ipcMain.handle("mouth:set-open", async (event, isOpen: boolean) => {
    try {
      const floatingMouthWindow = appState.getFloatingMouthWindow()
      floatingMouthWindow.setMouthOpen(isOpen)
      return { success: true }
    } catch (error: any) {
      console.error("Error setting mouth state:", error)
      return { success: false, error: error.message }
    }
  })

  // Voice/Conversation IPC handlers
  ipcMain.handle("voice:toggle-listening", async (event, enabled: boolean) => {
    try {
      const monitor = appState.getProductivityMonitor()
      const conversationManager = (monitor as any)?.conversationManager
      
      if (!conversationManager) {
        console.warn("[ipcHandlers] ConversationManager not available")
        return { success: false, error: "Voice features not available" }
      }

      if (enabled) {
        await conversationManager.start()
        console.log("[ipcHandlers] Voice listening enabled")
      } else {
        conversationManager.stop()
        console.log("[ipcHandlers] Voice listening disabled")
      }

      return { success: true, isListening: enabled }
    } catch (error: any) {
      console.error("[ipcHandlers] Error toggling voice listening:", error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle("voice:get-status", async () => {
    try {
      const monitor = appState.getProductivityMonitor()
      const conversationManager = (monitor as any)?.conversationManager
      
      if (!conversationManager) {
        return {
          isListening: false,
          conversationState: "monitoring",
          exchangeCount: 0,
          sttConnected: false
        }
      }

      if (typeof conversationManager.getVoiceStatus === "function") {
        return conversationManager.getVoiceStatus()
      }

      // Fallback (defensive; should normally not run)
      const state = conversationManager.getState()
      const sttStatus = conversationManager.sttClient?.getStatus?.() || { connected: false }

      return {
        isListening: !!sttStatus.connected,
        conversationState: state,
        exchangeCount: 0,
        sttConnected: !!sttStatus.connected
      }
    } catch (error: any) {
      console.error("[ipcHandlers] Error getting voice status:", error)
      return {
        isListening: false,
        conversationState: "monitoring",
        exchangeCount: 0,
        sttConnected: false
      }
    }
  })

  // Audio playback state notifications from renderer
  ipcMain.on("audio:playback-started", () => {
    try {
      const monitor = appState.getProductivityMonitor()
      const conversationManager = (monitor as any)?.conversationManager
      if (conversationManager) {
        conversationManager.setPlaybackActive(true)
      } else {
        console.warn("[ipcHandlers] audio:playback-started - ConversationManager not available")
      }
    } catch (error) {
      console.error("[ipcHandlers] Error handling audio:playback-started:", error)
    }
  })

  ipcMain.on("audio:playback-ended", () => {
    try {
      const monitor = appState.getProductivityMonitor()
      const conversationManager = (monitor as any)?.conversationManager
      if (conversationManager) {
        conversationManager.setPlaybackActive(false)
      } else {
        console.warn("[ipcHandlers] audio:playback-ended - ConversationManager not available")
      }
    } catch (error) {
      console.error("[ipcHandlers] Error handling audio:playback-ended:", error)
    }
  })

  // LLM Config IPC handlers (for ModelSelector)
  ipcMain.handle("llm:get-current-config", async () => {
    try {
      const ttsHelper = appState.getTTSHelper()
      if (!ttsHelper) {
        // Return default config if no LLMHelper exists
        return {
          provider: "ollama" as const,
          model: "llama3.2",
          isOllama: true
        }
      }
      return ttsHelper.getCurrentLlmConfig()
    } catch (error: any) {
      console.error("[ipcHandlers] Error getting current LLM config:", error)
      return {
        provider: "ollama" as const,
        model: "llama3.2",
        isOllama: true
      }
    }
  })

  ipcMain.handle("llm:get-available-ollama-models", async (event, url?: string) => {
    try {
      const ttsHelper = appState.getTTSHelper()
      const targetUrl = url || "http://localhost:11434"
      
      if (!ttsHelper) {
        // Try to fetch models directly if no LLMHelper exists
        const response = await fetch(`${targetUrl}/api/tags`)
        if (!response.ok) throw new Error('Failed to fetch models')
        const data = await response.json()
        return data.models?.map((model: any) => model.name) || []
      }
      return await ttsHelper.getAvailableOllamaModels(targetUrl)
    } catch (error: any) {
      console.error("[ipcHandlers] Error getting available Ollama models:", error)
      return []
    }
  })

  ipcMain.handle("llm:test-connection", async () => {
    try {
      const ttsHelper = appState.getTTSHelper()
      if (!ttsHelper) {
        return { success: false, error: "LLM Helper not available" }
      }
      return await ttsHelper.testConnection()
    } catch (error: any) {
      console.error("[ipcHandlers] Error testing LLM connection:", error)
      return { success: false, error: error.message || String(error) }
    }
  })

  ipcMain.handle("llm:switch-to-ollama", async (event, model: string, url: string) => {
    try {
      const ttsHelper = appState.getTTSHelper()
      if (!ttsHelper) {
        return { success: false, error: "LLM Helper not available" }
      }
      await ttsHelper.switchToOllama(model, url)
      return { success: true }
    } catch (error: any) {
      console.error("[ipcHandlers] Error switching to Ollama:", error)
      return { success: false, error: error.message || String(error) }
    }
  })

  ipcMain.handle("llm:switch-to-gemini", async (event, apiKey?: string) => {
    try {
      const ttsHelper = appState.getTTSHelper()
      if (!ttsHelper) {
        return { success: false, error: "LLM Helper not available" }
      }
      await ttsHelper.switchToGemini(apiKey)
      return { success: true }
    } catch (error: any) {
      console.error("[ipcHandlers] Error switching to Gemini:", error)
      return { success: false, error: error.message || String(error) }
    }
  })
}
