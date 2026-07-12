# Plano atual do Contabilizador Caixa

Este e o plano ativo de implementacao. Ele considera a base ja existente do aplicativo e lista somente as correcoes, integracoes e polimentos que ainda precisam ser concluidos. O plano antigo foi preservado em `docs/plano-remake-historico.md` para consulta e compatibilidade.

## Regras deste ciclo

- Continuar trabalhando no mesmo aplicativo, banco e fluxo integrado.
- Nao criar outro PDV separado.
- Nao refazer funcionalidades que ja estejam funcionando.
- Preservar dados antigos, `ledger.json`, `settings.json` e `pdv.sqlite`.
- Fazer backup antes de migracoes ou alteracoes de dados.
- Priorizar dados, pagamentos e sincronizacao antes do polimento visual.
- Separar corretamente os modos PDV e Classico.
- No modo PDV, manter Venda e Mesas como fluxo principal e nao exibir a barra fixa antiga.
- No modo Classico, manter a barra fixa conforme as versoes antigas, com suas configuracoes somente nesse modo.
- Marcar uma fase como concluida somente depois de verificar o fluxo real correspondente.

## Progresso da execucao

- Fase 1: parcialmente atendida. A limpeza da venda, limpeza da pesquisa, selecao/rolagem do ultimo item, formula de peso, retorno da quantidade para 1 e protecao contra duplo lancamento possuem implementacao. Produtos medidos agora preservam o valor final informado, inclusive no banco, sem exigir quantidade x preco unitario. Falta validacao manual do fluxo continuo depois do fechamento.
- Fase 2: parcialmente atendida. A tela filtra os itens pela submesa ativa, preserva os itens da mesa principal, persiste submesa vazia imediatamente, o avulso aparece como `+` e a transferencia parcial/mesa destino possui smoke automatizado aprovado. Falta validar todos os estados de mesa visualmente.
- Fase 3: parcialmente atendida. Fechamento parcial persistente, pagamentos multiplos, confirmacao, aproximacao, atalhos e navegacao por setas nas formas de pagamento possuem base; o smoke do PDV confirmou itens pagos, parcial, fechamento total, misto e idempotencia. Falta validacao manual do fluxo completo.
- Fase 4: parcialmente atendida. Cliente remoto, bloqueio de configuracoes operacionais, sincronizacao por atualizacao e salvamento de mesa no servidor foram verificados pelo smoke de rede. Falta validar o modo PDV em resolucao menor e a mesa aberta durante alteracoes remotas.
- Fase 5: parcialmente atendida. Importacao segura, Cose, complementos e ordenacao automatica possuem base. Falta revisar todos os vinculos e conflitos no uso real.
- Fase 6: parcialmente atendida. Contraste, textos longos, notificacoes e divisores redimensionaveis foram ajustados. As barras entre categorias/produtos, produtos/carrinho e lista/total do carrinho salvam a proporcao no computador; os controles `-` e `+` do carrinho foram reforcados e os cards de produtos se adaptam a telas estreitas. Modais de quantidade, itens detalhados e cancelamento receberam foco/rolagem/teclado. Falta revisar todos os temas e telas menores.
- Fase 7: parcialmente atendida. Historico, relatorios e Excel integrados possuem base e os smoke tests confirmam mesa, venda, pagamentos e exportacao. Falta a conferencia visual final de valores, pagamentos mistos e exportacao.

## Fase 1 - Venda, carrinho e produtos por peso

Objetivo: deixar a venda direta pronta para uso continuo e corrigir o calculo de peso.

- Depois de finalizar uma venda, limpar somente o carrinho atual e deixar a tela pronta para lancar uma nova venda.
- Ao sair da aba Venda com produtos nao finalizados, pedir confirmacao antes de cancelar.
- Limpar automaticamente a pesquisa depois de lancar um produto.
- Selecionar o ultimo produto lancado e rolar o carrinho ate ele.
- Investigar e eliminar duplicacao eventual do ultimo produto.
- Permitir informar peso para calcular valor e valor final para calcular o peso correspondente.
- Respeitar exatamente o valor final manual informado pelo usuario.
- Usar gramas somente como informacao, sem recalcular ou alterar o valor final confirmado.
- Alterar preco e desconto sobre o total final do item, nunca sobre o peso.
- Pressionar Enter no modal de peso/valor deve confirmar e enviar o produto.
- Aplicar desconto sobre o total da Venda por um modal integrado.

## Fase 2 - Mesas e submesas

Objetivo: separar corretamente os dados de mesa principal, submesas e lancamentos avulsos.

- Exibir o lancamento avulso somente como botao `+`, usando a cor de mesa livre.
- Cada submesa deve exibir apenas seus proprios itens.
- A mesa principal deve continuar preservada ao criar, acessar ou trocar de submesa.
- Manter lista de submesas, nomes, totais, entrada e retorno sem perder a submesa criada.
- Permitir lancar produto diretamente na submesa selecionada.
- Ao transferir uma mesa, abrir automaticamente a mesa de destino.
- Permitir transferencia parcial entre mesa principal e submesas.
- Exibir observacao resumida na grade de mesas.
- Reduzir fonte dos nomes e observacoes para evitar sobreposicao.
- Manter Cancelar desativado enquanto a mesa estiver vazia.
- Manter modos Mesa, Onibus e Avulso configuraveis conforme o modo atual.

## Fase 3 - Fechamento parcial e pagamentos

