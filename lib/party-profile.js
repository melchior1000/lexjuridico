'use strict';

function digits(value) { return String(value || '').replace(/\D/g, ''); }

function cpfValid(value) {
  const d = digits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (let size = 9; size <= 10; size++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(d[i]) * (size + 1 - i);
    const check = (sum * 10) % 11 % 10;
    if (check !== Number(d[size])) return false;
  }
  return true;
}

function cnpjValid(value) {
  const d = digits(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = len => {
    const weights = len === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const sum = weights.reduce((acc,w,i)=>acc + Number(d[i]) * w,0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

function formatCpf(value) {
  const d=digits(value); if(d.length!==11) return String(value||'').trim();
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');
}
function formatCnpj(value) {
  const d=digits(value); if(d.length!==14) return String(value||'').trim();
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');
}

function normalizePartyProfile(source={}) {
  const explicit = String(source.tipo_pessoa || source.tipoPessoa || '').trim().toUpperCase();
  const rawCpf = source.cpf || (explicit === 'PF' ? source.documento : '');
  const rawCnpj = source.cnpj || (explicit === 'PJ' ? source.documento : '');
  const cpf = digits(rawCpf), cnpj = digits(rawCnpj);
  const tipo = explicit === 'PF' || explicit === 'PJ' ? explicit : (cnpj.length === 14 ? 'PJ' : cpf.length === 11 ? 'PF' : '');
  if (tipo === 'PF' && cpf && !cpfValid(cpf)) throw new Error('CPF inválido. Confira os números antes de salvar.');
  if (tipo === 'PJ' && cnpj && !cnpjValid(cnpj)) throw new Error('CNPJ inválido. Confira os números antes de salvar.');
  if (tipo === 'PF' && cnpj) throw new Error('Cadastro PF não pode usar CNPJ como documento principal.');
  if (tipo === 'PJ' && cpf) throw new Error('Cadastro PJ não pode usar CPF como documento principal.');
  return {
    tipo_pessoa: tipo || null,
    cpf: tipo === 'PF' && cpf ? formatCpf(cpf) : null,
    cnpj: tipo === 'PJ' && cnpj ? formatCnpj(cnpj) : null,
    documento: tipo === 'PF' && cpf ? formatCpf(cpf) : tipo === 'PJ' && cnpj ? formatCnpj(cnpj) : null,
    razao_social: tipo === 'PJ' ? String(source.razao_social || source.razaoSocial || source.nome || '').trim().slice(0,300) || null : null,
    nome_fantasia: tipo === 'PJ' ? String(source.nome_fantasia || source.nomeFantasia || '').trim().slice(0,300) || null : null,
    representante: tipo === 'PJ' ? String(source.representante || '').trim().slice(0,300) || null : null,
    nome_completo: tipo === 'PF' ? String(source.nome_completo || source.nomeCompleto || source.nome || '').trim().slice(0,300) || null : null,
    filiais: tipo === 'PJ' && Array.isArray(source.filiais) ? source.filiais.map(digits).filter(d=>d.length===14 && cnpjValid(d)).map(formatCnpj).slice(0,50) : []
  };
}

module.exports={digits,cpfValid,cnpjValid,formatCpf,formatCnpj,normalizePartyProfile};
