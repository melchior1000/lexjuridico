'use strict';

const https = require('node:https');
const {createSupabaseRequest, rowsFromResult, requireSuccess} = require('./supabase');

const TABLE = 'whatsapp_recepcao_publica';
const EVENTS_TABLE = 'whatsapp_recepcao_eventos';

function memoryInbox() {
  if (!global._whatsappPublicInbox) global._whatsappPublicInbox = [];
  return global._whatsappPublicInbox;
}

function memoryEvents() {
  if (!global._whatsappReceptionEvents) global._whatsappReceptionEvents = [];
  return global._whatsappReceptionEvents;
}

function categoryFor(text) {
  const n = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if (/prisao|preso|mandado|liminar|audiencia (hoje|amanha)|prazo (hoje|amanha)|bloqueio urgente|urgente/.test(n)) return {classe:'urgente', urgente:true};
  if (/processo|acao|audiencia|peticao|recurso|sentenca|prazo|andamento|advogad/.test(n)) return {classe:'juridico', urgente:false};
  if (/cobranca|vivo|claro|tim|operadora|fornecedor|financeiro|boleto|fatura/.test(n)) return {classe:'administrativo', urgente:false};
  return {classe:'geral', urgente:false};
}

function memoryUpsert(numero, nome, mensagem) {
  const inbox = memoryInbox();
  const now = new Date().toISOString();
  const kind = categoryFor(mensagem);
  let item = inbox.find(x => (x.numero === numero || x.number === numero) && x.status === 'aguardando_advogado');
  if (!item) {
    item = {
      numero, number:numero,
      nome:nome||'Contato', name:nome||'Contato',
      status:'aguardando_advogado',
      contador:0, count:0,
      criado_em:now, created_at:now
    };
    inbox.push(item);
  }
  const msg = String(mensagem || '').substring(0,1000);
  item.nome = nome || item.nome;
  item.name = item.nome;
  item.ultima_mensagem = msg;
  item.last_text = msg;
  item.atualizado_em = now;
  item.last_at = now;
  item.contador = (item.contador || item.count || 0) + 1;
  item.count = item.contador;
  item.classe = kind.classe;
  item.category = kind.classe;
  item.urgente = !!(item.urgente || item.urgent || kind.urgente);
  item.urgent = item.urgente;
  if (inbox.length > 200) inbox.splice(0, inbox.length - 200);
  return item;
}

