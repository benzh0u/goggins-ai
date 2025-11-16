import { QwenActivitySummary } from "../src/types/activity"

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

export interface ConversationMemory {
  // What the user is working on
  currentGoal?: string
  currentTask?: string
  deadline?: string
  
  // Emotional/situational state
  userMood: UserMood
  recentTopic?: string
  
  // Goggins' approach
  lastApproach: CoachApproach
  lastGogginsMessage?: string  // Track last thing Goggins said for conversation flow
  
  // Session tracking
  sessionStartTime: number
  totalExchanges: number
  userHasSharedGoal: boolean
}

export class ConversationMemoryManager {
  private memory: ConversationMemory = {
    userMood: "distracted",
    lastApproach: "calling-out",
    sessionStartTime: Date.now(),
    totalExchanges: 0,
    userHasSharedGoal: false
  }

  /**
   * Update memory based on user's message and recent activities
   */
  public updateFromUserMessage(message: string, activities: QwenActivitySummary[]): void {
    this.memory.totalExchanges++
    
    // Detect user mood from their message
    const lowerMsg = message.toLowerCase()
    
    // Detect defeated mood
    if (lowerMsg.match(/can't|too hard|impossible|give up|quit/)) {
      this.memory.userMood = "defeated"
    } 
    // Detect grinding mood
    else if (lowerMsg.match(/trying|working on|focusing|getting it done|pushing through/)) {
      this.memory.userMood = "grinding"
    } 
    // Detect excuse-making
    else if (lowerMsg.match(/but |however |just one|need a break|tired|maybe later/)) {
      this.memory.userMood = "making-excuses"
    } 
    // Detect struggling
    else if (lowerMsg.match(/stuck|confused|don't know|not sure|help/)) {
      this.memory.userMood = "struggling"
    }
    // Detect motivated
    else if (lowerMsg.match(/let's go|ready|motivated|pumped|excited/)) {
      this.memory.userMood = "motivated"
    }
    
    // Extract goal if mentioned - MUCH broader detection
    if (lowerMsg.match(/goal|working on|trying to|need to|finish|complete|build|create|write|code|project|deadline|task|assignment|report|want to|plan to|going to/)) {
      this.memory.userHasSharedGoal = true
      
      // Extract goal more aggressively
      if (lowerMsg.includes('goal')) {
        // Extract everything after "goal is" or "goal:"
        const goalMatch = message.match(/goal\s+(?:is\s+)?(?:to\s+)?(.+?)(?:\.|$)/i)
        if (goalMatch) {
          this.memory.currentGoal = goalMatch[1].trim()
          this.memory.currentTask = goalMatch[1].trim()
        }
      } else {
        // Extract the whole message as context
        this.memory.currentTask = message.substring(0, 150).trim()
      }
      
      console.log(`[ConversationMemory] 🎯 Goal detected: "${this.memory.currentTask || this.memory.currentGoal}"`)
    }
    
    // Extract deadline if mentioned
    if (lowerMsg.match(/by \d|deadline|due|tomorrow|today|tonight|this week/)) {
      const deadlineMatch = message.match(/(by \d+[ap]m|deadline [^.!?]+|due [^.!?]+|tomorrow|today|tonight|this week)/i)
      if (deadlineMatch) {
        this.memory.deadline = deadlineMatch[0]
      }
    }
    
    // Analyze activities to refine mood detection
    if (activities.length > 0) {
      const workActivities = activities.filter(a => a.taskType === "work" || a.taskType === "study")
      const workRatio = workActivities.length / activities.length
      
      // If user says they're working but activities show distraction, keep it real
      if (this.memory.userMood === "grinding" && workRatio < 0.3) {
        this.memory.userMood = "making-excuses"
      }
      
      // If activities show real work and user hasn't been detected as other moods, they're grinding
      if (workRatio >= 0.7 && this.memory.userMood === "distracted") {
        this.memory.userMood = "grinding"
      }
      
      // Store most recent activity as topic if it's not generic
      const latestActivity = activities[activities.length - 1]
      if (latestActivity && latestActivity.primaryActivity !== "Unknown") {
        this.memory.recentTopic = latestActivity.primaryActivity
      }
    }
  }

  /**
   * Get current memory state (returns a copy)
   */
  public getMemory(): ConversationMemory {
    return { ...this.memory }
  }

  /**
   * Update Goggins' last approach
   */
  public updateApproach(approach: CoachApproach): void {
    this.memory.lastApproach = approach
  }

  /**
   * Update with Goggins' last message for conversational continuity
   */
  public updateFromGogginsMessage(text: string): void {
    this.memory.lastGogginsMessage = text.substring(0, 150) // Store last response (truncated)
  }

  /**
   * Reset memory for new conversation
   */
  public reset(): void {
    this.memory = {
      userMood: "distracted",
      lastApproach: "calling-out",
      sessionStartTime: Date.now(),
      totalExchanges: 0,
      userHasSharedGoal: false
    }
    console.log("[ConversationMemory] Memory reset for new conversation")
  }

  /**
   * Get session duration in minutes
   */
  public getSessionDurationMinutes(): number {
    return Math.floor((Date.now() - this.memory.sessionStartTime) / 60000)
  }
}

