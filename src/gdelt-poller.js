/**
 * gdelt-poller.js
 *
 * Fetches the two GDELT feeds on a 15-minute cadence (matching GDELT's own
 * update frequency) and emits enriched, geo-tagged event objects.
 *
 * GDELT publishes two CSV files every 15 minutes:
 *   Events  — one row per news event, with lat/lng, actor codes, Goldstein scale
 *   GKG     — one row per article, with themes, named entities, tone score
 *
 * Both are listed in a "lastupdate" manifest at a well-known URL.
 */

import { parse } from "csv-parse";
import { EventEmitter } from "events";

// ─── GDELT manifest URLs ──────────────────────────────────────────────────────

const LASTUPDATE_EVENTS =
  "http://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const LASTUPDATE_GKG =
  "http://data.gdeltproject.org/gdeltv2/lastupdate-translation.txt";

// Poll every 15 minutes — GDELT updates on this cadence
const POLL_INTERVAL_MS = 15 * 60 * 1000;

// ─── GDELT Events column indices (tab-separated, 61 columns) ─────────────────
// Full schema: http://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf
const EV = {
  GLOBALEVENTID: 0,
  SQLDATE: 1,
  Actor1Name: 6,
  Actor2Name: 16,
  EventCode: 26,        // CAMEO event code
  GoldsteinScale: 30,   // -10 to +10, importance of event type
  NumMentions: 31,      // total article mentions
  NumSources: 32,       // distinct sources
  NumArticles: 33,      // distinct articles
  AvgTone: 34,          // average sentiment -100..+100
  Actor1Geo_CountryCode: 46,
  Actor1Geo_Lat: 48,
  Actor1Geo_Long: 49,
  ActionGeo_FullName: 52,
  ActionGeo_CountryCode: 53,
  ActionGeo_Lat: 56,
  ActionGeo_Long: 57,
  SOURCEURL: 60,
};

// ─── GDELT GKG column indices (tab-separated) ─────────────────────────────────
// Full schema: http://data.gdeltproject.org/documentation/GDELT-Global_Knowledge_Graph_Codebook-V2.1.pdf
const GKG = {
  GKGRECORDID: 0,
  DATE: 1,
  SourceCommonName: 3,
  DocumentIdentifier: 4, // article URL
  Themes: 7,             // semicolon-separated CAMEO themes
  Locations: 9,          // pipe-separated location blocks
  Organizations: 11,
  Tone: 15,              // "tone,pos,neg,polarity,actRef,selfRef"
  SharingImage: 20,
};

// ─── Poller class ─────────────────────────────────────────────────────────────

export class GdeltPoller extends EventEmitter {
  constructor() {
    super();
    this._lastEventFileUrl = null;
    this._lastGkgFileUrl = null;
    this._timer = null;
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    console.log("[poller] starting — first fetch now, then every 15 min");
    this._tick();
    this._timer = setInterval(() => this._tick(), POLL_INTERVAL_MS);
  }

