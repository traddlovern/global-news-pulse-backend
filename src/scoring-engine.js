/**
 * scoring-engine.js  —  OSINT-optimised scoring
 *
 * Composite score (0-100) built for early-warning intelligence:
 *
 *  1. Spike detection   (30%) — how much has this country surged vs its baseline?
 *  2. Corroboration     (25%) — how many independent sources/countries covering it?
 *  3. Threat signal     (25%) — negative tone + conflict/military/crisis CAMEO codes
 *  4. Actor significance(20%) — government, military, institutional actors weighted higher
 *
 * Countries are flagged as ALERT when their spike score exceeds 2x rolling baseline.
 */

import { scoreSourceQuality, aggregateSourceQuality } from './source-quality.js'

// Rolling baseline: country -> recent scores (last 8 polls = 2 hours)
const baseline = new Map()
const BASELINE_WINDOW = 8

// ── CAMEO threat codes (events that matter for OSINT) ────────────────────────
const HIGH_THREAT_CODES = new Set([
  '13','14','15','16','17','18','19','20', // threats → mass violence
  '138','139','1381','1382',               // threaten with military
  '173','174','175',                       // coerce
  '180','181','182','183','185','186',     // assault
  '190','191','192','193','194','195',     // fight
  '200','201','202','203','204',           // mass violence
])

const MEDIUM_THREAT_CODES = new Set([
  '10','11','12',   // demand, disapprove, reject
  '100','110','120','130',
])

// ── Significant actor keywords ────────────────────────────────────────────────
const SIGNIFICANT_ACTORS = [
  'MILITARY','GOV','PRESIDENT','MINISTER','ARMY','NAVY','POLICE',
  'REBEL','PROTEST','OPPOSITION','PARAMILITARY','INTELLIGENCE',
  'NATO','UN','EU','IAEA','ICC','INTERPOL','CIA','FBI','FSB','MOSSAD',
]

