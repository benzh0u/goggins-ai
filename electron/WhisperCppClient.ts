import { TranscriptEvent } from "../src/types/activity"
import { config } from "./config"

export class WhisperCppClient {
  private pipeline: any | null = null
  private isInitialized: boolean = false
  private isStreaming: boolean = false
  private audioBuffer: Buffer[] = []
  private processingInterval: NodeJS.Timeout | null = null
  
  // Audio buffer settings - process every 3.5 seconds for better transcription accuracy
  private readonly CHUNK_DURATION_MS = 3500 // Process every 3.5 seconds for better context and accuracy
  private readonly SAMPLE_RATE = 16000
  private readonly BYTES_PER_SAMPLE = 2 // 16-bit = 2 bytes
  private readonly MIN_AUDIO_BYTES = (this.SAMPLE_RATE * this.BYTES_PER_SAMPLE * 3) // At least 3 seconds of audio for better accuracy
  
  // VAD (Voice Activity Detection) settings
  private readonly TRANSCRIPT_SILENCE_THRESHOLD_MS = 1500 // Wait 1.5 seconds after last transcript chunk before sending
  private readonly SPEECH_AMPLITUDE_THRESHOLD = 0.015 // Audio amplitude above this = speech (lowered from 0.02 for quieter speech)
  private lastTranscriptChunkTime: number = 0 // Track when we last got a transcript chunk (not just speech)
  private pendingTranscript: string = ""
  private transcriptCheckInterval: NodeJS.Timeout | null = null
  
  // Callbacks
  private onTranscriptCallback: ((event: TranscriptEvent) => void) | null = null
  private onWakeWordCallback: (() => void) | null = null
  private onUserSpeakingCallback: ((isSpeaking: boolean) => void) | null = null
  private onErrorCallback: ((error: Error) => void) | null = null
  private lastTranscriptTime: number = 0
  private isUserSpeaking: boolean = false

  constructor() {
    console.log("[WhisperCppClient] Initializing Whisper client...")
  }

