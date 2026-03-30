/**
 * source-quality.js
 *
 * Tiered source quality scoring for OSINT use.
 *
 * Tier 1 (1.0) — Global wire services and major international outlets
 * Tier 2 (0.7) — Regional majors and reputable national outlets  
 * Tier 3 (0.4) — Local outlets, smaller nationals, trade press
 * Unknown (0.2) — Not on list, could be anything
 * Penalized (0.0) — Known low quality, state propaganda, or fringe
 */

const TIER1 = new Set([
  // Wire services
  'reuters.com', 'apnews.com', 'afp.com', 'bloomberg.com',
  // US majors
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'npr.org',
  'nbcnews.com', 'cbsnews.com', 'abcnews.go.com', 'cnn.com',
  'politico.com', 'thehill.com', 'axios.com',
  // UK majors
  'bbc.com', 'bbc.co.uk', 'theguardian.com', 'ft.com',
  'telegraph.co.uk', 'thetimes.co.uk', 'economist.com',
  'independent.co.uk',
  // International
  'aljazeera.com', 'dw.com', 'france24.com', 'rfi.fr',
  'euronews.com', 'scmp.com', 'japantimes.co.jp',
  'thehindu.com', 'dawn.com', 'haaretz.com', 'timesofisrael.com',
  'globeandmail.com', 'abc.net.au', 'rnz.co.nz',
  // Specialty/verification
  'foreignpolicy.com', 'foreignaffairs.com', 'cfr.org',
  'bellingcat.com', 'icij.org', 'propublica.org',
])

const TIER2 = new Set([
  'usatoday.com', 'latimes.com', 'chicagotribune.com',
  'nypost.com', 'newsweek.com', 'time.com', 'theatlantic.com',
  'slate.com', 'vox.com', 'vice.com', 'buzzfeednews.com',
  'straitstimes.com', 'bangkokpost.com', 'thenational.ae',
  'arabnews.com', 'jordantimes.com', 'dailysabah.com',
  'kyivpost.com', 'themoscowtimes.com', 'radiosvoboda.org',
  'rferl.org', 'voanews.com', 'swissinfo.ch',
  'theconversation.com', 'middleeasteye.net',
])

const PENALIZED = new Set([
  // Known state propaganda
  'rt.com', 'sputniknews.com', 'presstv.ir', 'xinhuanet.com',
  'globaltimes.cn', 'cgtn.com', 'tass.com', 'ria.ru',
  'southfront.org', 'moonofalabama.org',
  // Known fringe/unreliable
  'infowars.com', 'naturalnews.com', 'zerohedge.com',
  'thegatewaypundit.com', 'breitbart.com', 'oann.com',
  'activistpost.com', 'globalresearch.ca',
])

export function getDomain(url) {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

export function findTierFromUrl(url) {
  if (!url) return null
  const domain = getDomain(url)
  if (!domain) return null
  // Check exact match first
  if (PENALIZED.has(domain)) return 'penalized'
  if (TIER1.has(domain)) return 1
  if (TIER2.has(domain)) return 2
  // Check if any tier domain is contained in the full URL (catches subdomains)
  for (const d of TIER1) { if (domain.endsWith(d)) return 1 }
  for (const d of TIER2) { if (domain.endsWith(d)) return 2 }
  for (const d of PENALIZED) { if (domain.endsWith(d)) return 'penalized' }
  return 'unknown'
}

export function getSourceTier(url) {
  const domain = getDomain(url)
  if (!domain) return { tier: 'unknown', score: 0.2, domain: null }
  const tier = findTierFromUrl(url)
  const score = tier === 1 ? 1.0 : tier === 2 ? 0.7 : tier === 'penalized' ? 0.0 : 0.2
  return { tier, score, domain }
}

export function scoreSourceQuality(sourceUrl, sourceName) {
  const { tier, score, domain } = getSourceTier(sourceUrl)
  return { tier, score, domain: domain || sourceName }
}

export function aggregateSourceQuality(urls = []) {
  if (!urls.length) return { avgScore: 0.2, hasT1: false, penalizedRatio: 0 }
  const scores = urls.map(u => getSourceTier(u))
  const avg = scores.reduce((a, b) => a + b.score, 0) / scores.length
  const hasT1 = scores.some(s => s.tier === 1)
  const penalized = scores.filter(s => s.tier === 'penalized').length
  return {
    avgScore: avg,
    hasT1,
    penalizedRatio: penalized / scores.length,
  }
}
