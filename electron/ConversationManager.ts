import { BrowserWindow } from "electron"
import { WhisperCppClient } from "./WhisperCppClient"
import { MicrophoneHelper } from "./MicrophoneHelper"
import { LLMHelper } from "./LLMHelper"
import { config } from "./config"
import { 
  ConversationState, 
  ConversationMode, 
  ConversationMessage,
  QwenActivitySummary,
  VoiceStatus
} from "../src/types/activity"
import { ConversationMemoryManager } from "./ConversationMemory"

export class ConversationManager {
  private state: ConversationState = "monitoring"
  private mode: ConversationMode | null = null
  private conversationHistory: ConversationMessage[] = []
  private exchangeCount: number = 0
  private sttClient: WhisperCppClient
  private microphoneHelper: MicrophoneHelper
  private llmHelper: LLMHelper
  private mainWindow: BrowserWindow | null = null
  private responseTimeoutHandle: NodeJS.Timeout | null = null
  private accumulatedTranscript: string = ""
  private isProcessingResponse: boolean = false
  private recentActivities: QwenActivitySummary[] = []
  private lastResponseTime: number = 0
  private readonly ECHO_COOLDOWN_MS = 0 // DISABLED: isPlaybackActive now handles echo prevention during playback
  private isPlaybackActive: boolean = false
  private memoryManager: ConversationMemoryManager

  constructor(llmHelper: LLMHelper, mainWindow: BrowserWindow | null = null) {
    this.llmHelper = llmHelper
    this.mainWindow = mainWindow
    
    // Initialize conversation memory for adaptive coaching
    this.memoryManager = new ConversationMemoryManager()
    console.log("[ConversationManager] Conversation memory initialized")
    
    // Use Whisper only (local, no API key needed)
    console.log("[ConversationManager] Using Whisper.cpp for speech-to-text (local, private)")
    this.sttClient = new WhisperCppClient()
    
    this.microphoneHelper = new MicrophoneHelper()
    
    this.setupSTTCallbacks()
    this.setupMicrophoneStreaming()
  }

  /**
   * Set playback active state (called from IPC when Goggins audio starts/ends)
   */
  public setPlaybackActive(active: boolean): void {
    this.isPlaybackActive = active
    console.log(`[ConversationManager] 🔊 Playback active set to ${active}`)
  }

  /**
   * Get current playback state
   */
  public getPlaybackActive(): boolean {
    return this.isPlaybackActive
  }

  /**
   * Setup callbacks for Whisper client events
   */
  private setupSTTCallbacks(): void {
    // Handle transcripts
    this.sttClient.onTranscript((event) => {
      if (event.type === "final") {
        this.handleFinalTranscript(event.text)
      } else {
        this.handlePartialTranscript(event.text)
      }
    })

    // Handle wake word
    this.sttClient.onWakeWord(() => {
      this.handleWakeWord()
    })

    // Handle user speaking (VAD)
    this.sttClient.onUserSpeaking((isSpeaking) => {
      this.handleUserSpeaking(isSpeaking)
    })

    // Handle errors
    this.sttClient.onError((error) => {
      console.error("[ConversationManager] Whisper error:", error)
      // No fallback - Whisper is the only option
    })
  }

