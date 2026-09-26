# Caixa PDV 0.4.4

Correções de fluxo e financeiro, preservando o visual e as melhorias da série 0.4.

- Transferências permanecem na mesa/submesa de destino, sem voltar ao início.
- Carrinho comprimido mantém o cabeçalho e não mostra texto adicional.
- Histórico mostra descrições e clientes e permite editar todos os meios de pagamento de uma venda.
- Contas a receber: saldo por cliente e recebimento distribuído em todas as contas ou somente nas selecionadas.
- Contas a pagar: saldo por fornecedor e pagamento distribuído em todas as contas ou somente nas selecionadas.
- Período financeiro por emissão ou vencimento, com mês atual por padrão e tratamento de contas sem vencimento.
- Proteção contra reenvio, saldo excedido e seleção de contas de pessoas diferentes, tanto localmente quanto no cliente.
- Atualização do aplicativo disponível na espera de conexão, sem depender do servidor.

Validação: build de produção, testes de PDV/rede/concorrência/fechamento/caixa e auditoria financeira; fluxos conferidos no Electron com bases isoladas.

Atualize servidor e clientes para a mesma versão. A atualização do cliente pode ser feita na tela de conexão ou em Menu Gerencial → Atualizações.
