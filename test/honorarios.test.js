'use strict';
// Honorários: contrato, parcelas, pagamentos e atraso — tudo em centavos, feito pelo código,
// com memorial de cálculo. A IA conversa e registra; cobrança ao cliente só com o OK do titular.
const test=require('node:test');
const assert=require('node:assert/strict');
const H=require('../lib/honorarios');
const I=require('../lib/office-insights');
const LexTools=require('../lib/lex-tools');
const {parseOfficeQuery,executeOfficeQuery}=require('../lib/office-queries');

const AGORA='2026-10-13T13:00:00.000Z';
const P=(extra={})=>({id:'p1',nome:'João Silva x Banco',cliente:'João Silva',status:'ATIVO',responsavel:'Dra. Ana',...extra});

test('valores em reais viram centavos sem perder nada',()=>{
  assert.equal(H.centavos('6000'),600000);assert.equal(H.centavos('6.000'),600000);assert.equal(H.centavos('R$ 6.000,50'),600050);
  assert.equal(H.centavos(1.5),150);assert.equal(H.centavos('1.5'),150);assert.equal(H.centavos(''),null);assert.equal(H.centavos('abc'),null);
  assert.equal(H.brl(600050),'R$ 6.000,50');
});

test('contrato fixo em parcelas: centavos que sobram vão na última, e o memorial mostra a conta',()=>{
  const {honorarios,memorial}=H.registrarContrato(P(),{tipo:'fixo',valor_total:'1.000,00',parcelas:3,primeiro_vencimento:'31/01/2027'},{por:'admin',agora:AGORA});
  assert.deepEqual(honorarios.parcelas.map(p=>[p.n,p.valor,p.vencimento]),[[1,33333,'2027-01-31'],[2,33333,'2027-02-28'],[3,33334,'2027-03-31']]);
  assert.match(memorial.join('\n'),/R\$ 1\.000,00 ÷ 3 = R\$ 333,33 com resto de R\$ 0,01 somado à última parcela/);
  assert.match(memorial.join('\n'),/Conferência: soma das parcelas = R\$ 1\.000,00/);
  assert.equal(H.somaMeses('2028-01-31',1),'2028-02-29','ano bissexto');
});

test('mensal, êxito e misto; troca de contrato só quando pedida e nunca com pagamento registrado',()=>{
  const mensal=H.registrarContrato(P(),{tipo:'mensal',valor_mensal:'500',meses:12,primeiro_vencimento:'05/11/2026'},{agora:AGORA}).honorarios;
  assert.equal(mensal.parcelas.length,12);assert.equal(mensal.contrato.valor_total,600000);
  const exito=H.registrarContrato(P(),{tipo:'exito',percentual_exito:'30%'},{agora:AGORA});
  assert.equal(exito.honorarios.parcelas.length,0);assert.equal(exito.honorarios.contrato.percentual_exito,30);assert.match(exito.memorial.join(' '),/pagamento avulso/);
  const misto=H.registrarContrato(P(),{tipo:'misto',valor_total:'2000',parcelas:2,primeiro_vencimento:'10/11/2026',percentual_exito:20},{agora:AGORA}).honorarios;
  assert.equal(misto.parcelas.length,2);assert.equal(misto.contrato.percentual_exito,20);
  assert.throws(()=>H.registrarContrato(P({honorarios:misto}),{tipo:'fixo',valor_total:'1',primeiro_vencimento:'10/11/2026'}),/já tem contrato/);
  const pago=H.registrarPagamento(P({honorarios:misto}),{parcela:1},{agora:AGORA}).honorarios;
  assert.throws(()=>H.registrarContrato(P({honorarios:pago}),{tipo:'fixo',valor_total:'1',primeiro_vencimento:'10/11/2026',substituir:true}),/não substituo/);
  for(const [input,msg] of [[{tipo:'xpto'},/Tipo/],[{tipo:'fixo',primeiro_vencimento:'10/11/2026'},/valor total/],[{tipo:'fixo',valor_total:'10',parcelas:0,primeiro_vencimento:'10/11/2026'},/parcelas/],[{tipo:'fixo',valor_total:'10',primeiro_vencimento:'31/02/2026'},/Data inválida/],[{tipo:'exito',percentual_exito:150},/percentual/]])
    assert.throws(()=>H.registrarContrato(P(),input),msg);
});

