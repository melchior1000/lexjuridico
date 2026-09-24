'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Mni=require('../lib/pje-mni');
const Monitor=require('../lib/pje-monitor');
const {executeNaturalOfficeCommand}=require('../lib/office-routes');

const CNJ='5001234-56.2026.8.13.0704',CNJ_D='50012345620268130704';
const ENV={PJE_MNI_CPF:'123.456.789-09',PJE_MNI_SENHA:'s&nh<a>"x',PJE_MNI_TRIBUNAIS:'TJMG=https://pje.tjmg.jus.br/pje/intercomunicacao;TRF1=https://pje1g.trf1.jus.br/pje/intercomunicacao'};

// Resposta no formato do MNI 2.2.2 (prefixos variam entre tribunais).
function avisosXml(avisos,{sucesso=true,mensagem='Consulta realizada'}={}){
  return '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
    +'<ns4:consultarAvisosPendentesResposta xmlns:ns2="http://www.cnj.jus.br/intercomunicacao-2.2.2" xmlns:ns4="http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2">'
    +'<ns4:sucesso>'+sucesso+'</ns4:sucesso><ns4:mensagem>'+mensagem+'</ns4:mensagem>'
    +avisos.map(a=>'<ns4:aviso idAviso="'+a.id+'" tipoComunicacao="'+(a.tipo||'INT')+'" dataDisponibilizacao="'+a.data+'">'
      +'<ns2:destinatario><ns2:pessoa nome="Advogada Teste"/></ns2:destinatario>'
      +'<ns2:processo numero="'+a.cnj+'" classeProcessual="7" codigoLocalidade="0704" nivelSigilo="0">'
      +'<ns2:polo polo="AT"><ns2:parte><ns2:pessoa nome="Maria Silva"/></ns2:parte></ns2:polo>'
      +'<ns2:orgaoJulgador codigoOrgao="1" nomeOrgao="1ª Vara Cível de Uberaba" instancia="ORIG"/>'
      +'</ns2:processo></ns4:aviso>').join('')
    +'</ns4:consultarAvisosPendentesResposta></soap:Body></soap:Envelope>';
}
function teorXml(texto){
  return '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns4:consultarTeorComunicacaoResposta xmlns:ns4="x" xmlns:ns2="y">'
    +'<ns4:sucesso>true</ns4:sucesso><ns4:mensagem>ok</ns4:mensagem>'
    +'<ns4:comunicacao id="77" tipoComunicacao="INT"><ns2:teor>'+texto+'</ns2:teor><ns2:documento idDocumento="9" tipoDocumento="58" descricao="Despacho" mimetype="application/pdf"/></ns4:comunicacao>'
    +'</ns4:consultarTeorComunicacaoResposta></soap:Body></soap:Envelope>';
}
function fakeTransport(responses){
  const calls=[];
  const send=async(endpoint,xml)=>{
    const op=(xml.match(/<ser:(\w+)>/)||[])[1];calls.push({endpoint,op,xml});
    const r=typeof responses==='function'?responses(endpoint,op,xml):responses[op];
    if(r instanceof Error)throw r;
    return{status:200,body:r};
  };
  send.calls=calls;return send;
}
function memoryRecords(){
  const rows=new Map();
  return{rows,async read(k){return rows.has(k)?{value:structuredClone(rows.get(k))}:null},async change(k,fn){const v=fn(rows.has(k)?structuredClone(rows.get(k)):null);rows.set(k,structuredClone(v));return v},async list(){return[]}};
}
function processStore(rows){
  let data=structuredClone(rows);
  return{async read(){return{processes:structuredClone(data)}},async mutate(fn,actor){const draft=structuredClone(data);const value=fn(draft);data=draft;return{value}},snapshot:()=>data};
}

test('configuração exige HTTPS .jus.br e não aceita tribunal repetido',()=>{
  assert.deepEqual(Mni.parseTribunais(ENV.PJE_MNI_TRIBUNAIS).map(t=>t.sigla),['TJMG','TRF1']);
  assert.throws(()=>Mni.parseTribunais('TJMG=http://pje.tjmg.jus.br/x'),/HTTPS/);
  assert.throws(()=>Mni.parseTribunais('TJMG=https://coletor.exemplo.com/x'),/jus\.br/);
  assert.throws(()=>Mni.parseTribunais('TJMG=https://a.jus.br/x;TJMG=https://b.jus.br/y'),/repetido/);
  const cfg=Mni.mniConfig(ENV);
  assert.equal(cfg.configurado,true);
  assert.equal(cfg.credenciais.cpf,'12345678909');
  assert.deepEqual(Mni.mniConfig({}).faltando,['PJE_MNI_CPF','PJE_MNI_SENHA','PJE_MNI_TRIBUNAIS']);
});

