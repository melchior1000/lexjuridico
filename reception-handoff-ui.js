(function(){
'use strict';
const inbox=new Map();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(message,type){if(typeof window.toast==='function')window.toast(message,type)}
function deterministicId(item){
  const origem=String(item?.origem||'whatsapp');
  const contato=String(item?.id||item?.numero||'').replace(/\D/g,'')||'semid';
  const stamp=String(item?.criado_em||item?.created_at||'').replace(/\D/g,'').slice(0,14)||'entrada';
  return 'recepcao-'+origem+'-'+contato+'-'+stamp;
}
function installCard(){
  if(typeof window.lexReceptionCard!=='function'||window.lexReceptionCard.__handoff)return;
  const old=window.lexReceptionCard;
  const fn=function(item,archived=false){
    const origem=String(item?.origem||'whatsapp'),id=String(item?.id||item?.numero||'').replace(/\D/g,'');
    const key=origem+':'+id;if(id)inbox.set(key,item);
    const html=old.apply(this,arguments);if(archived||!id)return html;
    const button='<button class="btn-primary lex-reception-forward" onclick="lexReceptionToCadastro(\''+esc(origem)+'\',\''+esc(id)+'\')">Encaminhar ao Cadastro</button>';
    return html.replace('</article>',button+'</article>');
  };
  fn.__handoff=true;window.lexReceptionCard=fn;
}
function installReceptionCopy(){
  if(typeof window.renderRecepcaoLex!=='function'||window.renderRecepcaoLex.__handoffCopy)return;
  const old=window.renderRecepcaoLex;
  const fn=async function(){
    const out=await old.apply(this,arguments);
    const host=document.getElementById('content');
    const intro=host?.querySelector('.work-title p');
    if(intro)intro.textContent='Contatos externos em triagem. Encaminhe ao Cadastro quando a demanda virar caso; o Cadastro confere os documentos antes de liberar a produção jurídica.';
    return out;
  };
  fn.__handoffCopy=true;window.renderRecepcaoLex=fn;
}
window.lexReceptionToCadastro=async function(origem,id){
  const channel=String(origem||'whatsapp'),contact=String(id||'').replace(/\D/g,''),item=inbox.get(channel+':'+contact);
  if(!item){notify('Atualize a Recepção e tente novamente.','alert');return}
  if(!confirm('Encaminhar '+(item.nome||'este contato')+' para o Cadastro? O atendimento sai da Recepção e nasce como caso em conferência.'))return;
  const caso={
    id:deterministicId(item),nome:item.nome||('Contato '+contact),status:'EM_PREP',area:'',numero:'',
    obs:item.ultima_mensagem||('Contato encaminhado da Recepção do '+channel+'.'),
    descricao:item.ultima_mensagem||('Contato encaminhado da Recepção do '+channel+'.'),
    faltando:'',origem:'recepcao_'+channel
  };
  if(channel==='whatsapp')caso.telefone=contact;else caso.telegram_id=contact;
  try{
    const saved=await lexApi('/api/escritorio/preparacao',{method:'POST',body:JSON.stringify({caso,documentos:[]})});
    if(Array.isArray(saved.processos)&&typeof SK!=='undefined')localStorage.setItem(SK,JSON.stringify(saved.processos));
    if(saved.versao!=null&&typeof setVersaoLocal==='function')setVersaoLocal(saved.versao);
    await lexApi('/api/escritorio/recepcao/arquivar',{method:'POST',body:JSON.stringify({origem:channel,id:contact})});
    notify('Contato encaminhado. O caso agora está no Cadastro.','ok');
    await window.renderRecepcaoLex?.();
  }catch(e){notify(e.message||'Não foi possível encaminhar ao Cadastro.','erro')}
};
function boot(){installCard();installReceptionCopy();setTimeout(()=>{installCard();installReceptionCopy()},250);setTimeout(()=>{installCard();installReceptionCopy()},1000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();