'use strict';
// Importar a carteira de uma planilha (Excel ou CSV): o LEX lê, confere cada número CNJ,
// conversa antes de gravar, não duplica e desfaz só o que ninguém trabalhou depois.
const test=require('node:test');
const assert=require('node:assert/strict');
const JSZip=require('jszip');
const {createCarteiraImport,lerPlanilha,analisar,ehPlanilha,campoDoCabecalho}=require('../lib/carteira-import');
const {cnjCheckDigits,formatCnj}=require('../lib/carteira-audit');
const LexTools=require('../lib/lex-tools');
const {parseOfficeQuery,executeOfficeQuery}=require('../lib/office-queries');

// Números CNJ válidos montados com o dígito verificador certo.
function cnj(seq,ano='2026',jtr='813',orig='0704'){const base=String(seq).padStart(7,'0');const sem=base+'00'+ano+jtr+orig;const dd=cnjCheckDigits(sem);return base+dd+ano+jtr+orig}
const A=cnj(5001234),B=cnj(5009999),C=cnj(1234),EXISTE=cnj(5004158,'2024');
const ERRADO=A.slice(0,7)+(A.slice(7,9)==='00'?'01':'00')+A.slice(9);

// Como o RecordStore real: change é atômico por chave (trava + versão); list é contada.
function records(){
  const map=new Map(),travas=new Map();let listas=0;
  return{map,get listas(){return listas},
    async read(k){return map.has(k)?{value:structuredClone(map.get(k))}:null},
    change(k,fn){
      const antes=travas.get(k)||Promise.resolve();
      const vez=antes.then(async()=>{const old=map.has(k)?structuredClone(map.get(k)):null;const next=await fn(old);if(next!==undefined)map.set(k,structuredClone(next));return next===undefined?old:structuredClone(next)});
      travas.set(k,vez.catch(()=>{}));return vez;
    },
    async list(prefix){listas++;return[...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>structuredClone(v)).filter(Boolean)}};
}
function carteira(rows){let ps=structuredClone(rows);return{async read(){return{processes:structuredClone(ps)}},async mutate(fn){const copy=structuredClone(ps);const value=await fn(copy);ps=copy;return{value}},get rows(){return ps},set rows(v){ps=v}}}
const ATUAL=[{id:'p1',nome:'Maria Souza · Ação',numero:formatCnj(EXISTE),status:'ATIVO'}];

const CSV=[
  'Nº do processo;Cliente;Telefone do cliente;Advogado responsável;Situação;Obs',
  formatCnj(A)+';"Silva, João";(61) 98888-7777;Dra. Ana;Ativo;cobrar honorários',
  formatCnj(EXISTE)+';Maria Souza;;;;',
  A+';João Silva;;;;repetido',
  formatCnj(ERRADO)+';Pedro;;;;',
  '5,00123E+19;Excel estragou;;;;',
  ';Cliente sem número;;;;',
  formatCnj(C).replace(/^0+/,'')+';Ana Lima;61977776666;;Arquivado;sem zeros iniciais',
  '',
  formatCnj(B)+';Carlos;;;;'
].join('\r\n');

test('lê CSV de sistema antigo: ponto e vírgula, aspas, colunas pelo nome e telefone que não vira cliente',async()=>{
  const leitura=await lerPlanilha(Buffer.from(CSV,'utf8'),'carteira.csv');
  assert.equal(leitura.formato,'csv');
  const a=analisar(leitura,ATUAL);
  assert.equal(a.ok,true);
  assert.deepEqual(Object.keys(a.colunas).sort(),['cliente','cnj','observacao','responsavel','status','whatsapp']);
  assert.equal(a.colunas.whatsapp,'Telefone do cliente');
  assert.equal(a.total_linhas,8,'linha vazia não conta');
  assert.deepEqual(a.novos.map(n=>n.cnj),[A,C,B]);
  assert.equal(a.novos[0].campos.cliente,'Silva, João');
  assert.equal(a.ja_existem.length,1);assert.equal(a.ja_existem[0].processo,'Maria Souza · Ação');
  assert.equal(a.repetidos.length,1);assert.equal(a.repetidos[0].primeira_linha,2);
  assert.equal(a.problemas.length,2);
  assert.match(a.problemas.find(p=>p.linha===5).motivo,/dígito verificador/);
  assert.match(a.problemas.find(p=>p.linha===6).motivo,/perdeu dígitos/);
  assert.equal(a.sem_numero.length,1);
});