test('pagamentos: por parcela (parcial e depois quitação), sem parcela da mais antiga para a mais nova, excedente vira avulso',()=>{
  let h=H.registrarContrato(P(),{tipo:'fixo',valor_total:'3000',parcelas:3,primeiro_vencimento:'10/09/2026'},{agora:AGORA}).honorarios;
  let r=H.registrarPagamento(P({honorarios:h}),{parcela:2,valor:'400',data:'01/10/2026'},{agora:AGORA});
  assert.equal(r.honorarios.parcelas[1].status,'parcial');assert.match(r.memorial[0],/falta R\$ 600,00/);
  r=H.registrarPagamento(P({honorarios:r.honorarios}),{parcela:2},{agora:AGORA});
  assert.equal(r.honorarios.parcelas[1].status,'paga');
  assert.throws(()=>H.registrarPagamento(P({honorarios:r.honorarios}),{parcela:2}),/já está paga/);
  r=H.registrarPagamento(P({honorarios:r.honorarios}),{valor:'2.500',data:'12/10/2026',forma:'Pix'},{agora:AGORA});
  assert.deepEqual(r.honorarios.parcelas.map(p=>p.status),['paga','paga','paga']);
  assert.equal(r.honorarios.avulsos[0].valor,50000,'R$ 2.500 cobrem R$ 1.000 + R$ 1.000 e sobram R$ 500');
  assert.match(r.memorial[0],/da mais antiga para a mais nova/);
  assert.throws(()=>H.registrarPagamento(P(),{valor:'10'}),/Registre o contrato primeiro/);
  h=H.registrarContrato(P(),{tipo:'exito',percentual_exito:30},{agora:AGORA}).honorarios;
  r=H.registrarPagamento(P({honorarios:h}),{valor:'9000',descricao:'êxito do acordo'},{agora:AGORA});
  assert.equal(r.honorarios.avulsos[0].descricao,'êxito do acordo');
});

test('atraso: encargos só se o contrato prevê; resumo do escritório com memorial e por responsável',()=>{
  const h=H.registrarContrato(P(),{tipo:'fixo',valor_total:'2000',parcelas:2,primeiro_vencimento:'13/09/2026',multa:2,juros_mes:1},{agora:AGORA}).honorarios;
  const s=H.situacao(h,'2026-10-13');
  assert.equal(s.parcelas[0].dias_atraso,30);assert.equal(s.parcelas[0].encargos,3000,'2% de multa + 1% ao mês por 30 dias sobre R$ 1.000');
  assert.equal(s.parcelas[1].dias_atraso,0,'vence hoje: ainda não atrasou');
  const semEncargo=H.situacao(H.registrarContrato(P(),{tipo:'fixo',valor_total:'1000',primeiro_vencimento:'13/09/2026'},{agora:AGORA}).honorarios,'2026-10-13');
  assert.equal(semEncargo.encargos,0);
  const pagoOut=H.registrarPagamento(P({honorarios:h}),{parcela:1,data:'02/10/2026'},{agora:AGORA}).honorarios;
  const carteira=[P({honorarios:pagoOut}),P({id:'p2',nome:'Maria x Estado',cliente:'Maria',responsavel:'Dr. Beto',honorarios:H.registrarContrato(P(),{tipo:'fixo',valor_total:'900',parcelas:1,primeiro_vencimento:'01/10/2026'},{agora:AGORA}).honorarios}),P({id:'p3',honorarios:null})];
  const r=H.resumoCarteira(carteira,'2026-10-13');
  assert.equal(r.contratos,2);assert.equal(r.recebido_mes,100000);assert.equal(r.a_receber,190000);assert.equal(r.vencido,90000);
  assert.deepEqual(r.vencidas.map(v=>[v.cliente,v.dias]),[['Maria',12]]);
  assert.deepEqual(r.proximas.map(v=>[v.cliente,v.em_dias]),[['João Silva',0]]);
  assert.deepEqual(r.por_responsavel['Dra. Ana'],{recebido_mes:100000,a_receber:100000,vencido:0});
  const txt=H.textoResumo(r);
  assert.match(txt,/Recebido no mês: R\$ 1\.000,00 · A receber: R\$ 1\.900,00 · Vencido: R\$ 900,00 \(1 parcela\)/);
  assert.match(txt,/Memorial de cálculo/);assert.match(txt,/Maria — parcela 1\/1, R\$ 900,00, venceu 01\/10\/2026 \(há 12 dias\)/);
  assert.match(H.textoResumo(H.resumoCarteira([],'2026-10-13')),/Nenhum contrato/);
});

