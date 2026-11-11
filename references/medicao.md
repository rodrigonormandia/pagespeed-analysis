# Medição confiável

Este é o arquivo mais importante da skill. Quase todo diagnóstico errado começa
numa medição mal feita.

## Por que o local engana

| | PSI | Máquina de desenvolvimento |
|---|---|---|
| Aparelho | Moto G Power emulado | CPU do dev, várias vezes mais rápida |
| Rede | 4G lento simulado | fibra, latência baixa |
| Carga | máquina compartilhada, variável | ociosa |
| Localização | data center do Google | perto do usuário |

Numa sessão real, com o **mesmo build e a mesma versão de Lighthouse**, o local
deu mediana 80 e o PSI deu mediana 52. A diferença não é ruído, é ambiente.

Use o local para **comparar variantes** ("A é melhor que B?") e o PSI para
**afirmar a nota**.

## Rodando o PSI

O procedimento completo — três execuções, extração do relatório bruto pelas
variáveis globais da página e o contorno da aba em segundo plano — está em
`double-check-chrome.md`. Este arquivo cuida do que fazer com os números depois.

## Rodando o Lighthouse local

Descubra a versão que o PSI usou — está no rodapé do bloco de métricas, algo como
"Moto G Power emulado with Lighthouse 13.4.1" — e instale exatamente ela:

```bash
npx lighthouse@13.4.1 <URL> \
  --only-categories=performance \
  --form-factor=mobile \
  --output=json --output-path=./lh.json \
  --chrome-flags="--headless=new --no-sandbox" --quiet
```

Não passe `--screenEmulation.*`: os padrões da versão são justamente o que
espelha o PSI. E nunca compare score entre versões maiores: mesmo com emulação
idêntica, o motor de simulação e as auditorias mudam — a troca de LH 12 para 13
moveu ~20 pontos no mesmo build, na mesma máquina.

Para acessibilidade e SEO no mesmo comando:

```bash
--only-categories=performance,accessibility,best-practices,seo
```

`scripts/lh-mediana.sh` roda N vezes e devolve a mediana já calculada.

## Interpretando a variância

Antes de concluir que algo melhorou ou piorou, olhe a **distribuição**, não o
número isolado.

**Distribuição bimodal** — dois grupos separados em vez de espalhamento contínuo
— é sinal de causa específica, não de ruído. Exemplo real:

```
FCP: 1016, 1753, 1816, 5629, 5753, 5793
     └── grupo bom ──┘  └─── grupo ruim ───┘
```

O grupo de ~5,7 s era um CSS render-blocking. Depois de embutir o CSS:

```
FCP: 1120, 1744, 1746, 1746, 1757, 1771   ← unimodal
```

**Espalhamento contínuo** (50, 54, 64, 79, 81, 88) costuma ser carga de máquina e
condição de rede. Nesse caso só a mediana de várias execuções diz algo.

## Diagnosticando a origem da variância

Compare um run bom com um ruim lado a lado. Se `mainthread-work-breakdown` e o
tempo de documento forem parecidos e só o `observedFirstContentfulPaint` mudar, a
variância está no ambiente de medição, não no site.

Para conferir se o servidor é responsável, meça conexões novas:

```bash
for i in $(seq 1 10); do
  curl -s -o /dev/null --no-keepalive \
    -w "dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer}\n" \
    <URL>
done
```

TTFB variando de 70 ms a 230 ms com `x-vercel-cache: HIT` (ou equivalente) em
todas significa que o servidor está bem e a variação é da rede local.

## O que é determinístico e o que não é

Ao reportar, separe os dois — isso protege você e o usuário de conclusões
precipitadas.

**Determinístico** (uma medição basta, e prova a mudança):
peso total · número de requisições · contagem de preloads · bytes por chunk ·
JS não usado · presença ou ausência de um recurso · CLS quando é zero

**Ruidoso** (exige mediana de 3+ execuções):
score · TBT · FCP · LCP · Speed Index
