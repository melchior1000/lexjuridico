(function(){
'use strict';
const esc=v=>(globalThis.lexFixText||String)(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const procs=()=>{try{return typeof getProcs==='function'?(getProcs()||[]):[]}catch{return[]}};
const LEX_SPECIALISTS=[
  ['Roteador','Entende a ordem, identifica o processo e decide para onde encaminhar.',false],
  ['Cadastrador / Autuação','Organiza cliente, processo, documentos e dados faltantes.',false],
  ['Cobrador','Acompanha tarefas e pendências que precisam voltar para a equipe.',false],
  ['Assessor','Análise do processo: diagnóstico, estratégia, risco, pontos fortes/fracos e próximos passos.',true],
  ['Jurídico judicial','Trabalho jurídico de processos judiciais e apoio às peças e providências.',true],
  ['Jurídico administrativo','Trabalho jurídico de processos e demandas administrativas.',true],
  ['Pesquisa decisória','Perfil/padrão decisório do magistrado com decisões identificadas, fundamentos, provas e limites da amostra.',true],
  ['Pericial','Cálculos, quesitos, pareceres e análise técnica.',true],
  ['PJe','Fontes oficiais: número, partes, andamentos e expedientes nas integrações disponíveis.',false],
  ['Coordenador','Coordena o escritório inteiro, distribui ordens e acompanha a execução.',true],
  ['Redação','Produz petições, contestações, recursos e outras minutas para revisão.',true],
  ['Revisão','Confere entregas antes da liberação e devolve correções quando necessário.',true],
  ['Controladoria','Prazos, DJEN, expedientes, conferência e organização das pendências processuais.',false],
  ['Documental','Organiza documentos, autos, anexos e material vinculado ao processo.',false]
];
function stageOf(p){
  const s=String(p?.office_stage||p?.fluxo_setor||p?.setor_fluxo||'').toLowerCase();
  if(OFFICE_SECTORS.some(([code])=>code===s))return s;
  if(/CONCLU|ARQUIV|ENTREGUE|GANHO|PERDIDO/i.test(String(p?.status||'')))return'concluidos';
  if(String(p?.docsFaltantes||p?.docs_faltantes||'').trim())return'cadastro';
  if(String(p?.setor||'').toLowerCase()==='autuacao'||/EM_PREP|PRONTO|AGUARDANDO_APROVACAO/i.test(String(p?.status||'')))return'iniciais';
  if(p?.prazoReal||p?.prazo)return'prazos';
  return'processos';
}
function sectorCounts(){
  const counts=Object.fromEntries(OFFICE_SECTORS.map(([code])=>[code,0]));
  for(const p of procs())counts[stageOf(p)]=(counts[stageOf(p)]||0)+1;
  return counts;
}
function specialistMap(){
  return '<details class="lex2-specialists"><summary><span><b>14 agentes do LEX</b><small>Análise do processo, perfil do magistrado, redação, perícia, controladoria, PJe e demais especialistas registrados no backend</small></span><strong>Ver agentes</strong></summary>'
    +'<div class="lex2-specialist-grid">'+LEX_SPECIALISTS.map(([name,desc,needsAi])=>'<button type="button" onclick="lex2Prefill(\'Quero usar '+esc(name)+'. Explique o que você precisa de mim e execute no contexto desta conversa.\')"><span><b>'+esc(name)+'</b><small>'+esc(desc)+'</small></span><em class="'+(needsAi?'needs-ai':'operational')+'">'+(needsAi?'IA':'OP')+'</em></button>').join('')+'</div>'
    +'</details>';
}
function officeMap(){
  const rows=procs(),counts=sectorCounts(),official=rows.filter(processOfficial).length;
  return '<details class="lex2-office-map"><summary><span><b>Escritório completo</b><small>Banco processual: '+rows.length+' processo'+(rows.length===1?'':'s')+' · '+official+' com leitura oficial</small></span><strong>Ver setores</strong></summary>'
    +'<div class="lex2-database"><button type="button" onclick="lexProcessos()"><span><b>Banco processual</b><small>Número, cliente, partes, andamentos, prazos, documentos, histórico, tarefas e fontes permanecem aqui.</small></span><em>Abrir carteira</em></button></div>'
    +'<div class="lex2-sector-grid">'+OFFICE_SECTORS.map(([code,name,desc])=>'<button type="button" onclick="lex2Prefill(\'Explique o setor '+esc(name)+' e o que ele tem para fazer agora.\')"><span><b>'+esc(name)+'</b><small>'+esc(desc)+'</small></span><em>'+Number(counts[code]||0)+'</em></button>').join('')+'</div>'
    +'</details>';
}
function processOfficial(p){return !!(p?.last_court_sync_at||p?.partes_verificadas_em||p?.cadastro_conferido==='tribunal'||p?.numero_verificado_fonte==='pje')}
function safeLabel(p){
  if(!p)return'Processo';
  if(processOfficial(p))return p.nome_oficial||p.nome||p.partes||p.numero||'Processo';
  const m=String(p.numero||'').match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
  return m?'Processo '+m[0]+' — dados a conferir':'Processo — dados a conferir';
}
function consumeContext(selectedId){
  const requested=String((selectedId===undefined?window.__lexDossierContext?.case_id:selectedId)||'');
  window.__lexDossierContext=null;
  return requested&&procs().some(p=>String(p.id)===requested)?requested:'';
}
function dock(){return '<nav class="lex-dock"><button onclick="lexHome()"><b>⌂</b><span>Início</span></button><button onclick="lexProcessos()"><b>▣</b><span>Processos</span></button><button class="lex-main on" onclick="lexChat()"><b>◉</b><span>LEX</span></button><button onclick="lexPrazos()"><b>◷</b><span>Prazos</span></button><button onclick="lexMais()"><b>☰</b><span>Mais</span></button></nav>'}
function chips(id){
  if(!id)return '<nav class="lex2-context-chips" aria-label="Ações do escritório"><button type="button" onclick="lex2Prefill(\'O que precisa de mim agora?\')">O que precisa de mim</button><button type="button" onclick="lexProcessos()">Banco de processos</button><button type="button" onclick="lexPrazos()">Prazos</button><button type="button" onclick="lexChannel(\'all\')">Mensagens</button><button type="button" onclick="lex2Prefill(\'Explique os setores do escritório e o que cada um tem para fazer agora.\')">Setores</button></nav>';
  const c=[
    ['Análise do processo','Analise integralmente o processo selecionado: situação, últimos andamentos, pontos fortes e fracos, pendências, risco e próximos passos. Não invente fato nem prazo.'],
    ['Perfil do magistrado','Analise o perfil/padrão decisório do magistrado deste processo usando somente decisões identificadas e fontes verificáveis. Mostre fundamentos recorrentes, provas valorizadas, teses acolhidas/rejeitadas e os limites da amostra.'],
    ['Peça','Prepare uma minuta de peça para minha revisão.'],
    ['Risco','Analise os riscos e próximos passos deste caso.'],
    ['Jurisprudência','Pesquise jurisprudência atual e relevante para este caso.'],
    ['Levar para perícia','Levar para perícia este processo e dizer o que falta.']
  ];
  return '<div class="lex2-context-chips">'+c.map(([label,prompt])=>'<button type="button" onclick="lex2Prefill(\''+esc(prompt)+'\')">'+esc(label)+'</button>').join('')+'</div>'
}
function history(id){
  try{
    const saved=JSON.parse(sessionStorage.getItem('lex_chat_history_'+(id?'process_'+id:'general'))||'[]');
    const rows=(Array.isArray(saved)?saved:[]).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').slice(-20);
    if(!rows.length)return '<div class="lex-msg bot lex2-welcome"><b>Eu recebo a ordem na porta do escritório.</b><br>Estou aqui. Dê a ordem em linguagem normal. Diga o que quer, para qual cliente ou processo e como quer que eu execute. Eu consulto o banco processual, escolho o setor certo, encaminho e acompanho. Você não precisa procurar agente ou departamento. Se eu precisar de uma decisão sua, vou dizer exatamente quem, o quê e qual ação está pendente.</div>';
    return rows.map(m=>'<div class="lex-msg '+(m.role==='user'?'me':'bot')+'">'+esc(m.content)+'</div>').join('')
  }catch{return '<div class="lex-msg bot lex2-welcome">Estou aqui. Dê a ordem em linguagem normal; eu localizo o processo no banco e coordeno o setor responsável. Se eu precisar de uma decisão sua, vou dizer exatamente quem, o quê e qual ação está pendente.</div>'}
}
function render(selectedId){
  const id=consumeContext(selectedId),p=procs().find(x=>String(x.id)===id);
  const host=document.getElementById('content');if(!host)return;
  window.lexSelectChatProcess?.(id);
  document.body.classList.add('lex-commercial','lex2-core','lex2-coordinator');
  host.innerHTML='<main class="lex-screen lex2-lex">'
    +'<header class="lex-top"><div><strong>LEX</strong><small>COORDENADOR DO ESCRITÓRIO</small></div><div class="lex-top-actions"><button onclick="lexToggleTheme()" aria-label="Tema">◐</button><button onclick="lexMais()" aria-label="Mais opções">☰</button></div></header>'
    +'<section class="lex2-lex-head"><small>'+(p?'PROCESSO EM CONTEXTO':'PORTA DO ESCRITÓRIO')+'</small><h1>'+(p?'Vamos resolver este processo.':'Dê a ordem. Eu cuido do caminho.')+'</h1><p>'+(p?esc(safeLabel(p)+(p.numero?' · '+p.numero:'')):'O banco de processos permanece no centro. Eu identifico o assunto, escolho entre os 9 setores oficiais, encaminho e devolvo o resultado aqui.')+'</p></section>'
    +'<section class="lex2-office-tools">'+officeMap()+specialistMap()+'<div id="lex2-operational-status" class="lex2-operational-status" role="status">Conferindo o estado do escritório…</div>'+chips(id)+'</section>'
    +'<section id="lex-conversation" class="lex-conversation" role="log" aria-label="Conversa com o LEX" aria-live="polite">'+history(id)+'</section>'
    +'<form class="lex2-command" onsubmit="return lexSendChat(event)">'
    +'<label for="lex-chat-process">Processo da conversa</label><select id="lex-chat-process" aria-label="Processo" onchange="lexSwitchChatProcess(this.value)"><option value="">Escritório geral — nenhum processo</option>'+procs().map(x=>'<option value="'+esc(String(x.id))+'" '+(String(x.id)===id?'selected':'')+'>'+esc((x.numero||'sem número')+' · '+safeLabel(x))+'</option>').join('')+'</select>'
    +'<div class="lex2-command-row"><button class="lex2-attach" data-lex-attachment type="button" aria-label="Anexar documento ao processo">＋</button><textarea id="lex-chat-input" aria-label="Sua ordem ao LEX" rows="2" placeholder="Dê uma ordem ao LEX…"></textarea><button class="lex2-send" type="submit" aria-label="Enviar">↑</button></div>'
    +'<small class="lex2-command-note">Ex.: “LEX, quero X no processo Y, faça desse jeito Z”. O banco processual é preservado; eu encaminho internamente. Atos críticos continuam sujeitos à autorização humana.</small></form>'
    +dock()+'</main>';
  setTimeout(()=>{const conv=document.getElementById('lex-conversation');if(conv)conv.scrollTop=conv.scrollHeight;refreshOperationalStatus()},40)
}
async function refreshOperationalStatus(){
  const box=document.getElementById('lex2-operational-status');if(!box)return;
  try{
    const d=await lexApi('/api/trabalho');
    const sectors=d?.contagens?.setores||{},total=Number(d?.contagens?.total??procs().length);
    const pending=(d?.tarefas||[]).filter(t=>['aguardando_revisao','aguardando_dados','aguardando_documento_nitido','aguardando_configuracao','falhou'].includes(t?.status)).length;
    const ai=d?.ia_estado||((d?.ia_configurada===true)?'disponivel':'sem_chave');
    const aiText=ai==='sem_credito'?'IA jurídica sem crédito: análise, redação, perfil do magistrado e jurisprudência estão pausados; banco e rotinas operacionais continuam funcionando.'
      :ai==='disponivel'?'IA jurídica disponível para os especialistas que precisam dela.'
      :'IA jurídica sem chave ativa: banco e rotinas operacionais continuam funcionando.';
    box.innerHTML='<b>LEX operacional</b><span>'+esc(total)+' processo'+(total===1?'':'s')+' no banco · '+esc(pending)+' pendência'+(pending===1?'':'s')+' de tarefa. '+esc(aiText)+'</span>';
  }catch(e){box.innerHTML='<b>LEX</b><span>Não consegui ler o estado do escritório agora. O banco não foi alterado.</span>'}
}
window.lex2Prefill=function(text){const i=document.getElementById('lex-chat-input');if(!i)return;i.value=text;i.focus()};
function settings(){
  const host=document.getElementById('content');if(!host)return;
  host.innerHTML='<main class="lex-screen lex2-settings"><header class="lex-top"><div><strong>Ajustes do escritório</strong><small>INFRAESTRUTURA</small></div><div class="lex-top-actions"><button onclick="lexChat()" aria-label="Voltar ao LEX">‹</button></div></header>'
    +'<section class="lex2-settings-grid">'
    +'<button onclick="lexEquipe()"><b>Equipe e acessos</b><small>Contas, sênior, senhas e desligamento.</small></button>'
    +'<button onclick="lexOab()"><b>Diário, PJe e eproc</b><small>Fontes oficiais e conexões judiciais.</small></button>'
    +'<button onclick="lexChannel(\'all\')"><b>WhatsApp e Telegram</b><small>Conversas e atendimento do escritório.</small></button>'
    +'<button onclick="goLex(\'escritorio\')"><b>Configurações</b><small>Dados e preferências do escritório.</small></button>'
    +'</section>'+dock()+'</main>';
}
function patch(){
  window.lexChat=render;
  window.lexHome=render;
  window.renderPainel=render;
  window.lexMais=settings;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(patch,0),{once:true});else setTimeout(patch,0);
})();
