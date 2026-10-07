import type { EnclaveChannel } from "@badge/attest";
import type { Clock } from "./clock";
import { SecurityError } from "./errors";

/** A channel unused for this long is forgotten; the SDK then opens (and attests) a new one transparently. */
export const DEFAULT_CHANNEL_IDLE_TTL_MS = 15 * 60_000;
/**
 * Open channels kept in memory. Opening is unauthenticated, so when full the enclave refuses new channels instead
 * of evicting live ones: a flood of opens cannot cut existing users off, and idle entries free up after the TTL.
 */
export const DEFAULT_MAX_CHANNELS = 10_000;

interface Entry {
  channel: EnclaveChannel;
  lastUsed: number;
}

/** In-memory table of open attested channels (keys never leave the enclave's memory, nothing is persisted). */
export class ChannelTable {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly clock: Clock,
    private readonly idleTtlMs = DEFAULT_CHANNEL_IDLE_TTL_MS,
    private readonly capacity = DEFAULT_MAX_CHANNELS,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /**
   * Registers a freshly accepted channel.
   * @throws SecurityError("channel_exists") when the id is taken: re-opening the same hello would reset the
   * channel's sequence numbers and make its past messages replayable. ("channel_capacity") when full.
   */
  add(channel: EnclaveChannel): void {
    const now = this.clock.now();
    this.evictIdle(now);
    if (this.entries.has(channel.channelId)) {
      throw new SecurityError("channel_exists", 409, "this handshake was already used: open a new channel");
    }
    if (this.entries.size >= this.capacity) {
      throw new SecurityError("channel_capacity", 503, "too many open channels, retry shortly");
    }
    this.entries.set(channel.channelId, { channel, lastUsed: now });
  }

  /** Whether `channelId` is open (expired entries count as absent). */
  has(channelId: string): boolean {
    return this.lookup(channelId, this.clock.now()) !== undefined;
  }

  /**
   * Returns an open channel and refreshes its idle timer.
   * @throws SecurityError("channel_unknown") when unknown or idle for too long (the SDK reopens on this code).
   */
  get(channelId: string): EnclaveChannel {
    const now = this.clock.now();
    const entry = this.lookup(channelId, now);
    if (!entry) throw new SecurityError("channel_unknown", 404, "unknown or expired channel: open a new one");
    entry.lastUsed = now;
    return entry.channel;
  }

  private lookup(channelId: string, now: number): Entry | undefined {
    const entry = this.entries.get(channelId);
    if (!entry) return undefined;
    if (now - entry.lastUsed > this.idleTtlMs) {
      this.entries.delete(channelId);
      return undefined;
    }
    return entry;
  }

  private evictIdle(now: number): void {
    for (const [id, entry] of this.entries) {
      if (now - entry.lastUsed > this.idleTtlMs) this.entries.delete(id);
    }
  }
}
