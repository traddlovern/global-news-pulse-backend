/**
 * risk-score.js
 *
 * Computes a 0-100 Country Risk Score for Private Equity due diligence.
 *
 * Components:
 *   - Current OSINT score      (30%)
 *   - 7-day trend              (25%) — deteriorating = higher risk
 *   - Spike frequency          (20%) — frequent spikes = unstable
 *   - Category risk weight     (15%) — conflict > politics > economy
 *   - Source corroboration     (10%) — verified sources = more reliable signal
 *
 * Risk levels:
 *   0-25   LOW      — stable, minimal coverage, no spikes
 *   26-45  MODERATE — some activity, watch closely
 *   46-65  ELEVATED — significant events, investigate
 *   66-80  HIGH     — major instability signals
 *   81-100 CRITICAL — active crisis, avoid or exit
 */

import { getCountryHistory } from './history-store.js'

// Category risk weights — how dangerous is each category for PE?
const CATEGORY_RISK = {
  conflict:  1.0,   // highest risk — direct threat to operations
  politics:  0.7,   // regulatory/policy risk
  economy:   0.6,   // market/currency risk
  climate:   0.5,   // operational disruption risk
  diplomacy: 0.3,   // lower risk — usually means negotiations
  tech:      0.2,   // lowest — rarely affects PE directly
  general:   0.4,
}

export function computeRiskScore(pin) {
  const history = getCountryHistory(pin.countryCode, 168) // 7 days
  const snapshots = history?.snapshots || []

  // 1. Current OSINT score (30%)
  const currentScore = (pin.score || 0) / 100

  // 2. 7-day trend (25%)
  // Compare last 24h average vs previous 6 days average
  let trendScore = 0.5 // neutral if no history
  if (snapshots.length >= 4) {
    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

    const recent = snapshots.filter(s => new Date(s.timestamp) > oneDayAgo)
    const older = snapshots.filter(s => {
      const t = new Date(s.timestamp)
      return t > sevenDaysAgo && t <= oneDayAgo
    })

    const recentAvg = recent.length ? recent.reduce((a, b) => a + b.score, 0) / recent.length : 0
    const olderAvg = older.length ? older.reduce((a, b) => a + b.score, 0) / older.length : recentAvg

    if (olderAvg > 0) {
      const ratio = recentAvg / olderAvg
      // ratio > 1.5 = deteriorating (higher risk), ratio < 0.7 = improving (lower risk)
      trendScore = Math.min(Math.max((ratio - 0.5) / 2, 0), 1)
    }
  }

  // 3. Spike frequency (20%)
  // How many times has this country spiked in the last 7 days?
  const spikeCount = snapshots.filter(s => s.isAlert).length
  const spikesPerDay = spikeCount / 7
  const spikeScore = Math.min(spikesPerDay / 3, 1) // 3+ spikes/day = max

  // 4. Category risk weight (15%)
  const categoryRisk = CATEGORY_RISK[pin.dominantCategory] || 0.4

  // 5. Source corroboration (10%)
  // More verified sources = more reliable = we trust the signal more
  const hasVerified = pin.topStories?.some(s => s.sourceTier === 1 || s.sourceTier === 2)
  const corrobScore = hasVerified ? pin.score / 100 : (pin.score / 100) * 0.5

  // Composite
  const raw = (
    currentScore  * 0.30 +
    trendScore    * 0.25 +
    spikeScore    * 0.20 +
    categoryRisk  * 0.15 +
    corrobScore   * 0.10
  )

  const riskScore = Math.round(raw * 100)

  // Risk level
  const level = riskScore >= 81 ? 'CRITICAL'
    : riskScore >= 66 ? 'HIGH'
    : riskScore >= 46 ? 'ELEVATED'
    : riskScore >= 26 ? 'MODERATE'
    : 'LOW'

  const levelColor = {
    CRITICAL: '#ff2222',
    HIGH:     '#ff4444',
    ELEVATED: '#ffaa00',
    MODERATE: '#ffdd44',
    LOW:      '#44cc88',
  }[level]

  // Trend direction
  const trend = snapshots.length < 4 ? 'insufficient data'
    : trendScore > 0.6 ? 'deteriorating'
    : trendScore < 0.4 ? 'improving'
    : 'stable'

  return {
    riskScore,
    level,
    levelColor,
    trend,
    components: {
      current: Math.round(currentScore * 100),
      trend: Math.round(trendScore * 100),
      spikeFrequency: Math.round(spikeScore * 100),
      categoryRisk: Math.round(categoryRisk * 100),
      corroboration: Math.round(corrobScore * 100),
    },
    spikeCount,
    dataPoints: snapshots.length,
  }
}

export function getRiskLevel(score) {
  if (score >= 81) return 'CRITICAL'
  if (score >= 66) return 'HIGH'
  if (score >= 46) return 'ELEVATED'
  if (score >= 26) return 'MODERATE'
  return 'LOW'
}
