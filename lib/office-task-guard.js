'use strict';
async function blockTask(engine,id,reason){
  if(!engine?.store?.change || !id) return null;
  return engine.store.change('lex_task:'+id,t=>{
    if(!t || !['na_fila','executando'].includes(t.status)) return undefined;
    return {...t,status:'aguardando_dados',pendencia:String(reason||'Fluxo do escritório bloqueou a tarefa.').slice(0,400),atualizada_em:new Date().toISOString()};
  });
}
module.exports={blockTask};