test('o painel mostra o financeiro e a parcela vencida vira ação com quem, o quê, por quê e a frase',()=>{
  const h=H.registrarContrato(P(),{tipo:'fixo',valor_total:'900',parcelas:1,primeiro_vencimento:'01/09/2026'},{agora:AGORA}).honorarios;
  const r=I.computeOfficeInsights({processes:[P({honorarios:h,setor:'judicial',andamentos:[{data:'2026-10-10',txt:'x'}]})],tasks:[],prazos:[],now:new Date(AGORA)});
  assert.equal(r.financeiro.vencido,90000);
  const a=r.alertas.find(x=>x.tipo==='parcela_vencida');
  assert.equal(a.gravidade,'alta');assert.equal(a.quem,'João Silva');assert.match(a.oque,/há 42 dias/);assert.equal(a.diga,'cobre João Silva da parcela 1 com educação');
  const txt=I.officeInsightsMessage(r);
  assert.match(txt,/Honorários: recebido no mês R\$ 0,00 · a receber R\$ 900,00 · vencido R\$ 900,00 \(1 parcela\)/);
  assert.match(I.officeInsightsBriefLine(r),/1 parcela de honorários vencida/);
});

function carteira(rows){let ps=structuredClone(rows);return{async read(){return{processes:structuredClone(ps)}},async mutate(fn){const c=structuredClone(ps);const value=await fn(c);ps=c;return{value}},get rows(){return ps}}}

test('ferramentas: a IA registra contrato e pagamento pelo que o titular disser; números sempre do código',async()=>{
  const store=carteira([P()]);
  const deps={processStore:store};
  const sec=await LexTools.executar('registrar_honorarios',{processo_id:'p1',tipo:'fixo',valor_total:'6000',parcelas:3,primeiro_vencimento:'10/11/2026'},deps,{profile:'secretaria'});
  assert.equal(sec.ok,false);
  const c=await LexTools.executar('registrar_honorarios',{processo_id:'p1',tipo:'fixo',valor_total:'6000',parcelas:3,primeiro_vencimento:'10/11/2026'},deps,{profile:'admin'});
  assert.equal(c.ok,true);assert.deepEqual(c.parcelas.map(p=>p.valor),['R$ 2.000,00','R$ 2.000,00','R$ 2.000,00']);assert.ok(c.memorial.length>=3);
  assert.equal(store.rows[0].honorarios.contrato.valor_total,600000);
  const pg=await LexTools.executar('registrar_pagamento',{processo_id:'p1',parcela:1,forma:'Pix'},deps,{profile:'secretaria'});
  assert.equal(pg.ok,true);assert.equal(store.rows[0].honorarios.parcelas[0].status,'paga');
  const ver=await LexTools.executar('honorarios',{processo_id:'p1'},deps,{profile:'admin'});
  assert.equal(ver.situacao.recebido,'R$ 2.000,00');assert.equal(ver.parcelas[0].situacao,'paga');
  const resumo=await LexTools.executar('honorarios',{},deps,{profile:'admin'});
  assert.equal(resumo.a_receber,'R$ 4.000,00');assert.match(resumo.texto,/Honorários/);
  assert.equal((await LexTools.executar('registrar_pagamento',{processo_id:'x',valor:'1'},deps,{profile:'admin'})).ok,false);
});

// Revisão adversarial da fase 2: dinheiro não pode ser contado duas vezes nem sumir do histórico.
test('histórico guarda o valor de fato pago; a mesma ordem repetida no mesmo turno não paga duas vezes; data com um dígito vale',()=>{
  const h=H.registrarContrato(P(),{tipo:'fixo',valor_total:'4000',parcelas:2,primeiro_vencimento:'1/11/2026'},{agora:AGORA}).honorarios;
  assert.equal(h.parcelas[0].vencimento,'2026-11-01');
  const r=H.registrarPagamento(P({honorarios:h}),{parcela:1},{agora:AGORA,turno:'t1'});
  assert.match(r.honorarios.historico.at(-1).evento,/pagamento de R\$ 2\.000,00/,'pagamento sem valor informado registra o que quitou');
  const r2=H.registrarPagamento(P({honorarios:r.honorarios}),{valor:'500',data:'2/10/2026'},{agora:AGORA,turno:'t2'});
  assert.throws(()=>H.registrarPagamento(P({honorarios:r2.honorarios}),{valor:'500',data:'2/10/2026'},{agora:AGORA,turno:'t2'}),/já registrei esse pagamento/);
  assert.throws(()=>H.registrarPagamento(P({honorarios:r2.honorarios}),{valor:'500',data:'2/10/2026'},{agora:AGORA,turno:'t3'}),/há 1 minuto/,'outra mensagem logo depois: pede confirmação');
  const r3=H.registrarPagamento(P({honorarios:r2.honorarios}),{valor:'500',data:'2/10/2026',repetido:true},{agora:AGORA,turno:'t3'});
  assert.equal(r3.honorarios.parcelas[1].pago,100000,'outro turno, confirmado como outro pagamento');
  const velho=H.registrarPagamento({honorarios:{contrato:{tipo:'exito',percentual_exito:30}}},{valor:'100'},{agora:AGORA});
  assert.equal(velho.honorarios.avulsos[0].valor,10000,'registro antigo sem as listas não quebra');
  assert.match(H.resumoCarteira([],'2026-10-13').memorial[3],/Juros e multa não entram nesta soma/);
});

