/**
 * rss-fetcher.js
 *
 * Fetches and caches RSS feeds from tier-1 news sources.
 * Used to find real article headlines for GDELT-scored countries.
 *
 * No API key required. All feeds are publicly available.
 */

import https from 'https'
import http from 'http'

// Tier 1 RSS feeds
const FEEDS = [
  { name: 'Reuters', url: 'https://news.yahoo.com/rss/world' },
  { name: 'BBC World', url: 'http://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'France24', url: 'https://www.france24.com/en/rss' },
  { name: 'DW News', url: 'https://rss.dw.com/xml/rss-en-world' },
  { name: 'RFI English', url: 'https://www.rfi.fr/en/rss' },
  { name: 'VOA News', url: 'https://www.voanews.com/api/zmpqm_pmkq' },
  { name: 'Foreign Policy', url: 'https://foreignpolicy.com/feed/' },
  { name: 'CNN World', url: 'http://rss.cnn.com/rss/edition_world.rss' },
  { name: 'CNBC World', url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html' },
  { name: 'Fox News World', url: 'https://moxie.foxnews.com/google-publisher/world.xml' },
  { name: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/world' },
  { name: 'ABC News', url: 'https://abcnews.go.com/abcnews/internationalheadlines' },
  { name: 'Washington Post', url: 'https://feeds.washingtonpost.com/rss/world' },
  { name: 'NY Times World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  { name: 'Guardian World', url: 'https://www.theguardian.com/world/rss' },
  { name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml' },
]

// In-memory article cache
let articleCache = []
let lastFetched = null

import zlib from 'zlib'

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('too many redirects'))
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 NewsPulse/1.0',
        'Accept-Encoding': 'gzip, deflate',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, redirectCount + 1).then(resolve).catch(reject)
      }
      const encoding = res.headers['content-encoding']
      let stream = res
      if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip())
      else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate())
      let body = ''
      stream.on('data', chunk => body += chunk)
      stream.on('end', () => resolve(body))
      stream.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function parseRSS(xml, sourceName) {
  const articles = []
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let match

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1]
    
    const titleMatch = item.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)
    const linkMatch = item.match(/<link[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i) ||
                      item.match(/<guid[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/guid>/i)
    const descMatch = item.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)
    const pubMatch = item.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i)

    const title = titleMatch?.[1]?.trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    const url = linkMatch?.[1]?.trim()
    const description = descMatch?.[1]?.trim().replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").slice(0, 300)
    const pubDate = pubMatch?.[1] ? new Date(pubMatch[1]) : new Date()

    if (title && url && !title.includes('<?xml')) {
      articles.push({ title, url, description, pubDate, source: sourceName })
    }
  }
  return articles
}

export async function fetchAllFeeds() {
  console.log('[rss] fetching', FEEDS.length, 'feeds...')
  const results = await Promise.allSettled(
    FEEDS.map(async feed => {
      try {
        const xml = await fetchUrl(feed.url)
        const articles = parseRSS(xml, feed.name)
        console.log(`[rss] ${feed.name}: ${articles.length} articles`)
        return articles
      } catch (err) {
        console.warn(`[rss] ${feed.name} failed:`, err.message)
        return []
      }
    })
  )

  const allArticles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => b.pubDate - a.pubDate)

  articleCache = allArticles
  lastFetched = new Date()
  console.log(`[rss] cached ${allArticles.length} total articles from ${FEEDS.length} feeds`)
  return allArticles
}

export function findArticlesForCountry(countryName, locationName, limit = 5) {
  if (!articleCache.length) return []
  
  const searchTerms = []
  if (countryName) searchTerms.push(countryName.toLowerCase())
  if (locationName) {
    locationName.split(',').forEach(p => {
      const term = p.trim().toLowerCase()
      if (term.length > 3) searchTerms.push(term)
    })
  }

  if (!searchTerms.length) return []

  const scored = articleCache
    .map(article => {
      const title = article.title.toLowerCase()
      const desc = (article.description || '').toLowerCase()
      let score = 0

      for (const term of searchTerms) {
        // Title match is strongest signal
        if (title.startsWith(term)) score += 8      // starts with country = very relevant
        else if (title.includes(term + ':')) score += 7  // "Country: headline"
        else if (title.includes(term + ' ')) score += 5  // country in title
        else if (title.includes(term)) score += 4        // country mentioned in title
        // Description match is weaker
        if (desc.includes(term)) score += 1
      }

      // Penalize if country only appears at end of title (likely just context)
      const mainTerm = searchTerms[0]
      if (mainTerm && title.includes(mainTerm)) {
        const pos = title.indexOf(mainTerm) / title.length
        if (pos > 0.7) score -= 2  // country mentioned late = probably not the focus
      }

      return { ...article, relevanceScore: score }
    })
    .filter(a => a.relevanceScore >= 4)  // must appear in title
    .sort((a, b) => b.relevanceScore - a.relevanceScore)

  return scored.slice(0, limit)
}

export function getCacheStats() {
  return { articleCount: articleCache.length, lastFetched }
}
