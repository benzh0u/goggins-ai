import { QwenActivitySummary } from "../src/types/activity"
import path from "path"
import fs from "fs"
import { app } from "electron"

export class ActivityLog {
  private entries: QwenActivitySummary[] = []
  private readonly maxEntries: number = 15 // ~75 seconds at 5s intervals (slightly more than 60s for safety)
  private logFilePath: string

  constructor() {
    // Set up log file path
    const userDataPath = app.getPath("userData")
    const logsDir = path.join(userDataPath, "logs")
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }
    
    this.logFilePath = path.join(logsDir, "activity-log.json")
    
    // Load existing log if available
    this.loadFromFile()
  }

  public addEntry(summary: QwenActivitySummary): void {
    this.entries.push(summary)
    
    // Keep only the most recent entries (ring buffer behavior)
    if (this.entries.length > this.maxEntries) {
      this.entries.shift()
    }
    
    // Periodically flush to file (every 5 entries)
    if (this.entries.length % 5 === 0) {
      this.flushToFile()
    }
  }

  public getEntriesSince(msAgo: number): QwenActivitySummary[] {
    const cutoffTime = Date.now() - msAgo
    return this.entries.filter((entry) => {
      const entryTime = new Date(entry.timestamp).getTime()
      return entryTime >= cutoffTime
    })
  }

  public getAll(): QwenActivitySummary[] {
    return [...this.entries] // Return a copy
  }

  public getLatest(): QwenActivitySummary | null {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1] : null
  }

  public clear(): void {
    this.entries = []
    this.flushToFile()
  }

  private flushToFile(): void {
    try {
      fs.writeFileSync(this.logFilePath, JSON.stringify(this.entries, null, 2), "utf-8")
    } catch (error) {
      console.error("[ActivityLog] Error flushing to file:", error)
    }
  }

  private loadFromFile(): void {
    try {
      if (fs.existsSync(this.logFilePath)) {
        const data = fs.readFileSync(this.logFilePath, "utf-8")
        const loaded = JSON.parse(data) as QwenActivitySummary[]
        
        // Only load entries from the last 2 minutes to avoid stale data
        const twoMinutesAgo = Date.now() - 120000
        this.entries = loaded.filter((entry) => {
          const entryTime = new Date(entry.timestamp).getTime()
          return entryTime >= twoMinutesAgo
        })
        
        // Trim to max entries
        if (this.entries.length > this.maxEntries) {
          this.entries = this.entries.slice(-this.maxEntries)
        }
      }
    } catch (error) {
      console.error("[ActivityLog] Error loading from file:", error)
      this.entries = []
    }
  }
}

