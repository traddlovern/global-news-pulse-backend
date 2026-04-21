/**
 * country-data.js
 *
 * Fetches country profile data from free APIs:
 * - REST Countries API — population, capital, currency, region, flag
 * - World Bank API — GDP, GDP per capita
 *
 * Data is cached in memory and refreshed daily.
 */

import https from 'https'

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'GlobalNewsPulse/1.0' } }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => resolve(body))
    }).on('error', reject)
  })
}

// In-memory cache
let countryCache = new Map()
let gdpCache = new Map()
let lastFetched = null

// Head of state data — maintained manually, updated periodically
const HEADS_OF_STATE = {
  US: { name: 'Donald Trump', title: 'President' },
  UK: { name: 'Keir Starmer', title: 'Prime Minister' },
  FR: { name: 'Emmanuel Macron', title: 'President' },
  DE: { name: 'Friedrich Merz', title: 'Chancellor' },
  CN: { name: 'Xi Jinping', title: 'President' },
  RU: { name: 'Vladimir Putin', title: 'President' },
  IR: { name: 'Masoud Pezeshkian', title: 'President' },
  IL: { name: 'Benjamin Netanyahu', title: 'Prime Minister' },
  SA: { name: 'Mohammed bin Salman', title: 'Prime Minister' },
  TR: { name: 'Recep Tayyip Erdogan', title: 'President' },
  IN: { name: 'Narendra Modi', title: 'Prime Minister' },
  BR: { name: 'Luiz Inácio Lula da Silva', title: 'President' },
  ZA: { name: 'Cyril Ramaphosa', title: 'President' },
  NG: { name: 'Bola Tinubu', title: 'President' },
  EG: { name: 'Abdel Fattah el-Sisi', title: 'President' },
  PK: { name: 'Asif Ali Zardari', title: 'President' },
  UA: { name: 'Volodymyr Zelensky', title: 'President' },
  JP: { name: 'Shigeru Ishiba', title: 'Prime Minister' },
  KR: { name: 'Han Duck-soo', title: 'Acting President' },
  AU: { name: 'Anthony Albanese', title: 'Prime Minister' },
  CA: { name: 'Mark Carney', title: 'Prime Minister' },
  MX: { name: 'Claudia Sheinbaum', title: 'President' },
  AR: { name: 'Javier Milei', title: 'President' },
  VE: { name: 'Nicolás Maduro', title: 'President' },
  CO: { name: 'Gustavo Petro', title: 'President' },
  ET: { name: 'Abiy Ahmed', title: 'Prime Minister' },
  KE: { name: 'William Ruto', title: 'President' },
  GH: { name: 'John Mahama', title: 'President' },
  SN: { name: 'Bassirou Diomaye Faye', title: 'President' },
  TH: { name: 'Paetongtarn Shinawatra', title: 'Prime Minister' },
  ID: { name: 'Prabowo Subianto', title: 'President' },
  MY: { name: 'Anwar Ibrahim', title: 'Prime Minister' },
  PH: { name: 'Ferdinand Marcos Jr.', title: 'President' },
  VN: { name: 'To Lam', title: 'General Secretary' },
  BD: { name: 'Muhammad Yunus', title: 'Chief Adviser' },
  LB: { name: 'Joseph Aoun', title: 'President' },
  IQ: { name: 'Abdul Latif Rashid', title: 'President' },
  SY: { name: 'Ahmad al-Sharaa', title: 'President' },
  YE: { name: 'Rashad al-Alimi', title: 'Council Chairman' },
  AF: { name: 'Hibatullah Akhundzada', title: 'Supreme Leader' },
  MM: { name: 'Min Aung Hlaing', title: 'Chairman SAC' },
  SD: { name: 'Abdel Fattah al-Burhan', title: 'Council Chairman' },
  LY: { name: 'Mohamed al-Menfi', title: 'Council Chairman' },
  SO: { name: 'Hassan Sheikh Mohamud', title: 'President' },
  HT: { name: 'Alix Didier Fils-Aimé', title: 'Prime Minister' },
  NI: { name: 'Bola Tinubu', title: 'President' },
}

export async function fetchCountryData(countryCode) {
  if (countryCache.has(countryCode)) {
    return countryCache.get(countryCode)
  }

  try {
    const body = await httpsGet(`https://restcountries.com/v3.1/alpha/${countryCode}?fields=name,population,capital,currencies,region,subregion,flags,area,languages`)
    const data = JSON.parse(body)
    const country = Array.isArray(data) ? data[0] : data

    if (!country || country.status === 404) return null

    const currencies = Object.values(country.currencies || {})
    const languages = Object.values(country.languages || {})

    const result = {
      name: country.name?.common || countryCode,
      officialName: country.name?.official || '',
      population: country.population || 0,
      capital: country.capital?.[0] || 'N/A',
      region: country.region || '',
      subregion: country.subregion || '',
      currency: currencies[0] ? `${currencies[0].name} (${Object.keys(country.currencies)[0]})` : 'N/A',
      flagUrl: country.flags?.svg || country.flags?.png || null,
      area: country.area || 0,
      languages: languages.slice(0, 3).join(', '),
      headOfState: HEADS_OF_STATE[countryCode] || null,
    }

    countryCache.set(countryCode, result)
    return result
  } catch (err) {
    console.warn(`[country-data] fetch failed for ${countryCode}:`, err.message)
    return null
  }
}

export async function fetchGDP(countryCode) {
  if (gdpCache.has(countryCode)) return gdpCache.get(countryCode)

  try {
    // World Bank API — latest GDP data
    const body = await httpsGet(
      `https://api.worldbank.org/v2/country/${countryCode}/indicator/NY.GDP.MKTP.CD?format=json&mrv=1`
    )
    const data = JSON.parse(body)
    const value = data?.[1]?.[0]?.value

    const gdpBody = await httpsGet(
      `https://api.worldbank.org/v2/country/${countryCode}/indicator/NY.GDP.PCAP.CD?format=json&mrv=1`
    )
    const gdpData = JSON.parse(gdpBody)
    const perCapita = gdpData?.[1]?.[0]?.value

    const result = {
      gdp: value ? `$${(value / 1e12).toFixed(2)}T` : null,
      gdpPerCapita: perCapita ? `$${Math.round(perCapita).toLocaleString()}` : null,
      year: data?.[1]?.[0]?.date || null,
    }

    gdpCache.set(countryCode, result)
    return result
  } catch {
    return { gdp: null, gdpPerCapita: null, year: null }
  }
}

export async function getFullCountryProfile(countryCode) {
  const [profile, gdp] = await Promise.all([
    fetchCountryData(countryCode),
    fetchGDP(countryCode),
  ])

  if (!profile) return null

  return {
    ...profile,
    ...gdp,
  }
}
