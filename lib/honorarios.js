'use strict';
// =====================================================================
// HONORÁRIOS (frente 4 — o financeiro que ADVBOX, EasyJur e Astrea têm)
// ---------------------------------------------------------------------
// Contrato, parcelas, pagamentos e atraso, guardados no próprio processo (campo
// "honorarios"): o banco processual já é do escritório e já tem isolamento, então não
// nasce tabela nova. Nunca se mistura com a cobrança da licença do LEX (AGENTS.md §12).
//
// Todo número sai do código, em centavos, com MEMORIAL DE CÁLCULO (fonte, critério,
// conta e conferência). A IA conversa com o titular e registra o que ele disser pelas
// ferramentas; a cobrança ao cliente é uma mensagem que a IA escreve e que só sai com o
// "pode" dele (lib/andamento-conversa.js) — aqui não existe envio.
// Juros e multa só entram quando o contrato os define; sem isso, o LEX não inventa.
// =====================================================================
const {diaCivil}=require('./office-insights');

const TIPOS=new Set(['fixo','exito','misto','mensal']);
const MAX_PARCELAS=120;
const MAX_CENTAVOS=100000000000; // R$ 1 bilhão: acima disso é erro de digitação, não honorário
const REPETIDO_MS=15*60*1000;    // mesmo pagamento de novo em menos de 15 minutos: confirmar

function erro(msg,status=400){return Object.assign(new Error(msg),{status})}
// Só formatos sem ambiguidade: "6.000" e "6.000,50" (brasileiro), "6000,5", "1.50" ou "1.5"
// (ponto com até 2 casas, como a IA às vezes manda). "6,000", "1,000.50", "1e3" e "0x10" são
// recusados: o LEX pergunta em vez de adivinhar. Nada negativo, nada acima de R$ 1 bilhão.
function centavos(v){
  let c=null;
  if(typeof v==='number'){if(Number.isFinite(v))c=Math.round(v*100)}
  else{
    const s=String(v??'').replace(/r\$|\s/gi,'');
    let m;
    if((m=s.match(/^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/)))c=Number(m[1].replace(/\./g,''))*100+Number((m[2]||'').padEnd(2,'0'));
    else if((m=s.match(/^(\d+)(?:,(\d{1,2}))?$/)))c=Number(m[1])*100+Number((m[2]||'').padEnd(2,'0'));
    else if((m=s.match(/^(\d+)\.(\d{1,2})$/)))c=Number(m[1])*100+Number(m[2].padEnd(2,'0'));
  }
  return c!=null&&Number.isSafeInteger(c)&&c>=0&&c<=MAX_CENTAVOS?c:null;
}
// "R$ 1.234,56" com espaço comum (o formatador do Intl usa espaço especial, que confunde cópia e busca).
function brl(c){
  const v=Math.round(Number(c||0)),a=Math.abs(v);
  return(v<0?'-':'')+'R$ '+String(Math.floor(a/100)).replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+String(a%100).padStart(2,'0');
}
function brData(ymd){const m=String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[3]+'/'+m[2]+'/'+m[1]:String(ymd||'')}
// Aceita também dia e mês com um dígito ("1/11/2026"), como as pessoas escrevem.
function data(v,campo){
  const s=String(v??'').trim(),m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const d=diaCivil(m?m[1].padStart(2,'0')+'/'+m[2].padStart(2,'0')+'/'+m[3]:s);
  if(!d)throw erro('Data inválida em '+campo+'. Use dd/mm/aaaa.');
  return d;
}
function diasNoMes(a,m){return new Date(Date.UTC(a,m,0)).getUTCDate()}
// Soma meses mantendo o dia; dia que não existe no mês vira o último dia (31/01 + 1 mês = 28 ou 29/02).
function somaMeses(ymd,n){
  const [a,m,d]=ymd.split('-').map(Number);
  const tot=(a*12+(m-1))+n,na=Math.floor(tot/12),nm=tot%12+1;
  const dia=Math.min(d,diasNoMes(na,nm));
  return String(na).padStart(4,'0')+'-'+String(nm).padStart(2,'0')+'-'+String(dia).padStart(2,'0');
}
function diasEntre(de,ate){return Math.round((Date.parse(ate+'T12:00:00Z')-Date.parse(de+'T12:00:00Z'))/86400000)}

