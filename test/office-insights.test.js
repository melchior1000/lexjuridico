'use strict';
// Painel do escritório (o "Taskscore"/"insights acionáveis" dos concorrentes, feito
// do jeito do LEX): indicadores e alertas saem só dos registros, com QUEM + O QUÊ +
// POR QUÊ + AÇÃO + frase para agir. Número sem base fica sem base, nunca zero.
const test=require('node:test');
const assert=require('node:assert/strict');
const I=require('../lib/office-insights');
const Workflow=require('../lib/workflow');
const {executeNaturalOfficeCommand}=require('../lib/office-routes');
const {parseOfficeQuery,executeOfficeQuery,QUERY_ACTIONS}=require('../lib/office-queries');
const LexTools=require('../lib/lex-tools');

// 13/10/2026 10h em Brasília.
const NOW=new Date('2026-10-13T13:00:00Z');
const HORA=3600000,DIA=24*HORA;
const iso=ms=>new Date(NOW.getTime()-ms).toISOString();

function confirmado(caseId,dias,prazo){return{case_id:caseId,prazo,days_to_due:dias,deadline_status:'confirmed',deadline_legal_truth:true}}

const carteira=[
  {id:'p1',nome:'Maria Silva x Banco Alfa',numero:'5001234-56.2026.8.13.0704',status:'ATIVO',setor:'judicial',responsavel:'Dra. Ana',
    andamentos:[{data:'2026-10-01',txt:'[DATAJUD] Conclusos'}],last_court_sync_at:'2026-10-12T09:00:00Z'},
  {id:'p2',nome:'João Souza x Estado',numero:'5009999-11.2026.8.13.0001',status:'ATIVO',setor:'judicial',responsavel:'Dra. Ana',
    andamentos:[{data:'10/05/2026',txt:'Juntada'},{data:'2027-01-01',txt:'data errada no futuro'}],last_court_sync_at:'2026-10-11T09:00:00Z'},
  {id:'p3',nome:'Pedro Lima x INSS',numero:'5008888-22.2026.8.13.0002',status:'ATIVO',setor:'judicial',
    andamentos:[{data:'2026-04-01',txt:'Juntada'}],last_court_sync_at:'2026-06-01T09:00:00Z'},
  {id:'p4',nome:'Caso ganho',status:'GANHO',andamentos:[{data:'2025-01-01',txt:'Sentença'}]},
  {id:'p5',nome:'Caso ganho 2',status:'GANHO'},
  {id:'p6',nome:'Caso perdido',status:'PERDIDO'},
  {id:'p7',nome:'Inicial em preparação',status:'EM_PREP',setor:'autuacao',andamentos:[{data:'2026-01-01',txt:'Cadastro'}]},
  {id:'p8',nome:'Processo sem andamento',numero:'5007777-33.2026.8.13.0003',status:'ATIVO',setor:'judicial'},
  {id:'p9',nome:'Prazo já cumprido',numero:'5006666-44.2026.8.13.0004',status:'ATIVO',setor:'judicial',andamentos:[{data:'2026-10-10',txt:'x'}],prazo_baixa:{ativa:true,vencimento:'2026-10-10'}}
];
const tarefas=[
  {id:'t1',tipo:'contestacao',status:'aguardando_revisao',processo_id:'p1',processo_nome:'Maria Silva x Banco Alfa',ator:'advogado',criada_em:iso(4*DIA),atualizada_em:iso(3*DIA)},
  {id:'t2',tipo:'peticao',status:'aguardando_revisao',processo_id:'p3',ator:'admin',criada_em:iso(DIA),atualizada_em:iso(10*HORA)},
  {id:'t3',tipo:'recurso',status:'aguardando_dados',processo_id:'p3',pendencia:'Anexe a sentença.',ator:'admin',criada_em:iso(2*DIA)},
  {id:'t4',tipo:'analise',status:'concluida',processo_id:'p2',ator:'admin',criada_em:iso(10*DIA),atualizada_em:iso(9*DIA),revisado_em:iso(9*DIA-6*HORA),revisado_por:'admin'},
  {id:'t5',tipo:'peticao',status:'concluida',processo_id:'p2',ator:'admin',criada_em:iso(60*DIA),atualizada_em:iso(59*DIA),revisado_em:iso(58*DIA),revisado_por:'admin'},
  {id:'t6',tipo:'peticao',status:'falhou',processo_id:'p8',pendencia:'Execução interrompida repetidamente.',ator:'advogado',criada_em:iso(5*DIA),devolvido_em:iso(3*DIA),devolvido_por:'advogado'}
];
const prazos=[
  confirmado('p1',3,'2026-10-16'),   // tem minuta esperando revisão → não é "prazo sem peça"
  confirmado('p8',1,'2026-10-14'),   // só tarefa que falhou: falha conta como tarefa aberta (vira "tarefa travada")
  confirmado('p2',2,'2026-10-15'),   // última peça aprovada há 9 dias → coberto
  confirmado('p3',-2,'2026-10-11'),  // vencido
  confirmado('p9',-3,'2026-10-10'),  // vencido, mas marcado como cumprido → fora
  {case_id:'p2',prazo:'2026-10-20',days_to_due:7,deadline_status:'suggested',deadline_legal_truth:false}
];

