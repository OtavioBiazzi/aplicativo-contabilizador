# Caixa PDV 0.4.16

- Lembretes de comandas com **origem**: em **Menu Gerencial > Mesas > Lembretes**, cada computador escolhe avisar os fechamentos feitos **só neste computador** (padrão) ou **em todos os computadores**. Um cliente fechando uma mesa não gera mais lembrete no servidor, a menos que o servidor peça.
- Confirmar em **OK** remove o mesmo lembrete nos outros computadores conectados. A opção fica ligada por padrão e pode ser desligada em cada computador.
- A pilha de lembretes ganhou um título **Comandas (N)** para minimizar ou abrir, com o estado lembrado por computador. Há um limite configurável de lembretes visíveis (padrão 4); depois dele, a lista para de crescer e passa a rolar, com uma barra fina e discreta. Em telas baixas, o limite fica em no máximo 3.
- Avisos do aplicativo e lembretes ficam no mesmo canto, com a mesma aparência, sem se sobrepor.
- Botão **+** da grade de mesas: nova regra do servidor em **Mesas > Funcionamento** para ocultar em todos os computadores. A opção local continua em **Mesas > Visual**, como "só neste computador".
- **Mesas em aberto**: com a privacidade ligada, Realizado hoje e Previsão do total aparecem como Privado. O saldo que falta fechar continua visível.
- **Alterar valor (peso)**: itens pesados passam a ser alterados pelo valor em R$, e o peso é calculado e exibido.
- A caixa de quantidade do carrinho não mostra mais as setinhas nativas; os botões − e + continuam.
- **Seleção múltipla no carrinho**: Shift+clique seleciona um intervalo e Ctrl+clique adiciona ou retira itens. Com vários itens, o botão direito mostra quantos estão selecionados e permite Duplicar, Desconto em % em cada item, Observação em todos, Transferir (a transferência em lista abre já marcada e é feita numa única operação) e Remover com confirmação. As opções de um item só aparecem desabilitadas. Esc volta a um item; itens pagos e carrinho comprimido ficam fora da seleção múltipla.
- **Financeiro e clientes com botão direito**:
  - Contas a pagar e a receber: Ver detalhes (emissão, parcela, pagamentos e linha do tempo), Alterar, Pagar/Receber, marcar para pagamento agrupado, Duplicar e Recibo.
  - Saldos por fornecedor e por cliente: ver as contas da pessoa e pagar/receber.
  - Clientes: ficha completa, contas pendentes e alterar cadastro.
- Contas **vencidas com saldo** continuam na lista mesmo fora do período quando A pagar/A receber está marcado. Ficam no topo, com a etiqueta "fora do período", e uma nota no total mostra quanto delas está incluído.
- Ajuda: novos tutoriais de lembretes e seleção múltipla; tutoriais de período e de mesas em aberto atualizados.

Validação: typecheck e build de produção. Smokes de PDV, rede (inclui a nova confirmação de lembrete com e sem senha), lembretes (origem e padrões), privacidade, concorrência entre mesas, regressões, histórico, refinamentos e contas a pagar opcionais. QA no Electron com servidor e cliente isolados, com o mesmo conjunto anterior de lembretes e configurações e QA novos das fases 1 a 4:
- lembrete só do cliente e de todos;
- OK no servidor removendo do cliente;
- limite com rolagem em 1280×720 e 1024×600;
- aviso e lembretes sem sobreposição;
- botão + vindo do servidor;
- privacidade do resumo;
- vencidas fora do período;
- menus do financeiro;
- seleção múltipla com dados conferidos no servidor.

Ainda não testado: o instalador empacotado.

Atualize servidor e clientes para a mesma versão: a confirmação de lembretes usa uma rota nova do servidor.
