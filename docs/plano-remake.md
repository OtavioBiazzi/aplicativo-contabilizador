# Plano de remake PDV local

Este remake muda o Contabilizador Caixa para um PDV local simples. O Excel deixa de ser banco principal e passa a ser importacao/exportacao. A fonte principal dos dados novos e `pdv.sqlite`, salvo na pasta local de dados do Electron.

## Direcao

- Venda direta rapida.
- Mesas com status e itens persistidos.
- Produtos simples: nome, categoria, preco, unidade, ativo, exibir no PDV e ordem.
- Pagamentos multiplos, historico, relatorios e exportacao Excel por dados do banco.
- Sem estoque, fiscal, codigo de barras, fornecedor, margem ou custo.
- Codigo antigo preservado como legado; a tela principal nova entra por `PdvApp`.

## Fase 1 - Base PDV local

Status: implementada.

Entregas:
- Criar banco local `pdv.sqlite` com tabelas de categorias, produtos, mesas, itens, vendas e pagamentos.
- Criar importacao da planilha `produtos.xlsx` da Cose Dell Abadia.
- Ler apenas `DESCRICAO`, `GRUPO`, `PRECO_VENDA`, `UNIDADE`, `ATIVO` e `EXIBE_PDV`.
- Criar tela principal nova com Venda, Mesas, Produtos, Historico, Relatorios e Avancado.
- Permitir carrinho de venda direta, quantidade antes do produto, desconto simples e fechamento como "Nao definido".
- Permitir abrir mesa, lancar itens, salvar mesa e fechar mesa com forma de pagamento simples.
- Preservar app antigo sem apagar os modulos existentes.

Teste de aceite:
- `npm run build`
- Smoke Electron: abrir janela, importar `C:/Users/giova/Downloads/produtos.xlsx` e confirmar produtos no PDV.

## Fase 2 - Venda e mesa completas

Objetivo: transformar o fluxo atual em operacao diaria completa.

Status: concluida.

Entregas:
- Editar quantidade de item no carrinho. Implementado.
- Desconto por produto em reais. Implementado.
- Observacao por item e por mesa. Implementado.
- Cancelar produto com confirmacao. Implementado.
- Fechamento total com tela propria de pagamento. Implementado para venda direta e mesa.
- Pagamentos multiplos com valor restante. Implementado.
- Dinheiro com valor recebido e troco visivel, sem gravar troco como pagamento. Implementado no fechamento.
- Fechamento parcial inicial por valor manual e por item selecionado. Implementado.

## Fase 3 - Submesas e divisao

Objetivo: permitir comandas/pessoas dentro da mesa.

Status: concluida na base operacional.

Entregas:
- Criar submesa por nome e alternar entre mesa principal/submesa. Implementado.
- Lancar item em submesa. Implementado.
- Mover item entre submesas. Implementado.
- Total por submesa. Implementado.
- Fechar submesa separadamente. Implementado.
- Dividir igualmente por quantidade de pessoas com ajuste de centavos.
- Dividir igualmente por quantidade de pessoas com ajuste de centavos. Implementado no fechamento.
- Dividir por produtos selecionados. Implementado via selecao/parcial por itens.

## Fase 4 - Historico e relatorios

Objetivo: tornar consulta e fechamento do dia confiaveis.

Status: concluida na base operacional.

Entregas:
- Historico detalhado por venda, mesa, item e pagamento. Implementado.
- Filtros por data, mesa, produto, forma de pagamento, status e tipo. Implementado.
- Detalhe da venda com itens, adicionais e pagamentos. Implementado.
- Cancelamento/estorno com confirmacao e venda preservada como auditoria. Implementado.
- Relatorio por periodo, pagamento, produto, categoria e horario. Implementado.
- Total vendido, ticket medio, descontos, mesas fechadas, vendas diretas e parciais. Implementado.

Teste de aceite:
- `npm run build`
- Smoke SQLite: gravar venda com adicional, consultar no historico e cancelar mantendo status `Cancelada`.

## Fase 5 - Excel do PDV

Objetivo: gerar Excel correto a partir do SQLite.

Status: concluida na base operacional.

Entregas:
- Exportar resumo, vendas, itens e pagamentos. Implementado.
- Nunca exportar troco como pagamento. Implementado; troco sai em coluna propria de auditoria.
- Usar "Nao definido" quando nao houver forma de pagamento. Implementado na gravacao da venda e refletido no Excel.
- Botao para abrir pasta de exportacoes. Implementado em Relatorios.
- Exportacao diaria e por periodo. Implementado pelos filtros da tela de Relatorios.

Teste de aceite:
- `npm run build`
- Smoke XLSX: criar venda com dinheiro/troco/adicional, cancelar outra venda, exportar e conferir abas `Resumo`, `Vendas`, `Itens` e `Pagamentos`.

## Fase 6 - Cadastro e ajustes

Objetivo: completar produtos, categorias e configuracoes do PDV.

Status: concluida na base operacional.

Entregas:
- Criar, editar, desativar e reordenar produto. Implementado.
- Criar, editar e ocultar categoria. Implementado.
- Ordenacao alfabetica padrao. Implementado com ordem manual opcional.
- Preparar favorito no topo e ordem manual.
- Configurar quantidade de mesas. Implementado.
- Preset nativo "Cose Dell Abadia". Implementado.
- Configurar produtos em massa para categoria, complemento e abertura de adicionais. Implementado.
- Complementos opcionais com Shift+clique para lancar direto. Implementado.
- Preco unitario alteravel somente no lancamento. Implementado.
- Backup automatico do SQLite antes de migracao/importacao. Implementado.
- Backup de seguranca de atualizacao preservando `settings.json`, `ledger.json` e `pdv.sqlite` quando existirem. Implementado.

Teste de aceite:
- `npm run build`
- Smoke SQLite: criar/editar categoria, criar/editar produto, alternar flags de complemento e confirmar backup antes de importacao.

## Fase 7 - Polimento e release

Objetivo: fechar o produto para uso continuo.

Status: concluida para publicacao no GitHub.

Entregas:
- Revisar responsividade para notebook. Implementado na base PDV.
- Ajustar atalhos de pesquisa e quantidade. Mantido fluxo de quantidade, busca e Shift+clique para adicionais.
- Criar smoke test novo do PDV. Implementado em `npm run smoke:pdv`.
- Atualizar README. Implementado.
- Gerar instalador e publicar release. Pendente para empacotamento final; esta etapa publica o codigo no GitHub.

Teste de aceite:
- `npm run build`
- `npm run smoke:pdv`
