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
function processOptions(){let rows=[];try{rows=typeof getProcs==='function'?(getProcs()||[]):[]}catch{}return rows.slice(0,300).map(p=>'<option value="'+esc(p.id)+'">'+esc((p.numero||'sem número')+' · '+(p.nome||p.partes||'Processo'))+'</option>').join('')}
function injectMover(){
  const grid=document.querySelector('.lex-office-grid');if(!grid||document.getElementById('lex-office-mover'))return;
  const panel=document.createElement('div');panel.id='lex-office-mover';panel.className='lex-panel';
  panel.innerHTML='<h2>Movimentar caso entre setores</h2><p class="lex-move-help">O LEX dá baixa no setor atual e entrada no destino no mesmo movimento. Devolução exige motivo.</p><div class="lex-move-form"><select id="lex-move-process"><option value="">Selecione o processo</option>'+processOptions()+'</select><select id="lex-move-target"><option value="cadastro">Cadastro</option><option value="iniciais">Iniciais</option><option value="processos">Processos</option><option value="prazos">Prazos</option><option value="pecas">Peças</option><option value="pericia">Perícia</option><option value="revisao">Revisão</option><option value="concluidos">Concluídos</option></select><input id="lex-move-reason" placeholder="Motivo da transferência"><button onclick="lexMoveProcess()">Encaminhar</button></div><div id="lex-move-status" class="lex-empty"></div>';
  grid.after(panel);
}
window.lexMoveProcess=async function(){
  const processo_id=document.getElementById('lex-move-process')?.value;
  const destino=document.getElementById('lex-move-target')?.value;
  const motivo=document.getElementById('lex-move-reason')?.value?.trim();
  const out=document.getElementById('lex-move-status');
  if(!processo_id||!destino||!motivo){if(out)out.textContent='Selecione o processo, o destino e informe o motivo.';return}
  if(out)out.textContent='Movimentando…';
  try{
    const r=await lexApi('/api/escritorio/mover',{method:'POST',body:JSON.stringify({processo_id,destino,motivo})});
    if(out)out.textContent='Movido para '+(r.setor||destino)+'. Baixa e entrada registradas.';
    patchGrid(r.setores);setTimeout(()=>window.lexEscritorio?.(),350);
  }catch(e){if(out)out.textContent=e?.message||'Não foi possível movimentar o caso.'}
};
function wrap(name,{mover=false}={}){
  const old=window[name];if(typeof old!=='function'||old.__officeFlow)return;
  const fn=async function(){const result=await old.apply(this,arguments);const d=await state();patchGrid(countsOf(d));if(mover)injectMover();return result};
  fn.__officeFlow=true;window[name]=fn;
}
function boot(){wrap('lexHome');wrap('lexEscritorio',{mover:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,0));else setTimeout(boot,0);
})();
