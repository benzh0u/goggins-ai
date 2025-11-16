import fs from "fs"
import { config } from "./config"
import { QwenActivitySummary } from "../src/types/activity"

export class QwenClient {
  private ollamaUrl: string
  private model: string

  constructor() {
    this.ollamaUrl = config.ollamaUrl
    this.model = config.qwenModel
    console.log(`[QwenClient] Initialized with model: ${this.model} at ${this.ollamaUrl}`)
    // Check if Ollama is available on initialization
    this.checkOllamaAvailable().catch(err => {
      console.warn(`[QwenClient] Ollama availability check failed:`, err)
    })
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, { 
        signal: AbortSignal.timeout(5000) 
      })
      if (response.ok) {
        const data = await response.json()
        const models = data.models || []
        const modelExists = models.some((m: any) => m.name === this.model || m.name.startsWith(this.model.split(':')[0]))
        if (!modelExists) {
          console.warn(`[QwenClient] Model ${this.model} not found in Ollama. Available models:`, models.map((m: any) => m.name))
        } else {
          console.log(`[QwenClient] Model ${this.model} is available in Ollama`)
        }
        return true
      }
      return false
    } catch (error) {
      console.warn(`[QwenClient] Cannot reach Ollama at ${this.ollamaUrl}:`, error)
      return false
    }
  }

  public async analyzeScreenshot(screenshotPath: string): Promise<QwenActivitySummary> {
    try {
      // Read screenshot as base64
      const imageData = await fs.promises.readFile(screenshotPath)
      const base64Image = imageData.toString("base64")

      // Construct prompt for Qwen
      const prompt = `Analyze this screenshot and describe what the user is doing. Return ONLY a valid JSON object with this exact structure (no markdown, no code blocks, no extra text):

{
  "primaryActivity": "A brief description of what the user is doing (1-2 sentences max)",
  "appGuess": "The application or website name ONLY if you can clearly see the application name, logo, or distinctive UI elements that uniquely identify it. If uncertain, use null or omit this field.",
  "taskType": "work" | "study" | "entertainment" | "social" | "other",
  "details": "A short one-sentence elaboration (optional)"
}

Important:
- Describe only what is visible on screen
- Avoid motivational language
- Keep it factual and concise
- For appGuess: ONLY include if you can clearly identify the app (e.g., you see "Photoshop" text, Adobe logo, or unmistakable UI). Do NOT guess based on similar-looking interfaces.
- If you cannot clearly identify the application, set appGuess to null or omit it entirely
- taskType must be exactly one of: "work", "study", "entertainment", "social", "other"`

      // Call Ollama API with vision support
      // For vision models, use /api/chat endpoint with messages format
      const requestBody = {
        model: this.model,
        messages: [
          {
            role: "user",
            content: prompt,
            images: [base64Image]
          }
        ],
        stream: false,
        options: {
          temperature: 0.3, // Lower temperature for more structured output
          top_p: 0.9
        }
      }
      
      const startTime = Date.now()
      
      // Add timeout to prevent hanging (60 seconds for vision models)
      const timeoutMs = 60000
      const controller = new AbortController()
      
      // Create a timeout promise as backup (in case AbortController doesn't work)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          const elapsed = Date.now() - startTime
          console.log(`[QwenClient] Timeout reached (${elapsed}ms), aborting request...`)
          controller.abort()
          reject(new Error(`Ollama API call timed out after ${elapsed}ms (limit: ${timeoutMs}ms). Is Ollama running? Check ${this.ollamaUrl}`))
        }, timeoutMs)
      })
      
      // Add progress logging every 10 seconds
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime
        console.log(`[QwenClient] Still waiting for response... (${elapsed}ms elapsed)`)
      }, 10000)
      
      let response: Response
      try {
        console.log(`[QwenClient] Sending fetch request to ${this.ollamaUrl}/api/chat...`)
        // Use /api/chat for vision models instead of /api/generate
        // Use Promise.race to ensure timeout works even if AbortController doesn't
        const fetchPromise = fetch(`${this.ollamaUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        })
        
        response = await Promise.race([fetchPromise, timeoutPromise])
        clearInterval(progressInterval)
        console.log(`[QwenClient] Fetch promise resolved, status: ${response.status}`)
      } catch (fetchError) {
        clearInterval(progressInterval)
        console.error(`[QwenClient] Fetch error caught:`, fetchError)
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          const elapsed = Date.now() - startTime
          throw new Error(`Ollama API call timed out after ${elapsed}ms (limit: ${timeoutMs}ms). Is Ollama running? Check ${this.ollamaUrl}`)
        }
        if (fetchError instanceof Error && fetchError.message.includes('ECONNREFUSED')) {
          throw new Error(`Cannot connect to Ollama at ${this.ollamaUrl}. Is Ollama running?`)
        }
        if (fetchError instanceof Error && fetchError.message.includes('timed out')) {
          throw fetchError
        }
        throw fetchError
      }

      const fetchTime = Date.now() - startTime
      console.log(`[QwenClient] API fetch completed in ${fetchTime}ms, status: ${response.status}`)

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unable to read error response")
        console.error(`[QwenClient] API response error: ${response.status} ${response.statusText}`)
        console.error(`[QwenClient] Error body: ${errorText}`)
        throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`)
      }

      const data = await response.json()
      const totalTime = Date.now() - startTime
      console.log(`[QwenClient] API response received in ${totalTime}ms total`)
      console.log(`[QwenClient] Raw response preview: ${JSON.stringify(data).substring(0, 200)}...`)
      
      // For /api/chat, the response is in data.message.content instead of data.response
      let responseText = data.message?.content || data.response || ""

      // Clean JSON response (remove markdown code blocks if present)
      responseText = responseText.trim()
      responseText = responseText.replace(/^```(?:json)?\n?/gm, "")
      responseText = responseText.replace(/\n?```$/gm, "")
      responseText = responseText.trim()

      // Try to extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        responseText = jsonMatch[0]
      }

      const parsed = JSON.parse(responseText) as Partial<QwenActivitySummary>

      // Validate and construct result
      const result: QwenActivitySummary = {
        timestamp: new Date().toISOString(),
        primaryActivity: parsed.primaryActivity || "Unknown activity",
        appGuess: parsed.appGuess && parsed.appGuess !== "null" && parsed.appGuess.trim() !== "" ? parsed.appGuess : undefined,
        taskType: parsed.taskType || "other",
        details: parsed.details
      }

      // Validate taskType
      const validTaskTypes = ["work", "study", "entertainment", "social", "other"]
      if (!validTaskTypes.includes(result.taskType)) {
        result.taskType = "other"
      }

      console.log(`[QwenClient] Successfully parsed activity summary: ${result.primaryActivity} (${result.taskType})`)
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      console.error("[QwenClient] Error analyzing screenshot:", errorMessage)
      console.error("[QwenClient] Model used:", this.model)
      console.error("[QwenClient] Ollama URL:", this.ollamaUrl)
      console.error("[QwenClient] Full error:", error)
      // Return a fallback summary on error
      return {
        timestamp: new Date().toISOString(),
        primaryActivity: "Unable to analyze screenshot",
        taskType: "other",
        details: errorMessage
      }
    }
  }
}