test('carteira usa as mesmas regras de setor da Home e só calcula êxito com base',()=>{
  const r=I.computeOfficeInsights({processes:carteira,tasks:tarefas,prazos,now:NOW});
  const home=Workflow.summary(carteira);
  assert.equal(r.carteira.total,home.total);
  assert.equal(r.carteira.judicial,home.judicial);
  assert.equal(r.carteira.em_preparacao,home.autuacao);
  assert.equal(r.carteira.concluidos,home.concluidos);
  assert.equal(r.carteira.ganhos,2);assert.equal(r.carteira.perdidos,1);
  assert.equal(r.carteira.taxa_exito,67);assert.equal(r.carteira.base_exito,3);
  const vazio=I.computeOfficeInsights({processes:[{id:'x',status:'ATIVO'}],tasks:[],prazos:[],now:NOW});
  assert.equal(vazio.carteira.taxa_exito,null,'sem GANHO/PERDIDO marcado não existe taxa de êxito');
  assert.match(I.officeInsightsMessage(vazio),/sem base para taxa de êxito/);
});

test('prazos: só os confirmados contam; cumprido sai; vencido vira alerta alto',()=>{
  const r=I.computeOfficeInsights({processes:carteira,tasks:tarefas,prazos,now:NOW});
  assert.deepEqual(r.prazos,{vencidos:1,hoje:0,proximos_7_dias:3,a_conferir:1});
  const vencidos=r.alertas.filter(a=>a.tipo==='prazo_vencido');
  assert.equal(vencidos.length,1);
  assert.equal(vencidos[0].processo_id,'p3');assert.equal(vencidos[0].gravidade,'alta');
  assert.match(vencidos[0].oque,/11\/10\/2026/);
  assert.ok(!r.alertas.some(a=>a.processo_id==='p9'),'prazo marcado como cumprido não alerta');
});

test('prazo oficial próximo sem peça em produção vira alerta; com peça aberta ou aprovada recente, não',()=>{
  const r=I.computeOfficeInsights({processes:carteira,tasks:tarefas,prazos,now:NOW});
  assert.equal(r.alertas.filter(a=>a.tipo==='prazo_sem_peca').length,0,'p1 tem minuta, p2 tem peça aprovada recente, p8 tem tarefa aberta (falhou)');
  const semTarefa=I.computeOfficeInsights({processes:carteira,tasks:[],prazos,now:NOW});
  const a=semTarefa.alertas.filter(x=>x.tipo==='prazo_sem_peca').map(x=>x.processo_id).sort();
  assert.deepEqual(a,['p1','p2','p8']);
  const p8=semTarefa.alertas.find(x=>x.processo_id==='p8'&&x.tipo==='prazo_sem_peca');
  assert.equal(p8.gravidade,'alta');assert.match(p8.oque,/amanhã/);
  assert.match(p8.diga,/5007777-33\.2026\.8\.13\.0003/);
  // Sem a lista de tarefas (Task Engine fora), o painel não acusa "sem peça": não sabe.
  const semEngine=I.computeOfficeInsights({processes:carteira,tasks:null,prazos,now:NOW});
  assert.equal(semEngine.alertas.filter(x=>x.tipo==='prazo_sem_peca').length,0);
  assert.equal(semEngine.producao,null);
});

test('minuta parada só depois de 48 h; tarefa travada traz a pendência',()=>{
  const r=I.computeOfficeInsights({processes:carteira,tasks:tarefas,prazos,now:NOW});
  const minutas=r.alertas.filter(a=>a.tipo==='minuta_parada');
  assert.deepEqual(minutas.map(a=>a.tarefa_id),['t1'],'t2 está há 10 h: ainda não é parada');
  assert.match(minutas[0].oque,/3 dias/);
  const travadas=r.alertas.filter(a=>a.tipo==='tarefa_travada');
  assert.deepEqual(travadas.map(a=>a.tarefa_id).sort(),['t3','t6']);
  assert.match(travadas.find(a=>a.tarefa_id==='t3').oque,/Anexe a sentença/);
  assert.equal(travadas.find(a=>a.tarefa_id==='t6').gravidade,'alta');
});

