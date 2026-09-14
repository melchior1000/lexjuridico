const js = require('@eslint/js');
const globals = require('globals');

const lexBrowserGlobals = {
  lexApi: 'readonly', getProcs: 'readonly', getPrep: 'readonly', ir: 'readonly', abrirProc: 'readonly',
  getResponsavel: 'readonly', lexEscape: 'readonly', toast: 'readonly', SK: 'readonly',
  setVersaoLocal: 'readonly', renderRecepcaoLex: 'readonly', getAuthToken: 'readonly',
  fetchComTimeout: 'readonly', SERVIDOR: 'readonly', crypto: 'readonly'
};

module.exports = [
  { ignores: ['bot.js','lex_agente_vivo*.js','node_modules/**'] },
  {
    files: ['lib/office-pipeline.js','lib/office-command.js','lib/datajud.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'warn',
      'no-useless-escape': 'off'
    }
  },
  {
    files: ['office-ui-v2.js','office-flow-ui.js','office-command-ui.js','reception-handoff-ui.js','office-attachment-ui.js','office-dossier-ui.js','login-theme.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: {...globals.browser,...lexBrowserGlobals} },
    rules: {
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-redeclare': 'error',
      'no-unused-vars': 'warn',
      'no-undef': 'off'
    }
  }
];
