import https from 'https'

const DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc'

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => resolve(body))
    }).on('error', reject)
  })
}

export async function fetchArticlesForQuery(query, maxRecords = 5) {
  try {
    const encodedQuery = encodeURIComponent(query) + '+sourcelang:english'
    const url = `${DOC_API}?query=${encodedQuery}&mode=artlist&maxrecords=${maxRecords}&timespan=24h&format=json&sort=hybridrel`
    const body = await httpsGet(url)
    const data = JSON.parse(body)
    return (data.articles || []).map(a => ({
      title: a.title || null,
      url: a.url || null,
      domain: a.domain || null,
      seendate: a.seendate || null,
      socialimage: a.socialimage || null,
      language: a.language || null,
    }))
  } catch {
    return []
  }
}

export function buildQueryForPin(pin) {
  const story = pin.topStories?.[0]
  if (!story) return null
  const parts = []
  if (pin.locationName) {
    const segments = pin.locationName.split(',').map(s => s.trim())
    const country = segments[segments.length - 1]
    if (country && country.length > 2) parts.push(country)
  }
  const catKeywords = {
    conflict: 'conflict', politics: 'government', economy: 'economy',
    climate: 'climate', tech: 'technology', diplomacy: 'diplomacy',
  }
  const catKw = catKeywords[story.category]
  if (catKw) parts.push(catKw)
  return parts.length ? parts.join(' ') : pin.locationName?.split(',')[0] || null
}

export async function enrichPinsWithArticles(pins, topN = 15) {
  const toEnrich = pins.slice(0, topN)
  const enriched = await Promise.all(
    toEnrich.map(async (pin) => {
      const query = buildQueryForPin(pin)
      if (!query) return pin
      const articles = await fetchArticlesForQuery(query, 5)
      console.log(`[doc-api] query="${query}" → ${articles.length} articles`)
      if (!articles.length) return pin
      const updatedStories = pin.topStories.map((story, i) => {
        const article = articles[i] || articles[0]
        if (!article?.title) return story
        return {
          ...story,
          headline: article.title,
          sourceUrl: article.url || story.sourceUrl,
          sourceDomain: article.domain || story.sourceDomain,
          socialImage: article.socialimage || null,
          realTitle: true,
        }
      })
      return { ...pin, topStories: updatedStories }
    })
  )
  return [...enriched, ...pins.slice(topN)]
}
