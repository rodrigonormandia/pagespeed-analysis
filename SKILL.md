---
name: pagespeed-analysis
description: Analisa e melhora a nota do PageSpeed Insights / Lighthouse de um site. Use SEMPRE que o usuário mencionar PageSpeed, Lighthouse, Core Web Vitals, LCP, FCP, TBT, CLS, "nota do site", "site lento", "melhorar performance web", "otimizar carregamento", ou colar um print/relatório do PageSpeed — mesmo que não peça explicitamente uma "análise". Também vale para acessibilidade e SEO do mesmo relatório. Traz o método de medição confiável (o erro nº1 é medir no ambiente errado), o mapa de sintoma → causa → correção, e os scripts de apoio.
license: Proprietária — ver LICENSE.txt
metadata:
  author: Rodrigo Normandia
  owner: Rodrigo Normandia
  contact: rnrsouza@hotmail.com
  created: 2026-09-08
  version: 1.0.0
  ip-status: PI Preexistente
---

<!--
AUTORIA E TITULARIDADE
Autor: Rodrigo Normandia
Titular: Rodrigo Normandia
Criado em: 2026-09-08 | Versão: 1.0.0 | Última revisão: 2026-09-08
© 2026 Rodrigo Normandia. Todos os direitos reservados.
Propriedade Intelectual Preexistente do titular. O uso por terceiros depende de
licença escrita, não exclusiva, intransferível, limitada ao uso interno.
Nenhum direito é cedido pela entrega ou uso deste material.
-->

# Análise e otimização de PageSpeed

Melhorar a nota do PageSpeed é fácil de fazer errado. O modo de errar mais comum
não é escolher a otimização errada — é **medir no lugar errado e acreditar no
número**. Esta skill existe para você não repetir isso.

## A regra que sustenta todo o resto

**A máquina local não é o PageSpeed.** O PSI roda num aparelho de baixo custo
emulado, com 4G lento, numa máquina compartilhada e sob carga variável. Um
notebook de desenvolvimento é várias vezes mais rápido. A consequência prática:

> Toda vez que você reportar um número, diga onde ele foi medido e quantas
> execuções fez. Nunca prometa ganho de score a partir de medição local.

Numa sessão real, esse erro apareceu três vezes: o local dizia 80–84 enquanto o
PSI dizia 44–64. E foi pior que impreciso — levou a **enviar uma otimização que
piorou o site**, porque localmente ela parecia barata e no aparelho emulado
custava 3,9 s de TBT.

## O ciclo

```
1. Baseline no PSI pelo Chrome   ← 3 execuções, e anote o AMBIENTE
2. Alinhar o ambiente local      ← mesma versão E mesmo aparelho do passo 1
3. Decompor o score              ← qual métrica custa quantos pontos
4. Atacar a métrica dominante
5. Double-check no PSI pelo Chrome ← 3 execuções, depois do deploy
```

Os passos 1 e 5 não são opcionais e não podem ser substituídos por Lighthouse
local. Sem eles você está otimizando às cegas.

### 1 e 5 — PSI pelo Chrome, três execuções

Leia `references/double-check-chrome.md`. Ele traz o procedimento completo,
incluindo como contornar o estrangulamento de aba em segundo plano (que faz o
relatório parecer travado) e o que extrair de cada execução.

Dois pontos que costumam ser pulados:

- **Três execuções, sempre.** A variância é enorme: no mesmo build já se viu
  **44, depois 90, depois 52**. Um único número não conclui nada — reporte a
  mediana com a distribuição à vista.
- **Anote o ambiente na primeira execução.** Versão do Lighthouse, aparelho
  emulado, tela, CPU throttling e `benchmarkIndex`. É isso que alimenta o passo 2.

A API do PageSpeed exige chave e a cota gratuita costuma estar esgotada. Use a
interface web pelo Chrome.

### 2 — alinhar o ambiente local (descobrir, não assumir)

**Nunca chute a versão nem o aparelho.** Leia do próprio relatório:

```js
r.lighthouseVersion                        // ex.: "13.4.1"
r.configSettings.emulatedUserAgent         // contém o modelo, ex.: "moto g power (2022)"
r.configSettings.screenEmulation           // ex.: 412x823 @1.75x
r.configSettings.throttling                // cpuSlowdownMultiplier, rttMs, throughputKbps
r.environment.benchmarkIndex               // velocidade da máquina que rodou
```

`scripts/ambiente.js` extrai tudo isso e, recebendo dois relatórios, diz se são
comparáveis:

