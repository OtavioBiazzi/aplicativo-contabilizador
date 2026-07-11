# Objetivo atual - Contabilizador Caixa com PDV integrado

Este documento define o objetivo atual do projeto. A ideia principal nao mudou: transformar o Contabilizador Caixa em um sistema local de caixa/PDV mais completo, simples, rapido e confiavel, inspirado no fluxo do Datacaixa, mas sem virar sistema de estoque, fiscal ou ERP.

## Plano de estabilizacao atual

Este bloco e a referencia para concluir as correcoes solicitadas depois das fases iniciais do remake. Uma funcionalidade somente deve ser marcada como concluida quando o fluxo real estiver consistente, e nao apenas quando a tela ou o botao existir.

### Fase A - Venda, peso e carrinho

- Manter a Venda pronta para novos lancamentos depois de finalizar uma venda.
- Confirmar antes de sair da Venda com carrinho aberto; limpar somente se o usuario confirmar.
- Limpar pesquisa depois de lancar produto, selecionar o ultimo item e rolar o carrinho ate ele.
- Eliminar duplicacao eventual do ultimo produto.
- Fazer o valor final manual prevalecer em produtos por peso; gramas sao somente informacao de apoio.
- Aplicar alteracao de preco e desconto sobre o total final, nunca sobre peso ou gramas.
- Confirmar lancamento por peso/valor com Enter.
- Usar modal de desconto do total tambem na Venda.

### Fase B - Mesas, submesas e avulso

- Exibir lancamento avulso como botao `+` azul, com o padrao visual de mesa livre.
- Separar itens da mesa principal e de cada submesa sem esconder, apagar ou misturar dados.
- Exibir observacao resumida na grade e impedir sobreposicao de nomes de mesas.
- Desabilitar Cancelar quando uma mesa estiver vazia.
- Abrir a mesa de destino apos transferencia.
- Manter modos avulso/onibus configuraveis e coerentes.

### Fase C - Fechamento parcial e pagamentos

- Persistir itens pagos, pagamentos, descricao, mesa/submesa e identificador de operacao.
- Bloquear itens ja pagos e calcular proximos parciais somente com itens pendentes.
- Preservar selecao pendente ate concluir, cancelar ou limpar manualmente.
- Definir foco inicial em Fechar total; setas navegam, Enter entra/confirma e Esc retorna.
- Mapear F1/F2/F3/F4 para Debito, Credito, Pix e Dinheiro.
- Exibir dicas de atalhos somente ao passar o mouse.
- Ajustar icones de editar/remover pagamentos e aproximacao por pessoa.
- Expor aproximacao: sem aproximacao, R$ 0,25, R$ 0,50 e valor personalizado.

### Fase D - Cliente, servidor e sincronizacao

- Garantir a aba Venda do cliente PDV em qualquer resolucao e remover a barra antiga nesse modo.
- Aplicar regras do servidor ao cliente em tempo real.
- Restringir cliente a preferencias visuais locais; nao permitir alterar produtos, precos ou regras.
- Sincronizar mesa aberta sem sobrescrever uma edicao local ativa.
- Definir e aplicar a politica segura para queda de rede: bloqueio ou fila offline controlada pelo servidor.

### Fase E - Produtos, importacao e complementos

- Corrigir cards com nomes longos, mantendo nome e preco em areas separadas e legiveis.
- Organizar produtos automaticamente em A-Z/Z-A, sem ordenacao manual exposta.
- Garantir contraste em previa Cose, modais e temas.
- Corrigir remocao/reimportacao Cose, preservando produtos manuais e vinculos de complementos.
- Manter Coca Mini por R$ 5,00 no preset e revisar complementos permitidos por produto.

### Fase F - Interface e acessibilidade

- Restaurar redimensionadores para categorias, produtos, carrinho e painel direito, com limites seguros e salvamento por usuario.
- Permitir configurar densidade e quantidade de produtos por linha.
- Corrigir rolagem, tamanho e contraste dos modais de produto, pagamento e cancelamento.
- Corrigir campo Qtde. no tema escuro e padronizar notificacoes com duracao configuravel.
- Revisar Tab, Esc, setas e foco inicial de todos os modais importantes.

