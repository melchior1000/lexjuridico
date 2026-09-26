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
function sheet(title,onClose){
 document.querySelector?.('.lex-sheet')?.remove?.();
 const previous=document.activeElement;
 const el=document.createElement('div');el.className='lex-sheet';
 el.innerHTML='<div class="lex-sheet-card" role="dialog" aria-modal="true" aria-label="'+esc(title)+'" tabindex="-1"><header><strong>'+esc(title)+'</strong><button type="button" class="lex-sheet-x" aria-label="Fechar">×</button></header><div class="lex-sheet-body"><p class="lex-sheet-lead">Conferindo…</p></div></div>';
 let closed=false;
 const close=()=>{if(closed)return;closed=true;el.remove();previous?.focus?.();if(onClose)onClose()};
 el.addEventListener('click',e=>{if(e.target===el||e.target.closest?.('.lex-sheet-x'))close()});
 el.addEventListener('keydown',e=>{
   if(e.key==='Escape'){e.preventDefault?.();close();return}
   if(e.key!=='Tab')return;
   const focusables=[...(el.querySelectorAll?.('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')||[])].filter(x=>x.offsetParent!==null||x===document.activeElement);
   if(!focusables.length)return;
   const first=focusables[0],last=focusables[focusables.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault?.();last.focus?.()}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault?.();first.focus?.()}
 });
 document.body.appendChild(el);
 setTimeout(()=>{(el.querySelector?.('.lex-sheet-x')||el.querySelector?.('.lex-sheet-card'))?.focus?.()},0);
 return{el,body:el.querySelector('.lex-sheet-body'),close};
}
async function pullProcs(){try{if(typeof verificarESincronizar==='function')await verificarESincronizar()}catch{/* a sincronização periódica traz depois */}}
const onHome=()=>!!document.querySelector?.('.lex-today');
const refreshHome=()=>{if(onHome())today()};
// Números CNJ: o LEX confere, acha o número nas publicações da OAB e corrige em lote.
async function fixCnj(){
 const s=sheet('Números dos processos',refreshHome);
 let r;try{r=await lexApi('/api/escritorio/processos/conferencia')}catch(e){s.body.innerHTML='<p class="lex-sheet-err">'+esc(e.message||'Não consegui conferir agora.')+'</p>';return}
 const probs=list(r?.problemas),found=probs.filter(p=>list(p.sugestoes).length),missing=probs.filter(p=>!list(p.sugestoes).length);
 if(!probs.length){s.body.innerHTML='<p class="lex-sheet-ok">✓ Conferi '+(r?.total||0)+' processos judiciais: todos os números são válidos.</p>';return}
 const sug=x=>esc(x.numero)+(x.tribunal?' · '+esc(x.tribunal):'');
 s.body.innerHTML=(found.length?'<p class="lex-sheet-lead">Achei nas publicações da sua OAB o número certo de '+found.length+(found.length>1?' processos':' processo')+'. Ao aplicar, o LEX já traz as publicações de cada um.</p>'
   +found.map((p,i)=>'<label class="lex-fix-row" data-fix="'+i+'"><input type="checkbox" checked data-fix-check="'+i+'"><span><b>'+esc(p.nome)+'</b><small>'+(p.numero_atual?'Hoje: '+esc(p.numero_atual.slice(0,48)):'Sem número')+'</small>'
     +(p.sugestoes.length>1?'<select data-fix-pick="'+i+'">'+p.sugestoes.map(x=>'<option value="'+esc(x.numero)+'">'+sug(x)+'</option>').join('')+'</select>':'<em>→ '+sug(p.sugestoes[0])+'</em>')
     +(p.sugestoes[0].motivo?'<small>'+esc(p.sugestoes[0].motivo)+'</small>':'')+'</span></label>').join('')
   +'<button class="lex-sheet-main" data-fix-apply>Aplicar '+(found.length>1?found.length+' correções':'correção')+'</button>':'')
  +(missing.length?'<p class="lex-sheet-lead">'+(found.length?'Estes não têm publicação para eu achar o número. Digite e eu gravo:':'Não achei o número destes nas publicações da sua OAB. Digite e eu gravo:')+'</p>'
   +missing.map((p,i)=>'<div class="lex-fix-row manual" data-miss="'+i+'"><span><b>'+esc(p.nome)+'</b><small>'+esc(p.motivo)+'</small></span><div class="lex-fix-input"><input inputmode="numeric" autocomplete="off" placeholder="0000000-00.0000.0.00.0000" data-fix-num="'+i+'"><button data-fix-save="'+i+'">Gravar</button></div></div>').join(''):'')
  +'<p class="lex-sheet-msg" role="status"></p>';
 const msg=s.body.querySelector('.lex-sheet-msg');
 const post=(id,numero)=>lexApi('/api/escritorio/processos/numero',{method:'POST',body:JSON.stringify({processo_id:id,numero}),timeoutMs:90000});
 const said=out=>[out.publicacoes?out.publicacoes+' publicação(ões) do Diário':null,out.diario_erro?'Diário com falha: '+out.diario_erro:null,out.tribunal==='atualizado'?'tribunal atualizado':null].filter(Boolean).join(', ');
 s.body.addEventListener('click',async e=>{
  const apply=e.target.closest?.('[data-fix-apply]'),save=e.target.closest?.('[data-fix-save]');
  if(apply){
   apply.disabled=true;apply.textContent='Corrigindo…';let ok=0;const errs=[],extras=[];
   for(const [i,p] of found.entries()){
    const row=s.body.querySelector('[data-fix="'+i+'"]');if(row?.classList?.contains('done'))continue;
    const chk=s.body.querySelector('[data-fix-check="'+i+'"]');if(chk&&!chk.checked)continue;
    const pick=s.body.querySelector('[data-fix-pick="'+i+'"]');
    try{const out=await post(p.id,pick?pick.value:p.sugestoes[0].numero);ok++;row?.classList?.add('done');const x=said(out);if(x)extras.push(p.nome+': '+x)}
    catch(err){errs.push(p.nome+': '+(err.message||'erro'))}
   }
   msg.textContent=[ok?'✓ Corrigi '+ok+(ok>1?' números.':' número.'):null,extras.length?'Trouxe '+extras.join('; ')+'.':null,errs.length?'Não corrigi: '+errs.join('; '):null].filter(Boolean).join(' ');
   await pullProcs();
   apply.textContent=errs.length?'Tentar de novo':'Feito ✓';apply.disabled=!errs.length;return;
  }
  if(save){
   const i=Number(save.dataset.fixSave),p=missing[i],input=s.body.querySelector('[data-fix-num="'+i+'"]'),numero=String(input?.value||'').trim();
   if(numero.replace(/\D/g,'').length!==20){msg.textContent='Digite o número CNJ completo (20 dígitos).';input?.focus?.();return}
   save.disabled=true;save.textContent='…';
   try{const out=await post(p.id,numero);s.body.querySelector('[data-miss="'+i+'"]')?.classList?.add('done');save.textContent='✓';const x=said(out);msg.textContent='✓ Número de '+p.nome+' gravado.'+(x?' Trouxe '+x+'.':'');await pullProcs()}
   catch(err){save.disabled=false;save.textContent='Gravar';msg.textContent=err.message||'Não consegui gravar.'}
  }
 });
}
// Prazo confirmado vencido: baixa/Desfazer são atômicos no servidor.
function deadlineTruthDue(p){
 const t=p?.deadline_truth;
 if(t&&typeof t==='object'&&t.legal_truth===true&&t.due_at)return String(t.due_at);
 if(t===true)return String(p?.prazoReal||p?.prazo||p?.dataPrazo||p?.next_action_due_at||'');
 return'';
}
function formatPrazo(v){const raw=String(v||'');const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:raw}
function prazoOf(p){return formatPrazo(deadlineTruthDue(p)||p?.prazoReal||p?.prazo||p?.dataPrazo||p?.next_action_due_at||'')}
function deadlineDays(p){
 const raw=deadlineTruthDue(p);if(!raw)return 9999;
 const copy={prazoReal:raw};return days(copy);
}
function prazosSheet(ids){
 const s=sheet(ids.length>1?'Prazos vencidos':'Prazo vencido',refreshHome),marked=new Set();
 const render=()=>{
  const rows=procs().filter(p=>ids.includes(String(p.id)));
  s.body.innerHTML='<p class="lex-sheet-lead">Este prazo foi confirmado no LEX e já venceu. Confira no tribunal se foi cumprido; a baixa e o Desfazer são gravados no servidor sem sobrescrever outros dados do processo.</p>'
   +rows.map(p=>{const id=String(p.id),done=marked.has(id)||p?.prazo_baixa?.ativa===true;return'<div class="lex-fix-row'+(done?' done':'')+'"><span><b>'+esc(safeCaseLabel(p))+'</b><small>'+(done?'✓ Cumprido · registrado no histórico':'Prazo confirmado: '+esc(prazoOf(p)||'—'))+'</small></span><div class="lex-row-actions">'
     +(done?'<button type="button" data-undo="'+esc(id)+'">Desfazer baixa</button>':'<button type="button" class="ok" data-done="'+esc(id)+'">Cumprido</button><button type="button" data-open="'+esc(id)+'">Abrir</button>')+'</div></div>'}).join('')
   +'<p class="lex-sheet-msg" role="status" aria-live="polite"></p>';
 };
 render();
 s.body.addEventListener('click',async e=>{
  const done=e.target.closest?.('[data-done]'),back=e.target.closest?.('[data-undo]'),open=e.target.closest?.('[data-open]');
  if(open){s.close();window.lexOpenProc?.(open.dataset.open);return}
  const msg=s.body.querySelector?.('.lex-sheet-msg');
  if(done){
   const id=done.dataset.done;done.disabled=true;
   try{
     await lexApi('/api/escritorio/prazos/cumprido',{method:'POST',body:JSON.stringify({processo_id:id,acao:'marcar'})});
     marked.add(id);await pullProcs();render();
   }catch(err){done.disabled=false;if(msg)msg.textContent=err.message||'Não consegui marcar o prazo como cumprido.'}
   return;
  }
  if(back){
   const id=back.dataset.undo;
   if(typeof confirm==='function'&&!confirm('Desfazer somente a baixa deste prazo? Outros andamentos do processo serão preservados.'))return;
   back.disabled=true;
   try{
     await lexApi('/api/escritorio/prazos/cumprido',{method:'POST',body:JSON.stringify({processo_id:id,acao:'desfazer'})});
     marked.delete(id);await pullProcs();render();
   }catch(err){back.disabled=false;if(msg)msg.textContent=err.message||'Não consegui desfazer a baixa.'}
  }
 });
}
function processOfficial(p){return !!(p?.last_court_sync_at||p?.partes_verificadas_em||p?.cadastro_conferido==='tribunal'||p?.numero_verificado_fonte==='pje')}
function safeCaseLabel(p){if(processOfficial(p))return p?.nome_oficial||p?.partes||p?.nome||p?.numero||'Processo';const m=String(p?.numero||'').match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);return m?'Processo '+m[0]+' — dados a conferir':'Processo — dados a conferir'}
function vencidosIds(){return procs().filter(p=>processOfficial(p)&&deadlineTruthDue(p)&&!p?.prazo_baixa?.ativa&&!p?.deadline_truth_resolvido_em&&deadlineDays(p)<0&&!/CONCLU|ARQUIV|ENTREGUE|GANHO|PERDIDO/i.test(String(p.status||''))).map(p=>String(p.id))}
window.lexFixCnj=fixCnj;
window.lexPrazosVencidos=ids=>prazosSheet(Array.isArray(ids)&&ids.length?ids.map(String):vencidosIds());
// Estado do escritório em mensagens do LEX, cada uma com a ação que executa.
// Determinístico (sem IA): lê tarefas/prazos, conexões e recepção e devolve
// {messages:[{text,tone,actions:[{label,onclick}]}], failures, pjeOk, djenOk, status}.
// Reutilizado pela tela "Hoje" (today) e pela Conversa (lex2-coordinator-ui.js).
async function briefing(){
 const ps=procs(),failures=[];
 const active=ps.filter(p=>!/CONCLU|ARQUIV|ENTREGUE|GANHO|PERDIDO/i.test(String(p.status||'')));
 const official=active.filter(processOfficial),pending=active.filter(p=>!processOfficial(p));
 const results=await Promise.allSettled([lexApi('/api/trabalho'),lexApi('/api/escritorio/oab'),lexApi('/api/escritorio/recepcao')]);
 const work=results[0],connections=results[1],reception=results[2],messages=[];
 const say=(text,tone,actions)=>messages.push({text,tone:tone||'info',actions:actions||[]});
 say('Estou acompanhando '+active.length+' processo'+(active.length===1?'':'s')+'. '+official.length+' '+(official.length===1?'tem':'têm')+' leitura oficial registrada.');
 if(pending.length)say('Há '+pending.length+' processo'+(pending.length===1?'':'s')+' com dados antigos ou manuais ainda sem leitura oficial. Não vou usar nome, partes, prazo ou urgência desses cadastros como verdade até conferir o tribunal.','warn',[{label:'Ver processos',onclick:'lexProcessos()'}]);
 let pjeOk=false,djenOk=false;
 if(connections.status==='fulfilled'){
   const pje=connections.value?.pje||{},oabs=Array.isArray(connections.value?.oabs)?connections.value.oabs:[];
   pjeOk=pje.configurado===true;
   djenOk=oabs.length>0;
   if(pjeOk)say('PJe/eproc está configurado para: '+(Array.isArray(pje.tribunais)&&pje.tribunais.length?pje.tribunais.join(', '):'tribunal configurado')+'. Posso conferir partes e andamentos.','ok',[{label:'Atualizar no tribunal',onclick:"lexAskLex('atualize meus processos')"}]);
   else say('PJe/eproc ainda não está ligado. Enquanto isso eu não consigo validar partes e andamentos no tribunal e não vou fingir que consigo.','warn',[{label:'Ligar PJe/eproc',onclick:'lexOab()'}]);
   if(djenOk)say('Diário (DJEN) está ligado a '+oabs.length+' inscrição'+(oabs.length===1?'':'ões')+'. Publicação só vira prazo depois da confirmação exigida pelo LEX.','ok');
   else say('Diário (DJEN) ainda não está ligado a uma OAB do escritório. Não vou dizer que as publicações estão monitoradas.','warn',[{label:'Ligar Diário (DJEN)',onclick:'lexOab()'}]);
 }else failures.push('conexões do tribunal');
 let running=0,waiting=0;
 if(work.status==='fulfilled'){
   const desk=work.value?.prazos||{},confirmed=list(desk.correndo),toReview=list(desk.cunhar);
   const late=confirmed.filter(x=>Number(x?.days_to_due)<0),today_=confirmed.filter(x=>Number(x?.days_to_due)===0);
   if(late.length)say(late.length+' prazo'+(late.length===1?' oficial venceu':'s oficiais venceram')+'. Confira no tribunal se foi cumprido; a baixa é gravada no servidor.','late',[{label:'Resolver agora',onclick:'lexPrazosVencidos()'}]);
   if(today_.length)say(today_.length+' prazo'+(today_.length===1?' oficial vence':'s oficiais vencem')+' hoje.','urgent',[{label:'Ver com o LEX',onclick:"lexAskLex('prazos de hoje')"}]);
   if(confirmed.length)say('Há '+confirmed.length+' prazo'+(confirmed.length===1?' oficial em acompanhamento':'s oficiais em acompanhamento')+'.','info',[{label:'Ver prazos',onclick:'lexPrazos()'}]);
   if(toReview.length)say('Há '+toReview.length+' publicação'+(toReview.length===1?' aguardando':' aguardando')+' conferência de prazo. Eu não conto como prazo confirmado antes disso.','soon',[{label:'Conferir',onclick:"lexSetPrazoTab('revisar')"}]);
   const tasks=list(work.value?.tarefas);
   const review=tasks.filter(t=>t?.status==='aguardando_revisao').length;
   waiting=tasks.filter(t=>['aguardando_revisao','aguardando_dados','aguardando_documento_nitido','aguardando_configuracao','falhou'].includes(t?.status)).length;
   running=tasks.filter(t=>!['concluida','falhou','cancelada'].includes(t?.status)).length-waiting;
   if(review)say(review+' entrega'+(review===1?' está':'s estão')+' aguardando sua revisão.','ok',[{label:'Revisar',onclick:'lexTarefas()'}]);
   if(desk.erro)failures.push('prazos');
 }else failures.push('tarefas e prazos');
 if(reception.status==='fulfilled'){
   const rows=list(reception.value?.contatos||reception.value?.itens||reception.value?.recepcao).filter(r=>r?.status!=='arquivado');
   if(rows.length)say(rows.length+' conversa'+(rows.length===1?' de cliente está':'s de clientes estão')+' em andamento na recepção.','info',[{label:'Abrir',onclick:"lexChannel('all')"}]);
 }else failures.push('recepção');
 const status=(running>0?running+' tarefa'+(running===1?'':'s')+' em andamento':'nenhuma tarefa em andamento')+' · '+(waiting>0?waiting+(waiting===1?' aguarda':' aguardam')+' você':'nada aguarda você');
 return{messages,failures,pjeOk,djenOk,active,official,pending,running,waiting,status};
}
window.lexBriefing=briefing;
async function today(){
 const host=document.getElementById('content');if(!host)return;
 document.body.classList.add('lex-commercial','lex2-core');
 host.innerHTML='<main class="lex-screen lex-today lex-home-conversation-screen"><header class="lex-top"><div><strong>LEX</strong><small>SEU ESCRITÓRIO</small></div><div class="lex-top-actions"><button onclick="lexToggleTheme()" aria-label="Tema">◐</button><button onclick="lexMais()" aria-label="Mais opções">☰</button></div></header><section class="lex-today-head"><small>LEX</small><h1>Estou conferindo o escritório.</h1><p>Só trato parte, andamento e prazo como verdade depois de fonte oficial.</p></section><div class="lex-today-feedback" role="status"></div><section class="lex-today-list lex-home-conversation" aria-label="Atualização do LEX"><div class="lex-home-msg bot"><b>LEX</b><p>Um instante. Estou lendo o estado do escritório.</p></div></section><button class="lex-home-command" onclick="lexChat()"><span>Fale comigo sobre um processo, prazo ou tarefa…</span><b>↑</b></button>'+dock()+'</main>';
 const surface=host.firstElementChild;
 const b=await briefing();
 if(!surface.isConnected)return;
 const head=surface.querySelector('.lex-today-head');
 head.querySelector('h1').textContent=b.pending.length?'Estou conferindo antes de afirmar.':'Escritório conferido.';
 head.querySelector('p').textContent=b.official.length+' de '+b.active.length+' processo'+(b.active.length===1?'':'s')+' com leitura oficial registrada.';
 const feedback=surface.querySelector('.lex-today-feedback');
 if(b.failures.length)feedback.textContent='Não consegui ler '+b.failures.join(', ')+'. Não vou interpretar ausência de dado como ausência de problema.';
 const target=surface.querySelector('.lex-today-list');
 target.innerHTML=b.messages.map(m=>'<div class="lex-home-msg bot"><b>LEX</b><p>'+esc(m.text)+'</p></div>').join('')
   +'<div class="lex-home-actions">'
   +(b.pjeOk?'<button onclick="lexAskLex(\'atualize meus processos\')">Atualizar processos no tribunal</button>':'<button onclick="lexOab()">Ligar PJe/eproc</button>')
   +(b.djenOk?'':'<button onclick="lexOab()">Ligar Diário (DJEN)</button>')
   +'<button onclick="lexChat()">Conversar com o LEX</button></div>';
}
function patch(){window.lexHome=today;window.renderPainel=today;const previous=window.ir;if(typeof previous==='function'&&!previous.__lexToday){const route=function(page){if(page==='painel')return today();return previous.apply(this,arguments)};route.__lexToday=true;window.ir=route}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(patch,0),{once:true});else setTimeout(patch,0);
})();
