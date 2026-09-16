(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.LexNav = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createStack(initial) {
    let frames = Array.isArray(initial) ? initial.slice() : [];
    const api = {
      get frames() { return frames.slice(); },
      get depth() { return frames.length; },
      get top() { return frames[frames.length - 1] || null; },
      root(frame) { frames = frame ? [frame] : []; return api.top; },
      push(frame) { if (frame) frames.push(frame); return api.top; },
      back() { if (frames.length > 1) frames.pop(); return api.top; },
      close() { if (frames.length > 1) frames = frames.slice(0, 1); return api.top; },
      affordances() {
        const drilled = frames.length > 1;
        const t = frames[frames.length - 1] || {};
        return { back: drilled, close: drilled, title: t.title || '' };
      },
    };
    return api;
  }

  function create(opts) {
    opts = opts || {};
    const stack = createStack();
    const hasDOM = typeof document !== 'undefined';
    const hasWindow = typeof window !== 'undefined';
    const hasHistory = typeof history !== 'undefined' && !!history.pushState;

    if (hasDOM && opts.injectStyles !== false) ensureStyles();

    function render() {
      if (opts.onNavigate) opts.onNavigate(stack.top);
      if (!hasDOM || !opts.header) return;
      const a = stack.affordances();
      const back = a.back ? '<button type="button" data-lexnav="back" aria-label="Voltar">\u2039</button>' : '';
      const close = a.close ? '<button type="button" data-lexnav="close" aria-label="Fechar">\u2715</button>' : '';
      opts.header.innerHTML = '<div class="lexnav-bar">' + back + '<span class="lexnav-title">' + escapeHtml(a.title) + '</span>' + close + '</div>';
    }

    function allowLeave() {
      if (typeof opts.confirmLeave !== 'function') return true;
      return opts.confirmLeave(stack.top) !== false;
    }

    function goRoot(frame) {
      stack.root(frame);
      if (hasHistory) history.replaceState({ lexnav: true, depth: stack.depth }, '');
      render();
    }
    function goPush(frame) {
      stack.push(frame);
      if (hasHistory) history.pushState({ lexnav: true, depth: stack.depth }, '');
      render();
    }
    function requestBack() {
      if (stack.depth <= 1) return;
      if (hasHistory) history.back();
      else if (allowLeave()) { stack.back(); render(); }
    }
    function requestClose() {
      if (stack.depth <= 1) return;
      if (hasHistory) history.go(-(stack.depth - 1));
      else if (allowLeave()) { stack.close(); render(); }
    }

    if (hasWindow && hasHistory) {
      window.addEventListener('popstate', function (e) {
        const target = (e.state && typeof e.state.depth === 'number') ? e.state.depth : Math.max(1, stack.depth - 1);
        if (target >= stack.depth) return;
        if (!allowLeave()) {
          history.pushState({ lexnav: true, depth: stack.depth }, '');
          return;
        }
        while (stack.depth > target) stack.back();
        render();
      });
    }

    if (hasDOM && opts.header) {
      opts.header.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-lexnav]');
        if (!btn) return;
        if (btn.getAttribute('data-lexnav') === 'back') requestBack();
        else if (btn.getAttribute('data-lexnav') === 'close') requestClose();
      });
    }

    function state() { return { frame: stack.top, depth: stack.depth, affordances: stack.affordances() }; }
    render();
    return { root: goRoot, push: goPush, back: requestBack, close: requestClose, state: state, _stack: stack };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  const LEXNAV_CSS = '.lexnav-bar{display:flex;align-items:center;gap:8px;min-height:48px;padding:4px 8px}.lexnav-bar [data-lexnav]{border:0;background:transparent;line-height:1;width:44px;height:44px;cursor:pointer;color:inherit;display:flex;align-items:center;justify-content:center;font-size:24px}.lexnav-bar [data-lexnav="back"]{font-size:32px}.lexnav-title{flex:1;min-width:0;font-weight:600;font-size:16px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}';

  function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById('lexnav-styles')) return;
    const el = document.createElement('style');
    el.id = 'lexnav-styles';
    el.textContent = LEXNAV_CSS;
    document.head.appendChild(el);
  }

  return { create: create, createStack: createStack, css: LEXNAV_CSS, _escapeHtml: escapeHtml };
});
