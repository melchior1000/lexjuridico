'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {processCnjs,primaryCnj,hasCnj}=require('../lib/pje-sync');
const Sync=require('../lib/pje-process-sync');
const Mni=require('../lib/pje-mni');
const {executeNaturalOfficeCommand}=require('../lib/office-routes');
const {createPjeMonitor}=require('../lib/pje-monitor');

const KLEUBER='6002060-50.2025.4.06.3818 / Embargos 6002846-94.2025.4.06.3818';
test('campo número com vários autos: vale quando começa com CNJ, nunca quando só cita outro',()=>{
  assert.deepEqual(processCnjs(KLEUBER),['60020605020254063818','60028469420254063818']);
  assert.equal(primaryCnj(KLEUBER),'60020605020254063818');
  assert.deepEqual(processCnjs('A confirmar — vinculado a 5004158-61.2024.8.13.0704'),[],'número de outro processo não conta');
  assert.deepEqual(processCnjs('5004158-61.2024.8.13.0704'),['50041586120248130704']);
  assert.deepEqual(processCnjs(''),[]);
  assert.equal(hasCnj({numero:KLEUBER},'60028469420254063818'),true,'DJEN dos embargos casa com o caso');
});

test('tribunal sai do próprio CNJ',()=>{
  assert.equal(Sync.tribunalFromCnj('5004158-61.2024.8.13.0704'),'TJMG');
  assert.equal(Sync.tribunalFromCnj('0020974-18.2024.8.26.0002'),'TJSP');
  assert.equal(Sync.tribunalFromCnj('6002060-50.2025.4.06.3818'),'TRF6');
  assert.equal(Sync.tribunalFromCnj('0000001-00.2025.5.03.0001'),'TRT3');
  assert.equal(Sync.tribunalFromCnj('0000001-00.2025.8.07.0001'),'TJDFT');
  assert.equal(Sync.tribunalFromCnj('123'),null);
});

function procXml(numero,{movs=[],polos=true}={}){
  return '<Envelope><Body><consultarProcessoResposta><sucesso>true</sucesso><mensagem>ok</mensagem><processo>'
    +'<dadosBasicos numero="'+numero+'" classeProcessual="12078"><orgaoJulgador nomeOrgao="1ª Vara Federal de Uberaba"/>'
    +(polos?'<polo polo="AT"><parte><pessoa nome="CAIXA ECONOMICA FEDERAL"/></parte></polo><polo polo="PA"><parte><pessoa nome="KLEUBER DA SILVA"/></parte></polo>':'')
    +'</dadosBasicos>'+movs.map(([d,t],i)=>'<movimento dataHora="'+d+'" identificadorMovimento="'+numero+i+'"><movimentoLocal descricao="'+t+'"/></movimento>').join('')
    +'</processo></consultarProcessoResposta></Body></Envelope>';
}
function store(rows){let data=structuredClone(rows);return{async read(){return{processes:structuredClone(data)}},async mutate(fn){const d=structuredClone(data);const value=fn(d);data=d;return{value}},snapshot:()=>data}}