test('envelope escapa a senha e consulta de processo nunca pede documentos',async()=>{
  const xml=Mni.envelope('consultarAvisosPendentes',[['idConsultante','1'],['senhaConsultante','s&nh<a>"x']]);
  assert.match(xml,/<tip:senhaConsultante>s&amp;nh&lt;a&gt;&quot;x<\/tip:senhaConsultante>/);
  assert.match(xml,/xmlns:ser="http:\/\/www\.cnj\.jus\.br\/servico-intercomunicacao-2\.2\.2\/"/);
  const send=fakeTransport({consultarProcesso:'<Envelope><Body><consultarProcessoResposta><sucesso>true</sucesso><processo><dadosBasicos numero="'+CNJ_D+'"/><movimento dataHora="20260920101500" identificadorMovimento="1"><movimentoLocal descricao="Juntada de petição"/></movimento></processo></consultarProcessoResposta></Body></Envelope>'});
  const client=Mni.createMniClient(Mni.mniConfig(ENV),{transport:send});
  const out=await client.consultarProcesso('TJMG',CNJ);
  assert.match(send.calls[0].xml,/<tip:incluirDocumentos>false<\/tip:incluirDocumentos>/);
  assert.equal(out.movimentos[0].descricao,'Juntada de petição');
  assert.equal(out.movimentos[0].data,'2026-09-20T13:15:00.000Z');
});

test('avisos pendentes são lidos em qualquer prefixo de namespace',()=>{
  const out=Mni.parseAvisos(avisosXml([{id:'1001',tipo:'CIT',data:'20260920101500',cnj:CNJ_D}]));
  assert.equal(out.avisos.length,1);
  const a=out.avisos[0];
  assert.equal(a.id_aviso,'1001');assert.equal(a.tipo_descricao,'Citação');assert.equal(a.cnj,CNJ_D);
  assert.equal(a.orgao,'1ª Vara Cível de Uberaba');assert.equal(a.disponibilizado_em,'2026-09-20T13:15:00.000Z');
  assert.deepEqual(a.polos,[{polo:'AT',partes:['Maria Silva']}]);
});

test('falhas do tribunal falham fechado e não vazam a senha',async()=>{
  assert.throws(()=>Mni.parseAvisos(avisosXml([],{sucesso:false,mensagem:'Usuário ou senha inválidos'})),e=>e.code==='autenticacao');
  const fault='<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Server</faultcode><faultstring>Erro interno</faultstring></s:Fault></s:Body></s:Envelope>';
  assert.throws(()=>Mni.parseAvisos(fault),e=>e.code==='falha_soap');
  assert.throws(()=>Mni.parseAvisos('<html>manutenção</html>'),e=>e.code==='resposta_invalida');
  assert.throws(()=>Mni.parseAvisos(avisosXml([{id:'',data:'20260920101500',cnj:CNJ_D}])),/sem identificador/);
  const client=Mni.createMniClient(Mni.mniConfig(ENV),{transport:fakeTransport({consultarAvisosPendentes:new Mni.MniError('rede','Sem conexão com o tribunal (ECONNRESET).')})});
  await assert.rejects(client.consultarAvisosPendentes('TJMG'),e=>!String(e.message).includes(ENV.PJE_MNI_SENHA));
  await assert.rejects(Mni.createMniClient(Mni.mniConfig({}),{transport:fakeTransport({})}).consultarAvisosPendentes('TJMG'),e=>e.code==='nao_configurado');
});

test('abrir teor (dá ciência) exige autorização do advogado para aquele aviso',async()=>{
  const send=fakeTransport({consultarTeorComunicacao:teorXml('Intime-se.')});
  const client=Mni.createMniClient(Mni.mniConfig(ENV),{transport:send});
  const now=new Date().toISOString();
  await assert.rejects(client.consultarTeorComunicacao('TJMG',{cnj:CNJ,idAviso:'1'}),e=>e.code==='sem_autorizacao');
  await assert.rejects(client.consultarTeorComunicacao('TJMG',{cnj:CNJ,idAviso:'1'},{confirmado:true,sigla:'TJMG',id_aviso:'2',perfil:'advogado',em:now}),e=>e.code==='sem_autorizacao');
  await assert.rejects(client.consultarTeorComunicacao('TJMG',{cnj:CNJ,idAviso:'1'},{confirmado:true,sigla:'TJMG',id_aviso:'1',perfil:'secretaria',em:now}),e=>e.code==='sem_autorizacao');
  await assert.rejects(client.consultarTeorComunicacao('TJMG',{cnj:CNJ,idAviso:'1'},{confirmado:true,sigla:'TJMG',id_aviso:'1',perfil:'advogado',em:new Date(Date.now()-11*60000).toISOString()}),e=>e.code==='sem_autorizacao');
  assert.equal(send.calls.length,0,'nenhuma chamada ao tribunal sem autorização válida');
  const out=await client.consultarTeorComunicacao('TJMG',{cnj:CNJ,idAviso:'1'},{confirmado:true,sigla:'TJMG',id_aviso:'1',perfil:'advogado',em:now});
  assert.equal(out.comunicacoes[0].teor,'Intime-se.');
  assert.match(send.calls[0].xml,/<tip:identificadorAviso>1<\/tip:identificadorAviso>/);
});

