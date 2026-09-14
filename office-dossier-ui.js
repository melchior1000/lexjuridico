(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=()=>{try{return typeof getProcs==='function'?(getProcs()||[]):[]}catch{return[]}};
const byId=id=>list().find(p=>String(p.id)===String(id));
const stage=p=>String(p?.office_stage||p?.fluxo_setor||p?.setor||'processos').toLowerCase();
const docs=p=>{
  const out=[];
  for(const field of ['entrada_processual','arquivos','recebimentos']){
    for(const item of (Array.isArray(p?.[field])?p[field]:[])){
      const key=String(item?.sha256||'')||[item?.nome,item?.recebido_em||item?.data||item?.criado_em].join('|');
      if(out.some(x=>x.key===key))continue;
      out.push({key,nome:item?.nome||item?.arquivo||'Documento',origem:item?.origem||field,status:item?.status||item?.motivo||'recebido',data:item?.recebido_em||item?.data||item?.criado_em||'',mime:item?.mimeType||item?.mime||''});
    }
  }
  return out;
};
const movements=p=>(Array.isArray(p?.andamentos)?p.andamentos:[]).slice(0,12);
function statusLabel(v){
  const s=String(v||'recebido').toLowerCase();
  if(s==='novo_andamento')return'Novo andamento';
  if(s==='provavel_duplicado')return'Provável duplicado';
  if(s==='provavel_antigo')return'Provável antigo';
  if(s==='precisa_conferencia')return'Precisa conferência';
  return String(v||'Recebido').replaceAll('_',' ');
}
function originLabel(v){const s=String(v||'manual').toLowerCase();if(s.includes('whatsapp'))return'WhatsApp';if(s.includes('telegram'))return'Telegram';if(s.includes('datajud'))return'Datajud';if(s.includes('pje'))return'PJe';if(s.includes('lex_chat'))return'LEX';return s==='upload'?'Manual':String(v||'Manual')}
function docRows(p){const items=docs(p);if(!items.length)return'<div class="lex-empty">Nenhum documento recebido neste processo ainda.</div>';return'<div class="lex-dossier-list">'+items.map(x=>'<article><div><strong>'+esc(x.nome)+'</strong><small>'+esc(originLabel(x.origem))+(x.mime?' · '+esc(x.mime):'')+'</small></div><span class="lex-doc-status">'+esc(statusLabel(x.status))+'</span><time>'+esc(x.data?String(x.data).slice(0,19).replace('T',' '):'')+'</time></article>').join('')+'</div>'}
function movementRows(p){const items=movements(p);if(!items.length)return'<div class="lex-empty">Nenhum andamento cadastrado.</div>';return'<div class="lex-dossier-list">'+items.map(x=>'<article><div><strong>'+esc(x.txt||x.texto||'Andamento')+'</strong><small>'+esc(originLabel(x.origem||''))+'</small></div><time>'+esc(x.data||x.date||'')+'</time></article>').join('')+'</div>'}
function shell(p){
  const id=esc(String(p.id));
  const numero=esc(p.numero||'sem número');
  const nome=esc(p.nome||p.partes||'Processo');
  const current=esc(stage(p));
  const body='<main class="lex-screen lex-dossier-screen"><header class="lex-top"><div><strong>LEX</strong><small>DOSSIÊ DO PROCESSO</small></div><div class="lex-top-actions"><button onclick="lexProcessos()" aria-label="Voltar">←</button></div></header>'+
  '<section class="lex-dossier-head"><div><small>'+numero+'</small><h1>'+nome+'</h1><p>'+esc(p.tribunal||p.area||p.assunto||'')+'</p></div><span>'+current+'</span></section>'+
  '<section class="lex-dossier-actions"><button onclick="lexDossierDatajud(\''+id+'\')">↻ Atualizar Datajud</button><button onclick="lexDossierTask(\''+id+'\',\'peticao\')">✎ Redigir petição</button><button onclick="lexDossierTask(\''+id+'\',\'pericia\')">∑ Perícia</button></section>'+
  '<section class="lex-panel"><h2>Encaminhar entre setores</h2><p class="lex-move-help">Baixa o setor atual e registra a entrada no destino. O motivo é obrigatório.</p><div class="lex-move-form"><select id="lex-dossier-target"><option value="cadastro">Cadastro</option><option value="iniciais">Iniciais</option><option value="processos">Processos</option><option value="prazos">Prazos</option><option value="pecas">Peças</option><option value="pericia">Perícia</option><option value="revisao">Revisão</option><option value="concluidos">Concluídos</option></select><input id="lex-dossier-reason" placeholder="Motivo da transferência"><button onclick="lexDossierMove(\''+id+'\')">Encaminhar</button></div><div id="lex-dossier-status" class="lex-dossier-status"></div></section>'+
  '<section class="lex-panel"><div class="lex-section-title"><h2>Documentos recebidos</h2><button onclick="lexDossierAttach(\''+id+'\')">＋ Anexar</button></div>'+docRows(p)+'</section>'+
  '<section class="lex-panel"><h2>Últimos andamentos</h2>'+movementRows(p)+'</section></main>';
  const host=document.getElementById('content');if(host){document.body.classList.add('lex-commercial');host.innerHTML=body}
}
function setStatus(text){const out=document.getElementById('lex-dossier-status');if(out)out.textContent=text}
window.lexDossierOpen=function(id){const p=byId(id);if(!p){window.lexProcessos?.();return}shell(p)};
window.lexDossierMove=async function(id){const destino=document.getElementById('lex-dossier-target')?.value,motivo=document.getElementById('lex-dossier-reason')?.value?.trim();if(!destino||!motivo){setStatus('Informe o destino e o motivo.');return}setStatus('Movimentando…');try{const r=await lexApi('/api/escritorio/mover',{method:'POST',body:JSON.stringify({processo_id:id,destino,motivo})});setStatus('Movido para '+(r.setor||destino)+'. Baixa e entrada registradas.');}catch(e){setStatus(e?.message||'Não foi possível movimentar o processo.')}};
window.lexDossierDatajud=async function(id){setStatus('Consultando Datajud…');try{const r=await lexApi('/api/escritorio/datajud',{method:'POST',body:JSON.stringify({processo_id:id})});const novos=Number(r?.novos??r?.inseridos??0);const ignorados=Number(r?.duplicados??r?.ignorados??0);setStatus('Datajud concluído: '+novos+' novo(s), '+ignorados+' repetido(s).');}catch(e){setStatus(e?.message||'Não foi possível consultar o Datajud.')}};
window.lexDossierTask=async function(id,tipo){setStatus('Delegando ao setor…');try{const r=await lexApi('/api/tarefas',{method:'POST',body:JSON.stringify({processo_id:id,tipo,instrucao:tipo==='pericia'?'Analise os documentos do processo e prepare a perícia conforme o playbook.':'Redija a peça adequada com base nos documentos e andamentos do processo.',request_id:'dossier-'+Date.now()})});setStatus('Tarefa '+String(r?.tarefa?.id||'').slice(0,8)+' criada. A entrega irá para Revisão.');}catch(e){setStatus(e?.message||'Não foi possível criar a tarefa.')}};
window.lexDossierAttach=function(id){
  const select=document.getElementById('lex-chat-process');
  if(select){select.value=String(id);window.lexChat?.();setTimeout(()=>document.getElementById('lex-attach-button')?.click(),80);return}
  window.lexChat?.();setTimeout(()=>{const s=document.getElementById('lex-chat-process');if(s)s.value=String(id);document.getElementById('lex-attach-button')?.click()},120);
};
function boot(){const old=window.lexOpenProc;if(typeof old==='function'&&!old.__dossier){const fn=id=>window.lexDossierOpen(id);fn.__dossier=true;fn.legacy=old;window.lexOpenProc=fn}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,0),{once:true});else setTimeout(boot,0);
})();