```bash
node ambiente.js psi.json              # mostra o ambiente + o comando para replicar
node ambiente.js psi.json local.json   # compara e avisa se não der para comparar
```

Depois instale exatamente aquela versão:

```bash
npx lighthouse@<versao-do-relatorio> <URL> \
  --only-categories=performance --form-factor=mobile \
  --output=json --output-path=./lh.json \
  --chrome-flags="--headless=new --no-sandbox" --quiet
```

Não passe `--screenEmulation`: os padrões da versão já são o aparelho certo, e
passar valores manualmente é como as medições saem desalinhadas sem ninguém
notar. E não compare score entre versões maiores: mesmo quando a emulação é
idêntica (LH 12 e 13 usam o mesmo Moto G Power, mesma tela, mesmo CPU 4×), o
motor de simulação e as auditorias mudam — no mesmo build, na mesma máquina, a
troca de 12 para 13 moveu a mediana em ~20 pontos.

**Mesmo alinhado, o local continua otimista.** Compare o `benchmarkIndex` das
duas máquinas: se o seu for muito maior, o score local será melhor na mesma
proporção. Use o local para **comparar variantes entre si** ("A é melhor que
B?"), nunca para prever a nota.

### 3 — decompor o score antes de agir

A nota é uma soma ponderada — no LH 13: TBT 30%, LCP 25%, CLS 25%, FCP 10%,
Speed Index 10%. Não confie na tabela de cabeça: os pesos vivem no próprio
relatório (`categories.performance.auditRefs[].weight`) e podem mudar entre
versões. `scripts/decompor-score.js` lê de lá e mostra quantos pontos cada
métrica está custando.

Otimizar imagens quando 30 pontos estão presos no TBT é esforço perdido. Ataque
sempre a métrica que mais custa.

Se o site tem tráfego, confira também os **dados de campo (CrUX)** no topo do
relatório — quando existem, eles são o alvo real (é o que o Google usa como
sinal), e o laboratório vira ferramenta de diagnóstico. Detalhes em
`double-check-chrome.md`.

### 4 — corrigir

`references/diagnostico.md` mapeia **sintoma → causa → correção**, na ordem em
que vale a pena investigar. `references/correcoes.md` detalha cada correção com o
código. Para projetos Next.js/React, `references/nextjs.md` traz as armadilhas
específicas do framework.

**Valide além do número.** Otimização de performance quebra coisas de formas que
o Lighthouse não mede — verifique antes de publicar:

- **paridade visual**: screenshot da página inteira antes e depois (mudou
  animação ou CSS? compare os dois)
- **âncoras e rolagem** depois de `content-visibility` (`#secao` ainda leva ao
  lugar certo? a altura da página bate com a real?)
- **componentes compartilhados**: a correção alcança todas as rotas que os usam
  — teste todas, não só a que você estava olhando
- **comportamento adiado**: o que passou a carregar por intenção ainda funciona?
  simule o hover/toque/rolagem e confirme
- **auditorias latentes**: elemento que só monta após interação não é auditado;
  mudar *quando* ele monta pode revelar falhas que sempre existiram (um iframe
  sem `title`, por exemplo)

## Observado vs simulado: a distinção que evita conclusões erradas

O Lighthouse reporta dois conjuntos de números e **só um deles vira nota**:

- `firstContentfulPaint`, `largestContentfulPaint` — **simulados**, projetados
  para 4G lento e CPU 4×. São o que compõe o score.
- `observedFirstContentfulPaint`, `observedLargestContentfulPaint` — **reais**,
  do trace, sem simulação.

Um LCP simulado de 11,6 s com observado de 2,5 s significa que a página está
rápida e o modelo está amplificando. Isso muda o diagnóstico completamente: você
não tem um problema de rede, tem trabalho de CPU que o modelo multiplica.

Quando `observedFCP == observedLCP`, tudo pinta ao mesmo tempo — sinal de que não
há recurso atrasando o maior elemento, e o gargalo é o que acontece *antes* da
primeira pintura.

## Armadilhas que já custaram caro

Cada uma delas aconteceu de verdade. Vale ler antes de propor qualquer coisa.

**Conteúdo escondido por animação de JS.** Bibliotecas como framer-motion/motion
com `initial={{ opacity: 0 }}` renderizam `style="opacity:0"` no HTML do
servidor. O conteúdo chega pronto em 240 ms e fica invisível até o JS hidratar —
89% do LCP vira "render delay". Detalhe não óbvio: trocar por animação CSS **não
basta se a animação for de `opacity`**, porque ela só avança quando o browser
produz frames, e durante a hidratação a thread está travada. Para o elemento
candidato a LCP, anime **só `transform`**, deixando-o opaco desde o primeiro
frame.

**Iframes de terceiros duplicam o stack de tags.** Um widget embutido
(agendamento, chat, formulário) é um documento à parte. Se ele carrega o mesmo
GTM/Pixel/Analytics do site, você paga tudo duas vezes — e ainda contabiliza
PageView e conversões duplicados. Use `scripts/cdp-frames.mjs` para atribuir cada
requisição ao seu frame; sem isso o Lighthouse só mostra o script listado duas
vezes e é fácil ler como "a mesma lib carregando duas vezes".

**"Pré-aquecimento ocioso" cai dentro da janela de medição.**
`requestIdleCallback` após o `load` dispara em ~300 ms numa conexão rápida.
Qualquer coisa carregada nos primeiros ~5 s entra na conta. Se precisa
pré-carregar algo pesado para preservar UX, dispare por **sinal de intenção**
(hover, foco, toque num CTA, rolagem além de um limiar) e não por tempo — um robô
de auditoria nunca gera esses sinais, e o usuário real gera antes do clique.

**`will-change` aplicado em massa.** Numa regra base que casa dezenas de
elementos, ele cria uma camada de composição permanente para cada um. Custa mais
memória e composite do que a dica economiza. Aplique só durante a animação, ou
não aplique.

**Trocar biblioteca por código próprio pode piorar.** Uma reimplementação
ingênua de reveal criou *um IntersectionObserver por elemento* (24 na página) e
ficou mais cara que a biblioteca, que usa observer compartilhado. Se for
substituir, compartilhe o observer e evite estado de React — mude a classe direto
no nó.

**A nota pode não ser o critério certo.** Remover 42 KB de JS melhorou bytes e
não mexeu no score, porque o gargalo era TBT de terceiros. Diga isso com
franqueza em vez de vender o ganho: "reduziu o download, não muda a nota" é uma
resposta legítima, e deixa a decisão com quem paga a conta.

## Terceiros: quase sempre o teto

Depois que o código próprio está otimizado, o TBT costuma ser dominado por GTM,
Meta Pixel, Clarity e similares — na sessão real, ~1.250 ms de 1.290 ms.

Isso **não é decisão técnica**. Adiar as tags melhora a nota e custa eventos de
quem sai da página nos primeiros segundos. Apresente as opções com o custo de
cada uma e deixe a escolha com o usuário:

1. adiar só as ferramentas de análise de sessão (risco baixo, ganho pequeno)
2. adiar também o pixel de anúncios, mantendo o gerenciador de tags (meio-termo)
3. adiar tudo com `lazyOnload` (ganho máximo, perde bounces rápidos)

O mesmo vale para **cabeçalhos de cache de terceiros**: os TTLs de 20 min do
Facebook e 1 dia do Clarity aparecem no relatório, mas são servidos pelos CDNs
deles. Não há o que fazer — diga isso em vez de gastar tempo.

## Como reportar

O usuário quase sempre quer saber "melhorou?". Responda com honestidade
verificável:

- diga **onde** mediu (PSI ou local) e **quantas execuções**
- dê a **mediana** com a distribuição à vista, não o melhor número
- separe o que é **determinístico** (bytes, requisições, contagem de preloads) do
  que é **ruidoso** (score, TBT) — o primeiro prova a mudança, o segundo não
- quando errar uma previsão, corrija de forma direta e siga

Se você introduziu uma regressão, diga qual mudança sua foi e conserte antes de
propor qualquer coisa nova.

## Arquivos desta skill

| Arquivo | Quando ler |
|---|---|
| `references/double-check-chrome.md` | **Passos 1 e 5** — procedimento do PSI pelo Chrome |
| `references/medicao.md` | Entender variância, bimodalidade e o que é determinístico |
| `references/diagnostico.md` | Depois de ter o relatório — mapa sintoma → causa |
| `references/correcoes.md` | Na hora de corrigir — código de cada correção |
| `references/nextjs.md` | Projetos Next.js/React |
| `scripts/ambiente.js` | **Passo 2** — lê versão/aparelho e compara dois relatórios |
| `scripts/decompor-score.js` | **Passo 3** — quantos pontos cada métrica custa |
| `scripts/lh-mediana.sh` | Lighthouse local N vezes, com detecção de bimodalidade |
| `scripts/cdp-frames.mjs` | Atribui requisições a frames (acha stack duplicado) |
