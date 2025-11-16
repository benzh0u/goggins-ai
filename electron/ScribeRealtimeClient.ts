import { config } from "./config"
import WebSocket from "ws"
import { TranscriptEvent } from "../src/types/activity"

type WebSocketData = string | Buffer | ArrayBuffer | Buffer[]

export class ScribeRealtimeClient {
  private ws: WebSocket | null = null
  private apiKey: string
  private isConnected: boolean = false
  private isStreaming: boolean = false
  private partialTranscript: string = ""
  private sessionStarted: boolean = false
  
  // Callbacks
  private onTranscriptCallback: ((event: TranscriptEvent) => void) | null = null
  private onWakeWordCallback: (() => void) | null = null
  private onUserSpeakingCallback: ((isSpeaking: boolean) => void) | null = null
  private onErrorCallback: ((error: Error) => void) | null = null

  constructor(apiKey?: string) {
    this.apiKey = apiKey || config.ttsApiKey || ""
    if (!this.apiKey) {
      console.warn("[ScribeRealtimeClient] No API key provided. Voice features will be disabled.")
    }
  }

  /**
   * Connect to ElevenLabs Scribe v2 Realtime API
   * Based on: https://elevenlabs.io/docs/cookbooks/speech-to-text/streaming
   */
  public async connect(): Promise<void> {
    if (this.isConnected) {
      console.log("[ScribeRealtimeClient] Already connected")
      return
    }

    if (!this.apiKey) {
      throw new Error("ElevenLabs API key is required for Scribe v2")
    }

    return new Promise((resolve, reject) => {
      try {
        // ElevenLabs Scribe v2 Realtime WebSocket endpoint with VAD enabled
        // Note: API key must be passed in headers, not query params
        const wsUrl = `wss://api.elevenlabs.io/v1/scribe/realtime?model_id=scribe_v2_realtime&commit_strategy=vad&vad_threshold=0.5&silence_threshold_secs=0.8`
        
        console.log("[ScribeRealtimeClient] Connecting to Scribe v2...")
        console.log(`[ScribeRealtimeClient] API Key present: ${this.apiKey ? 'YES' : 'NO'}`)
        
        // Clean and verify API key
        const cleanApiKey = this.apiKey?.trim() || ""
        if (!cleanApiKey) {
          throw new Error("API key is empty after trimming")
        }
        
        if (cleanApiKey) {
          const keyPreview = cleanApiKey.substring(0, 10) + "..." + cleanApiKey.substring(cleanApiKey.length - 4)
          console.log(`[ScribeRealtimeClient] API Key preview: ${keyPreview}`)
          console.log(`[ScribeRealtimeClient] API Key length: ${cleanApiKey.length}`)
          console.log(`[ScribeRealtimeClient] API Key starts with 'sk_': ${cleanApiKey.startsWith('sk_')}`)
          console.log(`[ScribeRealtimeClient] API Key has whitespace: ${cleanApiKey !== cleanApiKey.trim()}`)
          // Check for any non-printable characters
          const hasNonPrintable = /[\x00-\x1F\x7F-\x9F]/.test(cleanApiKey)
          console.log(`[ScribeRealtimeClient] API Key has non-printable chars: ${hasNonPrintable}`)
        }
        
        // Create WebSocket with headers
        // IMPORTANT: For 'ws' library, headers must be passed as a plain object
        // Ensure API key is properly formatted with no extra whitespace
        const headers: Record<string, string> = {
          "xi-api-key": cleanApiKey
        }
        
        const wsOptions: any = {
          headers: headers,
          perMessageDeflate: false // Disable compression
        }
        
        console.log(`[ScribeRealtimeClient] WebSocket URL: ${wsUrl}`)
        console.log(`[ScribeRealtimeClient] WebSocket options:`)
        console.log(`[ScribeRealtimeClient]   Headers: xi-api-key=${cleanApiKey.substring(0, 10)}...${cleanApiKey.substring(cleanApiKey.length - 4)}`)
        console.log(`[ScribeRealtimeClient]   Header count: ${Object.keys(headers).length}`)
        console.log(`[ScribeRealtimeClient]   perMessageDeflate: false`)
        
        // Debug: Verify header is set correctly
        if (!headers["xi-api-key"] || headers["xi-api-key"] !== cleanApiKey) {
          console.error(`[ScribeRealtimeClient] ✗ Header mismatch! Expected: ${cleanApiKey.substring(0, 10)}..., Got: ${headers["xi-api-key"]?.substring(0, 10)}...`)
        }
        
        this.ws = new WebSocket(wsUrl, wsOptions)

        this.ws.on("open", () => {
          this.isConnected = true
          console.log("[ScribeRealtimeClient] ✓ WebSocket connection opened")
        })

        this.ws.on("message", (data: WebSocketData) => {
          this.handleMessage(data)
        })

        this.ws.on("error", (error: any) => {
          const errorMsg = error?.message || String(error)
          console.error("[ScribeRealtimeClient] WebSocket error:", errorMsg)
          
          // Check for specific error codes
          if (errorMsg.includes("403") || errorMsg.includes("Forbidden")) {
            const detailedError = new Error(
              "Authentication failed (403). Check your ElevenLabs API key in .env (ELEVENLABS_API_KEY). " +
              "The API key may be invalid, expired, or doesn't have access to Scribe features."
            )
            console.error("[ScribeRealtimeClient] ✗ Authentication failed - invalid API key or insufficient permissions")
            if (this.onErrorCallback) {
              this.onErrorCallback(detailedError)
            }
            reject(detailedError)
          } else {
            if (this.onErrorCallback) {
              this.onErrorCallback(new Error(`WebSocket error: ${errorMsg}`))
            }
            reject(error)
          }
        })

        let closeCode: number | undefined = undefined
        let closeReason: string | undefined = undefined
        
        this.ws.on("close", (code?: number, reason?: Buffer) => {
          this.isConnected = false
          this.isStreaming = false
          this.sessionStarted = false
          
          closeCode = code
          closeReason = reason?.toString()
          
          if (code === 1006) {
            // Abnormal closure (often means connection was refused)
            console.log("[ScribeRealtimeClient] Connection closed abnormally (1006) - may indicate authentication failure")
          } else if (code === 1008) {
            // Policy violation (often means invalid API key)
            console.log("[ScribeRealtimeClient] Connection closed: Policy violation (1008) - likely invalid API key")
          } else if (code) {
            console.log(`[ScribeRealtimeClient] Connection closed with code: ${code}${reason ? `, reason: ${reason}` : ''}`)
          } else {
            console.log("[ScribeRealtimeClient] Connection closed")
          }
          
          // Reject promise if not already resolved
          if (!this.sessionStarted) {
            const errorMsg = closeCode === 1008 || closeCode === 1006
              ? "Connection failed - check your ElevenLabs API key (ELEVENLABS_API_KEY in .env)"
              : `Connection closed unexpectedly (code: ${closeCode || 'unknown'})`
            reject(new Error(errorMsg))
          }
        })

        // Resolve after session starts
        const checkSession = setInterval(() => {
          if (this.sessionStarted) {
            clearInterval(checkSession)
            resolve()
          }
        }, 100)

        // Timeout after 10 seconds
        setTimeout(() => {
          clearInterval(checkSession)
          if (!this.sessionStarted) {
            reject(new Error("Session start timeout"))
          }
        }, 10000)

      } catch (error) {
        console.error("[ScribeRealtimeClient] Connection failed:", error)
        reject(error)
      }
    })
  }

