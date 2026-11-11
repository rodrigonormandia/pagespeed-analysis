#!/usr/bin/env node
/**
 * Atribui cada requisição de script ao frame que a originou.
 *
 * Existe por um motivo específico: quando o Lighthouse lista o mesmo script duas
 * vezes, a leitura intuitiva ("a lib carrega duas vezes") costuma estar errada.
 * Quase sempre há DOIS documentos carregando o mesmo stack — a página e um
 * iframe embutido (agendamento, chat, formulário) que sobe o mesmo
 * GTM/Pixel/Analytics.
 *
 * Isso custa CPU e ainda contamina os dados: PageView, sessão e conversões
 * duplicados. Sem atribuição por frame, é praticamente impossível diagnosticar.
 *
 *   node cdp-frames.mjs <URL> [SEGUNDOS] [CAMINHO_DO_CHROME]
 */

import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

const URL_ALVO = process.argv[2]
if (!URL_ALVO) {
  console.error('uso: node cdp-frames.mjs <URL> [segundos] [caminho-do-chrome]')
  process.exit(1)
}
const ESPERA = Number(process.argv[3] || 15) * 1000
const CHROME =
  process.argv[4] ||
  process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : 'google-chrome')

const PORTA = 9500 + Math.floor(Math.random() * 400)
const dorme = (ms) => new Promise((r) => setTimeout(r, ms))

const proc = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORTA}`,
    '--headless=new',
    '--no-sandbox',
    `--user-data-dir=${tmpdir()}/cdp-frames-${PORTA}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let alvo
for (let i = 0; i < 60; i++) {
  try {
    const lista = await (await fetch(`http://127.0.0.1:${PORTA}/json/list`)).json()
    alvo = lista.find((t) => t.type === 'page')
    if (alvo) break
  } catch {}
  await dorme(250)
}
if (!alvo) {
  console.error('não consegui falar com o Chrome — confira o caminho do executável')
  proc.kill()
  process.exit(1)
}

const ws = new WebSocket(alvo.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let id = 0
const pendentes = new Map()
const urlDoFrame = {}
const reqs = []

ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Page.frameNavigated') urlDoFrame[m.params.frame.id] = m.params.frame.url
  if (m.method === 'Network.requestWillBeSent')
    reqs.push({ url: m.params.request.url, frame: m.params.frameId, tipo: m.params.type })
  if (pendentes.has(m.id)) {
    pendentes.get(m.id)(m)
    pendentes.delete(m.id)
  }
}

const enviar = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id
    pendentes.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })

await enviar('Network.enable')
await enviar('Page.enable')
await enviar('Emulation.setDeviceMetricsOverride', {
  width: 412, height: 823, deviceScaleFactor: 2, mobile: true,
})
await enviar('Page.navigate', { url: URL_ALVO })
await dorme(ESPERA)

const interessantes =
  /googletagmanager\.com|connect\.facebook\.net|clarity\.ms|google-analytics|hotjar|segment|amplitude|\.js(\?|$)/

const porFrame = {}
for (const r of reqs) {
  if (!interessantes.test(r.url)) continue
  const f = (urlDoFrame[r.frame] || '(frame desconhecido)').split('?')[0]
  ;(porFrame[f] ||= []).push(r.url.replace(/^https?:\/\//, '').split('?')[0])
}

console.log(`\n${URL_ALVO}\n`)
const frames = Object.entries(porFrame)
for (const [frame, urls] of frames) {
  console.log(`FRAME  ${frame.slice(0, 78)}`)
  const unicas = [...new Set(urls)]
  unicas.slice(0, 14).forEach((u) => console.log(`   - ${u.slice(0, 74)}`))
  if (unicas.length > 14) console.log(`   … e mais ${unicas.length - 14}`)
  console.log()
}

if (frames.length > 1) {
  const [principal, ...outros] = frames
  const doPrincipal = new Set(principal[1].map((u) => u.split('/').slice(0, 3).join('/')))
  const repetidos = outros.flatMap(([f, urls]) =>
    [...new Set(urls)].filter((u) => doPrincipal.has(u.split('/').slice(0, 3).join('/'))).map((u) => [f, u]),
  )
  if (repetidos.length) {
    console.log('⚠  STACK DUPLICADO — estes hosts carregam no documento principal E num iframe:\n')
    const hosts = [...new Set(repetidos.map(([, u]) => u.split('/')[0]))]
    hosts.forEach((h) => console.log(`   ${h}`))
    console.log(
      '\n   Custo: o JS executa duas vezes, e as tags disparam PageView/sessão/conversão em duplicidade.',
    )
    console.log(
      '   Correções: (a) não montar o iframe durante o carregamento — use sinal de intenção;',
    )
    console.log(
      '              (b) pedir a quem mantém o widget que detecte window.self !== window.top',
    )
    console.log('                  e não suba as tags lá dentro (correção de raiz).\n')
  }
}

ws.close()
proc.kill()