test('ferramenta de pagamento chamada duas vezes no mesmo turno registra uma vez só',async()=>{
  const store=carteira([P({honorarios:H.registrarContrato(P(),{tipo:'fixo',valor_total:'1000',parcelas:2,primeiro_vencimento:'10/11/2026'},{agora:AGORA}).honorarios})]);
  const deps={processStore:store};
  const a=await LexTools.executar('registrar_pagamento',{processo_id:'p1',valor:'500'},deps,{profile:'admin',turno:'T9'});
  const b=await LexTools.executar('registrar_pagamento',{processo_id:'p1',valor:'500'},deps,{profile:'admin',turno:'T9'});
  assert.equal(a.ok,true);assert.equal(b.ok,false);assert.match(b.erro,/já registrei/);
  assert.equal(store.rows[0].honorarios.parcelas[0].status,'paga');assert.equal(store.rows[0].honorarios.parcelas[1].pago,0);
});

test('o executor sem IA não confunde dever de fazer com dívida, nem prazo com parcela',()=>{
  for(const f of ['quem deve fazer a contestação?','quem deve assinar a petição do João','clientes com prazo vencido','quais clientes têm processo atrasado'])
    assert.notEqual(parseOfficeQuery(f)?.action,'honorarios',f);
  for(const f of ['quem me deve?','clientes inadimplentes','inadimplência','quais clientes estão em atraso?','quem não pagou?','quem está devendo?'])
    assert.equal(parseOfficeQuery(f)?.action,'honorarios',f);
});

test('sem IA: "quem está devendo?" responde pelo executor; pedido de contrato continua indo para a redação',async()=>{
  for(const f of ['honorários','quem está devendo?','parcelas vencidas','como está o financeiro do escritório?'])assert.equal(parseOfficeQuery(f)?.action,'honorarios',f);
  assert.notEqual(parseOfficeQuery('faça o contrato de honorários do processo 5001234-56.2026.8.13.0704')?.action,'honorarios','pedido de redação não vira resumo financeiro');
  const store=carteira([P({honorarios:H.registrarContrato(P(),{tipo:'fixo',valor_total:'900',primeiro_vencimento:'01/09/2026'},{agora:AGORA}).honorarios})]);
  const r=await executeOfficeQuery({processStore:store},{action:'honorarios'},{now:new Date(AGORA),profile:'secretaria'});
  assert.match(r.message,/João Silva — parcela 1\/1, R\$ 900,00, venceu 01\/09\/2026 \(há 42 dias\)/);
});

// ---------- Auditoria de segurança da fase 2 (achados 8, 9 e 10) ----------
test('valor só em formato brasileiro sem ambiguidade; o resto é recusado em vez de adivinhado',()=>{
  for(const [v,c] of [['1.50',150],['1.5',150],['6.000',600000],['6.000,00',600000],['R$ 1.234,56',123456],['1234,5',123450],[2500,250000]])assert.equal(H.centavos(v),c,String(v));
  for(const v of ['1,000.50','6,000','0x10','1e3','12,345','-5','1.2.3','Infinity',1e12,-1])assert.equal(H.centavos(v),null,String(v));
  assert.throws(()=>H.registrarContrato(P(),{tipo:'fixo',valor_total:'6,000',primeiro_vencimento:'10/11/2026'}),/valor total/);
});

