// Type definitions for ws WebSocket library
declare module "ws" {
  import { EventEmitter } from "events"

  export type Data = string | Buffer | ArrayBuffer | Buffer[]

  export interface WebSocketOptions {
    headers?: Record<string, string>
  }

  export default class WebSocket extends EventEmitter {
    static Data: Data  // Allow WebSocket.Data type reference
    
    constructor(address: string, options?: WebSocketOptions)
    
    on(event: "open", listener: () => void): this
    on(event: "message", listener: (data: Data) => void): this
    on(event: "error", listener: (error: Error) => void): this
    on(event: "close", listener: () => void): this
    
    send(data: string | Buffer): void
    close(): void
  }
}