test('lê Excel de verdade: textos compartilhados, texto em linha e número estragado na célula numérica',async()=>{
  const zip=new JSZip();
  zip.file('xl/workbook.xml','<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Processos" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml','<?xml version="1.0"?><sst><si><t>Número do Processo</t></si><si><t>Nome do cliente</t></si><si><t>'+formatCnj(A)+'</t></si><si><r><t>Maria </t></r><r><t>Rica</t></r></si></sst>');
  zip.file('xl/worksheets/sheet1.xml','<?xml version="1.0"?><worksheet><sheetData>'+
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'+
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>'+
    '<row r="3"><c r="A3"><v>5.0012345620268131E+19</v></c><c r="B3" t="inlineStr"><is><t>Numérico</t></is></c></row>'+
    '<row r="4"><c r="A4" t="inlineStr"><is><t>'+B+'</t></is></c><c r="C4"><v>12</v></c></row>'+
    '</sheetData></worksheet>');
  const buf=await zip.generateAsync({type:'nodebuffer'});
  const leitura=await lerPlanilha(buf,'carteira.xlsx');
  assert.equal(leitura.formato,'xlsx');assert.equal(leitura.aba,'Processos');
  const a=analisar(leitura,[]);
  assert.deepEqual(a.novos.map(n=>n.cnj),[A,B]);
  assert.equal(a.novos[0].campos.cliente,'Maria Rica');
  assert.equal(a.problemas.length,1);assert.match(a.problemas[0].motivo,/perdeu dígitos/);
});

test('sem cabeçalho, acha a coluna dos números pelo conteúdo; sem coluna de número, diz o que falta',async()=>{
  const semCab=Buffer.from(['João;'+formatCnj(A),'Maria;'+formatCnj(B)].join('\n'));
  const a=analisar(await lerPlanilha(semCab,'x.csv'),[]);
  assert.equal(a.ok,true);assert.equal(a.novos.length,2);
  const nada=analisar(await lerPlanilha(Buffer.from('Nome;Cidade\nJoão;Unaí\n'),'x.csv'),[]);
  assert.equal(nada.ok,false);assert.match(nada.motivo,/coluna com o número/);
  assert.equal(campoDoCabecalho('Celular do cliente'),'whatsapp');
  assert.equal(campoDoCabecalho('Nome da parte contrária'),'partes');
  assert.equal(campoDoCabecalho('Processo nº'),'cnj');
});

test('formato antigo do Excel e arquivo vazio recebem orientação clara',async()=>{
  await assert.rejects(lerPlanilha(Buffer.from('D0CF11E0','hex'),'velha.xls'),/Salvar como/);
  await assert.rejects(lerPlanilha(Buffer.alloc(0),'x.csv'),/vazio/);
  assert.equal(ehPlanilha('carteira.XLSX'),true);assert.equal(ehPlanilha('x.pdf'),false);assert.equal(ehPlanilha('arquivo','text/csv'),true);
});

function montar(opcoes={}){
  const rec=records(),store=carteira(ATUAL);
  let agora=Date.parse('2026-10-13T13:00:00Z');
  const I=createCarteiraImport({records:rec,processStore:store,now:()=>agora,...opcoes});
  return{I,rec,store,avancar(ms){agora+=ms}};
}

