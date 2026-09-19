'use strict';

function createTelegramPoller({
  token,
  requestJson,
  adapter,
  records,
  logger=console,
  setTimer=setTimeout,
  clearTimer=clearTimeout,
  cursorKey='lex_telegram_poll_cursor_v1',
  baseDelayMs=3000,
  maxDelayMs=60000
}={}) {
  if(typeof requestJson!=='function') throw new Error('telegramPoller: requestJson obrigatorio');
  if(typeof adapter!=='function') throw new Error('telegramPoller: adapter obrigatorio');
  if(!records || typeof records.read!=='function' || typeof records.change!=='function') throw new Error('telegramPoller: records obrigatorio');

  let running=false;
  let timer=null;
  let inFlight=false;
  let failures=0;
  let lastUpdateId=0;

  const api=method=>'https://api.telegram.org/bot'+token+'/'+method;
  const schedule=delay=>{
    if(!running) return;
    if(timer) clearTimer(timer);
    timer=setTimer(()=>{ timer=null; return tick().catch(e=>logger.warn?.('[Telegram] poll tick falhou:',e.message)); },delay);
  };
  const retryDelay=()=>Math.min(maxDelayMs,baseDelayMs*Math.pow(2,Math.min(failures,5)));

  async function saveCursor(updateId) {
    await records.change(cursorKey, current=>({
      update_id:Math.max(Number(current?.update_id)||0,Number(updateId)||0),
      atualizado_em:new Date().toISOString()
    }));
    lastUpdateId=Math.max(lastUpdateId,Number(updateId)||0);
  }

  async function loadCursor() {
    const row=await records.read(cursorKey);
    lastUpdateId=Number(row?.value?.update_id)||0;
    if(lastUpdateId>0) return;
    // Primeira ativacao: descarta backlog anterior ao boot para nao responder mensagens antigas.
    const initial=await requestJson(api('getUpdates')+'?offset=-1&timeout=0&allowed_updates='+encodeURIComponent('["message","channel_post"]'),{timeoutMs:10000});
    if(initial?.ok && initial.result?.length) await saveCursor(initial.result[initial.result.length-1].update_id);
  }

  async function webhookActive() {
    const info=await requestJson(api('getWebhookInfo'),{timeoutMs:10000});
    if(!info?.ok) throw new Error('getWebhookInfo nao confirmado');
    return !!String(info.result?.url||'').trim();
  }

  async function tick() {
    if(!running || inFlight) return;
    inFlight=true;
    try {
      if(await webhookActive()) {
        logger.warn?.('[Telegram] webhook ativo; polling getUpdates desativado.');
        running=false;
        return;
      }
      const data=await requestJson(api('getUpdates')+'?offset='+(lastUpdateId+1)+'&timeout=30&allowed_updates='+encodeURIComponent('["message","channel_post"]'),{timeoutMs:40000});
      if(!data?.ok) throw new Error('getUpdates nao confirmado');
      for(const update of data.result||[]) {
        const id=Number(update?.update_id)||0;
        if(!id || id<=lastUpdateId) continue;
        // Cursor persistido antes do dispatch: restart nunca repete update ja aceito.
        await saveCursor(id);
        const msg=update.message||update.channel_post;
        if(msg) await adapter(msg);
      }
      failures=0;
      schedule(baseDelayMs);
    } catch(e) {
      failures++;
      const is409=Number(e?.status)===409 || /409|conflict/i.test(String(e?.message||''));
      if(is409) logger.warn?.('[Telegram] 409 Conflict: outro consumidor/webhook pode estar ativo; revalidando com backoff.');
      else logger.warn?.('[Telegram] polling indisponivel; nova tentativa com backoff:',e.message);
      schedule(retryDelay());
    } finally { inFlight=false; }
  }

  async function start() {
    if(running) return {ok:true,already_running:true};
    if(!token) return {ok:false,disabled:true,reason:'token_ausente'};
    running=true;
    try {
      if(await webhookActive()) {
        running=false;
        logger.warn?.('[Telegram] webhook ativo; polling nao iniciado.');
        return {ok:false,webhook:true};
      }
      await loadCursor();
      schedule(0);
      return {ok:true};
    } catch(e) {
      failures++;
      logger.warn?.('[Telegram] inicializacao do polling falhou; tentando novamente com backoff:',e.message);
      schedule(retryDelay());
      return {ok:false,retrying:true,error:e.message};
    }
  }

  function stop() {
    running=false;
    if(timer) clearTimer(timer);
    timer=null;
  }

  return {start,stop,state:()=>({running,inFlight,failures,lastUpdateId})};
}

module.exports={createTelegramPoller};
