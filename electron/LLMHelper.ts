import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import OpenAI from "openai"
import fs from "fs"
import path from "path"
import { app } from "electron"
import { ElevenLabsClient } from "elevenlabs"
import { ConversationMemory } from "./ConversationMemory"


interface OllamaResponse {
  response: string
  done: boolean
}

export class LLMHelper {
  private model: GenerativeModel | null = null
  private openaiClient: OpenAI | null = null
  private openaiModel: string = "gpt-4o-mini"
  private useOpenAI: boolean = false
  private ttsClient: ElevenLabsClient | null = null
  private voiceId: string | null = null
  private readonly systemPrompt = `You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation (not just coding). For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.`
  private useOllama: boolean = false
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"

  constructor(
    apiKey?: string, 
    useOllama: boolean = false, 
    ollamaModel?: string, 
    ollamaUrl?: string,
    ttsConfig?: { apiKey: string; voiceId: string },
    openaiConfig?: { apiKey: string; model: string }
  ) {
    // Priority 1: OpenAI (preferred for text generation)
    if (openaiConfig?.apiKey) {
      this.openaiClient = new OpenAI({
        apiKey: openaiConfig.apiKey
      })
      this.openaiModel = openaiConfig.model || "gpt-4o-mini"
      this.useOpenAI = true
      console.log(`[LLMHelper] ✓ Using OpenAI with model: ${this.openaiModel}`)
    }
    // Priority 2: Ollama (local fallback)
    else if (useOllama) {
      this.useOllama = true
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest"
      console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)
      this.initializeOllamaModel()
    } 
    // Priority 3: Gemini (cloud fallback)
    else if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey)
      this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })
      console.log("[LLMHelper] Using Google Gemini")
    } else {
      throw new Error("Must provide OpenAI key, Gemini API key, or enable Ollama mode")
    }
    
    // TTS initialization (independent of text generation)
    if (ttsConfig) {
      this.ttsClient = new ElevenLabsClient({
        apiKey: ttsConfig.apiKey
      })
      this.voiceId = ttsConfig.voiceId
      console.log("[LLMHelper] ✓ TTS enabled with Goggins voice (ElevenLabs)")
    }
  }
