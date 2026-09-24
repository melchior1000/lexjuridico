'use strict';

function createTelegramPoller({
  token, requestJson, adapter, records, logger=console,
  setTimer=setTimeout, clearTimer=clearTimeout,
  cursorKey='lex_telegram_poll_cursor_v1', baseDelayMs=3000, maxDelayMs=60000,
  takeoverWebhook=false
}={}) {
  if(typeof requestJson!=='function') throw new Error('telegramPoller: requestJson obrigatorio');
  if(typeof adapter!=='function') throw new Error('telegramPoller: adapter obrigatorio');
  if(!records || typeof records.read!=='function' || typeof records.change!=='function') throw new Error('telegramPoller: records obrigatorio');

  let running=false, timer=null, inFlight=false, inFlightDone=null, resolveInFlight=null;
  let failures=0, lastUpdateId=0, cursorLoaded=false, generation=0, conflictSince=0, conflictReported=false;

  const api=method=>'https://api.telegram.org/bot'+token+'/'+method;
  const schedule=delay=>{
    if(!running) return;
    if(timer) clearTimer(timer);
    timer=setTimer(()=>{ timer=null; return tick().catch(e=>logger.warn?.('[Telegram] poll tick falhou:',e.message)); },delay);
  };
  const retryDelay=()=>Math.min(maxDelayMs,baseDelayMs*Math.pow(2,Math.min(failures,5)));
  const terminalStatus=e=>[401,403,404].includes(Number(e?.status));
  const alive=gen=>running && gen===generation;

  async function saveCursor(updateId) {
    await records.change(cursorKey,current=>({
      update_id:Math.max(Number(current?.update_id)||0,Number(updateId)||0),
      atualizado_em:new Date().toISOString()
    }));
    lastUpdateId=Math.max(lastUpdateId,Number(updateId)||0);
  }

  async function loadCursor() {
    if(cursorLoaded) return;
    const row=await records.read(cursorKey);
    lastUpdateId=Number(row?.value?.update_id)||0;
    cursorLoaded=true;
  }

  async function initializeCursor(gen) {
    if(lastUpdateId>0 || !alive(gen)) return;
    const initial=await requestJson(api('getUpdates')+'?offset=-1&timeout=0&allowed_updates='+encodeURIComponent('["message","channel_post"]'),{timeoutMs:10000});
    if(!alive(gen)) return;
    if(initial?.ok && initial.result?.length) await saveCursor(initial.result[initial.result.length-1].update_id);
  }

  async function webhookActive() {
    const info=await requestJson(api('getWebhookInfo'),{timeoutMs:10000});
    if(!info?.ok) throw new Error('getWebhookInfo nao confirmado');
    return !!String(info.result?.url||'').trim();
  }

  async function ensurePollingOwner(gen) {
    if(!await webhookActive()) return true;
    if(!alive(gen)) return false;
    if(!takeoverWebhook) return false;
    const removed=await requestJson(api('deleteWebhook')+'?drop_pending_updates=true',{timeoutMs:10000});
    if(!alive(gen)) return false;
    if(!removed?.ok) throw new Error('deleteWebhook nao confirmado');
    if(await webhookActive()) throw new Error('webhook permaneceu ativo apos deleteWebhook');
    if(!alive(gen)) return false;
    logger.warn?.('[Telegram] webhook anterior removido; polling assumiu recepcao.');
    return true;
  }

  async function tick() {
    if(!running || inFlight) return;
    const gen=generation;
    inFlight=true;
    inFlightDone=new Promise(resolve=>{ resolveInFlight=resolve; });
    try {
      await loadCursor();
      if(!alive(gen)) return;
      if(!await ensurePollingOwner(gen)) {
        if(!alive(gen)) return;
        logger.warn?.('[Telegram] webhook ativo; polling getUpdates desativado.');
        running=false; generation++; return;
      }
      if(!alive(gen)) return;
      await initializeCursor(gen);
      if(!alive(gen)) return;
      const data=await requestJson(api('getUpdates')+'?offset='+(lastUpdateId+1)+'&timeout=30&allowed_updates='+encodeURIComponent('["message","channel_post"]'),{timeoutMs:40000});
      if(!alive(gen)) return;
      if(!data?.ok) throw new Error('getUpdates nao confirmado');
      for(const update of data.result||[]) {
        if(!alive(gen)) return;
        const id=Number(update?.update_id)||0;
        if(!id || id<=lastUpdateId) continue;
        await saveCursor(id);
        if(!alive(gen)) return;
        const msg=update.message||update.channel_post;
        if(msg) {
          try { await adapter(msg); }
          catch(adapterErr) { logger.warn?.('[Telegram] adapter falhou no update '+id+':',adapterErr.message); }
        }
      }
      failures=0;conflictSince=0;conflictReported=false;
      schedule(baseDelayMs);
    } catch(e) {
      failures++;
      if(terminalStatus(e)) {
        running=false; generation++;
        logger.warn?.('[Telegram] polling desativado por erro terminal HTTP '+Number(e.status)+'.');
        return;
      }
      const is409=Number(e?.status)===409 || /409|conflict/i.test(String(e?.message||''));
      if(is409){
        // Troca de versão no Render causa 409 por alguns segundos (duas instâncias). Passando de
        // 5 minutos, é outro programa lendo o mesmo bot: diz isso uma vez, com a solução.
        const now=Date.now();
        if(!conflictSince)conflictSince=now;
        if(now-conflictSince>5*60*1000&&!conflictReported){
          conflictReported=true;
          logger.error?.('[Telegram] 409 há mais de 5 minutos: outro programa está lendo este mesmo bot (outro deploy, cópia local ou webhook). Desligue o outro ou gere um token novo no BotFather e troque TELEGRAM_TOKEN no Render.');
        }else if(!conflictReported)logger.warn?.('[Telegram] 409 Conflict: outro consumidor/webhook pode estar ativo; revalidando com backoff.');
      }
      else logger.warn?.('[Telegram] polling indisponivel; nova tentativa com backoff:',e.message);
      schedule(retryDelay());
    } finally {
      inFlight=false;
      const done=resolveInFlight; resolveInFlight=null;
      if(done) done();
      inFlightDone=null;
    }
  }

  async function start() {
    if(running) return {ok:true,already_running:true};
    if(!token) return {ok:false,disabled:true,reason:'token_ausente'};
    running=true;
    const gen=++generation;
    try {
      await loadCursor();
      if(!alive(gen)) return {ok:false,stopped:true};
      if(!await ensurePollingOwner(gen)) {
        if(!alive(gen)) return {ok:false,stopped:true};
        running=false; generation++;
        logger.warn?.('[Telegram] webhook ativo; polling nao iniciado.');
        return {ok:false,webhook:true};
      }
      if(!alive(gen)) return {ok:false,stopped:true};
      await initializeCursor(gen);
      if(!alive(gen)) return {ok:false,stopped:true};
      schedule(0);
      return {ok:true};
    } catch(e) {
      failures++;
      if(terminalStatus(e)) {
        running=false; generation++;
        logger.warn?.('[Telegram] polling nao iniciado por erro terminal HTTP '+Number(e.status)+'.');
        return {ok:false,terminal:true,status:Number(e.status)};
      }
      logger.warn?.('[Telegram] inicializacao do polling falhou; tentando novamente com backoff:',e.message);
      schedule(retryDelay());
      return {ok:false,retrying:true,error:e.message};
    }
  }

  async function stop() {
    running=false; generation++;
    if(timer) clearTimer(timer);
    timer=null;
    const pending=inFlightDone;
    if(pending) await pending;
  }

  return {start,stop,state:()=>({running,inFlight,failures,lastUpdateId,cursorLoaded,generation})};
}
module.exports={createTelegramPoller};