test('conversa antes de gravar; importa só com a ordem; a mesma planilha não vira duas importações',async()=>{
  const m=montar();
  const buf=Buffer.from(CSV,'utf8');
  assert.equal((await m.I.receber({buffer:buf,nome:'carteira.csv',perfil:'secretaria'})).ok,false);
  const r=await m.I.receber({buffer:buf,nome:'carteira.csv',perfil:'admin'});
  assert.equal(r.ok,true);
  assert.match(r.texto,/8 linhas com dados/);assert.match(r.texto,/3 processos novos, 1 já está no LEX, 1 repetido na própria planilha, 2 com número com problema, 1 sem número/);
  assert.match(r.texto,/linha 5 \(dígito verificador/);assert.match(r.texto,/WhatsApp: 2 celulares ligados aos processos\./);
  assert.match(r.texto,/Posso importar os 3\? \(é só dizer "pode importar"\)$/);
  assert.equal(m.store.rows.length,1,'ler não grava nada');
  const r2=await m.I.receber({buffer:buf,nome:'carteira.csv',perfil:'admin'});
  assert.equal(r2.id,r.id,'mesmo arquivo, mesma importação');
  const imp=await m.I.importar({perfil:'admin'});
  assert.equal(imp.ok,true);assert.equal(imp.resumo.criados,3);assert.match(imp.texto,/Importei 3 processos/);
  const novos=m.store.rows.filter(p=>p.origem_cadastro==='importacao');
  assert.equal(novos.length,3);
  const joao=novos.find(p=>p.numero===formatCnj(A));
  assert.equal(joao.cliente,'Silva, João');assert.equal(joao.cliente_whatsapp,'5561988887777');assert.equal(joao.responsavel,'Dra. Ana');
  assert.equal(joao.cadastro_conferido,'sem_conferencia');assert.equal(joao.status,'ATIVO');assert.equal(joao.descricao,'cobrar honorários');
  assert.equal(novos.find(p=>p.numero===formatCnj(C)).status,'ARQUIVADO','situação "Arquivado" da planilha é respeitada');
  assert.equal((await m.I.importar({id:r.id,perfil:'admin'})).ja_importada,true);
  assert.equal(m.store.rows.length,4,'importar de novo não duplica');
  const r3=await m.I.receber({buffer:buf,nome:'carteira.csv',perfil:'admin'});
  assert.equal(r3.ja_importada,true);assert.match(r3.texto,/já foi importada/);
});

test('processo que entrou por outro caminho entre a leitura e a ordem não é duplicado',async()=>{
  const m=montar();
  await m.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  m.store.rows=[...m.store.rows,{id:'outro',numero:formatCnj(B),status:'ATIVO'}];
  const imp=await m.I.importar({perfil:'advogado'});
  assert.equal(imp.resumo.criados,2);assert.equal(imp.resumo.pulados_na_hora,1);
});

test('desfazer remove só o que ninguém trabalhou; descartar não grava nada',async()=>{
  const m=montar();
  const r=await m.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  await m.I.importar({id:r.id,perfil:'admin'});
  m.store.rows=m.store.rows.map(p=>p.numero===formatCnj(A)?{...p,documentos:[{nome:'procuração.pdf'}]}:p.numero===formatCnj(B)?{...p,andamentos:[{data:'2026-10-13',txt:'[DATAJUD] Conclusos',origem:'datajud'}]}:p);
  const comTarefa=m.store.rows.find(p=>p.numero===formatCnj(C)).id;
  const d=await m.I.desfazer({perfil:'admin',tarefas:[{processo_id:comTarefa,status:'na_fila'}]});
  assert.equal(d.ok,true);assert.equal(d.removidos,1,'só o B, que só recebeu leitura do tribunal');assert.equal(d.mantidos,2);
  assert.ok(m.store.rows.some(p=>p.numero===formatCnj(A))&&m.store.rows.some(p=>p.numero===formatCnj(C)));
  assert.ok(!m.store.rows.some(p=>p.numero===formatCnj(B)));
  const n=montar();
  await n.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  assert.equal((await n.I.descartar({perfil:'admin'})).ok,true);
  assert.equal((await n.I.importar({perfil:'admin'})).ok,false);
  assert.equal(n.store.rows.length,1);
});

test('a IA tem a ferramenta; sem IA, a frase "importar a planilha" também funciona',async()=>{
  const m=montar();
  await m.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  const deps={carteiraImport:m.I,processStore:m.store,engine:{list:async()=>[]}};
  assert.ok(LexTools.definitions({}).some(d=>d.name==='importacao_de_carteira'));
  const ver=await LexTools.executar('importacao_de_carteira',{acao:'ver'},deps,{profile:'admin'});
  assert.equal(ver.ok,true);assert.equal(ver.resumo.novos,3);assert.equal(ver.problemas.length,2);
  assert.equal((await LexTools.executar('importacao_de_carteira',{acao:'importar'},deps,{profile:'secretaria'})).ok,false);
  for(const f of ['importar a planilha','importa os processos da planilha','pode importar a planilha','pode importar','importa'])assert.equal(parseOfficeQuery(f)?.acao,'importar',f);
  for(const f of ['importe os processos do PJe','importar processos da minha OAB'])assert.notEqual(parseOfficeQuery(f)?.action,'carteira_importacao',f+' não é a planilha');
  assert.equal(parseOfficeQuery('desfazer a importação')?.acao,'desfazer');
  assert.equal(parseOfficeQuery('descarta essa planilha')?.acao,'descartar');
  assert.notEqual(parseOfficeQuery('não importa')?.action,'carteira_importacao','"não importa" é "tanto faz"');
  const out=await executeOfficeQuery(deps,{action:'carteira_importacao',acao:'importar'},{profile:'admin'});
  assert.match(out.message,/Importei 3 processos/);
});

// ---------------------------------------------------------------------
// Revisão adversarial da fase 2
// ---------------------------------------------------------------------
const D=cnj(7777);
const CSV4=()=>Buffer.from(['Processo;Cliente;Celular',formatCnj(A)+';João;(61) 98888-7777',formatCnj(B)+';Bia;3133334444 / 31999998888',
  formatCnj(C)+';Caio;(31) 3333-4444',formatCnj(D)+';Davi;12345678901234'].join('\n'));

test('WhatsApp da planilha: só celular brasileiro entra, marcado como vindo da planilha; o resumo conta o que ficou de fora',async()=>{
  const m=montar();
  const r=await m.I.receber({buffer:CSV4(),nome:'c.csv',perfil:'admin'});
  assert.match(r.texto,/WhatsApp: 2 celulares ligados aos processos; 2 números que não parecem celular ficaram de fora\./);
  await m.I.importar({perfil:'admin'});
  const por=Object.fromEntries(m.store.rows.filter(p=>p.importacao_id).map(p=>[p.cliente,p]));
  assert.equal(por['João'].cliente_whatsapp,'5561988887777');assert.equal(por['João'].cliente_whatsapp_fonte,'planilha');
  assert.equal(por['Bia'].cliente_whatsapp,'5531999998888','de dois números, fica o celular');
  assert.equal(por['Caio'].cliente_whatsapp,null,'fixo não recebe WhatsApp');assert.equal(por['Davi'].cliente_whatsapp,null,'número sem formato de telefone não vira destino');
  assert.equal(por['Caio'].cliente_whatsapp_fonte,undefined);
});

test('desfazer não apaga processo com prazo, publicação ou dado mexido; só o que ficou como a planilha trouxe, mais a leitura do tribunal',async()=>{
  const m=montar();
  await m.I.receber({buffer:CSV4(),nome:'c.csv',perfil:'admin'});
  await m.I.importar({perfil:'admin'});
  m.store.rows=m.store.rows.map(p=>{
    if(p.numero===formatCnj(A))return{...p,cliente:'João da Silva'};
    if(p.numero===formatCnj(B))return{...p,andamentos:[{data:'2026-10-13',txt:'[DATAJUD] Conclusos',origem:'datajud'}],court_readings:[{reading_id:'r1'}],
      last_court_sync_at:'2026-10-13T09:00:00Z',last_court_sync_source:'datajud',datajud_atualizado_em:'2026-10-13T09:00:00Z',datajud_alias:'api_publica_tjmg',atualizado_em:'2026-10-13T09:00:00Z'};
    if(p.numero===formatCnj(C))return{...p,prazo:'2026-10-20'};
    if(p.numero===formatCnj(D))return{...p,publicacoes_djen:[{id:'777'}]};
    return p;
  });
  const d=await m.I.desfazer({perfil:'admin',tarefas:[]});
  assert.equal(d.removidos,1);assert.equal(d.mantidos,3);assert.match(d.texto,/Mantive 3/);
  assert.ok(!m.store.rows.some(p=>p.numero===formatCnj(B)));
  for(const x of [A,C,D])assert.ok(m.store.rows.some(p=>p.numero===formatCnj(x)),formatCnj(x));
});

test('duas ordens de importar ao mesmo tempo gravam uma vez só; importação interrompida pode ser retomada',async()=>{
  const m=montar();
  await m.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  const res=await Promise.all([m.I.importar({perfil:'admin'}),m.I.importar({perfil:'advogado'})]);
  assert.equal(res.filter(r=>/Importei 3 processos/.test(r.texto||'')).length,1,'uma ordem importa');
  assert.ok(res.some(r=>r.em_andamento||r.ja_importada),'a outra é avisada');
  assert.equal(m.store.rows.filter(p=>p.importacao_id).length,3);
  const n=montar();
  const r=await n.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  await n.rec.change('lex_carteira_importacao_'+r.id,x=>({...x,status:'importando',importando_desde:'2026-10-13T12:40:00.000Z'}));
  assert.equal((await n.I.importar({perfil:'admin'})).resumo.criados,3,'parada há 20 minutos: retoma sem duplicar');
  const o=montar();
  const r2=await o.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  await o.rec.change('lex_carteira_importacao_'+r2.id,x=>({...x,status:'importando',importando_desde:'2026-10-13T12:58:00.000Z'}));
  const agora=await o.I.importar({perfil:'admin'});
  assert.equal(agora.em_andamento,true);assert.equal(o.store.rows.length,1,'em curso há 2 minutos: não começa outra');
});

test('a conversa da IA sabe da planilha pendente sem baixar todas as importações a cada mensagem',async()=>{
  const m=montar();
  assert.equal(await m.I.contextoParaIA(),null);
  await m.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  const antes=m.rec.listas;
  assert.match(await m.I.contextoParaIA(),/PLANILHA ESPERANDO A ORDEM DO TITULAR/);
  assert.equal(m.rec.listas,antes,'só lê o registro pequeno');
  await m.I.importar({perfil:'admin'});
  assert.equal(await m.I.contextoParaIA(),null);
  const n=montar();
  await n.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  await n.I.descartar({perfil:'admin'});
  assert.equal(await n.I.contextoParaIA(),null);
});

test('o resumo só promete leitura automática no tribunal quando ela está ligada',async()=>{
  const com=montar({leituraAutomatica:()=>true});
  assert.match((await com.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'})).texto,/leitura diária do tribunal \(Datajud\)/);
  const sem=montar({leituraAutomatica:()=>false});
  assert.match((await sem.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'})).texto,/depende da chave do Datajud, que não está configurada/);
});

test('planilha ou Word que abre grande demais é recusado antes de ler',async()=>{
  const zip=new JSZip();
  zip.file('xl/workbook.xml','<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml','<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>'+'x'.repeat(5000)+'</t></is></c></row></sheetData></worksheet>');
  const buf=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  await assert.rejects(lerPlanilha(buf,'g.xlsx',{maxDescompactado:2000}),/grande demais/);
  assert.equal((await lerPlanilha(buf,'g.xlsx')).formato,'xlsx','no limite normal, lê');
  const {textoDocx}=require('../lib/office-models');
  const doc=new JSZip();doc.file('word/document.xml','<w:document><w:body><w:p><w:r><w:t>'+'y'.repeat(5000)+'</w:t></w:r></w:p></w:body></w:document>');
  await assert.rejects(textoDocx(await doc.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),{maxDescompactado:2000}),/grande demais/);
});

test('Telegram do titular entrega planilha e modelo .md ao LEX (antes recusava como formato não suportado)',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../bot.js'),'utf8');
  const recebidos=[],avisos=[];
  const c=vm.createContext({CHAT_ID:'7171',isTelegramOwner:()=>true,telegramReception:{ownerCommand:async()=>false,receive:async()=>true},
    env:async t=>{avisos.push(t)},_titularSaudacao:()=>'Dr.',_idLex:()=>({assistente:'LEX'}),
    baixarTelegram:async()=>Buffer.from('x'),processarMensagem:async(ctx,dados)=>{recebidos.push(dados.arquivo.nome)}});
  vm.runInContext(source.slice(source.indexOf('async function adapterTelegram('),source.indexOf('// ── EVOLUTION (WhatsApp) adapter')),c);
  const msg=nome=>({message_id:1,chat:{id:7171,type:'private'},from:{id:7171},document:{file_id:'f',file_name:nome,mime_type:'application/octet-stream',file_size:10}});
  for(const n of ['carteira.xlsx','carteira.csv','modelo contestação.md','velha.xls'])await c.adapterTelegram(msg(n));
  assert.deepEqual(recebidos,['carteira.xlsx','carteira.csv','modelo contestação.md','velha.xls']);
  await c.adapterTelegram(msg('foto.heic'));
  assert.match(avisos.at(-1),/Formato não suportado/);
});

// ---------- Auditoria de segurança da fase 2 (achados 3, 4, 5 e 7) ----------
test('planilha nova substitui a que esperava: só a mais recente pode ser importada, e importar de novo não traz a antiga',async()=>{
  const m=montar();
  const velha=await m.I.receber({buffer:Buffer.from(CSV),nome:'velha.csv',perfil:'admin'});
  const nova=await m.I.receber({buffer:Buffer.from(['Processo;Cliente',formatCnj(D)+';Davi'].join('\n')),nome:'corrigida.csv',perfil:'admin'});
  assert.equal((await m.rec.read('lex_carteira_importacao_'+velha.id)).value.status,'substituida');
  assert.equal((await m.rec.read('lex_carteira_importacao_'+velha.id)).value.novos,undefined,'a lista da substituída não fica guardada');
  const imp=await m.I.importar({perfil:'admin'});
  assert.equal(imp.id,nova.id);assert.equal(imp.resumo.criados,1);
  const de_novo=await m.I.importar({perfil:'admin'});
  assert.equal(de_novo.ja_importada,true,'a segunda ordem não importa a planilha antiga');
  assert.equal(m.store.rows.filter(p=>p.importacao_id).length,1);
  assert.equal((await m.I.importar({id:velha.id,perfil:'admin'})).ok,false,'nem pelo código');
});

test('planilha esperando há mais de 7 dias não é importada: a carteira mudou desde a leitura',async()=>{
  const m=montar();
  await m.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  m.avancar(8*86400000);
  const r=await m.I.importar({perfil:'admin'});
  assert.equal(r.ok,false);assert.match(r.erro,/mais de 7 dias/);
  assert.equal(m.store.rows.length,1);
});

test('"cancela a importação" com planilha esperando descarta; sem planilha esperando, pergunta em vez de desfazer',async()=>{
  assert.equal(parseOfficeQuery('cancela a importação')?.acao,'cancelar');
  const m=montar();
  const deps={carteiraImport:m.I,processStore:m.store,engine:{list:async()=>[]}};
  await m.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  let out=await executeOfficeQuery(deps,{action:'carteira_importacao',acao:'cancelar'},{profile:'admin'});
  assert.match(out.message,/não importei a planilha/);
  await m.I.receber({buffer:Buffer.from(CSV4()),nome:'outra.csv',perfil:'admin'});
  await m.I.importar({perfil:'admin'});
  out=await executeOfficeQuery(deps,{action:'carteira_importacao',acao:'cancelar'},{profile:'admin'});
  assert.match(out.message,/Quer desfazer a importação de "outra\.csv"/);
  assert.equal(m.store.rows.filter(p=>p.importacao_id).length,4,'nada foi apagado');
});

test('desfazer não segue às cegas: sem conseguir ler as tarefas, ou com a lista de tarefas possivelmente cortada, não apaga nada',async()=>{
  const m=montar();
  await m.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  await m.I.importar({perfil:'admin'});
  let d=await m.I.desfazer({perfil:'admin',tarefas:null});
  assert.equal(d.ok,false);assert.match(d.erro,/tarefas/);
  const muitas=Array.from({length:100},(_,i)=>({id:'t'+i,processo_id:'x',criada_em:'2026-10-13T13:30:00Z'}));
  m.avancar(60*60*1000);
  d=await m.I.desfazer({perfil:'admin',tarefas:muitas});
  assert.equal(d.ok,false);assert.match(d.erro,/muitas tarefas/);
  assert.equal(m.store.rows.filter(p=>p.importacao_id).length,3);
  const falha=await LexTools.executar('importacao_de_carteira',{acao:'desfazer'},{carteiraImport:m.I,processStore:m.store,engine:{list:async()=>{throw new Error('503')}}},{profile:'admin'});
  assert.equal(falha.ok,false,'erro ao listar tarefas não vira lista vazia');
  const velhas=Array.from({length:100},(_,i)=>({id:'v'+i,processo_id:'x',criada_em:'2026-10-01T10:00:00Z',atualizada_em:'2026-10-01T10:00:00Z'}));
  d=await m.I.desfazer({perfil:'admin',tarefas:velhas});
  assert.equal(d.ok,true,'lista cheia, mas toda anterior à importação: dá para conferir');
});

test('número já cadastrado escrito de outro jeito não vira processo duplicado',async()=>{
  const curto=formatCnj(C).replace(/^0+/,'');
  const m=montar();
  m.store.rows=[...m.store.rows,{id:'antigo',nome:'Ana Lima (antigo)',numero:curto,status:'ATIVO'},{id:'texto',nome:'Caso B',numero:'Proc. '+formatCnj(B),status:'ATIVO'}];
  const r=await m.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  assert.equal(r.resumo.novos,1,'só o A é novo');assert.equal(r.resumo.possiveis_duplicados,2);
  assert.match(r.texto,/2 parecem já estar no LEX com o número escrito de outro jeito/);
  await m.I.importar({perfil:'admin'});
  assert.equal(m.store.rows.filter(p=>p.importacao_id).length,1);
});

test('arquivo que mente o próprio tamanho é cortado na leitura, sem abrir tudo na memória',async()=>{
  const zip=new JSZip();
  zip.file('xl/workbook.xml','<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml','<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>'+'x'.repeat(200000)+'</t></is></c></row></sheetData></worksheet>');
  const buf=Buffer.from(await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
  // Reescreve o tamanho declarado (cabeçalho local e diretório central) para 10 bytes.
  for(let i=0;i<buf.length-4;i++){
    const sig=buf.readUInt32LE(i);
    if(sig===0x04034b50&&buf.toString('latin1',i+30,i+30+buf.readUInt16LE(i+26)).endsWith('sheet1.xml'))buf.writeUInt32LE(10,i+22);
    if(sig===0x02014b50&&buf.toString('latin1',i+46,i+46+buf.readUInt16LE(i+28)).endsWith('sheet1.xml'))buf.writeUInt32LE(10,i+24);
  }
  await assert.rejects(lerPlanilha(buf,'mentira.xlsx',{maxDescompactado:50000}),/grande demais/);
});

test('CSV enorme: lê só até o limite de linhas e de colunas, e avisa que cortou',async()=>{
  const linhas=['Processo;Cliente'];
  for(let i=0;i<5000;i++)linhas.push(formatCnj(cnj(100000+i))+';Cliente '+i);
  const leitura=await lerPlanilha(Buffer.from(linhas.join('\n')),'grande.csv');
  assert.ok(leitura.linhas.length<=3100,'parou de montar linhas: '+leitura.linhas.length);
  const a=analisar(leitura,[]);
  assert.equal(a.cortou,true);assert.equal(a.total_linhas,3000);
  const larga=await lerPlanilha(Buffer.from('Processo'+';x'.repeat(5000)+'\n'+formatCnj(A)+';y'.repeat(5000)),'larga.csv');
  assert.ok(larga.linhas.every(l=>l.length<=201),'colunas além de 200 são ignoradas');
});

// ---------- Re-checagem da auditoria (achados 4 e 5) ----------
test('tarefa retomada ou iniciada depois da importação conta como recente: lista cheia assim não deixa desfazer',async()=>{
  const {TaskEngine}=require('../lib/task-engine');
  const rec=records();let agora=Date.parse('2026-10-13T14:00:00Z');
  const engine=new TaskEngine({store:rec,processes:async()=>[],ai:async()=>'',now:()=>agora});
  const t=await engine.submit({tipo:'analise',instrucao:'Analise'},'admin');
  await rec.change('lex_task:'+t.id,x=>({...x,status:'falhou',criada_em:'2026-10-01T10:00:00Z'}));
  const retomada=await engine.retry(t.id);
  assert.ok(retomada.retomada_em,'retomar grava quando');
  const m=montar();
  await m.I.receber({buffer:Buffer.from(CSV),nome:'c.csv',perfil:'admin'});
  await m.I.importar({perfil:'admin'});
  m.avancar(60*60*1000);
  const mexidas=Array.from({length:100},(_,i)=>({id:'t'+i,processo_id:'x',criada_em:'2026-10-01T10:00:00Z',iniciada_em:i%2?'2026-10-13T13:30:00Z':null,retomada_em:i%2?null:'2026-10-13T13:40:00Z'}));
  const d=await m.I.desfazer({perfil:'admin',tarefas:mexidas});
  assert.equal(d.ok,false);assert.match(d.erro,/muitas tarefas/);
});

test('planilha com milhares de abas é recusada rápido, sem travar o servidor',async()=>{
  const zip=new JSZip();
  const n=5000;
  zip.file('xl/workbook.xml','<?xml version="1.0"?><workbook xmlns:r="r"><sheets>'+Array.from({length:n},(_,i)=>'<sheet name="A'+i+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships>'+Array.from({length:n},(_,i)=>'<Relationship Id="rId'+(i+1)+'" Target="worksheets/s'+i+'.xml"/>').join('')+'</Relationships>');
  zip.file('xl/worksheets/s'+(n-1)+'.xml','<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>'+formatCnj(A)+'</t></is></c></row></sheetData></worksheet>');
  const buf=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  const t0=Date.now();
  const leitura=await lerPlanilha(buf,'abas.xlsx');
  assert.ok(Date.now()-t0<3000,'levou '+(Date.now()-t0)+' ms');
  assert.equal(leitura.linhas.length,0,'só as primeiras abas são olhadas');
});
