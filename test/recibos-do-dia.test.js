'use strict';
// Recibos do dia: só o que está registrado (outbox, recepção, andamentos, prazos, tarefas),
// com hora de Brasília, alvo, quem autorizou e origem. Sem registro, sem recibo.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {executeOfficeQuery,parseOfficeQuery,QUERY_ACTIONS}=require('../lib/office-queries');

// 26/09/2026 23:30 em Brasília = 27/09 02:30 UTC — o dia tem que ser o de Brasília.
const NOW=new Date('2026-09-27T02:30:00Z');
const T='2026-09-26T';
function deps(over={}){
  const kv={
    'lex_channel_command_a':{id:'a',origem:'whatsapp',contato_id:'5561988887777',contato_nome:'Maria Souza',comando:'diga à Maria que respondo amanhã',texto_final:'Olá, Maria! A Dra. Ana retorna amanhã.',status:'enviado',enviado_em:T+'12:52:00Z',confirmado_por:'admin'},
    'lex_channel_command_b':{id:'b',origem:'telegram',contato_id:'123',comando:'x',status:'enviado',enviado_em:'2026-09-25T12:00:00Z'},
    'lex_rotina_noturna_2026-09-26':{iniciou_em:T+'08:00:00Z',terminou_em:T+'08:06:00Z',consultados:120,novos:7,erros:1}
  };
  return{
    records:{list:async prefix=>Object.entries(kv).filter(([k])=>k.startsWith(prefix)).map(([,v])=>v),read:async k=>kv[k]?{value:kv[k]}:null},
    reception:{listEvents:async({offset=0})=>offset?[]:[{numero:'5561911112222',nome:'Carlos Lima',direcao:'saida_lex',texto:'Recebi sua mensagem e encaminhei ao escritório.',classe:'trabalhista',criado_em:T+'04:10:00Z'},{numero:'5561933334444',nome:'Arquivado',direcao:'saida_lex',texto:'Atendimento encerrado.',criado_em:'2026-09-20T10:00:00Z'}]},
    processStore:{read:async()=>({processes:[
      {id:'p1',nome:'Banco Alfa · Execução',numero:'1000042-11.2025.4.06.3818',status:'ATIVO',last_court_sync_at:T+'09:40:00Z',andamentos:[{data:'2026-09-26',txt:'[DATAJUD] Juntada de petição',origem:'datajud',importado_em:T+'09:40:00Z'},{data:'2026-09-26',txt:'Prazo marcado como cumprido',origem:'lex',importado_em:T+'13:05:00Z'},{data:'2026-09-10',txt:'[DATAJUD] antigo',origem:'datajud',importado_em:'2026-09-10T09:40:00Z'},{data:'2026-09-26',txt:'anotação manual sem origem'}],prazo_baixa:{ativa:true,vencimento:'2026-09-25',marcado_em:T+'13:05:00Z',marcado_por:'admin'}},
      {id:'p2',nome:'Maria Souza · Ação',numero:'5004158-61.2024.8.13.0704',status:'ATIVO',partes_verificadas_em:T+'09:40:00Z',prazoReal:'2026-10-14',prazo_confirmado_em:T+'13:10:00Z',prazo_confirmado_por:'admin',djen_id_origem:'d1'}
    ]})},
    engine:{list:async()=>[
      {id:'t1',tipo:'contestacao',agente:'LEX Redator',processo_nome:'Banco Alfa · Execução',status:'concluida',revisado_em:T+'14:00:00Z',revisado_por:'admin'},
      {id:'t2',tipo:'analise',agente:'LEX Jurídico',status:'aguardando_revisao',atualizada_em:T+'15:00:00Z',processo_nome:'Maria Souza · Ação'},
      {id:'t3',tipo:'peticao',status:'executando'},
      {id:'t4',tipo:'peticao',status:'concluida',revisado_em:'2026-09-20T14:00:00Z'}
    ]},
    log(){},
    ...over
  };
}

test('daily_receipts agrega só o que foi registrado hoje em Brasília, com hora, alvo, autorização e origem',async()=>{
  const r=await executeOfficeQuery(deps(),{action:'daily_receipts'},{now:NOW,profile:'admin'});
  assert.equal(r.handled,true);
  assert.equal(r.result.dia,'2026-09-26');
  const tipos=r.result.recibos.map(x=>x.tipo).sort();
  assert.deepEqual(tipos,['andamento_registrado','atendimento_recepcao','mensagem_enviada','minuta_pronta','prazo_confirmado','prazo_cumprido','rotina_noturna','tarefa_concluida']);
  const msg=r.result.recibos.find(x=>x.tipo==='mensagem_enviada');
  assert.equal(msg.hora,'09:52');assert.match(msg.para,/whatsapp · Maria Souza/);assert.equal(msg.autorizado_por,'admin');assert.equal(msg.origem,'whatsapp');
  const and=r.result.recibos.find(x=>x.tipo==='andamento_registrado');
  assert.match(and.oque,/Juntada de petição/);assert.equal(and.origem,'datajud');assert.equal(and.ref,'p1');
  assert.ok(!r.result.recibos.some(x=>/anotação manual/.test(x.oque)),'andamento sem origem oficial não vira recibo');
  assert.ok(!r.result.recibos.some(x=>x.tipo==='andamento_registrado'&&x.origem==='lex'),'baixa do LEX aparece só como prazo_cumprido');
  const noite=r.result.recibos.find(x=>x.tipo==='rotina_noturna');
  assert.match(noite.oque,/120 consultados · 7 andamentos novos · 1 erros/);
  assert.deepEqual(r.result.contagens,{concluidas:1,em_andamento:1,aguardam_voce:1,recibos:8});
  assert.equal(r.result.recibos[0].quando,T+'15:00:00Z','ordenado do mais recente');
  assert.match(r.message,/Hoje \(26\/09\/2026\) eu fiz 8 coisas/);
});

