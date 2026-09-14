(function(){
'use strict';
const MAX_BYTES=25*1024*1024;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function selectedProcess(){return String(document.getElementById('lex-chat-process')?.value||'').trim()}
function conversation(){return document.getElementById('lex-conversation')}
function append(message,selected){
  const box=conversation();if(!box)return;
  box.insertAdjacentHTML('beforeend','<div class="lex-msg bot">'+esc(message)+'</div>');box.scrollTop=box.scrollHeight;
  try{const key='lex_chat_history_'+(selected?'process_'+selected:'general'),old=JSON.parse(sessionStorage.getItem(key)||'[]'),next=(Array.isArray(old)?old:[]).concat([{role:'assistant',content:message}]).slice(-20);sessionStorage.setItem(key,JSON.stringify(next))}catch{}
}
function toBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));reader.onload=()=>{const value=String(reader.result||''),i=value.indexOf(',');resolve(i>=0?value.slice(i+1):value)};reader.readAsDataURL(file)})}
async function sendFile(file){
  const processo_id=selectedProcess();
  if(!processo_id){append('Selecione o processo antes de anexar um documento.','');return}
  if(!file)return;
  if(file.size<=0){append('O arquivo está vazio.',processo_id);return}
  if(file.size>MAX_BYTES){append('Arquivo acima de 25 MB. Envie uma versão menor.',processo_id);return}
  const button=document.getElementById('lex-attach-button');if(button)button.disabled=true;
  try{
    append('Recebendo '+file.name+'…',processo_id);
    const base64=await toBase64(file);
    const result=await lexApi('/api/entrada-processual',{method:'POST',body:JSON.stringify({processo_id,nome:file.name,mimeType:file.type||'application/octet-stream',tamanho:file.size,base64,origem:'lex_chat'})});
    const msg=result.mensagem||result?.resultado?.status||'Documento recebido para conferência.';
    append(msg,processo_id);
  }catch(error){append(error?.message||'Não foi possível receber o documento.',processo_id)}finally{if(button)button.disabled=false}
}
function install(){
  const input=document.getElementById('lex-chat-input'),form=input?.closest('form');
  if(!input||!form||document.getElementById('lex-attach-button'))return false;
  const file=document.createElement('input');file.type='file';file.id='lex-chat-file';file.hidden=true;file.accept='.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.txt';file.addEventListener('change',async()=>{const picked=file.files?.[0];file.value='';await sendFile(picked)});
  const btn=document.createElement('button');btn.type='button';btn.id='lex-attach-button';btn.className='lex-attach-button';btn.setAttribute('aria-label','Anexar documento ao processo');btn.title='Anexar documento';btn.textContent='＋';btn.addEventListener('click',()=>{if(!selectedProcess()){append('Selecione o processo antes de anexar um documento.','');return}file.click()});
  form.insertBefore(btn,input);form.appendChild(file);return true;
}
function boot(){install();const observer=new MutationObserver(()=>install());observer.observe(document.body,{childList:true,subtree:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
window.lexAttachProcessFile=sendFile;
})();