test('processo parado distingue tribunal parado de leitura velha; data futura e preparação ficam fora',()=>{
  const r=I.computeOfficeInsights({processes:carteira,tasks:tarefas,prazos,now:NOW});
  const parados=Object.fromEntries(r.alertas.filter(a=>a.tipo==='processo_parado').map(a=>[a.processo_id,a]));
  assert.deepEqual(Object.keys(parados).sort(),['p2','p3']);
  // p2: último andamento válido 10/05/2026 (o de 2027 é erro e é ignorado); leitura oficial recente.
  assert.equal(parados.p2.dias,156);
  assert.match(parados.p2.porque,/confirma/);assert.match(parados.p2.diga,/impulso/);
  // p3: leitura oficial de junho → pode ser só falta de atualização.
  assert.match(parados.p3.porque,/falta de atualização/);assert.match(parados.p3.diga,/^atualize o processo/);
  assert.ok(!parados.p7,'caso em preparação não conta como parado');
  assert.ok(!parados.p4,'encerrado não conta');
  assert.equal(r.sem_andamento_registrado,1);
  const curto=I.computeOfficeInsights({processes:carteira,tasks:tarefas,prazos,now:NOW,opcoes:{dias_parado:180}});
  assert.deepEqual(curto.alertas.filter(a=>a.tipo==='processo_parado').map(a=>a.processo_id),['p3'],'limite configurável: 195 dias passa, 156 não');
});

test('alertas vêm em ordem de gravidade e o total não é cortado pelo limite da lista',()=>{
  const r=I.computeOfficeInsights({processes:carteira,tasks:tarefas,prazos,now:NOW,opcoes:{max_alertas:2}});
  assert.equal(r.alertas.length,2);
  assert.ok(r.alertas_total>2);
  assert.ok(r.alertas.every(a=>a.gravidade==='alta'));
  for(const a of r.alertas)for(const k of ['quem','oque','porque','acao','diga'])assert.ok(String(a[k]||'').trim(),k+' obrigatório em todo alerta');
});

test('equipe: ordens, revisões e devoluções na janela; avisa quando só há perfil e não pessoa',()=>{
  const r=I.computeOfficeInsights({processes:carteira,tasks:tarefas,prazos,now:NOW});
  const admin=r.equipe.pessoas.find(p=>p.id==='admin'),adv=r.equipe.pessoas.find(p=>p.id==='advogado');
  assert.equal(admin.ordens,3,'t2, t3, t4 (t5 é de 60 dias atrás)');
  assert.equal(admin.revisoes,1);assert.equal(admin.revisao_media_horas,6,'minuta pronta há 9 dias, revisada 6 h depois');
  assert.equal(adv.ordens,2);assert.equal(adv.devolucoes,1);
  assert.match(r.equipe.observacao,/perfil/);
  assert.equal(r.producao.aprovadas,1);assert.equal(r.producao.aguardando_revisao,2);
  assert.equal(r.producao.esperando_voce,2);assert.equal(r.producao.devolvidas,1);
  const ana=r.responsaveis.find(x=>x.responsavel==='Dra. Ana');
  assert.deepEqual(ana,{responsavel:'Dra. Ana',ativos:2,parados:1,prazos_vencidos:0});
});