  /**
   * Setup microphone streaming to Whisper client
   */
  private setupMicrophoneStreaming(): void {
    // Stream microphone audio chunks to Whisper for live transcription
    let audioChunkCount = 0
    this.microphoneHelper.onAudioChunk((audioBuffer) => {
      audioChunkCount++
      // Forward PCM audio to Whisper for transcription
      const isConnected = this.sttClient.getStatus().connected
      const isActive = this.state === "monitoring" || this.state === "conversation"
      
      // IMPORTANT: Don't forward audio while Goggins is responding OR while playback is active - prevents echo/feedback
      const shouldForward =
        isConnected &&
        isActive &&
        this.state !== "responding" &&
        !this.isProcessingResponse &&
        !this.isPlaybackActive
      
      // Log first chunk and every 50th chunk
      if (audioChunkCount === 1 || audioChunkCount % 50 === 0) {
        console.log(`[ConversationManager] 📡 Audio chunk received (${audioBuffer.length} bytes) - forwarding=${shouldForward} (chunk ${audioChunkCount}, connected=${isConnected}, state=${this.state}, processing=${this.isProcessingResponse})`)
      }
      
      if (shouldForward) {
        this.sttClient.streamAudio(audioBuffer)
      } else if (audioChunkCount === 1 || audioChunkCount % 50 === 0) {
        // Only log periodically to avoid spam
        if (this.state === "responding" || this.isProcessingResponse) {
          // Don't spam logs when intentionally ignoring audio
        } else {
          console.warn(`[ConversationManager] ⚠️  Audio received but not forwarding: connected=${isConnected}, state=${this.state}, processing=${this.isProcessingResponse}`)
        }
      }
    })
    console.log("[ConversationManager] ✓ Microphone streaming callback configured for Whisper")
  }

  /**
   * Initialize and start listening
   */
  public async start(): Promise<void> {
    if (!config.voiceListeningEnabled) {
      console.log("[ConversationManager] Voice listening disabled in config")
      return
    }

    // Check microphone permission on macOS
    if (process.platform === 'darwin') {
      const { systemPreferences } = require('electron')
      const micStatus = systemPreferences.getMediaAccessStatus('microphone')
      if (micStatus !== 'granted') {
        console.error("[ConversationManager] ✗ Microphone permission not granted")
        console.error("[ConversationManager]   Status:", micStatus)
        console.error("[ConversationManager]   Please enable in System Settings > Privacy & Security > Microphone")
        throw new Error("Microphone permission not granted")
      }
      console.log("[ConversationManager] ✓ Microphone permission verified")
    }

    try {
      console.log("[ConversationManager] Starting voice listening system with Whisper.cpp...")
      
      // Connect to Whisper (it's already initialized in constructor)
      console.log("[ConversationManager] Connecting to Whisper.cpp...")
      await this.sttClient.connect()
      console.log("[ConversationManager] ✓ Whisper.cpp initialized")
      
      // Check if connection was successful before proceeding
      const status = this.sttClient.getStatus()
      if (!status.connected) {
        console.warn("[ConversationManager] ⚠️  Whisper connection failed - voice listening unavailable")
        this.state = "monitoring"
        this.notifyStateChange()
        return // Exit early - don't start microphone if Whisper isn't connected
      }

      // Start Whisper streaming for live transcription
      this.sttClient.startStreaming()
      console.log("[ConversationManager] ✓ Whisper.cpp streaming started (live transcription active)")
      
      // Start microphone capture
      console.log("[ConversationManager] Starting microphone...")
      try {
      this.microphoneHelper.start()
        console.log("[ConversationManager] ✓ Microphone started successfully")
        
        // Verify microphone is actually recording
        setTimeout(() => {
          const isRecording = this.microphoneHelper.getIsRecording()
          console.log(`[ConversationManager] Microphone status check: isRecording=${isRecording}`)
          if (!isRecording) {
            console.error("[ConversationManager] ⚠️  WARNING: Microphone reports not recording after start!")
          }
        }, 1000)
      } catch (error) {
        console.error("[ConversationManager] ✗ Failed to start microphone:", error)
        throw error
      }
      
      // Verify audio chunks are being forwarded
      console.log("[ConversationManager] Verifying audio pipeline...")
      
      // Immediately enter conversation mode - Goggins listens right away (no wake word needed)
      this.enterConversationMode("callout_auto_listen")
      console.log("[ConversationManager] ✓ Started - microphone active, listening immediately")
      console.log("[ConversationManager] Goggins is ready to listen and respond!")
    } catch (error) {
      console.error("[ConversationManager] ✗ Failed to start:", error)
      if (error instanceof Error) {
        console.error("[ConversationManager] Error message:", error.message)
        console.error("[ConversationManager] Error stack:", error.stack)
      }
      throw error
    }
  }

