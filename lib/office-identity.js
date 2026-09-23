'use strict';

// Identidade do escritório que usa o LEX (white-label).
// Nenhum nome de pessoa, escritório, OAB ou cidade fica fixo no código do
// produto: tudo vem do perfil salvo pelo escritório (/api/escritorio) ou das
// variáveis de ambiente da implantação. Sem configuração, o texto é neutro.
//
// Variáveis (compatíveis com as já usadas em bot.js):
//   ESCRITORIO_NOME       nome do escritório                 ex.: "Silva Advocacia"
//   ESCRITORIO_RESP       nome do advogado titular           ex.: "Maria Silva"
//   ESCRITORIO_REG        registro profissional              ex.: "OAB/SP 123.456"
//   ESCRITORIO_END        cidade/UF ou endereço              ex.: "Campinas/SP"
//   LEX_TITULAR_TRATAMENTO  forma de tratamento (padrão "Dr(a).")
//   LEX_ASSISTENTE_NOME   nome do assistente virtual (padrão "LEX")

const NOMES_GENERICOS = new Set(['', 'sistema lex', 'lex', 'escritorio', 'escritório']);
let perfilSalvo = {};

function limpar(valor) { return typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ').slice(0, 160) : ''; }
function normalizar(valor) { return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

function setOfficeProfile(perfil) {
  perfilSalvo = perfil && typeof perfil === 'object' ? {...perfil} : {};
  return getIdentity();
}

function getIdentity(env = process.env, perfil = perfilSalvo) {
  const p = perfil || {};
  const nomeBruto = limpar(p.nome) || limpar(env.ESCRITORIO_NOME);
  const escritorio = NOMES_GENERICOS.has(normalizar(nomeBruto)) ? '' : nomeBruto;
  const titular = limpar(p.responsavel) || limpar(env.ESCRITORIO_RESP);
  const tratamentoEnv = env.LEX_TITULAR_TRATAMENTO;
  const tratamento = tratamentoEnv === undefined ? 'Dr(a).' : limpar(tratamentoEnv);
  const registro = limpar(p.registro) || limpar(env.ESCRITORIO_REG);
  const cidade = limpar(p.endereco) || limpar(env.ESCRITORIO_END);
  const assistente = limpar(env.LEX_ASSISTENTE_NOME) || 'LEX';
  const titularTratado = titular ? [tratamento, titular].filter(Boolean).join(' ') : 'o advogado responsável';
  return {
    escritorio,
    escritorioFrase: escritorio ? 'escritório ' + escritorio : 'escritório',
    titular,
    titularTratado,
    aoTitular: titular ? 'ao ' + titularTratado : 'ao advogado responsável',
    doTitular: titular ? 'do ' + titularTratado : 'do advogado responsável',
    registro,
    cidade,
    assistente,
    assinatura: [titular || null, registro || null, escritorio || null, cidade || null].filter(Boolean).join(', ')
  };
}

function titularKeywords(identity = getIdentity()) {
  const partes = normalizar(identity.titular).split(/\s+/).filter(p => p.length >= 3 && !/^(dr|dra|de|da|do|dos|das)$/.test(p));
  return partes.map(p => p.replace(/[^a-z0-9]/g, '')).filter(Boolean);
}

module.exports = {getIdentity, setOfficeProfile, titularKeywords};