test('mesmo pagamento repetido em outra mensagem, em poucos minutos, pede confirmação; confirmado, registra',()=>{
  const h=H.registrarContrato(P(),{tipo:'fixo',valor_total:'3000',parcelas:3,primeiro_vencimento:'10/11/2026'},{agora:AGORA}).honorarios;
  const r1=H.registrarPagamento(P({honorarios:h}),{valor:'1000',data:'13/10/2026'},{agora:AGORA,turno:'a'});
  const dez=new Date(Date.parse(AGORA)+10*60000).toISOString();
  assert.throws(()=>H.registrarPagamento(P({honorarios:r1.honorarios}),{valor:'1000',data:'13/10/2026'},{agora:dez,turno:'b'}),/há 10 minutos/);
  const r2=H.registrarPagamento(P({honorarios:r1.honorarios}),{valor:'1000',data:'13/10/2026',repetido:true},{agora:dez,turno:'b'});
  assert.equal(r2.honorarios.parcelas[1].status,'paga');
  const depois=new Date(Date.parse(AGORA)+40*60000).toISOString();
  assert.equal(H.registrarPagamento(P({honorarios:r2.honorarios}),{valor:'1000',data:'13/10/2026'},{agora:depois,turno:'c'}).honorarios.parcelas[2].status,'paga','passado o intervalo, é outro pagamento');
});

test('responsável com nome de propriedade interna ("__proto__") não contamina o servidor',()=>{
  const h=H.registrarContrato(P(),{tipo:'fixo',valor_total:'100',primeiro_vencimento:'01/10/2026'},{agora:AGORA}).honorarios;
  const r=H.resumoCarteira([P({responsavel:'__proto__',honorarios:h}),P({id:'p2',responsavel:'constructor',honorarios:h})],'2026-10-13');
  assert.equal(({}).recebido_mes,undefined);assert.equal(({}).vencido,undefined);
  assert.equal(r.por_responsavel['__proto__'].vencido,10000);assert.equal(r.vencido,20000);
  const I2=require('../lib/office-insights');
  const x=I2.computeOfficeInsights({processes:[P({responsavel:'__proto__',honorarios:h,setor:'judicial'})],tasks:[],prazos:[],now:new Date(AGORA)});
  assert.equal(({}).a_receber,undefined);assert.ok(x.financeiro);
});

test('secretária vê o financeiro do escritório, mas não a receita por advogado',async()=>{
  const h=H.registrarContrato(P(),{tipo:'fixo',valor_total:'900',primeiro_vencimento:'01/09/2026'},{agora:AGORA}).honorarios;
  const store=carteira([P({honorarios:h})]);
  const sec=await LexTools.executar('honorarios',{},{processStore:store},{profile:'secretaria'});
  assert.equal(sec.por_responsavel,undefined);assert.doesNotMatch(sec.texto,/Por responsável/);
  const adm=await LexTools.executar('honorarios',{},{processStore:store},{profile:'admin'});
  assert.ok(adm.por_responsavel['Dra. Ana']);assert.match(adm.texto,/Por responsável: Dra\. Ana/);
  const q=await executeOfficeQuery({processStore:store},{action:'honorarios'},{now:new Date(AGORA),profile:'secretaria'});
  assert.doesNotMatch(q.message,/Por responsável/);
});

// ---------- Re-checagem da auditoria (achado 8 parcial) ----------
test('valor ilegível com parcela não vira quitação da parcela inteira; mesma quantia por outro caminho no mesmo turno não entra duas vezes',()=>{
  const h=H.registrarContrato(P(),{tipo:'fixo',valor_total:'6000',parcelas:3,primeiro_vencimento:'10/11/2026'},{agora:AGORA}).honorarios;
  for(const v of ['1,000.50','-500','6 mil'])assert.throws(()=>H.registrarPagamento(P({honorarios:h}),{parcela:1,valor:v},{agora:AGORA,turno:'t'}),/Valor do pagamento inválido/,v);
  const a=H.registrarPagamento(P({honorarios:h}),{parcela:2,data:'13/10/2026'},{agora:AGORA,turno:'T'});
  assert.throws(()=>H.registrarPagamento(P({honorarios:a.honorarios}),{valor:'2000',data:'13/10/2026'},{agora:AGORA,turno:'T'}),/já registrei esse pagamento/);
  assert.throws(()=>H.registrarPagamento(P({honorarios:a.honorarios}),{valor:'2000',data:'13/10/2026',repetido:true},{agora:AGORA,turno:'T'}),/já registrei esse pagamento/,'no mesmo turno, nem com "repetido"');
  const b=H.registrarPagamento(P({honorarios:a.honorarios}),{parcela:3,data:'13/10/2026'},{agora:AGORA,turno:'T'});
  assert.equal(b.honorarios.parcelas[2].status,'paga','parcelas diferentes de mesmo valor, no mesmo turno: as duas entram');
});
