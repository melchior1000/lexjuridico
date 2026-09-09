'use strict';

// Serializa as gravações do agente vivo por processo nesta instância.
// Controle entre servidores depende de transação/versão no PostgreSQL.
const locks = new WeakMap();
async function withProcessLock(processos, id, operation) {
  if (!processos || typeof processos !== 'object') return operation();
  let entries = locks.get(processos);
  if (!entries) { entries = new Map(); locks.set(processos, entries); }
  const key = String(id);
  const previous = entries.get(key) || Promise.resolve();
  const current = previous.then(operation);
  const barrier = current.then(() => {}, () => {});
  entries.set(key, barrier);
  try { return await current; }
  finally { if (entries.get(key) === barrier) entries.delete(key); }
}
module.exports = {withProcessLock};
