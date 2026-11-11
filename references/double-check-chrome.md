# Double-check no PageSpeed via Chrome

Nenhuma afirmação sobre nota sai daqui sem passar por este arquivo. É o passo que
separa "acho que melhorou" de "melhorou".

Vale tanto para o **baseline** (antes de mexer em qualquer coisa) quanto para a
**validação** (depois do deploy). Os dois usam o mesmo procedimento.

## Por que pelo Chrome e não pela API

A API do PageSpeed (`googleapis.com/pagespeedonline/v5`) exige chave e a cota
gratuita costuma estar esgotada — retorna `RESOURCE_EXHAUSTED` sem avisar o
motivo real. A interface web não pede chave e entrega o mesmo relatório, com o
objeto completo acessível na página.

## O procedimento

Carregue as ferramentas de navegador e faça **três medições**. A variância entre
execuções é grande — já se viu 44, 90 e 52 no mesmo build — então uma só não
conclui nada.

Para cada medição:

```
1. navegar para
   https://pagespeed.web.dev/analysis?url=<URL-encodada>&form_factor=mobile

2. esperar ~20s

3. tirar um screenshot
   Isso faz duas coisas: força um quadro de renderização (destrava a aba em
   segundo plano) e revela o <id> do relatório na URL, que passa a ser
   /analysis/<slug>/<id>

4. navegar de novo para /analysis/<slug>/<id>
   O relatório já está pronto no servidor; recarregar a URL final faz a página
   montar direto, em vez de ficar no polling estrangulado.

5. esperar ~10s e ler window.__LIGHTHOUSE_MOBILE_JSON__
```

Se a variável vier vazia, repita os passos 4 e 5 — a aba em segundo plano às
vezes precisa de um segundo empurrão.

## O que extrair de cada execução

```js
const r = window.__LIGHTHOUSE_MOBILE_JSON__
if (!r) { JSON.stringify({ status: 'ainda rodando' }) } else {
  const c = r.configSettings, m = r.audits.metrics.details.items[0]
  JSON.stringify({
    // AMBIENTE — anote na primeira execução; é o que você replica localmente
    versao: r.lighthouseVersion,
    // o nome costuma ter parênteses ("moto g power (2022)"), então nada de [^)]
    aparelho: (c.emulatedUserAgent || '').split(') AppleWebKit')[0].split(';').pop()?.trim(),
    tela: `${c.screenEmulation.width}x${c.screenEmulation.height}@${c.screenEmulation.deviceScaleFactor}x`,
    cpu: c.throttling.cpuSlowdownMultiplier,
    benchmarkIndex: r.environment?.benchmarkIndex,

    // MÉTRICAS
    score: Math.round(r.categories.performance.score * 100),
    FCP: m.firstContentfulPaint, LCP: m.largestContentfulPaint,
    TBT: m.totalBlockingTime,   SI: m.speedIndex,
    CLS: +m.cumulativeLayoutShift.toFixed(3),
    obsFCP: Math.round(m.observedFirstContentfulPaint),
    obsLCP: Math.round(m.observedLargestContentfulPaint),
    a11y: Math.round(r.categories.accessibility.score * 100),
    seo: Math.round(r.categories.seo.score * 100),
  }, null, 1)
}
```

O bloco de **ambiente** é o que alimenta o passo seguinte. Anote na primeira
execução e alinhe o local com ele — `scripts/ambiente.js` compara dois relatórios
e diz se são comparáveis.

## Onde estão as respostas dentro do relatório

```js
const a = window.__LIGHTHOUSE_MOBILE_JSON__.audits

a['bootup-time'].details.items               // custo de execução por script
a['mainthread-work-breakdown'].details.items // scriptEvaluation, styleLayout, paint…
a['network-requests'].details.items          // toda requisição, com timing e bytes
a['unused-javascript'].details.items         // JS não usado por arquivo
a['third-party-summary'].details.items       // blocking time por entidade
a['largest-contentful-paint-element']        // elemento de LCP e fases (LH 12)
a['lcp-breakdown-insight']                   // idem (LH 13+, sufixo -insight)
```

Para listar tudo que falhou de uma vez:

```js
Object.entries(a).filter(([k, x]) => x.score === 0 && x.details?.items?.length).map(([k]) => k)
```

E se o usuário mandou só um print: use-o para saber onde olhar, mas **extraia o
JSON mesmo assim** — o print esconde o ambiente, os valores observados e os
detalhes dos insights, que é onde o diagnóstico de verdade mora.

## Dados de campo (CrUX) mudam o alvo

O bloco "Entender a experiência dos seus usuários" pode vir em dois estados:

- **"Nenhum dado"** — tráfego insuficiente no CrUX. Você só tem laboratório, e a
  mediana de três execuções vira ainda mais importante.
- **Com dados** — então **o campo é o alvo, não o laboratório**. São medições de
  usuários reais nos últimos 28 dias, e é isso que o Google usa como sinal de
  ranking. O laboratório passa a ser ferramenta de diagnóstico: se o campo diz
  que o LCP p75 está bom e o laboratório diz que está ruim, os usuários reais
  ganham a discussão.

  O global da página é o LHR puro e **não** carrega o campo — leia os p75 do
  bloco renderizado (expanda "Entender a experiência dos seus usuários" e extraia
  do `innerText`, ou de um screenshot). Reporte campo e laboratório separados,
  deixando claro qual é qual.

Atenção à inércia: o campo é janela de 28 dias — melhorias levam semanas para
aparecer lá. Valide o deploy pelo laboratório e acompanhe o campo ao longo do mês.

## Desktop também

O mesmo relatório traz `window.__LIGHTHOUSE_DESKTOP_JSON__`. Extraia os dois: o
desktop costuma reagir mais rápido às otimizações (CPU folgada) e ajuda a separar
"problema de CPU no mobile" de "problema para todo mundo".

## Fechando o double-check

Rode `scripts/ambiente.js <psi.json> <local.json>`. Ele aponta divergência de
versão, aparelho, tela e CPU throttling, e compara o `benchmarkIndex` das duas
máquinas — a medida que o próprio Lighthouse faz da velocidade do host.

Se o `benchmarkIndex` local for muito maior que o do PSI, sua máquina é mais
rápida na mesma proporção e **o score local será otimista**, mesmo com tudo
alinhado. Use o local para comparar variantes entre si; use o PSI para afirmar a
nota.

## Como reportar

Sempre com as três execuções à vista:

```
PageSpeed mobile (3 execuções)
  score:  58, 52, 36   → mediana 52
  LCP:    2.803, 11.318, 11.612 ms
  TBT:    3.924, 1.343, 665 ms
  a11y:   96 nas três
  ambiente: Lighthouse 13.4.1 · moto g power (2022) · CPU 4x
```

Dar só o melhor número é enganoso; dar só um número é ruído. A mediana com a
distribuição visível é o que permite ao usuário julgar sozinho.

Se um dos três destoar muito, diga — e se souber a causa (`obsFCP` alto,
`benchmarkIndex` baixo naquela execução), diga também.

## Quando desconfiar do próprio resultado

- **Três execuções muito espalhadas** (ex.: 36, 52, 58): a máquina do PSI estava
  sob carga variável. Rode mais duas.
- **Distribuição bimodal** (dois grupos, sem meio-termo): não é ruído, é causa
  específica. Compare um relatório de cada grupo — normalmente é recurso
  render-blocking ou algo carregando dentro da janela de medição.
- **Simulado muito maior que o observado** (LCP 11 s com obsLCP 2,5 s): a página
  está rápida e o modelo está amplificando trabalho de CPU. O caminho é reduzir
  JS, não rede.
