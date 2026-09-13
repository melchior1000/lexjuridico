'use strict';
const fs=require('node:fs');
let s=fs.readFileSync('bot.js','utf8');

const oldConsent=`        if(/^(sim|sim autorizo|autorizo|aceito|concordo)/.test(n)) {\n          perfil.lgpd_consentimento = true;\n          await env('Perfeito, consentimento LGPD registrado. Descreva a situacao do cliente.', ctx);\n        } else {`;
const newConsent=`        if(/^(sim|sim autorizo|autorizo|aceito|concordo)/.test(n)) {\n          perfil.lgpd_consentimento = true;\n          await _salvarPerfilCliente(perfil);\n          await env('Perfeito. Agora me conte brevemente o que aconteceu.', ctx);\n          return true;\n        } else {`;
if((s.match(new RegExp(oldConsent.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))||[]).length!==1) throw new Error('Trecho antigo de consentimento não encontrado exatamente uma vez.');
s=s.replace(oldConsent,newConsent);

const start=s.indexOf('function _montarResumoClassificacaoCliente(classificacao, analisePrev) {');
const end=s.indexOf('\nasync function _processarClassificacaoIntakePerfil',start);
if(start<0||end<0) throw new Error('Limites exatos do resumo ao cliente não encontrados.');
const oldSummary=s.slice(start,end);
if(!oldSummary.includes('Classificacao automatica:')||!oldSummary.includes('Base inicial:')) throw new Error('Resumo antigo não corresponde ao esperado.');
const newSummary=`function _montarResumoClassificacaoCliente(classificacao, analisePrev) {\n  let msg = 'Entendi o contexto inicial e vou organizar seu atendimento com base no que você contou.';\n  if(analisePrev && Array.isArray(analisePrev.docs_necessarios) && analisePrev.docs_necessarios.length) {\n    msg += '\\nPara seguir, vou precisar de: ' + analisePrev.docs_necessarios.slice(0,4).join(', ') + '.';\n  }\n  return msg;\n}`;
s=s.slice(0,start)+newSummary+s.slice(end);

if(!s.includes('async function _processarClassificacaoIntakePerfil')) throw new Error('Função de classificação foi perdida; abortando.');
if(!s.includes('return true;\n        } else {')) throw new Error('Consentimento não encerra o turno.');
fs.writeFileSync('bot.js',s);
console.log('patch LGPD/humanização aplicado com preservação da classificação interna');