  /**
   * Handle incoming WebSocket messages
   * Events based on: https://elevenlabs.io/docs/cookbooks/speech-to-text/streaming
   */
  private handleMessage(data: WebSocketData): void {
    try {
      const message = JSON.parse(data.toString())
      
      switch (message.type) {
        case "session_started":
          this.handleSessionStarted(message)
          break
        
        case "partial_transcript":
          this.handlePartialTranscript(message)
          break
        
        case "committed_transcript":
          this.handleCommittedTranscript(message)
          break
        
        case "auth_error":
          console.error("[ScribeRealtimeClient] Auth error:", message)
          if (this.onErrorCallback) {
            this.onErrorCallback(new Error(`Authentication error: ${message.error || 'Invalid API key'}`))
          }
          break
        
        case "quota_exceeded":
          console.error("[ScribeRealtimeClient] Quota exceeded")
          if (this.onErrorCallback) {
            this.onErrorCallback(new Error("Usage quota exceeded"))
          }
          break
        
        case "transcriber_error":
        case "input_error":
        case "error":
          console.error("[ScribeRealtimeClient] Server error:", message)
          if (this.onErrorCallback) {
            this.onErrorCallback(new Error(message.error || message.message || "Server error"))
          }
          break
        
        default:
          console.log("[ScribeRealtimeClient] Unknown message type:", message.type)
      }
    } catch (error) {
      console.error("[ScribeRealtimeClient] Error parsing message:", error)
    }
  }

  /**
   * Handle session_started event
   */
  private handleSessionStarted(message: any): void {
    this.sessionStarted = true
    console.log("[ScribeRealtimeClient] ✓ Session started with config:", message.config)
  }

