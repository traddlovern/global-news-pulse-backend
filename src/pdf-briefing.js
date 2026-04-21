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

export function generateCountryBriefing(riskData, res) {
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

  // ── SUMMARY ─────────────────────────────────────────────────────────────────
  let y = 202

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
    if (y > PH - 60) break
    const cc = CAT_COLORS[story.category] || '#868E96'

    doc.rect(L, y, 2, 32).fill(cc)

    doc.fontSize(7).font('Helvetica-Bold').fillColor(cc)
      .text((story.category || '').toUpperCase(), L + 8, y + 1, { characterSpacing: 0.5 })

    if (story.sourceTier === 1) {
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#2F9E44')
        .text('* VERIFIED', L + 8, y + 1, { width: UW - 8, align: 'right' })
    }

    doc.fontSize(7).font('Helvetica').fillColor('#868E96')
      .text(`Score: ${story.score}`, L + 8, y + 1, { width: UW - 8, align: 'right' })

    y += 12
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#111111')
      .text(story.headline || '', L + 8, y, { width: UW - 8 })
    y += 12

    const src = story.sourceName || (story.sourceUrl ? (() => { try { return new URL(story.sourceUrl).hostname.replace('www.','') } catch { return '' } })() : '')
    if (src) {
      doc.fontSize(7.5).font('Helvetica').fillColor('#0099BB').text(src, L + 8, y)
    }
    y += 14
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
