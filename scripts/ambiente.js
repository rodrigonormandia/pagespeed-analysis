#!/usr/bin/env node
/**
 * Lê o ambiente de execução de um relatório Lighthouse e, dados dois relatórios,
 * diz o quanto eles são comparáveis.
 *
 * Existe porque assumir a versão e o aparelho é o erro que mais estraga
 * diagnóstico. Scores de versões maiores diferentes NÃO são comparáveis mesmo
 * quando a emulação é idêntica: o motor de simulação e as auditorias mudam, e
 * na prática a troca de LH 12 para 13 moveu ~20 pontos no mesmo build. E mesmo
 * com a versão alinhada, uma máquina de desenvolvimento é muito mais rápida que
 * a do PageSpeed — por isso o benchmarkIndex também entra na comparação.
 *
 *   node ambiente.js <relatorio.json>                 mostra o ambiente
 *   node ambiente.js <psi.json> <local.json>          compara os dois
 */

const path = require('path')

function ler(p) {
  const r = require(path.resolve(p))
  const c = r.configSettings ?? {}
  const ua = c.emulatedUserAgent ?? ''
  // O modelo vem no fim do bloco entre parênteses do user agent, ex.:
  //   "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/..."
  // Não dá para usar [^)] porque o próprio nome costuma ter parênteses — pegamos
  // tudo antes de ") AppleWebKit" e ficamos com o último campo separado por ';'.
  const bloco = ua.split(') AppleWebKit')[0]
  const modelo = !(c.screenEmulation?.mobile)
    ? '(desktop)'
    : bloco.includes(';')
      ? bloco.split(';').pop().trim()
      : '(sem emulação de aparelho)'
  const s = c.screenEmulation ?? {}
  return {
    arquivo: path.basename(p),
    versao: r.lighthouseVersion,
    formFactor: c.formFactor,
    modelo,
    tela: s.width ? `${s.width}x${s.height} @${s.deviceScaleFactor}x` : '(sem emulação)',
    metodo: c.throttlingMethod,
    cpu: c.throttling?.cpuSlowdownMultiplier,
    rede: c.throttling?.throughputKbps ? `${Math.round(c.throttling.throughputKbps)} kbps / ${c.throttling.rttMs}ms RTT` : '-',
    // Índice de desempenho da MÁQUINA que rodou o teste. Quanto maior, mais rápida.
    benchmark: r.environment?.benchmarkIndex,
    score: r.categories?.performance ? Math.round(r.categories.performance.score * 100) : null,
  }
}

function mostrar(a) {
  console.log(`\n  ${a.arquivo}`)
  console.log(`    Lighthouse .......... ${a.versao}`)
  console.log(`    form factor ......... ${a.formFactor}`)
  console.log(`    aparelho emulado .... ${a.modelo}`)
  console.log(`    tela ................ ${a.tela}`)
  console.log(`    throttling .......... ${a.metodo} · CPU ${a.cpu}x · ${a.rede}`)
  console.log(`    benchmarkIndex ...... ${a.benchmark ?? '?'}   (velocidade da máquina de teste)`)
  if (a.score !== null) console.log(`    score ............... ${a.score}`)
}

const [p1, p2] = process.argv.slice(2)
if (!p1) {
  console.error('uso: node ambiente.js <relatorio.json> [outro.json]')
  process.exit(1)
}

const a = ler(p1)
mostrar(a)

if (!p2) {
  console.log(`
  Para reproduzir este ambiente localmente:

    npx lighthouse@${a.versao} <URL> \\
      --only-categories=performance \\
      --form-factor=${a.formFactor} \\
      --output=json --output-path=./lh.json \\
      --chrome-flags="--headless=new --no-sandbox" --quiet

  Não passe --screenEmulation: os padrões desta versão já são o aparelho acima.
  Passar valores manualmente é como as medições saem desalinhadas sem ninguém notar.
`)
  process.exit(0)
}

const b = ler(p2)
mostrar(b)

console.log('\n' + '─'.repeat(66))
console.log('  COMPARABILIDADE')
console.log('─'.repeat(66))

const problemas = []
if (a.versao !== b.versao)
  problemas.push(`versões diferentes (${a.versao} vs ${b.versao}) — motor de simulação e auditorias mudam entre versões`)
if (a.modelo !== b.modelo) problemas.push(`aparelhos diferentes (${a.modelo} vs ${b.modelo})`)
if (a.tela !== b.tela) problemas.push(`telas diferentes (${a.tela} vs ${b.tela})`)
if (a.cpu !== b.cpu) problemas.push(`CPU throttling diferente (${a.cpu}x vs ${b.cpu}x)`)

if (problemas.length) {
  console.log('\n  ⚠ Estes relatórios NÃO são comparáveis:')
  problemas.forEach((p) => console.log(`      · ${p}`))
  console.log(`\n    Alinhe antes de tirar conclusão:  npx lighthouse@${a.versao} ...`)
} else {
  console.log('\n  ✓ Versão, aparelho e throttling batem.')
}

if (a.benchmark && b.benchmark) {
  const razao = b.benchmark / a.benchmark
  console.log(`\n  benchmarkIndex: ${a.benchmark} vs ${b.benchmark}  →  ${razao.toFixed(2)}x`)
  if (razao > 1.3) {
    console.log(`\n  ⚠ A máquina de "${b.arquivo}" é ${razao.toFixed(1)}x mais rápida.`)
    console.log('    Mesmo com tudo alinhado, o score dela será otimista.')
    console.log('    Use-a para COMPARAR variantes entre si, nunca para prever a nota.')
  } else if (razao < 0.77) {
    console.log(`\n  ⚠ A máquina de "${b.arquivo}" é ${(1 / razao).toFixed(1)}x mais lenta — score pessimista.`)
  } else {
    console.log('    Máquinas de velocidade parecida; os scores são comparáveis.')
  }
}

if (a.score !== null && b.score !== null) {
  console.log(`\n  score: ${a.score} vs ${b.score}  (diferença de ${Math.abs(a.score - b.score)} pontos)`)
  if (Math.abs(a.score - b.score) > 10) {
    console.log('    Diferença grande. Antes de atribuir ao código, confira acima se o')
    console.log('    ambiente explica — e lembre que uma execução só não conclui nada.')
  }
}
console.log()