### Fase G - Historico, relatorios e entrega

- Permitir busca por descricao de pagamento, mesa, valor/faixa e forma de pagamento.
- Garantir integracao de Venda, Mesa, parcial e pagamentos mistos em Historico, Relatorios e Excel.
- Separar Debito, Credito, Pix e Dinheiro nos relatorios, sem consolidar como Misto.
- Validar cancelamentos e edicoes sem duplicar registros.
- Testar servidor/cliente, telas 1366x768 e 1920x1080, todos os temas e fluxos financeiros antes de gerar build, commit, push e release.

O aplicativo deve continuar sendo o mesmo sistema. Nao deve existir um aplicativo separado, modulo isolado ou fluxo paralelo que pareca outro produto. As telas finais devem ser:

```text
Venda | Mesas | Historico | Relatorios | Rede | Ajuste
```

Venda e Mesas devem usar o mesmo banco local, o mesmo historico, os mesmos relatorios e a mesma exportacao Excel. Tudo que for vendido em Venda ou Mesas precisa aparecer de forma integrada no Historico, nos Relatorios e no Excel.

## Regras principais

- O banco principal das novas vendas deve ser SQLite.
- O Excel deve ser apenas exportacao/relatorio, nunca banco principal.
- Dados antigos devem continuar legiveis.
- `ledger.json`, `settings.json` e `pdv.sqlite` nao podem ser apagados.
- Nao apagar arquivos antigos sem backup.
- Salvar primeiro no banco, depois atualizar tela.
- Usar transacoes e IDs unicos.
- Fazer backup antes de migracoes.
- Evitar duplicacao entre JSON antigo e SQLite.
- Nao perder venda se o app fechar.
- Nao perder mesa aberta.
- Nao duplicar fechamento se clicar duas vezes.
- Nao corromper dados se cair energia.

## Codigo antigo, compatibilidade e fluxo principal

O codigo antigo pode continuar no projeto como backup, referencia ou compatibilidade. Funcoes uteis antigas devem ser integradas nas novas abas Venda, Mesas, Historico, Relatorios, Rede e Ajuste.

A aba Caixa antiga, a aba PDV antiga e a barra fixa/barra rapida nao devem conduzir o uso normal do sistema. Elas podem permanecer preservadas no codigo, mas nao devem aparecer como fluxo principal do usuario nem interferir em tema, tamanho, historico, relatorio, banco ou exportacao.

Nao apagar definitivamente codigo antigo sem backup. Quando algo antigo deixar de ser prioridade, isolar, desativar da interface principal ou manter preservado para consulta futura.

## O que nao deve ser implementado agora

O sistema nao deve virar controle de estoque completo. Produto precisa ter apenas o basico:

- Nome.
- Categoria.
- Preco de venda.
- Unidade, se necessario.
- Ativo/inativo.
- Ordem de exibicao.

Nao adicionar como obrigatorio:

- Estoque completo.
- Preco de custo.
- Margem de lucro.
- Codigo de barras obrigatorio.
- Fornecedor.
- NCM, CFOP, CEST ou parte fiscal.
- NFC-e.
- Cardapio mobile.
- Controle complexo de produto.

## Fase 0 - Correcao de estrutura e preservacao

Objetivo: corrigir a estrutura para que o sistema seja unico, integrado e preserve os dados antigos.

Entregas:

- Ajustar navegacao final para `Venda | Mesas | Historico | Relatorios | Rede | Ajuste`.
- Remover a aba Caixa antiga como fluxo principal.
- Remover a aba PDV separada como fluxo principal.
- Desativar barra fixa/barra rapida da interface principal.
- Preservar codigo antigo em backup/referencia.
- Garantir que `ledger.json`, `settings.json` e `pdv.sqlite` nao sejam apagados.
- Criar backup antes de migracoes ou alteracoes de banco.
- Garantir que codigo antigo nao interfira no novo fluxo.
- Garantir que Venda e Mesas usem o mesmo banco, historico, relatorios e Excel.

Teste de aceite:

