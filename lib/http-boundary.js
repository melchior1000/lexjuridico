'use strict';

const BLOCKED_LEGACY_WRITES=new Map([
  ['POST /api/gerar',{replacement:'/api/tarefas',reason:'geracao juridica deve passar pelo Task Engine e pela Revisao'}],
  ['POST /api/pipeline',{replacement:'/api/tarefas',reason:'pipeline legado nao pode manter uma segunda linha de producao'}],
  ['POST /api/pericia/gerar',{replacement:'/api/tarefas',reason:'pericia operacional deve passar pelo Task Engine'}],
  ['POST /api/pericia/anexar',{replacement:'/api/tarefas',reason:'anexo de entrega pericial deve seguir o fluxo de revisao do Core'}],
  ['POST /api/processo/distribuir',{replacement:'/api/escritorio/distribuir',reason:'distribuicao oficial pertence ao Office Core'}],
  ['POST /api/vivo/aplicar',{replacement:'/api/vivo/conversar',reason:'alteracoes do Gestor legado nao podem gravar fora do Office Core'}],
  ['POST /api/vivo/peca/gerar',{replacement:'/api/tarefas',reason:'redacao operacional deve passar pelo Task Engine'}],
  ['POST /api/vivo/gerar_peca',{replacement:'/api/tarefas',reason:'gerador legado nao pode contornar o Task Engine'}]
]);

const TRANSITIONAL_WRITES=new Map([
  ['POST /api/sincronizar','ProcessStore.replace — compatibilidade de sincronizacao'],
  ['POST /api/processo/atualizar','ProcessStore.update — manter ate existir equivalente Office completo'],
  ['POST /api/processo/lembretes/concluir','ProcessStore.update — manter ate migracao do dossie'],
  ['POST /api/conector/andamento','ProcessStore — conector assistido'],
  ['POST /api/pje/configurar','configuracao de integracao'],
  ['POST /api/pje/conectar','configuracao de integracao'],
  ['POST /api/pje/sincronizar','integracao assistida']
]);

function routePath(url){
  try{return new URL(String(url||'/'),'http://lex').pathname.replace(/\/+$/,'')||'/';}
  catch{return String(url||'/').split('?')[0].replace(/\/+$/,'')||'/';}
}

function isOfficial(path){
  return path==='/api/trabalho'
    || path==='/api/entrada-processual'
    || path==='/api/vivo/conversar'
    || path.startsWith('/api/escritorio/')
    || path==='/api/escritorio'
    || path.startsWith('/api/tarefas');
}

function classifyHttpRoute(url,method='GET'){
  const path=routePath(url),verb=String(method||'GET').toUpperCase(),key=verb+' '+path;
  const blocked=BLOCKED_LEGACY_WRITES.get(key);
  if(blocked)return{classification:'blocked_legacy_write',path,method:verb,...blocked};
  if(isOfficial(path))return{classification:'official',path,method:verb};
  const transitional=TRANSITIONAL_WRITES.get(key);
  if(transitional)return{classification:'transitional_write',path,method:verb,reason:transitional};
  return{classification:'legacy_compat',path,method:verb};
}

function enforceHttpBoundary(req,res,{headers={},authenticate}={}){
  const route=classifyHttpRoute(req?.url,req?.method);
  if(route.classification!=='blocked_legacy_write')return false;
  const profile=typeof authenticate==='function'?authenticate(req):null;
  if(!profile){
    res.writeHead(401,headers);
    res.end(JSON.stringify({error:'Nao autenticado',codigo:'LEX_AUTH_REQUIRED'}));
    return true;
  }
  res.writeHead(410,{...headers,'Content-Type':'application/json','Deprecation':'true'});
  res.end(JSON.stringify({
    error:'Rota legada de escrita desativada. Use o fluxo oficial do LEX.',
    codigo:'LEX_LEGACY_WRITE_BLOCKED',
    rota:route.path,
    substituir_por:route.replacement,
    motivo:route.reason
  }));
  return true;
}

module.exports={BLOCKED_LEGACY_WRITES,TRANSITIONAL_WRITES,routePath,classifyHttpRoute,enforceHttpBoundary};
