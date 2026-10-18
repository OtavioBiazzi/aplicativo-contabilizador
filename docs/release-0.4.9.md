# Caixa PDV 0.4.9

- Contas a receber e a pagar: “Todo o período” amplia as datas mantendo a situação escolhida. O aviso “Ver todas em aberto” mostra somente contas pendentes, sem misturar contas quitadas.
- Clientes: novo acesso direto às contas pendentes na ficha, com descrição e saldo de cada conta.
- Cadastro de cliente em Contas a Receber e dentro da criação de uma cobrança, sem perder os campos já preenchidos. O cliente criado fica selecionado na nova conta.
- Ajuda e tutoriais no Menu Gerencial: 27 explicações com busca sem acentuação, categorias, passos e atalhos para as telas. Inclui endereço da conexão e senha salva, que fica oculta até clicar em mostrar.
- Total do Dia: novo resumo de Mesas em aberto, somando o saldo restante da principal e das submesas. Valores já pagos ficam fora da previsão.
- Histórico: o filtro aberto pelo atalho de uma mesa ou de um dia é usado uma vez. Ao reabrir o Caixa normalmente, volta à consulta de hoje sem reaplicar o filtro antigo da mesa.

Validação: compilação de produção; testes existentes de PDV, rede, concorrência entre terminais, fechamento parcial, histórico, caixa e recebimentos agrupados. Testes no Electron com servidor e cliente confirmaram os filtros, cadastro durante a cobrança, pendências por cliente, ajuda, atalhos e soma de mesas parcialmente pagas. Conferência visual em 1280 × 720 e 1024 × 768.

Atualize servidor e clientes para a mesma versão.