// Divide em parcelas iguais; o resto em centavos vai na última (e o memorial diz isso).
function gerarParcelas(total,n,primeiro){
  const base=Math.floor(total/n),resto=total-base*n;
  const parcelas=[];
  for(let i=0;i<n;i++)parcelas.push({n:i+1,valor:base+(i===n-1?resto:0),vencimento:somaMeses(primeiro,i),status:'aberta',pago:0,pagamentos:[]});
  return{parcelas,base,resto};
}

function registrarContrato(processo,input={},{por='admin',agora=new Date().toISOString()}={}){
  const tipo=String(input.tipo||'').toLowerCase();
  if(!TIPOS.has(tipo))throw erro('Tipo de honorário inválido: use fixo, êxito, misto ou mensal.');
  const atual=processo?.honorarios;
  const temPagamento=!!(atual&&((atual.parcelas||[]).some(p=>p.pago>0)||(atual.avulsos||[]).length));
  if(atual?.contrato&&!input.substituir)throw erro('Este processo já tem contrato de honorários registrado. Para trocar, confirme que é para substituir.',409);
  if(atual?.contrato&&temPagamento)throw erro('Já há pagamento registrado neste contrato; não substituo para não perder o histórico. Registre a mudança como observação ou fale com o titular.',409);
  const memorial=[],contrato={tipo,registrado_em:agora,registrado_por:String(por),observacao:input.observacao?String(input.observacao).slice(0,500):null};
  let parcelas=[];
  if(tipo==='fixo'||tipo==='misto'){
    const total=centavos(input.valor_total);
    if(!total||total<=0)throw erro('Informe o valor total dos honorários fixos.');
    const n=input.parcelas==null||input.parcelas===''?1:Number(input.parcelas);
    if(!Number.isInteger(n)||n<1||n>MAX_PARCELAS)throw erro('Número de parcelas inválido (1 a '+MAX_PARCELAS+').');
    const primeiro=data(input.primeiro_vencimento,'primeiro vencimento');
    const g=gerarParcelas(total,n,primeiro);
    parcelas=g.parcelas;Object.assign(contrato,{valor_total:total,parcelas:n,primeiro_vencimento:primeiro});
    memorial.push('Fonte: valores informados pelo titular em '+brData(diaCivil(agora))+'.');
    memorial.push('Critério: '+brl(total)+' em '+n+' parcela'+(n===1?'':'s')+' mensais, a partir de '+brData(primeiro)+'.');
    memorial.push('Conta: '+brl(total)+' ÷ '+n+' = '+brl(g.base)+(g.resto?' com resto de '+brl(g.resto)+' somado à última parcela':'')+'.');
    memorial.push('Conferência: soma das parcelas = '+brl(parcelas.reduce((s,p)=>s+p.valor,0))+' (igual ao total).');
  }
  if(tipo==='mensal'){
    const mensal=centavos(input.valor_mensal);
    if(!mensal||mensal<=0)throw erro('Informe o valor mensal.');
    const n=input.meses==null||input.meses===''?12:Number(input.meses);
    if(!Number.isInteger(n)||n<1||n>MAX_PARCELAS)throw erro('Número de meses inválido (1 a '+MAX_PARCELAS+').');
    const primeiro=data(input.primeiro_vencimento,'primeiro vencimento');
    if(mensal*n>MAX_CENTAVOS)throw erro('Valor total do contrato mensal acima do limite (R$ 1 bilhão). Confira o valor e o número de meses.');
    for(let i=0;i<n;i++)parcelas.push({n:i+1,valor:mensal,vencimento:somaMeses(primeiro,i),status:'aberta',pago:0,pagamentos:[]});
    Object.assign(contrato,{valor_mensal:mensal,meses:n,valor_total:mensal*n,primeiro_vencimento:primeiro});
    memorial.push('Fonte: valores informados pelo titular em '+brData(diaCivil(agora))+'.');
    memorial.push('Critério: '+brl(mensal)+' por mês, '+n+' meses, a partir de '+brData(primeiro)+'.');
    memorial.push('Conta: '+brl(mensal)+' × '+n+' = '+brl(mensal*n)+'.');
  }
  if(tipo==='exito'||tipo==='misto'){
    const pct=Number(String(input.percentual_exito??'').replace(',','.').replace('%',''));
    if(!Number.isFinite(pct)||pct<=0||pct>100)throw erro('Informe o percentual de êxito (por exemplo, 30).');
    contrato.percentual_exito=Math.round(pct*100)/100;
    memorial.push('Êxito: '+String(contrato.percentual_exito).replace('.',',')+'% sobre o que o cliente receber; o valor só existe quando houver o recebimento — registre como pagamento avulso.');
  }
  if(input.juros_mes!=null||input.multa!=null){
    const j=Number(String(input.juros_mes??0).replace(',','.')),mu=Number(String(input.multa??0).replace(',','.'));
    if(!Number.isFinite(j)||j<0||j>10||!Number.isFinite(mu)||mu<0||mu>20)throw erro('Juros (até 10% ao mês) e multa (até 20%) inválidos.');
    contrato.juros_mes=j;contrato.multa=mu;
    memorial.push('Atraso: multa de '+String(mu).replace('.',',')+'% e juros de '+String(j).replace('.',',')+'% ao mês, simples, pro rata dia, conforme o contrato.');
  }
  const honorarios={contrato,parcelas,avulsos:[],historico:[...(atual?.historico||[]),{em:agora,por:String(por),evento:atual?.contrato?'contrato substituído':'contrato registrado'}].slice(-50)};
  return{honorarios,memorial};
}

