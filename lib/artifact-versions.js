'use strict';

const crypto=require('node:crypto');
const {payloadHash}=require('./legal-review-policy');

function id(){return crypto.randomUUID();}
function createVersion({artifact_id,artifact_type,case_id,content,source_manifest=[],reason,created_by,agent_id,model_provider,model_name,parent_version_id=null,created_at}={}){
  if(!artifact_id) throw new Error('artifact_id obrigatório');
  if(!['document','draft'].includes(artifact_type)) throw new Error('artifact_type inválido');
  const body={artifact_id,artifact_type,case_id:case_id||null,parent_version_id,content:content??'',source_manifest:Array.isArray(source_manifest)?source_manifest:[],reason:reason||'nova versão',created_by:created_by||null,agent_id:agent_id||null,model_provider:model_provider||null,model_name:model_name||null};
  return Object.freeze({version_id:id(),version_hash:payloadHash(body),...body,created_at:created_at||new Date().toISOString()});
}
function appendVersion(versions,version){
  const list=Array.isArray(versions)?versions:[];
  if(list.some(v=>v.version_id===version.version_id)) return list;
  if(list.some(v=>v.version_hash===version.version_hash)) return list;
  return Object.freeze([...list,Object.freeze({...version})]);
}
function compareVersions(a,b){
  if(!a||!b) throw new Error('duas versões são obrigatórias');
  return Object.freeze({from_version_id:a.version_id,to_version_id:b.version_id,from_hash:a.version_hash,to_hash:b.version_hash,changed:a.version_hash!==b.version_hash,from_content:a.content,to_content:b.content});
}
function latest(versions,artifact_id){return [...(versions||[])].filter(v=>v.artifact_id===artifact_id).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).at(-1)||null;}

module.exports={createVersion,appendVersion,compareVersions,latest};
