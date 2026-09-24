(function(){
'use strict';
const esc=v=>(globalThis.lexFixText||String)(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
function djenSuggestion(row){return row?.prazo_sugestao&&typeof row.prazo_sugestao==='object'?row.prazo_sugestao:null}
function prazoLabel(s){
 if(!s?.dias)return'';
 return s.dias+' dia'+(s.dias===1?'':'s')+(s.modo==='uteis'?' úteis':s.modo==='corridos'?' corridos':'');
}
async function postDjenDeadline(row,due,regime,note,suggestionSourceHash=null){
 const clean=String(due||'').trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(clean))throw new Error('Informe a data confirmada no formato AAAA-MM-DD.');
 await lexApi('/api/escritorio/prazos/cunhar',{method:'POST',body:JSON.stringify({djen_id:row.djen_id,due_at:clean,regime:String(regime||'manual').trim()||'manual',observacao:String(note||''),suggestion_source_hash:suggestionSourceHash||null})});
 await today();
}
async function confirmDjenSuggestion(row){
 const s=djenSuggestion(row);
 if(!s?.due_at_proposto)return correctDjenDeadline(row);
 const ps=procs(),p=ps.find(x=>String(x.id)===String(row.processo_id));
 const resumo=[
   p?.nome||p?.numero||row.cnj||'Processo',
   row.tipo||'Intimação DJEN',
   s.trecho?'Trecho identificado: '+s.trecho:null,
   prazoLabel(s)?'Prazo identificado: '+prazoLabel(s):null,
   'Vencimento PROPOSTO pelo LEX: '+s.due_at_proposto,
   s.calendario_verificado===true?'Calendário marcado como verificado.':'Calendário local NÃO verificado: confira feriados/suspensões.',
   '',
   'Esta data ainda NÃO é prazo jurídico do LEX. Ela só vira prazo após sua confirmação.'
 ].filter(x=>x!==null).join('\n');
 if(typeof confirm==='function'&&!confirm(resumo+'\n\nConfirmar este vencimento?'))return;
 await postDjenDeadline(row,s.due_at_proposto,s.regime||'manual','Confirmado a partir da sugestão assistiva do DJEN.',s.source_hash||null);
}
async function correctDjenDeadline(row){
 const s=djenSuggestion(row),ps=procs(),p=ps.find(x=>String(x.id)===String(row.processo_id));
 const resumo=[p?.nome||p?.numero||row.cnj||'Processo',row.tipo||'Intimação DJEN',s?.trecho?'Trecho identificado: '+s.trecho:String(row.texto||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,900)].filter(Boolean).join('\n\n');
 if(typeof confirm==='function'&&!confirm(resumo+'\n\nConfira o teor antes de informar o vencimento confirmado.'))return;
 const due=typeof prompt==='function'?prompt('Informe/corrija o vencimento CONFIRMADO (AAAA-MM-DD):',s?.due_at_proposto||''):null;
 if(due==null)return;
 const regime=typeof prompt==='function'?(prompt('Regime do prazo (cpc, clt ou manual):',s?.regime||'manual')||'manual'):(s?.regime||'manual');
 await postDjenDeadline(row,due,regime,'Vencimento informado/corrigido manualmente após leitura da intimação.',s?.source_hash||null);
}
function cnjDigitsOk(d){d=String(d||'').replace(/\D/g,'');if(d.length!==20)return false;if(typeof BigInt!=='function')return true;const r=Number(BigInt(d.slice(0,7)+d.slice(9)+'00')%97n);return String(98-r).padStart(2,'0')===d.slice(7,9)}
function cnjProblem(p){if(/CONCLU|ARQUIV|ENTREGUE|GANHO|PERDIDO/i.test(String(p?.status||'')))return false;if(/administr|extrajud|consult/i.test(String(p?.tipo||'')+' '+String(p?.setor||'')))return false;const m=String(p?.numero||'').match(/^\s*(\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4})/);return !m||!cnjDigitsOk(m[1])}
function askLex(text){if(typeof window.lexAskLex==='function')return window.lexAskLex(text);return window.lexChat?.()}
async function today(showAll=false){showAll=showAll===true;
 const host=document.getElementById('content');if(!host)return;
 document.body.classList.add('lex-commercial','lex2-core');
 host.innerHTML='<main class="lex-screen lex-today"><header class="lex-top"><div><strong>LEX</strong><small>SEU ESCRITÓRIO</small></div><div class="lex-top-actions"><button onclick="lexToggleTheme()" aria-label="Tema">◐</button><button onclick="lexMais()" aria-label="Mais opções">☰</button></div></header><section class="lex-today-head"><small>PRECISA DE VOCÊ</small><h1>Conferindo suas pendências…</h1><p>Buscando tarefas e mensagens.</p><button class="lex-today-talk" onclick="lexChat()">Falar com o LEX <span>↗</span></button></section><div class="lex-today-feedback" role="status"></div><section class="lex-today-list" aria-label="Pendências"></section>'+dock()+'</main>';
 const surface=host.firstElementChild,ps=procs(),items=[],failures=[];
 const openProcess=id=>()=>window.lexOpenProc(id);
 for(const p of ps){const d=days(p);if(d<=0&&!p.deadline_truth)items.push({rank:0,tone:'critical',who:p.nome||p.partes||p.numero||'Processo',meta:p.numero||'Processo sem número',title:d<0?'Prazo cadastrado vencido':'Prazo cadastrado para hoje',detail:d<0?'O prazo anotado no LEX já passou. Confira no tribunal se foi cumprido e atualize o processo.':'O prazo anotado no LEX vence hoje. Confira no tribunal antes de agir.',label:'Ver processo',action:openProcess(String(p.id))})}
 const results=await Promise.allSettled([lexApi('/api/trabalho'),lexApi('/api/escritorio/recepcao')]);
 if(!surface.isConnected)return;
 const tasks=results[0],reception=results[1];
 if(tasks.status==='fulfilled'&&Array.isArray(tasks.value?.tarefas)){
  for(const t of tasks.value.tarefas){const state=taskStates[t.status];if(!state)continue;const p=ps.find(x=>String(x.id)===String(t.processo_id));items.push({rank:1,tone:'blocked',who:t.processo_nome||p?.nome||p?.partes||'Tarefa do escritório',meta:[t.tipo,p?.numero].filter(Boolean).join(' · '),title:state[0],detail:t.pendencia||t.motivo||state[1],label:t.status==='aguardando_revisao'?'Revisar entrega':'Ver tarefa e corrigir',action:()=>window.lexTarefas(String(t.id))})}
  const desk=tasks.value.prazos||{};
  for(const d of list(desk.cunhar)){
   const p=ps.find(x=>String(x.id)===String(d.processo_id)),s=djenSuggestion(d),hasProposal=!!s?.due_at_proposto;
   const detail=hasProposal
     ?['Texto indica '+prazoLabel(s)+'.','Vencimento sugerido: '+s.due_at_proposto+'.',s.calendario_verificado===true?'Calendário verificado.':'Confira feriados e suspensões locais.',s.trecho?'Trecho: '+s.trecho:''].filter(Boolean).join(' ')
     :String(d.texto||'Nenhum prazo foi identificado automaticamente. Leia o teor e informe o vencimento confirmado.').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,420);
   items.push({rank:0,tone:'critical',who:p?.nome||p?.partes||d.cnj||'Processo',meta:[d.cnj,'DJEN',d.data_disponibilizacao].filter(Boolean).join(' · '),title:hasProposal?'Prazo sugerido — falta sua confirmação':'Intimação sem prazo confirmado',detail,label:hasProposal?'Confirmar '+s.due_at_proposto:'Ler e confirmar prazo',action:()=>hasProposal?confirmDjenSuggestion(d):correctDjenDeadline(d),secondaryLabel:hasProposal?'Corrigir':null,secondaryAction:hasProposal?()=>correctDjenDeadline(d):null})
  }
  for(const d of list(desk.correndo)){const p=ps.find(x=>String(x.id)===String(d.case_id));items.push({rank:d.days_to_due<=1?0:1,tone:d.days_to_due<=1?'critical':'waiting',who:p?.nome||p?.partes||d.titulo||'Processo',meta:[p?.numero,d.djen_id_origem?'DJEN '+d.djen_id_origem:'Prazo confirmado'].filter(Boolean).join(' · '),title:deadlineTitle(Number(d.days_to_due)),detail:'Vencimento confirmado: '+String(d.prazo||'')+'. O LEX está monitorando este prazo.',label:'Abrir processo',action:openProcess(String(d.case_id))})}
  if(desk.erro)failures.push('prazos');
  if(desk.vigia&&(desk.vigia.status==='retry'||desk.vigia.status==='blocked'||desk.vigia.djen_status==='failed'||desk.vigia.djen_status==='not_configured')){
    const semConfig=desk.vigia.djen_status==='not_configured';
    items.push({rank:0,tone:'critical',who:'Vigia de intimações',meta:'DJEN',title:semConfig?'Diário ainda não configurado':'Diário sem confirmação de leitura',detail:semConfig?'O LEX ainda não tem uma OAB definida para vigiar o DJEN. Até isso ser configurado, não considere o diário monitorado.':'O LEX registrou falha na leitura do diário e não está fingindo que a fonte está atualizada.',label:'Ver integrações',action:()=>window.lexMais()});
  }
 }else failures.push('tarefas');
 if(reception.status==='fulfilled'&&Array.isArray(reception.value?.contatos||reception.value?.itens||reception.value?.recepcao)){
  for(const r of reception.value.contatos||reception.value.itens||reception.value.recepcao){if(r.status==='arquivado')continue;const channel=r.origem||r.canal,id=String(r.id||r.numero||'');const specific=['whatsapp','telegram'].includes(channel)&&!!id;items.push({rank:r.urgente?0:2,tone:'waiting',who:r.nome||r.cliente||'Cliente aguardando',meta:channel==='telegram'?'Telegram':channel==='whatsapp'?'WhatsApp':'Recepção',title:'Aguardando sua resposta',detail:r.assunto||r.ultima_mensagem||'Abra a conversa e confira o pedido antes de responder.',label:specific?'Abrir esta conversa':'Ver mensagens',action:async()=>{await window.lexChannel(specific?channel:'all');if(specific&&document.getElementById('lex-channel-console'))await window.lexSelectChannelContact(channel,id)}})}
 }else failures.push('mensagens');
 for(const p of ps){for(const d of [...list(p.entrada_processual),...list(p.arquivos),...list(p.recebimentos)]){if(/quar|confer|reject/i.test(String(d.status||d.motivo||'')))items.push({rank:1,tone:'quarantine',who:p.nome||p.partes||p.numero||'Processo',meta:d.nome||d.arquivo||'Documento em quarentena',title:'Documento precisa de conferência',detail:d.motivo||'Confira o documento antes de liberar a produção.',label:'Conferir no processo',action:openProcess(String(p.id))})}}
 // Número CNJ faltando ou com dígito verificador errado (processos judiciais ativos): um cartão só.
 const cnjBad=ps.filter(cnjProblem);
 if(cnjBad.length)items.push({rank:1,tone:'blocked',who:cnjBad.length===1?(cnjBad[0].nome||'Processo'):cnjBad.length+' processos',meta:'Número CNJ',title:cnjBad.length===1?'Número CNJ faltando ou errado':'Números CNJ faltando ou errados',detail:'Sem o número certo o LEX não acompanha o tribunal. Eu procuro o número nas publicações da sua OAB e você só confirma.',label:'Corrigir com o LEX',action:()=>askLex('confira os números dos meus processos')});
 // Muitos do mesmo tipo viram um cartão só: o advogado vê o assunto, o LEX lista os casos.
 const group=(pred,make)=>{const same=items.filter(pred);if(same.length<3)return;const first=items.indexOf(same[0]);for(const x of same)items.splice(items.indexOf(x),1);items.splice(first,0,make(same))};
 group(x=>x.title==='Prazo cadastrado vencido',g=>({rank:0,tone:'critical',who:g.length+' processos',meta:'Prazos anotados no LEX',title:'Prazos cadastrados vencidos',detail:'Confira no tribunal se foi cumprido: '+g.slice(0,3).map(x=>x.who).join(', ')+(g.length>3?' e mais '+(g.length-3):'')+'.',label:'Resolver com o LEX',action:()=>askLex('prazos vencidos')}));
 group(x=>x.title==='Prazo cadastrado para hoje',g=>({rank:0,tone:'critical',who:g.length+' processos',meta:'Prazos anotados no LEX',title:'Prazos cadastrados para hoje',detail:'Confira no tribunal antes de agir: '+g.slice(0,3).map(x=>x.who).join(', ')+(g.length>3?' e mais '+(g.length-3):'')+'.',label:'Resolver com o LEX',action:()=>askLex('prazos de hoje')}));
 group(x=>x.title==='Aguardando sua resposta',g=>({rank:g.some(x=>x.rank===0)?0:2,tone:'waiting',who:g.length+' clientes',meta:'Recepção',title:'Aguardando sua resposta',detail:g.slice(0,3).map(x=>x.who).join(', ')+(g.length>3?' e mais '+(g.length-3):'')+'.',label:'Ver mensagens',action:()=>window.lexChannel('all')}));
 items.sort((a,b)=>a.rank-b.rank);
 const head=surface.querySelector('.lex-today-head');{const lbl=head.querySelector('small');if(lbl)lbl.textContent='O LEX INFORMA'}head.querySelector('h1').textContent=items.length?(items.length===1?'Um assunto precisa de você.':items.length+' assuntos precisam de você.'):failures.length?'Não foi possível conferir tudo.':'Tudo em dia.';head.querySelector('p').textContent='Acompanho '+ps.filter(p=>!/CONCLU|ARQUIV|ENTREGUE|GANHO|PERDIDO/i.test(String(p.status||''))).length+' processos. Só mostramos decisões e exceções reais.';
 const feedback=surface.querySelector('.lex-today-feedback');if(failures.length){feedback.textContent='Não consegui consultar '+failures.join(' e ')+'. A lista pode estar incompleta. ';const retry=document.createElement('button');retry.textContent='Tentar novamente';retry.onclick=today;feedback.appendChild(retry)}
 const target=surface.querySelector('.lex-today-list');const LIMIT=3,shown=showAll?items:items.slice(0,LIMIT);target.innerHTML=items.length?shown.map((x,i)=>'<article class="lex-today-item '+x.tone+'"><div><small>'+esc(x.meta)+'</small><h2>'+esc(x.who)+'</h2><strong>'+esc(x.title)+'</strong><p>'+esc(x.detail)+'</p></div><div class="lex-today-actions"><button data-today-action="'+i+'">'+esc(x.label)+'</button>'+(x.secondaryLabel?'<button data-today-secondary="'+i+'">'+esc(x.secondaryLabel)+'</button>':'')+'</div></article>').join('')+(items.length>shown.length?'<button class="lex-today-more" data-today-more>Ver os outros '+(items.length-shown.length)+'</button>':''):'<div class="lex-today-clear"><strong>'+(failures.length?'Consulta incompleta':'Você está em dia com a lista consultada.')+'</strong><span>'+(failures.length?'Tente novamente para conferir as pendências.':'Abra o LEX para iniciar uma nova tarefa.')+'</span></div>';
 target.addEventListener('click',event=>{{const more=event.target.closest('[data-today-more]');if(more&&more.dataset?.todayMore!==undefined){today(true);return}}const secondaryCandidate=event.target.closest('[data-today-secondary]'),primaryCandidate=event.target.closest('[data-today-action]');const secondary=secondaryCandidate?.dataset?.todaySecondary!==undefined?secondaryCandidate:null,primary=primaryCandidate?.dataset?.todayAction!==undefined?primaryCandidate:null,button=secondary||primary;if(!button)return;const index=Number(secondary?button.dataset.todaySecondary:button.dataset.todayAction),item=items[index],action=secondary?item?.secondaryAction:item?.action;if(action)Promise.resolve().then(action).catch(()=>{if(surface.isConnected)feedback.textContent='Não consegui abrir esta pendência. Tente novamente.'})});
}
function patch(){window.lexHome=today;window.renderPainel=today;const previous=window.ir;if(typeof previous==='function'&&!previous.__lexToday){const route=function(page){if(page==='painel')return today();return previous.apply(this,arguments)};route.__lexToday=true;window.ir=route}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(patch,0),{once:true});else setTimeout(patch,0);
})();
