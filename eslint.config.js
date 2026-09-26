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
    files: ['lib/**/*.js','scripts/**/*.js','test/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { caughtErrors: 'none', args: 'none' }],
      'no-useless-escape': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-useless-assignment': 'off'
    }
  },
  {
    files: ['*.js'],
    ignores: ['eslint.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: {...globals.browser,...lexBrowserGlobals} },
    rules: {
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-redeclare': ['error', { builtinGlobals: false }],
      // Scripts de navegador: funções de nível superior são chamadas por onclick no HTML.
      'no-unused-vars': ['warn', { caughtErrors: 'none', args: 'none', vars: 'local' }],
      'no-undef': 'off'
    }
  }
];