- Abrir o app e ver somente as abas finais.
- Confirmar que dados antigos continuam acessiveis/legiveis.
- Confirmar que a barra fixa nao abre automaticamente nem conduz o uso normal.
- Confirmar que Venda e Mesas nao parecem sistemas separados.

## Fase 1 - Banco local e integracao de dados

Objetivo: consolidar SQLite como banco principal das novas vendas e integrar dados antigos sem perda.

Entregas:

- Criar/revisar tabelas SQLite para vendas, mesas, produtos, categorias, submesas, itens, pagamentos e cancelamentos.
- Manter dados antigos legiveis.
- Evitar duplicacao entre JSON antigo e SQLite.
- Salvar mesas abertas de forma persistente.
- Salvar pagamentos e itens com transacoes.
- Registrar cancelamentos sem apagar auditoria.
- Preparar camada unica para Historico, Relatorios e Excel.
- Fazer backup automatico antes de migracao.

Teste de aceite:

- Criar venda, fechar app, abrir novamente e confirmar venda salva.
- Abrir mesa, fechar app, abrir novamente e confirmar mesa aberta.
- Migracao/atualizacao nao apaga `ledger.json`, `settings.json` nem `pdv.sqlite`.

## Fase 2 - Aba Ajuste centralizada

Objetivo: centralizar toda configuracao antiga e nova em Ajuste.

A aba Ajuste deve conter:

- Criar, editar, excluir ou desativar produto.
- Criar, editar e ocultar categoria.
- Importar produtos do Excel.
- Exportar dados.
- Configuracoes SQL/banco local.
- Configuracao de temas.
- Ativar/desativar recursos quando necessario.
- Organizar produtos por categoria.
- Definir ordem alfabetica padrao.
- Permitir futura ordem manual.
- Produto favorito no topo.
- Categoria favorita no topo.
- Produto oculto da tela de Venda/Mesas.
- Configuracao de unidade do produto: unidade, kg, grama etc.
- Configuracao real de adicionais por produto.
- Quantidade de mesas.
- Backup do banco.
- Pasta de exportacao Excel.
- Configuracoes gerais do sistema.

Regras:

- Tudo que for configuracao deve ficar em Ajuste.
- Produtos e categorias nao devem virar uma aba principal separada.
- Ajuste deve preservar temas atuais: claro, escuro, DataCaixa, DataCaixa escuro e PDV Italia.

Teste de aceite:

- Usuario consegue configurar produto, categoria, mesa, tema, banco e exportacao sem sair de Ajuste.
- Produto oculto deixa de aparecer em Venda/Mesas.
- Categoria oculta deixa de aparecer no lancamento.

## Fase 3 - Produtos, categorias e importacao

Objetivo: manter cadastro simples de produtos, sem estoque e sem fiscal.

Entregas:

- Importar produtos do Excel usando somente informacoes necessarias.
- Usar descricao do Excel como nome do produto.
- Importar categoria/grupo.
- Importar preco de venda.
- Importar unidade, se for util.
- Criar produto.
- Editar produto.
- Desativar produto.
- Criar categoria.
- Editar categoria.
- Ocultar categoria.
- Pesquisar produto pelo nome.
- Organizar produtos por categoria.
- Ordenar alfabeticamente por padrao.
- Preparar ordem manual futura.
- Preparar produto favorito no topo.
- Preparar categoria favorita no topo.
- Configurar unidade: unidade, kg ou grama.

Nao implementar:

- Estoque completo.
- Custo.
- Margem.
- Fiscal.
- Fornecedor.
- Codigo de barras obrigatorio.

Teste de aceite:

- Importar planilha de produtos.
- Confirmar categorias e produtos na tela Venda.
- Confirmar que produtos inativos/ocultos nao aparecem.

## Fase 4 - Aba Venda

Objetivo: venda direta rapida, limpa e integrada ao sistema.

A aba Venda deve ter:

- Produtos por categoria.
- Pesquisa.
- Quantidade antes de lancar.
- Botoes grandes.
- Carrinho limpo.
- Total grande.
- Cancelar venda.
- Finalizar venda.

Regras do carrinho:

