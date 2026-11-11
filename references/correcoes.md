# Catálogo de correções

Cada entrada traz o sintoma, a correção e — quando existe — a armadilha que só
aparece depois de aplicar.

---

## Conteúdo escondido por animação de JS

**Sintoma:** LCP com render delay acima de 70%; muitos `opacity:0` no HTML
servido; o elemento de LCP é minúsculo ou inesperado.

Bibliotecas de animação com `initial={{ opacity: 0 }}` (framer-motion, motion,
GSAP com estado inicial) renderizam `style="opacity:0"` no HTML do servidor. O
conteúdo chega pronto em ~240 ms e fica invisível até o JS hidratar e a animação
rodar.

**Correção:** mover a entrada para CSS, que começa no primeiro quadro pintado.

```css
@keyframes entrar {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: none; }
}
.entrada { animation: entrar 0.8s cubic-bezier(.16,1,.3,1) both; }
```

**A armadilha:** para o elemento **candidato a LCP**, isso não basta se a
animação incluir `opacity`. Uma animação CSS só avança quando o browser produz
quadros — e durante a hidratação a thread está travada, então o elemento fica em
`opacity: 0` por segundos mesmo com o HTML pronto.

Num caso real, converter tudo para fade levou o LCP de 14 s para 6,1 s. Passar
os dois candidatos a LCP para **transform-only** levou para 3,6 s.

```css
/* Para o candidato a LCP: desliza sem desvanecer, opaco desde o 1º quadro */
@keyframes deslizar {
  from { transform: translateY(20px); }
  to   { transform: none; }
}
.entrada-lcp { animation: deslizar 0.7s cubic-bezier(.16,1,.3,1) both; }
```

Sempre acompanhe de `@media (prefers-reduced-motion: reduce) { animation: none }`.

---

## Reveal ao rolar sem biblioteca

Se for substituir `whileInView` por CSS, **compartilhe o observer**. Uma
implementação com um `IntersectionObserver` por elemento (24 numa página) ficou
mais cara que a própria biblioteca.

```js
const observers = new Map()   // um por rootMargin

function observerDe(margem) {
  if (observers.has(margem)) return observers.get(margem)
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('is-visivel')   // classe direto no nó, sem setState
      io.unobserve(e.target)
    }
  }, { rootMargin: margem })
  observers.set(margem, io)
  return io
}
```

Evitar estado de framework importa: 24 `setState` simultâneos são 24 re-renders
no exato momento em que a seção entra na tela.

**Não use `will-change` na regra base.** Numa regra que casa dezenas de
elementos, ele cria uma camada de composição permanente para cada um. Custa mais
memória e composite do que economiza.

Cubra também quem está sem JS:

```css
@media (scripting: none) { .revelar { opacity: 1; transform: none; } }
```

**Antes de trocar biblioteca por código próprio, meça.** Numa sessão real a
remoção cortou 42 KB e −31% de JS não usado, mas o score não mudou, porque o
gargalo era terceiros. Ganho de bytes é real para o usuário em rede lenta e vale
dizer assim — sem prometer nota.

---

## Conteúdo fora da viewport pesando no carregamento

**Sintoma:** `styleLayout` e `paintCompositeRender` altos; primeira pintura
atrasada mesmo com a rede ociosa.

```css
.secao-abaixo-da-dobra {
  content-visibility: auto;
  contain-intrinsic-size: auto 900px;
}
```

**A armadilha:** o valor padrão colapsa a seção. Se o real é 2.809 px e o
placeholder é 1.060 px, a página cresce empurrando conteúdo enquanto o usuário
rola — e o Lighthouse **não pega isso no CLS**, mas o usuário sente.

Meça a altura real de cada seção e **subtraia padding e borda**, porque a
propriedade define a caixa de conteúdo:

```js
[...document.querySelectorAll('section')].map(e => {
  const cs = getComputedStyle(e), r = e.getBoundingClientRect()
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
            + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
  return `${e.className}: intrinsic=${Math.round(r.height - pad)}`
})
```

Meça em mobile e desktop e use media query. Depois confirme: a altura total da
página com `content-visibility` deve bater com a soma das alturas reais.

Deixe a primeira seção de fora — é ela que precisa pintar primeiro.

---

## Recurso pesado que precisa carregar cedo por UX

**Sintoma:** widget de terceiro (agendamento, chat) no relatório; stack de tags
duplicado.

O conflito é real: montar no clique deixa o usuário esperando; montar no
carregamento envenena a medição e duplica as tags.

**Não resolva por tempo.** `requestIdleCallback` após o `load` dispara em ~300 ms
numa conexão rápida, e mesmo com piso de 2 s cai dentro da janela — num caso real
isso custou de 1,3 s a 3,9 s de TBT.

**Resolva por intenção.** Sinais que acontecem antes do clique e que um robô
nunca gera:

```js
const aquecer = () => setCarregar(true)

const porIntencao = (e) => {
  if (e.target?.closest?.('[href="#agendar"], [data-cta]')) aquecer()
}
for (const tipo of ['pointerenter', 'touchstart', 'focusin']) {
  document.addEventListener(tipo, porIntencao, { capture: true, passive: true })
}

// rolagem também é engajamento, e dá segundos de vantagem
window.addEventListener('scroll', () => {
  if (window.scrollY > 400) aquecer()
}, { passive: true })
```

Monte o iframe uma vez e mantenha montado, para o estado sobreviver a
fechar e reabrir. E emita `<link rel="preconnect">` **só depois** do primeiro
sinal — fixo no `<head>` ele vira "pré-conexão não usada" no relatório.

