/**
 * reliefweb.js
 *
 * Fetches real-time crisis and disaster reports from ReliefWeb API.
 * Run by the UN OCHA — completely free, no API key required.
 * https://apidoc.rwlabs.org
 *
 * Provides:
 * - Active disaster/crisis reports with country and coordinates
 * - Humanitarian situation updates
 * - UN and NGO verified crisis data
 */

import https from 'https'

const API_BASE = 'https://api.reliefweb.int/v1'
const APP_NAME = 'NewsPulse-OSINT'

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const urlObj = new URL(url)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }
    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => resolve(body))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.setTimeout(10000)
    req.write(data)
    req.end()
  })
}

// Fetch active disasters and crises from ReliefWeb
export async function fetchActiveCrises() {
  try {
    const body = await httpsPost(`${API_BASE}/disasters?appname=${APP_NAME}`, {
      filter: {
        field: 'status',
        value: ['ongoing', 'alert'],
      },
      fields: {
        include: ['name', 'status', 'date', 'country', 'type', 'glide', 'description']
      },
      sort: ['date.created:desc'],
      limit: 50,
    })

    const data = JSON.parse(body)
    return (data.data || []).map(item => ({
      id: item.id,
      name: item.fields?.name || '',
      status: item.fields?.status || '',
      date: item.fields?.date?.created || null,
      countries: (item.fields?.country || []).map(c => ({
        name: c.name,
        iso3: c.iso3,
      })),
      types: (item.fields?.type || []).map(t => t.name),
      description: item.fields?.description || null,
      url: `https://reliefweb.int/disaster/${item.id}`,
    }))
  } catch (err) {
    console.warn('[reliefweb] disasters fetch failed:', err.message)
    return []
  }
}

// Fetch latest crisis reports (situation reports, flash updates)
export async function fetchLatestReports() {
  try {
    const body = await httpsPost(`${API_BASE}/reports?appname=${APP_NAME}`, {
      filter: {
        operator: 'AND',
        conditions: [
          { field: 'format.name', value: ['Situation Report', 'Flash Update', 'Emergency Response Plan'] },
        ]
      },
      fields: {
        include: ['title', 'date', 'country', 'source', 'format', 'url_alias', 'body-html']
      },
      sort: ['date.created:desc'],
      limit: 30,
    })

    const data = JSON.parse(body)
    return (data.data || []).map(item => ({
      id: item.id,
      title: item.fields?.title || '',
      date: item.fields?.date?.created || null,
      countries: (item.fields?.country || []).map(c => ({
        name: c.name,
        iso3: c.iso3,
      })),
      sources: (item.fields?.source || []).map(s => s.name),
      format: item.fields?.format?.[0]?.name || '',
      url: `https://reliefweb.int${item.fields?.url_alias || ''}`,
    }))
  } catch (err) {
    console.warn('[reliefweb] reports fetch failed:', err.message)
    return []
  }
}

// Cache
let crisisCache = []
let reportCache = []
let lastFetched = null

export async function fetchAllReliefWeb() {
  console.log('[reliefweb] fetching crises and reports...')
  const [crises, reports] = await Promise.all([
    fetchActiveCrises(),
    fetchLatestReports(),
  ])
  crisisCache = crises
  reportCache = reports
  lastFetched = new Date()
  console.log(`[reliefweb] ${crises.length} active crises, ${reports.length} recent reports`)
  return { crises, reports }
}

// Find ReliefWeb data for a specific country
export function findCrisesForCountry(countryName) {
  if (!countryName) return { crises: [], reports: [] }
  const name = countryName.toLowerCase()

  const matchingCrises = crisisCache.filter(c =>
    c.countries.some(co => co.name.toLowerCase().includes(name))
  )

  const matchingReports = reportCache.filter(r =>
    r.countries.some(co => co.name.toLowerCase().includes(name))
  ).slice(0, 3)

  return { crises: matchingCrises, reports: matchingReports }
}

export function getCrisisCache() {
  return { crises: crisisCache, reports: reportCache, lastFetched }
}
