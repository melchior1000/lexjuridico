'use strict';
const el=id=>document.getElementById(id);let source=null;
const notice=text=>{el('status').textContent=text;};
chrome.storage.session.get(['server','token']).then(c=>{el('server').value=c.server||'';el('token').value=c.token||'';});
el('save').addEventListener('click',async()=>{
  try {
    const server=new URL(el('server').value.trim());
    if(server.protocol!=='https:'||server.username||server.password||server.port||server.pathname!=='/'||server.search||server.hash)throw new Error('Informe somente a origem HTTPS do servidor LEX.');
    const granted=await chrome.permissions.request({origins:[server.origin+'/*']});
    if(!granted)throw new Error('Conexão não autorizada.');
    const token=el('token').value.trim();if(!token)throw new Error('Gere o código temporário no LEX.');
    await chrome.storage.session.set({server:server.origin,token});notice('Configuração guardada nesta sessão do navegador.');
  }catch(e){notice(e.message);}
});
el('capture').addEventListener('click',async()=>{
  try {
    source=null;el('send').disabled=true;
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const url=new URL(tab.url);
    if(url.protocol!=='https:'||!url.hostname.endsWith('.jus.br'))throw new Error('Abra o processo em uma página oficial do tribunal.');
    const [out]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({selected:window.getSelection()?.toString()||'',numbers:[...new Set((document.body.innerText.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g)||[]))].slice(0,20)})});
    if(!out.result.selected.trim())throw new Error('Selecione o texto do andamento na página e tente novamente.');
    if(out.result.selected.length>20000)throw new Error('Selecione somente o andamento (até 20.000 caracteres).');
    source=url.origin+url.pathname;el('source').textContent=source;el('text').value=out.result.selected;
    el('cnj').value=out.result.numbers.length===1?out.result.numbers[0]:'';
    el('send').disabled=false;notice('Confira o CNJ e informe a data exata do andamento.');
  }catch(e){notice(e.message);}
});
el('send').addEventListener('click',async()=>{
  el('send').disabled=true;
  try {
    const cfg=await chrome.storage.session.get(['server','token']);
    if(!cfg.server||!cfg.token||!source)throw new Error('Conecte ao LEX e capture uma seleção primeiro.');
    const cnj=el('cnj').value.trim(),date=el('day').value;
    if(cnj.replace(/\D/g,'').length!==20||!date)throw new Error('Confira o número CNJ e a data.');
    const r=await fetch(cfg.server+'/api/conector/andamento',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cfg.token},body:JSON.stringify({cnj,data:date,andamento_texto:el('text').value,fonte_url:source}),signal:AbortSignal.timeout(30000)});
    const data=await r.json();if(!r.ok||data.ok!==true)throw new Error(data.error||'Importação não confirmada.');
    notice(data.duplicado?'Este andamento já estava no LEX.':'Andamento salvo. O prazo do processo foi preservado.');
  }catch(e){notice(e.message);}finally{el('send').disabled=false;}
});
