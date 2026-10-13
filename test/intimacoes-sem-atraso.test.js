'use strict';
// Intimações e prazos sem atraso (13/10/2026). Pedido do titular: "atualização atrasada
// arrebenta com advogado"; ver como os outros operam e excluir o aviso que chega atrasado.
// Regra que decide tudo: desde 16/05/2025 o prazo do advogado conta da publicação no DJEN
// (Res. CNJ 455/2022, art. 11, §3º, red. Res. 569/2024; CPC, art. 224, §§ 2º e 3º).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const raiz=path.join(__dirname,'..');
const bot=fs.readFileSync(path.join(raiz,'bot.js'),'utf8');

test('servidor: o Datajud não manda aviso de "novidade" (chega com dias de atraso)',()=>{
  const ini=bot.indexOf('const _PJE_VARREDURA_HORAS');
  const relogio=bot.slice(ini,bot.indexOf('}, _PJE_VARREDURA_HORAS * 60 * 60 * 1000);',ini));
  assert.ok(ini>0&&relogio.length>100,'relógio da varredura encontrado');
  assert.doesNotMatch(relogio,/envTelegram|envWhatsApp|notify/,'a varredura do Datajud não avisa ninguém');
  assert.match(relogio,/datajud_date === hoje/,'uma leitura por dia basta: não relê se a rotina já leu hoje');
  const rota=bot.slice(bot.indexOf("if(url.startsWith('/api/pje/andamentos')"),bot.indexOf("if(url==='/api/pje/sincronizar'"));
  assert.doesNotMatch(rota,/envTelegram\(/,'leitura avulsa do Datajud não avisa por Telegram');
});

// ---------------------------------------------------------------------------------------------
// Intimação do Diário a tratar: fica pendente até o titular decidir (lib/djen-tratamento.js).
// ---------------------------------------------------------------------------------------------
const T=require('../lib/djen-tratamento');
const {executeNaturalOfficeCommand}=require('../lib/office-routes');
const LexTools=require('../lib/lex-tools');
const KEY='0123456789abcdef0123456789abcdef';
function memRecords(){
  const map=new Map();
  return{map,async read(k){return map.has(k)?{value:structuredClone(map.get(k))}:null},
    async change(k,fn){const next=await fn(map.has(k)?structuredClone(map.get(k)):null);if(next!==undefined)map.set(k,structuredClone(next));return map.get(k)}};
}
function memStore(rows){let ps=structuredClone(rows);return{get rows(){return ps},async read(){return{processes:structuredClone(ps),version:1}},async mutate(fn){const next=structuredClone(ps);const value=await fn(next);ps=next;return{value,processes:structuredClone(ps),version:2}}}}
// Banco falso da tabela djen_comunicacoes com os filtros que o LEX usa.
function memDb(rows,{falhar=false}={}){
  const tabela=rows.map(r=>({...r}));const calls=[];
  async function req(method,table,data,query={}){
    calls.push({method,table,query});
    if(falhar)return{ok:false,status:503,body:{message:'banco fora'}};
    if(table!=='djen_comunicacoes')return{ok:true,status:200,body:[]};
    const passa=r=>Object.entries(query).every(([k,v])=>{
      if(['select','order','limit','offset'].includes(k))return true;
      const s=String(v);
      if(s.startsWith('in.(')){return s.slice(4,-1).split(',').includes(String(r[k]))}
      if(s.startsWith('gte.'))return String(r[k]||'')>=s.slice(4);
      if(s.startsWith('eq.'))return String(r[k])===s.slice(3);
      return true;
    });
    if(method==='GET'){const off=Number(query.offset)||0,lim=Number(query.limit)||1000;return{ok:true,status:200,body:tabela.filter(passa).slice(off,off+lim).map(r=>({...r}))}}
    if(method==='PATCH'){const hit=tabela.filter(passa);hit.forEach(r=>Object.assign(r,data));return{ok:true,status:200,body:hit.map(r=>({...r}))}}
    return{ok:false,status:405,body:null};
  }
  return{req,tabela,calls};
}
const NOW=new Date('2026-10-13T13:00:00Z'); // terça, 10h em Brasília
function linha(over={}){
  return{djen_id:'111',status:'casada',cnj:'50000000020268130001',tribunal:'TJMG',tipo:'Intimação',data_disponibilizacao:'2026-10-09',data_publicacao:null,
    processo_id:'p1',prazo_cunhado:false,prazo_sugestao:null,motivo_cancelamento:null,numero_oab:'123456',uf_oab:'MG',texto:'Fica intimada a parte autora para se manifestar em 5 dias.',
    requisitado_em:'2026-10-09T09:00:00.000Z',observado_em:'2026-10-09T09:00:01.000Z',endpoint:'https://gateway.example/comunicacao',request_id:'req-111',
    raw_receipt:'{"count":1,"items":[{"id":"111"}]}',receipt_item_key:'111',receipt_page:1,...over};
}
// O Diário falso devolve, na releitura, as comunicações gravadas (mesmo texto).
function djenFalso(db,chamadas=[]){
  return{base:'https://gateway.example/api/v1',interRequestDelayMs:0,retries:0,fetchImpl:async url=>{
    chamadas.push(String(url));
    const u=new URL(String(url)),dia=u.searchParams.get('dataDisponibilizacaoInicio');
    const items=db.tabela.filter(r=>r.data_disponibilizacao===dia).map(r=>({id:r.djen_id,numeroProcesso:r.cnj,siglaTribunal:r.tribunal,tipoComunicacao:r.tipo,dataDisponibilizacao:r.data_disponibilizacao,texto:r.texto}));
    return{ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({count:items.length,items})};
  }};
}
function cenario(rows,over={}){
  const db=memDb(rows,over),records=memRecords(),releituras=[];
  const store=memStore([{id:'p1',nome:'Maria x Banco',numero:'5000000-00.2026.8.13.0001',status:'ATIVO',andamentos:[]}]);
  return{db,records,store,releituras,deps:{sbReq:db.req,records,processStore:store,integrityKey:KEY,engine:{async list(){return[]}},receptionStore:{async list(){return[]}},djenClientOptions:djenFalso(db,releituras)}};
}

test('pendente: casada sem prazo confirmado e órfã ficam; confirmada, cancelada e tratada saem — com publicação e urgência certas',async()=>{
  const {deps,records}=cenario([
    linha({djen_id:'111',prazo_sugestao:{due_at_proposto:'2026-10-20',termo_inicial_proposto:'2026-10-14',dias:5,regime:'cpc',source_hash:'h',trecho:'manifestar em 5 dias'}}),
    linha({djen_id:'112',status:'orfa',processo_id:null,cnj:'00000010020268130001',data_disponibilizacao:'2026-10-02'}),
    linha({djen_id:'113',prazo_cunhado:true}),
    linha({djen_id:'114',status:'cancelada',motivo_cancelamento:'erro do cartório'}),
    linha({djen_id:'115'}),
    linha({djen_id:'116',data_disponibilizacao:'2026-05-01'}) // fora da janela de 120 dias
  ]);
  await T.tratar(deps,{djenId:'115',acao:'sem_prazo',motivo:'só ciência',perfil:'advogado',now:NOW});
  const r=await T.listarPendentes(deps,{now:NOW});
  assert.deepEqual(r.pendentes.map(i=>i.djen_id),['112','111'],'a órfã de 02/10 sem proposta é urgente e vem primeiro');
  assert.equal(r.total,2);assert.equal(r.orfas,1);
  const casada=r.pendentes.find(i=>i.djen_id==='111');
  assert.equal(casada.publicada_em,'2026-10-13','disponibilizada sexta 09/10 → publicada terça 13/10 (12/10 é feriado nacional)');
  assert.equal(casada.prazo_proposto,'2026-10-20');assert.equal(casada.dias_ate_prazo_proposto,7);assert.equal(casada.urgente,false);
  assert.equal(casada.processo,'Maria x Banco');
  const orfa=r.pendentes[0];
  assert.equal(orfa.situacao,'processo_nao_cadastrado');assert.equal(orfa.urgente,true);assert.equal(orfa.cnj_formatado,'0000001-00.2026.8.13.0001');
  assert.deepEqual(r.tratadas_recentes.map(i=>i.djen_id),['115']);assert.equal(r.tratadas_recentes[0].tratamento.por,'advogado');
  const msg=T.mensagemPendentes(r);
  assert.match(msg,/2 intimações do Diário a tratar \(1 de processo não cadastrado\)/);
  assert.match(msg,/cadastre o processo 0000001-00\.2026\.8\.13\.0001" ou responda NÃO É NOSSO 112/);
  assert.match(msg,/CONFIRMO PRAZO 111 20\/10\/2026 — ou SEM PRAZO 111/);
  assert.equal(records.map.get(T.KEY).historico[0].djen_id,'115');
});
test('a lista do que falta tratar pede ao banco só órfãs, não ligadas e casadas sem prazo confirmado',async()=>{
  const {deps,db}=cenario([linha()]);
  await T.listarPendentes(deps,{now:NOW});
  const q=db.calls.find(c=>c.method==='GET'&&c.table==='djen_comunicacoes').query;
  assert.equal(q.or,'(status.eq.orfa,status.eq.nova,and(status.eq.casada,prazo_cunhado.not.is.true))');
  assert.equal(q.data_disponibilizacao,'gte.2026-06-15','janela de 120 dias');
  assert.doesNotMatch(q.select,/raw_receipt|payload/,'sem o recibo inteiro na lista');
});

// Gravada e não ligada ao processo (falha ao ligar, servidor reiniciado no meio): nunca some.
test('intimação lida e não ligada ao processo aparece "a conferir" e pode ser dada por tratada',async()=>{
  const {deps}=cenario([linha({djen_id:'121',status:'nova',processo_id:null})]);
  const r=await T.listarPendentes(deps,{now:NOW});
  assert.equal(r.total,1);
  assert.equal(r.pendentes[0].situacao,'a_conferir');
  const msg=T.mensagemPendentes(r);
  assert.match(msg,/nº 121[\s\S]*não conseguiu ligar ao processo[\s\S]*JÁ TRATEI 121/);
  const t=await T.tratar(deps,{djenId:'121',acao:'tratada_fora',perfil:'advogado',now:NOW});
  assert.equal(t.ok,true);
  assert.equal((await T.listarPendentes(deps,{now:NOW})).total,0);
});

test('banco fora: falha fechada — nunca "nenhuma intimação"',async()=>{
  const {deps}=cenario([linha()],{falhar:true});
  await assert.rejects(T.listarPendentes(deps,{now:NOW}));
  const out=await executeNaturalOfficeCommand(deps,{text:'intimações a tratar',profile:'secretaria',now:NOW});
  assert.match(out.message,/Não consegui ler as intimações a tratar/);assert.doesNotMatch(out.message,/Nenhuma intimação/);
});

test('tratar é ato do advogado: secretaria não marca; motivo e autor registrados; repetir não duplica; reabrir devolve à lista',async()=>{
  const {deps,records}=cenario([linha({djen_id:'111'}),linha({djen_id:'112',prazo_cunhado:true})]);
  await assert.rejects(T.tratar(deps,{djenId:'111',acao:'sem_prazo',perfil:'secretaria',now:NOW}),/Só o advogado/);
  await assert.rejects(T.tratar(deps,{djenId:'111',acao:'apagar',perfil:'advogado',now:NOW}),/Escolha/);
  await assert.rejects(T.tratar(deps,{djenId:'112',acao:'sem_prazo',perfil:'advogado',now:NOW}),/já foi confirmado/);
  await assert.rejects(T.tratar(deps,{djenId:'999',acao:'sem_prazo',perfil:'advogado',now:NOW}),/Não encontrei/);
  const a=await T.tratar(deps,{djenId:'111',acao:'sem_prazo',motivo:'intimação da outra parte',perfil:'advogado',now:NOW});
  assert.equal(a.ok,true);assert.equal(a.tratamento.motivo,'intimação da outra parte');assert.equal(a.tratamento.por,'advogado');
  const b=await T.tratar(deps,{djenId:'111',acao:'nao_e_nosso',perfil:'admin',now:NOW});
  assert.equal(b.ja_tratada,true);assert.equal(records.map.get(T.KEY).historico.length,1);
  assert.equal((await T.listarPendentes(deps,{now:NOW})).total,0);
  const c=await T.reabrir(deps,{djenId:'111',perfil:'advogado',now:NOW});
  assert.equal(c.ok,true);assert.equal((await T.listarPendentes(deps,{now:NOW})).total,1);
  assert.equal(records.map.get(T.KEY).historico[0].acao,'reaberta');
});

test('pelo canal, com a frase exata do titular: SEM PRAZO, NÃO É NOSSO, CONFIRMO PRAZO (prazo vira oficial) e REABRIR',async()=>{
  const {deps,store,db,releituras}=cenario([
    linha({djen_id:'111',prazo_sugestao:{due_at_proposto:'2026-10-20',dias:5,regime:'cpc',source_hash:require('../lib/deadline-suggestion').sourceHash(linha({djen_id:'111'}))}}),
    linha({djen_id:'112',status:'orfa',processo_id:null}),
    linha({djen_id:'113'})
  ]);
  const say=(text,profile='advogado')=>executeNaturalOfficeCommand(deps,{text,profile,now:NOW});
  assert.match((await say('SEM PRAZO 113','secretaria')).message,/permissão/);
  assert.match((await say('SEM PRAZO 113 - só ciência da juntada')).message,/Intimação nº 113 marcada: sem prazo para o escritório — só ciência da juntada/);
  assert.match((await say('Não é nosso 112')).message,/marcada: não é processo do escritório/);
  const semData=await say('CONFIRMO PRAZO 111');
  assert.equal(semData.needs_input,true);assert.match(semData.message,/CONFIRMO PRAZO 111 20\/10\/2026/);assert.match(semData.message,/Nada foi confirmado/);
  const ok=await say('CONFIRMO PRAZO 111 21/10/2026');
  assert.match(ok.message,/Prazo confirmado: .* vence em 21\/10\/2026/);assert.match(ok.message,/O LEX tinha proposto 20\/10\/2026; valeu a sua data/);
  assert.ok(releituras.length>0,'leitura de 4 dias atrás: o LEX releu a intimação no Diário antes de confirmar');
  assert.equal(store.rows[0].prazoReal,'2026-10-21');assert.equal(store.rows[0].deadline_truth.legal_truth,true);
  assert.equal(db.tabela.find(r=>r.djen_id==='111').prazo_cunhado,true);
  const lista=await say('intimações a tratar','secretaria');
  assert.match(lista.message,/Nenhuma intimação do Diário \(DJEN\) esperando tratamento/);
  assert.match((await say('reabrir intimação 113')).message,/voltou para a lista/);
  assert.match((await say('intimações a tratar')).message,/1 intimação do Diário a tratar/);
  // A órfã não tem processo: confirmar prazo pede o cadastro antes, sem confirmar nada.
  await say('reabrir intimação 112');
  assert.match((await say('CONFIRMO PRAZO 112 30/10/2026')).message,/não está cadastrado no LEX[\s\S]*Nada foi confirmado/);
});

test('a IA não pratica atos do titular e enxerga as intimações a tratar',async()=>{
  const {deps}=cenario([linha({djen_id:'111'})]);
  const ordem=await LexTools.executar('ordem_operacional',{texto:'CONFIRMO PRAZO 111 20/10/2026'},{...deps,executeNaturalOfficeCommand},{profile:'admin'});
  assert.equal(ordem.ok,false);assert.match(ordem.erro,/só vale quando o próprio titular a digita/);
  for(const texto of ['SEM PRAZO 111','não é nosso 111','já tratei 111','reabrir intimação 111']){
    const r=await LexTools.executar('ordem_operacional',{texto},{...deps,executeNaturalOfficeCommand},{profile:'admin'});
    assert.equal(r.ok,false,texto);
  }
  const v=await LexTools.executar('intimacoes_a_tratar',{},deps,{profile:'admin',now:NOW});
  assert.equal(v.ok,true);assert.equal(v.total,1);assert.match(v.texto,/CONFIRMO PRAZO 111/);
});

test('servidor: a frase do titular vai direto ao executor no WhatsApp/Telegram e no chat do app',()=>{
  const i=bot.indexOf('function _fraseDoTitular');
  const fn=new Function(bot.slice(i,bot.indexOf('\n}\n',i)+2)+'return _fraseDoTitular')();
  for(const s of ['CONFIRMO PRAZO 412345678 24/10/2026','sem prazo 412345678','Não é nosso 412345679 - de outro escritório','reabrir intimação 4123','CONFIRMO CIÊNCIA TJMG 1'])assert.equal(fn(s),true,s);
  for(const s of ['sem prazo pra contestar?','não é nosso problema','confirmo o prazo do João para sexta'])assert.equal(fn(s),false,s);
  assert.match(bot,/const literal=!!choice\|\|[^\n]*_fraseDoTitular\(txt\)/,'canais');
  assert.match(bot,/vivoUrl==='\/api\/vivo\/conversar' && req\.method==='POST' && _fraseDoTitular\(bodyAgv\?\.mensagem\)/,'chat do app');
});

test('app: Prazos › Diário lista o que falta tratar com botões que fazem a ação (sem botão morto)',()=>{
  const ui=fs.readFileSync(path.join(raiz,'office-ui-v2.js'),'utf8');
  assert.match(ui,/lexSetPrazoTab\(\\'diario\\'\)">Diário <b>/);
  assert.match(ui,/window\.lexDiarioConfirmar=async function[\s\S]*\/api\/escritorio\/prazos\/cunhar/);
  assert.match(ui,/window\.lexDiarioTratar=async function[\s\S]*\/api\/escritorio\/intimacoes\/tratar/);
  assert.match(ui,/window\.lexDiarioReabrir=async function[\s\S]*\/api\/escritorio\/intimacoes\/reabrir/);
  assert.match(ui,/window\.lexDiarioCadastrar=function[\s\S]*cadastre o processo/);
  const core=fs.readFileSync(path.join(raiz,'lex2-interface-core.js'),'utf8');
  assert.match(core,/Tratar agora',onclick:"lexSetPrazoTab\('diario'\)"/,'o aviso leva para a lista certa (antes levava para "Revisar")');
  // O número da intimação só entra no onclick se for seguro.
  const ini=ui.indexOf('function diarioId('),c=require('node:vm').createContext({});
  require('node:vm').runInContext(ui.slice(ini,ui.indexOf('\n',ini)),c);
  assert.equal(c.diarioId('412345678'),'412345678');assert.equal(c.diarioId("1');alert(1);('"),null);
});

test('confirmar prazo com leitura velha: relê no Diário; sem conseguir reler, não confirma e diz por quê',async()=>{
  const DA=require('../lib/deadline-authorization'),DM=require('../lib/djen-monitor');
  const {deps,db,store}=cenario([linha({djen_id:'111'})]);
  const base={processStore:store,sbReq:db.req,djenId:'111',dueAt:'2026-10-20',humanId:'advogado',integrityKey:KEY,now:new Date()};
  await assert.rejects(DA.confirmDjenDeadline({...base,refreshCommunication:async()=>{throw new Error('DJEN fora do ar')}}),/mais de 36 horas e não consegui reler agora \(DJEN fora do ar\)[\s\S]*NÃO foi confirmado/);
  assert.equal(store.rows[0].prazoReal,undefined);
  await assert.rejects(DA.confirmDjenDeadline(base),/está velha/,'sem quem releia, a regra do frescor continua valendo');
  // Cancelada no Diário depois da nossa leitura: a releitura descobre e não deixa confirmar.
  const cancel={...deps.djenClientOptions,fetchImpl:async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({count:1,items:[{id:'111',numeroProcesso:'50000000020268130001',siglaTribunal:'TJMG',tipoComunicacao:'Intimação',dataDisponibilizacao:'2026-10-09',texto:db.tabela[0].texto,motivoCancelamento:'publicada por engano'}]})})};
  await assert.rejects(DA.confirmDjenDeadline({...base,refreshCommunication:row=>DM.refreshCommunication({sbReq:db.req,row,clientOptions:cancel})}),/cancelada/i);
  assert.equal(db.tabela[0].status,'cancelada');
});

// ---------------------------------------------------------------------------------------------
// Vigia do Diário: lê de 2 em 2 horas (6h–22h), avisa na hora e dá alarme se não leu até as 8h.
// ---------------------------------------------------------------------------------------------
const {createDjenVigia}=require('../lib/djen-vigia');
function vigiaCenario({falhar=false,oabs=[{oab:'123456',uf:'MG'}]}={}){
  const records=memRecords(),avisos=[],chamadas={sync:0,alerts:0,sugerir:0};
  let cursor=null,relogio=new Date('2026-10-13T09:00:00Z'); // 06h em Brasília
  const sbReq=async(method,table)=>{
    if(table==='djen_sync_state')return{ok:true,status:200,body:cursor?[{numero_oab:'123456',uf_oab:'MG',last_success_at:cursor}]:[]};
    return{ok:true,status:200,body:[]};
  };
  const vigia=createDjenVigia({records,sbReq,processStore:memStore([]),oabs:()=>oabs,
    syncDjen:async({now})=>{chamadas.sync++;if(falhar)throw new Error('DJEN 403');cursor=now.toISOString();return{ok:true,casadas:1,orfas:0,cunhar:[{djen_id:'1'}]}},
    alertsTick:async()=>{chamadas.alerts++},sugerir:async()=>{chamadas.sugerir++},
    notify:async t=>{avisos.push(t);return true},now:()=>relogio});
  return{vigia,records,avisos,chamadas,set falhar(v){falhar=v},avancar(h){relogio=new Date(relogio.getTime()+h*3600000)},get cursor(){return cursor}};
}

test('vigia lê o Diário de 2 em 2 horas e avisa na hora o que chegou (com sugestão de prazo)',async()=>{
  const c=vigiaCenario();
  assert.equal((await c.vigia.tick()).leu,true);
  assert.deepEqual([c.chamadas.sync,c.chamadas.alerts,c.chamadas.sugerir],[1,1,1]);
  c.avancar(0.5);assert.equal((await c.vigia.tick()).leu,false,'30 min depois não relê');
  assert.equal(c.chamadas.alerts,2,'mas confere os avisos a cada rodada: o que falhou na entrega ou ficou para trás sai em até 30 min');
  c.avancar(1.5);assert.equal((await c.vigia.tick()).leu,true,'2 horas depois relê');
  assert.equal(c.chamadas.sync,2);assert.equal(c.avisos.length,0,'lido em dia: nenhum alarme');
  c.avancar(15);assert.equal((await c.vigia.tick()).skipped,'fora_horario','23h: não lê de madrugada');
  const sem=vigiaCenario({oabs:[]});assert.equal((await sem.vigia.tick()).skipped,'sem_oab');
});

test('alarme: Diário de hoje não lido até as 8h avisa UMA vez; quando volta a ler, avisa que normalizou',async()=>{
  const c=vigiaCenario({falhar:true});
  await c.vigia.tick(); // 6h: falha, ainda não é hora do alarme
  assert.equal(c.avisos.length,0);
  c.avancar(2);await c.vigia.tick(); // 8h: falha de novo → alarme
  assert.equal(c.avisos.length,1);
  assert.match(c.avisos[0],/o Diário \(DJEN\) de hoje ainda NÃO foi lido[\s\S]*DJEN 403[\s\S]*comunica\.pje\.jus\.br/);
  c.avancar(0.5);await c.vigia.tick();assert.equal(c.avisos.length,1,'não repete o alarme no mesmo dia');
  c.falhar=false;c.avancar(2);await c.vigia.tick();
  assert.equal(c.avisos.length,2);assert.match(c.avisos[1],/Diário de hoje foi lido às/);
  c.avancar(2);await c.vigia.tick();assert.equal(c.avisos.length,2);
});

test('aviso que entra depois do resumo do dia sai na próxima janela (antes esperava o dia seguinte), uma vez só',async()=>{
  const {NotificationDigest}=require('../lib/notification-digest');
  const records=memRecords(),sent=[];
  const d=new NotificationDigest(records,async(text)=>{sent.push(text);return true});
  const manha=new Date('2026-10-13T11:00:00Z'),tarde=new Date('2026-10-13T15:00:00Z');
  await d.enqueue('Primeiro aviso','admin');await d.flush('admin',[],{now:manha});
  await d.enqueue('Aviso das 10h','admin');await d.flush('admin',[],{now:tarde});
  assert.equal(sent.length,2);assert.match(sent[1],/Avisos desde o último resumo[\s\S]*Aviso das 10h/);assert.doesNotMatch(sent[1],/Primeiro aviso/);
  await d.flush('admin',[],{now:tarde});assert.equal(sent.length,2,'sem repetir');
  // Envio incerto não é repetido automaticamente.
  const r2=memRecords(),s2=[];
  const e=new NotificationDigest(r2,async t=>{s2.push(t);if(s2.length>1)throw new Error('timeout');return true});
  await e.enqueue('A','admin');await e.flush('admin',[],{now:manha});
  await e.enqueue('B','admin');await e.flush('admin',[],{now:tarde});await e.flush('admin',[],{now:tarde});
  assert.equal(s2.length,2);
});

test('servidor: aviso de PRAZOS sai na hora (não espera o resumo) e a vigia do Diário é ligada',()=>{
  const i=bot.indexOf('const deadlineScheduler=createDeadlineScheduler({');
  const sched=bot.slice(i,bot.indexOf('\n});\n',i));
  assert.match(sched,/notify:async text=>\{const ok=await avisarTitular\(text\)/,'aviso imediato pelos canais');
  assert.match(sched,/if\(!ok\)await notificationDigest\.enqueue/,'sem canal, não se perde: vai para o resumo');
  assert.match(bot,/require\('\.\/lib\/djen-vigia'\)\.createDjenVigia\(/);
  assert.match(bot,/\ndjenVigia\.start\(\);\n/);
});
