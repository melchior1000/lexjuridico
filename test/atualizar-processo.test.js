'use strict';
// "Atualize o processo X": sem PJe ligado, o LEX lê o Datajud (dizendo o atraso dele) em vez de
// parar; sem nenhuma fonte, diz que não consultou (ok:false). Achar processo pelo número citado
// no cadastro; número digitado errado não vira outro processo. Auditoria de 13/10/2026.
const test=require('node:test');
const assert=require('node:assert/strict');
const LexTools=require('../lib/lex-tools');
const {resolveCase}=require('../lib/task-engine');
const {cnjCheckDigits,formatCnj}=require('../lib/carteira-audit');

const KEY='chave-de-teste-com-tamanho-suficiente-1234567890';
function cnj(seq,jtr='813',orig='0704',ano='2026'){const base=String(seq).padStart(7,'0');const sem=base+'00'+ano+jtr+orig;return formatCnj(base+cnjCheckDigits(sem)+ano+jtr+orig)}
function store(initial){let processes=structuredClone(initial);return{get rows(){return processes},async read(){return{processes:structuredClone(processes),version:1}},async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return{value,processes:structuredClone(processes),version:2}}}}
const resposta=hits=>({ok:true,status:200,text:async()=>JSON.stringify({hits:{hits}})});

test('sem PJe, "atualize este processo" lê o Datajud e diz que é a base pública (com atraso)',async()=>{
  const db=store([{id:'p1',numero:cnj(2001),andamentos:[]}]);
  const deps={processStore:db,pje:null,datajudApiKey:'k',integrityKey:KEY,fetchImpl:async()=>resposta([{_source:{movimentos:[{nome:'Juntada de petição',dataHora:'2026-10-10T14:00:00.000Z'}]}}])};
  const r=await LexTools.executar('atualizar_no_tribunal',{processo_id:'p1'},deps,{profile:'admin'});
  assert.equal(r.ok,true);assert.match(r.texto,/Datajud/);assert.match(r.texto,/1 andamento\(s\) novo\(s\)/);assert.match(r.texto,/pode atrasar/);
  assert.equal(db.rows[0].andamentos.length,1);
});

test('sem nenhuma fonte ligada, ou número que o Datajud não acha: ok:false e a verdade na mensagem',async()=>{
  const db=store([{id:'p1',numero:cnj(2002),andamentos:[]}]);
  const semNada=await LexTools.executar('atualizar_no_tribunal',{processo_id:'p1'},{processStore:db,pje:null,datajudApiKey:''},{profile:'admin'});
  assert.equal(semNada.ok,false);assert.match(semNada.texto,/não consigo consultar o tribunal agora/);
  const naoAchou=await LexTools.executar('atualizar_no_tribunal',{processo_id:'p1'},{processStore:db,pje:null,datajudApiKey:'k',integrityKey:KEY,fetchImpl:async()=>resposta([])},{profile:'admin'});
  assert.equal(naoAchou.ok,false);assert.match(naoAchou.texto,/não encontrou este número/);
});

test('busca pelo número acha o processo também pelo número citado no cadastro; CNJ errado não vira outro processo',async()=>{
  const A=cnj(2003),B=cnj(2004);
  const deps={processStore:store([{id:'a',nome:'Maria x Banco',numero:A+' / Embargos '+B,andamentos:[]}])};
  const r=await LexTools.executar('consultar_processos',{busca:B},deps,{profile:'admin'});
  assert.equal(r.total,1);assert.equal(r.processos[0].id,'a');
  const errado=A.slice(0,8)+(A[8]==='0'?'1':'0')+A.slice(9); // dígito verificador trocado
  const res=resolveCase([{id:'a',nome:'Maria x Banco',numero:A}],{instrucao:'faça a contestação do processo '+errado+' da Maria'});
  assert.equal(res.process,undefined,'não escolhe processo parecido');assert.match(res.reason,/Não encontrei o processo/);
});

