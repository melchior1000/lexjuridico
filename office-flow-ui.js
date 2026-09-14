(function(){
'use strict';
const LABELS={
  'Recepção':'recepcao','Cadastro':'cadastro','Iniciais':'iniciais','Processos':'processos','Prazos':'prazos',
  'Peças / Perícia':'pecas_pericia','Revisão':'revisao','Concluídos':'concluidos'
};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function state(){try{return await lexApi('/api/trabalho')}catch{return null}}
function countsOf(data){return data?.contagens?.setores||null}
function countFor(label,c){if(!c)return null;if(label==='Peças / Perícia')return Number(c.pecas||0)+Number(c.pericia||0);const key=LABELS[label];return key?Number(c[key]||0):null}
function patchGrid(c){if(!c)return;document.querySelectorAll('.lex-office-grid button').forEach(btn=>{const strong=btn.querySelector('strong');const n=btn.querySelector('span b');if(!strong||!n)return;const value=countFor(strong.textContent.trim(),c);if(value!==null)n.textContent=String(value)})}
function processes(){try{return typeof getProcs==='function'?(getProcs()||[]):[]}catch{return[]}}
function processOptions(filter){return processes().filter(p=>!filter||filter(p)).slice(0,300).map(p=>'<option value="'+esc(p.id)+'">'+esc((p.numero||'sem número')+' · '+(p.nome||p.partes||'Processo'))+'</option>').join('')}
function injectMover(){
  const grid=document.querySelector('.lex-office-grid');if(!grid||document.getElementById('lex-office-mover'))return;
  const panel=document.createElement('div');panel.id='lex-office-mover';panel.className='lex-panel';
  panel.innerHTML='<h2>Movimentar caso entre setores</h2><p class="lex-move-help">O LEX dá baixa no setor atual e entrada no destino no mesmo movimento. Devolução exige motivo.</p><div class="lex-move-form"><select id="lex-move-process"><option value="">Selecione o processo</option>'+processOptions()+'</select><select id="lex-move-target"><option value="cadastro">Cadastro</option><option value="iniciais">Iniciais</option><option value="processos">Processos</option><option value="prazos">Prazos</option><option value="pecas">Peças</option><option value="pericia">Perícia</option><option value="revisao">Revisão</option><option value="concluidos">Concluídos</option></select><input id="lex-move-reason" placeholder="Motivo da transferência"><button onclick="lexMoveProcess()">Encaminhar</button></div><div id="lex-move-status" class="lex-empty"></div>';
  grid.after(panel);injectChecklist(panel);
}
function injectChecklist(after){
  if(document.getElementById('lex-cadastro-check'))return;
  const panel=document.createElement('div');panel.id='lex-cadastro-check';panel.className='lex-panel';
  panel.innerHTML='<h2>Conferência do Cadastro</h2><p class="lex-move-help">Marque cada item. Sem pendência, o LEX dá baixa no Cadastro e entrada automática em Iniciais.</p><div class="lex-move-form"><select id="lex-check-process"><option value="">Caso no Cadastro</option>'+processOptions(p=>String(p.office_stage||p.fluxo_setor||'').toLowerCase()==='cadastro')+'</select><select id="lex-check-id"><option value="ok">Identidade: OK</option><option value="falta">Identidade: falta</option><option value="nao_se_aplica">Identidade: N/A</option></select><select id="lex-check-end"><option value="ok">Endereço: OK</option><option value="falta">Endereço: falta</option><option value="nao_se_aplica">Endereço: N/A</option></select><select id="lex-check-proc"><option value="ok">Procuração: OK</option><option value="falta">Procuração: falta</option><option value="nao_se_aplica">Procuração: N/A</option></select><select id="lex-check-contract"><option value="nao_se_aplica">Contrato: N/A</option><option value="ok">Contrato: OK</option><option value="falta">Contrato: falta</option></select><button onclick="lexConfirmCadastro()">Conferir cadastro</button></div><div id="lex-check-status" class="lex-empty"></div>';
  after.after(panel);
}
window.lexConfirmCadastro=async function(){
  const processo_id=document.getElementById('lex-check-process')?.value,out=document.getElementById('lex-check-status');
  if(!processo_id){if(out)out.textContent='Selecione um caso do Cadastro.';return}
  const checklist={documento_identidade:document.getElementById('lex-check-id')?.value,comprovante_endereco:document.getElementById('lex-check-end')?.value,procuracao:document.getElementById('lex-check-proc')?.value,contratos:document.getElementById('lex-check-contract')?.value};
  if(out)out.textContent='Conferindo…';
  try{const r=await lexApi('/api/escritorio/cadastro/conferir',{method:'POST',body:JSON.stringify({processo_id,checklist})});if(out)out.textContent=r.conferido?'Cadastro conferido e encaminhado para '+(r.setor||'Iniciais')+'.':'Cadastro bloqueado: '+([...(r.pendentes||[]),r.documentos_faltantes].filter(Boolean).join(', ')||'há pendências');if(r.conferido)setTimeout(()=>window.lexEscritorio?.(),350);}
  catch(e){if(out)out.textContent=e?.message||'Não foi possível conferir o cadastro.'}
};
window.lexMoveProcess=async function(){
  const processo_id=document.getElementById('lex-move-process')?.value;
  const destino=document.getElementById('lex-move-target')?.value;
  const motivo=document.getElementById('lex-move-reason')?.value?.trim();
  const out=document.getElementById('lex-move-status');
  if(!processo_id||!destino||!motivo){if(out)out.textContent='Selecione o processo, o destino e informe o motivo.';return}
  if(out)out.textContent='Movimentando…';
  try{const r=await lexApi('/api/escritorio/mover',{method:'POST',body:JSON.stringify({processo_id,destino,motivo})});if(out)out.textContent='Movido para '+(r.setor||destino)+'. Baixa e entrada registradas.';patchGrid(r.setores);setTimeout(()=>window.lexEscritorio?.(),350);}
  catch(e){if(out)out.textContent=e?.message||'Não foi possível movimentar o caso.'}
};
function injectLexActions(){
  if(document.getElementById('lex-office-actions'))return;
  const host=document.querySelector('.lex-chat')||document.querySelector('.lex-screen main')||document.querySelector('.lex-screen');if(!host)return;
  const panel=document.createElement('div');panel.id='lex-office-actions';panel.className='lex-panel lex-office-actions';
  panel.innerHTML='<h2>Delegar ao escritório</h2><p class="lex-move-help">O LEX cria a tarefa no processo e o motor movimenta o caso para Peças/Perícia e depois Revisão.</p><div class="lex-move-form"><select id="lex-action-process"><option value="">Selecione o processo</option>'+processOptions()+'</select><select id="lex-action-type"><option value="peticao">Petição</option><option value="analise">Análise</option><option value="contestacao">Contestação</option><option value="recurso">Recurso</option><option value="pericia">Perícia</option><option value="quesitos">Quesitos</option><option value="revisao">Revisão</option></select><input id="lex-action-instruction" placeholder="Ex.: redija a inicial com os documentos do cadastro"><button onclick="lexCreateOfficeTask()">Delegar</button></div><div id="lex-action-status" class="lex-empty"></div>';
  host.appendChild(panel);
}
window.lexCreateOfficeTask=async function(){
  const processo_id=document.getElementById('lex-action-process')?.value,tipo=document.getElementById('lex-action-type')?.value,instrucao=document.getElementById('lex-action-instruction')?.value?.trim(),out=document.getElementById('lex-action-status');
  if(!processo_id||!tipo||!instrucao){if(out)out.textContent='Selecione o processo, o tipo e descreva a ordem.';return}
  if(out)out.textContent='Delegando…';
  try{const r=await lexApi('/api/tarefas',{method:'POST',body:JSON.stringify({processo_id,tipo,instrucao,request_id:'ui-'+Date.now()})});if(out)out.textContent='Tarefa '+String(r?.tarefa?.id||'').slice(0,8)+' enviada. O caso seguirá o fluxo do escritório.';}
  catch(e){if(out)out.textContent=e?.message||'Não foi possível criar a tarefa.'}
};
function injectReviewReturn(data){
  if(document.getElementById('lex-review-return'))return;
  const tasks=(data?.tarefas||[]).filter(t=>t.status==='aguardando_revisao');if(!tasks.length)return;
  const host=document.querySelector('.lex-screen');if(!host)return;
  const panel=document.createElement('div');panel.id='lex-review-return';panel.className='lex-panel';
  panel.innerHTML='<h2>Devolver para correção</h2><p class="lex-move-help">A minuta sai da Revisão, volta ao setor produtor e entra novamente na fila com o motivo da correção.</p><div class="lex-move-form"><select id="lex-return-task"><option value="">Selecione a entrega</option>'+tasks.map(t=>'<option value="'+esc(t.id)+'">'+esc((t.processo_nome||t.processo_id||'Processo')+' · '+t.tipo)+'</option>').join('')+'</select><input id="lex-return-reason" placeholder="Ex.: corrigir pedido e conferir documento D3"><button onclick="lexReturnTask()">Devolver</button></div><div id="lex-return-status" class="lex-empty"></div>';
  host.appendChild(panel);
}
window.lexReturnTask=async function(){
  const id=document.getElementById('lex-return-task')?.value,motivo=document.getElementById('lex-return-reason')?.value?.trim(),out=document.getElementById('lex-return-status');
  if(!id||!motivo){if(out)out.textContent='Selecione a entrega e informe o motivo da correção.';return}
  if(out)out.textContent='Devolvendo…';
  try{const r=await lexApi('/api/tarefas/devolver',{method:'POST',body:JSON.stringify({id,motivo})});if(out)out.textContent='Devolvida para '+(r.setor||'o setor produtor')+'. Nova versão será enviada para Revisão.';setTimeout(()=>window.lexTarefas?.(),500);}
  catch(e){if(out)out.textContent=e?.message||'Não foi possível devolver a entrega.'}
};
function wrap(name,{mover=false,actions=false,review=false}={}){
  const old=window[name];if(typeof old!=='function'||old.__officeFlow)return;
  const fn=async function(){const result=await old.apply(this,arguments);const d=await state();patchGrid(countsOf(d));if(mover)injectMover();if(actions)injectLexActions();if(review)injectReviewReturn(d);return result};
  fn.__officeFlow=true;window[name]=fn;
}
function boot(){wrap('lexHome');wrap('lexEscritorio',{mover:true});wrap('lexChat',{actions:true});wrap('lexTarefas',{review:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,0));else setTimeout(boot,0);
})();
