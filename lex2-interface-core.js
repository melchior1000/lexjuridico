(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const procs=()=>{try{return typeof getProcs==='function'?(getProcs()||[]):[]}catch{return[]}};
const list=v=>Array.isArray(v)?v:[];
const dock=()=>'<nav class="lex-dock"><button class="on" onclick="lexHome()"><b>⌂</b><span>Início</span></button><button onclick="lexProcessos()"><b>▣</b><span>Processos</span></button><button class="lex-main" onclick="lexChat()"><b>◉</b><span>LEX</span></button><button onclick="lexPrazos()"><b>◷</b><span>Prazos</span></button><button onclick="lexMais()"><b>☰</b><span>Mais</span></button></nav>';
function days(p){
 const raw=p?.prazoReal||p?.prazo||p?.dataPrazo||p?.next_action_due_at;if(!raw)return 9999;
 let d;if(/^\d{2}\/\d{2}\/\d{4}$/.test(raw)){const[a,b,c]=raw.split('/');d=new Date(+c,+b-1,+a)}else if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){const[y,m,day]=raw.split('-');d=new Date(+y,+m-1,+day)}else d=new Date(raw);
 if(Number.isNaN(d.getTime()))return 9999;const n=new Date();n.setHours(0,0,0,0);d.setHours(0,0,0,0);return Math.round((d-n)/86400000);
}
const taskStates={aguardando_dados:['Informação necessária','Complete as informações indicadas na tarefa.'],aguardando_documento_nitido:['Documento ilegível','Envie uma cópia legível do documento solicitado.'],aguardando_documento:['Documento necessário','Confira o documento solicitado e anexe ao processo.'],aguardando_configuracao:['Configuração pendente','Confira a configuração indicada antes de tentar novamente.'],aguardando_revisao:['Entrega para revisão','Leia a minuta e registre sua decisão de revisão.'],bloqueada:['Tarefa bloqueada','Confira o impedimento antes de continuar.'],falhou:['Tarefa interrompida','Confira o motivo da falha antes de tentar novamente.']};
function deadlineTitle(days){
 if(days<0)return'Prazo confirmado vencido';
 if(days===0)return'Prazo confirmado vence hoje';
 if(days===1)return'Prazo confirmado vence amanhã';
 return'Prazo confirmado em '+days+' dias';
}
async function mintDjenDeadline(row){
 const ps=procs(),p=ps.find(x=>String(x.id)===String(row.processo_id));
 const resumo=[p?.nome||p?.numero||row.cnj||'Processo',row.tipo||'Intimação DJEN',String(row.texto||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,1200)].filter(Boolean).join('\n\n');
 if(typeof confirm==='function'&&!confirm(resumo+'\n\nConfirme somente depois de ler o teor da intimação. Continuar para informar o vencimento?'))return;
 const due=typeof prompt==='function'?prompt('Informe o vencimento CONFIRMADO pelo responsável (AAAA-MM-DD). O LEX não calcula nem adivinha esta data:'):null;
 if(due==null)return;
 const clean=String(due).trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(clean))throw new Error('Informe a data confirmada no formato AAAA-MM-DD.');
 const regime=typeof prompt==='function'?(prompt('Regime do prazo (ex.: cpc, clt ou manual):','manual')||'manual'):'manual';
 await lexApi('/api/escritorio/prazos/cunhar',{method:'POST',body:JSON.stringify({djen_id:row.djen_id,due_at:clean,regime:String(regime).trim()||'manual'})});
 await today();
}
async function today(){
 const host=document.getElementById('content');if(!host)return;
 document.body.classList.add('lex-commercial','lex2-core');
 host.innerHTML='<main class="lex-screen lex-today"><header class="lex-top"><div><strong>LEX</strong><small>SEU ESCRITÓRIO</small></div><div class="lex-top-actions"><button onclick="lexToggleTheme()" aria-label="Tema">◐</button><button onclick="lexMais()" aria-label="Mais opções">☰</button></div></header><section class="lex-today-head"><small>PRECISA DE VOCÊ</small><h1>Conferindo suas pendências…</h1><p>Buscando tarefas e mensagens.</p><button class="lex-today-talk" onclick="lexChat()">Falar com o LEX <span>↗</span></button></section><div class="lex-today-feedback" role="status"></div><section class="lex-today-list" aria-label="Pendências"></section>'+dock()+'</main>';
 const surface=host.firstElementChild,ps=procs(),items=[],failures=[];
 const openProcess=id=>()=>window.lexOpenProc(id);
 for(const p of ps){const d=days(p);if(d<=0&&!p.deadline_truth)items.push({rank:0,tone:'critical',who:p.nome||p.partes||p.numero||'Processo',meta:p.numero||'Processo sem número',title:d<0?'Prazo cadastrado vencido':'Prazo cadastrado para hoje',detail:'Confirme a situação jurídica antes de agir. Este prazo legado ainda não possui verdade jurídica assinada.',label:'Ver processo',action:openProcess(String(p.id))})}
 const results=await Promise.allSettled([lexApi('/api/trabalho'),lexApi('/api/escritorio/recepcao')]);
 if(!surface.isConnected)return;
 const tasks=results[0],reception=results[1];
 if(tasks.status==='fulfilled'&&Array.isArray(tasks.value?.tarefas)){
  for(const t of tasks.value.tarefas){const state=taskStates[t.status];if(!state)continue;const p=ps.find(x=>String(x.id)===String(t.processo_id));items.push({rank:1,tone:'blocked',who:t.processo_nome||p?.nome||p?.partes||'Tarefa do escritório',meta:[t.tipo,p?.numero].filter(Boolean).join(' · '),title:state[0],detail:t.pendencia||t.motivo||state[1],label:t.status==='aguardando_revisao'?'Revisar entrega':'Ver tarefa e corrigir',action:()=>window.lexTarefas(String(t.id))})}
  const desk=tasks.value.prazos||{};
  for(const d of list(desk.cunhar)){const p=ps.find(x=>String(x.id)===String(d.processo_id));items.push({rank:0,tone:'critical',who:p?.nome||p?.partes||d.cnj||'Processo',meta:[d.cnj,'DJEN',d.data_disponibilizacao].filter(Boolean).join(' · '),title:'Intimação sem prazo confirmado',detail:String(d.texto||'Leia o teor da comunicação e informe o vencimento confirmado pelo responsável.').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,420),label:'Ler e confirmar prazo',action:()=>mintDjenDeadline(d)})}
  for(const d of list(desk.correndo)){const p=ps.find(x=>String(x.id)===String(d.case_id));items.push({rank:d.days_to_due<=1?0:1,tone:d.days_to_due<=1?'critical':'waiting',who:p?.nome||p?.partes||d.titulo||'Processo',meta:[p?.numero,d.djen_id_origem?'DJEN '+d.djen_id_origem:'Prazo confirmado'].filter(Boolean).join(' · '),title:deadlineTitle(Number(d.days_to_due)),detail:'Vencimento confirmado: '+String(d.prazo||'')+'. O LEX está monitorando este prazo.',label:'Abrir processo',action:openProcess(String(d.case_id))})}
  if(desk.erro)failures.push('prazos');
  if(desk.vigia&&(desk.vigia.status==='retry'||desk.vigia.djen_status==='failed'))items.push({rank:0,tone:'critical',who:'Vigia de intimações',meta:'DJEN',title:'Diário sem confirmação de leitura',detail:'O LEX registrou falha na leitura do diário e não está fingindo que a fonte está atualizada.',label:'Ver integrações',action:()=>window.lexMais()});
 }else failures.push('tarefas');
 if(reception.status==='fulfilled'&&Array.isArray(reception.value?.contatos||reception.value?.itens||reception.value?.recepcao)){
  for(const r of reception.value.contatos||reception.value.itens||reception.value.recepcao){if(r.status==='arquivado')continue;const channel=r.origem||r.canal,id=String(r.id||r.numero||'');const specific=['whatsapp','telegram'].includes(channel)&&!!id;items.push({rank:r.urgente?0:2,tone:'waiting',who:r.nome||r.cliente||'Cliente aguardando',meta:channel==='telegram'?'Telegram':channel==='whatsapp'?'WhatsApp':'Recepção',title:'Aguardando sua resposta',detail:r.assunto||r.ultima_mensagem||'Abra a conversa e confira o pedido antes de responder.',label:specific?'Abrir esta conversa':'Ver mensagens',action:async()=>{await window.lexChannel(specific?channel:'all');if(specific&&document.getElementById('lex-channel-console'))await window.lexSelectChannelContact(channel,id)}})}
 }else failures.push('mensagens');
 for(const p of ps){for(const d of [...list(p.entrada_processual),...list(p.arquivos),...list(p.recebimentos)]){if(/quar|confer|reject/i.test(String(d.status||d.motivo||'')))items.push({rank:1,tone:'quarantine',who:p.nome||p.partes||p.numero||'Processo',meta:d.nome||d.arquivo||'Documento em quarentena',title:'Documento precisa de conferência',detail:d.motivo||'Confira o documento antes de liberar a produção.',label:'Conferir no processo',action:openProcess(String(p.id))})}}
 items.sort((a,b)=>a.rank-b.rank);
 const head=surface.querySelector('.lex-today-head');head.querySelector('h1').textContent=items.length?items.length+(items.length===1?' pendência precisa':' pendências precisam')+' de você.':failures.length?'Não foi possível conferir tudo.':'Nenhuma pendência encontrada.';head.querySelector('p').textContent='Só mostramos decisões e exceções reais. Confira a pessoa, o motivo e a próxima ação.';
 const feedback=surface.querySelector('.lex-today-feedback');if(failures.length){feedback.textContent='Não consegui consultar '+failures.join(' e ')+'. A lista pode estar incompleta. ';const retry=document.createElement('button');retry.textContent='Tentar novamente';retry.onclick=today;feedback.appendChild(retry)}
 const target=surface.querySelector('.lex-today-list');target.innerHTML=items.length?items.map((x,i)=>'<article class="lex-today-item '+x.tone+'"><div><small>'+esc(x.meta)+'</small><h2>'+esc(x.who)+'</h2><strong>'+esc(x.title)+'</strong><p>'+esc(x.detail)+'</p></div><button data-today-action="'+i+'">'+esc(x.label)+'</button></article>').join(''):'<div class="lex-today-clear"><strong>'+(failures.length?'Consulta incompleta':'Você está em dia com a lista consultada.')+'</strong><span>'+(failures.length?'Tente novamente para conferir as pendências.':'Abra o LEX para iniciar uma nova tarefa.')+'</span></div>';
 target.addEventListener('click',event=>{const button=event.target.closest('[data-today-action]');if(!button)return;const item=items[Number(button.dataset.todayAction)];if(item)Promise.resolve().then(item.action).catch(()=>{if(surface.isConnected)feedback.textContent='Não consegui abrir esta pendência. Tente novamente.'})});
}
function patch(){window.lexHome=today;window.renderPainel=today;const previous=window.ir;if(typeof previous==='function'&&!previous.__lexToday){const route=function(page){if(page==='painel')return today();return previous.apply(this,arguments)};route.__lexToday=true;window.ir=route}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(patch,0),{once:true});else setTimeout(patch,0);
})();