test('servidor: a varredura antiga usa a leitura nova do Datajud e o endereço certo de cada tribunal',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  const ini=src.indexOf('function _extrairTribunalDoProcesso(');
  const c=vm.createContext({Datajud:require('../lib/datajud'),primaryCnj:require('../lib/pje-sync').primaryCnj});
  vm.runInContext(src.slice(ini,src.indexOf('\n}\n',ini)+2),c);
  assert.equal(c._extrairTribunalDoProcesso(cnj(1,'807','0001')),'tjdft','8.07 é o TJDFT (o mapa antigo dizia TJES)');
  assert.equal(c._extrairTribunalDoProcesso(cnj(1,'804','0001')),'tjam','8.04 é o TJAM (o mapa antigo dizia TJPE)');
  assert.equal(c._extrairTribunalDoProcesso(cnj(1,'813','0704')+' / Embargos '+cnj(2,'813','0704')),'tjmg','cadastro com mais de um número: vale o principal');
  assert.equal(c._extrairTribunalDoProcesso('A confirmar'),null);
  const varre=src.slice(src.indexOf('async function _varrerAndamentosPjeAgora('),src.indexOf('\n}\n',src.indexOf('async function _varrerAndamentosPjeAgora(')));
  assert.match(varre,/syncRegistered\(/);assert.doesNotMatch(varre,/_buscarAndamentosDatajud\(/);
});

test('PJe ligado mas sem o tribunal do processo: lê pelo Datajud e diz por quê',async()=>{
  const db=store([{id:'p1',nome:'Maria x Banco',numero:cnj(2005),andamentos:[]}]);
  const pje={config:{configurado:true,tribunais:[{sigla:'TJSP'}]},client:{tribunais:()=>['TJSP'],consultarProcesso:async()=>{throw new Error('não devia consultar')}}};
  const deps={processStore:db,pje,datajudApiKey:'k',integrityKey:KEY,fetchImpl:async()=>resposta([{_source:{movimentos:[{nome:'Conclusos para decisão',dataHora:'2026-10-11T10:00:00.000Z'}]}}])};
  const r=await LexTools.executar('atualizar_no_tribunal',{processo_id:'p1'},deps,{profile:'admin'});
  assert.equal(r.ok,true);assert.equal(r.fonte,'datajud');
  assert.match(r.texto,/PJe ligado não cobre o tribunal deste processo \(TJMG\)/);
  assert.match(r.texto,/• 11\/10\/2026 — Conclusos para decisão/);
});

test('o que a IA vê do processo: quando e por onde o tribunal foi lido, e se o Datajud não achou',async()=>{
  const A=cnj(2006),B=cnj(2007);
  const db=store([
    {id:'a',nome:'Maria x Banco',numero:A,last_court_sync_at:'2026-10-13T12:00:00.000Z',last_court_sync_source:'datajud',andamentos:[]},
    {id:'b',nome:'João x Loja',numero:B,datajud_nao_encontrado_em:'2026-10-13T11:30:00.000Z',andamentos:[]},
    {id:'c',nome:'Agravo',numero:'A confirmar — vinculado a '+A,andamentos:[]}]);
  const v=await LexTools.executar('ver_processo',{processo_id:'a'},{processStore:db},{profile:'admin'});
  assert.equal(v.processo.leitura_oficial,'13/10/2026 09:00 (Brasília), pelo Datajud');
  const w=await LexTools.executar('ver_processo',{processo_id:'b'},{processStore:db},{profile:'admin'});
  assert.equal(w.processo.leitura_oficial,null,'sem leitura: não diz "atualizado"');
  assert.match(w.processo.datajud_nao_encontrou,/13\/10\/2026 08:30, Brasília/);
  const busca=await LexTools.executar('consultar_processos',{busca:A},{processStore:db},{profile:'admin'});
  assert.equal(busca.total,1);assert.equal(busca.processos[0].id,'a');
  assert.deepEqual(busca.citado_em.map(x=>x.id),['c'],'o cadastro que só cita o número vem à parte');
  const so=await LexTools.executar('consultar_processos',{busca:cnj(2099)},{processStore:store([{id:'c',nome:'Agravo',numero:'A confirmar — vinculado a '+cnj(2099),andamentos:[]}])},{profile:'admin'});
  assert.equal(so.total,0);assert.match(so.observacao,/só o citam/);
});

test('"andamento do processo" sem IA avisa quando o Datajud não achou o número',async()=>{
  const {executeOfficeQuery}=require('../lib/office-queries');
  const p={id:'b',nome:'João x Loja',numero:cnj(2008),datajud_nao_encontrado_em:'2026-10-13T11:30:00.000Z',andamentos:[]};
  const out=await executeOfficeQuery({processStore:{read:async()=>({processes:[p]})}},{action:'process_status',processo_id:'b'},{now:new Date('2026-10-13T13:00:00Z'),profile:'admin'});
  assert.match(out.message,/O Datajud não encontrou este número na última tentativa \(13\/10\/2026 08:30, Brasília\)/);
});

test('ordem natural "consultar andamentos" pelo executor: número não achado não vira "0 novo(s)"',()=>{
  const {commandResponse}=require('../lib/office-command');
  const msg=commandResponse({action:'datajud'},{ok:false,nao_encontrado:true,error:'O Datajud não encontrou este número (pode ser segredo de justiça, número ou tribunal a conferir, ou processo ainda não indexado).'});
  assert.match(msg,/não encontrou este número/);assert.match(msg,/Nenhum andamento foi importado/);assert.doesNotMatch(msg,/Datajud consultado/);
  assert.match(commandResponse({action:'datajud'},{ok:true,novos:2,duplicados:5}),/2 movimento\(s\) novo\(s\)[\s\S]*pode atrasar/);
});

test('sem a chave que assina a leitura, nem a chave do Datajud: não gasta consulta',async()=>{
  const Datajud=require('../lib/datajud');
  const db=store([{id:'p1',numero:cnj(2009),andamentos:[]}]);
  let chamadas=0;const fetchImpl=async()=>{chamadas++;return resposta([])};
  await assert.rejects(Datajud.syncProcess(db,'p1',{apiKey:'k',integrityKey:'curta',fetchImpl}),/COURT_READING_INTEGRITY_KEY/);
  await assert.rejects(Datajud.syncProcess(db,'p1',{apiKey:'',integrityKey:KEY,fetchImpl}),/DATAJUD_API_KEY não configurada/);
  const lote=await Datajud.syncRegistered(db,{apiKey:'',integrityKey:KEY,fetchImpl});
  assert.equal(lote.skipped,true);assert.equal(lote.reason,'DATAJUD_API_KEY_NOT_CONFIGURED');
  assert.equal(chamadas,0);
  // Resposta sem a lista de resultados é falha de consulta, não "processo não encontrado".
  await assert.rejects(Datajud.queryByCnj(cnj(2009),{apiKey:'k',fetchImpl:async()=>({ok:true,status:200,text:async()=>'{"error":{"type":"security_exception"}}'})}),/não confirmou a consulta/);
});

test('servidor: "Verificar andamentos" mostra o resultado real da leitura (e o erro, quando não leu)',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  const rota=src.slice(src.indexOf("if(url==='/api/pje/sincronizar'"),src.indexOf('// GET /api/relatorio'));
  assert.match(rota,/nao_encontrados:varredura\.nao_encontrados/);assert.match(rota,/erro:varredura\.erro\|\|null/);
  assert.match(rota,/Andamentos\.ultimoAndamento\(p\)/,'último andamento pela data real');
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const tela=html.slice(html.indexOf('async function verificarAndamentosAgora('),html.indexOf('function verNoPje('));
  assert.match(tela,/d\.ok===false && d\.erro/);
  const vm=require('node:vm');
  const base=fs.readFileSync(path.join(__dirname,'..','office-ui-base.js'),'utf8');
  const fn=base.slice(base.indexOf('async function lexQueryPublic('),base.indexOf('\n',base.indexOf('async function lexQueryPublic(')));
  const run=async d=>{const el={textContent:''};const c=vm.createContext({document:{getElementById:()=>el},lexApi:async()=>d});vm.runInContext(fn,c);await c.lexQueryPublic();return el.textContent};
  return Promise.all([run({ok:false,erro:'Consulta pública Datajud não configurada (DATAJUD_API_KEY): nada foi consultado.'}),run({ok:true,resumo:'Monitorados: 12 | Novidades: 3'})]).then(([a,b])=>{
    assert.match(a,/nada foi consultado/);assert.doesNotMatch(a,/Consulta concluída/);
    assert.match(b,/Monitorados: 12 \| Novidades: 3/);assert.match(b,/pode atrasar/);
  });
});
