import { execSync } from "child_process"

// Use require() directly to handle CommonJS module properly
const nodeRecord = require("node-record-lpcm16")

export class MicrophoneHelper {
  private recording: any = null
  private isRecording: boolean = false
  private onAudioChunkCallback: ((audioBuffer: Buffer) => void) | null = null

  /**
   * Check if SoX is installed (required for node-record-lpcm16)
   */
  private checkSoXInstalled(): boolean {
    try {
      execSync("which sox", { stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the record function from the module
   * Handles different export patterns (default, direct, etc.)
   */
  private getRecordFunction(): any {
    // Try different ways the module might export the function
    if (typeof nodeRecord === "function") {
      return nodeRecord
    }
    if (nodeRecord && typeof nodeRecord.default === "function") {
      return nodeRecord.default
    }
    if (nodeRecord && typeof nodeRecord.record === "function") {
      return nodeRecord.record
    }
    // If it's an object, try to find any function property
    if (typeof nodeRecord === "object" && nodeRecord !== null) {
      for (const key in nodeRecord) {
        if (typeof nodeRecord[key] === "function") {
          return nodeRecord[key]
        }
      }
    }
    throw new Error(`Could not find record function in node-record-lpcm16. Module type: ${typeof nodeRecord}, keys: ${nodeRecord ? Object.keys(nodeRecord).join(", ") : "null"}`)
  }

  /**
   * Start recording from microphone
   * Outputs PCM 16kHz mono audio (perfect for Scribe v2)
   */
  public start(): void {
    if (this.isRecording) {
      console.log("[MicrophoneHelper] Already recording")
      return
    }

    console.log("[MicrophoneHelper] Starting microphone capture...")

    // Check if SoX is installed
    if (!this.checkSoXInstalled()) {
      const errorMsg = "SoX is not installed. Please install it with: brew install sox"
      console.error(`[MicrophoneHelper] ✗ ${errorMsg}`)
      throw new Error(errorMsg)
    }
    console.log("[MicrophoneHelper] ✓ SoX is installed")
    
    console.log("[MicrophoneHelper] Checking if record function is available...")
    console.log("[MicrophoneHelper] nodeRecord type:", typeof nodeRecord)
    console.log("[MicrophoneHelper] nodeRecord value:", nodeRecord)
    if (typeof nodeRecord === "object" && nodeRecord !== null) {
      console.log("[MicrophoneHelper] nodeRecord keys:", Object.keys(nodeRecord))
    }

    try {
      const record = this.getRecordFunction()
      console.log("[MicrophoneHelper] ✓ Found record function, type:", typeof record)

      console.log("[MicrophoneHelper] Calling record() with options...")
      this.recording = record({
        sampleRate: 16000,       // 16kHz (required by Scribe v2)
        channels: 1,             // Mono
        audioType: "raw",        // Raw PCM data
        threshold: 0,            // Start immediately
        silence: "0",            // No silence detection (Scribe handles this)
        recorder: "sox",         // Use SoX (cross-platform)
        endOnSilence: false
      })

      console.log("[MicrophoneHelper] record() returned:", typeof this.recording)

      if (!this.recording) {
        throw new Error("record() returned null or undefined")
      }

      // The recording object has a _stream property which is the actual readable stream
      const audioStream = (this.recording as any)._stream || this.recording
      
      if (!audioStream || typeof audioStream.on !== "function") {
        console.error("[MicrophoneHelper] Recording object structure:", {
          hasStream: !!this.recording._stream,
          streamType: typeof (this.recording as any)._stream,
          recordingType: typeof this.recording,
          recordingKeys: Object.keys(this.recording || {})
        })
        throw new Error("Recording object does not have a valid stream. Expected _stream property or recording to be a stream.")
      }

      this.isRecording = true
      console.log("[MicrophoneHelper] Setting up event listeners on audio stream...")

      // Stream audio chunks from the actual stream
      let chunkCount = 0
      audioStream
        .on("data", (chunk: Buffer) => {
          // chunk is PCM 16-bit 16kHz mono audio
          chunkCount++
          // Log first chunk and every 100th chunk to avoid spam (roughly every 2-3 seconds at 16kHz)
          if (chunkCount === 1 || chunkCount % 100 === 0) {
            console.log(`[MicrophoneHelper] 🎤 Audio chunk received (${chunk.length} bytes) - recording active (${chunkCount} chunks)`)
          }
          if (this.onAudioChunkCallback) {
            this.onAudioChunkCallback(chunk)
          } else {
            if (chunkCount === 1) {
              console.warn("[MicrophoneHelper] ⚠️  No audio chunk callback registered!")
            }
          }
        })
        .on("error", (error: Error) => {
          console.error("[MicrophoneHelper] Recording error:", error)
          console.error("[MicrophoneHelper] Error details:", error.message, error.stack)
          
          // Check for common macOS microphone permission issues
          if (error.message && error.message.includes("sox has exited")) {
            console.error("[MicrophoneHelper] ⚠️  SoX error detected - this often indicates:")
            console.error("[MicrophoneHelper]   1. Microphone permissions not granted")
            console.error("[MicrophoneHelper]   2. Microphone is being used by another app")
            console.error("[MicrophoneHelper]   3. No microphone available")
            console.error("[MicrophoneHelper]   → Check System Settings > Privacy & Security > Microphone")
          }
          
          this.stop()
        })
        .on("end", () => {
          console.log("[MicrophoneHelper] Recording stream ended")
          this.isRecording = false
        })

      console.log("[MicrophoneHelper] ✓ Microphone recording started - waiting for audio...")
    } catch (error) {
      console.error("[MicrophoneHelper] ✗ Failed to start microphone:", error)
      this.isRecording = false
      this.recording = null
      throw error
    }
  }

  /**
   * Stop recording
   */
  public stop(): void {
    if (!this.isRecording || !this.recording) {
      return
    }

    console.log("[MicrophoneHelper] Stopping microphone capture...")
    
    try {
      // Try to stop the recorder (if it has a stop method)
      if (typeof this.recording.stop === "function") {
        this.recording.stop()
      }
      
      // Also try to stop the process if it exists
      if (this.recording.process && typeof this.recording.process.kill === "function") {
        this.recording.process.kill()
      }
      
      // Try to destroy the stream
      const audioStream = (this.recording as any)._stream || this.recording
      if (audioStream && typeof audioStream.destroy === "function") {
        audioStream.destroy()
      }
    } catch (error) {
      console.error("[MicrophoneHelper] Error stopping recorder:", error)
    }
    
    this.recording = null
    this.isRecording = false

    console.log("[MicrophoneHelper] ✓ Microphone stopped")
  }

  /**
   * Set callback for audio chunks
   */
  public onAudioChunk(callback: (audioBuffer: Buffer) => void): void {
    this.onAudioChunkCallback = callback
  }

  /**
   * Check if recording
   */
  public getIsRecording(): boolean {
    return this.isRecording
  }
}