- O carrinho nao deve ficar poluido com desconto, preco e varios botoes aparecendo direto.
- Acoes avancadas devem ficar no botao direito do item.
- Dois cliques no item lancado devem perguntar se deseja remover/cancelar o produto, sempre com confirmacao.

Menu de botao direito do item:

- Alterar quantidade.
- Desconto em R$.
- Desconto em %.
- Alterar preco apenas naquela venda.
- Adicionar observacao.
- Remover/cancelar produto.
- Mover item para cima.
- Mover item para baixo.
- Colocar antes de outro item.
- Colocar depois de outro item.

Teste de aceite:

- Venda simples.
- Venda com quantidade 3.
- Remover item com duplo clique e confirmacao.
- Alterar quantidade pelo menu.
- Aplicar desconto em R$ e %.
- Alterar preco apenas naquela venda sem mudar cadastro.

## Fase 5 - Produtos por unidade, kg e grama

Objetivo: permitir venda por peso sem complicar o uso.

Entregas:

- Produto pode ser vendido por unidade, kg ou grama.
- Calculo automatico de valor.
- Tela simples para usuario leigo.
- Valor calculado aparece corretamente no carrinho, historico, relatorio e Excel.

Exemplo:

```text
Produto: R$ 40,00/kg
Peso lancado: 250g
Total: R$ 10,00
```

Teste de aceite:

- Vender produto por kg.
- Vender produto por grama.
- Conferir total no carrinho.
- Conferir historico, relatorio e Excel.

## Fase 6 - Adicionais por produto

Objetivo: corrigir a logica de adicionais para que nao apareca qualquer produto.

Regras:

- Produto normal continua vendavel sozinho.
- Produto so aparece como adicional quando estiver vinculado ao produto principal.
- Cada produto pode ter sua propria lista de adicionais permitidos.
- Adicionais nao sao "qualquer produto".
- Shift + clique lanca o produto sem abrir a tela de adicionais.
- Adicionais escolhidos aparecem no item lancado, historico, relatorio e Excel.

Exemplo:

```text
Cuscuz pode aceitar: ovo, queijo, tomate.
Outro produto nao deve mostrar esses adicionais se eles nao estiverem vinculados.
```

Entregas:

- Configuracao real de adicionais em Ajuste.
- Vincular adicionais por produto principal.
- Tela de selecao de adicionais apenas quando o produto tiver adicionais vinculados.
- Permitir predefinicoes futuras, como "com ovo", "com queijo" e "completo".

Teste de aceite:

- Cuscuz mostra apenas os adicionais vinculados a Cuscuz.
- Produto sem adicionais vinculados lanca direto.
- Shift + clique lanca direto sem abrir adicionais.
- Adicionais aparecem em Historico, Relatorios e Excel.

## Fase 7 - Aba Mesas

Objetivo: criar grade de mesas integrada, responsiva e simples.

Entregas:

- Configurar quantidade de mesas.
- Grade de mesas com filtros: Todas, Livre, Ocupada, Fechamento e Reservada.
- Cada mesa mostra numero, status, horario de abertura, total, quantidade de pessoas e observacao/nome se tiver.

Ao clicar em mesa livre:

- Abrir modal simples.
- Permitir quantidade de pessoas, se quiser.
- Permitir observacao discreta, se quiser.
- Registrar horario de abertura.
- Abrir tela da mesa.

Ao clicar em mesa ocupada:

- Abrir tela da mesa.
- Mostrar produtos lancados.
- Permitir lancar mais produtos.
- Permitir remover/cancelar produtos.
- Permitir transferir produtos.
- Permitir dividir conta.
- Permitir fechar conta.

Botao direito na mesa:

- Abrir mesa.
- Reservar mesa.
- Cancelar reserva.
- Transferir mesa.
- Mudar status.
- Ver detalhes.
- Ver historico da mesa.
- Cancelar mesa com confirmacao.

Teste de aceite:

- Abrir mesa livre.
- Reservar mesa.
- Cancelar reserva.
- Ver mesa ocupada com total.
- Cancelar mesa com confirmacao.