**A correção de raiz** é pedir a quem mantém o widget que ele detecte
`window.self !== window.top` e não suba as tags dentro do iframe. Aí o
pré-carregamento sai de graça.

---

## Vídeo

Confira o codec antes de qualquer coisa:

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,bit_rate \
  -show_entries format=duration -of default=noprint_wrappers=1 video.mp4
```

**HEVC/H.265 é armadilha comum:** o Chrome só decodifica em plataformas
específicas e o Firefox não decodifica. Um arquivo de 8 MB em HEVC significa que
a maioria baixa tudo e não vê nada — é bug funcional, não só de performance.

Reencode para H.264, que toca em todo lugar:

```bash
ffmpeg -i entrada.mp4 -an -vf "scale=1280:-2" -c:v libx264 \
  -profile:v high -crf 26 -preset slow -pix_fmt yuv420p \
  -movflags +faststart saida.mp4
```

**Meça antes de escolher WebM.** VP9 comprime melhor "em teoria", mas depende do
conteúdo. Num caso real, com SSIM medido, o H.264 ganhou:

```bash
ffmpeg -v error -i candidato.mp4 -i original.mp4 \
  -lavfi "[1:v]scale=1280:-2[ref];[0:v][ref]ssim" -f null -
```

`H.264 1,44 MB @ SSIM 0,99622` contra `VP9 1,35 MB @ SSIM 0,99526` — sem ganho
real, e o WebM ainda perde o iOS anterior ao 17.4. Ficou só o MP4.

Para vídeo decorativo com autoplay, gere um poster **do tamanho exibido** (não do
tamanho do vídeo) e carregue por viewport:

```jsx
<video ref={ref} poster={POSTER} preload="none" autoPlay muted loop playsInline />
```

Atribua o `src` pelo ref no `IntersectionObserver`, não por estado — evita
re-render e não dispara a regra de lint contra `setState` dentro de effect.

---

## Imagens

**Compare o tamanho natural com o exibido**, não com o "parece grande". Um PNG de
1264×848 servido para um círculo de 44 px é 2 MB para exibir 44 px.

```js
// tamanho natural vs exibido, direto na página
[...document.querySelectorAll('img')].map(i =>
  `${i.currentSrc.split('/').pop()}: natural ${i.naturalWidth}x${i.naturalHeight} → exibido ${i.width}x${i.height}`)
```

Para `background-image` em CSS não há lazy loading — o navegador busca assim que
o elemento entra em layout. Dimensione na origem.

Regra prática: **maior dimensão exibida × 2** (para telas 2×). Converta para
WebP com qualidade 74–86. Num caso real, 10,8 MB de PNG viraram 44 KB de WebP.

---

## Preloads de imagem indesejados

**Sintoma:** dezenas de `<link rel="preload" as="image">` no `<head>` para
conteúdo abaixo da dobra.

O **React 19 injeta preload automaticamente** para todo `<img>` renderizado no
servidor **sem `loading="lazy"`**. Num caso real eram 20 preloads (~800 KB) em
prioridade máxima disputando banda com o CSS render-blocking.

```jsx
<img src={...} alt={...} loading="lazy" decoding="async" />
```

`next/image` já usa lazy por padrão — o problema está nos `<img>` crus.

---

## CSS render-blocking

Mesmo pequeno, um `<link>` de CSS cria a cadeia `documento → CSS`. Foi a causa de
um FCP bimodal (~1,5 s ou ~5,7 s).

No Next.js:

```ts
// next.config.ts
const nextConfig: NextConfig = {
  experimental: { inlineCss: true },
}
```

Troca o `<link>` por um `<style>` no `<head>`. Depois confirme que sobrou zero
`rel="stylesheet"` no HTML.

---

## Cache de assets estáticos

Muitas hospedagens servem `/public` com `Cache-Control: public, max-age=0,
must-revalidate` — ou seja, zero cache de navegador.

```ts
async headers() {
  return [{
    source: "/:dir(imagens|logos|videos)/:path*",
    headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
  }]
}
```

Com cache imutável, **trocar o conteúdo exige trocar o nome do arquivo**.
Sobrescrever mantendo o nome deixa o antigo preso no navegador dos visitantes.

---

## Fontes

Famílias declaradas no layout raiz entram no CSS de todas as rotas, mesmo com
`preload: false`. Mova cada uma para o layout da rota que a usa.

Cada família com preload é uma requisição de alta prioridade competindo com o
caminho crítico. Mantenha preload só nas que aparecem acima da dobra.

---

## Contraste de cor

O relatório dá o par exato e o mínimo exigido. Calcule o menor ajuste que passa,
em vez de escurecer no chute:

```js
const lum = c => { const s = c.map(v => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4 });
  return 0.2126*s[0] + 0.7152*s[1] + 0.0722*s[2] }
const hex = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16))
const razao = (a,b) => { const [l1,l2]=[lum(hex(a)),lum(hex(b))];
  return ((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2) }
```

Para texto esmaecido com alfa, procure o alfa mínimo que atinge 4.5 — costuma dar
um valor único que resolve vários nós de uma vez.

**Cor de marca é decisão do usuário.** Se o nó que falha usa a cor da identidade,
apresente as opções com o contraste de cada uma, recomende o **menor desvio que
passa** e deixe a escolha com ele. Aplique só no elemento afetado, sem tocar no
token global.
