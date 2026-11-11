# Next.js e React — armadilhas específicas

⚠️ Antes de escrever código, confira a documentação da versão instalada em
`node_modules/next/dist/docs/`. As APIs mudam entre majors e a memória do modelo
costuma estar desatualizada.

## React 19 pré-carrega `<img>` sozinho

Todo `<img>` renderizado no servidor **sem `loading="lazy"`** ganha um
`<link rel="preload" as="image">` no `<head>`, em prioridade alta.

Num caso real isso gerou 20 preloads (~800 KB) de conteúdo abaixo da dobra
disputando banda com o CSS render-blocking. A correção é trivial:

```jsx
<img src={...} alt={...} loading="lazy" decoding="async" />
```

`next/image` já é lazy por padrão. O problema mora nos `<img>` crus — procure com
`grep -rn "<img" src/ | grep -v "loading="`.

## Chunks são por rota

Consequência prática muito útil: **para uma rota parar de baixar uma biblioteca,
basta que nenhum componente da árvore daquela rota a importe.** As outras rotas
seguem usando normalmente.

Isso torna viável remover uma dependência pesada só da página que mais importa,
sem refatorar o projeto inteiro. Mapeie a árvore da rota antes:

```bash
grep -rln "from 'biblioteca'" src/components/<pasta-da-rota>/ src/components/shared/
```

Cuidado com componentes compartilhados: convertê-los alcança todas as rotas que
os usam. Teste todas.

## `experimental.inlineCss`

Troca o `<link>` do CSS da rota por um `<style>` no `<head>`, eliminando o único
recurso render-blocking que costuma sobrar.

```ts
// next.config.ts
const nextConfig: NextConfig = {
  experimental: { inlineCss: true },
}
```

Confirme depois: `curl -s <URL> | grep -c 'rel="stylesheet"'` deve dar 0.

## `beforeInteractive` não roda antes no App Router

No App Router, `<Script strategy="beforeInteractive">` é injetado via
`(self.__next_s).push(...)` e roda **durante a hidratação**. Não antecipa nada.

Se você precisa que um global exista antes de outros scripts, um `<script>` inline
no corpo do documento é mais previsível.

## Fontes no layout raiz vazam para todas as rotas

`next/font` declarado no layout raiz injeta o `@font-face` no CSS de **todas** as
rotas, mesmo com `preload: false`. Mova cada família para o layout da rota que a
usa:

```ts
// src/app/fontes-evento.ts
import { Rajdhani } from 'next/font/google'
const rajdhani = Rajdhani({ variable: '--font-rajdhani', subsets: ['latin'], display: 'swap' })
export const fontesEvento = `${rajdhani.variable}`
```

```tsx
// no layout da rota
<div className={`pagina ${fontesEvento}`}>{children}</div>
```

## Ícones e o `metadata.icons`

Ter `src/app/icon.png` **e** `metadata.icons` apontando para um arquivo em
`/public` gera duas requisições do mesmo ícone. Fique só com a convenção de
arquivo (`icon.png`, `apple-icon.png`), que já emite os `<link>` com `sizes`,
`type` e URL versionada.

Dimensione: 48×48 para a aba, 180×180 para apple-touch. Um PNG de 522×522 e 70 KB
como favicon é desperdício puro.

## Client components e hidratação

Uma página inteiramente feita de `'use client'` hidrata tudo de uma vez, e essa
long task bloqueia a primeira pintura. É a causa mais comum de FCP alto sem
nenhum recurso render-blocking.

Sinal no relatório: uma long task atribuída ao **documento** (`/`), não a um
script.

Mitigações, da mais barata à mais cara:

1. `content-visibility: auto` nas seções fora da viewport — corta style, layout e
   paint do que não está na tela (ver `correcoes.md` para calibrar o
   `contain-intrinsic-size`)
2. tirar animações que dependem de JS do caminho crítico
3. converter componentes de fato estáticos para server components

## `setState` dentro de effect

A regra `react-hooks/set-state-in-effect` reclama de `setState` síncrono dentro
de um effect. Duas saídas melhores que desabilitar a regra:

**Manipule o DOM direto quando for isso que você quer.** Sincronizar o React com
uma API da plataforma é exatamente o propósito de um effect:

```js
useEffect(() => {
  const el = ref.current
  if (!el) return
  const carregar = () => {
    if (el.getAttribute('src')) return
    el.setAttribute('src', SRC)
  }
  const io = new IntersectionObserver(([e]) => e.isIntersecting && carregar())
  io.observe(el)
  return () => io.disconnect()
}, [])
```

Bônus: não dispara re-render.

**Se precisar mesmo de estado**, torne a chamada assíncrona:

```js
const t = setTimeout(() => setPronto(true), 0)
return () => clearTimeout(t)
```

## `requestIdleCallback` dispara cedo demais

Depois do `load`, ele roda em ~300 ms numa conexão rápida — bem dentro da janela
de medição. Não use tempo para adiar coisas pesadas; use sinal de intenção do
usuário (ver `correcoes.md`).

## Cache de `/public`

Muitas hospedagens servem `/public` sem cache de navegador. Configure em
`next.config.ts` (ver `correcoes.md`), lembrando que cache imutável exige trocar
o **nome** do arquivo ao trocar o conteúdo.
