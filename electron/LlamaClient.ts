import { config } from "./config"
import { QwenActivitySummary, InterventionScore, CoachMessage } from "../src/types/activity"

export class LlamaClient {
  private ollamaUrl: string
  private model: string

  constructor() {
    this.ollamaUrl = config.ollamaUrl
    this.model = config.llamaModel
    // Check if Ollama is available and validate model
    this.validateAndSetModel().catch(err => {
      console.warn(`[LlamaClient] Model validation failed:`, err)
    })
  }

  private async validateAndSetModel(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, { 
        signal: AbortSignal.timeout(5000) 
      })
      if (response.ok) {
        const data = await response.json()
        const models = data.models || []
        const modelNames = models.map((m: any) => m.name)
        
        // Check if current model exists
        const modelExists = models.some((m: any) => {
          const modelName = m.name
          return modelName === this.model || 
                 modelName.startsWith(this.model.split(':')[0] + ':') ||
                 (this.model.includes(':') && modelName === this.model.split(':')[0])
        })
        
        if (!modelExists) {
          console.warn(`[LlamaClient] Model ${this.model} not found in Ollama. Available models:`, modelNames)
          
          // Try fallback models in order of preference
          const fallbackModels = ["llama2.3:latest", "llama3.2:latest", "llama3.1:latest", "llama2:latest", "llama3:latest"]
          let foundFallback = false
          
          for (const fallback of fallbackModels) {
            const fallbackExists = models.some((m: any) => {
              const modelName = m.name
              return modelName === fallback || 
                     modelName.startsWith(fallback.split(':')[0] + ':') ||
                     (fallback.includes(':') && modelName === fallback.split(':')[0])
            })
            if (fallbackExists) {
              console.log(`[LlamaClient] Using fallback model: ${fallback}`)
              this.model = fallback
              foundFallback = true
              break
            }
          }
          
          // If no fallback found, use first available llama model
          if (!foundFallback) {
            const llamaModel = models.find((m: any) => m.name.toLowerCase().includes('llama'))
            if (llamaModel) {
              console.log(`[LlamaClient] Using first available llama model: ${llamaModel.name}`)
              this.model = llamaModel.name
              foundFallback = true
            }
          }
          
          if (!foundFallback) {
            console.error(`[LlamaClient] No suitable llama model found. Please install a llama model (e.g., 'ollama pull llama3.2').`)
            return false
          }
        } else {
          console.log(`[LlamaClient] Model ${this.model} is available in Ollama`)
        }
        return true
      }
      console.warn(`[LlamaClient] Ollama API returned status ${response.status}`)
      return false
    } catch (error) {
      console.warn(`[LlamaClient] Cannot reach Ollama at ${this.ollamaUrl}:`, error)
      return false
    }
  }

  public async checkAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, { 
        signal: AbortSignal.timeout(5000) 
      })
      if (response.ok) {
        const data = await response.json()
        return (data.models || []).map((m: any) => m.name)
      }
      return []
    } catch (error) {
      console.warn(`[LlamaClient] Cannot fetch available models:`, error)
      return []
    }
  }

  public async scoreActivity(activities: QwenActivitySummary[]): Promise<InterventionScore> {
    try {
      if (activities.length === 0) {
        return { score: 0, reasoning: "No activities to score" }
      }

      // Build activity summary for prompt
      const activitySummary = activities
        .map(
          (a) =>
            `[${a.timestamp}] ${a.primaryActivity} (${a.taskType}${a.appGuess ? ` - ${a.appGuess}` : ""})`
        )
        .join("\n")

      console.log(`[LlamaClient] Activity context for scoring:\n${activitySummary}`)

      const prompt = `You are analyzing a user's productivity patterns. Based on the following activity log from the last 60 seconds, rate how necessary it is to intervene and motivate them.

Activity log:
${activitySummary}

CRITICAL SCORING RULES (be STRICT and JUDGMENTAL):
- If you see ANY entertainment app/site (Netflix, YouTube, TikTok, Instagram, Twitter/X, Facebook, Reddit, gaming, etc.) - IMMEDIATELY score 7-10
- If you see ANY social media - score 7-10
- If you see ANY streaming service - score 7-10
- If taskType is "entertainment" or "social" - score 7-10
- Don't be lenient - entertainment = distraction = intervention needed
- "Taking a break" is not an excuse - still score high
- Mixed activities with ANY entertainment = still score 7+
- ONLY score 0-3 if they're clearly on work/study apps with NO distractions

Specific examples:
- Netflix/Hulu/Disney+/Prime Video = score 8-10
- YouTube = score 7-9
- Twitter/X/Facebook/Instagram = score 7-9
- Reddit = score 7-8
- Gaming = score 8-10
- News sites = score 5-7
- VS Code/IDE/coding = score 0-2
- Reading documentation = score 0-3
- Notion/productivity tools = score 0-3

Return ONLY a JSON object with this exact structure:
{
  "score": <number between 0 and 10>,
  "reasoning": "<brief explanation>"
}

Where:
- score 0-3: User is productive, no intervention needed
- score 4-6: User might be distracted, mild intervention
- score 7-10: User is clearly unproductive, strong intervention needed (USE THIS for entertainment/social media)

Return ONLY the JSON object, no markdown, no code blocks, no extra text.`

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.5,
            top_p: 0.9
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      let responseText = data.response || ""

      console.log("[LlamaClient] Raw response before cleaning:", responseText)

      // Clean JSON response
      responseText = responseText.trim()
      responseText = responseText.replace(/^```(?:json)?\n?/gm, "")
      responseText = responseText.replace(/\n?```$/gm, "")
      responseText = responseText.trim()

      // Extract JSON
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        responseText = jsonMatch[0]
      }

      console.log("[LlamaClient] Extracted JSON string:", responseText)

      // Try to repair common JSON issues
      try {
        // Remove trailing commas before closing braces/brackets
        responseText = responseText.replace(/,(\s*[}\]])/g, '$1')
        
        // Fix unescaped quotes in string values (basic attempt)
        // This is tricky, so we'll be conservative
        
        const parsed = JSON.parse(responseText) as Partial<InterventionScore>

        const score = Math.max(0, Math.min(10, Number(parsed.score) || 0))

        return {
          score: score,
          reasoning: parsed.reasoning || "No reasoning provided"
        }
      } catch (parseError) {
        console.error("[LlamaClient] Failed to parse JSON after cleaning")
        console.error("[LlamaClient] Attempted to parse:", responseText)
        console.error("[LlamaClient] Parse error:", parseError)
        
        // Try one more aggressive repair: extract just the score and reasoning manually
        const scoreMatch = responseText.match(/"score"\s*:\s*(\d+)/)
        // More flexible reasoning match - handles escaped quotes and longer strings
        const reasoningMatch = responseText.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        
        if (scoreMatch) {
          const extractedScore = Math.max(0, Math.min(10, parseInt(scoreMatch[1], 10)))
          const extractedReasoning = reasoningMatch ? reasoningMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ') : "No reasoning provided"
          
          console.log("[LlamaClient] Successfully extracted score and reasoning manually")
          return {
            score: extractedScore,
            reasoning: extractedReasoning
          }
        }
        
        // If all else fails, rethrow the original error
        throw parseError
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Error scoring activity"
      console.error("[LlamaClient] Error scoring activity:", errorMessage)
      console.error("[LlamaClient] Model used:", this.model)
      console.error("[LlamaClient] Ollama URL:", this.ollamaUrl)
      console.error("[LlamaClient] Full error:", error)
      return {
        score: 0,
        reasoning: errorMessage
      }
    }
  }

  public async generateCoachMessage(
    activities: QwenActivitySummary[],
    history: CoachMessage[],
    score: number
  ): Promise<CoachMessage> {
    try {
      // Build activity summary
      const activitySummary = activities
        .map(
          (a) =>
            `[${a.timestamp}] ${a.primaryActivity} (${a.taskType}${a.appGuess ? ` - ${a.appGuess}` : ""})`
        )
        .join("\n")

      // Extract the most recent activity and app for specific callout
      const latestActivity = activities[activities.length - 1]
      const specificApp = latestActivity?.appGuess || ""
      const specificActivity = latestActivity?.primaryActivity || "wasting time"
      
      // Build recent messages context
      const recentMessages = history
        .slice(-3)
        .map((m) => `"${m.text}"`)
        .join("\n")

      const prompt = `You are David Goggins, the motivational speaker and former Navy SEAL. The user has been unproductive and needs a FUCKING wake-up call.

WHAT THEY'RE LOOKING AT RIGHT NOW:
${specificApp ? `App/Site: ${specificApp}` : ""}
Activity: ${specificActivity}
Task Type: ${latestActivity?.taskType || "unknown"}

Full activity log from the last 60 seconds:
${activitySummary}

Recent messages you've sent (avoid repeating these):
${recentMessages.length > 0 ? recentMessages : "None"}

Intervention score: ${score}/10

Generate a short, AGGRESSIVE, intense, Goggins-style motivational message (1-3 sentences max) that:
- STARTS by calling out EXACTLY what they're looking at RIGHT NOW ${specificApp ? `(mention "${specificApp}" by name!)` : `(mention the specific activity: "${specificActivity}")`}
- Example openings: "Hey champ, why are you on ${specificApp || "this shit"} when you should be locked in?", "What the fuck are you doing on ${specificApp || "this"}?", "${specificApp ? specificApp + "?" : "This?"} Really? That's what we're doing right now?"
- Is EXTREMELY direct and aggressive - call them the FUCK out on what they're actually doing
- Use profanity liberally (fuck, shit, etc.) - this is how Goggins actually talks
- ALWAYS sound aggressive and intense, even when being positive - aggression is your default mode
- BE SPECIFIC about what they're viewing (the app/site name or activity)
- Uses time references when appropriate ("last 30 seconds", "this whole minute")
- Is RAW, UNFILTERED, and INTENSE in Goggins' authentic style - no holding back
- Does NOT contain slurs, self-harm encouragement, threats, or anything illegal
- Pushes them HARD to get back to work with aggressive motivation
- Sound like you're PISSED OFF that they're wasting time, even if you're trying to be encouraging
- CRITICAL: Use "Stay Hard" or "STAY HARD" CONSTANTLY - include it in EVERY OTHER SENTENCE or multiple times per message. If your message has 2 sentences, use "Stay Hard" at least twice. If it has 3 sentences, use it at least 2-3 times. Make it your signature phrase that appears throughout. Examples: "You're wasting time. Stay hard. Get back to work. Stay hard.", "STAY HARD and focus! Stay hard!", "Stop fucking around. Stay hard. Get this done. Stay hard."

Return ONLY the message text, no quotes, no JSON, no markdown, just the raw message.`

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.95, // Very high temperature for maximum intensity and aggression
            top_p: 0.95
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      let messageText = data.response || ""

      // Clean the message
      messageText = messageText.trim()
      messageText = messageText.replace(/^["']|["']$/g, "") // Remove surrounding quotes
      messageText = messageText.replace(/^```[\s\S]*?```$/gm, "") // Remove code blocks
      messageText = messageText.trim()

      // Safety check - if message seems problematic, use fallback
      // Note: We allow profanity (fuck, shit, etc.) but still filter truly harmful content
      const unsafePatterns = [
        /self.?harm/i,
        /kill.*yourself/i,
        /suicide/i,
        /hurt.*yourself/i
      ]
      if (unsafePatterns.some((pattern) => pattern.test(messageText))) {
        messageText = "You're better than this. Stay hard. Get the fuck back to work. Stay hard."
      }

      // Ensure "Stay Hard" appears multiple times - at least once per sentence or 2-3 times total
      if (messageText) {
        const stayHardMatches = (messageText.match(/stay\s+hard/gi) || []).length
        const sentenceCount = (messageText.match(/[.!?]+/g) || []).length || 1
        
        // If message has fewer than 2 instances of "Stay Hard", add more
        if (stayHardMatches < 2) {
          // Add "Stay Hard" at the end if missing, or add another instance
          if (stayHardMatches === 0) {
            messageText = messageText.trim() + " Stay hard. Stay hard."
          } else {
            messageText = messageText.trim() + " Stay hard."
          }
        }
        
        // For longer messages (3+ sentences), ensure at least 2-3 instances
        if (sentenceCount >= 3 && stayHardMatches < 2) {
          messageText = messageText.trim() + " Stay hard."
        }
      }

      return {
        timestamp: new Date().toISOString(),
        text: messageText || "Stay hard. Get the fuck back to work. Stay hard.",
        score: score
      }
    } catch (error) {
      console.error("[LlamaClient] Error generating coach message:", error)
      return {
        timestamp: new Date().toISOString(),
        text: "Stay hard. Get the fuck back to work. Stay hard.",
        score: score
      }
    }
  }

  public async chatWithUser(
    userMessage: string,
    activities: QwenActivitySummary[],
    chatHistory: Array<{ role: string; text: string; timestamp: string }>
  ): Promise<{ text: string; timestamp: string }> {
    try {
      // Build activity summary
      const activitySummary = activities
        .map(
          (a) =>
            `[${a.timestamp}] ${a.primaryActivity} (${a.taskType}${a.appGuess ? ` - ${a.appGuess}` : ""})`
        )
        .join("\n")

      // Build chat history context
      const historyContext = chatHistory
        .slice(-6) // Last 6 messages for context
        .map((msg) => `${msg.role === "user" ? "User" : "Goggins"}: ${msg.text}`)
        .join("\n")

      const prompt = `You are David Goggins, the motivational speaker and former Navy SEAL. The user is chatting with you directly.

Recent activity log (what the user has been doing):
${activitySummary || "No recent activity data available"}

Recent conversation:
${historyContext || "This is the start of the conversation."}

User's current message: "${userMessage}"

Respond as David Goggins would:
- Be direct, intense, and motivational
- Reference their activities if relevant
- Answer their question or respond to their message
- Keep it conversational but maintain your Goggins intensity
- Be supportive but push them to stay hard and focused
- Does NOT contain slurs, self-harm encouragement, threats, or anything illegal
- Keep responses to 2-4 sentences unless they ask a longer question

Return ONLY your response text, no quotes, no JSON, no markdown, just the raw message.`

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.8,
            top_p: 0.9
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      let messageText = data.response || ""

      // Clean the message
      messageText = messageText.trim()
      messageText = messageText.replace(/^["']|["']$/g, "") // Remove surrounding quotes
      messageText = messageText.replace(/^```[\s\S]*?```$/gm, "") // Remove code blocks
      messageText = messageText.trim()

      // Safety check
      const unsafePatterns = [
        /self.?harm/i,
        /kill.*yourself/i,
        /suicide/i,
        /hurt.*yourself/i
      ]
      if (unsafePatterns.some((pattern) => pattern.test(messageText))) {
        messageText = "You're better than this. Get back to work. Stay hard."
      }

      return {
        text: messageText || "Stay hard. Focus on your work.",
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      console.error("[LlamaClient] Error in chatWithUser:", error)
      return {
        text: "Stay hard. Focus on your work. That's what matters.",
        timestamp: new Date().toISOString()
      }
    }
  }

  public async generateProactiveMessage(
    activities: QwenActivitySummary[],
    chatHistory: Array<{ role: string; text: string; timestamp: string }>,
    escalationLevel: number
  ): Promise<{ text: string; timestamp: string }> {
    try {
      const activitySummary = activities
        .map(
          (a) =>
            `[${a.timestamp}] ${a.primaryActivity} (${a.taskType}${a.appGuess ? ` - ${a.appGuess}` : ""})`
        )
        .join("\n")

      const historyContext = chatHistory
        .slice(-6)
        .map((msg) => `${msg.role === "user" ? "User" : "Goggins"}: ${msg.text}`)
        .join("\n")

      const intensityLevel = escalationLevel === 2 ? "very intense and urgent" : escalationLevel === 1 ? "intense" : "motivational"
      const urgencyNote = escalationLevel === 2 ? "This has been going on for a while. Be more direct and urgent." : escalationLevel === 1 ? "They've been unproductive for a bit. Step it up." : ""

      const prompt = `You are David Goggins, the motivational speaker and former Navy SEAL. The user has been unproductive for a while and needs a proactive wake-up call.

Activity log from the last 60 seconds:
${activitySummary || "No recent activity data available"}

Recent conversation:
${historyContext || "This is the start of the conversation."}

Escalation level: ${escalationLevel} (0=normal, 1=escalated, 2=highly escalated)
${urgencyNote}

Generate a short, ${intensityLevel}, Goggins-style proactive motivational message (1-3 sentences max) that:
- Is direct and calls them out on their unproductive behavior
- References specific activities from the log if relevant
- Is ${intensityLevel} in tone based on escalation level
- Pushes them to get back to work and stay hard
- Does NOT contain slurs, self-harm encouragement, threats, or anything illegal
- Feels natural and not spammy

Return ONLY the message text, no quotes, no JSON, no markdown, just the raw message.`

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.8,
            top_p: 0.9
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      let messageText = data.response || ""

      messageText = messageText.trim()
      messageText = messageText.replace(/^["']|["']$/g, "")
      messageText = messageText.replace(/^```[\s\S]*?```$/gm, "")
      messageText = messageText.trim()

      const unsafePatterns = [
        /self.?harm/i,
        /kill.*yourself/i,
        /suicide/i,
        /hurt.*yourself/i
      ]
      if (unsafePatterns.some((pattern) => pattern.test(messageText))) {
        messageText = "You're better than this. Get back to work. Stay hard."
      }

      return {
        text: messageText || "Stay hard. Get back to work.",
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      console.error("[LlamaClient] Error generating proactive message:", error)
      return {
        text: "Stay hard. Get back to work.",
        timestamp: new Date().toISOString()
      }
    }
  }

  public async generateCelebrationMessage(
    activities: QwenActivitySummary[],
    chatHistory: Array<{ role: string; text: string; timestamp: string }>
  ): Promise<{ text: string; timestamp: string }> {
    try {
      const activitySummary = activities
        .map(
          (a) =>
            `[${a.timestamp}] ${a.primaryActivity} (${a.taskType}${a.appGuess ? ` - ${a.appGuess}` : ""})`
        )
        .join("\n")

      const historyContext = chatHistory
        .slice(-6)
        .map((msg) => `${msg.role === "user" ? "User" : "Goggins"}: ${msg.text}`)
        .join("\n")

      const prompt = `You are David Goggins, the motivational speaker and former Navy SEAL. The user has improved their productivity and is now working hard. Celebrate this win!

Activity log from the last 60 seconds:
${activitySummary || "No recent activity data available"}

Recent conversation:
${historyContext || "This is the start of the conversation."}

Generate a short, encouraging, Goggins-style celebration message (1-2 sentences max) that:
- Celebrates their improvement and getting back to work
- Acknowledges they're staying hard and focused
- Is encouraging and supportive but still maintains Goggins intensity
- References what they're doing well if relevant
- Pushes them to keep it up
- Does NOT contain slurs, self-harm encouragement, threats, or anything illegal

Return ONLY the message text, no quotes, no JSON, no markdown, just the raw message.`

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      let messageText = data.response || ""

      messageText = messageText.trim()
      messageText = messageText.replace(/^["']|["']$/g, "")
      messageText = messageText.replace(/^```[\s\S]*?```$/gm, "")
      messageText = messageText.trim()

      const unsafePatterns = [
        /self.?harm/i,
        /kill.*yourself/i,
        /suicide/i,
        /hurt.*yourself/i
      ]
      if (unsafePatterns.some((pattern) => pattern.test(messageText))) {
        messageText = "That's what I'm talking about. Keep it up. Stay hard."
      }

      return {
        text: messageText || "That's what I'm talking about. Keep it up. Stay hard.",
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      console.error("[LlamaClient] Error generating celebration message:", error)
      return {
        text: "That's what I'm talking about. Keep it up. Stay hard.",
        timestamp: new Date().toISOString()
      }
    }
  }

  public async generateCheckInMessage(
    activities: QwenActivitySummary[],
    chatHistory: Array<{ role: string; text: string; timestamp: string }>
  ): Promise<{ text: string; timestamp: string }> {
    try {
      const activitySummary = activities
        .map(
          (a) =>
            `[${a.timestamp}] ${a.primaryActivity} (${a.taskType}${a.appGuess ? ` - ${a.appGuess}` : ""})`
        )
        .join("\n")

      const historyContext = chatHistory
        .slice(-6)
        .map((msg) => `${msg.role === "user" ? "User" : "Goggins"}: ${msg.text}`)
        .join("\n")

      const prompt = `You are David Goggins, the motivational speaker and former Navy SEAL. You're doing a periodic check-in with the user during a longer work session.

Activity log from the last 60 seconds:
${activitySummary || "No recent activity data available"}

Recent conversation:
${historyContext || "This is the start of the conversation."}

Generate a short, natural, Goggins-style check-in message (1-2 sentences max) that:
- Feels like a natural check-in during a work session
- Is motivational but not overly intense (this is a routine check-in)
- Acknowledges their current state
- Encourages them to stay focused and keep going
- Does NOT contain slurs, self-harm encouragement, threats, or anything illegal
- Feels conversational and supportive

Return ONLY the message text, no quotes, no JSON, no markdown, just the raw message.`

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      let messageText = data.response || ""

      messageText = messageText.trim()
      messageText = messageText.replace(/^["']|["']$/g, "")
      messageText = messageText.replace(/^```[\s\S]*?```$/gm, "")
      messageText = messageText.trim()

      const unsafePatterns = [
        /self.?harm/i,
        /kill.*yourself/i,
        /suicide/i,
        /hurt.*yourself/i
      ]
      if (unsafePatterns.some((pattern) => pattern.test(messageText))) {
        messageText = "How are you doing? Stay focused. Stay hard."
      }

      return {
        text: messageText || "How are you doing? Stay focused. Stay hard.",
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      console.error("[LlamaClient] Error generating check-in message:", error)
      return {
        text: "How are you doing? Stay focused. Stay hard.",
        timestamp: new Date().toISOString()
      }
    }
  }
}