test('atualiza andamentos e partes da carteira real, explicando o que não deu',async()=>{
  const db=store([
    {id:'k',nome:'CEF — Execução vs. Kleuber',numero:KLEUBER,andamentos:[{data:'2026-09-14',txt:'Intimação para impugnar embargos',origem:'manual'}]},
    {id:'bb',nome:'Banco do Brasil — Exceção de Pré-Executividade',numero:'',andamentos:[]},
    {id:'ag',nome:'COFCO — Agravo',numero:'A confirmar — vinculado a 5004158-61.2024.8.13.0704'},
    {id:'sp',nome:'COFCO — Cumprimento (Honorários)',numero:'0020974-18.2024.8.26.0002'},
    {id:'arq',nome:'Encerrado',numero:'5009999-11.2026.8.13.0001',status:'ARQUIVADO'}
  ]);
  const calls=[];
  const transport=async(endpoint,xml)=>{const n=(xml.match(/<tip:numeroProcesso>(\d+)</)||[])[1];calls.push(n);
    return{status:200,body:n==='60020605020254063818'?procXml(n,{movs:[['20260920101500','Juntada de impugnação'],['20260922090000','Conclusos para decisão']]}):procXml(n,{movs:[['20260921080000','Embargos recebidos']],polos:false})}};
  const client=Mni.createMniClient(Mni.mniConfig({PJE_MNI_CPF:'12345678909',PJE_MNI_SENHA:'x',PJE_MNI_TRIBUNAIS:'TRF6=https://pje1g.trf6.jus.br/pje/intercomunicacao'}),{transport});
  const now=new Date('2026-09-24T13:00:00Z');
  const r=await Sync.syncProcessesFromPje({client,processStore:db,now});
  assert.deepEqual(calls,['60020605020254063818','60028469420254063818'],'consulta principal e embargos; não consulta processo encerrado nem o "vinculado a"');
  assert.equal(r.atualizados.length,1);assert.equal(r.novos_andamentos,3);assert.equal(r.partes_atualizadas,1);
  const k=db.snapshot().find(p=>p.id==='k');
  assert.equal(k.partes,'Autor: CAIXA ECONOMICA FEDERAL · Réu: KLEUBER DA SILVA','partes vêm só do principal');
  assert.equal(k.vara,'1ª Vara Federal de Uberaba');
  assert.equal(k.andamentos[0].txt,'[PJe] Conclusos para decisão');
  assert.ok(k.andamentos.some(a=>a.txt==='Intimação para impugnar embargos'),'não apaga andamento manual');
  assert.deepEqual(r.sem_cnj.map(s=>s.id),['bb','ag']);
  assert.deepEqual(r.sem_tribunal.map(s=>s.tribunal),['TJSP']);
  const again=await Sync.syncProcessesFromPje({client,processStore:db,now});
  assert.equal(again.novos_andamentos,0,'repetir não duplica');
  const msg=Sync.syncReportMessage(r);
  assert.match(msg,/1 processo\(s\) atualizado\(s\) pelo PJe: 3 andamento\(s\) novo\(s\), partes atualizadas em 1/);
  assert.match(msg,/sem número CNJ[\s\S]*Banco do Brasil/);
  assert.match(msg,/Tribunal não conectado: TJSP/);
});

test('falha de um tribunal não para os outros e é relatada',async()=>{
  const db=store([{id:'a',nome:'A',numero:'5004158-61.2024.8.13.0704'},{id:'b',nome:'B',numero:'6002060-50.2025.4.06.3818'}]);
  const transport=async endpoint=>endpoint.includes('tjmg')?Promise.reject(new Mni.MniError('timeout','O tribunal não respondeu a tempo.')):{status:200,body:procXml('60020605020254063818')};
  const client=Mni.createMniClient(Mni.mniConfig({PJE_MNI_CPF:'12345678909',PJE_MNI_SENHA:'x',PJE_MNI_TRIBUNAIS:'TJMG=https://pje.tjmg.jus.br/pje/intercomunicacao;TRF6=https://pje1g.trf6.jus.br/pje/intercomunicacao'}),{transport});
  const r=await Sync.syncProcessesFromPje({client,processStore:db});
  assert.equal(r.atualizados.length,1);assert.equal(r.falhas[0].tribunal,'TJMG');assert.equal(r.ok,false);
});