## Fase 8 - Tela da mesa aberta e navegacao

Objetivo: corrigir navegacao, layout, responsividade e rolagem da mesa aberta.

Entregas:

- Botao Voltar visivel para retornar a lista de mesas.
- Permitir voltar clicando novamente na aba Mesas.
- Navegacao simples e intuitiva.
- Observacao da mesa discreta, sem ocupar espaco gigante.
- Produtos carregam corretamente.
- Itens da mesa carregam corretamente.
- Tela com rolagem correta.
- Responsividade para notebook e tela pequena.
- Total da mesa visivel.
- Botoes claros: Observacao, Transferir, Dividir conta, Cancelar produto, Fechar conta e Voltar.

Teste de aceite:

- Entrar em mesa e voltar sem confusao.
- Produtos aparecem e rolam corretamente.
- Itens da mesa aparecem e rolam corretamente.
- Layout nao estoura em notebook.

## Fase 9 - Menu de itens da mesa e transferencias

Objetivo: controlar itens lancados na mesa pelo botao direito, sem poluir a tela.

Menu de botao direito do item da mesa:

- Alterar quantidade.
- Dar desconto em porcentagem.
- Dar desconto em reais.
- Remover/cancelar produto.
- Transferir produto para outra mesa.
- Transferir produto para outra submesa.
- Mover produto para cima.
- Mover produto para baixo.
- Colocar antes de outro item.
- Colocar depois de outro item.
- Adicionar observacao no item.
- Alterar preco apenas naquele lancamento.

Transferencia parcial:

- Se o item tem quantidade maior que 1, perguntar quantas unidades serao transferidas.
- Exemplo: quantidade 3 na Mesa 1. Usuario transfere 1 para Mesa 2. Mesa 1 fica com 2 e Mesa 2 recebe 1.

Teste de aceite:

- Transferir 1 unidade de um item com quantidade 3 para outra mesa.
- Transferir item para submesa.
- Alterar preco apenas no lancamento.
- Remover item com confirmacao.

## Fase 10 - Submesas

Objetivo: comandas dentro da mesa com layout limpo e funcional.

Entregas:

- Criar submesa.
- Renomear submesa.
- Excluir submesa vazia.
- Lancar item em submesa.
- Mover item entre submesas.
- Transferir quantidade parcial.
- Ver total de cada submesa.
- Fechar submesa separadamente.
- Fechar mesa inteira quando tudo estiver pago.

Regras visuais:

- Tela de submesas deve ser refeita com layout limpo.
- Nao pode ter elementos voando.
- Nao pode ter elementos desalinhados.
- Nao pode estourar a tela.
- Deve ser responsiva.

Teste de aceite:

- Criar submesa Joao e Maria.
- Lancar produtos em cada uma.
- Mover produto entre submesas.
- Fechar uma submesa separadamente.
- Fechar mesa inteira quando zerar pendente.

## Fase 11 - Divisao de conta

Objetivo: permitir divisao simples, parcial e total.

Deve permitir:

- Dividir igualmente por quantidade de pessoas.
- Dividir por produtos selecionados.
- Dividir por submesa.
- Dividir por valor manual.
- Fechamento parcial.
- Fechamento total.

Ao dividir por pessoas, ajustar centavos corretamente.

Exemplo:

```text
R$ 100,00 dividido por 3:
Pessoa 1: R$ 33,33
Pessoa 2: R$ 33,33
Pessoa 3: R$ 33,34
```

Mostrar sempre:

- Total da conta.
- Total ja pago.
- Valor restante.
- Valor sugerido por pessoa.
- Valor de cada pagamento.

Teste de aceite:

- Dividir por 2 pessoas.
- Dividir R$ 100,00 por 3 com ajuste de centavos.
- Fechar parcialmente por produtos.
- Fechar parcialmente por valor manual.

## Fase 12 - Fechamento e pagamentos

Objetivo: finalizar venda/mesa com seguranca, pagamentos multiplos e sem duplicar fechamento.

Ao clicar em Fechar Conta, abrir menu com:

- Desconto em R$.
- Desconto em %.
- Voltar.
- Fechar parcial.
- Fechar total.

