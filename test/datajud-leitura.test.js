'use strict';
// Leitura do Datajud (auditoria de 13/10/2026): não achar o processo NÃO é "nada mudou";
// complemento pelo nome; todos os registros (1º e 2º grau); o mais novo é o último; endereço
// certo para TRE-DF e TSE; resposta guardada uma vez; carteira lida uma vez por CNJ principal.
const test=require('node:test');
const assert=require('node:assert/strict');
const Datajud=require('../lib/datajud');
const {cnjCheckDigits,formatCnj}=require('../lib/carteira-audit');

const KEY='chave-de-teste-com-tamanho-suficiente-1234567890';
function cnj(seq,jtr='813',orig='0704',ano='2026'){const base=String(seq).padStart(7,'0');const sem=base+'00'+ano+jtr+orig;return formatCnj(base+cnjCheckDigits(sem)+ano+jtr+orig)}
function store(initial){
  let processes=structuredClone(initial);
  return{get rows(){return processes},
    async read(){return{processes:structuredClone(processes),version:1}},
    async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return{value,processes:structuredClone(processes),version:2}}};
}
const resposta=hits=>({ok:true,status:200,text:async()=>JSON.stringify({hits:{hits}})});
const mov=(nome,dataHora,comps=[])=>({nome,dataHora,codigo:1,complementosTabelados:comps});

test('processo que o Datajud não acha (segredo de justiça, número ou tribunal errado) não vira "sem movimentação"',async()=>{
  const db=store([{id:'p1',numero:cnj(1001),andamentos:[{data:'12/10/2026',txt:'Anotação'}]}]);
  const r=await Datajud.syncProcess(db,'p1',{apiKey:'k',fetchImpl:async()=>resposta([]),integrityKey:KEY});
  assert.equal(r.ok,false);assert.equal(r.nao_encontrado,true);assert.equal(r.explicit_no_change,false);
  const p=db.rows[0];
  assert.equal(p.last_court_sync_at,undefined,'não conta como leitura oficial recente');assert.equal(p.datajud_atualizado_em,undefined);
  assert.ok(p.datajud_nao_encontrado_em,'fica registrado que o Datajud não achou');
  assert.equal(p.andamentos.length,1);
  const lote=await Datajud.syncRegistered(store([{id:'a',numero:cnj(1002),andamentos:[]}]),{apiKey:'k',fetchImpl:async()=>resposta([]),integrityKey:KEY});
  assert.equal(lote.nao_encontrados,1);assert.equal(lote.erros,0,'não achar não é erro de conexão');
});

test('complemento pelo nome; movimentos de todos os registros, sem repetir; o último movimento é o mais novo',async()=>{
  const g1={_source:{grau:'G1',movimentos:[mov('Distribuição','2019-05-20T09:00:00.000Z',[{codigo:2,valor:1,nome:'sorteio',descricao:'tipo_de_distribuicao_redistribuicao'}]),
    mov('Expedição de documento','2026-10-10T14:06:24.000Z',[{codigo:4,valor:80,nome:'Intimação',descricao:'tipo_de_documento'}])]}};
  const g2={_source:{grau:'G2',movimentos:[mov('Conclusos para julgamento','2026-10-12T16:00:00.000Z'),mov('Expedição de documento','2026-10-10T14:06:24.000Z',[{codigo:4,valor:80,nome:'Intimação',descricao:'tipo_de_documento'}])]}};
  let corpo=null;
  const db=store([{id:'p1',numero:cnj(1003),andamentos:[]}]);
  const r=await Datajud.syncProcess(db,'p1',{apiKey:'k',integrityKey:KEY,fetchImpl:async(url,o)=>{corpo=JSON.parse(o.body);return resposta([g1,g2])}});
  assert.ok(corpo.size>=10,'pede todos os registros do número (1º e 2º grau)');
  const txt=db.rows[0].andamentos.map(a=>a.txt);
  assert.deepEqual(txt,['[DATAJUD] Conclusos para julgamento','[DATAJUD] Expedição de documento — Intimação','[DATAJUD] Distribuição — sorteio']);
  assert.match(String(r.reading.resultado?.ultimo_movimento?.texto||''),/Conclusos para julgamento/);
});

test('endereço do Datajud: TRE-DF é "tre-dft", TSE existe; STF e CNJ não têm base pública',()=>{
  assert.equal(Datajud.aliasForCnj(cnj(1,'607','0001')),'tre-dft');
  assert.equal(Datajud.aliasForCnj(cnj(1,'600','0001')),'tse');
  assert.equal(Datajud.aliasForCnj(cnj(1,'807','0001')),'tjdft');assert.equal(Datajud.aliasForCnj(cnj(1,'813','0704')),'tjmg');
  assert.throws(()=>Datajud.aliasForCnj(cnj(1,'100','0000')),/não tem base pública/);
});

test('resposta do tribunal guardada uma vez; leitura igual à anterior não guarda o corpo de novo',async()=>{
  const db=store([{id:'p1',numero:cnj(1004),andamentos:[]}]);
  const hits=[{_source:{movimentos:[mov('Juntada de petição','2026-10-10T14:06:24.000Z')]}}];
  const a=await Datajud.syncProcess(db,'p1',{apiKey:'k',integrityKey:KEY,fetchImpl:async()=>resposta(hits)});
  assert.ok(a.reading.recibo.raw_receipt,'a leitura completa volta para a prova do dia');
  const b=await Datajud.syncProcess(db,'p1',{apiKey:'k',integrityKey:KEY,fetchImpl:async()=>resposta(hits)});
  assert.ok(b.reading.recibo.raw_receipt);
  const [nova,antiga]=db.rows[0].court_readings;
  assert.equal(antiga.raw_receipt,undefined,'sem a cópia repetida da resposta');assert.ok(antiga.recibo.raw_receipt);
  assert.equal(nova.recibo.raw_receipt,undefined,'corpo igual ao anterior não é guardado de novo');
  assert.equal(nova.recibo.mesmo_corpo_de,antiga.reading_id);
  assert.equal(nova.integridade.response_hash,antiga.integridade.response_hash);
});

test('carteira: arquivado fica fora da leitura diária; número citado em outro cadastro não vira "duplicado"; sem chave de integridade não consulta',async()=>{
  const A=cnj(1005),B=cnj(1006);
  const db=store([{id:'a',numero:A+' / Embargos '+B,andamentos:[]},{id:'b',numero:B,andamentos:[]},{id:'arq',numero:cnj(1007),status:'ARQUIVADO',andamentos:[]}]);
  const urls=[];
  const r=await Datajud.syncRegistered(db,{apiKey:'k',integrityKey:KEY,fetchImpl:async(url,o)=>{urls.push(JSON.parse(o.body).query.match.numeroProcesso);return resposta([{_source:{movimentos:[mov('Juntada','2026-10-10T14:06:24.000Z')]}}])}});
  assert.equal(r.total,2,'o arquivado não é lido todo dia');assert.equal(r.erros,0,'B tem o próprio cadastro: não é CNJ duplicado');
  const semChave=[];
  const s=await Datajud.syncRegistered(db,{apiKey:'k',integrityKey:'',fetchImpl:async()=>{semChave.push(1);return resposta([])}});
  const envAntes=process.env.COURT_READING_INTEGRITY_KEY;
  assert.ok(envAntes===undefined||envAntes==='','ambiente de teste sem chave');
  assert.equal(semChave.length,0,'sem chave para assinar a leitura, não gasta consulta');
  assert.equal(s.skipped,true);assert.equal(s.reason,'COURT_READING_INTEGRITY_KEY_NOT_CONFIGURED');
});