function memoryAppendEvent(event) {
  const rows = memoryEvents();
  const row = {...event,id:'mem-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),criado_em:event.criado_em||new Date().toISOString()};
  rows.push(row);
  if (rows.length > 1000) rows.splice(0, rows.length - 1000);
  return row;
}

function createReceptionStore({url=process.env.SUPABASE_URL||'', key=process.env.SUPABASE_KEY||'', transport=https, request}={}) {
  const sb = request || createSupabaseRequest({url,key,https:transport});

  async function list({status='aguardando_advogado',limit=10}={}) {
    try {
      const rows = rowsFromResult(await sb('GET',TABLE,null,{
        select:'numero,nome,ultima_mensagem,classe,status,urgente,contador,criado_em,atualizado_em,arquivado_em',
        status:'eq.'+status,
        order:'urgente.desc,atualizado_em.desc',
        limit:String(Math.max(1,Math.min(Number(limit)||10,100)))
      }),'Recepcao WhatsApp');
      return rows;
    } catch {
      return memoryInbox().filter(x=>x.status===status)
        .sort((a,b)=>(Number(b.urgente ?? b.urgent)-Number(a.urgente ?? a.urgent)) || String(b.atualizado_em||b.last_at||'').localeCompare(String(a.atualizado_em||a.last_at||'')))
        .slice(0,limit)
        .map(x=>({
          numero:x.numero||x.number,
          nome:x.nome||x.name,
          ultima_mensagem:x.ultima_mensagem||x.last_text,
          classe:x.classe||x.category||'geral',
          status:x.status,
          urgente:!!(x.urgente??x.urgent),
          contador:Number(x.contador||x.count||1),
          criado_em:x.criado_em||x.created_at,
          atualizado_em:x.atualizado_em||x.last_at,
          arquivado_em:x.arquivado_em||x.archived_at||null
        }));
    }
  }

  async function upsert(numero,nome,mensagem) {
    const fallback = memoryUpsert(numero,nome,mensagem);
    const kind = categoryFor(mensagem);
    const now = new Date().toISOString();
    try {
      const existing = rowsFromResult(await sb('GET',TABLE,null,{select:'numero,contador,urgente',numero:'eq.'+numero,limit:'1'}),'Recepcao WhatsApp');
      const prev = existing[0] || null;
      const row = {
        numero,
        nome:nome||'Contato',
        ultima_mensagem:String(mensagem||'').substring(0,1000),
        classe:kind.classe,
        status:'aguardando_advogado',
        urgente:!!(kind.urgente || prev?.urgente),
        contador:(Number(prev?.contador)||0)+1,
        atualizado_em:now,
        arquivado_em:null
      };
      requireSuccess(await sb('POST',TABLE,row,{on_conflict:'numero'},{Prefer:'resolution=merge-duplicates,return=representation'}),'Recepcao WhatsApp');
      return row;
    } catch {
      return fallback;
    }
  }

  async function archive(numero) {
    const now = new Date().toISOString();
    try {
      const result = await sb('PATCH',TABLE,{status:'arquivado',arquivado_em:now,atualizado_em:now},{numero:'eq.'+numero,status:'eq.aguardando_advogado'},{Prefer:'return=representation'});
      const rows = requireSuccess(result,'Recepcao WhatsApp');
      const found = Array.isArray(rows) && rows.length > 0;
      if (found) {
        const local = memoryInbox().find(x=>(x.numero===numero||x.number===numero)&&x.status==='aguardando_advogado');
        if(local){local.status='arquivado';local.arquivado_em=now;local.archived_at=now;}
      }
      return found;
    } catch {
      const local = memoryInbox().find(x=>(x.numero===numero||x.number===numero)&&x.status==='aguardando_advogado');
      if(local){local.status='arquivado';local.arquivado_em=now;local.archived_at=now;return true;}
      return false;
    }
  }

  async function appendEvent({numero,nome='Contato',direcao,texto,classe='geral',nivel='ciencia'}={}) {
    const clean = {
      numero:String(numero||'').replace(/\D/g,''),
      nome:String(nome||'Contato').replace(/[\r\n]+/g,' ').substring(0,80),
      direcao:['entrada','saida_lex','saida_operador'].includes(direcao)?direcao:'entrada',
      texto:String(texto||'').substring(0,2000),
      classe:['urgente','juridico','administrativo','geral'].includes(classe)?classe:'geral',
      nivel:['urgente','atencao','ciencia'].includes(nivel)?nivel:'ciencia',
      criado_em:new Date().toISOString()
    };
    const fallback = memoryAppendEvent(clean);
    if (!clean.numero || !clean.texto) return fallback;
    try {
      const result = requireSuccess(await sb('POST',EVENTS_TABLE,clean,{}, {Prefer:'return=representation'}),'Historico recepcao WhatsApp');
      return Array.isArray(result) && result[0] ? result[0] : clean;
    } catch {
      return fallback;
    }
  }

  async function history(numero,{limit=20}={}) {
    const target=String(numero||'').replace(/\D/g,'');
    const max=Math.max(1,Math.min(Number(limit)||20,50));
    try {
      return rowsFromResult(await sb('GET',EVENTS_TABLE,null,{
        select:'id,numero,nome,direcao,texto,classe,nivel,criado_em',
        numero:'eq.'+target,
        order:'criado_em.desc',
        limit:String(max)
      }),'Historico recepcao WhatsApp');
    } catch {
      return memoryEvents().filter(x=>x.numero===target).sort((a,b)=>String(b.criado_em).localeCompare(String(a.criado_em))).slice(0,max);
    }
  }

  async function healthcheck() {
    try {
      rowsFromResult(await sb('GET',TABLE,null,{select:'numero',limit:'1'}),'Recepcao WhatsApp');
      rowsFromResult(await sb('GET',EVENTS_TABLE,null,{select:'id',limit:'1'}),'Historico recepcao WhatsApp');
      return {ok:true,persistente:true,historico:true};
    } catch(error) {
      return {ok:false,persistente:false,historico:false,error:error.message};
    }
  }

  return {list,upsert,archive,appendEvent,history,healthcheck,categoryFor};
}

module.exports={createReceptionStore,categoryFor};
