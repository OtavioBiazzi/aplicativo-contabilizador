# Caixa PDV 0.4.11

- Cadastro de contas a pagar mais simples: descrição e vencimento opcionais. Apenas o valor é obrigatório, exceto o primeiro vencimento de parcelas ou recorrências.
- Novas contas ficam sem forma de pagamento predefinida. Formas já escolhidas em contas antigas são preservadas; ao pagar, é necessário escolher o meio utilizado.
- Documento, categoria e centro de custo ficam visíveis no formulário. Categorias e centros de custo podem ser cadastrados e removidos pelo botão “+”, inclusive no cliente autorizado. Remover um cadastro não altera contas antigas nem o recria ao reiniciar.
- Valores e saldos alinhados à direita, com destaque para Falta pagar/Falta receber. Textos repetitivos e o seletor Linhas foram removidos; a paginação aparece somente quando necessária.
- Pesquisa, Por fornecedor/cliente e Registro mantêm a barra de ações e os filtros na mesma posição. Pagamentos e recebimentos agrupados usam o botão principal Pagar/Receber.
- O atalho Ver todas em aberto fica junto à busca e amplia o período mantendo somente as contas pendentes.
- A permissão de produtos permite criar, editar e excluir produtos/categorias no cliente sem exigir também a liberação dos ajustes operacionais do servidor.
- Rede → Permissões agora oferece Liberar acesso completo. As permissões existentes são preservadas até o servidor salvar uma nova configuração. A conexão e a aparência continuam próprias de cada computador.
- Corrigido o formulário de pagamentos registrados que ultrapassava a largura do cadastro. Campos flexíveis e observação na linha seguinte, mantendo a edição de vários pagamentos em telas menores.
- Contas sem descrição recebem uma identificação de exibição pelo fornecedor, documento ou categoria; os resumos mostram valor da conta, já pago e saldo restante.

Validação: compilação aprovada e nove testes de PDV, rede/permissões, migrações com backup, financeiro, caixa, concorrência, fechamento parcial e identificação no histórico. Conferidos também os formulários, pagamentos agrupados e permissões ao vivo no Electron. O executável empacotado 0.4.11 abriu com dados isolados, preservou os campos opcionais e o saldo parcial, e passou na conferência do editor em 1280 × 720 e 1024 × 600.

Atualize servidor e clientes para a mesma versão.
