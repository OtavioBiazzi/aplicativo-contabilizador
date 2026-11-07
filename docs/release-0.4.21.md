# Caixa PDV 0.4.21

- **Fechar a venda igual a mesa**: o "Receber e finalizar" da venda direta agora abre o mesmo menu do fechar conta da mesa, com a divisão por pessoas. No título aparece "Venda" (ou "Ônibus" no modo ônibus), e a opção Avançado não aparece. Voltar na tela de pagamento retorna a esse menu.
- **Título do pagamento diz qual conta é**: "Pagamento - Mesa 005", "Pagamento - Mesa 005 · nome da submesa", "Pagamento - Venda" ou "Pagamento - Ônibus".
- **Lado direito do pagamento mais legível**: acréscimo, desconto, valor total, recebido e troco ficam num painel só, com o título em cima, alinhado à direita, e o valor grande dentro de uma caixa branca.
- **Botão "Transferir venda"** ocupa a largura toda de novo; tinha ficado pela metade depois que o desconto da venda foi para a tela de pagamento.
- **Planilha automática**: continua como na 0.4.18. Quem atualizar de uma versão antiga tem a planilha desligada uma única vez; quem religar tem a escolha respeitada.

Nenhuma mudança no banco: a venda e o ônibus continuam gravados do mesmo jeito.

Validação: build de produção e o QA no executável empacotado, como servidor e como cliente, incluindo venda dividida, ônibus e o título do pagamento da mesa.

Atualize servidor e clientes para a mesma versão.
