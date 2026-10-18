# Ajuda, consultas financeiras e verificação de regressões

Solicitação de 18/10/2026, complementar ao plano de evolução de mesas, financeiro e rede.

## Comportamentos definidos

- **Contas a receber e a pagar:** ampliar o período preserva a situação escolhida. O aviso de pendências ocultas abre somente as contas em aberto. A ação passa a se chamar “Todo o período”.
- **Clientes:** ao selecionar um cadastro, um acesso direto abre a ficha na seção de contas pendentes, sem filtro de período.
- **Cadastro durante a cobrança:** permitir criar cliente em Contas a Receber e dentro da nova conta, selecionando o cadastro criado sem perder os campos da cobrança.
- **Ajuda e tutoriais:** acesso pelo Menu Gerencial, busca sem acentuação, categorias, passos simples, atalhos para os módulos e dados reais da conexão. Senha oculta até a pessoa escolher revelá-la.
- **Mesas em aberto:** acesso pelo Total do Dia, com soma dos saldos restantes da principal e das submesas. Pagamentos já feitos não são somados novamente. O resultado é uma previsão, separado do faturamento realizado.
- **Histórico:** atalhos de mesa ou dia são consumidos uma vez. Reabrir pelo Caixa volta à consulta normal de hoje, sem reaplicar o contexto antigo da mesa.

## Verificação

- Conferir as telas no Electron com uma base isolada: contas abertas, parciais, pagas, canceladas e excluídas.
- Testar os dois botões de ampliação de período, cadastro de cliente sem sair da conta, acesso direto às pendências, busca e atalhos da ajuda, total com mesa parcialmente paga e reabertura do Histórico.
- Executar os testes existentes de PDV, rede, concorrência, fechamento parcial, histórico, caixa e financeiro para verificar os fluxos anteriores.
- Compilar e conferir janelas menores antes de preparar a atualização.

## Resultado da verificação

- Fluxos acima aprovados no Electron como servidor e como cliente conectado, com dados isolados.
- Filtros verificados com contas abertas, parciais, quitadas, canceladas e excluídas. Cadastro dentro da nova cobrança preservou a descrição e selecionou o novo cliente.
- Resumo de mesas conferido com pagamento parcial: saldo de R$ 20 de uma mesa mais R$ 25 da principal/submesa de outra resultou em R$ 45, sem duplicar os R$ 10 já pagos.
- Histórico da mesa foi aberto, fechado, consultado com outro período e reaberto normalmente: voltou para hoje sem o número da mesa.
- Passaram os testes `smoke_pdv`, `smoke_network`, `smoke_regressions`, `smoke_scope_close`, `smoke_concurrent_tables`, `smoke_cash_shift` e `smoke_history_identity`.
- A verificação cobre esses fluxos e cenários; não representa uma garantia sobre todas as combinações possíveis de uso.