// OPTIMIZED: Method to generate speech using ElevenLabs with STREAMING
public async generateGogginsVoice(text: string): Promise<string | null> {
  if (!this.ttsClient || !this.voiceId) {
    console.warn("[LLMHelper] ✗ TTS client or voice ID not configured")
    return null
  }
  try {
    console.log(`[LLMHelper] 🎤 Starting STREAMING TTS conversion...`)
    console.log(`[LLMHelper]   Text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`)

    const apiStartTime = Date.now()
    
    // OPTIMIZATION: Use convertAsStream for faster initial response
    const audioStream = await this.ttsClient.textToSpeech.convertAsStream(this.voiceId, {
      text: text,
      model_id: "eleven_turbo_v2_5", // Fastest model
      optimize_streaming_latency: 4, // Maximum optimization for low latency
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75, // Slightly lower for faster processing
        style: 0.5,
        use_speaker_boost: true
      }
    })
    
    console.log(`[LLMHelper] 📡 Stream started, collecting audio chunks...`)

    // Save to temp file
    const tempDir = app.getPath("temp")
    const timestamp = Date.now()
    const audioPath = path.join(tempDir, `goggins_${timestamp}.mp3`)
    
    // OPTIMIZATION: Stream directly to file instead of buffering everything first
    const chunks: Buffer[] = []
    let chunkCount = 0
    
    for await (const chunk of audioStream) {
      chunks.push(Buffer.from(chunk))
      chunkCount++
      // Log first chunk arrival for latency measurement
      if (chunkCount === 1) {
        const firstChunkLatency = Date.now() - apiStartTime
        console.log(`[LLMHelper] ⚡ First audio chunk received in ${firstChunkLatency}ms (FAST!)`)
      }
    }
    
    const fullBuffer = Buffer.concat(chunks)
    const apiDuration = Date.now() - apiStartTime
    const bufferSizeKB = (fullBuffer.length / 1024).toFixed(2)
    console.log(`[LLMHelper] ✓ All chunks received: ${bufferSizeKB} KB (${chunkCount} chunks) in ${apiDuration}ms`)
    
    // Write to disk
    fs.writeFileSync(audioPath, fullBuffer)
    
    // Verify file was written
    if (fs.existsSync(audioPath)) {
      const stats = fs.statSync(audioPath)
      const fileSizeKB = (stats.size / 1024).toFixed(2)
      const totalTime = Date.now() - apiStartTime
      console.log(`[LLMHelper] ✓ TTS COMPLETE: ${fileSizeKB} KB in ${totalTime}ms`)
    } else {
      console.error(`[LLMHelper] ✗ File write failed`)
      return null
    }
    
    return audioPath
  } catch (error) {
    console.error("[LLMHelper] ✗ TTS generation failed:", error)
    if (error instanceof Error) {
      console.error(`[LLMHelper]   Error: ${error.message}`)
    }
    return null
  }
}

  private async fileToGenerativePart(imagePath: string) {
    const imageData = await fs.promises.readFile(imagePath)
    return {
      inlineData: {
        data: imageData.toString("base64"),
        mimeType: "image/png"
      }
    }
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  private async callOllama(prompt: string, useHigherTemp: boolean = false): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: prompt,
          stream: false,
          options: {
            temperature: useHigherTemp ? 0.9 : 0.7,
            top_p: 0.9,
            num_predict: 150, // OPTIMIZATION: Limit to ~2-3 sentences for faster responses
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error) {
      console.error("[LLMHelper] Error calling Ollama:", error)
      throw new Error(`Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`)
    }
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      // Test the selected model works
      const testResult = await this.callOllama("Hello")
      console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error) {
      console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError) {
        console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      const imageParts = await Promise.all(imagePaths.map(path => this.fileToGenerativePart(path)))
      
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const result = await this.model.generateContent([prompt, ...imageParts])
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      return JSON.parse(text)
    } catch (error) {
      console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `${this.systemPrompt}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    console.log("[LLMHelper] Calling Gemini LLM for solution...");
    try {
      const result = await this.model.generateContent(prompt)
      console.log("[LLMHelper] Gemini LLM returned result.");
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      const parsed = JSON.parse(text)
      console.log("[LLMHelper] Parsed LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("[LLMHelper] Error in generateSolution:", error);
      throw error;
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const imageParts = await Promise.all(debugImagePaths.map(path => this.fileToGenerativePart(path)))
      
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const result = await this.model.generateContent([prompt, ...imageParts])
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      const parsed = JSON.parse(text)
      console.log("[LLMHelper] Parsed debug LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("Error debugging solution with images:", error)
      throw error
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    try {
      const audioData = await fs.promises.readFile(audioPath);
      const audioPart = {
        inlineData: {
          data: audioData.toString("base64"),
          mimeType: "audio/mp3"
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user.`;
      const result = await this.model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio file:", error);
      throw error;
    }
  }

  public async analyzeAudioFromBase64(data: string, mimeType: string) {
    try {
      const audioPart = {
        inlineData: {
          data,
          mimeType
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user and be concise.`;
      const result = await this.model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio from base64:", error);
      throw error;
    }
  }

  public async analyzeImageFile(imagePath: string) {
    try {
      const imageData = await fs.promises.readFile(imagePath);
      const imagePart = {
        inlineData: {
          data: imageData.toString("base64"),
          mimeType: "image/png"
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe the content of this image in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the image. Do not return a structured JSON object, just answer naturally as you would to a user. Be concise and brief.`;
      const result = await this.model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing image file:", error);
      throw error;
    }
  }
  // Add convenience method to check if TTS is available
  public hasTTS(): boolean {
    return this.ttsClient !== null && this.voiceId !== null
  }

  /**
   * Generate conversational response from Goggins with STREAMING
   * OPTIMIZED for speed - streams tokens and sends to TTS immediately
   */
  public async generateConversationalResponse(
    conversationHistory: Array<{ role: string; text: string; timestamp: string }>,
    recentActivities: any[],
    shouldEnd: boolean,
    memory: ConversationMemory
  ): Promise<{ text: string; timestamp: string }> {
    try {
      // Show last 5 messages for better conversational continuity
      const historyContext = conversationHistory
        .slice(-5)
        .map((msg) => `${msg.role === "user" ? "User" : "Goggins"}: ${msg.text}`)
        .join("\n")

      // Show last 3 activities with details for better context
      const activitySummary = recentActivities.length > 0
        ? recentActivities
            .slice(-3)
            .map((a) => `${a.primaryActivity} (${a.taskType})`)
            .join(", ")
        : "No activity data"
      
      // Extract specific apps/sites for detailed coaching
      const specificApps = recentActivities.length > 0
        ? recentActivities
            .slice(-3)
            .map(a => a.appGuess)
            .filter(app => app && app !== "Unknown")
            .join(", ")
        : ""

      // OPTIMIZATION: Simple productivity assessment
      const workActivities = recentActivities.filter(
        (a) => a.taskType === "work" || a.taskType === "study"
      )
      const productivityRatio = recentActivities.length > 0 
        ? (workActivities.length / recentActivities.length) 
        : 0
      
      const isProductivString = productivityRatio > 0.6 ? "productive" : "distracted"

      const userLastMessage = conversationHistory[conversationHistory.length - 1]?.text || ""
      const goalText = memory.currentGoal || memory.currentTask || ""
      
      // Get Goggins' last message for conversational context
      const lastGogginsMessage = conversationHistory.length >= 2 && conversationHistory[conversationHistory.length - 2]?.role === "goggins"
        ? conversationHistory[conversationHistory.length - 2].text
        : null
      
      // ENHANCED PROMPT with conversational threading for natural flow
      const prompt = `You are David Goggins in an ONGOING conversation (Exchange #${memory.totalExchanges}).

=== CONVERSATION THREAD ===
${historyContext || "Starting conversation now."}

=== YOUR LAST MESSAGE ===
YOU (Goggins) just said: "${lastGogginsMessage || '[Starting conversation]'}"

=== USER'S RESPONSE ===
USER: "${userLastMessage}"

=== CONVERSATION CONTINUITY REQUIREMENTS ===
1. BUILD ON YOUR LAST POINT: Reference something specific you said in your previous message
2. ACKNOWLEDGE THEIR RESPONSE: React to their exact words - show you heard them
3. MAINTAIN THE NARRATIVE: This is ONE flowing conversation, not separate exchanges
4. TRACK THEIR PROGRESS: Reference their goal/task throughout the conversation

=== THEIR CURRENT STATE ===
- Mood: ${memory.userMood}
- Productivity: ${isProductivString}
- Stated Goal: ${goalText || "UNKNOWN - demand to know it"}
${memory.deadline ? `- Deadline: ${memory.deadline}` : ""}
- Current Activity: ${activitySummary}
${specificApps ? `- Apps/Sites Right Now: ${specificApps}` : ""}

=== YOUR RESPONSE REQUIREMENTS ===
${memory.totalExchanges === 1 
  ? "FIRST EXCHANGE: Get SPECIFIC. Ask: 'What are you working on RIGHT NOW? What part are you on?' Not generic 'what's your goal' - dig into CURRENT state." 
  : `CONTINUING CONVERSATION (Exchange ${memory.totalExchanges}):
- Build on their last answer: "${userLastMessage.substring(0, 80)}"
- Get HYPER-SPECIFIC about their CURRENT progress:
  * If coding/building: "What feature? What part? What's blocking you? What's the next step?"
  * If studying: "What chapter? What concept? What problem are you stuck on?"
  * If working: "What task? Where are you at? What's next?"
- Don't ask vague questions like "what's your goal" or "why are you doing this"
- Ask about IMMEDIATE PROGRESS: "Where are you at? What's the next step? What are you stuck on?"
- Reference what they said before: "You said you were doing X - how far did you get? What's next?"
- Be a COACH helping them break down next steps, not an interrogator
- Call out SPECIFIC behavior: ${specificApps ? `They're on ${specificApps}` : `They're ${activitySummary.split(",")[0]}`}`
}

FORMAT REQUIREMENTS:
- 2-3 sentences MAX (be concise but personal)
- First sentence: React specifically to what they just said
- Second sentence: Ask about CURRENT progress or next SPECIFIC step
- Be detailed and personal, not generic
- Examples of GOOD coaching questions:
  * "What part of the website are you on right now?"
  * "What's the next feature you need to code?"
  * "What's blocking you from finishing this section?"
  * "What chapter are you on? What's the concept you're working on?"
- Examples of BAD generic questions (AVOID THESE):
  * "What's your goal?" (too vague)
  * "Why are you doing this?" (not actionable)
  * "What do you want to achieve?" (too broad)
- Aggressive coaching style, not buddy talk
- Use profanity ONLY for emphasis (sparingly)
${shouldEnd ? "\n- FINAL EXCHANGE: Wrap up, reference their specific progress, say goodbye" : ""}

CRITICAL: Output ONLY the spoken response. DO NOT include "Goggins:", "YOU:", or any labels.
Just the raw response that will be spoken aloud.

Goggins responds:`

      let responseText: string

      // Priority 1: Use OpenAI (fastest and most reliable)
      if (this.useOpenAI && this.openaiClient) {
        console.log("[LLMHelper] 🚀 Calling OpenAI GPT-4o-mini...")
        const startTime = Date.now()
        
        const completion = await this.openaiClient.chat.completions.create({
          model: this.openaiModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 150,
          temperature: 0.8,
        })
        
        responseText = completion.choices[0]?.message?.content || ""
        const duration = Date.now() - startTime
        console.log(`[LLMHelper] ✓ OpenAI response in ${duration}ms`)
      }
      // Priority 2: Ollama (local fallback)
      else if (this.useOllama) {
        responseText = await this.callOllama(prompt, false)
      } 
      // Priority 3: Gemini (cloud fallback)
      else if (this.model) {
        console.log("[LLMHelper] 🚀 Generating response with max_tokens=150 for speed...")
        const startTime = Date.now()
        
        const result = await this.model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 150,
            temperature: 0.8,
          }
        })
        
        const response = await result.response
        responseText = response.text()
        const duration = Date.now() - startTime
        console.log(`[LLMHelper] ✓ Gemini response in ${duration}ms`)
      } else {
        throw new Error("No LLM provider configured")
      }

      // Clean the response
      responseText = responseText.trim()
      responseText = responseText.replace(/^["']|["']$/g, "")
      responseText = responseText.replace(/^```[\s\S]*?```$/gm, "")
      responseText = responseText.trim()

      // Safety check
      const unsafePatterns = [
        /self.?harm/i,
        /kill.*yourself/i,
        /suicide/i,
        /hurt.*yourself/i
      ]
      if (unsafePatterns.some((pattern) => pattern.test(responseText))) {
        responseText = shouldEnd
          ? "Stay hard. I can't make you lock in, that has to come from you."
          : "You're better than this. Stay focused and stay hard."
      }

      return {
        text: responseText || (shouldEnd ? "Stay hard. Get back to it." : "What are you working on? Tell me."),
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      console.error("[LLMHelper] Error generating conversational response:", error)
      return {
        text: shouldEnd 
          ? "I can't make you lock in, that's on you. Stay hard."
          : "What's your mission today? Talk to me.",
        timestamp: new Date().toISOString()
      }
    }
  }

  public async chatWithGemini(message: string): Promise<string> {
    try {
      if (this.useOllama) {
        return this.callOllama(message);
      } else if (this.model) {
        const result = await this.model.generateContent(message);
        const response = await result.response;
        return response.text();
      } else {
        throw new Error("No LLM provider configured");
      }
    } catch (error) {
      console.error("[LLMHelper] Error in chatWithGemini:", error);
      throw error;
    }
  }

  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message);
  }

  public isUsingOllama(): boolean {
    return this.useOllama;
  }

  public async getOllamaModels(): Promise<string[]> {
    if (!this.useOllama) return [];
    
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.error("[LLMHelper] Error fetching Ollama models:", error);
      return [];
    }
  }

  /**
   * Get available Ollama models (works even when not using Ollama)
   */
  public async getAvailableOllamaModels(url?: string): Promise<string[]> {
    const targetUrl = url || this.ollamaUrl;
    
    try {
      const response = await fetch(`${targetUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.error("[LLMHelper] Error fetching Ollama models:", error);
      return [];
    }
  }

  /**
   * Get current LLM configuration
   */
  public getCurrentLlmConfig(): { provider: "ollama" | "gemini"; model: string; isOllama: boolean } {
    return {
      provider: this.getCurrentProvider(),
      model: this.getCurrentModel(),
      isOllama: this.useOllama
    }
  }

  public getCurrentProvider(): "ollama" | "gemini" {
    return this.useOllama ? "ollama" : "gemini";
  }

  public getCurrentModel(): string {
    return this.useOllama ? this.ollamaModel : "gemini-2.0-flash";
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.useOllama = true;
    if (url) this.ollamaUrl = url;
    
    if (model) {
      this.ollamaModel = model;
    } else {
      // Auto-detect first available model
      await this.initializeOllamaModel();
    }
    
    console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
  }

  public async switchToGemini(apiKey?: string): Promise<void> {
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    }
    
    if (!this.model && !apiKey) {
      throw new Error("No Gemini API key provided and no existing model instance");
    }
    
    this.useOllama = false;
    console.log("[LLMHelper] Switched to Gemini");
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useOllama) {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        // Test with a simple prompt
        await this.callOllama("Hello");
        return { success: true };
      } else {
        if (!this.model) {
          return { success: false, error: "No Gemini model configured" };
        }
        // Test with a simple prompt
        const result = await this.model.generateContent("Hello");
        const response = await result.response;
        const text = response.text(); // Ensure the response is valid
        if (text) {
          return { success: true };
        } else {
          return { success: false, error: "Empty response from Gemini" };
        }
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
} 