Na tela de pagamento, mostrar:

- Total bruto.
- Desconto.
- Total final.
- Valor restante.
- Pagamentos adicionados.
- Metodos: Dinheiro, Debito, Credito, Pix, Outros e Nao definido.

Regras:

- Quando clicar em Debito, Pix, Credito, Dinheiro ou outro metodo, abrir uma telinha com o valor restante ja preenchido.
- Usuario pode alterar o valor.
- Permitir multiplos pagamentos.
- Antes de finalizar, sempre pedir confirmacao.
- Evitar duplicar fechamento se clicar duas vezes.

Exemplo:

```text
Conta R$ 100,00
Debito R$ 50,00
Credito R$ 35,00
Pix R$ 15,00
Restante R$ 0,00
```

Dinheiro:

- Mostrar valor da conta.
- Mostrar valor recebido.
- Mostrar troco.
- Troco nao entra como pagamento.
- Troco nao entra no total vendido.
- Troco nao deve ir para o Excel como venda.

Teste de aceite:

- Fechar conta em Debito.
- Fechar com Debito + Credito + Pix.
- Fechar em Dinheiro com troco.
- Tentar duplo clique no fechamento e confirmar que nao duplica.

## Fase 13 - Historico integrado

Objetivo: historico unico para vendas antigas, vendas novas, venda direta e mesas.

Historico deve mostrar:

- Vendas antigas legiveis.
- Vendas novas.
- Venda direta.
- Mesa.
- Parcial de mesa.
- Submesa.
- Canceladas, se existir.
- Estornadas, se existir depois.

Filtros:

- Data.
- Valor.
- Produto.
- Mesa.
- Forma de pagamento.
- Status.
- Tipo: Venda direta ou Mesa.

Botao direito no historico:

- Ver detalhes.
- Ver produtos da venda.
- Reimprimir/exportar, se existir.
- Cancelar/estornar com confirmacao.
- Alterar forma de pagamento, se permitido.

Teste de aceite:

- Historico mostra venda direta e mesa fechada.
- Historico mostra vendas antigas legiveis.
- Filtro por produto, mesa, pagamento e status funciona.
- Cancelamento pede confirmacao.

## Fase 14 - Relatorios integrados

Objetivo: relatorios unificados somando Venda direta + Mesas.

Indicadores:

- Total vendido no dia.
- Total por forma de pagamento.
- Total em dinheiro.
- Total em debito.
- Total em credito.
- Total em Pix.
- Total em Nao definido.
- Quantidade de vendas.
- Ticket medio.
- Produtos mais vendidos.
- Categorias mais vendidas.
- Horarios de pico por hora.
- Quantidade de mesas fechadas.
- Quantidade de vendas diretas.
- Total de descontos dados.

Filtros:

- Hoje.
- Ontem.
- Semana.
- Mes.
- Periodo personalizado.
- Mesa.
- Produto.
- Categoria.
- Forma de pagamento.
- Status.

Teste de aceite:

- Relatorio soma venda direta + mesa.
- Total por pagamento bate com pagamentos registrados.
- Produtos mais vendidos batem com itens vendidos.
- Filtros de periodo e forma de pagamento funcionam.

## Fase 15 - Excel integrado

Objetivo: exportar Excel correto a partir do SQLite integrado.

Regras:

- Excel nao e banco principal.
- Banco principal das novas vendas e SQLite.
- Excel deve ser gerado a partir do SQLite integrado.
- Nao mexer em Excel antigo sem necessidade.
- Nao corromper arquivo se estiver aberto.
- Ter botao para abrir pasta onde os Excel sao salvos.
- Permitir exportacao manual.
- Se fizer sentido, permitir exportacao automatica/fechamento do dia.

Abas obrigatorias:

- Resumo.
- Vendas.
- Itens.
- Pagamentos.

Regras obrigatorias:

- Se pagamento nao for definido, registrar como Nao definido.
- Registrar corretamente debito, credito, dinheiro, Pix, outros etc.
- Nao colocar troco como venda.
- Nao exportar estoque.
- Nao exportar custo.
- Nao exportar fiscal.
- Nao exportar codigo de barras.

