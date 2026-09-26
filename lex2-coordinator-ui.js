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
  ['Pesquisa decisória','Perfil / padrão decisório do magistrado com decisões identificadas, fundamentos, provas e limites da amostra.',true],
  ['Pericial','Cálculos, quesitos, pareceres e análise técnica.',true],
  ['PJe','Fontes oficiais: número, partes, andamentos e expedientes nas integrações disponíveis.',false],
  ['Coordenador','Coordena o escritório inteiro, distribui ordens e acompanha a execução.',true],
  ['Redação','Produz petições, contestações, recursos e outras minutas para revisão.',true],
  ['Revisão','Confere entregas antes da liberação e devolve correções quando necessário.',true],
  ['Controladoria','Prazos, DJEN, expedientes, conferência e organização das pendências processuais.',false],
  ['Documental','Organiza documentos, autos, anexos e material vinculado ao processo.',false]
];
const OFFICE_SECTORS=[
  ['recepcao','Recepção','Recebe clientes e mensagens, identifica a demanda e encaminha.'],
  ['cadastro','Cadastro','Confere cliente, processo, documentos e dados faltantes.'],
  ['iniciais','Iniciais','Prepara o caso conferido para distribuição ou protocolo.'],
  ['processos','Processos','Mantém a carteira distribuída: partes, vara, tribunal, andamentos e situação.'],
  ['prazos','Prazos','Controladoria de DJEN, expedientes e prazos confirmados.'],
  ['pecas','Peças','Produz petições, contestações, recursos e minutas.'],
  ['pericia','Perícia','Cuida de cálculos, quesitos, pareceres e material técnico.'],
  ['revisao','Revisão','Confere entregas, devolve correções e libera a próxima etapa.'],
  ['concluidos','Concluídos','Encerra o fluxo sem apagar o histórico nem o banco do processo.']
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
  return '<details class="lex2-specialists"><summary><span><b>14 agentes do LEX</b><small>Funcionários internos que o LEX aciona automaticamente. Você não precisa escolher agente.</small></span><strong>Ver agentes</strong></summary>'
    +'<div class="lex2-specialist-grid">'+LEX_SPECIALISTS.map(([name,desc,needsAi])=>'<div class="lex2-specialist-card"><span><b>'+esc(name)+'</b><small>'+esc(desc)+'</small></span><em class="'+(needsAi?'needs-ai':'operational')+'">'+(needsAi?'IA':'OP')+'</em></div>').join('')+'</div>'
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
function processSearchText(p){
  return [p?.numero,p?.nome,p?.nome_oficial,p?.partes,p?.cliente,p?.grupo,p?.assunto,p?.tribunal,p?.vara]
    .filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
function recentProcessIds(){
  try{const a=JSON.parse(localStorage.getItem('lex_recent_processes')||'[]');return Array.isArray(a)?a.map(String).slice(0,8):[]}catch{return[]}
}
function rememberProcess(id){
  const sid=String(id||'');if(!sid)return;
  try{const next=[sid,...recentProcessIds().filter(x=>x!==sid)].slice(0,8);localStorage.setItem('lex_recent_processes',JSON.stringify(next))}catch{}
}
function searchProcesses(query,limit=12){
  const rows=procs(),q=String(query||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  if(!q){
    const recent=recentProcessIds().map(id=>rows.find(p=>String(p.id)===id)).filter(Boolean);
    const fallback=[...rows].sort((a,b)=>String(b?.atualizado_em||b?.updated_at||'').localeCompare(String(a?.atualizado_em||a?.updated_at||''))).slice(0,limit);
    const seen=new Set(),out=[];for(const p of [...recent,...fallback]){const id=String(p.id);if(seen.has(id))continue;seen.add(id);out.push(p);if(out.length>=limit)break}return out;
  }
  return rows.filter(p=>processSearchText(p).includes(q)).slice(0,limit);
}
function processPickerHtml(id){
  const p=procs().find(x=>String(x.id)===String(id||''));
  return '<div class="lex2-process-picker">'
    +'<label for="lex-process-search">Processo da conversa</label>'
    +(p?'<div class="lex2-process-selected"><span><b>'+esc(safeLabel(p))+'</b><small>'+esc(p.numero||'sem número')+'</small></span><button type="button" onclick="lexClearProcessContext()" aria-label="Remover processo do contexto">×</button></div>':'')
    +'<div class="lex2-process-search"><span>⌕</span><input id="lex-process-search" type="search" autocomplete="off" placeholder="'+(p?'Trocar processo…':'Buscar por CNJ, cliente, parte ou nome…')+'" oninput="lexSearchProcessContext(this.value)" onfocus="lexSearchProcessContext(this.value)"></div>'
    +'<input id="lex-chat-process" type="hidden" value="'+esc(String(id||''))+'">'
    +'<div id="lex-process-results" class="lex2-process-results" role="listbox" aria-label="Resultados da busca"></div>'
    +'</div>';
}
function dock(){return '<nav class="lex-dock"><button onclick="lexHome()"><b>⌂</b><span>Início</span></button><button onclick="lexProcessos()"><b>▣</b><span>Processos</span></button><button class="lex-main on" onclick="lexChat()"><b>◉</b><span>LEX</span></button><button onclick="lexPrazos()"><b>◷</b><span>Prazos</span></button><button onclick="lexMais()"><b>☰</b><span>Mais</span></button></nav>'}
function chips(id){
  if(!id)return '<nav class="lex2-context-chips" aria-label="Ações do escritório"><button type="button" onclick="lex2Prefill(\'O que precisa de mim agora?\')">O que precisa de mim</button><button type="button" onclick="lexProcessos()">Processos</button><button type="button" onclick="lexPrazos()">Prazos</button><button type="button" onclick="lexChannel(\'all\')">Mensagens</button><button type="button" onclick="lex2Prefill(\'Quero cadastrar cliente, caso ou processo. Diga o que falta e encaminhe ao Cadastro.\')">Cadastros</button><button type="button" onclick="lex2Prefill(\'Explique os setores do escritório e o que cada um tem para fazer agora.\')">Setores</button></nav>';
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
  window.lexSelectChatProcess?.(id);if(id)rememberProcess(id);
  document.body.classList.add('lex-commercial','lex2-core','lex2-coordinator');
  host.innerHTML='<main class="lex-screen lex2-lex">'
    +'<header class="lex-top"><div><strong>LEX</strong><small>COORDENADOR DO ESCRITÓRIO</small>'+(typeof lexAvisoHtml==='function'?lexAvisoHtml():'')+'</div><div class="lex-top-actions"><span class="lex2-autonomy" title="O LEX executa as tarefas; atos externos e protocolo dependem da sua aprovação">EXECUTA · APROVA</span><button onclick="lexToggleTheme()" aria-label="Tema">◐</button><button onclick="lexMais()" aria-label="Mais opções">☰</button></div></header>'
    +'<section class="lex2-lex-head"><small>'+(p?'PROCESSO EM CONTEXTO':'PORTA DO ESCRITÓRIO')+'</small><h1>'+(p?'Vamos resolver este processo.':'O que precisamos resolver?')+'</h1><p>'+(p?esc(safeLabel(p)+(p.numero?' · '+p.numero:'')):'Dê a ordem. O banco de processos permanece no centro; eu identifico o assunto, escolho entre os 9 setores oficiais, encaminho e devolvo o resultado aqui.')+'</p><div id="lex2-operational-status" class="lex2-operational-status" role="status">Conferindo o estado do escritório…</div></section>'
    // Mapas de setores e especialistas ficam recolhidos: a conversa é a tela, não o painel.
    +'<section class="lex2-office-tools">'+chips(id)+'<details class="lex2-tools-details"><summary>Setores e especialistas do escritório</summary>'+officeMap()+specialistMap()+'</details></section>'
    +'<section id="lex-conversation" class="lex-conversation" role="log" aria-label="Conversa com o LEX" aria-live="polite">'+(id?'':'<div id="lex2-briefing" class="lex2-briefing"><div class="lex-msg bot lex2-briefing-wait">Um instante. Estou lendo o estado do escritório.</div></div>')+history(id)+'</section>'
    +'<form class="lex2-command" onsubmit="return lexSendChat(event)">'
    +processPickerHtml(id)
    +'<div class="lex2-command-row"><button class="lex2-attach" data-lex-attachment type="button" aria-label="Anexar documento ao processo">＋</button><textarea id="lex-chat-input" aria-label="Sua ordem ao LEX" rows="2" placeholder="Dê uma ordem ao LEX…"></textarea><button class="lex2-send" type="submit" aria-label="Enviar">↑</button></div>'
    +'<small class="lex2-command-note">Ex.: “LEX, quero X no processo Y, faça desse jeito Z”. O banco processual é preservado; eu encaminho internamente. Atos críticos continuam sujeitos à autorização humana.</small></form>'
    +dock()+'</main>';
  setTimeout(()=>{const conv=document.getElementById('lex-conversation');if(conv)conv.scrollTop=conv.scrollHeight;refreshOperationalStatus();if(!id)renderBriefing()},40)
}
// O LEX fala primeiro: cada aviso é uma mensagem com o botão que executa a ação
// (mesmo caminho das ordens do WhatsApp/Telegram). Só prazo confirmado vira urgência.
async function renderBriefing(){
  const box=document.getElementById('lex2-briefing');if(!box||typeof window.lexBriefing!=='function')return;
  let b;
  try{b=await window.lexBriefing()}catch(e){box.innerHTML='<div class="lex-msg bot">Não consegui ler o estado do escritório agora. Não vou interpretar ausência de dado como ausência de problema.</div>';return}
  if(!box.isConnected)return;
  const items=(b.messages||[]).filter(m=>m.actions&&m.actions.length);
  const html=items.map(m=>'<div class="lex-msg bot lex2-says '+esc(m.tone||'info')+'"><p>'+esc(m.text)+'</p><div class="lex2-says-actions">'+m.actions.map(a=>'<button type="button" onclick="'+esc(a.onclick)+'">'+esc(a.label)+'</button>').join('')+'</div></div>').join('');
  const failed=b.failures&&b.failures.length?'<div class="lex-msg bot lex2-says warn"><p>Não consegui ler '+esc(b.failures.join(', '))+'. Não vou interpretar ausência de dado como ausência de problema.</p></div>':'';
  // Sem leitura completa não se afirma "nada exige você": ausência de dado não é ausência de problema.
  box.innerHTML=failed+(html||(failed?'':'<div class="lex-msg bot lex2-says ok"><p>Nada exige você agora. Aviso aqui e no WhatsApp quando chegar intimação, prazo ou mensagem de cliente.</p></div>'));
  const status=document.getElementById('lex2-operational-status');
  if(status&&b.status)status.innerHTML='<b>LEX</b><span>'+esc(b.status)+' · '+esc(b.active.length)+' processo'+(b.active.length===1?'':'s')+' acompanhado'+(b.active.length===1?'':'s')+'.</span>';
}
async function refreshOperationalStatus(){
  const box=document.getElementById('lex2-operational-status');if(!box)return;
  try{
    const d=await lexApi('/api/trabalho');
    const total=Number(d?.contagens?.total??procs().length);
    const pending=(d?.tarefas||[]).filter(t=>['aguardando_revisao','aguardando_dados','aguardando_documento_nitido','aguardando_configuracao','falhou'].includes(t?.status)).length;
    const ai=d?.ia_estado||((d?.ia_configurada===true)?'disponivel':'sem_chave');
    const aiText=ai==='sem_credito'?'IA jurídica sem crédito: análise, redação, perfil do magistrado e jurisprudência estão pausados; banco e rotinas operacionais continuam funcionando.'
      :ai==='disponivel'?'IA jurídica disponível para os especialistas que precisam dela.'
      :'IA jurídica sem chave ativa: banco e rotinas operacionais continuam funcionando.';
    box.innerHTML='<b>LEX operacional</b><span>'+esc(total)+' processo'+(total===1?'':'s')+' no banco · '+esc(pending)+' pendência'+(pending===1?'':'s')+' de tarefa. '+esc(aiText)+'</span>';
  }catch(e){box.innerHTML='<b>LEX</b><span>Não consegui ler o estado do escritório agora. O banco não foi alterado.</span>'}
}
window.lex2Prefill=function(text){const i=document.getElementById('lex-chat-input');if(!i)return;i.value=text;i.focus()};
window.lexSearchProcessContext=function(query){
  const box=document.getElementById('lex-process-results');if(!box)return;
  const rows=searchProcesses(query,12);
  box.innerHTML=rows.map(p=>'<button type="button" role="option" onclick="lexChooseProcessContext(\''+esc(String(p.id))+'\')"><span><b>'+esc(safeLabel(p))+'</b><small>'+esc([p.numero,p.cliente||p.tribunal||p.vara].filter(Boolean).join(' · '))+'</small></span></button>').join('')
    +(procs().length>12?'<small class="lex2-process-result-note">Mostrando no máximo 12 resultados. Refine a busca para localizar outro processo.</small>':'');
  box.classList.toggle('open',rows.length>0);
};
window.lexChooseProcessContext=function(id){rememberProcess(id);window.lexSelectChatProcess?.(id);render(id)};
window.lexClearProcessContext=function(){window.lexSelectChatProcess?.('');render('')};
function settings(){
  const host=document.getElementById('content');if(!host)return;
  host.innerHTML='<main class="lex-screen lex2-settings"><header class="lex-top"><div><strong>Ajustes do escritório</strong><small>INFRAESTRUTURA</small></div><div class="lex-top-actions"><button onclick="lexChat()" aria-label="Voltar ao LEX">‹</button></div></header>'
    +'<section class="lex2-settings-grid">'
    +'<button onclick="lexRecibos()"><b>O que o LEX fez hoje</b><small>Recibos: mensagens, andamentos, prazos e tarefas, com hora e autorização.</small></button>'
    +'<button onclick="lexTarefas()"><b>Tarefas</b><small>Entregas em andamento e minutas para sua revisão.</small></button>'
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
