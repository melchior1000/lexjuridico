/* LEX — navegação central (roteador único).
 *
 * Problema corrigido: a função ir() era embrulhada por três camadas diferentes
 * (office-ui-v2, lex2-interface-core e office-command-ui), instaladas em tempos
 * diferentes (0 ms, 120 ms, 250 ms, 1 s). A tela aberta dependia de qual camada
 * ganhava a corrida; título, item ativo do menu e fechamento do menu no celular
 * nem sempre eram atualizados; rota desconhecida deixava a tela em branco.
 *
 * Aqui existe UMA tabela de rotas e UM roteador. As telas continuam sendo as
 * mesmas funções já existentes — nada é reescrito, só chamado de forma única.
 * Este arquivo é carregado por último (office-ui.js).
 */
(function () {
  'use strict';

  const w = window;
  const call = (nome, ...args) => (typeof w[nome] === 'function' ? (w[nome](...args), true) : false);
  const admin = () => { try { return typeof w.podeConfig !== 'function' || !!w.podeConfig(); } catch { return false; } };

  // Tabela única de rotas. "tela" tenta as funções na ordem: a versão atual
  // primeiro e a antiga como reserva, para nunca abrir tela em branco.
  const ROTAS = [
    // Dia a dia
    {id: 'painel',          titulo: 'Início',                 grupo: 'dia',      icone: '◈', tela: () => call('lexHome') || call('renderPainel')},
    {id: 'trabalho',        titulo: 'Tarefas',                grupo: 'dia',      icone: '☑', tela: () => call('lexTarefas') || call('renderTrabalho')},
    {id: 'recepcao',        titulo: 'Recepção',               grupo: 'dia',      icone: '📥', tela: () => call('renderRecepcaoLex')},
    {id: 'processos',       titulo: 'Processos',              grupo: 'dia',      icone: '⊞', tela: () => call('lexProcessos') || call('renderProcessos')},
    {id: 'prazos',          titulo: 'Prazos',                 grupo: 'dia',      icone: '◷', tela: () => call('lexPrazos') || call('renderPrazos')},
    // Produção jurídica
    {id: 'peticao',         titulo: 'Peças',                  grupo: 'producao', icone: '✎', tela: () => call('openCommercialProduction', 'peticao') || call('renderPeticao')},
    {id: 'pericia',         titulo: 'Perícia',                grupo: 'producao', icone: '🔬', tela: () => call('openCommercialProduction', 'pericia') || call('renderPericia')},
    {id: 'juris',           titulo: 'Jurisprudência',         grupo: 'producao', icone: '⚖', tela: () => call('renderJuris')},
    {id: 'juizes',          titulo: 'Padrão decisório',       grupo: 'producao', icone: '◉', tela: () => call('renderJuizes')},
    // Mais telas (recolhidas por padrão)
    {id: 'autuacao',        titulo: 'Autuação (casos novos)', grupo: 'mais',     icone: '🗂', tela: () => call('renderAutuacao')},
    {id: 'processos_admin', titulo: 'Processos administrativos', grupo: 'mais',  icone: '▣', tela: () => call('renderProcessosAdministrativos')},
    {id: 'preparacao',      titulo: 'Em preparação',          grupo: 'mais',     icone: '⋯', tela: () => call('renderPreparacao')},
    {id: 'calendario',      titulo: 'Calendário',             grupo: 'mais',     icone: '📅', tela: () => call('renderCalendario')},
    {id: 'agenda',          titulo: 'Contatos',               grupo: 'mais',     icone: '📇', tela: () => call('renderAgenda')},
    {id: 'mensagens',       titulo: 'Histórico de mensagens', grupo: 'mais',     icone: '💬', tela: () => call('renderCentralMensagens')},
    {id: 'estatisticas',    titulo: 'Estatísticas',           grupo: 'mais',     icone: '◎', tela: () => call('renderEstatisticas')},
    // Configuração (somente administrador)
    {id: 'escritorio',      titulo: 'Meu escritório',         grupo: 'config',   icone: '⌂', admin: true, tela: () => call('lexEscritorio') || call('renderEscritorio')},
    {id: 'whatsapp',        titulo: 'WhatsApp',               grupo: 'config',   icone: '📱', admin: true, tela: () => call('renderWhatsappCanal')},
    {id: 'telegram',        titulo: 'Telegram',               grupo: 'config',   icone: '✈', admin: true, tela: () => call('renderTelegram')},
    {id: 'pje',             titulo: 'PJe e fontes',           grupo: 'config',   icone: '🔗', admin: true, tela: () => call('renderFontesProcessos')},
    {id: 'senhas',          titulo: 'Senhas e acesso',        grupo: 'config',   icone: '🔑', admin: true, tela: () => call('renderGestaoSenhas')}
  ];
  // Nomes antigos que continuam funcionando (links internos e favoritos).
  const APELIDOS = {agentes: 'escritorio', inicio: 'painel', hoje: 'painel', home: 'painel'};
  const PORID = Object.fromEntries(ROTAS.map(r => [r.id, r]));

  let atual = null;
  let mudandoHash = false;

  function resolver(id) {
    const chave = String(id || '').trim();
    return PORID[APELIDOS[chave] || chave] || null;
  }

  function marcarMenu(id) {
    document.querySelectorAll('#sidebar .nav-btn').forEach(b => {
      const ativo = b.getAttribute('data-route') === id;
      b.classList.toggle('active', ativo);
      if (ativo) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    // Se a tela aberta está no grupo recolhido, abre o grupo para mostrar onde o usuário está.
    const rota = PORID[id];
    const mais = document.getElementById('lex-nav-mais');
    if (mais && rota && rota.grupo === 'mais') mais.open = true;
  }

  function telaNaoEncontrada(pedido) {
    const c = document.getElementById('content');
    if (!c) return;
    const esc = s => String(s).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
    c.innerHTML = '<div class="work-home" style="padding:32px;text-align:center">' +
      '<h2 style="margin-bottom:8px">Tela não encontrada</h2>' +
      '<p style="color:var(--text3);margin-bottom:16px">O endereço “' + esc(pedido) + '” não existe no LEX.</p>' +
      '<button class="btn-save" onclick="ir(\'painel\')">Voltar ao início</button></div>';
  }

  function telaRestrita() {
    const c = document.getElementById('content');
    if (c) c.innerHTML = '<div class="work-home" style="padding:32px;text-align:center"><h2>Acesso restrito</h2>' +
      '<p style="color:var(--text3)">Esta área é só do administrador do escritório.</p>' +
      '<button class="btn-save" style="margin-top:16px" onclick="ir(\'painel\')">Voltar ao início</button></div>';
  }

  // Roteador único.
  function ir(pedido) {
    const rota = resolver(pedido);
    const titulo = document.getElementById('page-title');
    // Passos comuns que o roteador antigo fazia e as camadas novas esqueciam.
    try { pag = rota ? rota.id : String(pedido); } catch { /* variável ausente */ }
    try { procAtivo = null; } catch { /* variável ausente */ }
    call('fecharSidebar');
    call('esconderBackBar');
    if (!rota) { if (titulo) titulo.textContent = 'Tela não encontrada'; marcarMenu(null); telaNaoEncontrada(pedido); return false; }
    if (titulo) titulo.textContent = rota.titulo;
    marcarMenu(rota.id);
    atual = rota.id;
    if (location.hash !== '#/' + rota.id) { mudandoHash = true; history.replaceState(null, '', '#/' + rota.id); mudandoHash = false; }
    if (rota.admin && !admin()) { telaRestrita(); return false; }
    try {
      if (!rota.tela()) telaNaoEncontrada(pedido);
    } catch (e) {
      console.error('[LEX] Falha ao abrir', rota.id, e);
      const c = document.getElementById('content');
      if (c) c.innerHTML = '<div class="work-home" style="padding:32px;text-align:center"><h2>Não foi possível abrir “' + rota.titulo + '”</h2>' +
        '<p style="color:var(--text3)">Recarregue a página. Se continuar, avise o suporte.</p></div>';
    }
    return true;
  }
  // Marca o roteador com as bandeiras que as camadas antigas verificam antes de
  // embrulhar ir(): assim nenhuma delas volta a criar uma cadeia concorrente.
  ir.__commercial = true;
  ir.__lexToday = true;
  ir.__commercialProduction = true;
  ir.__lexNav = true;

  // .nav-btn usa display:flex, que anula o atributo hidden; esta regra garante o filtro.
  function estilo() {
    if (document.getElementById('lex-nav-style')) return;
    const st = document.createElement('style');
    st.id = 'lex-nav-style';
    st.textContent = '#sidebar [hidden]{display:none!important}.lex-nav-mais summary::-webkit-details-marker{display:none}.lex-nav-mais[open] summary{color:var(--text2)}';
    (document.head || document.documentElement).appendChild(st);
  }

  function filtrarPorPerfil() {
    estilo();
    const ehAdmin = admin();
    document.querySelectorAll('#sidebar [data-admin="1"]').forEach(el => { el.hidden = !ehAdmin; });
  }

  let linkInicialUsado = false;
  function instalar() {
    if (w.ir !== ir) w.ir = ir;
    filtrarPorPerfil();
    if (atual) marcarMenu(atual);
    // Endereço salvo (ex.: .../#/prazos) abre a tela certa depois do login.
    const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1];
    let logado = false;
    try { logado = typeof w.getAuthToken === 'function' && !!w.getAuthToken(); } catch { logado = false; }
    if (!linkInicialUsado && id && logado && id !== atual && document.getElementById('content')) { linkInicialUsado = true; ir(id); }
  }

  // Botões voltar/avançar do navegador e endereço com #/tela.
  w.addEventListener('hashchange', () => {
    if (mudandoHash) return;
    const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1];
    if (id && id !== atual && document.getElementById('content')) ir(id);
  });

  // Reinstala se alguma camada antiga trocar ir() depois de nós.
  function vigiar() { instalar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(vigiar, 0), {once: true});
  else setTimeout(vigiar, 0);
  [300, 1200, 2500].forEach(ms => setTimeout(vigiar, ms));
  w.addEventListener('load', vigiar);
  // Depois do login o perfil muda: reaplica o filtro de menu.
  document.addEventListener('click', () => setTimeout(filtrarPorPerfil, 0), true);

  // Exposto para testes e para outras telas.
  w.lexNav = {rotas: ROTAS.map(r => ({...r, tela: undefined})), apelidos: {...APELIDOS}, resolver: id => (resolver(id) || {}).id || null, ir, instalar};
})();
