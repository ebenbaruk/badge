import type { EnclaveChannel } from "@badge/attest";
import type { Clock } from "./clock";
import { SecurityError } from "./errors";

/** A channel unused for this long is forgotten; the SDK then opens (and attests) a new one transparently. */
export const DEFAULT_CHANNEL_IDLE_TTL_MS = 15 * 60_000;
/**
 * A channel that never carried a message is forgotten much sooner: a real client sends its first request right
 * after verifying the quote, while a flood of unauthenticated opens would otherwise hold slots for the idle TTL.
 */
export const DEFAULT_UNUSED_CHANNEL_TTL_MS = 30_000;
/**
 * Open channels kept in memory. Opening is unauthenticated, so when full the enclave first drops the oldest channel
 * that never carried a message, and only refuses new channels when every slot is in use: a flood of opens can
 * neither cut existing users off nor keep the table full (a dropped client gets CHANNEL_UNKNOWN and reopens).
 */
export const DEFAULT_MAX_CHANNELS = 10_000;

interface Entry {
  channel: EnclaveChannel;
  lastUsed: number;
  /** Whether at least one message went through (an authenticated or at least decryptable request). */
  used: boolean;
}

/** In-memory table of open attested channels (keys never leave the enclave's memory, nothing is persisted). */
export class ChannelTable {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly clock: Clock,
    private readonly idleTtlMs = DEFAULT_CHANNEL_IDLE_TTL_MS,
    private readonly capacity = DEFAULT_MAX_CHANNELS,
    private readonly unusedTtlMs = Math.min(DEFAULT_UNUSED_CHANNEL_TTL_MS, idleTtlMs),
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /**
   * Registers a freshly accepted channel.
   * @throws SecurityError("CHANNEL_EXISTS") when the id is taken: re-opening the same hello would reset the
   * channel's sequence numbers and make its past messages replayable. ("CHANNEL_CAPACITY") when every slot holds
   * a channel already in use.
   */
  add(channel: EnclaveChannel): void {
    const now = this.clock.now();
    this.evictIdle(now);
    if (this.entries.has(channel.channelId)) {
      throw new SecurityError("CHANNEL_EXISTS", 409, "this handshake was already used: open a new channel");
    }
    if (this.entries.size >= this.capacity && !this.evictOldestUnused()) {
      throw new SecurityError("CHANNEL_CAPACITY", 503, "too many open channels, retry shortly");
    }
    this.entries.set(channel.channelId, { channel, lastUsed: now, used: false });
  }

  /** Whether `channelId` is open (expired entries count as absent). */
  has(channelId: string): boolean {
    return this.lookup(channelId, this.clock.now()) !== undefined;
  }

  /**
   * Returns an open channel and refreshes its idle timer.
   * @throws SecurityError("CHANNEL_UNKNOWN") when unknown or idle for too long (the SDK reopens on this code).
   */
  get(channelId: string): EnclaveChannel {
    const now = this.clock.now();
    const entry = this.lookup(channelId, now);
    if (!entry) throw new SecurityError("CHANNEL_UNKNOWN", 404, "unknown or expired channel: open a new one");
    entry.lastUsed = now;
    entry.used = true;
    return entry.channel;
  }

  private lookup(channelId: string, now: number): Entry | undefined {
    const entry = this.entries.get(channelId);
    if (!entry) return undefined;
    if (this.isExpired(entry, now)) {
      this.entries.delete(channelId);
      return undefined;
    }
    return entry;
  }

  private isExpired(entry: Entry, now: number): boolean {
    return now - entry.lastUsed > (entry.used ? this.idleTtlMs : this.unusedTtlMs);
  }

  private evictIdle(now: number): void {
    for (const [id, entry] of this.entries) {
      if (this.isExpired(entry, now)) this.entries.delete(id);
    }
  }

  /** Drops the oldest never-used channel (Map order = opening order); false when every channel is in use. */
  private evictOldestUnused(): boolean {
    for (const [id, entry] of this.entries) {
      if (entry.used) continue;
      this.entries.delete(id);
      return true;
    }
    return false;
  }
}
