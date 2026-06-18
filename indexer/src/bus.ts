import { EventEmitter as NodeEmitter } from "node:events";
import type { EventEmitter } from "./types.js";

/**
 * Tiny pub/sub bus bridging the ingest layer to WebSocket subscribers.
 * Channels: "fills" (every fill/trade), "depth" (book mutations).
 */
export class Bus implements EventEmitter {
  private inner = new NodeEmitter();

  constructor() {
    // depth/fills can fan out to many sockets
    this.inner.setMaxListeners(0);
  }

  emit(channel: string, payload: unknown): void {
    this.inner.emit(channel, payload);
  }

  on(channel: string, listener: (payload: unknown) => void): () => void {
    this.inner.on(channel, listener);
    return () => this.inner.off(channel, listener);
  }
}
