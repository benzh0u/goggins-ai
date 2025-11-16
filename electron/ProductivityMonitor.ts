import { BrowserWindow } from "electron"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { QwenClient } from "./QwenClient"
import { OpenAIVisionClient } from "./OpenAIVisionClient"
import { LlamaClient } from "./LlamaClient"
import { ActivityLog } from "./ActivityLog"
import { CoachHistory } from "./CoachHistory"
import { ChatHistory, ChatMessage } from "./ChatHistory"
import { config } from "./config"
import { QwenActivitySummary, CoachMessage } from "../src/types/activity"
import { LLMHelper } from "./LLMHelper"
import { ConversationManager } from "./ConversationManager"
import fs from "fs"

export class ProductivityMonitor {
  private isEnabled: boolean = false
  private screenshotInterval: NodeJS.Timeout | null = null
  private activityLog: ActivityLog
  private coachHistory: CoachHistory
  private chatHistory: ChatHistory
  private visionClient: QwenClient | OpenAIVisionClient
  private llamaClient: LlamaClient
  private screenshotHelper: ScreenshotHelper
  private mainWindow: BrowserWindow | null = null
  private isAnalyzing: boolean = false
  private ttsHelper: LLMHelper | null = null
  private conversationManager: ConversationManager | null = null
  // State tracking for natural response rules
  private lowProductivityStartTime: number = 0
  private lastProactiveMessageTime: number = 0
  private lastCheckInTime: number = 0
  private previousScore: number = 0
  private previousTaskType: string = "other"
  private proactiveEscalationLevel: number = 0
  private lastAnyMessageTime: number = 0
  private lastCalledOutApp: string = "" // Track last app that was called out to prevent repeated callouts

  constructor(mainWindow: BrowserWindow | null, ttsHelper?: LLMHelper | null) {
    this.mainWindow = mainWindow
    this.activityLog = new ActivityLog()
    this.coachHistory = new CoachHistory()
    this.chatHistory = new ChatHistory()
    
    // Choose vision client based on config
    if (config.useOpenAIVision && config.openaiApiKey) {
      console.log("[ProductivityMonitor] Using OpenAI Vision (GPT-4o-mini) for screenshot analysis")
      this.visionClient = new OpenAIVisionClient()
    } else {
      console.log("[ProductivityMonitor] Using Ollama/Llava for screenshot analysis (local)")
      this.visionClient = new QwenClient()
    }
    
    this.llamaClient = new LlamaClient()
    this.screenshotHelper = new ScreenshotHelper("queue")
    this.ttsHelper = ttsHelper ?? null
    
    // Initialize conversation manager if TTS is available
    console.log("[ProductivityMonitor] Checking voice listening prerequisites...")
    console.log(`[ProductivityMonitor]   TTS Helper available: ${this.ttsHelper ? 'YES' : 'NO'}`)
    console.log(`[ProductivityMonitor]   Voice listening enabled: ${config.voiceListeningEnabled}`)
    console.log(`[ProductivityMonitor]   TTS API Key: ${config.ttsApiKey ? 'SET' : 'MISSING'}`)
    
    if (this.ttsHelper && config.voiceListeningEnabled) {
      console.log("[ProductivityMonitor] ✓ Creating ConversationManager...")
      this.conversationManager = new ConversationManager(this.ttsHelper, mainWindow)
      console.log("[ProductivityMonitor] ✓ ConversationManager created")
    } else {
      if (!this.ttsHelper) {
        console.warn("[ProductivityMonitor] ⚠️  ConversationManager NOT created: TTS Helper is null")
        console.warn("[ProductivityMonitor]     This happens if enableTTS=false or ELEVENLABS_API_KEY/VOICE_ID not set")
      }
      if (!config.voiceListeningEnabled) {
        console.warn("[ProductivityMonitor] ⚠️  ConversationManager NOT created: voiceListeningEnabled=false")
      }
    }
  }

