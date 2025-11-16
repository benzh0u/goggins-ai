export interface ChatMessage {
  role: "user" | "goggins"
  text: string
  timestamp: string
}

export class ChatHistory {
  private messages: ChatMessage[] = []
  private lastResponseTime: number = 0
  private lastUserInitiatedTime: number = 0
  private lastAnyMessageTime: number = 0
  private readonly maxMessages: number = 50

  public addMessage(msg: ChatMessage): void {
    this.messages.push(msg)
    
    // Update last response time if it's a Goggins message
    if (msg.role === "goggins") {
      this.lastResponseTime = Date.now()
    }
    
    // Update last user initiated time if it's a user message
    if (msg.role === "user") {
      this.lastUserInitiatedTime = Date.now()
    }
    
    // Update last any message time for any message
    this.lastAnyMessageTime = Date.now()
    
    // Keep only the most recent messages
    if (this.messages.length > this.maxMessages) {
      this.messages.shift()
    }
  }

  public getRecentMessages(limit?: number): ChatMessage[] {
    const messages = [...this.messages] // Return a copy
    if (limit) {
      return messages.slice(-limit)
    }
    return messages
  }

  public getAll(): ChatMessage[] {
    return [...this.messages]
  }

  public canRespondNow(cooldownMs: number, isUserInitiated: boolean = false): boolean {
    // User-initiated messages always bypass cooldown
    if (isUserInitiated) {
      return true
    }
    const timeSinceLastResponse = Date.now() - this.lastResponseTime
    return timeSinceLastResponse >= cooldownMs
  }

  public getTimeSinceLastMessage(): number {
    return Date.now() - this.lastAnyMessageTime
  }

  public canSendProactiveMessage(cooldownMin: number, cooldownMax: number, escalationLevel: number): boolean {
    const timeSinceLastResponse = Date.now() - this.lastResponseTime
    
    // Calculate dynamic cooldown based on escalation level
    // Higher escalation = shorter cooldown (more frequent messages)
    const escalationFactor = Math.max(0, Math.min(1, escalationLevel / 2)) // 0 to 1
    const dynamicCooldown = cooldownMin + (cooldownMax - cooldownMin) * (1 - escalationFactor)
    
    return timeSinceLastResponse >= dynamicCooldown
  }

  public getLastUserInitiatedTime(): number {
    return this.lastUserInitiatedTime
  }

  public clear(): void {
    this.messages = []
    this.lastResponseTime = 0
    this.lastUserInitiatedTime = 0
    this.lastAnyMessageTime = 0
  }
}

