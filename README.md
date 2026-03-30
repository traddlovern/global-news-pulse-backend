# news-dashboard-backend

Real-time global news map backend. Polls GDELT every 15 minutes, scores events,
and pushes updates to frontend clients over WebSocket.

## Requirements

- Node.js 18+
- Redis 6+ (optional — falls back to in-process cache automatically)

## Quick start

```bash
npm install
cp .env.example .env

# With Redis running locally:
npm run dev

# Without Redis (dev/testing):
NO_REDIS=true npm run dev
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server status, client count, last update time |
| GET | `/pins` | Latest scored pin set as JSON |
| GET | `/pins/:CC` | Stories for country code (e.g. `/pins/US`) |
| WS | `/` | Real-time update stream |

## WebSocket protocol

### Server → client
```json
{ "type": "snapshot", "pins": [...], "updatedAt": "ISO", "pinCount": 42 }
{ "type": "update",   "pins": [...], "updatedAt": "ISO", "pinCount": 42 }
{ "type": "ping" }
```

### Client → server
```json
{ "type": "filter", "categories": ["conflict", "economy"] }
{ "type": "pong" }
```

## Pin object shape

```json
{
  "countryCode": "UA",
  "locationName": "Kyiv, Ukraine",
  "lat": 50.45,
  "lng": 30.52,
  "score": 84,
  "storyCount": 12,
  "totalArticles": 3240,
  "dominantCategory": "conflict",
  "categoryBreakdown": { "conflict": 8, "politics": 3, "diplomacy": 1 },
  "topStories": [
    {
      "id": "...",
      "score": 84,
      "headline": "Ukrainian Forces — Kyiv, Ukraine",
      "category": "conflict",
      "sentiment": "negative",
      "sourceUrl": "https://...",
      "sourceName": "Reuters",
      "numArticles": 320,
      "avgTone": -18.4,
      "goldstein": -8.0,
      "scoreBreakdown": { "volume": 91, "tone": 78, "reach": 85 }
    }
  ]
}
```

## Composite scoring

| Signal | Weight | Source |
|--------|--------|--------|
| Article volume | 40% | `NumArticles`, `NumSources`, `NumMentions` |
| Tone magnitude | 35% | `AvgTone`, `GoldsteinScale` |
| Source reach | 25% | `NumSources`, GKG organizations |

High magnitude tone (strongly positive or negative) scores higher than neutral —
controversy and significance both indicate newsworthiness.

## Categories

Inferred from CAMEO event codes + GKG themes:
`conflict` · `politics` · `diplomacy` · `economy` · `climate` · `tech` · `general`
