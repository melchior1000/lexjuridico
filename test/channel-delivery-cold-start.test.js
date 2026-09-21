const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {sendWhatsApp}=require('../lib/channel-delivery');

function response(req,callback,status,body){
  queueMicrotask(()=>{
    const res=new EventEmitter();
    res.statusCode=status;
    callback(res);
    res.emit('data',Buffer.from(JSON.stringify(body)));
    res.emit('end');
  });
}
function fakeTransport(){
  let connectionChecks=0,posts=0;
  return {
    stats(){return {connectionChecks,posts};},
    request(url,options,callback){
      const req=new EventEmitter();
      req.setTimeout=()=>{};
      req.write=()=>{};
      req.destroy=()=>{};
      req.end=()=>{
        const path=String(url.pathname||'');
        if(path.includes('/instance/connectionState/')){
          connectionChecks++;
          if(connectionChecks===1){queueMicrotask(()=>req.emit('error',new Error('cold start')));return;}
          response(req,callback,200,{instance:{instanceName:'LEX-JURIDICO',state:'open'}});
          return;
        }
        if(path.includes('/instance/fetchInstances')){
          response(req,callback,200,[{name:'LEX-JURIDICO',ownerJid:'556199333672@s.whatsapp.net'}]);
          return;
        }
        if(path.includes('/message/sendText/')){
          posts++;
          response(req,callback,200,{key:{id:'provider-msg-1'}});
          return;
        }
        response(req,callback,404,{error:'unknown'});
      };
      return req;
    }
  };
}

test('WhatsApp acorda Evolution antes do envio e faz POST uma unica vez',async()=>{
  const transport=fakeTransport();
  const env={
    EVOLUTION_URL:'https://evolution.example.test',
    EVOLUTION_API_KEY:'fake',
    EVOLUTION_INSTANCE:'LEX-JURIDICO',
    LEX_WHATSAPP_NUMBER:'556199333672'
  };
  const ok=await sendWhatsApp('5561998765432','teste',{env,transport,sleepFn:async()=>{}});
  assert.equal(ok,true);
  assert.equal(transport.stats().posts,1);
  assert.ok(transport.stats().connectionChecks>=3);
});