Objetivo: tornar o fechamento seguro, persistente e navegavel pelo teclado.

- Persistir itens pagos, pagamentos, descricao, mesa, submesa e identificador da operacao.
- Bloquear itens ja pagos nos fechamentos parciais seguintes.
- Calcular cada parcial apenas com itens ainda pendentes.
- Preservar selecao pendente ao voltar para a mesa antes de concluir.
- Adicionar Limpar selecao sem alterar itens pagos ou registros financeiros.
- Manter Resetar estados como acao administrativa com confirmacao clara.
- Abrir o fechamento com foco inicial em Fechar total.
- Usar setas para navegar entre opcoes e Enter para entrar ou confirmar.
- Usar Esc para retornar ou fechar o elemento temporario superior.
- Adicionar atalhos F1/F2/F3/F4 para Debito, Credito, Pix e Dinheiro.
- Permitir aceitar a confirmacao final com Enter novamente.
- Exibir dicas de atalhos somente ao passar o mouse.
- Configurar aproximacao da divisao por pessoa: sem aproximacao, R$ 0,25, R$ 0,50 ou outro valor.
- Garantir que troco nunca entre no total vendido ou no Excel.

## Fase 4 - Cliente, servidor e rede

Objetivo: manter as regras do servidor e sincronizar mesas com seguranca.

- Garantir que a aba Venda apareca no cliente PDV em resolucoes menores.
- Remover a barra antiga de Venda quando o cliente estiver conectado no modo PDV.
- Impedir que o cliente conectado altere produtos, precos, regras ou configuracoes operacionais.
- Permitir ao cliente somente preferencias visuais locais autorizadas.
- Fazer o cliente seguir modo e preferencias definidos pelo servidor.
- Atualizar a mesa aberta quando houver alteracao remota, sem sobrescrever edicao local ativa.
- Definir politica configuravel para queda de rede: bloqueio ou fila offline controlada.
- Garantir identificadores unicos, confirmacao de recebimento e ausencia de duplicidade.

## Fase 5 - Produtos, complementos e importacao

Objetivo: manter cadastro simples, importacao segura e complementos corretos.

- Organizar produtos automaticamente em A-Z ou Z-A, sem expor ordenacao manual antiga.
- Corrigir cards com nomes longos, mantendo nome e preco em areas separadas sem sobreposicao.
- Garantir que cada produto mostre somente seus complementos vinculados.
- Manter produto normal vendavel sem complemento.
- Preservar Shift + clique para lancamento direto.
- Corrigir previa e confirmacao da importacao Cose com contraste legivel.
- Preservar produtos manuais ao atualizar ou remover a importacao Cose.
- Evitar duplicacao em novas importacoes.
- Manter Coca Mini por R$ 5,00 no preset.
- Confirmar complementos no carrinho, mesa, fechamento, historico, relatorio e Excel.

## Fase 6 - Interface, temas e dimensionamento

Objetivo: deixar o app legivel e adaptavel em notebook e 1920x1080.

- Restaurar redimensionamento das areas de categorias, produtos, carrinho e painel direito.
- Salvar tamanho e proporcao por usuario, respeitando limites de tela.
- Permitir configurar quantidade de produtos por linha e densidade visual.
- Ajustar rolagem de carrinho, listas, produtos e modais.
- Fazer modais de peso e pagamento caberem sem rolagem obrigatoria em telas comuns.
- Corrigir textos claros em fundos claros e textos escuros em fundos escuros.
- Corrigir campo Qtde. no tema escuro.
- Reduzir textos e espacamentos que sobrepoem nomes de mesas ou produtos.
- Fazer notificacoes sumirem automaticamente e permitir configurar sua duracao.
- Aplicar a mesma regra de notificacoes na barra fixa do modo Classico.
- Revisar Tab, setas, Enter e Esc em todos os modais.
- Manter Venda e Mesas visualmente integradas ao tema atual.

## Fase 7 - Historico, relatorios, Excel e entrega

Objetivo: confirmar que todas as operacoes chegam aos mesmos registros e preparar a entrega.

- Buscar no Historico por descricao de pagamento, mesa, valor exato/faixa, produto e forma de pagamento.
- Mostrar detalhes dos produtos da venda ou mesa em modal proprio.
- Garantir que Venda direta, Mesa, Submesa e fechamento parcial usem o mesmo Historico.
- Separar Debito, Credito, Pix, Dinheiro e outros nos Relatorios.
- Garantir que totais, descontos, cancelamentos e pagamentos mistos batam com o banco.
- Exportar Resumo, Vendas, Itens e Pagamentos a partir do SQLite.
- Manter pagamentos mistos em registros separados no Excel.
- Nao exportar troco como venda.
- Evitar regravar arquivos Excel antigos sem necessidade.
- Manter botao para abrir a pasta de exportacao.
- Revisar os temas e telas em 1366x768 e 1920x1080.
- Fazer backup final antes da atualizacao.
- Registrar arquivos alterados e instrucoes de validacao manual.
- Somente depois gerar build, commit, push e release.

## Fora do plano ativo por enquanto

- Reimplementar a base inicial do PDV.
- Criar aplicativo separado.
- Trocar SQLite por Excel ou JSON.
- Implementar estoque, custo, margem, fiscal, fornecedor, NFC-e ou codigo de barras obrigatorio.
- Remover definitivamente codigo antigo, barra fixa ou recursos do modo Classico.