// turno: a resposta do LEX em que a IA pediu o registro.
// Repetição: a mesma quantia, na mesma data, para a mesma parcela (ou sem parcela de um dos lados)
// — no mesmo turno nunca entra duas vezes (é a IA chamando de novo); em outra mensagem, em menos
// de 15 minutos, só entra se o titular confirmar que é outro pagamento (repetido: true).
function registrarPagamento(processo,input={},{por='admin',agora=new Date().toISOString(),turno=null}={}){
  const h=processo?.honorarios;
  if(!h)throw erro('Este processo ainda não tem honorários registrados. Registre o contrato primeiro.');
  const informado=input.valor!=null&&String(input.valor).trim()!=='';
  const valor=informado?centavos(input.valor):null;
  if(informado&&(valor==null||valor<=0))throw erro('Valor do pagamento inválido. Use o formato brasileiro, por exemplo 1.500,00.');
  const dataPg=input.data?data(input.data,'data do pagamento'):diaCivil(agora);
  const forma=input.forma?String(input.forma).slice(0,40):null;
  const memorial=[];const novo=structuredClone(h);
  novo.avulsos=Array.isArray(novo.avulsos)?novo.avulsos:[];
  novo.parcelas=Array.isArray(novo.parcelas)?novo.parcelas:[];
  for(const p of novo.parcelas)p.pagamentos=Array.isArray(p.pagamentos)?p.pagamentos:[];
  const restante=p=>p.valor-(p.pago||0);
  const comParcela=input.parcela!=null&&String(input.parcela).trim()!=='';
  const alvo=comParcela?novo.parcelas.find(x=>x.n===Number(input.parcela)):null;
  if(comParcela&&!alvo)throw erro('Parcela '+input.parcela+' não existe neste contrato.');
  if(alvo&&alvo.status==='paga')throw erro('A parcela '+alvo.n+' já está paga.',409);
  const total=alvo?(valor??restante(alvo)):valor;
  if(!total||total<=0)throw erro(alvo?'Valor do pagamento inválido.':'Informe o valor recebido.');
  const parcelaN=alvo?alvo.n:null;
  const semelhante=x=>x&&x.valor_pg===total&&x.data_pg===dataPg&&(x.parcela_pg==null||parcelaN==null||x.parcela_pg===parcelaN);
  const anteriores=(novo.historico||[]).filter(semelhante);
  if(turno&&anteriores.some(x=>x.turno===String(turno)))
    throw erro('Eu já registrei esse pagamento agora há pouco (mesma quantia e data). Não registrei de novo.',409);
  const recentes=anteriores.map(x=>Date.parse(x.em)).filter(t=>Number.isFinite(t)&&Date.parse(agora)-t>=0&&Date.parse(agora)-t<REPETIDO_MS);
  if(recentes.length&&input.repetido!==true){
    const min=Math.max(1,Math.round((Date.parse(agora)-Math.max(...recentes))/60000));
    throw erro('Já registrei um pagamento igual (mesma quantia e data) há '+min+' minuto'+(min===1?'':'s')+'. Se for outro pagamento, confirme com o titular e registre de novo marcando que é repetido.',409);
  }
  if(alvo){
    const p=alvo;
    const usa=Math.min(total,restante(p));
    p.pago=(p.pago||0)+usa;p.pagamentos.push({valor:usa,data:dataPg,forma,por:String(por)});
    p.status=restante(p)===0?'paga':'parcial';if(p.status==='paga')p.pago_em=dataPg;
    memorial.push('Parcela '+p.n+' ('+brl(p.valor)+', vencimento '+brData(p.vencimento)+'): recebido '+brl(usa)+' em '+brData(dataPg)+' → '+(p.status==='paga'?'quitada':'falta '+brl(restante(p)))+'.');
    if(total>usa){novo.avulsos.push({valor:total-usa,data:dataPg,forma,descricao:'excedente do pagamento da parcela '+p.n,por:String(por)});memorial.push('Excedente de '+brl(total-usa)+' registrado como recebimento avulso.')}
  }else{
    let sobra=total;
    for(const p of novo.parcelas.filter(x=>x.status!=='paga').sort((a,b)=>String(a.vencimento).localeCompare(String(b.vencimento)))){
      if(sobra<=0)break;
      const usa=Math.min(sobra,restante(p));
      p.pago=(p.pago||0)+usa;p.pagamentos.push({valor:usa,data:dataPg,forma,por:String(por)});
      p.status=restante(p)===0?'paga':'parcial';if(p.status==='paga')p.pago_em=dataPg;
      memorial.push('Parcela '+p.n+' (vencimento '+brData(p.vencimento)+'): '+brl(usa)+' → '+(p.status==='paga'?'quitada':'falta '+brl(restante(p)))+'.');
      sobra-=usa;
    }
    if(sobra>0){novo.avulsos.push({valor:sobra,data:dataPg,forma,descricao:input.descricao?String(input.descricao).slice(0,200):(novo.parcelas.length?'valor acima das parcelas em aberto':'recebimento avulso (êxito ou outro)'),por:String(por)});memorial.push('Recebimento avulso: '+brl(sobra)+'.')}
    memorial.unshift('Critério: '+brl(total)+' recebidos em '+brData(dataPg)+' aplicados às parcelas em aberto, da mais antiga para a mais nova.');
  }
  novo.historico=[...(novo.historico||[]),{em:agora,por:String(por),evento:'pagamento de '+brl(total)+' em '+brData(dataPg),
    valor_pg:total,data_pg:dataPg,parcela_pg:parcelaN,turno:turno?String(turno):null,repetido:input.repetido===true}].slice(-50);
  return{honorarios:novo,memorial};
}

