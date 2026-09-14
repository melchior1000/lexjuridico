(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function append(text,response,selected){
  const box=document.getElementById('lex-conversation');if(!box)return;
  box.insertAdjacentHTML('beforeend','<div class="lex-msg me">'+esc(text)+'</div><div class="lex-msg bot">'+esc(response)+'</div>');
  box.scrollTop=box.scrollHeight;
  try{
    const key='lex_chat_history_'+(selected?'process_'+String(selected):'general');
    const old=JSON.parse(sessionStorage.getItem(key)||'[]');
    const next=(Array.isArray(old)?old:[]).concat([{role:'user',content:text},{role:'assistant',content:response}]).slice(-20);
    sessionStorage.setItem(key,JSON.stringify(next));
  }catch{}
}
async function execute(command,text){
  const processo_id=command.processo_id;
  if(command.requires_process&&!processo_id)throw Object.assign(new Error('Selecione um processo antes de dar esta ordem ao LEX.'),{officeHandled:true});
  if(command.action==='confirm_registration'){
    const r=await lexApi('/api/escritorio/mover',{method:'POST',body:JSON.stringify({processo_id,destino:'iniciais',motivo:'Cadastro declarado pronto pelo responsável; validação do checklist exigida pelo servidor'})});
    return{message:'Cadastro validado. Dei baixa no Cadastro e entrada em '+(r.setor||'Iniciais')+'.',refresh:'office'};
  }
  if(command.action==='move'){
    const r=await lexApi('/api/escritorio/mover',{method:'POST',body:JSON.stringify({processo_id,destino:command.target,motivo:command.reason||text})});
    return{message:'Caso movimentado para '+(r.setor||command.target)+'. A baixa e a entrada foram registradas.',refresh:'office'};
  }
  if(command.action==='distribute'){
    if(!command.numero)throw Object.assign(new Error('Informe na mensagem o número CNJ ou protocolo já confirmado.'),{officeHandled:true});
    const r=await lexApi('/api/escritorio/distribuir',{method:'POST',body:JSON.stringify({processo_id,setor:command.setor||'judicial',numero:command.numero})});
    return{message:'Distribuição registrada. O caso entrou em '+(r.setor||'Processos')+(r.numero?' com o número '+r.numero:'')+'.',refresh:'office'};
  }
  if(command.action==='task'){
    const r=await lexApi('/api/tarefas',{method:'POST',body:JSON.stringify({processo_id,tipo:command.tipo,instrucao:command.instrucao||text,request_id:'lex-chat-'+Date.now()})});
    return{message:'Ordem registrada para '+command.tipo+'. O caso seguirá para produção e depois para Revisão. Tarefa '+String(r?.tarefa?.id||'').slice(0,8)+'.',refresh:'tasks'};
  }
  return null;
}
function wrap(){
  const old=window.lexSendChat,parser=window.LexOfficeCommand?.parseOfficeCommand;
  if(typeof old!=='function'||typeof parser!=='function'||old.__officeCommands)return;
  const fn=async function(e){
    e?.preventDefault();
    const input=document.getElementById('lex-chat-input'),text=input?.value?.trim();if(!text)return;
    const selected=String(document.getElementById('lex-chat-process')?.value||'');
    const command=parser(text,{processo_id:selected||null});
    if(!command)return old.call(this,e);
    try{
      const out=await execute(command,text);if(!out)return old.call(this,e);
      input.value='';append(text,out.message,selected);
      if(out.refresh==='tasks')setTimeout(()=>window.lexTarefas?.(),650);
      else if(out.refresh==='office')setTimeout(()=>window.lexEscritorio?.(),650);
    }catch(err){
      input.value='';append(text,err?.message||'Não foi possível executar esta ordem.',selected);
    }
  };
  fn.__officeCommands=true;window.lexSendChat=fn;
}
function boot(){wrap();setTimeout(wrap,250);setTimeout(wrap,1000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();