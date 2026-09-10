# LEX — conector de captura assistida (piloto)

Este conector importa o texto que o advogado seleciona na página do tribunal.
Não é uma integração de acervo completo. Não lê cookies, senhas, PIN, certificado
ou arquivos do computador. Não assina, protocola nem clica em ciência.

1. Extraia este ZIP em uma pasta do computador do escritório.
2. Em `chrome://extensions` ou `edge://extensions`, ative o modo de desenvolvedor
   e selecione **Carregar sem compactação**, indicando a pasta extraída.
3. No LEX, abra **Fontes dos processos**, gere o código temporário e copie-o.
4. Abra o conector. Informe a origem HTTPS do servidor LEX e o código.
   A permissão solicitada vale para esse servidor. Os dados de conexão ficam
   somente na sessão do navegador; o código expira em oito horas. Gerar outro
   código invalida o anterior.
5. Faça login no PJe pelo procedimento oficial, com PJeOffice/certificado e
   segundo fator quando exigidos. O LEX não participa da autenticação.
6. Abra o processo e selecione o texto do andamento. Abra o conector e clique
   **Ler seleção da página**. Confira CNJ, data exata e texto. Clique **Importar**.
7. O processo precisa existir no LEX com CNJ único. Confira a resposta confirmada
   e o andamento na plataforma. Repetir a captura não duplica o mesmo registro.

O primeiro uso ainda precisa ser validado com o advogado no tribunal utilizado.
PDFs, peças, páginas seguintes e processos que não estejam abertos não são
importados por esta versão. Para esses conteúdos, utilize a importação de arquivos.

Referências: [PJeOffice Pro](https://docs.pje.jus.br/servicos-negociais/pjeoffice-pro/),
[autenticação TJMG](https://www.tjmg.jus.br/portal-tjmg/informes/pje-duplo-fator-de-autenticacao-para-usuarios-externos.htm),
[activeTab e scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting).