test('texto do painel é legível e sem lixo; secretária não vê equipe',async()=>{
  const r=I.computeOfficeInsights({processes:carteira,tasks:tarefas,prazos,now:NOW});
  const txt=I.officeInsightsMessage(r);
  assert.match(txt,/^📊 Painel do escritório — 13\/10\/2026/);
  assert.match(txt,/êxito de 67%/);
  assert.match(txt,/Pede ação/);assert.match(txt,/Por quê:/);assert.match(txt,/Diga: "/);
  assert.match(txt,/Equipe/);
  assert.doesNotMatch(txt,/undefined|NaN|null|\[object/);
  assert.match(I.officeInsightsBriefLine(r),/^📊 Painel: \d+ pontos pedindo ação \(.*1 prazo vencido.*\)\. Diga "painel do escritório"\.$/);
  assert.equal(I.officeInsightsBriefLine(I.computeOfficeInsights({processes:[],tasks:[],prazos:[],now:NOW})),null);
});

test('frases naturais chegam ao painel; ordens com verbo e outros pedidos não são sequestrados',()=>{
  for(const f of ['painel do escritório','Painel','indicadores','como está a produtividade da equipe?','quais processos estão parados?','qual a nossa taxa de êxito?','desempenho dos advogados'])
    assert.equal(parseOfficeQuery(f)?.action,'office_panel',f);
  assert.equal(parseOfficeQuery('atualize os processos parados')?.action,'court_update');
  assert.equal(parseOfficeQuery('painel do pje')?.action,'pje_avisos');
  assert.equal(parseOfficeQuery('como está o escritório?')?.action,'daily_brief');
  assert.equal(parseOfficeQuery('prazos da semana')?.action,'deadlines');
  assert.ok(QUERY_ACTIONS.includes('office_panel'));
});

function deps(over={}){
  return{
    processStore:{async read(){return{processes:structuredClone(carteira),version:1}},async mutate(){throw new Error('consulta não pode gravar')}},
    engine:{async list(){return structuredClone(tarefas)},async submit(){throw new Error('consulta não pode criar tarefa')}},
    receptionStore:{async list(){return[]},async appendEvent(){}},
    records:{list:async()=>[],read:async()=>null},log:()=>{},...over
  };
}

test('pela porta do executor: advogado vê tudo, secretária vê sem equipe, e nada é gravado',async()=>{
  const adv=await executeNaturalOfficeCommand(deps(),{text:'painel do escritório',profile:'advogado',now:NOW});
  assert.equal(adv.command.action,'office_panel');
  assert.match(adv.message,/Painel do escritório/);assert.match(adv.message,/Equipe/);
  assert.ok(adv.result.alertas_total>0);
  const sec=await executeNaturalOfficeCommand(deps(),{text:'quais processos estão parados?',profile:'secretaria',now:NOW});
  assert.equal(sec.command.action,'office_panel');
  assert.doesNotMatch(sec.message,/Equipe|Por responsável/);
  assert.equal(sec.result.equipe,null);assert.deepEqual(sec.result.responsaveis,[]);
  // Task Engine fora do ar: o painel sai, dizendo que não leu a produção.
  const semEngine=await executeOfficeQuery(deps({engine:{async list(){throw new Error('fora')}}}),{action:'office_panel'},{now:NOW,profile:'admin'});
  assert.match(semEngine.message,/Produção: o Task Engine não respondeu agora/);
});

test('o bom dia ganha a linha do painel só quando há algo pedindo ação',async()=>{
  const r=await executeNaturalOfficeCommand(deps(),{text:'resumo do dia',profile:'advogado',now:NOW});
  assert.equal(r.command.action,'daily_brief');
  assert.match(r.message,/📊 Painel: \d+ pontos pedindo ação/);
  const limpo=await executeNaturalOfficeCommand(deps({processStore:{async read(){return{processes:[],version:1}}},engine:{async list(){return[]}}}),{text:'resumo do dia',profile:'advogado',now:NOW});
  assert.doesNotMatch(limpo.message,/📊 Painel/);
});

test('Task Engine fora do ar não apaga a linha do painel no bom dia (processos parados continuam)',async()=>{
  const r=await executeNaturalOfficeCommand(deps({engine:{async list(){throw new Error('fora')}}}),{text:'resumo do dia',profile:'advogado',now:NOW});
  assert.equal(r.command.action,'daily_brief');
  assert.match(r.message,/📊 Painel: \d+ pontos pedindo ação \(2 processos parados\)/);
});

test('o agente LEX tem a ferramenta do painel e ela devolve o texto e os números',async()=>{
  const defs=LexTools.definitions({});
  const def=defs.find(d=>d.name==='painel_do_escritorio');
  assert.ok(def,'ferramenta registrada');
  assert.equal(def.input_schema.properties.dias_parado.minimum,30);
  const out=await LexTools.executar('painel_do_escritorio',{dias_parado:120},deps(),{profile:'admin',now:NOW});
  assert.equal(out.ok,true);
  assert.equal(out.parametros.dias_parado,120);
  assert.match(out.texto,/Painel do escritório/);
  const sec=await LexTools.executar('painel_do_escritorio',{},deps(),{profile:'secretaria',now:NOW});
  assert.equal(sec.equipe,null);
});

test('datas: aceita os formatos do cadastro e recusa data impossível',()=>{
  assert.equal(I.diaCivil('2026-10-13'),'2026-10-13');
  assert.equal(I.diaCivil('13/10/2026'),'2026-10-13');
  assert.equal(I.diaCivil('2026-10-13T02:30:00Z'),'2026-10-12','data-hora vira o dia de Brasília');
  assert.equal(I.diaCivil('31/02/2026'),null);
  assert.equal(I.diaCivil(''),null);assert.equal(I.diaCivil('ontem'),null);
});
