/**
 * cache.js
 *
 * Redis layer with two responsibilities:
 *
 *   1. State cache   — stores the latest processed pin set so new WebSocket
 *      clients can get a full snapshot on connect without waiting for the
 *      next GDELT poll cycle.
 *
 *   2. Pub/sub       — when the poller produces a new pin set, it publishes
 *      to a Redis channel. The WebSocket server subscribes and fans the
 *      update out to all connected browsers.
 *
 * If Redis is unavailable the module degrades gracefully to an in-process
 * Map so the server still works in development without a Redis instance.
 */

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const PINS_KEY = "newsdash:pins";
const CHANNEL = "newsdash:updates";
const TTL_SECONDS = 2 * 60 * 60; // 2 hours — keep at least one full cycle

// ─── In-process fallback (no Redis) ──────────────────────────────────────────

class MemoryCache {
  constructor() {
    this._store = new Map();
    this._subscribers = [];
    console.warn("[cache] Redis unavailable — using in-process memory cache");
  }

  async setPins(pins) {
    this._store.set(PINS_KEY, JSON.stringify(pins));
    for (const fn of this._subscribers) fn(pins);
  }

  async getPins() {
    const raw = this._store.get(PINS_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  async subscribe(callback) {
    this._subscribers.push(callback);
    return () => {
      this._subscribers = this._subscribers.filter((fn) => fn !== callback);
    };
  }

  async ping() { return "PONG"; }
  async quit() {}
}

// ─── Redis-backed cache ───────────────────────────────────────────────────────

class RedisCache {
  constructor() {
    // Separate connections for pub and sub (ioredis requirement)
    this._pub = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    this._sub = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

    this._pub.on("error", (e) => console.error("[cache:pub]", e.message));
    this._sub.on("error", (e) => console.error("[cache:sub]", e.message));
  }

  async connect() {
    await this._pub.connect();
    await this._sub.connect();
  }

  /** Store the latest pin set and notify all subscribers */
  async setPins(pins) {
    const payload = JSON.stringify(pins);
    await this._pub.set(PINS_KEY, payload, "EX", TTL_SECONDS);
    await this._pub.publish(CHANNEL, payload);
    console.log(`[cache] stored ${pins.length} pins, published to ${CHANNEL}`);
  }

  /** Get the most recently stored pin set (may be null on first run) */
  async getPins() {
    const raw = await this._pub.get(PINS_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  /**
   * Subscribe to pin updates.
   * @param {function(pins: object[]): void} callback
   * @returns {function} unsubscribe
   */
  async subscribe(callback) {
    await this._sub.subscribe(CHANNEL);
    const handler = (channel, message) => {
      if (channel !== CHANNEL) return;
      try {
        callback(JSON.parse(message));
      } catch (e) {
        console.error("[cache] subscribe parse error:", e.message);
      }
    };
    this._sub.on("message", handler);
    return () => this._sub.off("message", handler);
  }

  async ping() { return this._pub.ping(); }

  async quit() {
    await this._pub.quit();
    await this._sub.quit();
  }
}

// ─── Factory: try Redis, fall back to memory ──────────────────────────────────

export async function createCache() {
  if (process.env.NO_REDIS === "true") {
    return new MemoryCache();
  }

  const cache = new RedisCache();
  try {
    await cache.connect();
    const pong = await cache.ping();
    console.log(`[cache] Redis connected — ${pong}`);
    return cache;
  } catch (err) {
    console.warn("[cache] Redis connect failed:", err.message);
    await cache.quit().catch(() => {});
    return new MemoryCache();
  }
}