  /**
   * Stop listening
   */
  public stop(): void {
    // Stop microphone
    this.microphoneHelper.stop()
    
    // Stop STT client
    this.sttClient.stopStreaming()
    this.sttClient.disconnect()
    
      this.state = "monitoring"
      this.clearResponseTimeout()
      console.log("[ConversationManager] Stopped (Whisper.cpp)")
  }

  /**
   * Handle wake word detection (Scenario 1)
   */
  private handleWakeWord(): void {
    if (this.state === "conversation") {
      // Already in conversation, ignore wake word
      return
    }

    console.log("[ConversationManager] 🎤 Wake word detected - entering conversation mode")
    this.enterConversationMode("wake_word")
  }

  /**
   * Start conversation after callout (Scenario 2)
   * Called by ProductivityMonitor after sending a callout
   */
  public startCalloutConversation(activities: QwenActivitySummary[]): void {
    console.log("[ConversationManager] 🎤 Auto-listen mode activated after callout")
    this.recentActivities = activities
    this.enterConversationMode("callout_auto_listen")
  }

  /**
   * Enter conversation mode
   */
  private enterConversationMode(mode: ConversationMode): void {
    this.state = "conversation"
    this.mode = mode
    this.exchangeCount = 0
    this.accumulatedTranscript = ""
    this.sttClient.clearTranscript()
    
    // Set timeout for user response
    this.setResponseTimeout()
    
    // Notify UI
    this.notifyStateChange()
    
    console.log(`[ConversationManager] Entered conversation mode: ${mode}`)
  }

  /**
   * Exit conversation mode and return to monitoring
   */
  private exitConversationMode(): void {
    this.state = "monitoring"
    this.mode = null
    this.conversationHistory = []
    this.exchangeCount = 0
    this.accumulatedTranscript = ""
    this.recentActivities = []
    this.isProcessingResponse = false // Ensure flag is cleared
    this.isPlaybackActive = false // Ensure playback flag is cleared
    this.clearResponseTimeout()
    
    // Reset conversation memory for next session
    this.memoryManager.reset()
    console.log("[ConversationManager] 🧠 Conversation memory reset")
    
    // Clear audio buffer to prevent processing stale audio
    this.sttClient.clearTranscript()
    
    // Notify UI
    this.notifyStateChange()
    
    console.log("[ConversationManager] Exited conversation mode - back to monitoring")
  }