test('ciência tácita: 23:59:59 de Brasília do 10º dia corrido após o envio',()=>{
  assert.deepEqual(Monitor.tacitCiencia('2026-09-20T13:15:00.000Z'),{data:'2026-09-30',em:'2026-10-01T02:59:59.000Z'});
  // Envio às 22h de Brasília ainda conta como dia 20.
  assert.equal(Monitor.tacitCiencia('2026-09-21T01:00:00.000Z').data,'2026-09-30');
  assert.equal(Monitor.tacitCiencia(null),null);
});

test('vigia grava, casa CNJ, marca órfão e NUNCA abre teor',async()=>{
  const records=memoryRecords();
  const store=processStore([{id:'p1',nome:'Maria Silva x Banco',numero:CNJ}]);
  let round=1;
  const send=fakeTransport((endpoint,op)=>{
    assert.notEqual(op,'consultarTeorComunicacao','a vigia não pode dar ciência');
    if(endpoint.includes('trf1'))return round===1?avisosXml([]):new Mni.MniError('timeout','O tribunal não respondeu a tempo.');
    return round===1
      ?avisosXml([{id:'1',data:'20260920101500',cnj:CNJ_D},{id:'2',tipo:'CIT',data:'20260922090000',cnj:'00000000000000000000'}])
      :avisosXml([{id:'2',tipo:'CIT',data:'20260922090000',cnj:'00000000000000000000'}]);
  });
  const client=Mni.createMniClient(Mni.mniConfig(ENV),{transport:send});
  const now=new Date('2026-09-24T13:00:00Z');
  const first=await Monitor.syncPjeAvisos({client,records,processStore:store,now});
  assert.equal(first.ok,true);assert.equal(first.novos.length,2);
  const st=records.rows.get('lex_pje_avisos_TJMG');
  assert.equal(st.avisos['1'].processo_id,'p1');assert.equal(st.avisos['1'].ciencia_tacita_data,'2026-09-30');
  assert.equal(st.avisos['2'].vinculo,'sem_processo');
  round=2;
  const second=await Monitor.syncPjeAvisos({client,records,processStore:store,now:new Date('2026-09-24T15:00:00Z')});
  assert.equal(second.ok,false);assert.equal(second.novos.length,0);
  const after=records.rows.get('lex_pje_avisos_TJMG');
  assert.equal(after.avisos['1'].status,'nao_listado','aviso que sumiu não é tratado como resolvido');
  assert.equal(after.avisos['2'].status,'pendente');
  assert.equal(records.rows.get('lex_pje_avisos_TRF1').ultimo_erro.codigo,'timeout');
  assert.ok(send.calls.every(c=>c.op==='consultarAvisosPendentes'));
});

function pjeDeps(records,store,send,{configured=true}={}){
  const monitor=Monitor.createPjeMonitor({records,processStore:store,env:configured?ENV:{},transport:send,now:()=>new Date('2026-09-24T13:00:00Z')});
  return{processStore:store,records,engine:{async list(){return[]},async submit(){throw new Error('não')}},receptionStore:{async list(){return[]}},pje:monitor,log:()=>{}};
}
const say=(deps,text,profile='advogado')=>executeNaturalOfficeCommand(deps,{text,profile,now:new Date('2026-09-24T13:00:00Z')});

