# Caixa PDV 0.4.12

- Contas a Pagar e Receber com lista compacta, totais à direita e cadastro na aba Registro, dentro da mesma janela.
- Filtros de abertas/quitadas independentes: A pagar/Pagas e A receber/Recebidas. Mais filtros fica antes dessas caixas e reúne os atalhos de período e outras situações. Mantida a escolha entre emissão e vencimento.
- Duplicar na barra principal abre uma nova conta para conferência, sem copiar pagamentos, recebimentos ou vínculos da venda original. Cancelar a cópia não cria registros.
- Recibo na barra principal das duas telas. O recibo de conta a pagar mostra fornecedor, documento, datas, valor, pagamentos e saldo. Contas a receber manuais ou antigas também geram recibo quando a venda não está no resumo operacional.
- Prévia do recibo ajustada para telas menores, com botões de fechamento, PDF e impressão dentro da área disponível. Exportação conferida em 80 mm e A4.
- Cadastros de Produtos, Categorias, Adicionais e Clientes reorganizados em listas com comandos no topo e edição em Registro. Corrigidos contraste, margens e o zero solto no formulário de estoque. Busca desses cadastros ignora acentos.
- Clientes com saldo e quantidade de contas pendentes na lista, acesso à ficha completa e às pendências da pessoa.
- Perfis de privacidade editáveis no servidor: criar, duplicar, excluir e escolher as regras de topo, histórico e relatórios. Valores do histórico podem ficar sempre visíveis, somente durante pesquisa ou sempre ocultos.
- Clientes recebem as mesmas definições de privacidade do servidor; ativar/desativar continua independente em cada computador. O perfil aplicado ao ativar e ao desativar pode ser configurado.
- Salvamento automático aguarda ajustes pendentes ao fechar Configurações e evita que uma gravação anterior sobrescreva uma edição mais recente.
- Visão Geral mais compacta, com indicadores e atalhos organizados.
- Histórico pelo botão direito da mesa abre na data atual e filtra a mesa exata. Corrigida a marcação de fechamento em mesas sem itens e restaurada a prioridade da cor verde.
- Removido o botão Ir para Mesas do resumo de mesas abertas.

Validação: compilação completa; testes de PDV, rede, concorrência, perfis/status; interface em 1024×600 e 1280×720; pagamentos agrupados, duplicação sem repetir quitações e recibos pelo servidor e cliente. PDFs de 80 mm e A4 conferidos. O executável empacotado 0.4.12 passou nos mesmos fluxos financeiros com servidor e cliente; o portátil 0.4.12 também abriu com banco isolado e carregou a interface principal.

Atualize o servidor e os clientes para a mesma versão.
