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
// O que o LEX já fez sozinho hoje (leitura do Diário), dito numa linha.
function diarioLine(v){
 if(!v||v.djen_status!=='ok'||!v.executado_em)return'';
 const d=new Date(v.executado_em);if(Number.isNaN(d.getTime()))return'';
 const hoje=new Date().toDateString()===d.toDateString();
 return' Diário lido '+(hoje?'hoje às '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'em '+d.toLocaleDateString('pt-BR'))+'.';
}
// Folha de ação: o LEX executa ali mesmo, sem abrir o chat.
function sheet(title,onClose){
 document.querySelector?.('.lex-sheet')?.remove?.();
 const el=document.createElement('div');el.className='lex-sheet';
 el.innerHTML='<div class="lex-sheet-card" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><header><strong>'+esc(title)+'</strong><button class="lex-sheet-x" aria-label="Fechar">×</button></header><div class="lex-sheet-body"><p class="lex-sheet-lead">Conferindo…</p></div></div>';
 const close=()=>{el.remove();if(onClose)onClose()};
 el.addEventListener('click',e=>{if(e.target===el||e.target.closest?.('.lex-sheet-x'))close()});
 document.body.appendChild(el);
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
 const said=out=>[out.publicacoes?out.publicacoes+' publicação(ões) do Diário':null,out.tribunal==='atualizado'?'tribunal atualizado':null].filter(Boolean).join(', ');
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
// Prazo anotado vencido: um toque marca como cumprido (com Desfazer) ou abre o processo.
function prazoOf(p){const v=String(p?.prazoReal||p?.prazo||p?.dataPrazo||'');const m=v.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:v}
function prazosSheet(ids){
 const s=sheet(ids.length>1?'Prazos vencidos':'Prazo vencido',refreshHome),undo={};
 const render=()=>{
  const rows=procs().filter(p=>ids.includes(String(p.id))||undo[String(p.id)]);
  s.body.innerHTML='<p class="lex-sheet-lead">O prazo anotado no LEX já passou. Confira no tribunal se foi cumprido; se sim, toque em <b>Cumprido</b>: tiro o alerta e registro no histórico do processo.</p>'
   +rows.map(p=>{const id=String(p.id),done=!!undo[id];return'<div class="lex-fix-row'+(done?' done':'')+'"><span><b>'+esc(p.nome||p.partes||p.numero||'Processo')+'</b><small>'+(done?'✓ Cumprido · registrado no histórico':'Prazo anotado: '+esc(prazoOf(p)||'—'))+'</small></span><div class="lex-row-actions">'
     +(done?'<button data-undo="'+esc(id)+'">Desfazer</button>':'<button class="ok" data-done="'+esc(id)+'">Cumprido</button><button data-open="'+esc(id)+'">Abrir</button>')+'</div></div>'}).join('');
 };
 render();
 s.body.addEventListener('click',e=>{
  const done=e.target.closest?.('[data-done]'),back=e.target.closest?.('[data-undo]'),open=e.target.closest?.('[data-open]');
  if(open){s.close();window.lexOpenProc?.(open.dataset.open);return}
  if(typeof saveProcs!=='function')return;
  const ps=procs();
  if(done){const id=done.dataset.done,i=ps.findIndex(x=>String(x.id)===id);if(i<0)return;const p=ps[i],was=prazoOf(p),hoje=new Date().toLocaleDateString('pt-BR');
   undo[id]=p;ps[i]={...p,prazo:'',prazoReal:'',dataPrazo:'',prazo_cumprido:was,prazo_cumprido_em:hoje,andamentos:[{data:hoje,txt:'[LEX] Prazo de '+was+' marcado como cumprido pelo advogado.'},...list(p.andamentos)]};saveProcs(ps);render();return}
  if(back){const id=back.dataset.undo,i=ps.findIndex(x=>String(x.id)===id);if(i>=0&&undo[id]){ps[i]=undo[id];saveProcs(ps)}delete undo[id];render()}
 });
}
function processOfficial(p){return !!(p?.last_court_sync_at||p?.partes_verificadas_em||p?.cadastro_conferido==='tribunal'||p?.numero_verificado_fonte==='pje')}
function safeCaseLabel(p){if(processOfficial(p))return p?.nome_oficial||p?.partes||p?.nome||p?.numero||'Processo';const m=String(p?.numero||'').match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);return m?'Processo '+m[0]+' — dados a conferir':'Processo — dados a conferir'}
function vencidosIds(){return procs().filter(p=>processOfficial(p)&&p.deadline_truth===true&&days(p)<0&&!/CONCLU|ARQUIV|ENTREGUE|GANHO|PERDIDO/i.test(String(p.status||''))).map(p=>String(p.id))}
window.lexFixCnj=fixCnj;
window.lexPrazosVencidos=ids=>prazosSheet(Array.isArray(ids)&&ids.length?ids.map(String):vencidosIds());
async function today(){
 const host=document.getElementById('content');if(!host)return;
 document.body.classList.add('lex-commercial','lex2-core');
 host.innerHTML='<main class="lex-screen lex-today lex-home-conversation-screen"><header class="lex-top"><div><strong>LEX</strong><small>SEU ESCRITÓRIO</small></div><div class="lex-top-actions"><button onclick="lexToggleTheme()" aria-label="Tema">◐</button><button onclick="lexMais()" aria-label="Mais opções">☰</button></div></header><section class="lex-today-head"><small>LEX</small><h1>Estou conferindo o escritório.</h1><p>Só trato parte, andamento e prazo como verdade depois de fonte oficial.</p></section><div class="lex-today-feedback" role="status"></div><section class="lex-today-list lex-home-conversation" aria-label="Atualização do LEX"><div class="lex-home-msg bot"><b>LEX</b><p>Um instante. Estou lendo o estado do escritório.</p></div></section><button class="lex-home-command" onclick="lexChat()"><span>Fale comigo sobre um processo, prazo ou tarefa…</span><b>↑</b></button>'+dock()+'</main>';
 const surface=host.firstElementChild,ps=procs(),failures=[];
 const active=ps.filter(p=>!/CONCLU|ARQUIV|ENTREGUE|GANHO|PERDIDO/i.test(String(p.status||'')));
 const official=active.filter(processOfficial),pending=active.filter(p=>!processOfficial(p));
 const results=await Promise.allSettled([lexApi('/api/trabalho'),lexApi('/api/escritorio/oab'),lexApi('/api/escritorio/recepcao')]);
 if(!surface.isConnected)return;
 const work=results[0],connections=results[1],reception=results[2],messages=[];
 messages.push('Estou acompanhando '+active.length+' processo'+(active.length===1?'':'s')+'. '+official.length+' '+(official.length===1?'tem':'têm')+' leitura oficial registrada.');
 if(pending.length)messages.push('Há '+pending.length+' processo'+(pending.length===1?'':'s')+' com dados antigos ou manuais ainda sem leitura oficial. Não vou usar nome, partes, prazo ou urgência desses cadastros como verdade até conferir o tribunal.');
 let pjeOk=false,djenOk=false;
 if(connections.status==='fulfilled'){
   const pje=connections.value?.pje||{},oabs=Array.isArray(connections.value?.oabs)?connections.value.oabs:[];
   pjeOk=pje.configurado===true;
   djenOk=oabs.length>0;
   if(pjeOk)messages.push('PJe/eproc está configurado para: '+(Array.isArray(pje.tribunais)&&pje.tribunais.length?pje.tribunais.join(', '):'tribunal configurado')+'. Posso conferir partes e andamentos.');
   else messages.push('PJe/eproc ainda não está ligado. Enquanto isso eu não consigo validar partes e andamentos no tribunal e não vou fingir que consigo.');
   if(djenOk)messages.push('Diário (DJEN) está ligado a '+oabs.length+' inscrição'+(oabs.length===1?'':'ões')+'. Publicação só vira prazo depois da confirmação exigida pelo LEX.');
   else messages.push('Diário (DJEN) ainda não está ligado a uma OAB do escritório. Não vou dizer que as publicações estão monitoradas.');
 }else failures.push('conexões do tribunal');
 if(work.status==='fulfilled'){
   const desk=work.value?.prazos||{},confirmed=list(desk.correndo),toReview=list(desk.cunhar);
   if(confirmed.length)messages.push('Há '+confirmed.length+' prazo'+(confirmed.length===1?' oficial em acompanhamento':'s oficiais em acompanhamento')+'.');
   if(toReview.length)messages.push('Há '+toReview.length+' publicação'+(toReview.length===1?' aguardando':' aguardando')+' conferência de prazo. Eu não conto como prazo confirmado antes disso.');
   const review=list(work.value?.tarefas).filter(t=>t?.status==='aguardando_revisao').length;
   if(review)messages.push(review+' entrega'+(review===1?' está':'s estão')+' aguardando sua revisão.');
   if(desk.erro)failures.push('prazos');
 }else failures.push('tarefas e prazos');
 if(reception.status==='fulfilled'){
   const rows=list(reception.value?.contatos||reception.value?.itens||reception.value?.recepcao).filter(r=>r?.status!=='arquivado');
   if(rows.length)messages.push(rows.length+' conversa'+(rows.length===1?' de cliente está':'s de clientes estão')+' em andamento na recepção.');
 }else failures.push('recepção');
 const head=surface.querySelector('.lex-today-head');
 head.querySelector('h1').textContent=pending.length?'Estou conferindo antes de afirmar.':'Escritório conferido.';
 head.querySelector('p').textContent=official.length+' de '+active.length+' processo'+(active.length===1?'':'s')+' com leitura oficial registrada.';
 const feedback=surface.querySelector('.lex-today-feedback');
 if(failures.length)feedback.textContent='Não consegui ler '+failures.join(', ')+'. Não vou interpretar ausência de dado como ausência de problema.';
 const target=surface.querySelector('.lex-today-list');
 target.innerHTML=messages.map(m=>'<div class="lex-home-msg bot"><b>LEX</b><p>'+esc(m)+'</p></div>').join('')
   +'<div class="lex-home-actions">'
   +(pjeOk?'<button onclick="lexAskLex(\'atualize meus processos\')">Atualizar processos no tribunal</button>':'<button onclick="lexOab()">Ligar PJe/eproc</button>')
   +(djenOk?'':'<button onclick="lexOab()">Ligar Diário (DJEN)</button>')
   +'<button onclick="lexChat()">Conversar com o LEX</button></div>';
}
function patch(){window.lexHome=today;window.renderPainel=today;const previous=window.ir;if(typeof previous==='function'&&!previous.__lexToday){const route=function(page){if(page==='painel')return today();return previous.apply(this,arguments)};route.__lexToday=true;window.ir=route}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(patch,0),{once:true});else setTimeout(patch,0);
})();