  public setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
    if (this.conversationManager) {
      this.conversationManager.setMainWindow(window)
    }
  }

  public async start(): Promise<void> {
    if (this.isEnabled) {
      console.log("[ProductivityMonitor] Already running")
      return
    }

    this.isEnabled = true
    console.log("[ProductivityMonitor] Starting productivity monitoring...")

    // Start conversation manager for voice listening
    if (this.conversationManager) {
      console.log("[ProductivityMonitor] Starting ConversationManager...")
      try {
        await this.conversationManager.start()
        console.log("[ProductivityMonitor] ✓ Voice listening enabled and started")
      } catch (error) {
        console.error("[ProductivityMonitor] ✗ Failed to start voice listening:", error)
        if (error instanceof Error) {
          console.error("[ProductivityMonitor]   Error message:", error.message)
          console.error("[ProductivityMonitor]   Error stack:", error.stack)
        }
        // Don't throw - continue with productivity monitoring even if voice fails
      }
    } else {
      console.warn("[ProductivityMonitor] ⚠️  ConversationManager is null - voice listening will NOT be available")
      console.warn("[ProductivityMonitor]     Check if TTS is enabled and voiceListeningEnabled=true")
    }

    // Start screenshot interval
    this.screenshotInterval = setInterval(() => {
      this.captureAndAnalyze()
    }, config.screenshotInterval)
  }

  public stop(): void {
    if (!this.isEnabled) {
      return
    }

    this.isEnabled = false
    console.log("[ProductivityMonitor] Stopping productivity monitoring...")

    // Stop conversation manager
    if (this.conversationManager) {
      this.conversationManager.stop()
      console.log("[ProductivityMonitor] Voice listening stopped")
    }

    if (this.screenshotInterval) {
      clearInterval(this.screenshotInterval)
      this.screenshotInterval = null
    }
  }

  public getIsEnabled(): boolean {
    return this.isEnabled
  }

  public getLatestActivity(): QwenActivitySummary | null {
    return this.activityLog.getLatest()
  }

  public getLatestCoachMessage(): CoachMessage | null {
    return this.coachHistory.getLatest()
  }

  public getChatHistory(): ChatMessage[] {
    return this.chatHistory.getAll()
  }

  public addChatMessage(message: ChatMessage): void {
    this.chatHistory.addMessage(message)
  }

  public getRecentActivities(seconds: number = 60): QwenActivitySummary[] {
    return this.activityLog.getEntriesSince(seconds * 1000)
  }

  public async isUserProductiveNow(): Promise<boolean> {
    try {
      const lastMinute = this.activityLog.getEntriesSince(60000)
      if (lastMinute.length === 0) {
        // No activity data, assume productive
        return true
      }

      const scoreResult = await this.llamaClient.scoreActivity(lastMinute)
      // User is productive if score is below threshold
      return scoreResult.score <= config.interventionThreshold
    } catch (error) {
      console.error("[ProductivityMonitor] Error checking productivity:", error)
      // On error, assume productive (no cooldown)
      return true
    }
  }

  public canChatRespondNow(): boolean {
    // Check if 30 second cooldown applies
    // Cooldown only applies if user is not productive
    // We'll check productivity in the IPC handler
    return this.chatHistory.canRespondNow(30000) // 30 seconds
  }

  public async generateChatResponse(userMessage: string): Promise<{ text: string; timestamp: string }> {
    // Get activity context (last 60 seconds)
    const activities = this.getRecentActivities(60)
    
    // Get chat history
    const chatHistory = this.chatHistory.getAll()
    
    // Generate response with context
    const response = await this.llamaClient.chatWithUser(
      userMessage,
      activities,
      chatHistory.map(msg => ({
        role: msg.role,
        text: msg.text,
        timestamp: msg.timestamp
      }))
    )

    return response
  }

  // Natural pause logic
  public canSendAnyMessage(): boolean {
    const timeSinceLastMessage = this.chatHistory.getTimeSinceLastMessage()
    return timeSinceLastMessage >= config.naturalPauseMs
  }

  // Proactive response logic
  public shouldTriggerProactiveMessage(currentScore: number): boolean {
    const isLowProductivity = currentScore > config.interventionThreshold
    
    if (isLowProductivity) {
      // Start tracking low productivity if not already tracking
      if (this.lowProductivityStartTime === 0) {
        this.lowProductivityStartTime = Date.now()
      }
      
      // Check if low productivity has persisted for trigger duration
      const lowProductivityDuration = Date.now() - this.lowProductivityStartTime
      if (lowProductivityDuration >= config.proactiveTriggerDuration) {
        // Check if cooldown has passed
        return this.chatHistory.canSendProactiveMessage(
          config.proactiveCooldownMin,
          config.proactiveCooldownMax,
          this.proactiveEscalationLevel
        )
      }
    } else {
      // Reset tracking if productivity is good
      this.lowProductivityStartTime = 0
      this.proactiveEscalationLevel = 0
    }
    
    return false
  }

  public calculateProactiveCooldown(): number {
    const escalationFactor = Math.max(0, Math.min(1, this.proactiveEscalationLevel / 2))
    return config.proactiveCooldownMin + (config.proactiveCooldownMax - config.proactiveCooldownMin) * (1 - escalationFactor)
  }

  public updateEscalationLevel(currentScore: number): void {
    const isLowProductivity = currentScore > config.interventionThreshold
    
    if (isLowProductivity && this.lowProductivityStartTime > 0) {
      const lowProductivityDuration = Date.now() - this.lowProductivityStartTime
      
      // Escalate based on duration of low productivity
      if (lowProductivityDuration >= 600000) { // 10 minutes
        this.proactiveEscalationLevel = 2 // Highly escalated
      } else if (lowProductivityDuration >= 300000) { // 5 minutes
        this.proactiveEscalationLevel = 1 // Escalated
      } else {
        this.proactiveEscalationLevel = 0 // Normal
      }
    } else {
      this.proactiveEscalationLevel = 0
    }
  }

  // Celebration response logic
  public shouldTriggerCelebration(previousScore: number, currentScore: number, currentTaskType: string): boolean {
    // Must meet BOTH conditions to celebrate:
    // 1. Score improved significantly (dropped below threshold)
    const scoreImproved = previousScore > config.celebrationThreshold && currentScore <= config.celebrationThreshold
    
    // 2. Activity type changed from distraction to productive work
    const wasDistracted = this.previousTaskType === "entertainment" || this.previousTaskType === "social"
    const nowProductive = currentTaskType === "work" || currentTaskType === "study"
    const activityImproved = wasDistracted && nowProductive
    
    // Only celebrate if BOTH score improved AND activity actually changed
    return scoreImproved && activityImproved
  }

  public async generateCelebrationMessage(): Promise<{ text: string; timestamp: string }> {
    const activities = this.getRecentActivities(60)
    const chatHistory = this.chatHistory.getAll()
    
    return await this.llamaClient.generateCelebrationMessage(
      activities,
      chatHistory.map(msg => ({
        role: msg.role,
        text: msg.text,
        timestamp: msg.timestamp
      }))
    )
  }

  // Check-in logic
  public shouldTriggerCheckIn(currentScore: number): boolean {
    const isLowProductivity = currentScore > config.interventionThreshold
    
    if (!isLowProductivity) {
      return false
    }
    
    // Check if check-in interval has passed
    const timeSinceLastCheckIn = Date.now() - this.lastCheckInTime
    const checkInInterval = config.checkInIntervalMin + Math.random() * (config.checkInIntervalMax - config.checkInIntervalMin)
    
    return timeSinceLastCheckIn >= checkInInterval
  }

  public async generateCheckInMessage(): Promise<{ text: string; timestamp: string }> {
    const activities = this.getRecentActivities(60)
    const chatHistory = this.chatHistory.getAll()
    
    return await this.llamaClient.generateCheckInMessage(
      activities,
      chatHistory.map(msg => ({
        role: msg.role,
        text: msg.text,
        timestamp: msg.timestamp
      }))
    )
  }

  // Helper method to send message to chat UI
  private async sendMessageToChat(message: { text: string; timestamp: string }, messageType: string = "goggins"): Promise<void> {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return
    }

    // Add to chat history
    const chatMessage: ChatMessage = {
      role: "goggins",
      text: message.text,
      timestamp: message.timestamp
    }
    this.chatHistory.addMessage(chatMessage)
    this.lastAnyMessageTime = Date.now()

    // Generate TTS audio if enabled
    let audioDataUrl: string | undefined
    if (config.enableTTS && this.ttsHelper?.hasTTS()) {
      try {
        console.log(`[ProductivityMonitor] 🎤 Generating TTS for ${messageType} message...`)
        const audioPath = await this.ttsHelper.generateGogginsVoice(message.text) ?? undefined
        if (audioPath && fs.existsSync(audioPath)) {
          const audioBuffer = fs.readFileSync(audioPath)
          const base64Audio = audioBuffer.toString('base64')
          audioDataUrl = `data:audio/mp3;base64,${base64Audio}`
          console.log(`[ProductivityMonitor] ✓ TTS audio generated for ${messageType}`)
        }
      } catch (ttsError) {
        console.error(`[ProductivityMonitor] ✗ Failed to generate TTS for ${messageType}:`, ttsError)
      }
    }

    // Create message payload compatible with CoachMessage format
    const messagePayload: CoachMessage = {
      timestamp: message.timestamp,
      text: message.text,
      score: 0, // Default score for proactive/celebration/check-in messages
      audioPath: audioDataUrl
    }

    // Send to renderer (will appear in chat UI)
    this.mainWindow.webContents.send("coach:new-message", messagePayload)
    console.log(`[ProductivityMonitor] ✓ ${messageType} message sent to chat UI`)
  }

  private async captureAndAnalyze(): Promise<void> {
    if (!this.isEnabled || !this.mainWindow) {
      return
    }

    // Prevent concurrent analysis calls
    if (this.isAnalyzing) {
      return
    }

    // Skip entire pipeline if Goggins is speaking
    const isPlaybackActive = this.conversationManager?.getPlaybackActive?.() ?? false
    if (isPlaybackActive) {
      console.log("🔇 Goggins speaking - pausing screenshot collection")
      return
    }

    this.isAnalyzing = true
    const captureStartTime = Date.now()
    try {
      // 1. Take screenshot
      console.log("\n🔄 ============ PIPELINE START ============")
      console.log("📸 [1/6] Taking screenshot...")
      const screenshotPath = await this.screenshotHelper.takeScreenshot(
        () => {}, // No-op: don't hide window
        () => {}  // No-op: don't show window
      )
      console.log(`✓ Screenshot saved (${Date.now() - captureStartTime}ms)`)

      // 2. Analyze with vision model (OpenAI or Llava)
      const visionModel = config.useOpenAIVision ? "GPT-4o-mini" : "Llava"
      console.log(`🤖 [2/6] Analyzing with ${visionModel}...`)
      const analysisStartTime = Date.now()
      const summary = await this.visionClient.analyzeScreenshot(screenshotPath)
      console.log(`✓ ${visionModel} analysis: "${summary.primaryActivity}" (${Date.now() - analysisStartTime}ms)`)
      
      // Add to activity log
      this.activityLog.addEntry(summary)

      // Get last 60 seconds of activities
      const lastMinute = this.activityLog.getEntriesSince(60000)

      if (lastMinute.length === 0) {
        console.log("⏭️  No activities to score yet\n")
        return
      }

      // 3. Pass context to GPT for scoring
      console.log("🧠 [3/6] Passing context to GPT for scoring...")
      const scoreStartTime = Date.now()
      const scoreResult = await this.llamaClient.scoreActivity(lastMinute)
      const currentScore = scoreResult.score
      const aboveThreshold = currentScore > config.interventionThreshold
      console.log(`✓ GPT Score: ${currentScore}/10 ${aboveThreshold ? '⚠️ ABOVE THRESHOLD' : '✓ OK'} (${Date.now() - scoreStartTime}ms)`)

      // Enforce natural pause - BUT allow high-priority (score >= 7) to bypass
      const canSendMessage = this.canSendAnyMessage()
      const isHighPriority = currentScore >= 7
      
      console.log(`[Debug] canSendMessage=${canSendMessage}, score=${currentScore}, isHighPriority=${isHighPriority}`)
      
      if (!canSendMessage && !isHighPriority) {
        console.log(`⏸️  Natural pause active - skipping (score ${currentScore} below priority threshold)\n`)
        this.previousScore = currentScore
        this.previousTaskType = summary.taskType
        return
      }
      
      if (isHighPriority && !canSendMessage) {
        console.log(`🚨 HIGH PRIORITY (score ${currentScore}/10) - bypassing natural pause!`)
      }

      // CELEBRATION TEMPORARILY DISABLED
      // 1. Check for celebration (score improvement) - send immediately if triggered
      // if (this.shouldTriggerCelebration(this.previousScore, currentScore, summary.taskType)) {
      //   console.log(`🎉 Score improved AND activity changed (${this.previousTaskType} → ${summary.taskType}) - generating celebration\n`)
      //   try {
      //     const celebrationMessage = await this.generateCelebrationMessage()
      //     await this.sendMessageToChat(celebrationMessage, "celebration")
      //     // Reset low productivity tracking on celebration
      //     this.lowProductivityStartTime = 0
      //     this.proactiveEscalationLevel = 0
      //   } catch (error) {
      //     console.error("✗ Celebration error:", error)
      //   }
      //   this.previousScore = currentScore
      //   this.previousTaskType = summary.taskType
      //   return
      // }

      // 2. Update escalation level based on current productivity
      this.updateEscalationLevel(currentScore)

      // 3. Check for proactive message (if productivity has been low for 2+ minutes)
      if (this.shouldTriggerProactiveMessage(currentScore)) {
        console.log(`🔔 Low productivity for 2+ min - proactive message\n`)
        try {
          const proactiveMessage = await this.llamaClient.generateProactiveMessage(
            lastMinute,
            this.chatHistory.getAll().map(msg => ({
              role: msg.role,
              text: msg.text,
              timestamp: msg.timestamp
            })),
            this.proactiveEscalationLevel
          )
          await this.sendMessageToChat(proactiveMessage, "proactive")
          this.lastProactiveMessageTime = Date.now()
        } catch (error) {
          console.error("✗ Proactive error:", error)
        }
        this.previousScore = currentScore
        this.previousTaskType = summary.taskType
        return
      }

      // 4. Check for periodic check-in (every 15-30 minutes during low productivity)
      if (this.shouldTriggerCheckIn(currentScore)) {
        // Don't send check-in if user is actively conversing with Goggins
        const isConversing = this.conversationManager?.getState() === "conversation" || 
                             this.conversationManager?.getState() === "responding"
        if (isConversing) {
          console.log(`⏭️  User conversing - skipping check-in\n`)
          this.previousScore = currentScore
          this.previousTaskType = summary.taskType
          return
        }
        
        console.log(`📞 Periodic check-in time\n`)
        try {
          const checkInMessage = await this.generateCheckInMessage()
          await this.sendMessageToChat(checkInMessage, "check-in")
          this.lastCheckInTime = Date.now()
        } catch (error) {
          console.error("✗ Check-in error:", error)
        }
        this.previousScore = currentScore
        this.previousTaskType = summary.taskType
        return
      }

      // 5. Immediate intervention if above threshold
      if (currentScore > config.interventionThreshold) {
        // Check if we've already called out this specific app - prevent repeated callouts
        const currentApp = summary.appGuess || summary.primaryActivity
        if (this.lastCalledOutApp === currentApp && currentApp) {
          console.log(`⏭️  Already called out "${currentApp}" - skipping repeated intervention\n`)
          this.previousScore = currentScore
          this.previousTaskType = summary.taskType
          return
        }
        
        // Track this app as called out
        this.lastCalledOutApp = currentApp
        console.log(`🚨 NEW DISTRACTION DETECTED: "${currentApp}" - calling out!`)
        
        // 4. Generate Goggins response
        console.log("💬 [4/6] Generating Goggins response from context...")
        const messageStartTime = Date.now()
        const history = this.coachHistory.getRecentMessages()
        const coachMessage = await this.llamaClient.generateCoachMessage(
          lastMinute,
          history,
          currentScore
        )
        console.log(`✓ Response: "${coachMessage.text.substring(0, 60)}..." (${Date.now() - messageStartTime}ms)`)

        let audioPath: string | undefined
        let audioDataUrl: string | undefined
        
        if (config.enableTTS && this.ttsHelper?.hasTTS()) {
          // 5. Convert text to speech
          console.log("🎤 [5/6] Converting text to speech...")
          try {
            const ttsStartTime = Date.now()
            audioPath = await this.ttsHelper.generateGogginsVoice(coachMessage.text) ?? undefined
            
            if (audioPath && fs.existsSync(audioPath)) {
              const audioBuffer = fs.readFileSync(audioPath)
              const base64Audio = audioBuffer.toString('base64')
              audioDataUrl = `data:audio/mp3;base64,${base64Audio}`
              console.log(`✓ MP3 generated (${Date.now() - ttsStartTime}ms)`)
            } else {
              console.log("✗ TTS failed - no audio")
            }
          } catch (ttsError) {
            console.error("✗ TTS error:", ttsError instanceof Error ? ttsError.message : ttsError)
          }
        } else {
          console.log("⏭️  TTS disabled - text only")
        }

        const messagePayload: CoachMessage = audioDataUrl
          ? { ...coachMessage, audioPath: audioDataUrl }
          : coachMessage

        // Add to history
        this.coachHistory.addMessage(coachMessage)
        
        // Also add to chat history for natural pause tracking
        const chatMessage: ChatMessage = {
          role: "goggins",
          text: coachMessage.text,
          timestamp: coachMessage.timestamp
        }
        this.chatHistory.addMessage(chatMessage)
        this.lastAnyMessageTime = Date.now()

        // 6. Play MP3
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          console.log(`🔊 [6/6] Playing MP3 ${audioDataUrl ? '(with audio)' : '(text only)'}`)
          this.mainWindow.webContents.send("coach:new-message", messagePayload)
          const totalTime = Date.now() - captureStartTime
          console.log(`✓ Pipeline complete (${totalTime}ms total)`)
          console.log("============ PIPELINE END ============\n")
        }

        // Auto-listen for user response
        if (this.conversationManager && config.voiceListeningEnabled) {
          this.conversationManager.startCalloutConversation(lastMinute)
        }
      } else {
        console.log(`✓ Score OK - no intervention needed\n`)
        // Reset last called out app when user is productive
        if (this.lastCalledOutApp) {
          console.log(`✓ User back on task - resetting callout tracking`)
          this.lastCalledOutApp = ""
        }
      }

      // Update previous score and task type for next iteration
      this.previousScore = currentScore
      this.previousTaskType = summary.taskType

      // Clean up screenshot file after processing (optional - can keep for debugging)
      // await fs.promises.unlink(screenshotPath).catch(() => {})
    } catch (error) {
      console.error(`\n✗ Pipeline error:`, error instanceof Error ? error.message : error)
    } finally {
      this.isAnalyzing = false
    }
  }
}

