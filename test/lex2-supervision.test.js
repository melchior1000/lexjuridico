'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Versions=require('../lib/artifact-versions');
const Review=require('../lib/legal-review-policy');

test('documento e peça ganham nova versão sem sobrescrever a anterior',()=>{
  const v1=Versions.createVersion({artifact_id:'draft-1',artifact_type:'draft',case_id:'case-1',content:'V1',created_at:'2026-09-14T20:00:00Z'});
  const v2=Versions.createVersion({artifact_id:'draft-1',artifact_type:'draft',case_id:'case-1',content:'V2',parent_version_id:v1.version_id,reason:'correção humana',created_at:'2026-09-14T20:01:00Z'});
  const list=Versions.appendVersion(Versions.appendVersion([],v1),v2);
  assert.equal(list.length,2);assert.equal(list[0].content,'V1');assert.equal(list[1].content,'V2');assert.equal(Versions.compareVersions(v1,v2).changed,true);
});

test('LEX exige conferência humana quando jurisprudência não está verificada',()=>{
  const r=Review.reviewPackage({case_id:'case-1',thesis:'tese',sources:[{title:'Julgado',reference:'REsp 1',url:'',verified:false}]});
  assert.equal(r.requires_human_supervisor,true);assert.equal(r.can_execute_critical_act,false);assert.equal(r.source_status,'needs_human_source_check');assert.match(r.warnings[0],/Jurisprudência não confirmada/);
});

test('ato crítico só autoriza o payload exato aprovado pelo supervisor',()=>{
  const payload={case_id:'case-1',draft_version_id:'v2',text:'conteúdo final'};
  const hash=Review.payloadHash(payload);
  const ok=Review.assertAuthorized({act:'aprovar_peca',payload,supervisor_id:'adv-1',authorization_id:'auth-1',approved_hash:hash});
  assert.equal(ok.authorized,true);
  assert.throws(()=>Review.assertAuthorized({act:'aprovar_peca',payload:{...payload,text:'alterado depois da aprovação'},supervisor_id:'adv-1',authorization_id:'auth-1',approved_hash:hash}),e=>e.code==='HUMAN_AUTH_REQUIRED');
});

test('LEX nunca transforma sua própria revisão em autorização humana',()=>{
  const payload={case_id:'case-1',action:'protocolar'};
  assert.throws(()=>Review.assertAuthorized({act:'protocolar',payload,supervisor_id:null,authorization_id:null,approved_hash:Review.payloadHash(payload)}),e=>e.code==='HUMAN_AUTH_REQUIRED');
});
