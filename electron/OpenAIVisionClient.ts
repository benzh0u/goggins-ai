import OpenAI from "openai"
import fs from "fs"
import { config } from "./config"
import { QwenActivitySummary } from "../src/types/activity"

export class OpenAIVisionClient {
  private client: OpenAI
  private model: string

  constructor() {
    if (!config.openaiApiKey) {
      throw new Error("OpenAI API key not found. Set OPENAI_API_KEY in .env")
    }
    
    this.client = new OpenAI({
      apiKey: config.openaiApiKey
    })
    this.model = config.openaiVisionModel || "gpt-4o-mini"
    console.log(`[OpenAIVisionClient] Initialized with model: ${this.model}`)
  }

  public async analyzeScreenshot(screenshotPath: string): Promise<QwenActivitySummary> {
    try {
      // Read screenshot as base64
      const imageData = await fs.promises.readFile(screenshotPath)
      const base64Image = imageData.toString("base64")

      // Construct prompt for GPT-4o-mini vision
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
- For appGuess: ONLY include if you can clearly identify the app (e.g., you see "Netflix" logo, "YouTube" branding, "VSCode" interface). Do NOT guess based on similar-looking interfaces.
- If you cannot clearly identify the application, set appGuess to null or omit it entirely
- taskType must be exactly one of: "work", "study", "entertainment", "social", "other"`

      const startTime = Date.now()
      
      // Call OpenAI Vision API
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { 
                type: "image_url", 
                image_url: { 
                  url: `data:image/png;base64,${base64Image}`,
                  detail: "low" // Use "low" for faster processing at lower cost
                }
              }
            ]
          }
        ],
        max_tokens: 300,
        temperature: 0.3 // Lower temperature for more structured output
      })

      const elapsed = Date.now() - startTime
      const responseText = response.choices[0]?.message?.content?.trim() || ""
      
      if (!responseText) {
        throw new Error("Empty response from OpenAI Vision API")
      }

      // Parse JSON response
      let parsed: any
      try {
        // Try direct parse first
        parsed = JSON.parse(responseText)
      } catch {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1])
        } else {
          // Try to find JSON object in text
          const objectMatch = responseText.match(/\{[\s\S]*\}/)
          if (objectMatch) {
            parsed = JSON.parse(objectMatch[0])
          } else {
            throw new Error(`Could not parse JSON from response: ${responseText}`)
          }
        }
      }

      // Validate response structure
      if (!parsed.primaryActivity || !parsed.taskType) {
        throw new Error(`Invalid response structure: ${JSON.stringify(parsed)}`)
      }

      // Map to QwenActivitySummary format
      const summary: QwenActivitySummary = {
        primaryActivity: parsed.primaryActivity,
        taskType: parsed.taskType,
        timestamp: new Date().toISOString(),
        appGuess: parsed.appGuess || undefined,
        details: parsed.details
      }

      console.log(`[OpenAIVisionClient] Analysis complete (${elapsed}ms)`)
      return summary

    } catch (error) {
      console.error("[OpenAIVisionClient] Error analyzing screenshot:", error)
      
      // Return fallback activity summary
      return {
        primaryActivity: "Unable to analyze screenshot",
        taskType: "other",
        timestamp: new Date().toISOString(),
        appGuess: undefined,
        details: error instanceof Error ? error.message : "Unknown error"
      }
    }
  }
}