  /**
   * Initialize Whisper model
   */
  public async connect(): Promise<void> {
    if (this.isInitialized) {
      console.log("[WhisperCppClient] Already initialized")
      return
    }

    try {
      console.log("[WhisperCppClient] Loading Whisper model (first time may download ~39MB)...")
      console.log("[WhisperCppClient] This may take 30-60 seconds on first run...")
      
      // Dynamic import for ES Module compatibility
      // Use Function constructor to prevent TypeScript from transforming import() to require()
      // This is necessary because @xenova/transformers is an ES Module and TypeScript
      // compiles import() to require() in CommonJS mode, which fails for ES modules
      const dynamicImport = new Function('specifier', 'return import(specifier)')
      const transformersModule = await dynamicImport('@xenova/transformers')
      const { pipeline } = transformersModule
      
      // Model options (from fastest to most accurate):
      // - "Xenova/whisper-tiny.en" - Fastest, ~39MB, too small, misses speech
      // - "Xenova/whisper-base.en" - Balanced, ~74MB (BEST for stability + decent accuracy)
      // - "Xenova/whisper-small.en" - Better accuracy, ~244MB (CRASHES in Electron - too memory intensive)
      // - "Xenova/whisper-medium.en" - Best accuracy, ~769MB, way too slow
      
      // Create pipeline - @xenova/transformers uses CPU by default in Node.js
      // Options are passed to the pipeline call, not the constructor
      console.log("[WhisperCppClient] Loading whisper-base.en model (stable + decent accuracy)...")
      this.pipeline = await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-base.en" // Use base - small model causes SIGTRAP crashes
      )

      this.isInitialized = true
      console.log("[WhisperCppClient] ✓ Whisper model loaded successfully")
    } catch (error) {
      console.error("[WhisperCppClient] ✗ Failed to initialize:", error)
      throw new Error(`Failed to initialize Whisper: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Start audio streaming and processing
   */
  public startStreaming(): void {
    if (this.isStreaming) {
      console.log("[WhisperCppClient] Already streaming")
      return
    }

    if (!this.isInitialized || !this.pipeline) {
      throw new Error("Whisper not initialized. Call connect() first.")
    }

    this.isStreaming = true
    this.audioBuffer = []
    this.lastTranscriptTime = Date.now()
    this.lastTranscriptChunkTime = 0
    this.pendingTranscript = ""
    
    // Process audio buffer periodically for live transcription
    this.processingInterval = setInterval(() => {
      this.processAudioBuffer()
    }, this.CHUNK_DURATION_MS)

    // Check periodically if we should send pending transcript (after transcription stops)
    this.transcriptCheckInterval = setInterval(() => {
      this.checkTranscriptTimeout()
    }, 500) // Check every 500ms

    console.log(`[WhisperCppClient] 🎤 Started audio streaming (live transcription, processing every ${this.CHUNK_DURATION_MS}ms)`)
  }

  /**
   * Stream audio data (called by MicrophoneHelper)
   * @param audioBuffer - PCM audio buffer (16-bit, 16kHz mono)
   */
  public streamAudio(audioBuffer: Buffer): void {
    if (!this.isStreaming) {
      return
    }

    // Accumulate audio chunks
    this.audioBuffer.push(audioBuffer)
    
    // Log buffer size periodically (every ~5 chunks to avoid spam)
    if (this.audioBuffer.length % 5 === 0 && this.audioBuffer.length > 0) {
      const totalBytes = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0)
      const secondsBuffered = (totalBytes / (this.SAMPLE_RATE * this.BYTES_PER_SAMPLE)).toFixed(2)
      console.log(`[WhisperCppClient] 📊 Audio buffer: ${this.audioBuffer.length} chunks, ${secondsBuffered}s buffered`)
    }
  }

  /**
   * Process accumulated audio buffer
   */
  private async processAudioBuffer(): Promise<void> {
    if (!this.pipeline || this.audioBuffer.length === 0) {
      return
    }

    try {
      // Combine audio chunks
      const combinedAudio = Buffer.concat(this.audioBuffer)
      
      // Need at least 1 second of audio for processing
      if (combinedAudio.length < this.MIN_AUDIO_BYTES) {
        return
      }

      // Convert PCM buffer to Float32Array for Whisper
      const float32Audio = this.pcmToFloat32(combinedAudio)
      
      // Calculate audio level (RMS) to detect if there's actual sound
      const rms = Math.sqrt(
        float32Audio.reduce((sum, sample) => sum + sample * sample, 0) / float32Audio.length
      )
      const db = 20 * Math.log10(rms + 1e-10) // Convert to dB, avoid log(0)
      const maxAmplitude = Math.max(...float32Audio.map(Math.abs))
      
      // Keep last 1 second in buffer for overlap (smoother transitions in live transcription with better context)
      const keepBytes = Math.floor(this.SAMPLE_RATE * this.BYTES_PER_SAMPLE * 1.0)
      const processedBytes = combinedAudio.length - keepBytes
      
      if (processedBytes > 0) {
        this.audioBuffer = [combinedAudio.slice(-keepBytes)]
      } else {
        this.audioBuffer = []
      }

      // Skip processing if audio is effectively silence / extremely quiet
      if (maxAmplitude < 0.005) {
        return
      }

      const audioDuration = (float32Audio.length / this.SAMPLE_RATE).toFixed(2)
      console.log(`[WhisperCppClient] Processing ${audioDuration}s of audio...`)
      console.log(`[WhisperCppClient] Audio levels: RMS=${rms.toFixed(4)}, dB=${db.toFixed(1)}, Max=${maxAmplitude.toFixed(4)} ${maxAmplitude < 0.005 ? '(⚠️ VERY QUIET)' : maxAmplitude < 0.1 ? '(⚠️ quiet)' : '(✓ normal)'}`)
      
      // Process with Whisper - optimized for better accuracy with small model
      // Adjusted parameters for 3-4 second audio segments with better context
      const startTime = Date.now()
      const result: any = await this.pipeline(float32Audio, {
        return_timestamps: false, // Disable timestamps for faster processing
        chunk_length_s: 30, // Process in 30s chunks (longer chunks = better context)
        stride_length_s: 3, // Reduced stride for better accuracy with small model
        language: "en",
        task: "transcribe"
        // Note: @xenova/transformers doesn't support best_of, temperature like Python Whisper
      })

      const processingTime = Date.now() - startTime
      let text = result?.text?.trim() || ""
      
      // Clean up common Whisper artifacts and filter out meaningless transcripts
      if (text) {
        // Filter out very short transcripts (single chars, symbols) - these are usually noise
        const cleanedText = text.trim()
        if (cleanedText.length < 2) {
          console.log(`[WhisperCppClient] ⚠️  Filtered out too short transcript: "${text}" (length: ${cleanedText.length})`)
          text = ""
        } else if (/^[^a-zA-Z]{1,2}$/.test(cleanedText)) {
          // Filter out transcripts that are only symbols (like "*", "\", "?", etc.)
          console.log(`[WhisperCppClient] ⚠️  Filtered out symbol-only transcript: "${text}"`)
          text = ""
        } else if (/^\*.*\*$/i.test(cleanedText) || /inaudible/i.test(cleanedText)) {
          // Filter out placeholder transcripts like "*Inaudible*", "*unclear*", "inaudible", etc.
          console.log(`[WhisperCppClient] ⚠️  Filtered out placeholder transcript: "${text}"`)
          text = ""
        } else {
          // Remove common false positives like "Thank you for watching", etc.
          const falsePositives = [
            "thank you for watching",
            "thanks for watching",
            "subscribe",
            "like and subscribe"
          ]
          const textLower = cleanedText.toLowerCase()
          const isFalsePositive = falsePositives.some(fp => textLower.includes(fp))
          
          if (isFalsePositive && cleanedText.length < 20) {
            console.log(`[WhisperCppClient] ⚠️  Filtered out likely false positive: "${text}"`)
            text = ""
          }
        }
      }
      
      if (text) {
        console.log(`[WhisperCppClient] ✅ TRANSCRIPT CHUNK (${processingTime}ms): "${text}"`)
        
        // VAD: Accumulate transcript instead of sending immediately
        // Add to pending transcript with a space if there's already content
        if (this.pendingTranscript) {
          this.pendingTranscript += " " + text
        } else {
          this.pendingTranscript = text
        }
        
        // Update the last transcript chunk time - this is when we last got NEW text
        const now = Date.now()
        this.lastTranscriptChunkTime = now
        
        console.log(`[WhisperCppClient] 📝 Accumulated: "${this.pendingTranscript}" (waiting for transcription to stop...)`)
        
        // Update speech detection
        this.isUserSpeaking = true
        if (this.onUserSpeakingCallback) {
          this.onUserSpeakingCallback(true)
        }
        
        this.lastTranscriptTime = now
        
        // Check for wake word in accumulated transcript
        this.checkWakeWord(this.pendingTranscript)
      } else {
        // Log more details when no transcript is found
        const rms = Math.sqrt(
          float32Audio.reduce((sum, sample) => sum + sample * sample, 0) / float32Audio.length
        )
        const db = 20 * Math.log10(rms + 1e-10)
        const maxAmplitude = Math.max(...float32Audio.map(Math.abs))
        console.log(`[WhisperCppClient] ⚠️  No transcript found (${processingTime}ms)`)
        console.log(`[WhisperCppClient]   Audio levels: RMS=${rms.toFixed(4)}, dB=${db.toFixed(1)}, Max=${maxAmplitude.toFixed(4)}`)
        if (maxAmplitude < 0.005) {
          console.log(`[WhisperCppClient]   ⚠️  Audio is very quiet (max amplitude < 0.005) - check microphone input level`)
        } else if (maxAmplitude < 0.1) {
          console.log(`[WhisperCppClient]   ⚠️  Audio is quiet (max amplitude < 0.1) - try speaking louder or closer to mic`)
        } else {
          console.log(`[WhisperCppClient]   ℹ️  Audio levels seem normal - may need clearer speech or less background noise`)
        }
      }
    } catch (error) {
      console.error("[WhisperCppClient] Error processing audio:", error)
      if (this.onErrorCallback) {
        this.onErrorCallback(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  /**
   * Convert PCM 16-bit buffer to Float32Array (normalized to -1.0 to 1.0)
   */
  private pcmToFloat32(buffer: Buffer): Float32Array {
    const float32 = new Float32Array(buffer.length / this.BYTES_PER_SAMPLE)
    for (let i = 0; i < buffer.length; i += this.BYTES_PER_SAMPLE) {
      const int16 = buffer.readInt16LE(i)
      // Normalize from [-32768, 32767] to [-1.0, 1.0]
      float32[i / this.BYTES_PER_SAMPLE] = Math.max(-1, Math.min(1, int16 / 32768.0))
    }
    return float32
  }

  /**
   * Check if enough time has passed since last transcript chunk
   * If yes, send the pending transcript
   */
  private checkTranscriptTimeout(): void {
    // Only check if we have a pending transcript and we've received at least one chunk
    if (!this.pendingTranscript || this.lastTranscriptChunkTime === 0) {
      return
    }

    // Calculate how long it's been since we got the last transcript chunk
    const timeSinceLastChunk = Date.now() - this.lastTranscriptChunkTime
    
    // If no new transcript chunks for 1.5 seconds, send the accumulated transcript
    if (timeSinceLastChunk >= this.TRANSCRIPT_SILENCE_THRESHOLD_MS) {
      console.log(`[WhisperCppClient] ✓ No new transcript for ${timeSinceLastChunk}ms - sending accumulated transcript`)
      this.sendPendingTranscript()
    }
  }

  /**
   * Check if transcript contains wake word
   */
  private checkWakeWord(text: string): void {
    const wakeWord = config.wakeWord.toLowerCase()
    const textLower = text.toLowerCase()
    
    if (textLower.includes(wakeWord)) {
      console.log(`[WhisperCppClient] 🎤 Wake word detected: "${wakeWord}"`)
      
      // Immediately send pending transcript when wake word is detected
      // Don't wait for silence - the wake word itself is a strong signal
      if (this.pendingTranscript && this.pendingTranscript.trim().length > 0) {
        console.log(`[WhisperCppClient] 🚀 Wake word triggered - sending pending transcript immediately`)
        this.sendPendingTranscript()
      }
      
      if (this.onWakeWordCallback) {
        this.onWakeWordCallback()
      }
    }
  }

  /**
   * Stop audio streaming
   */
  public stopStreaming(): void {
    if (!this.isStreaming) return

    this.isStreaming = false
    this.audioBuffer = []
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval)
      this.processingInterval = null
    }

    if (this.transcriptCheckInterval) {
      clearInterval(this.transcriptCheckInterval)
      this.transcriptCheckInterval = null
    }

    console.log("[WhisperCppClient] 🎤 Stopped audio streaming")
  }

  /**
   * Disconnect and cleanup
   */
  public disconnect(): void {
    this.stopStreaming()
    this.pipeline = null
    this.isInitialized = false
    console.log("[WhisperCppClient] Disconnected")
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
   * Set callback for user speaking events (VAD-like)
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
      connected: this.isInitialized,
      streaming: this.isStreaming
    }
  }

  /**
   * Clear transcript buffer
   */
  public clearTranscript(): void {
    // Clear audio buffer to prevent processing old audio (e.g., when Goggins starts speaking)
    console.log(`[WhisperCppClient] 🧹 Clearing audio buffer (${this.audioBuffer.length} chunks)`)
    this.audioBuffer = []
  }

  /**
   * Send accumulated pending transcript after detecting silence
   */
  private sendPendingTranscript(): void {
    if (!this.pendingTranscript || !this.onTranscriptCallback) {
      return
    }
    
    const finalText = this.pendingTranscript.trim()
    console.log(`[WhisperCppClient] 📤 SENDING FINAL TRANSCRIPT: "${finalText}"`)
    
    try {
      this.onTranscriptCallback({
        type: "final",
        text: finalText,
        timestamp: Date.now()
      })
      console.log(`[WhisperCppClient] ✅ Transcript callback executed successfully`)
      
      // Clear pending transcript after sending
      this.pendingTranscript = ""
      
      // Update speaking status
      this.isUserSpeaking = false
      if (this.onUserSpeakingCallback) {
        this.onUserSpeakingCallback(false)
      }
    } catch (error) {
      console.error(`[WhisperCppClient] ✗ Error in transcript callback:`, error)
    }
  }

  /**
   * Manually commit current transcript (for compatibility)
   */
  public commit(): void {
    // Trigger immediate processing
    if (this.isStreaming && this.audioBuffer.length > 0) {
      this.processAudioBuffer()
    }
  }
}