test('falha de uma fonte não derruba as outras nem vira "nada aconteceu"',async()=>{
  const r=await executeOfficeQuery(deps({engine:{list:async()=>{throw new Error('banco fora')}}}),{action:'daily_receipts'},{now:NOW,profile:'admin'});
  assert.deepEqual(r.result.falhas,['tarefas']);
  assert.ok(r.result.recibos.length>=5);
  const empty=await executeOfficeQuery(deps({records:{list:async()=>{throw new Error('x')},read:async()=>null},reception:{list:async()=>[]},processStore:{read:async()=>({processes:[]})},engine:{list:async()=>[]}}),{action:'daily_receipts'},{now:NOW,profile:'admin'});
  assert.equal(empty.result.recibos.length,0);
  assert.match(empty.message,/não há ação minha registrada — e não consegui ler mensagens dos canais/);
});

test('a ordem "o que você fez hoje" é reconhecida como consulta determinística',()=>{
  for(const t of ['o que você fez hoje','recibos do dia','/recibos','relatório de hoje'])assert.equal(parseOfficeQuery(t)?.action,'daily_receipts',t);
  assert.ok(QUERY_ACTIONS.includes('daily_receipts'));
});

test('tela Recibos mostra contadores, recibos com quem/o quê/autorização e correção pela conversa',async()=>{
  const SRC=fs.readFileSync('office-ui-v2.js','utf8');
  const nodes={'#content':{innerHTML:'',isConnected:true}};
  const document={querySelector:s=>{if(s==='#lex-receipts'){if(!nodes['#content'].innerHTML.includes('id="lex-receipts"'))return null;return nodes[s]||(nodes[s]={innerHTML:'',isConnected:true})}return nodes[s]||null},querySelectorAll:()=>[],addEventListener(){},documentElement:{classList:{add(){},remove(){},toggle(){},contains:()=>false},setAttribute(){}},body:{classList:{add(){},remove(){},toggle(){},contains:()=>false}},getElementById:()=>null,createElement:()=>({style:{},setAttribute(){},appendChild(){}}),head:{appendChild(){}}};
  const ctx={document,getProcs:()=>[],localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},console,matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},location:{hash:''},history:{replaceState(){},pushState(){}},navigator:{},
    lexApi:async path=>{assert.equal(path,'/api/escritorio/recibos');return{contagens:{concluidas:1,em_andamento:2,aguardam_voce:1},falhas:[],recibos:[{tipo:'mensagem_enviada',hora:'09:52',oque:'Olá, Maria! <b>x</b>',para:'whatsapp · Maria Souza',autorizado_por:'admin',origem:'whatsapp'},{tipo:'tarefa_concluida',hora:'14:00',oque:'contestacao aprovada',para:'LEX Redator',autorizado_por:'admin',origem:'task_engine',ref:'t1'}]}}};
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(SRC,ctx);
  await ctx.lexRecibos();
  const html=nodes['#lex-receipts'].innerHTML;
  assert.match(html,/<strong class="g">1<\/strong><span>concluídas/);
  assert.match(html,/<strong class="a">1<\/strong><span>aguarda você/);
  assert.match(html,/MENSAGEM ENVIADA[\s\S]*09:52[\s\S]*<dt>Para quem<\/dt><dd>whatsapp · Maria Souza[\s\S]*<dt>Autorizado<\/dt><dd>por admin[\s\S]*<dt>Origem<\/dt><dd>WhatsApp/);
  assert.match(html,/&lt;b&gt;x&lt;\/b&gt;/,'conteúdo escapado');
  assert.match(html,/TAREFA CONCLUÍDA[\s\S]*lexTarefas\('t1'\)/);
  assert.match(html,/Enviar correção/);
  assert.match(html,/lexPrefill\(&quot;Corrija o recibo de 09:52/);
  assert.doesNotMatch(html,/onclick="[^"]*"[^>]*onmouseover=/,'texto do recibo não pode criar atributo de evento');
});
