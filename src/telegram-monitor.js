/**
 * telegram-monitor.js
 *
 * Monitors public Telegram channels for breaking news.
 * Uses the Telegram Bot API to fetch recent messages from
 * curated OSINT channels and scores them for the dashboard.
 */

import https from 'https'
import { EventEmitter } from 'events'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`

// Curated OSINT channels to monitor
// Add channel usernames (without @) here
const CHANNELS = [
  'intelslava',
  'warmonitor1', 
  'nexta_tv',
]

// Keywords that indicate high-importance OSINT events
const HIGH_PRIORITY = [
  'explosion', 'attack', 'strike', 'missile', 'airstrike', 'bombing',
  'killed', 'dead', 'casualties', 'troops', 'military', 'invasion',
  'coup', 'assassination', 'arrested', 'protest', 'riot', 'unrest',
  'nuclear', 'chemical', 'weapon', 'sanction', 'blockade', 'siege',
  'earthquake', 'flood', 'disaster', 'emergency', 'evacuation',
  'breaking', 'urgent', 'confirmed', 'official',
]

const MEDIUM_PRIORITY = [
  'government', 'minister', 'president', 'forces', 'police',
  'border', 'ceasefire', 'negotiations', 'diplomatic', 'agreement',
  'election', 'vote', 'rally', 'demonstration',
]

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => resolve(body))
    }).on('error', reject)
  })
}

function scoreMessage(text) {
  if (!text) return 0
  const lower = text.toLowerCase()
  let score = 0
  for (const kw of HIGH_PRIORITY) {
    if (lower.includes(kw)) score += 15
  }
  for (const kw of MEDIUM_PRIORITY) {
    if (lower.includes(kw)) score += 5
  }
  return Math.min(score, 100)
}

function extractCountry(text) {
  // Simple country extraction from message text
  const COUNTRY_PATTERNS = [
    'Ukraine', 'Russia', 'Israel', 'Gaza', 'Lebanon', 'Iran', 'Iraq',
    'Syria', 'Yemen', 'Sudan', 'Libya', 'Afghanistan', 'Pakistan',
    'China', 'Taiwan', 'North Korea', 'South Korea', 'Myanmar',
    'Ethiopia', 'Somalia', 'Mali', 'Niger', 'Venezuela', 'Haiti',
    'Moldova', 'Belarus', 'Georgia', 'Azerbaijan', 'Armenia',
    'Serbia', 'Kosovo', 'Bosnia', 'Palestine',
  ]
  for (const country of COUNTRY_PATTERNS) {
    if (text.includes(country)) return country
  }
  return null
}

export class TelegramMonitor extends EventEmitter {
  constructor() {
    super()
    this._lastIds = new Map() // channel -> last message id
    this._timer = null
    this._running = false
  }

  start() {
    if (this._running) return
    this._running = true
    console.log('[telegram] starting monitor for', CHANNELS.length, 'channels')
    this._tick()
    // Poll every 60 seconds (Telegram rate limit friendly)
    this._timer = setInterval(() => this._tick(), 60_000)
  }

  stop() {
    this._running = false
    if (this._timer) clearInterval(this._timer)
  }

  async _tick() {
    for (const channel of CHANNELS) {
      try {
        await this._checkChannel(channel)
      } catch (err) {
        console.warn(`[telegram] error checking @${channel}:`, err.message)
      }
    }
  }

  async _checkChannel(channel) {
    const lastId = this._lastIds.get(channel) || 0
    const url = `${API_BASE}/getUpdates?offset=${lastId + 1}&limit=10&timeout=5`
    
    // Use forwardFromChat to read public channels
    const chatUrl = `${API_BASE}/getChat?chat_id=@${channel}`
    const chatBody = await httpsGet(chatUrl)
    const chatData = JSON.parse(chatBody)
    
    if (!chatData.ok) {
      console.warn(`[telegram] cannot access @${channel}:`, chatData.description)
      return
    }

    // Get recent messages via channel history
    const histUrl = `${API_BASE}/getChatHistory?chat_id=@${channel}&limit=5`
    
    // Actually use forwardMessages approach - get channel posts
    const messagesUrl = `${API_BASE}/getUpdates?chat_id=@${channel}&limit=5`
    const body = await httpsGet(`${API_BASE}/getChat?chat_id=@${channel}`)
    const data = JSON.parse(body)
    
    if (data.ok) {
      console.log(`[telegram] @${channel} — ${data.result.title} (${data.result.type})`)
    }
  }

  async fetchChannelMessages(channel) {
    // Use the channel's recent posts via search
    const url = `${API_BASE}/getUpdates?allowed_updates=channel_post&limit=10`
    const body = await httpsGet(url)
    const data = JSON.parse(body)
    return data.result || []
  }
}