// Situação de um contrato em uma data (atraso conforme o contrato, se houver juros/multa).
function situacao(h,hoje){
  const parcelas=(h?.parcelas||[]).map(p=>{
    const aberto=p.valor-(p.pago||0);
    const dias=p.status==='paga'?0:diasEntre(p.vencimento,hoje);
    let encargos=0;
    if(aberto>0&&dias>0&&h.contrato&&(h.contrato.multa||h.contrato.juros_mes)){
      encargos=Math.round(aberto*(Number(h.contrato.multa||0)/100))+Math.round(aberto*(Number(h.contrato.juros_mes||0)/100)*dias/30);
    }
    return{...p,aberto,dias_atraso:dias>0&&aberto>0?dias:0,encargos};
  });
  const soma=f=>parcelas.reduce((s,p)=>s+f(p),0);
  const avulsos=(h?.avulsos||[]).reduce((s,a)=>s+a.valor,0);
  return{parcelas,contratado:soma(p=>p.valor),recebido:soma(p=>p.pago||0)+avulsos,a_receber:soma(p=>p.aberto),
    vencido:soma(p=>p.dias_atraso>0?p.aberto:0),encargos:soma(p=>p.encargos),avulsos};
}

function resumoCarteira(processos,hoje,{mes}={}){
  const ym=mes||hoje.slice(0,7);
  // por_responsavel sem protótipo: nome de responsável como "__proto__" é só um nome.
  const out={mes:ym,recebido_mes:0,a_receber:0,vencido:0,vencidas:[],proximas:[],por_responsavel:Object.create(null),contratos:0,pagamentos_mes:0};
  for(const p of Array.isArray(processos)?processos:[]){
    const h=p?.honorarios;if(!h?.contrato)continue;
    out.contratos++;
    const s=situacao(h,hoje),resp=String(p.responsavel||'').trim()||'sem responsável';
    const r=out.por_responsavel[resp]||(out.por_responsavel[resp]={recebido_mes:0,a_receber:0,vencido:0});
    const recebidosNoMes=[...s.parcelas.flatMap(x=>x.pagamentos||[]),...(h.avulsos||[])].filter(x=>String(x.data||'').slice(0,7)===ym);
    const noMes=recebidosNoMes.reduce((t,x)=>t+x.valor,0);
    out.recebido_mes+=noMes;out.pagamentos_mes+=recebidosNoMes.length;r.recebido_mes+=noMes;
    out.a_receber+=s.a_receber;r.a_receber+=s.a_receber;out.vencido+=s.vencido;r.vencido+=s.vencido;
    for(const x of s.parcelas){
      const base={processo_id:String(p.id),processo:String(p.nome||p.numero||p.id).slice(0,120),cliente:p.cliente||null,parcela:x.n,de:s.parcelas.length,valor:x.aberto,vencimento:x.vencimento,encargos:x.encargos};
      if(x.dias_atraso>0)out.vencidas.push({...base,dias:x.dias_atraso});
      else if(x.aberto>0){const d=diasEntre(hoje,x.vencimento);if(d>=0&&d<=7)out.proximas.push({...base,em_dias:d})}
    }
  }
  out.vencidas.sort((a,b)=>b.dias-a.dias);out.proximas.sort((a,b)=>a.em_dias-b.em_dias);
  out.memorial=[
    'Fonte: contratos e pagamentos registrados no LEX ('+out.contratos+' contrato'+(out.contratos===1?'':'s')+').',
    'Recebido no mês '+ym.slice(5)+'/'+ym.slice(0,4)+': soma de '+out.pagamentos_mes+' pagamento'+(out.pagamentos_mes===1?'':'s')+' com data no mês = '+brl(out.recebido_mes)+'.',
    'A receber: soma do que falta pagar de cada parcela em aberto = '+brl(out.a_receber)+'.',
    'Vencido: parte do "a receber" com vencimento antes de '+brData(hoje)+' = '+brl(out.vencido)+' ('+out.vencidas.length+' parcela'+(out.vencidas.length===1?'':'s')+'). Juros e multa não entram nesta soma; onde o contrato prevê, aparecem à parte, como encargos de cada parcela.'
  ];
  return out;
}