test('pelo WhatsApp: listar, pedir abertura (confirmação) e confirmar ciência',async()=>{
  const records=memoryRecords();
  const store=processStore([{id:'p1',nome:'Maria Silva x Banco',numero:CNJ,andamentos:[]}]);
  const send=fakeTransport(op=>null);
  const responses={consultarAvisosPendentes:avisosXml([{id:'1',data:'20260920101500',cnj:CNJ_D}]),consultarTeorComunicacao:teorXml('Fica a parte intimada para contestar.')};
  const transport=fakeTransport(responses);
  const deps=pjeDeps(records,store,transport);
  await Monitor.syncPjeAvisos({client:deps.pje.client,records,processStore:store,now:new Date('2026-09-24T13:00:00Z')});

  const list=await say(deps,'intimações do PJe');
  assert.match(list.message,/2 expediente\(s\) pendente\(s\) no PJe/,'mesmo número de aviso em dois tribunais');
  assert.match(list.message,/\[TJMG #1\] Intimação — Maria Silva x Banco/);
  assert.match(list.message,/ciência tácita em 30\/09\/2026 \(6 dias\)/);

  const ask=await say(deps,'abrir intimação TJMG #1');
  assert.equal(ask.needs_input,true);
  assert.match(ask.message,/REGISTRA A CIÊNCIA/);
  assert.match(ask.message,/CONFIRMO CIENCIA TJMG 1/);
  const ambiguous=await say(deps,'CONFIRMO CIENCIA 1');
  assert.match(ambiguous.message,/mais de um tribunal/);
  assert.ok(!transport.calls.some(c=>c.op==='consultarTeorComunicacao'),'pedir abertura não abre');

  const denied=await say(deps,'CONFIRMO CIENCIA TJMG 1','secretaria');
  assert.match(denied.message,/permissão/);
  assert.ok(!transport.calls.some(c=>c.op==='consultarTeorComunicacao'));

  const done=await say(deps,'Confirmo ciência TJMG 1');
  assert.match(done.message,/Ciência registrada no PJe \(TJMG #1\)/);
  assert.match(done.message,/Fica a parte intimada para contestar/);
  assert.match(done.message,/Andamento registrado no processo/);
  assert.equal(records.rows.get('lex_pje_avisos_TJMG').avisos['1'].status,'ciencia_dada');
  assert.match(store.snapshot()[0].andamentos[0].txt,/^\[PJe\] Ciência de intimação registrada via LEX/);

  const again=await say(deps,'CONFIRMO CIENCIA TJMG 1');
  assert.match(again.message,/não está mais pendente/);
  assert.equal(transport.calls.filter(c=>c.op==='consultarTeorComunicacao').length,1,'ciência não é repetida');
});

test('"tem intimação nova?" junta DJEN e PJe; sem configuração, avisa com clareza',async()=>{
  const records=memoryRecords(),store=processStore([]);
  const transport=fakeTransport({consultarAvisosPendentes:avisosXml([{id:'5',tipo:'CIT',data:'20260923090000',cnj:CNJ_D}])});
  const deps=pjeDeps(records,store,transport);
  await Monitor.syncPjeAvisos({client:deps.pje.client,records,processStore:store,now:new Date('2026-09-24T13:00:00Z')});
  const sbReq=async()=>({ok:true,status:200,body:[]});
  const out=await executeNaturalOfficeCommand({...deps,sbReq},{text:'tem intimação nova?',profile:'secretaria',now:new Date('2026-09-24T13:00:00Z')});
  assert.match(out.message,/— PJe —/);
  assert.match(out.message,/processo NÃO cadastrado no LEX/);
  const off=pjeDeps(memoryRecords(),store,transport,{configured:false});
  const msg=await say(off,'intimações do PJe');
  assert.match(msg.message,/ainda não está conectado/);
});

test('vigia avisa expedientes novos uma vez e respeita o horário',async()=>{
  const records=memoryRecords(),store=processStore([]),sent=[];
  const transport=fakeTransport({consultarAvisosPendentes:avisosXml([{id:'8',data:'20260923090000',cnj:CNJ_D}])});
  const mk=iso=>Monitor.createPjeMonitor({records,processStore:store,env:{...ENV,PJE_MNI_TRIBUNAIS:'TJMG=https://pje.tjmg.jus.br/pje/intercomunicacao'},transport,notify:async t=>sent.push(t),now:()=>new Date(iso)});
  assert.equal((await mk('2026-09-24T04:00:00Z').tick()).skipped,'fora_horario');
  await mk('2026-09-24T13:00:00Z').tick();
  await mk('2026-09-24T15:00:00Z').tick();
  assert.equal(sent.length,1);
  assert.match(sent[0],/1 novo\(s\) expediente\(s\)/);
  assert.match(sent[0],/Nada foi aberto/);
});

test('teste do PJe explica em português por que não conectou',async()=>{
  const M=require('../lib/pje-mni');
  const off=await M.diagnoseMni(null,{configurado:false,faltando:['PJE_MNI_SENHA']});
  assert.match(M.diagnoseMessage(off),/não está ligado ao LEX: faltam PJE_MNI_SENHA/);
  const client={tribunais:()=>['TJMG','TRF6'],async consultarAvisosPendentes(s){if(s==='TJMG')return{avisos:[{},{}]};throw new M.MniError('autenticacao','Tribunal recusou a consulta: usuário inválido')}};
  const d=await M.diagnoseMni(client,{configurado:true});
  assert.equal(d.ok,false);
  const msg=M.diagnoseMessage(d);
  assert.match(msg,/TJMG: conectado \(2 expediente/);
  assert.match(msg,/TRF6: não conectou — o tribunal recusou o CPF\/senha/);
});
