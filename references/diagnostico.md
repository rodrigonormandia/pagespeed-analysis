# Diagnóstico: sintoma → causa

Leia depois de ter o relatório em mãos. A ordem aqui é a ordem em que vale a pena
investigar.

## Antes de tudo: onde estão os pontos?

Rode `scripts/decompor-score.js` no JSON. Ele mostra quantos pontos cada métrica
está custando. Uma perda de 10 pontos no LCP e 9 no TBT pede trabalho nos dois;
uma perda de 25 no TBT e 2 no resto diz exatamente onde olhar.

Ignorar esse passo é o jeito mais comum de gastar um dia otimizando imagens
enquanto o problema é execução de JavaScript.

---

## LCP alto

Abra `audits['lcp-breakdown-insight']` (LH 13) ou
`audits['largest-contentful-paint-element']` (LH 12). Ele divide o LCP em fases:

### Render Delay domina (>70%)

O elemento já está no HTML e não pinta. **Causa quase certa: JavaScript.**

- Conteúdo renderizado no servidor com `opacity: 0` esperando hidratação →
  ver "Conteúdo escondido por animação" em `correcoes.md`
- Hidratação pesada bloqueando a thread — muitos client components
- Animação de `opacity` que não avança porque a thread está travada

Confira `observedLargestContentfulPaint`. Se for ~2 s enquanto o simulado é ~12 s,
a página está rápida e o modelo está amplificando trabalho de CPU. O caminho é
reduzir JS, não rede.

### Load Delay ou Load Time dominam

Aí sim é rede: o recurso do LCP demora a ser descoberto ou a chegar.

- imagem sem `priority`/`preload`
- imagem descoberta só depois de CSS ou JS
- recurso grande demais para o tamanho exibido

### TTFB domina

Problema de servidor ou CDN. Confira `x-vercel-cache` / `cf-cache-status` e o
`server-response-time`.

### O elemento de LCP é minúsculo

Se o LCP aponta para algo de 45×10 px, os candidatos maiores estão sendo
descartados — normalmente por estarem com `opacity: 0`. É um forte indício do
problema de hidratação acima.

---

## TBT alto

Olhe `audits['bootup-time']`, que dá o custo por script, e
`audits['mainthread-work-breakdown']`.

### Terceiros dominam

Some o bootup de googletagmanager, connect.facebook.net, clarity, hotjar e
similares. Se passar de metade, **o teto da nota está neles** e a decisão é de
negócio, não técnica. Ver a seção de terceiros no `SKILL.md`.

### O mesmo script aparece duas vezes

Não conclua que "a lib carrega duas vezes". Rode `scripts/cdp-frames.mjs`: quase
sempre há **dois documentos** carregando o mesmo stack — a página e um iframe
embutido (agendamento, chat, formulário) que sobe o mesmo GTM/Pixel.

Isso custa CPU e ainda contamina os dados: PageView, sessão e conversões
duplicados.

### Um chunk próprio pesa muito

Compare `transferSize` com `wastedBytes` em `unused-javascript`. Chunks de
framework (`react-dom`, runtime do router) têm desperdício inerente e não valem o
esforço. Bibliotecas de terceiros no seu bundle (animação, ícones, datas) valem.

Cuidado: substituir uma biblioteca por código próprio **pode piorar** — ver
`correcoes.md`.

### `scriptEvaluation` alto com `styleLayout` baixo

Sinal de que a renderização está bem e o problema é execução pura de JS.
`styleLayout` alto, ao contrário, sugere CSS custoso ou layout thrashing (ver
`forced-reflow-insight`).

---

## FCP alto ou bimodal

### `render-blocking-insight` aponta algo

Mesmo um CSS de 6 KB num `<link>` cria a cadeia `documento → CSS` e atrasa a
primeira pintura. Foi a causa de um FCP bimodal (~1,5 s ou ~5,7 s) num caso real.
Embutir o CSS crítico resolveu.

### Nada render-blocking, mas o FCP varia muito

Compare `observedFirstContentfulPaint` entre um run bom e um ruim. Se o
`domContentLoaded` for parecido e só o FCP mudar, a thread está ocupada com
hidratação antes de o browser conseguir pintar. Caminhos: `content-visibility`
nas seções fora da viewport, menos client components, menos JS no caminho
crítico.

---

## CLS acima de zero

`audits['layout-shifts']` ou `cls-culprits-insight` mostram os elementos.

Suspeitos comuns: imagem sem dimensão, fonte com troca de métrica, conteúdo
inserido por JS acima da dobra, e `contain-intrinsic-size` mal calibrado (ver
`correcoes.md` — o Lighthouse pode não pegar esse último, mas o usuário sente).

---

## Peso e requisições altos

`resource-summary` dá o total por tipo. Procure nesta ordem:

1. **vídeo** — costuma ser o maior item isolado; confira o codec (ver `correcoes.md`)
2. **imagens** — compare tamanho natural com o exibido em `uses-responsive-images`
3. **iframes de terceiros** carregados ansiosamente
4. **fontes** — famílias e pesos que ninguém usa

---

## Acessibilidade

Vale conferir junto, porque sai do mesmo relatório e costuma ter correção barata.

- `color-contrast` — dá os pares exatos e o mínimo exigido; ver `correcoes.md`
- `heading-order` — quase sempre um heading decorativo dentro de uma ilustração
- `frame-title` — iframe sem `title`
- `landmark-one-main` — falta `<main>`

Atenção a um efeito de segunda ordem: um elemento que só aparece após interação
(um modal, por exemplo) **não é auditado**. Se você mudar quando ele monta, podem
surgir "novas" falhas que na verdade sempre existiram — estavam escondidas do
auditor.

---

## O que não dá para corrigir

Diga isso em vez de gastar tempo:

- **APIs obsoletas apontando para `gtag/js`, `gtm.js` ou similar** — é código do
  Google. Some quando eles atualizarem.
- **TTL de cache de terceiros** (Facebook 20 min, Clarity 1 dia) — servidos pelos
  CDNs deles.
- **Cookies de terceiros** em `best-practices` — vêm das tags; só some removendo
  as tags.
