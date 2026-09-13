const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const {requireSuccess, rowsFromResult} = require('../lib/supabase');
const source = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
const auth = source.slice(source.indexOf('function gerarToken('), source.indexOf('// PATCH BOT FINAL: helpers faltantes'));
const docs = source.slice(source.indexOf('function _escapeXmlPeca('), source.indexOf('const USUARIOS ='));
const handler = source.slice(source.indexOf('const server = http.createServer('), source.indexOf('// FEATURE: Processar marcadores de ação'));
function setup(extra = {}) {
  let callback;
  const context = vm.createContext({
    console: {log() {}, warn() {}, error() {}},
    requireSuccess, rowsFromResult, incomingWhatsappMessage:require("../lib/integration-status").incomingWhatsappMessage, EVO_INST:"LEX-JURIDICO",
    Buffer, URL, CRYPTO: crypto, AUTH_SECRET: 'isolated-test-secret', AUTH_IDLE_MS: 1800000,
    PERMS: {admin: {}, secretaria: {}}, SENHAS_WEB: {admin: '', secretaria: ''},
    global: {_tokensRevogados: new Set(), _sessaoAtividade: new Map()},
    corsHeaders: () => ({'Content-Type':'application/json'}), _corsOrigin: () => 'https://lexjuridico.vercel.app',
    http: {createServer: fn => { callback = fn; }},
    _checkLoginRate: () => true, lerBody: async req => req.body,
    _registrarTempoUso: async () => {},
    ...extra
  });
  vm.runInContext(docs + '\n' + auth + '\n' + handler, context);
  Object.assign(context, extra);
  return {
    context,
    token: p => context.gerarToken(p),
    async request(url, token, body, method = 'GET', headers = {}) {
      const req = {url, method, headers: {...headers, ...(token ? {authorization: 'Bearer ' + token} : {})}, socket: {}, body};
      const result = {};
      const res = {writeHead: (status, headers) => {result.status = status; result.headers = headers;},
        end: body => {result.body = body;}};
      await callback(req, res);
      return result;
    }
  };
}


module.exports = {setup, source};