  /**
   * Handle partial transcript (real-time)
   */
  private handlePartialTranscript(text: string): void {
    if (this.state !== "conversation") return

    // Send to UI for visual feedback (optional)
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("transcription:partial", text)
    }
  }

  /**
   * Handle final transcript (user finished speaking)
   */
  private async handleFinalTranscript(text: string): Promise<void> {
    console.log(`[ConversationManager] 📝 RECEIVED TRANSCRIPT FROM WHISPER: "${text}"`)
    console.log(`[ConversationManager] 📊 State check: state="${this.state}", isProcessing=${this.isProcessingResponse}`)
    
    // FILTER OUT BLANK/NOISE AUDIO - don't respond to silence or very short noise
    // Lowered threshold to 3 chars to allow short responses like "yes", "no", "ok"
    if (text === "[BLANK_AUDIO]" || text.trim().length < 3) {
      console.log(`[ConversationManager] ⏭️  SKIPPING - Blank audio or too short (length: ${text.trim().length})`)
      return
    }
    
    // Echo cooldown DISABLED: isPlaybackActive now properly blocks audio during playback
    // Users can respond immediately after Goggins finishes speaking
    // (Previously blocked for 5 seconds, causing conversation to fail)
    const timeSinceLastResponse = Date.now() - this.lastResponseTime
    if (this.ECHO_COOLDOWN_MS > 0 && timeSinceLastResponse < this.ECHO_COOLDOWN_MS) {
      console.log(`[ConversationManager] ⏭️  SKIPPING - Within echo cooldown period (${timeSinceLastResponse}ms < ${this.ECHO_COOLDOWN_MS}ms)`)
      return
    }
    
    // CRITICAL: Skip if already processing a response - prevents overlapping responses
    if (this.isProcessingResponse) {
      console.log(`[ConversationManager] ⏭️  SKIPPING - Already processing response (isProcessing=${this.isProcessingResponse})`)
      return
    }
    
    // Skip if in responding state - Goggins is speaking, ignore new transcripts
    if (this.state === "responding") {
      console.log(`[ConversationManager] ⏭️  SKIPPING - Goggins is responding (state="${this.state}"), ignoring transcript`)
      return
    }
    
    // If we're in monitoring mode and get a transcript, automatically enter conversation mode
    // This makes voice input work immediately without needing wake words
    if (this.state === "monitoring") {
      console.log(`[ConversationManager] 🎤 Auto-entering conversation mode on transcript detection`)
      this.enterConversationMode("auto_detect")
    }
    
    // Ensure we're in conversation mode before handling transcript
    if (this.state !== "conversation") {
      console.log(`[ConversationManager] ⚠️  Warning: Not in conversation mode (state="${this.state}"), but will try to process anyway`)
    }

    // Clear response timeout since user spoke
    this.clearResponseTimeout()

    // Accumulate transcript
    this.accumulatedTranscript += (this.accumulatedTranscript ? " " : "") + text
    
    console.log(`[ConversationManager] 💬 USER SAID: "${this.accumulatedTranscript}"`)
    console.log(`[ConversationManager] 🚀 TRIGGERING GOGGINS RESPONSE (same flow as text input)`)

    // Update conversation memory with user's message and activities
    this.memoryManager.updateFromUserMessage(this.accumulatedTranscript, this.recentActivities)
    const memory = this.memoryManager.getMemory()
    console.log(`[ConversationManager] 🧠 Memory updated - Mood: ${memory.userMood}, Goal shared: ${memory.userHasSharedGoal}`)

    // Add to conversation history
    const userMessage: ConversationMessage = {
      role: "user",
      text: this.accumulatedTranscript,
      timestamp: new Date().toISOString()
    }
    this.conversationHistory.push(userMessage)

    // Process response - THIS IS THE SAME AS TEXT INPUT BUT USES generateConversationalResponse
    console.log(`[ConversationManager] 🤖 Calling generateAndSpeakResponse()...`)
    await this.generateAndSpeakResponse()

    // Clear accumulated transcript
    this.accumulatedTranscript = ""
    console.log(`[ConversationManager] ✅ Transcript processing complete`)
  }

  /**
   * Generate response from Goggins and speak it
   */
  private async generateAndSpeakResponse(): Promise<void> {
    // CRITICAL LOCK: Prevent multiple simultaneous responses
    if (this.isProcessingResponse) {
      console.log(`[ConversationManager] ⚠️  generateAndSpeakResponse() called while already processing - IGNORING`)
      return
    }

    // Set processing flag IMMEDIATELY to prevent overlapping calls
    this.isProcessingResponse = true
    this.state = "responding"
    
    // Clear Whisper audio buffer to prevent echo from Goggins' own voice
    console.log(`[ConversationManager] 🧹 Clearing audio buffer to prevent echo...`)
    this.sttClient.clearTranscript()
    
    this.notifyStateChange()

    try {
      // Increment exchange count
      this.exchangeCount++
      const shouldEnd = this.exchangeCount >= config.conversationAutoEndExchanges

      console.log(`[ConversationManager] 🤖 Generating response (exchange ${this.exchangeCount}/${config.conversationAutoEndExchanges})`)
      console.log(`[ConversationManager] 📋 Conversation history: ${this.conversationHistory.length} messages`)
      console.log(`[ConversationManager] 📋 Recent activities: ${this.recentActivities.length} activities`)

      // Get conversation memory for adaptive response
      const memory = this.memoryManager.getMemory()
      console.log(`[ConversationManager] 🧠 Using memory - Mood: ${memory.userMood}, Exchange: ${memory.totalExchanges}`)

      // CONVERSATION FLOW LOGGING - helps debug awkward responses
      console.log(`[ConversationManager] 🔄 CONVERSATION FLOW:`)
      const lastGoggins = this.conversationHistory.length >= 2 && this.conversationHistory[this.conversationHistory.length - 2]?.role === "goggins"
        ? this.conversationHistory[this.conversationHistory.length - 2].text
        : null
      const lastUser = this.conversationHistory[this.conversationHistory.length - 1]?.text || "N/A"
      console.log(`[ConversationManager]   Last Goggins: "${lastGoggins?.substring(0, 80) || 'N/A'}"`)
      console.log(`[ConversationManager]   User replied: "${lastUser.substring(0, 80)}"`)
      console.log(`[ConversationManager]   Now generating Goggins response...`)

      // Generate conversational response with memory
      const response = await this.llmHelper.generateConversationalResponse(
        this.conversationHistory,
        this.recentActivities,
        shouldEnd,
        memory
      )

      console.log(`[ConversationManager] ✅ LLM response received: "${response.text.substring(0, 50)}${response.text.length > 50 ? '...' : ''}"`)

      // Add to conversation history
      const gogginsMessage: ConversationMessage = {
        role: "goggins",
        text: response.text,
        timestamp: response.timestamp
      }
      this.conversationHistory.push(gogginsMessage)

      // Update memory with Goggins' response for better conversational continuity
      this.memoryManager.updateFromGogginsMessage(response.text)
      console.log(`[ConversationManager] 🧠 Memory updated with Goggins' response`)

      // Generate TTS and send to UI
      await this.speakResponse(response.text)

      // Check if conversation should end
      if (shouldEnd) {
        console.log("[ConversationManager] Conversation auto-ending after max exchanges")
        this.isProcessingResponse = false // Clear flag before exiting
        this.exitConversationMode()
      } else {
        // Wait for next user response - clear flag BEFORE changing state
        // This prevents race conditions where new transcripts arrive during state transition
        this.isProcessingResponse = false
        this.state = "conversation"
        this.setResponseTimeout()
        this.notifyStateChange()
        console.log(`[ConversationManager] ✅ Ready for next user input (processing=${this.isProcessingResponse})`)
      }

    } catch (error) {
      console.error("[ConversationManager] Error generating response:", error)
      this.isProcessingResponse = false
      this.exitConversationMode()
    } finally {
      // Safety net: ensure flag is cleared even if something unexpected happens
      // Only clear if we're not in monitoring mode (which would have already cleared it)
      if (this.state === "responding" && this.isProcessingResponse) {
        console.warn(`[ConversationManager] ⚠️  Safety net: Clearing stuck processing flag`)
      this.isProcessingResponse = false
      }
    }
  }

  /**
   * Speak response using TTS
   */
  private async speakResponse(text: string): Promise<void> {
    if (!this.llmHelper.hasTTS() || !this.mainWindow || this.mainWindow.isDestroyed()) {
      console.log("[ConversationManager] TTS not available or no window")
      return
    }

    try {
      console.log(`[ConversationManager] 🎤 Generating TTS audio for: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`)
      const audioPath = await this.llmHelper.generateGogginsVoice(text)
      
      if (audioPath) {
        console.log(`[ConversationManager] ✅ TTS audio generated at: ${audioPath}`)
        const fs = await import("fs")
        const audioBuffer = fs.readFileSync(audioPath)
        const base64Audio = audioBuffer.toString("base64")
        const audioDataUrl = `data:audio/mp3;base64,${base64Audio}`

        console.log(`[ConversationManager] 📤 Sending conversation:speak event to UI...`)
        // Send to renderer to play
        this.mainWindow.webContents.send("conversation:speak", {
          text: text,
          audioPath: audioDataUrl,
          timestamp: new Date().toISOString()
        })
        console.log(`[ConversationManager] ✅ conversation:speak event sent to UI`)
        
        // Update last response time for tracking (echo cooldown disabled)
        this.lastResponseTime = Date.now()
        if (this.ECHO_COOLDOWN_MS > 0) {
          console.log(`[ConversationManager] 🔇 Echo cooldown activated for ${this.ECHO_COOLDOWN_MS}ms`)
        } else {
          console.log(`[ConversationManager] ✅ Response sent - user can respond immediately (no cooldown)`)
        }
      } else {
        console.warn(`[ConversationManager] ⚠️  TTS audio path is null - no audio generated`)
      }
    } catch (error) {
      console.error("[ConversationManager] ✗ Error speaking response:", error)
      if (error instanceof Error) {
        console.error("[ConversationManager]   Error message:", error.message)
        console.error("[ConversationManager]   Error stack:", error.stack)
      }
    }
  }

  /**
   * Handle user speaking detection (VAD)
   */
  private handleUserSpeaking(isSpeaking: boolean): void {
    if (isSpeaking && this.state === "responding") {
      // User interrupted - stop audio immediately
      console.log("[ConversationManager] 🛑 User interrupted - stopping audio")
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("audio:stop-immediately")
      }
      
      // Switch to conversation mode to listen
      this.state = "conversation"
      this.notifyStateChange()
    }
  }

  /**
   * Set timeout for user response
   */
  private setResponseTimeout(): void {
    this.clearResponseTimeout()
    
    this.responseTimeoutHandle = setTimeout(() => {
      console.log("[ConversationManager] ⏱️  Response timeout - user didn't respond in time, exiting conversation")
      // Don't exit immediately - give a bit more time for pending transcripts
      setTimeout(() => {
        if (this.state !== "monitoring") {
          console.log("[ConversationManager] Final timeout - exiting conversation mode")
          this.exitConversationMode()
        }
      }, 2000) // Extra 2 seconds for pending transcripts
    }, config.conversationResponseTimeout)
  }

  /**
   * Clear response timeout
   */
  private clearResponseTimeout(): void {
    if (this.responseTimeoutHandle) {
      clearTimeout(this.responseTimeoutHandle)
      this.responseTimeoutHandle = null
    }
  }

  /**
   * Notify UI of state change
   */
  private notifyStateChange(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    this.mainWindow.webContents.send("conversation:state-changed", {
      state: this.state,
      mode: this.mode,
      exchangeCount: this.exchangeCount,
      isListening: this.sttClient.getStatus().connected
    })
  }

  /**
   * Stream audio data manually (for testing only - normally mic streams automatically)
   * NOTE: Not needed in production - microphone streams automatically
   */
  public streamAudio(audioBuffer: Buffer): void {
    this.sttClient.streamAudio(audioBuffer)
  }

  /**
   * Get current state
   */
  public getState(): ConversationState {
    return this.state
  }

  /**
   * Get current voice status (Whisper/STT-based)
   */
  public getVoiceStatus(): VoiceStatus {
    const sttStatus = this.sttClient.getStatus()
    return {
      isListening: sttStatus.connected,
      conversationState: this.state,
      exchangeCount: this.exchangeCount,
      sttConnected: sttStatus.connected
    }
  }

  /**
   * Get conversation history
   */
  public getHistory(): ConversationMessage[] {
    return [...this.conversationHistory]
  }

  /**
   * Update activity context
   */
  public updateActivityContext(activities: QwenActivitySummary[]): void {
    this.recentActivities = activities
  }

  /**
   * Set main window
   */
  public setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }
}