Teste de aceite:

- Exportar venda direta.
- Exportar mesa fechada.
- Exportar pagamento multiplo.
- Exportar dinheiro com troco sem somar troco.
- Abrir pasta de exportacao.
- Testar Excel aberto durante exportacao.

## Fase 16 - Rede preservada, mas fora do foco

Objetivo: manter a aba Rede existente sem deixar ela atrapalhar o foco atual.

Regras:

- Rede pode continuar existindo.
- Rede nao e prioridade nesta etapa.
- Foco atual e Venda, Mesas, Historico, Relatorios, Excel, Ajuste e banco local seguro.
- Codigo antigo de rede, cliente/servidor ou conexao deve ser preservado.
- Rede nao pode atrapalhar o novo fluxo.
- Rede nao deve definir regras de Venda/Mesas agora.

Teste de aceite:

- Aba Rede continua acessivel.
- Rede nao interfere em Venda/Mesas.
- Desativar servidor nao afeta venda local.

## Fase 17 - Design, temas e responsividade

Objetivo: manter identidade visual do Contabilizador e adaptar Venda/Mesas aos temas existentes.

Temas a manter/adaptar:

- Claro.
- Escuro.
- DataCaixa.
- DataCaixa escuro.
- PDV Italia.

Regras visuais:

- App deve parecer um sistema unico, nao um modulo colado.
- Usar Datacaixa apenas como inspiracao para fluxo, cores de status, botoes grandes e organizacao visual.
- Manter identidade visual do Contabilizador.
- Corrigir notebook e tela pequena.
- Texto legivel.
- Total grande.
- Confirmacoes claras.
- Botoes grandes.
- Rolagem correta.
- Cores claras para mesa livre, ocupada, fechamento e reservada.

Teste de aceite:

- Trocar tema e ver Venda/Mesas acompanhando o app.
- Tela de notebook nao quebra.
- Mesa aberta tem rolagem correta.
- Submesas nao estouram a tela.

## Fase 18 - Extras uteis

Objetivo: adicionar recursos uteis sem passar na frente do fluxo principal.

Extras:

- Observacao na mesa.
- Observacao no produto.
- Botao para repetir ultimo produto.
- Botao para limpar quantidade.
- Atalho para focar pesquisa.
- Atalho para focar quantidade.
- Botao de pesquisa rapida.
- Confirmacao antes de cancelar mesa.
- Confirmacao antes de cancelar produto.
- Confirmacao antes de cancelar venda.
- Tela de detalhes da venda.
- Backup automatico do banco.
- Relatorio de fechamento do dia.

Regra:

- Esses extras nao devem virar prioridade maior que Venda, Mesas, Historico, Relatorios, Excel, Ajuste e banco seguro.

## Fase 19 - Testes finais e entrega

Objetivo: validar o sistema como um unico aplicativo pronto para uso diario.

Testes obrigatorios:

- Venda simples.
- Venda com quantidade 3.
- Produto por kg.
- Produto por grama.
- Venda com adicional correto.
- Venda sem abrir adicional usando Shift + clique.
- Mesa aberta.
- Mesa com submesa.
- Transferencia parcial entre submesas.
- Transferencia parcial entre mesas.
- Pagamento multiplo.
- Dinheiro com troco.
- Fechamento parcial.
- Fechamento total.
- Historico.
- Relatorio.
- Excel.
- Fechar e abrir app com mesa aberta.
- Atualizacao sem perder dados antigos.
- Tela pequena/notebook.
- Arquivo Excel aberto durante exportacao.
- Clique duplo no fechamento para garantir que nao duplica.
- Cancelamento de produto.
- Cancelamento de mesa.

Resultado final deve incluir:

- Explicacao do que foi alterado.
- Lista de arquivos modificados.
- Instrucoes para testar.
- Observacoes sobre o que foi preservado do sistema antigo.
- Confirmacao de que barra fixa/barra rapida foi desativada e preservada em backup.
- Confirmacao de que Venda e Mesas estao integradas ao mesmo Historico, Relatorios e Excel.