// ── Crisis/threat themes from GKG ────────────────────────────────────────────
const THREAT_THEMES = [
  'CONFLICT','MILITARY','WAR','TERROR','WEAPON','NUCLEAR','CHEMICAL',
  'CRISIS','EMERGENCY','DISASTER','COUP','ASSASSINATION','EXPLOSION',
  'PROTEST','UNREST','RIOT','SANCTION','INVASION','OCCUPATION',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function logNorm(value, ceiling) {
  if (!value || value <= 0) return 0
  return Math.min(Math.log1p(value) / Math.log1p(ceiling), 1)
}

function actorSignificance(actor1, actor2) {
  const combined = `${actor1 || ''} ${actor2 || ''}`.toUpperCase()
  let score = 0
  for (const kw of SIGNIFICANT_ACTORS) {
    if (combined.includes(kw)) score += 0.15
  }
  return Math.min(score, 1)
}

function threatLevel(eventCode, themes = []) {
  const code = String(eventCode || '')
  const themeStr = themes.join(' ').toUpperCase()
  let score = 0
  if (HIGH_THREAT_CODES.has(code) || HIGH_THREAT_CODES.has(code.slice(0,2))) score += 0.8
  else if (MEDIUM_THREAT_CODES.has(code) || MEDIUM_THREAT_CODES.has(code.slice(0,2))) score += 0.4
  for (const t of THREAT_THEMES) {
    if (themeStr.includes(t)) score += 0.1
  }
  return Math.min(score, 1)
}

function corroborationScore(numSources, numArticles, orgCount) {
  const sourceScore = logNorm(numSources, 80)
  const articleScore = logNorm(numArticles, 400)
  const orgScore = logNorm(orgCount, 20)
  return sourceScore * 0.5 + articleScore * 0.3 + orgScore * 0.2
}

function spikeScore(countryCode, currentRaw) {
  if (!baseline.has(countryCode)) return 0.5 // no history = neutral
  const history = baseline.get(countryCode)
  if (history.length < 2) return 0.5
  const avg = history.reduce((a, b) => a + b, 0) / history.length
  if (avg === 0) return currentRaw > 0 ? 1.0 : 0
  const ratio = currentRaw / avg
  // ratio > 2 = spiking, ratio < 0.5 = declining
  return Math.min(ratio / 4, 1)
}

function updateBaseline(countryCode, rawScore) {
  if (!baseline.has(countryCode)) baseline.set(countryCode, [])
  const history = baseline.get(countryCode)
  history.push(rawScore)
  if (history.length > BASELINE_WINDOW) history.shift()
}

// ─── Category inference ───────────────────────────────────────────────────────
const CAMEO_CATEGORIES = {
  '01':'diplomacy','02':'diplomacy','03':'diplomacy','04':'diplomacy','05':'diplomacy',
  '06':'economy','07':'economy','08':'economy',
  '09':'politics','10':'politics','11':'politics','12':'politics',
  '13':'conflict','14':'conflict','15':'conflict','16':'conflict',
  '17':'conflict','18':'conflict','19':'conflict','20':'conflict',
}

function inferCategory(eventCode, themes = []) {
  if (!eventCode) return 'general'
  const code = String(eventCode)
  const prefix2 = code.slice(0, 2)
  const prefix3 = code.slice(0, 3)
  const themeStr = themes.join(' ').toLowerCase()

  // Theme-based detection first (most reliable)
  if (themeStr.includes('climate') || themeStr.includes('environment') || themeStr.includes('drought') || themeStr.includes('flood')) return 'climate'
  if (themeStr.includes('cyber') || themeStr.includes('artificial intelligence') || themeStr.includes('semiconductor')) return 'tech'
  if (themeStr.includes('nuclear') && !themeStr.includes('nuclear weapon')) return 'tech'

  // Conflict indicators
  if (['18','19','20','180','181','182','183','185','186','190','191','192','193','194','195','200','201','202','203','204'].includes(prefix2) ||
      ['180','181','182','183','185','186','190','191','192','193','194','195','200'].includes(prefix3)) return 'conflict'

  // Threat/coercion
  if (['13','14','15','16','17'].includes(prefix2)) return 'conflict'

  // Economy
  if (themeStr.includes('econ') || themeStr.includes('market') || themeStr.includes('trade') || 
      themeStr.includes('sanction') || themeStr.includes('gdp') || themeStr.includes('inflation') ||
      themeStr.includes('currency') || themeStr.includes('tariff')) return 'economy'
  if (['06','07','08'].includes(prefix2)) return 'economy'

  // Politics
  if (['10','11','12'].includes(prefix2)) return 'politics'
  if (themeStr.includes('election') || themeStr.includes('coup') || themeStr.includes('protest') || 
      themeStr.includes('parliament') || themeStr.includes('government')) return 'politics'

  // Diplomacy
  if (['01','02','03','04','05'].includes(prefix2)) return 'diplomacy'

  return CAMEO_CATEGORIES[prefix2] || 'general'
}

// ─── Score a single event ─────────────────────────────────────────────────────
export function scoreEvent(event) {
  const { numArticles, numSources, numMentions, avgTone, goldstein, eventCode, gkg } = event
  const themes = gkg?.themes || []
  const orgCount = gkg?.organizations?.length || 0

  // Raw volume for baseline tracking
  const rawVolume = (numArticles || 0) + (numSources || 0) * 3

  // Source quality
  const sourceQ = scoreSourceQuality(event.sourceUrl, gkg?.sourceName)
  const sourceQualityMultiplier = sourceQ.tier === 'penalized' ? 0.1
    : sourceQ.tier === 1 ? 1.3
    : sourceQ.tier === 2 ? 1.1
    : 0.7

  // 1. Corroboration (25%)
  const corroboration = corroborationScore(numSources, numArticles, orgCount)

  // 2. Threat signal (25%) — negative tone + threat codes + crisis themes
  const toneSignal = avgTone < 0 ? Math.min(Math.abs(avgTone) / 50, 1) : 0
  const threat = threatLevel(eventCode, themes)
  const threatSignal = toneSignal * 0.4 + threat * 0.6

  // 3. Actor significance (20%)
  const actorScore = actorSignificance(event.actor1, event.actor2)

  // 4. Volume (30%) — still matters but less dominant
  const volumeScore = logNorm(numArticles, 400) * 0.5 + logNorm(numSources, 80) * 0.3 + logNorm(numMentions, 1500) * 0.2

  const rawScore = corroboration * 0.25 + threatSignal * 0.25 + actorScore * 0.20 + volumeScore * 0.30
  const score = Math.round(Math.min(rawScore * sourceQualityMultiplier * 100, 100))

  const category = inferCategory(eventCode, themes)
  const sentiment = avgTone > 5 ? 'positive' : avgTone < -5 ? 'negative' : 'neutral'

  return {
    ...event,
    score,
    rawVolume,
    scoreBreakdown: {
      corroboration: Math.round(corroboration * 100),
      threat: Math.round(threatSignal * 100),
      actor: Math.round(actorScore * 100),
      volume: Math.round(volumeScore * 100),
    },
    category,
    themes: themes.slice(0, 8),
    sentiment,
    imageUrl: gkg?.sharingImage || null,
    sourceName: gkg?.sourceName || null,
    sourceTier: sourceQ.tier,
    sourceDomain: sourceQ.domain,
  }
}

// ─── Cluster by country ───────────────────────────────────────────────────────
export function clusterByCountry(scoredEvents) {
  const countries = new Map()

  for (const ev of scoredEvents) {
    const key = ev.countryCode || `${ev.lat?.toFixed(1)}_${ev.lng?.toFixed(1)}`
    if (!key) continue

    if (!countries.has(key)) {
      countries.set(key, {
        countryCode: ev.countryCode,
        locationName: ev.locationName,
        lat: ev.lat, lng: ev.lng,
        topScore: 0, totalArticles: 0, totalMentions: 0,
        rawVolume: 0, stories: [], categories: {},
      })
    }

    const cluster = countries.get(key)
    cluster.topScore = Math.max(cluster.topScore, ev.score)
    cluster.totalArticles += ev.numArticles || 0
    cluster.totalMentions += ev.numMentions || 0
    cluster.rawVolume += ev.rawVolume || 0
    cluster.stories.push(ev)
    cluster.categories[ev.category] = (cluster.categories[ev.category] || 0) + 1
  }

  const pins = []
  for (const [, cluster] of countries) {
    cluster.stories.sort((a, b) => b.score - a.score)

    // Spike detection per country
    const spike = spikeScore(cluster.countryCode, cluster.rawVolume)
    updateBaseline(cluster.countryCode, cluster.rawVolume)

    // Composite pin score: base score + spike bonus
    const pinScore = Math.round(Math.min(cluster.topScore * 0.7 + spike * 30, 100))

    // Alert if spiking hard
    const isAlert = spike > 0.75 && pinScore > 40

    const topStories = cluster.stories.slice(0, 10).map((s) => {
      const who = s.actor1 && s.actor2 ? `${s.actor1} & ${s.actor2}` : s.actor1 || s.actor2 || null
      const where = s.locationName ? s.locationName.split(',')[0].trim() : null
      const toneDesc = s.avgTone < -10 ? 'tensions' : s.avgTone < 0 ? 'developments' : s.avgTone > 10 ? 'cooperation' : 'activity'
      const catDesc = { conflict: 'Conflict', politics: 'Political', economy: 'Economic', climate: 'Climate', tech: 'Tech', diplomacy: 'Diplomatic', general: 'News' }[s.category] || 'News'
      let headline = ''
      if (who && where) headline = `${catDesc}: ${who} in ${where}`
      else if (who) headline = `${catDesc} ${toneDesc} involving ${who}`
      else if (where) headline = `${catDesc} ${toneDesc} in ${where}`
      else headline = `${catDesc} ${toneDesc} — ${s.numArticles} articles`
      return ({
        id: s.id, score: s.score, headline,
        category: s.category, sentiment: s.sentiment,
        sourceUrl: s.sourceUrl, sourceName: s.sourceName, sourceTier: s.sourceTier, sourceDomain: s.sourceDomain,
        imageUrl: s.imageUrl, themes: s.themes,
        scoreBreakdown: s.scoreBreakdown,
        numArticles: s.numArticles, numSources: s.numSources,
        avgTone: s.avgTone, goldstein: s.goldstein,
      })
    })

    const dominantCategory = Object.entries(cluster.categories).sort((a, b) => b[1] - a[1])[0]?.[0] || 'general'

    // Clean up location name — just use country name
    const cleanLocation = cluster.locationName
      ? cluster.locationName.split(',').pop().trim()
      : cluster.countryCode

    pins.push({
      countryCode: cluster.countryCode,
      locationName: cleanLocation,
      lat: cluster.lat, lng: cluster.lng,
      score: pinScore,
      isAlert,
      spikeScore: Math.round(spike * 100),
      totalArticles: cluster.totalArticles,
      totalMentions: cluster.totalMentions,
      storyCount: cluster.stories.length,
      dominantCategory,
      categoryBreakdown: cluster.categories,
      topStories,
    })
  }

  return pins.sort((a, b) => b.score - a.score)
}

// ─── Top-level pipeline ───────────────────────────────────────────────────────
export function processEvents(rawEvents) {
  const scored = rawEvents.map(scoreEvent)
  return clusterByCountry(scored)
}