  stop() {
    this._running = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  // ── single poll cycle ───────────────────────────────────────────────────────

  async _tick() {
    try {
      const [eventUrl, gkgUrl] = await Promise.all([
        this._resolveLatestUrl(LASTUPDATE_EVENTS, "export"),
        this._resolveLatestUrl(LASTUPDATE_GKG, "gkg"),
      ]);

      const isNewEvent = eventUrl && eventUrl !== this._lastEventFileUrl;
      const isNewGkg = gkgUrl && gkgUrl !== this._lastGkgFileUrl;

      if (!isNewEvent && !isNewGkg) {
        console.log("[poller] no new files since last poll — skipping");
        return;
      }

      const [events, gkgRows] = await Promise.all([
        isNewEvent ? this._fetchEvents(eventUrl) : Promise.resolve([]),
        isNewGkg ? this._fetchGkg(gkgUrl).catch(e => {
          console.warn('[poller] GKG fetch failed, continuing without it:', e.message)
          return []
        }) : Promise.resolve([]),
      ]);

      if (isNewEvent) this._lastEventFileUrl = eventUrl;
      if (isNewGkg) this._lastGkgFileUrl = gkgUrl;

      // Build a lookup from article URL → GKG tone/themes for enrichment
      const gkgByUrl = new Map();
      for (const row of gkgRows) {
        if (row.url) gkgByUrl.set(row.url, row);
      }

      // Enrich events and emit
      const enriched = events
        .filter((ev) => ev.lat && ev.lng) // must have coordinates
        .map((ev) => ({
          ...ev,
          gkg: gkgByUrl.get(ev.sourceUrl) || null,
        }));

      console.log(
        `[poller] emitting ${enriched.length} geo-tagged events ` +
          `(from ${events.length} total)`
      );

      this.emit("events", enriched);
    } catch (err) {
      console.error("[poller] tick error:", err.message);
      this.emit("error", err);
    }
  }

  // ── resolve the latest file URL from GDELT's manifest ──────────────────────

  async _resolveLatestUrl(manifestUrl, type) {
    try {
      const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
      const text = await res.text();

      // Each line: "<size> <md5> <url>"   pick the line whose URL matches type
      for (const line of text.trim().split("\n")) {
        const parts = line.trim().split(/\s+/);
        const url = parts[2];
        if (url && url.includes(type)) return url;
      }
      return null;
    } catch (err) {
      console.warn(`[poller] manifest fetch failed (${type}):`, err.message);
      return null;
    }
  }

  // ── fetch + parse a GDELT Events CSV (zipped) ──────────────────────────────

  async _fetchEvents(url) {
    const rows = await this._fetchCsv(url, "\t");
    return rows.map((r) => ({
      id: r[EV.GLOBALEVENTID],
      date: r[EV.SQLDATE],
      actor1: r[EV.Actor1Name] || null,
      actor2: r[EV.Actor2Name] || null,
      eventCode: r[EV.EventCode],
      goldstein: parseFloat(r[EV.GoldsteinScale]) || 0,
      numMentions: parseInt(r[EV.NumMentions]) || 0,
      numSources: parseInt(r[EV.NumSources]) || 0,
      numArticles: parseInt(r[EV.NumArticles]) || 0,
      avgTone: parseFloat(r[EV.AvgTone]) || 0,
      countryCode: r[EV.ActionGeo_CountryCode] || r[EV.Actor1Geo_CountryCode] || null,
      locationName: r[EV.ActionGeo_FullName] || null,
      lat: parseFloat(r[EV.ActionGeo_Lat]) || null,
      lng: parseFloat(r[EV.ActionGeo_Long]) || null,
      sourceUrl: r[EV.SOURCEURL] || null,
    }));
  }

  // ── fetch + parse a GDELT GKG CSV (zipped) ────────────────────────────────

  async _fetchGkg(url) {
    const rows = await this._fetchCsv(url, "\t");
    return rows.map((r) => {
      const toneStr = r[GKG.Tone] || "";
      const toneParts = toneStr.split(",");
      return {
        id: r[GKG.GKGRECORDID],
        date: r[GKG.DATE],
        sourceName: r[GKG.SourceCommonName] || null,
        url: r[GKG.DocumentIdentifier] || null,
        themes: (r[GKG.Themes] || "").split(";").filter(Boolean),
        organizations: (r[GKG.Organizations] || "").split(";").filter(Boolean),
        tone: parseFloat(toneParts[0]) || 0,
        tonePositive: parseFloat(toneParts[1]) || 0,
        toneNegative: parseFloat(toneParts[2]) || 0,
        polarity: parseFloat(toneParts[3]) || 0,
        sharingImage: r[GKG.SharingImage] || null,
      };
    });
  }

  // ── shared CSV fetcher (handles .zip via streaming decompress) ─────────────

  async _fetchCsv(url, delimiter = ",") {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`CSV fetch HTTP ${res.status} for ${url}`);

    const buf = Buffer.from(await res.arrayBuffer());
    let csvBuf = buf;

    if (url.endsWith(".zip")) {
      csvBuf = await this._unzip(buf);
    }

    return new Promise((resolve, reject) => {
      const records = [];
      const parser = parse({ delimiter, relax_quotes: true, skip_empty_lines: true });
      parser.on("readable", () => {
        let r;
        while ((r = parser.read()) !== null) records.push(r);
      });
      parser.on("error", reject);
      parser.on("end", () => resolve(records));
      parser.write(csvBuf);
      parser.end();
    });
  }

  // ── minimal ZIP decompressor (picks first file entry) ─────────────────────

  async _unzip(arrayBuffer) {
    const { createInflateRaw } = await import("zlib");
    const buf = Buffer.from(arrayBuffer);
    const sig = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (sig === -1) throw new Error("not a valid ZIP file");
    const fileNameLen = buf.readUInt16LE(sig + 26);
    const extraLen = buf.readUInt16LE(sig + 28);
    const dataStart = sig + 30 + fileNameLen + extraLen;
    const compressedSize = buf.readUInt32LE(sig + 18);
    const compressed = buf.slice(dataStart, dataStart + compressedSize);
    return new Promise((resolve, reject) => {
      const chunks = [];
      const inflate = createInflateRaw();
      inflate.on("data", (c) => chunks.push(c));
      inflate.on("end", () => resolve(Buffer.concat(chunks)));
      inflate.on("error", reject);
      inflate.end(compressed);
    });
  }
}

// ── CLI entry point: node src/gdelt-poller.js --once ─────────────────────────

if (process.argv[1].endsWith("gdelt-poller.js")) {
  const poller = new GdeltPoller();
  poller.on("events", (evs) => {
    console.log(`\nSample (first 3 of ${evs.length}):`);
    evs.slice(0, 3).forEach((e) => console.log(JSON.stringify(e, null, 2)));
    if (process.argv.includes("--once")) process.exit(0);
  });
  poller.on("error", (e) => { console.error(e); process.exit(1); });
  poller.start();
}
