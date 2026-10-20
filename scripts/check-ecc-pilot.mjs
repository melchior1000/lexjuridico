import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agent = readFileSync(new URL('../.claude/agents/ecc-silent-failure-hunter.md', import.meta.url), 'utf8');
const license = readFileSync(new URL('../.claude/ECC_UPSTREAM_LICENSE.txt', import.meta.url), 'utf8');

assert.match(agent, /^---\nname: ecc-silent-failure-hunter\n/m);
assert.match(agent, /^description: .+$/m);
assert.match(agent, /^tools: Read, Grep, Glob$/m);
assert.match(agent, /AGENTS\.md/);
assert.match(agent, /somente leitura|APENAS em leitura/i);
assert.match(agent, /arquivo:linha/);
assert.match(agent, /testes e produ[cç][aã]o n[aã]o verificados/i);
assert.match(agent, /tenant/i);
assert.doesNotMatch(agent, /^tools:.*(?:Bash|Write|Edit)/m);
assert.match(license, /MIT License/);
assert.match(license, /Copyright \(c\) 2026 Affaan Mustafa/);

console.log('ECC piloto: manifesto, restrições e atribuição conferidos (checagem estática).');