// porResponsavel:false — a secretária vê o financeiro do escritório, não a receita de cada advogado.
function textoResumo(r,{porResponsavel=true}={}){
  if(!r.contratos)return'Nenhum contrato de honorários registrado ainda. É só me dizer, por exemplo: "o João vai pagar R$ 6.000 em 3 vezes a partir de 10/11".';
  const L=['💰 Honorários — '+r.mes.slice(5)+'/'+r.mes.slice(0,4),
    'Recebido no mês: '+brl(r.recebido_mes)+' · A receber: '+brl(r.a_receber)+' · Vencido: '+brl(r.vencido)+(r.vencidas.length?' ('+r.vencidas.length+' parcela'+(r.vencidas.length===1?'':'s')+')':'')+'.'];
  if(r.vencidas.length){
    L.push('Em atraso:');
    for(const v of r.vencidas.slice(0,6))L.push('• '+(v.cliente||v.processo)+' — parcela '+v.parcela+'/'+v.de+', '+brl(v.valor)+', venceu '+brData(v.vencimento)+' (há '+v.dias+' dia'+(v.dias===1?'':'s')+')'+(v.encargos?' + encargos do contrato '+brl(v.encargos):'')+'.');
    if(r.vencidas.length>6)L.push('• e mais '+(r.vencidas.length-6)+'.');
  }
  if(r.proximas.length)L.push('Vencem em 7 dias: '+r.proximas.slice(0,5).map(v=>(v.cliente||v.processo)+' ('+brl(v.valor)+', '+brData(v.vencimento)+')').join('; ')+'.');
  const resp=porResponsavel?Object.entries(r.por_responsavel||{}).filter(([k])=>k!=='sem responsável'):[];
  if(resp.length)L.push('Por responsável: '+resp.map(([k,v])=>k+' — recebido '+brl(v.recebido_mes)+', a receber '+brl(v.a_receber)).join(' · ')+'.');
  L.push('','Memorial de cálculo:',...r.memorial.map(x=>'• '+x));
  return L.join('\n');
}

module.exports={registrarContrato,registrarPagamento,situacao,resumoCarteira,textoResumo,centavos,brl,somaMeses,gerarParcelas,TIPOS};
