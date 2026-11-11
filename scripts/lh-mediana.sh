#!/usr/bin/env bash
# Roda o Lighthouse N vezes e devolve a distribuição + mediana.
#
# Um run isolado não conclui nada: a variância entre execuções é grande. E
# distribuição bimodal (dois grupos separados, em vez de espalhamento contínuo)
# é sinal de causa específica, não de ruído — vale investigar o que separa os
# grupos.
#
#   ./lh-mediana.sh <URL> [N] [VERSAO]
#
# A VERSAO deve ser a mesma que o PageSpeed usa — está no rodapé do bloco de
# métricas do relatório, algo como "Moto G Power emulado with Lighthouse 13.4.1".
# Scores de versões maiores diferentes não são comparáveis: mesmo com emulação
# idêntica, o motor de simulação e as auditorias mudam entre versões.

set -u
URL="${1:?uso: ./lh-mediana.sh <URL> [N] [VERSAO]}"
N="${2:-3}"
VERSAO="${3:-}"
if [ -z "$VERSAO" ]; then
  VERSAO="13.4.1"
  echo "⚠ Versão não informada — assumindo $VERSAO. NÃO chute: leia a versão do"
  echo "  relatório do PageSpeed (r.lighthouseVersion) e passe como 3º argumento."
  echo
fi
SAIDA="${TMPDIR:-/tmp}/lh-mediana-$$"
mkdir -p "$SAIDA"

echo "Lighthouse $VERSAO · $N execuções · $URL"
echo

for i in $(seq 1 "$N"); do
  npx --yes "lighthouse@$VERSAO" "$URL" \
    --only-categories=performance \
    --form-factor=mobile \
    --output=json --output-path="$SAIDA/r$i.json" \
    --chrome-flags="--headless=new --no-sandbox" --quiet >/dev/null 2>&1
  node -e "
    const r=require('$SAIDA/r$i.json'), m=r.audits.metrics.details.items[0];
    const p=(v,n)=>String(v).padStart(n);
    console.log('  run $i:  score='+p(Math.round(r.categories.performance.score*100),3)
      +'  FCP='+p(m.firstContentfulPaint,5)
      +'  LCP='+p(m.largestContentfulPaint,6)
      +'  TBT='+p(m.totalBlockingTime,5)
      +'  CLS='+m.cumulativeLayoutShift.toFixed(3));
  "
done

echo
node -e "
const fs=require('fs');
const vals=[];
for (let i=1;i<=$N;i++) {
  try {
    const r=require('$SAIDA/r'+i+'.json'), m=r.audits.metrics.details.items[0];
    vals.push({s:Math.round(r.categories.performance.score*100), fcp:m.firstContentfulPaint,
               lcp:m.largestContentfulPaint, tbt:m.totalBlockingTime});
  } catch {}
}
const med=a=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)]};
const lin=(rot,arr)=>console.log('  '+rot.padEnd(8)+arr.slice().sort((a,b)=>a-b).join(', ').padEnd(38)+'mediana '+med(arr));
console.log('distribuição (ordenada):');
lin('score', vals.map(v=>v.s));
lin('FCP',   vals.map(v=>v.fcp));
lin('LCP',   vals.map(v=>v.lcp));
lin('TBT',   vals.map(v=>v.tbt));

// Detecta bimodalidade grosseira no FCP: um vão grande entre valores vizinhos.
const f=vals.map(v=>v.fcp).sort((a,b)=>a-b);
let maiorVao=0, corte=0;
for (let i=1;i<f.length;i++) { const d=f[i]-f[i-1]; if (d>maiorVao) { maiorVao=d; corte=i } }
if (f.length>2 && maiorVao > (f[f.length-1]-f[0])*0.5 && maiorVao > 1500) {
  console.log('\n  ⚠ FCP parece BIMODAL: grupos [' + f.slice(0,corte).join(', ') + '] e ['
    + f.slice(corte).join(', ') + ']');
  console.log('    Isso é causa específica, não ruído. Compare um run de cada grupo:');
  console.log('    render-blocking, observedFirstContentfulPaint, long tasks iniciais.');
}
console.log('\n  JSONs em: $SAIDA');
"
