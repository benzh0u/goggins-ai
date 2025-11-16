import { CoachMessage } from "../src/types/activity"
import { config } from "./config"
import path from "path"
import fs from "fs"
import { app } from "electron"

export class CoachHistory {
  private messages: CoachMessage[] = []
  private lastInterventionTime: number = 0
  private readonly maxMessages: number = 20
  private logFilePath: string

  constructor() {
    // Set up log file path
    const userDataPath = app.getPath("userData")
    const logsDir = path.join(userDataPath, "logs")
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }
    
    this.logFilePath = path.join(logsDir, "coach-log.json")
    
    // Load existing history if available
    this.loadFromFile()
  }

  public addMessage(msg: CoachMessage): void {
    this.messages.push(msg)
    this.lastInterventionTime = Date.now()
    
    // Keep only the most recent messages
    if (this.messages.length > this.maxMessages) {
      this.messages.shift()
    }
    
    // Flush to file
    this.flushToFile()
  }

  public getRecentMessages(limit?: number): CoachMessage[] {
    const messages = [...this.messages] // Return a copy
    if (limit) {
      return messages.slice(-limit)
    }
    return messages
  }

  public getLatest(): CoachMessage | null {
    return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null
  }

  public canInterveneNow(): boolean {
    const timeSinceLastIntervention = Date.now() - this.lastInterventionTime
    return timeSinceLastIntervention >= config.coachCooldownMs
  }

  public clear(): void {
    this.messages = []
    this.lastInterventionTime = 0
    this.flushToFile()
  }

  private flushToFile(): void {
    try {
      fs.writeFileSync(this.logFilePath, JSON.stringify(this.messages, null, 2), "utf-8")
    } catch (error) {
      console.error("[CoachHistory] Error flushing to file:", error)
    }
  }

  private loadFromFile(): void {
    try {
      if (fs.existsSync(this.logFilePath)) {
        const data = fs.readFileSync(this.logFilePath, "utf-8")
        const loaded = JSON.parse(data) as CoachMessage[]
        
        // Only load messages from the last hour
        const oneHourAgo = Date.now() - 3600000
        this.messages = loaded.filter((msg) => {
          const msgTime = new Date(msg.timestamp).getTime()
          return msgTime >= oneHourAgo
        })
        
        // Trim to max messages
        if (this.messages.length > this.maxMessages) {
          this.messages = this.messages.slice(-this.maxMessages)
        }
        
        // Set last intervention time to the most recent message
        if (this.messages.length > 0) {
          const latest = this.messages[this.messages.length - 1]
          this.lastInterventionTime = new Date(latest.timestamp).getTime()
        }
      }
    } catch (error) {
      console.error("[CoachHistory] Error loading from file:", error)
      this.messages = []
    }
  }
}

