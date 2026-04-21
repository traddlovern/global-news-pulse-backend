import PDFDocument from 'pdfkit'

const RISK_DESC = {
  CRITICAL: 'Active crisis conditions detected. Immediate review recommended. Consider suspension of new investments and review of existing exposures.',
  HIGH:     'Significant instability signals present. Enhanced monitoring required. New investments should undergo additional scrutiny.',
  ELEVATED: 'Above-normal activity detected. Monitor closely and review deal terms for risk mitigation clauses.',
  MODERATE: 'Some elevated activity noted. Standard due diligence procedures apply with awareness of identified risk factors.',
  LOW:      'Stable conditions with minimal risk signals. Normal investment assessment procedures apply.',
}

const RISK_COLORS = {
  CRITICAL: '#C92A2A', HIGH: '#E03131', ELEVATED: '#E67700', MODERATE: '#F59F00', LOW: '#2F9E44'
}

const CAT_COLORS = {
  conflict: '#C92A2A', politics: '#1971C2', economy: '#E67700',
  climate: '#2F9E44', tech: '#7048E8', diplomacy: '#C2255C', general: '#868E96',
}

export function generateCountryBriefing(riskData, res, countryProfile = null) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 })

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="OnionJack-Risk-${riskData.countryCode}-${new Date().toISOString().slice(0,10)}.pdf"`)
  doc.pipe(res)

  const PW = doc.page.width
  const PH = doc.page.height
  const L = 50
  const R = PW - 50
  const UW = R - L
  const riskColor = RISK_COLORS[riskData.level] || '#868E96'
  const countryName = riskData.locationName?.split(',').pop().trim() || riskData.countryCode
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  // ── HEADER ──────────────────────────────────────────────────────────────────
  doc.rect(0, 0, PW, 70).fill('#0D1117')
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#FFFFFF')
    .text('GLOBAL NEWS PULSE', L, 18)
  doc.fontSize(7).font('Helvetica').fillColor('#888888')
    .text('ONIOJACK  ·  OSINT INTELLIGENCE PLATFORM  ·  CONFIDENTIAL', L, 38)
  doc.fontSize(7).font('Helvetica').fillColor('#666666')
    .text(today, L, 52)

  // ── RISK HERO ───────────────────────────────────────────────────────────────
  doc.rect(0, 70, PW, 110).fill(riskColor)

  // Country name
  doc.fontSize(30).font('Helvetica-Bold').fillColor('#FFFFFF')
    .text(countryName.toUpperCase(), L, 85)

  // Risk level
  doc.fontSize(9).font('Helvetica').fillColor('rgba(255,255,255,0.75)')
    .text(`RISK LEVEL  ·  ${riskData.level}  ·  TREND: ${(riskData.trend || 'N/A').toUpperCase()}`, L, 124)

  // Score box on right
  doc.rect(R - 80, 80, 80, 80).fill('rgba(0,0,0,0.2)')
  doc.fontSize(42).font('Helvetica-Bold').fillColor('#FFFFFF')
    .text(String(riskData.riskScore), R - 80, 88, { width: 80, align: 'center' })
  doc.fontSize(7).font('Helvetica').fillColor('rgba(255,255,255,0.7)')
    .text('/ 100', R - 80, 138, { width: 80, align: 'center' })

  // ── COUNTRY PROFILE ────────────────────────────────────────────────────────
  let y = 202

  if (countryProfile) {
    // Profile bar background
    doc.rect(0, y, PW, 78).fill('#F8F9FA')
    doc.moveTo(0, y).lineTo(PW, y).strokeColor('#DEE2E6').lineWidth(0.5).stroke()

    // Stats grid — 4 columns
    const stats = [
      { label: 'POPULATION', value: countryProfile.population ? (countryProfile.population / 1e6).toFixed(1) + 'M' : 'N/A' },
      { label: 'GDP', value: countryProfile.gdp || 'N/A' },
      { label: 'GDP PER CAPITA', value: countryProfile.gdpPerCapita || 'N/A' },
      { label: 'CAPITAL', value: countryProfile.capital || 'N/A' },
      { label: 'CURRENCY', value: countryProfile.currency?.split(' (')[0] || 'N/A' },
      { label: 'REGION', value: countryProfile.subregion || countryProfile.region || 'N/A' },
      { label: 'AREA', value: countryProfile.area ? (countryProfile.area / 1000).toFixed(0) + 'K km²' : 'N/A' },
      { label: 'LANGUAGE', value: countryProfile.languages?.split(',')[0] || 'N/A' },
    ]

    const colW = UW / 4
    stats.forEach((stat, i) => {
      const col = i % 4
      const row = Math.floor(i / 4)
      const sx = L + col * colW
      const sy = y + 10 + row * 32

      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#868E96')
        .text(stat.label, sx, sy, { width: colW - 8, characterSpacing: 0.5 })
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#111111')
        .text(stat.value, sx, sy + 10, { width: colW - 8 })
    })

    // Head of state
    if (countryProfile.headOfState) {
      doc.rect(R - 150, y + 10, 150, 58).fill('#EEEEEE')
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#868E96')
        .text('HEAD OF STATE', R - 145, y + 14, { characterSpacing: 0.5 })
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#111111')
        .text(countryProfile.headOfState.name, R - 145, y + 26, { width: 140 })
      doc.fontSize(8).font('Helvetica').fillColor('#555555')
        .text(countryProfile.headOfState.title, R - 145, y + 42)
    }

    doc.moveTo(0, y + 78).lineTo(PW, y + 78).strokeColor('#DEE2E6').lineWidth(0.5).stroke()
    y += 90
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────────

  doc.rect(L, y, UW, 56).fill('#F8F9FA')
  doc.rect(L, y, 3, 56).fill(riskColor)
  doc.fontSize(9).font('Helvetica').fillColor('#333333')
    .text(RISK_DESC[riskData.level] || '', L + 12, y + 10, { width: UW - 22, lineGap: 3 })
  y += 70

  // Section label
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#0099BB')
    .text('RISK COMPONENT ANALYSIS', L, y, { characterSpacing: 1.5 })
  y += 14

  doc.moveTo(L, y).lineTo(R, y).strokeColor('#DEE2E6').lineWidth(0.5).stroke()
  y += 10

  // ── COMPONENTS ──────────────────────────────────────────────────────────────
  const components = [
    { label: 'Current OSINT Score', value: riskData.components?.current || 0, weight: '30%' },
    { label: '7-Day Trend', value: riskData.components?.trend || 0, weight: '25%' },
    { label: 'Spike Frequency', value: riskData.components?.spikeFrequency || 0, weight: '20%' },
    { label: 'Category Risk', value: riskData.components?.categoryRisk || 0, weight: '15%' },
    { label: 'Source Corroboration', value: riskData.components?.corroboration || 0, weight: '10%' },
  ]

  for (const comp of components) {
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#222222').text(comp.label, L, y)
    doc.fontSize(8.5).font('Helvetica').fillColor('#868E96').text(comp.weight, L, y, { width: UW, align: 'right' })
    y += 14

    const bw = UW - 40
    doc.rect(L, y, bw, 7).fill('#EEEEEE')
    const fillW = Math.max((comp.value / 100) * bw, 2)
    const fc = comp.value > 65 ? '#E03131' : comp.value > 40 ? '#E67700' : '#0099BB'
    doc.rect(L, y, fillW, 7).fill(fc)
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#222222').text(`${comp.value}`, L + bw + 6, y - 1)
    y += 18
  }

  doc.moveTo(L, y).lineTo(R, y).strokeColor('#DEE2E6').lineWidth(0.5).stroke()
  y += 12

  // ── HEADLINES ───────────────────────────────────────────────────────────────
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#0099BB')
    .text('INTELLIGENCE HEADLINES', L, y, { characterSpacing: 1.5 })
  y += 14

  const stories = (riskData.topStories || []).filter(s => s.headline && s.realTitle).slice(0, 5)
  for (const story of stories) {
    if (y > PH - 70) break
    const cc = CAT_COLORS[story.category] || '#868E96'
    const isVerified = story.sourceTier === 1 || story.sourceTier === 2
    const rowH = isVerified ? 52 : 44

    // Left accent bar
    doc.rect(L, y, 2, rowH).fill(cc)

    // Row 1: category + score
    doc.fontSize(7).font('Helvetica-Bold').fillColor(cc)
      .text((story.category || 'general').toUpperCase(), L + 10, y + 4, { characterSpacing: 0.5 })
    doc.fontSize(7).font('Helvetica').fillColor('#868E96')
      .text(`Score: ${story.score}  |  Articles: ${story.numArticles || 0}`, R - 120, y + 4, { width: 120, align: 'right' })

    // Row 2: verified badge (if applicable)
    if (isVerified) {
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#2F9E44')
        .text('VERIFIED SOURCE', L + 10, y + 16)
    }

    // Row 3: headline — estimate lines needed
    const hlY = isVerified ? y + 27 : y + 16
    const headline = story.headline || ''
    const charsPerLine = Math.floor((UW - 12) / 5.5)
    const estimatedLines = Math.ceil(headline.length / charsPerLine)
    const hlHeight = estimatedLines * 13

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#111111')
      .text(headline, L + 10, hlY, { width: UW - 12 })

    // Row 4: source — positioned after headline
    const srcY = hlY + hlHeight
    const src = story.sourceName || (story.sourceUrl ? (() => { try { return new URL(story.sourceUrl).hostname.replace('www.','') } catch { return '' } })() : '')
    if (src) {
      doc.fontSize(7.5).font('Helvetica').fillColor('#0099BB').text(src, L + 10, srcY)
    }

    y += (isVerified ? 27 : 16) + hlHeight + 16
  }

  // ── FOOTER ──────────────────────────────────────────────────────────────────
  doc.rect(0, PH - 36, PW, 36).fill('#F1F3F5')
  doc.moveTo(0, PH - 36).lineTo(PW, PH - 36).strokeColor('#DEE2E6').lineWidth(0.5).stroke()
  doc.fontSize(6.5).font('Helvetica').fillColor('#868E96')
    .text('Generated from open-source intelligence. Not investment advice. Data sourced from GDELT, RSS feeds, and proprietary OSINT scoring.', L, PH - 24, { width: UW - 120 })
  doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#333333')
    .text('GLOBAL NEWS PULSE  |  ONIOJACK', R - 140, PH - 24, { width: 140, align: 'right' })

  doc.end()
}
