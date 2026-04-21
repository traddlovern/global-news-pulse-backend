/**
 * history-store.js
 *
 * Persists country score history to a local JSON file.
 * Survives server restarts. Used for trend analysis and
 * country risk scoring.
 *
 * Stores up to 672 snapshots per country (7 days at 15-min intervals).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'

const HISTORY_FILE = './data/country-history.json'
const MAX_SNAPSHOTS = 672 // 7 days x 24 hours x 4 per hour

let history = {}

// Load from disk on startup
export function loadHistory() {
  try {
    if (existsSync(HISTORY_FILE)) {
      history = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'))
      const countries = Object.keys(history).length
      const totalSnapshots = Object.values(history).reduce((a, b) => a + b.snapshots.length, 0)
      console.log(`[history] loaded ${countries} countries, ${totalSnapshots} snapshots`)
    } else {
      console.log('[history] no history file found — starting fresh')
    }
  } catch (err) {
    console.warn('[history] load failed:', err.message)
    history = {}
  }
}

// Save to disk
function saveHistory() {
  try {
    import('fs').then(({ mkdirSync }) => {
      try { mkdirSync('./data', { recursive: true }) } catch {}
    })
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2))
  } catch (err) {
    console.warn('[history] save failed:', err.message)
  }
}

// Record a snapshot for all countries
export function recordSnapshot(pins) {
  const timestamp = new Date().toISOString()
  
  for (const pin of pins) {
    const key = pin.countryCode || pin.locationName
    if (!key) continue
    
    if (!history[key]) {
      history[key] = {
        countryCode: pin.countryCode,
        locationName: pin.locationName,
        snapshots: []
      }
    }
    
    history[key].snapshots.push({
      timestamp,
      score: pin.score,
      spikeScore: pin.spikeScore || 0,
      isAlert: pin.isAlert || false,
      dominantCategory: pin.dominantCategory,
      storyCount: pin.storyCount,
      totalArticles: pin.totalArticles,
    })
    
    // Keep only last MAX_SNAPSHOTS
    if (history[key].snapshots.length > MAX_SNAPSHOTS) {
      history[key].snapshots = history[key].snapshots.slice(-MAX_SNAPSHOTS)
    }
  }
  
  saveHistory()
}

// Get history for a specific country
export function getCountryHistory(countryCode, hours = 168) {
  const key = Object.keys(history).find(k => 
    history[k].countryCode === countryCode
  )
  if (!key) return null
  
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const snapshots = history[key].snapshots.filter(s => s.timestamp > cutoff)
  
  return {
    ...history[key],
    snapshots,
  }
}

// Get all countries with their latest scores and trends
export function getAllCountryHistory() {
  return history
}
