'use strict';
const {intakeDecision} = require('./intake-door');
const {withProcessLock} = require('./process-lock');

function isTelegramOwner(msg, owner) {
  return !!owner && msg?.chat?.type === 'private' && String(msg.chat.id) === String(owner) && String(msg.from?.id) === String(owner) && !msg.from?.is_bot;
}

function createTelegramReception({records, owner, send, report}) {
  const keyFor = id => 'lex_recepcao_telegram_' + id;
  const locks = {};
  const notify = async text => { try { return await report(text); } catch { return false; } };
  const deliver = async (id,text) => { try { return await send(id,text); } catch { return false; } };

  async function receive(msg) {
    if (!msg?.chat || msg.chat.type !== 'private' || msg.from?.is_bot || isTelegramOwner(msg,owner)) return false;
    const id = String(msg.chat.id);
    if (!/^\d+$/.test(id) || String(msg.from?.id) !== id) return false;
    return withProcessLock(locks,id,async () => {
      const text = String(msg.text || msg.caption || '').slice(0,2000);
      const media = msg.document ? 'documento' : msg.photo ? 'imagem' : msg.voice || msg.audio ? 'audio' : null;
      const input = text || (media ? '[Arquivo recebido: '+media+']' : '[Mensagem sem texto]');
      const eventId = String(msg.message_id || '');
      let decision, duplicate = false;
      try {
        await records.change(keyFor(id), old => {
          const row = old || {id,canal:'telegram',history:[],eventIds:[]};
          if (eventId && row.eventIds.includes(eventId)) {duplicate=true;return undefined;}
          decision = intakeDecision(text,{message:{documentMessage:media==='documento',imageMessage:media==='imagem',audioMessage:media==='audio'}},[...row.history].reverse());
          row.nome = decision.name || row.nome || String(msg.from.first_name || 'Contato').slice(0,80);
          row.status = 'aguardando_advogado';
          row.destino = decision.destino;
          row.urgente = row.urgente || decision.kind === 'urgent';
          row.ultima_mensagem = input;
          row.requiresApproval = decision.requiresApproval;
          row.atualizado_em = new Date().toISOString();
          row.history = [...row.history,{direcao:'entrada',texto:input,criado_em:row.atualizado_em}].slice(-50);
          row.eventIds = [...row.eventIds,eventId].filter(Boolean).slice(-100);
          if (media) row.ultimo_arquivo = {tipo:media,file_id:msg.document?.file_id||msg.photo?.at(-1)?.file_id||msg.voice?.file_id||msg.audio?.file_id,message_id:eventId};
          return row;
        });
      } catch {
        await notify('[ATENÇÃO] Telegram '+id+': não consegui registrar o atendimento. Nenhuma tarefa foi executada.');
        await deliver(id,'Não consegui registrar seu atendimento agora. Por favor, tente novamente em instantes.');
        return false;
      }
      if (duplicate) return true;
      const marker = decision.kind==='urgent'?'[URGENTE]':decision.escalate?'[ATENÇÃO]':'[CIÊNCIA]';
      const summary=marker+' Telegram '+id+' — setor sugerido: '+decision.destino+'\n'+input+'\n'+(decision.requiresApproval?'[AGUARDA SUA DECISÃO] ':'')+'Para responder, use /respondertg '+id+' TEXTO EXATO no seu Telegram privado.';
      if(decision.kind==='urgent') await notify(summary);
      const sent = await deliver(id,decision.reply);
      let stored=true;
      if (sent) {
        try {await records.change(keyFor(id), row => ({...row,history:[...row.history,{direcao:'saida_lex',texto:decision.reply,criado_em:new Date().toISOString()}].slice(-50)}));}
        catch {stored=false;}
      }
      await notify((decision.kind==='urgent'?'Telegram '+id:summary)+'\n'+(sent?'[LEX] respondeu: '+decision.reply:'[FALHA DE ENVIO] Resposta não confirmada.')+(stored?'':'\n[ATENÇÃO] Falha ao salvar a resposta no histórico.'));
      return sent;
    });
  }

  async function ownerCommand(msg) {
    if (!isTelegramOwner(msg,owner)) return false;
    const text = String(msg.text || '').trim();
    if (/^\/recepcaotg$/.test(text)) {
      const rows = (await records.list('lex_recepcao_telegram_')).filter(x=>x.status==='aguardando_advogado');
      await deliver(owner,rows.length ? rows.map(x=>`${x.urgente?'[URGENTE] ':''}${x.nome} (${x.id}) — ${x.destino}: ${x.ultima_mensagem}`).join('\n').slice(0,3500) : 'Telegram: nenhum contato aguardando.');
      return true;
    }
    const m = text.match(/^\/(historicotg|respondertg|arquivartg)\s+(\d{1,20})(?:\s+([\s\S]+))?$/);
    if (!m) return false;
    const [,command,id,reply] = m;
    const row = (await records.read(keyFor(id)))?.value;
    if (!row) {await deliver(owner,'Contato não encontrado na recepção do Telegram.');return true;}
    if (command==='historicotg') await deliver(owner,row.history.slice(-15).map(x=>(x.direcao==='entrada'?'Contato':x.direcao==='saida_operador'?'Você':'LEX')+': '+x.texto).join('\n').slice(0,3500));
    if (command==='arquivartg') {
      await records.change(keyFor(id),old=>({...old,status:'arquivado'}));
      await deliver(owner,'Contato '+id+' arquivado.');
    }
    if (command==='respondertg') {
      if (!reply?.trim() || reply.length>3500) {await deliver(owner,'Informe o texto exato, de até 3500 caracteres.');return true;}
      const sent = await deliver(id,reply);
      if (sent) await records.change(keyFor(id),old=>({...old,requiresApproval:false,history:[...old.history,{direcao:'saida_operador',texto:reply,criado_em:new Date().toISOString()}].slice(-50)}));
      await notify(sent ? '[APROVADO E ENVIADO] Telegram '+id+': '+reply : '[ATENÇÃO] Telegram '+id+': envio não confirmado.');
    }
    return true;
  }
  return {receive,ownerCommand};
}

module.exports = {createTelegramReception,isTelegramOwner};
