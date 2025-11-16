// Type definitions for node-record-lpcm16
declare module "node-record-lpcm16" {
  import { Readable } from "stream"

  interface RecordOptions {
    sampleRate?: number
    channels?: number
    audioType?: string
    threshold?: number
    silence?: string
    recorder?: string
    endOnSilence?: boolean
    device?: string | null
  }

  interface Recording extends Readable {
    stop(): void
    pause(): void
    resume(): void
  }

  function record(options?: RecordOptions): Recording
  
  namespace record {
    function stop(): void
  }

  export = record
}