  /**
   * Handle partial_transcript (live updates during speech)
   */
  private handlePartialTranscript(message: any): void {
    const text = message.text || ""
    
    if (!text.trim()) return

    this.partialTranscript = text
    
    if (this.onTranscriptCallback) {
      this.onTranscriptCallback({
        type: "partial",
        text: text.trim(),
        timestamp: Date.now()
      })
    }
  }

  /**
   * Handle committed_transcript (finalized segments)
   */
  private handleCommittedTranscript(message: any): void {
    const text = message.text || ""
    
    if (!text.trim()) return

    console.log(`[ScribeRealtimeClient] Committed transcript: "${text.trim()}"`)
    
    // Check for wake word
    this.checkWakeWord(text.trim())
    
    // Detect if user is speaking (committed = finished speaking segment)
    // Signal that user just finished speaking
    if (this.onUserSpeakingCallback) {
      this.onUserSpeakingCallback(false)
    }
    
    // Send transcript event
    if (this.onTranscriptCallback) {
      this.onTranscriptCallback({
        type: "final",
        text: text.trim(),
        timestamp: Date.now()
      })
    }
    
    // Clear partial transcript
    this.partialTranscript = ""
  }

  /**
   * Check if transcript contains wake word
   */
  private checkWakeWord(text: string): void {
    const wakeWord = config.wakeWord.toLowerCase()
    const textLower = text.toLowerCase()
    
    if (textLower.includes(wakeWord)) {
      console.log(`[ScribeRealtimeClient] 🎤 Wake word detected: "${wakeWord}"`)
      if (this.onWakeWordCallback) {
        this.onWakeWordCallback()
      }
    }
  }

  /**
   * Stream audio data to Scribe v2
   * Format based on: https://elevenlabs.io/docs/cookbooks/speech-to-text/streaming
   * @param audioBuffer - PCM audio buffer (16-bit, 16kHz mono)
   */
  public streamAudio(audioBuffer: Buffer): void {
    if (!this.ws || !this.isConnected || !this.sessionStarted) {
      console.warn("[ScribeRealtimeClient] Cannot stream audio - not ready")
      return
    }

    try {
      // Convert audio to base64
      const audioBase64 = audioBuffer.toString("base64")
      
      // Send audio chunk in ElevenLabs format
      const message = {
        audio_base_64: audioBase64,
        sample_rate: 16000
      }
      
      this.ws.send(JSON.stringify(message))
    } catch (error) {
      console.error("[ScribeRealtimeClient] Error streaming audio:", error)
    }
  }

  /**
   * Manually commit the current transcript segment
   * Based on: https://elevenlabs.io/docs/cookbooks/speech-to-text/streaming
   */
  public commit(): void {
    if (!this.ws || !this.isConnected || !this.sessionStarted) {
      console.warn("[ScribeRealtimeClient] Cannot commit - not ready")
      return
    }

    try {
      this.ws.send(JSON.stringify({ commit: true }))
      console.log("[ScribeRealtimeClient] Manual commit sent")
    } catch (error) {
      console.error("[ScribeRealtimeClient] Error committing:", error)
    }
  }

  /**
   * Start audio streaming (would integrate with microphone in main process)
   */
  public startStreaming(): void {
    if (this.isStreaming) {
      console.log("[ScribeRealtimeClient] Already streaming")
      return
    }

    this.isStreaming = true
    console.log("[ScribeRealtimeClient] 🎤 Started audio streaming")
  }

  /**
   * Stop audio streaming
   */
  public stopStreaming(): void {
    if (!this.isStreaming) return

    this.isStreaming = false
    console.log("[ScribeRealtimeClient] 🎤 Stopped audio streaming")
  }

  /**
   * Disconnect from Scribe v2
   */
  public disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.isConnected = false
    this.isStreaming = false
    console.log("[ScribeRealtimeClient] Disconnected")
  }

  /**
   * Set callback for transcript events
   */
  public onTranscript(callback: (event: TranscriptEvent) => void): void {
    this.onTranscriptCallback = callback
  }

  /**
   * Set callback for wake word detection
   */
  public onWakeWord(callback: () => void): void {
    this.onWakeWordCallback = callback
  }

  /**
   * Set callback for user speaking events (VAD)
   */
  public onUserSpeaking(callback: (isSpeaking: boolean) => void): void {
    this.onUserSpeakingCallback = callback
  }

  /**
   * Set callback for errors
   */
  public onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback
  }

  /**
   * Get connection status
   */
  public getStatus(): { connected: boolean; streaming: boolean } {
    return {
      connected: this.isConnected,
      streaming: this.isStreaming
    }
  }

  /**
   * Clear partial transcript buffer
   */
  public clearTranscript(): void {
    this.partialTranscript = ""
  }
}

