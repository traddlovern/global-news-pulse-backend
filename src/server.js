/**
 * server.js
 *
 * Main entry point. Wires together:
 *   GdeltPoller  →  scoring-engine  →  cache  →  WebSocket clients
 *
 * WebSocket protocol (server → client):
 *
 *   { type: "snapshot", pins: [...], updatedAt: ISO }   — sent on connect
 *   { type: "update",   pins: [...], updatedAt: ISO }   — sent on each poll cycle
 *   { type: "ping" }                                    — keepalive every 30s
 *
 * WebSocket protocol (client → server):
 *
 *   { type: "filter", categories: ["conflict","economy"] }  — filter pins
 *   { type: "pong" }                                        — keepalive reply
 *
 * HTTP endpoints (plain http, no framework):
 *
 *   GET /health          — { status, clients, lastUpdated, pinCount }
 *   GET /pins            — latest pin set as JSON (for non-WS clients)
 *   GET /pins/:country   — stories for a single country code
 */

import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GdeltPoller } from "./gdelt-poller.js";
import { processEvents } from "./scoring-engine.js";
import { createCache } from "./cache.js";
import { enrichPinsWithArticles } from "./gdelt-doc-api.js";
import { fetchAllFeeds, findArticlesForCountry, getCacheStats } from "./rss-fetcher.js";
import { fetchAllReliefWeb, findCrisesForCountry } from "./reliefweb.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const KEEPALIVE_MS = 30_000;

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log(" News Dashboard Backend");
  console.log("=".repeat(60));

  // 1. Cache (Redis or in-process)
  const cache = await createCache();

  // 2. State
  let lastUpdated = null;
  let currentPins = (await cache.getPins()) || [];
  if (currentPins.length) {
    console.log(`[server] restored ${currentPins.length} pins from cache`);
  }

  // 3. HTTP server
  const httpServer = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    if (url.pathname === "/health") {
      res.end(JSON.stringify({
        status: "ok",
        clients: wss.clients.size,
        lastUpdated,
        pinCount: currentPins.length,
        uptime: Math.round(process.uptime()),
      }));
      return;
    }

    if (url.pathname === "/pins") {
      res.end(JSON.stringify({ pins: currentPins, updatedAt: lastUpdated }));
      return;
    }

    // /pins/:countryCode — stories for one country
    const countryMatch = url.pathname.match(/^\/pins\/([A-Z]{2,3})$/i);
    if (countryMatch) {
      const code = countryMatch[1].toUpperCase();
      const pin = currentPins.find((p) => p.countryCode === code);
      if (pin) {
        res.end(JSON.stringify(pin));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "country not found" }));
      }
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  // 4. WebSocket server
  const wss = new WebSocketServer({ server: httpServer });

  // Track per-client filter state
  const clientFilters = new WeakMap();

  wss.on("connection", (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[ws] client connected — ${ip} (total: ${wss.clients.size})`);

    clientFilters.set(ws, null); // null = no filter = all categories

    // Send snapshot immediately
    safeSend(ws, {
      type: "snapshot",
      pins: filterPins(currentPins, null),
      updatedAt: lastUpdated,
      pinCount: currentPins.length,
    });

    // Handle client messages
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "filter") {
          const cats = Array.isArray(msg.categories) && msg.categories.length
            ? msg.categories
            : null;
          clientFilters.set(ws, cats);
          // Re-send filtered snapshot
          safeSend(ws, {
            type: "snapshot",
            pins: filterPins(currentPins, cats),
            updatedAt: lastUpdated,
            pinCount: currentPins.length,
          });
        }
        // pong — just ignore, keepalive handled by ws library
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      console.log(`[ws] client disconnected (total: ${wss.clients.size})`);
    });

    ws.on("error", (e) => {
      console.error("[ws] client error:", e.message);
    });
  });

  // Keepalive pings to all clients
  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        safeSend(ws, { type: "ping" });
      }
    }
  }, KEEPALIVE_MS);

  // 5. Subscribe to cache updates → broadcast to all clients
  await cache.subscribe((pins) => {
    currentPins = pins;
    lastUpdated = new Date().toISOString();
    let broadcast = 0;

    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const filter = clientFilters.get(ws);
      safeSend(ws, {
        type: "update",
        pins: filterPins(pins, filter),
        updatedAt: lastUpdated,
        pinCount: pins.length,
      });
      broadcast++;
    }
    console.log(`[server] broadcast update to ${broadcast} clients`);
  });

  // 6. GDELT poller
  const poller = new GdeltPoller();

  poller.on("events", async (rawEvents) => {
    console.log(`[server] processing ${rawEvents.length} raw events…`);
    const pins = processEvents(rawEvents);
    console.log(`[server] enriching top pins with real article titles…`);
    // Add ReliefWeb crisis data to each pin
    const pinsWithCrises = pins.map(pin => {
      const countryName = (pin.locationName || '').split(',').pop().trim()
      const { crises, reports } = findCrisesForCountry(countryName)
      return {
        ...pin,
        reliefweb: {
          activeCrises: crises.map(c => ({
            name: c.name,
            types: c.types,
            date: c.date,
            url: c.url,
          })),
          recentReports: reports.map(r => ({
            title: r.title,
            sources: r.sources,
            format: r.format,
            date: r.date,
            url: r.url,
          })),
        }
      }
    })

    // Enrich with RSS headlines first (tier 1 sources, real titles)
    const rssEnrichedPins = pinsWithCrises.map(pin => {
      const countryName = (pin.locationName || '').split(',').pop().trim()
      const articles = findArticlesForCountry(countryName, pin.locationName, 5)
      if (!articles.length) return pin

      // Use unique articles for each story — no duplicates
      const usedUrls = new Set()
      const updatedStories = pin.topStories.map((story, i) => {
        const article = articles.find(a => !usedUrls.has(a.url)) || null
        if (!article) return story
        usedUrls.add(article.url)
        // Always derive source name from actual URL domain
        let displaySource = article.source
        let sourceTier = 'unknown'
        try {
          const domain = new URL(article.url).hostname.replace('www.', '')
          // Map known domains to clean names and tiers
          const DOMAIN_MAP = {
            'bbc.com': ['BBC', 1], 'bbc.co.uk': ['BBC', 1],
            'theguardian.com': ['The Guardian', 1],
            'nytimes.com': ['NY Times', 1],
            'aljazeera.com': ['Al Jazeera', 1],
            'france24.com': ['France24', 1],
            'dw.com': ['DW', 1],
            'npr.org': ['NPR', 1],
            'foxnews.com': ['Fox News', 2],
            'nbcnews.com': ['NBC News', 1],
            'abcnews.go.com': ['ABC News', 1],
            'washingtonpost.com': ['Washington Post', 1],
            'cnbc.com': ['CNBC', 1],
            'foreignpolicy.com': ['Foreign Policy', 1],
            'rfi.fr': ['RFI', 1],
            'reuters.com': ['Reuters', 1],
            'apnews.com': ['AP News', 1],
            'cnn.com': ['CNN', 1],
            'ft.com': ['Financial Times', 1],
            'economist.com': ['The Economist', 1],
            'wsj.com': ['Wall Street Journal', 1],
            'bloomberg.com': ['Bloomberg', 1],
            'independent.co.uk': ['The Independent', 2],
            'telegraph.co.uk': ['The Telegraph', 2],
            'voanews.com': ['VOA News', 1],
            'rferl.org': ['Radio Free Europe', 1],
          }
          if (DOMAIN_MAP[domain]) {
            displaySource = DOMAIN_MAP[domain][0]
            sourceTier = DOMAIN_MAP[domain][1]
          } else {
            displaySource = domain
            sourceTier = 'unknown'
          }
        } catch {}
        return {
          ...story,
          headline: article.title,
          sourceUrl: article.url || story.sourceUrl,
          sourceName: displaySource,
          sourceTier,
          realTitle: true,
          description: article.description || null,
        }
      })
      return { ...pin, topStories: updatedStories }
    })

    // Fall back to GDELT DOC API for countries without RSS coverage
    const enrichedPins = await enrichPinsWithArticles(
      rssEnrichedPins.map(p => p.topStories[0]?.realTitle ? p : p),
      15
    )

    // Relevance filter: clear isAlert if top headlines don't mention the country
    enrichedPins.forEach(pin => {
      if (!pin.isAlert) return
      const countryName = (pin.locationName || '').split(',').pop().trim().toLowerCase()
      const countryCode = (pin.countryCode || '').toLowerCase()
      if (!countryName) return
      const topHeadlines = (pin.topStories || []).slice(0, 4).map(s => (s.headline || '').toLowerCase())
      const relevant = topHeadlines.some(h =>
        h.includes(countryName) ||
        h.includes(countryCode) ||
        (pin.locationName || '').split(',').some(part => h.includes(part.trim().toLowerCase()))
      )
      if (!relevant) {
        pin.isAlert = false
        console.log(`[server] dismissed false spike for ${pin.locationName} — headlines not relevant`)
      }
    });
    lastUpdated = new Date().toISOString();
    currentPins = enrichedPins;
    await cache.setPins(enrichedPins);
    console.log(
      `[server] scored → ${enrichedPins.length} country pins | ` +
        `top: ${enrichedPins[0]?.locationName} (${enrichedPins[0]?.score})`
    );
  });

  poller.on("error", (err) => {
    console.error("[server] poller error:", err.message);
  });

  // Fetch RSS feeds immediately and then every 15 minutes
  fetchAllFeeds()
  setInterval(fetchAllFeeds, 15 * 60 * 1000)

  // Fetch ReliefWeb crises immediately and then every hour
  fetchAllReliefWeb()
  setInterval(fetchAllReliefWeb, 60 * 60 * 1000)

  poller.start();

  // 7. Start listening
  httpServer.listen(PORT, () => {
    console.log(`\n  HTTP  http://localhost:${PORT}/health`);
    console.log(`  WS    ws://localhost:${PORT}`);
    console.log(`  Pins  http://localhost:${PORT}/pins`);
    console.log("\n  Waiting for first GDELT poll…\n");
  });

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`\n[server] ${sig} — shutting down`);
      poller.stop();
      await cache.quit();
      httpServer.close(() => process.exit(0));
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeSend(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch (e) {
    console.error("[ws] send error:", e.message);
  }
}

function filterPins(pins, categories) {
  if (!categories) return pins;
  return pins.filter((p) => categories.includes(p.dominantCategory));
}

// ─── Go ───────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
