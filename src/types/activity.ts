export type QwenActivitySummary = {
  timestamp: string
  primaryActivity: string
  appGuess?: string
  taskType: "work" | "study" | "entertainment" | "social" | "other"
  details?: string
}

export type InterventionScore = {
  score: number // 0-10
  reasoning?: string
}

export type CoachMessage = {
  timestamp: string
  text: string
  score: number
  audioPath?: string
}

// Conversation types for voice interaction
export type ConversationState = "monitoring" | "conversation" | "responding"

export type ConversationMode = "wake_word" | "callout_auto_listen" | "auto_detect"

export type ConversationMessage = {
  role: "user" | "goggins"
  text: string
  timestamp: string
}

export type VoiceStatus = {
  isListening: boolean
  conversationState: ConversationState
  exchangeCount: number
  sttConnected?: boolean // Whether Whisper/STT is actually connected
}

export type TranscriptEvent = {
  type: "partial" | "final"
  text: string
  timestamp: number
}

// Conversation memory types for adaptive coaching
export type UserMood = 
  | "grinding" 
  | "struggling" 
  | "making-excuses" 
  | "distracted" 
  | "defeated" 
  | "motivated"

export type CoachApproach = 
  | "tough-love" 
  | "encouraging" 
  | "questioning" 
  | "storytelling" 
  | "calling-out"

export type ConversationMemory = {
  // What the user is working on
  currentGoal?: string
  currentTask?: string
  deadline?: string
  
  // Emotional/situational state
  userMood: UserMood
  recentTopic?: string
  
  // Goggins' approach
  lastApproach: CoachApproach
  
  // Session tracking
  sessionStartTime: number
  totalExchanges: number
  userHasSharedGoal: boolean
}

