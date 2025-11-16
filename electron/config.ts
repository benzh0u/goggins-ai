import dotenv from "dotenv"

dotenv.config()

export interface StayHardConfig {
  qwenModel: string
  llamaModel: string
  ollamaUrl: string
  screenshotInterval: number
  interventionThreshold: number
  coachCooldownMs: number
  maxScreenshotWidth: number
  maxScreenshotHeight: number
  enableTTS: boolean
  ttsApiKey?: string
  ttsVoiceId?: string
  openaiApiKey?: string
  openaiModel: string
  openaiVisionModel: string
  useOpenAIVision: boolean
  celebrationThreshold: number
  proactiveCooldownMin: number
  proactiveCooldownMax: number
  proactiveTriggerDuration: number
  checkInIntervalMin: number
  checkInIntervalMax: number
  naturalPauseMs: number
  // Voice conversation settings
  voiceListeningEnabled: boolean
  conversationAutoEndExchanges: number
  conversationResponseTimeout: number
  wakeWord: string
}

export function loadConfig(): StayHardConfig {
  return {
    qwenModel: process.env.QWEN_MODEL || "llava:7b",
    llamaModel: process.env.LLAMA_MODEL || "llama2.3:latest",
    ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
    screenshotInterval: Number(process.env.SCREENSHOT_INTERVAL) || 5000,
    interventionThreshold: Number(process.env.INTERVENTION_THRESHOLD) || 5,
    coachCooldownMs: Number(process.env.COACH_COOLDOWN_MS) || 30000,
    maxScreenshotWidth: Number(process.env.MAX_SCREENSHOT_WIDTH) || 1280,
    maxScreenshotHeight: Number(process.env.MAX_SCREENSHOT_HEIGHT) || 720,
    enableTTS: process.env.ENABLE_TTS === "true",
    ttsApiKey: process.env.ELEVENLABS_API_KEY,
    ttsVoiceId: process.env.ELEVENLABS_VOICE_ID,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    openaiVisionModel: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
    useOpenAIVision: process.env.USE_OPENAI_VISION === "true",
    celebrationThreshold: Number(process.env.CELEBRATION_THRESHOLD) || 999, // Effectively disabled
    proactiveCooldownMin: Number(process.env.PROACTIVE_COOLDOWN_MIN) || 120000,
    proactiveCooldownMax: Number(process.env.PROACTIVE_COOLDOWN_MAX) || 300000,
    proactiveTriggerDuration: Number(process.env.PROACTIVE_TRIGGER_DURATION) || 120000,
    checkInIntervalMin: Number(process.env.CHECK_IN_INTERVAL_MIN) || 900000,
    checkInIntervalMax: Number(process.env.CHECK_IN_INTERVAL_MAX) || 1800000,
    naturalPauseMs: Number(process.env.NATURAL_PAUSE_MS) || 60000, // Increased to 60 seconds - prevent spam callouts
    // Voice conversation settings
    voiceListeningEnabled: process.env.VOICE_LISTENING_ENABLED !== "false", // Default true
    conversationAutoEndExchanges: Number(process.env.CONVERSATION_AUTO_END_EXCHANGES) || 3,
    conversationResponseTimeout: Number(process.env.CONVERSATION_RESPONSE_TIMEOUT) || 30000, // Increased to 30 seconds - give user more time to respond
    wakeWord: process.env.WAKE_WORD || "hey goggins"
  }
}

export const config = loadConfig()

