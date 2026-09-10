'use strict';

const OFFICIAL_LEGAL_DOMAINS = Object.freeze([
  'stf.jus.br', 'stj.jus.br', 'tst.jus.br', 'tse.jus.br', 'stm.jus.br',
  'cnj.jus.br', 'cjf.jus.br', 'csjt.jus.br', 'trf1.jus.br', 'trf2.jus.br',
  'trf3.jus.br', 'trf4.jus.br', 'trf5.jus.br', 'trf6.jus.br',
  'lexml.gov.br', 'planalto.gov.br'
]);

function isOfficialLegalUrl(value) {
  try {
    const url = new URL(String(value));
    if(url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host.endsWith('.jus.br') || host === 'jus.br' ||
      OFFICIAL_LEGAL_DOMAINS.some(domain => host === domain || host.endsWith('.'+domain));
  } catch(_) {
    return false;
  }
}

function extractOfficialSources(result) {
  const found = [];
  const add = (url, title) => {
    if(!isOfficialLegalUrl(url)) return;
    if(found.some(item => item.url === url)) return;
    found.push({url, titulo: String(title || '').trim() || null});
  };
  const blocks = result?.raw?.content;
  if(Array.isArray(blocks)) {
    for(const block of blocks) {
      for(const citation of (Array.isArray(block?.citations) ? block.citations : [])) {
        add(citation?.url, citation?.title || citation?.cited_text);
      }
      if(block?.type === 'web_search_tool_result' && Array.isArray(block?.content)) {
        for(const item of block.content) add(item?.url, item?.title);
      }
    }
  }
  const text = String(result?.texto || '');
  for(const match of text.matchAll(/https:\/\/[^\s<>\])}"']+/g)) add(match[0].replace(/[.,;:]$/, ''), '');
  return found;
}

function jurisprudenceAssurance(first, review) {
  const searches = [...(first?.buscas || []), ...(review?.buscas || [])]
    .map(item => String(item?.query || '').trim()).filter(Boolean);
  const sources = [...extractOfficialSources(first), ...extractOfficialSources(review)]
    .filter((item, index, all) => all.findIndex(other => other.url === item.url) === index);
  return {
    nivel: 'dupla_pesquisa_oficial',
    modelo_forte: true,
    consultas_realizadas: searches.length,
    fontes_oficiais: sources,
    revisao_humana_obrigatoria: true
  };
}

module.exports = {OFFICIAL_LEGAL_DOMAINS, isOfficialLegalUrl, extractOfficialSources, jurisprudenceAssurance};
