#!/usr/bin/env node
/**
 * Mostra quantos pontos cada métrica está custando no score de performance.
 *
 * Use isto ANTES de escolher o que otimizar. A nota é uma soma ponderada, e sem
 * saber onde estão os pontos perdidos é fácil gastar um dia em imagens enquanto
 * o problema são 30 pontos presos no TBT.
 *
 *   node decompor-score.js relatorio.json
 *   node decompor-score.js relatorio.json --insights   (lista também o que falhou)
 */

// Fallback apenas — os pesos DE VERDADE vêm do próprio relatório
// (categories.performance.auditRefs[].weight), o que mantém o script correto
// mesmo quando uma versão nova do Lighthouse mudar a ponderação.
const PESOS_FALLBACK = {
  'first-contentful-paint': 10,
  'speed-index': 10,
  'largest-contentful-paint': 25,
  'total-blocking-time': 30,
  'cumulative-layout-shift': 25,
}

const caminho = process.argv[2]
if (!caminho) {
  console.error('uso: node decompor-score.js <relatorio.json> [--insights]')
  process.exit(1)
}

const r = require(require('path').resolve(caminho))
const a = r.audits
const m = a.metrics?.details?.items?.[0] ?? {}

// Pesos reais desta versão do Lighthouse, direto do relatório.
const refs = (r.categories?.performance?.auditRefs ?? []).filter((x) => x.weight > 0)
const PESOS = refs.length
  ? Object.fromEntries(refs.map((x) => [x.id, x.weight]))
  : PESOS_FALLBACK
if (!refs.length) console.log('(auditRefs sem pesos — usando a tabela de fallback)')

console.log(`\nLighthouse ${r.lighthouseVersion}  ·  ${r.configSettings?.formFactor ?? '?'}`)
console.log(`score de performance: ${Math.round(r.categories.performance.score * 100)}\n`)

console.log('métrica                      valor      score   peso   PONTOS PERDIDOS')
console.log('─'.repeat(74))

const linhas = Object.entries(PESOS)
  .map(([id, peso]) => {
    const aud = a[id]
    if (!aud || aud.score === null) return null
    return { id, peso, valor: aud.displayValue ?? '-', score: aud.score, perda: (1 - aud.score) * peso }
  })
  .filter(Boolean)
  .sort((x, y) => y.perda - x.perda)

for (const l of linhas) {
  console.log(
    l.id.padEnd(28) +
      String(l.valor).padEnd(11) +
      l.score.toFixed(2).padEnd(8) +
      (l.peso + '%').padEnd(7) +
      l.perda.toFixed(1),
  )
}
console.log('─'.repeat(74))
console.log('total perdido: ' + linhas.reduce((s, l) => s + l.perda, 0).toFixed(1) + ' pontos\n')

const alvo = linhas[0]
if (alvo && alvo.perda > 1) {
  console.log(`>> Ataque primeiro: ${alvo.id} (${alvo.perda.toFixed(1)} pontos)\n`)
}

// Observado vs simulado — a distinção que evita diagnóstico errado.
const obs = {
  FCP: [m.firstContentfulPaint, m.observedFirstContentfulPaint],
  LCP: [m.largestContentfulPaint, m.observedLargestContentfulPaint],
}
console.log('              simulado (vira nota)   observado (real)')
for (const [k, [sim, ob]] of Object.entries(obs)) {
  if (sim == null || ob == null) continue
  const razao = ob > 0 ? (sim / ob).toFixed(1) : '?'
  console.log(`  ${k}         ${String(Math.round(sim)).padStart(8)}ms ${String(Math.round(ob)).padStart(17)}ms   (simulação amplia ${razao}x)`)
}
if (m.observedFirstContentfulPaint && m.observedFirstContentfulPaint === m.observedLargestContentfulPaint) {
  console.log('  → obsFCP == obsLCP: tudo pinta junto; o gargalo está ANTES da 1ª pintura')
}
console.log()

if (process.argv.includes('--insights')) {
  console.log('auditorias/insights falhando:')
  for (const [id, x] of Object.entries(a)) {
    if (x?.score === 0 && x.details?.items?.length) {
      console.log(`  [${id}] ${x.displayValue ?? x.title ?? ''}`)
    }
  }
  console.log()

  const bt = a['bootup-time']?.details?.items ?? []
  if (bt.length) {
    console.log('custo de execução por script (bootup-time):')
    bt.slice(0, 8).forEach((i) =>
      console.log(`  ${String(Math.round(i.total)).padStart(5)}ms  ${(i.url || '').split('?')[0].slice(0, 62)}`),
    )
    console.log()
  }
}
