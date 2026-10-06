# Avisos de terceiros

Partes do LEX foram adaptadas do projeto **DeskcommCRM** (https://github.com/melgarafael/DeskcommCRM), distribuído sob a licença MIT reproduzida abaixo. O código foi reescrito em CommonJS e ajustado ao escritório; a ideia e as regras de origem estão creditadas no cabeçalho de cada arquivo:

- `lib/whatsapp-inbound.js` — trava de mensagem repetida (de `lib/waha/ingest.ts`)
- `lib/whatsapp-optout.js` — detecção de pedido para não receber mensagens (de `lib/opt-out/deteccao.ts`)
- `lib/whatsapp-pacing.js` — ritmo das mensagens automáticas (de `lib/agent-engine/pacing/engine.ts`)

```text
MIT License

Copyright (c) 2026 Rafael Melgaço

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
