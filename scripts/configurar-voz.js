#!/usr/bin/env node
'use strict';
// Configura, uma vez, o agente de voz do LEX na Retell: cria o "cérebro" (LLM) cujo roteiro vem
// do LEX em cada ligação ({{abertura}} e {{instrucoes}}, lib/voz-ligacoes.js) e o agente em
// português do Brasil que avisa o LEX ao fim de cada ligação (/api/voz/aviso).
//
// Uso (no computador ou no Shell do Render, com as variáveis já definidas):
//   RETELL_API_KEY=... LEX_SERVIDOR_URL=https://lex-juridico.onrender.com node scripts/configurar-voz.js
// Sem LEX_VOZ_VOICE_ID, lista as vozes em português para escolher e para por aí.
// No fim, mostra o RETELL_AGENT_ID para colocar nas variáveis do servidor.
// Contrato conferido na documentação da Retell em 21/11/2026 (create-retell-llm, create-agent,
// list-voices; variáveis dinâmicas valem no prompt e na mensagem de abertura).
const API='https://api.retellai.com';

const PADRAO={
  abertura:'Olá! Aqui é a assistente virtual do escritório. Esta ligação é gravada. Com quem eu falo?',
  instrucoes:'Você é a assistente virtual de um escritório de advocacia. Não fale de nenhum assunto: diga que o escritório vai retornar a ligação, agradeça e encerre.'
};

function corpoLlm(){
  return{general_prompt:'{{instrucoes}}',begin_message:'{{abertura}}',start_speaker:'agent',default_dynamic_variables:PADRAO};
}
function corpoAgente({llmId,voiceId,servidor,escritorio}){
  return{response_engine:{type:'retell-llm',llm_id:llmId},voice_id:voiceId,language:'pt-BR',agent_name:'LEX — ligações ao cliente',
    webhook_url:String(servidor).replace(/\/+$/,'')+'/api/voz/aviso',webhook_events:['call_started','call_ended','call_analyzed'],
    end_call_after_silence_ms:20000,max_call_duration_ms:600000,
    // Caixa postal: só o pedido de retorno, nunca detalhe do caso.
    voicemail_option:{action:{type:'static_text',text:'Aqui é a assistente virtual do '+(escritorio?'escritório '+escritorio:'escritório')+'. Por favor, retorne a ligação para o escritório. Obrigada.'}}};
}
function vozesEmPortugues(lista){
  return(Array.isArray(lista)?lista:[]).filter(v=>/portug|brazil|brasil|pt-br/i.test([v.accent,v.voice_name].join(' ')));
}

async function configurar({env=process.env,fetchImpl=globalThis.fetch,saida=console.log}={}){
  const chave=String(env.RETELL_API_KEY||'').trim();
  const servidor=String(env.LEX_SERVIDOR_URL||'').trim();
  if(!chave)throw new Error('Defina RETELL_API_KEY (chave da conta na Retell).');
  if(!/^https:\/\//.test(servidor))throw new Error('Defina LEX_SERVIDOR_URL com o endereço https do servidor do LEX.');
  const pedir=async(metodo,caminho,corpo)=>{
    const r=await fetchImpl(API+caminho,{method:metodo,headers:{Authorization:'Bearer '+chave,'Content-Type':'application/json'},...(corpo?{body:JSON.stringify(corpo)}:{})});
    const t=await r.text();let j=null;try{j=t?JSON.parse(t):null}catch{j=null}
    if(r.status<200||r.status>=300)throw new Error('Retell respondeu '+r.status+' em '+caminho+': '+String(j?.error_message||j?.message||t).slice(0,200));
    return j;
  };
  const voiceId=String(env.LEX_VOZ_VOICE_ID||'').trim();
  if(!voiceId){
    const pt=vozesEmPortugues(await pedir('GET','/list-voices'));
    saida(pt.length?'Vozes em português encontradas (escolha uma e rode de novo com LEX_VOZ_VOICE_ID=...):':'Nenhuma voz marcada como português na lista; escolha uma no painel da Retell e rode de novo com LEX_VOZ_VOICE_ID=...');
    for(const v of pt.slice(0,20))saida('  '+v.voice_id+' — '+v.voice_name+' ('+[v.gender,v.accent,v.provider].filter(Boolean).join(', ')+')'+(v.preview_audio_url?' · ouvir: '+v.preview_audio_url:''));
    return{ok:false,vozes:pt};
  }
  const llm=await pedir('POST','/create-retell-llm',corpoLlm());
  if(!llm?.llm_id)throw new Error('A Retell não devolveu o llm_id.');
  const agente=await pedir('POST','/create-agent',corpoAgente({llmId:llm.llm_id,voiceId,servidor,escritorio:String(env.ESCRITORIO_NOME||'').trim()}));
  if(!agente?.agent_id)throw new Error('A Retell não devolveu o agent_id.');
  saida('Pronto. Coloque nas variáveis do servidor do LEX:');
  saida('  RETELL_AGENT_ID='+agente.agent_id);
  saida('E confira: LEX_VOZ_NUMERO (número brasileiro importado na Retell, +55...).');
  return{ok:true,llm_id:llm.llm_id,agent_id:agente.agent_id};
}

if(require.main===module){
  configurar().then(r=>process.exit(r.ok?0:2)).catch(e=>{console.error('Não configurei: '+e.message);process.exit(1)});
}
module.exports={configurar,corpoLlm,corpoAgente,vozesEmPortugues,PADRAO};