test('pelo WhatsApp: "atualize meus processos" e sem PJe conectado explica o que falta',async()=>{
  const db=store([{id:'b',nome:'B',numero:'6002060-50.2025.4.06.3818'}]);
  const records={rows:new Map(),async read(k){return this.rows.has(k)?{value:this.rows.get(k)}:null},async change(k,f){const v=f(this.rows.get(k));this.rows.set(k,v);return v}};
  const transport=async()=>({status:200,body:procXml('60020605020254063818',{movs:[['20260922090000','Conclusos']]})});
  const pje=createPjeMonitor({records,processStore:db,env:{PJE_MNI_CPF:'12345678909',PJE_MNI_SENHA:'x',PJE_MNI_TRIBUNAIS:'TRF6=https://pje1g.trf6.jus.br/pje/intercomunicacao'},transport});
  const out=await executeNaturalOfficeCommand({processStore:db,records,pje,engine:{async list(){return[]}},log:()=>{}},{text:'atualize meus processos',profile:'secretaria'});
  assert.match(out.message,/1 processo\(s\) atualizado\(s\) pelo PJe/);
  const off=createPjeMonitor({records,processStore:db,env:{}});
  const msg=await executeNaturalOfficeCommand({processStore:db,records,pje:off,engine:{async list(){return[]}},log:()=>{}},{text:'atualize meus processos',profile:'advogado'});
  assert.match(msg.message,/ainda não está conectado[\s\S]*PJE_MNI_CPF/);
});

test('botão "Atualizar do tribunal" usa o servidor do LEX com login (antes chamava o endereço errado)',()=>{
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','office-dossier-ui.js'),'utf8');
  assert.match(src,/lexApi\('\/api\/escritorio\/pje\/processos'/);
  // Sem PJe não atualiza: Datajud tem atraso e não reflete o Diário.
  assert.doesNotMatch(src,/\/api\/escritorio\/datajud/);
  assert.match(src,/o PJe ainda não está ligado ao LEX/);
});

test('ordem pelo CNJ da execução não confunde com o agravo "vinculado a" o mesmo número',()=>{
  const {resolveCase}=require('../lib/task-engine');
  const {pickChoice}=require('../lib/office-queries');
  const ps=[{id:'ag',nome:'COFCO — Agravo',numero:'A confirmar — vinculado a 5004158-61.2024.8.13.0704'},{id:'ep',nome:'COFCO — Execução Principal',numero:'5004158-61.2024.8.13.0704'},{id:'k',nome:'Kleuber',numero:KLEUBER}];
  assert.equal(resolveCase(ps,{instrucao:'faça a contestação do processo 5004158-61.2024.8.13.0704'}).process?.id,'ep');
  assert.equal(resolveCase(ps,{instrucao:'analise o processo 6002846-94.2025.4.06.3818'}).process?.id,'k','CNJ dos embargos acha o caso');
  assert.equal(pickChoice('5004158-61.2024.8.13.0704',ps.slice(0,2)).id,'ep');
});

test('aponta processo em que a OAB do escritório não consta entre os advogados',async()=>{
  const {officeInCase,syncReportMessage}=require('../lib/pje-process-sync');
  const polos=[{polo:'AT',partes:['Caixa Econômica Federal'],advogados:[{nome:'Dr. Outro',inscricao:'MG999999'}]},{polo:'PA',partes:['Fulano'],advogados:[]}];
  assert.equal(officeInCase(polos,[{oab:'123456',uf:'MG'}]),false);
  assert.equal(officeInCase([{advogados:[{inscricao:'MG123456'}]}],[{oab:'123456',uf:'MG'}]),true);
  assert.equal(officeInCase([{advogados:[]}],[{oab:'123456',uf:'MG'}]),null,'sem advogados no retorno não afirma nada');
  const msg=syncReportMessage({atualizados:[],falhas:[],sem_cnj:[],sem_tribunal:[],novos_andamentos:0,partes_atualizadas:0,
    nao_consta:[{nome:'CEF — Execução',cnj:'60020605020254063818',advogados:['Dr. Outro']}]});
  assert.match(msg,/Você não consta como advogado no tribunal em 1/);
  assert.match(msg,/6002060-50\.2025\.4\.06\.3818/);
});
