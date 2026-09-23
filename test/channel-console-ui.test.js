'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const ui=fs.readFileSync('office-ui-v2.js','utf8');
const css=fs.readFileSync('office-ui-v2.css','utf8');
const routes=fs.readFileSync('lib/office-routes.js','utf8');

test('console comercial usa a Recepção unificada para WhatsApp e Telegram',()=>{
  assert.match(ui,/window\.lexChannel=async function/);
  assert.match(ui,/\/api\/escritorio\/recepcao\?status=/);
  assert.match(ui,/\/api\/escritorio\/recepcao\/historico/);
  assert.match(ui,/\/api\/escritorio\/recepcao\/responder/);
  assert.match(ui,/A resposta sai pelo mesmo canal/);\n  assert.match(ui,/Confirmar envio/);\n  assert.match(ui,/Dê uma ordem ao LEX/);
  assert.doesNotMatch(ui,/goLex\(\\'whatsapp\\'\)/);
  assert.doesNotMatch(ui,/goLex\(\\'telegram\\'\)/);
});

test('console de canais é responsivo para computador tablet e celular',()=>{
  assert.match(css,/\.lex-channel-console\{display:grid;grid-template-columns:/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(css,/\.lex-channel-console\.has-open-chat \.lex-channel-sidebar\{display:none\}/);
  assert.match(css,/\.lex-channel-console\.has-open-chat \.lex-channel-chat\{display:flex\}/);
});

test('secretaria e responsável jurídico podem operar a Recepção sem liberar configuração',()=>{
  assert.match(routes,/secretariaPodeRecepcao=profile==='secretaria'&&path\.startsWith\('\/api\/escritorio\/recepcao'\)/);
  assert.match(routes,/\['admin','advogado','secretaria'\]\.includes\(profile\)/);
  assert.match(routes,/Recepção restrita à equipe autorizada/);
});


test('chips do coordenador mantêm grade móvel e flex apenas acima de 620px',()=>{
  assert.match(css,/@media\(max-width:620px\)[\s\S]*\.lex2-context-chips\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(min-width:621px\)\{[\s\S]*\.lex2-context-chips\{display:flex/);
  const mobile=css.match(/@media\(max-width:620px\)\{([\s\S]*?)\n\}/)?.[1]||'';
  assert.doesNotMatch(mobile,/\.lex2-context-chips\{display:flex/);
});

test('retorno atrasado do mesmo contato não substitui histórico mais novo',async()=>{
  const vm=require('node:vm');
  const start=ui.indexOf('window.lexSelectChannelContact=async function');
  const end=ui.indexOf('window.lexCloseChannelContact=',start);
  assert.ok(start>=0&&end>start);

  let resolveFirst,resolveSecond,calls=0;
  const first=new Promise(r=>{resolveFirst=r}),second=new Promise(r=>{resolveSecond=r});
  const chat={innerHTML:'',isConnected:true};
  const consoleEl={classList:{add(){}}};
  const messages={scrollTop:0,scrollHeight:10};
  const compose={focus(){}};
  const context={
    window:{},
    renderChannelList(){},
    channelKey:r=>String(r.origem)+':'+String(r.id),
    $:sel=>sel==='#lex-channel-chat'?chat:sel==='#lex-channel-console'?consoleEl:sel==='#lex-channel-messages'?messages:sel==='#lex-channel-compose-text'?compose:null,
    lexApi:()=>{calls++;return calls===1?first:second},
    esc:v=>String(v??''),
    channelIcon:()=>'*',
    channelWhen:()=> '',
    channelName:v=>String(v)
  };
  vm.createContext(context);
  vm.runInContext("const channelDesk={channel:'all',rows:[{origem:'whatsapp',id:'1',nome:'Contato'}],selected:null,query:'',historyGeneration:0};"+ui.slice(start,end),context);

  const older=context.window.lexSelectChannelContact('whatsapp','1');
  const newer=context.window.lexSelectChannelContact('whatsapp','1');
  resolveSecond({historico:[{direcao:'entrada',texto:'NOVO'}]});
  await newer;
  resolveFirst({historico:[{direcao:'entrada',texto:'VELHO'}]});
  await older;

  assert.match(chat.innerHTML,/NOVO/);
  assert.doesNotMatch(chat.innerHTML,/VELHO/);
});
