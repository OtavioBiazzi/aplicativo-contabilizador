# Simplificação de Contas a Pagar e Contas a Receber

Solicitação de 25/10/2026: seguir a organização simples da referência, mantendo tema escuro e controles quadrados.

- Consulta principal: busca, situação e período. Datas específicas e referência de emissão/vencimento aparecem em “Escolher datas”.
- Tabela: seleção, descrição/cliente/fornecedor, vencimento, valor, saldo e situação. Colunas adicionais continuam disponíveis em Visualização.
- Ações frequentes: Novo, Alterar e Pagar/Receber. Seleção de várias contas revela a ação conjunta. Cancelamento, exclusão e recibos ficam em Mais ações.
- Nova conta a pagar: descrição, fornecedor, valor, forma prevista (Pix por padrão), emissão, vencimento e observação.
- Nova conta a receber: cliente, descrição, valor, vencimento e observação.
- Informações ocasionais: categoria, documento, centro de custo, tags, parcelamento/recorrência e correção de pagamentos ficam recolhidos. Conta corrente/conta prevista deixa de ocupar o formulário; os dados anteriores são preservados ao editar.
- Cadastro de fornecedores: criar e excluir dentro de Contas a Pagar ou durante o cadastro de uma despesa. Excluir fornecedor não exclui nem altera suas contas antigas. Registros antigos são importados uma vez; fornecedores excluídos não reaparecem ao reiniciar.
- Pagamento e recebimento: uma única janela com forma e valor preenchidos. Pode pagar parcialmente; recebimento em dinheiro mantém o cálculo de troco.
- Rede: cadastro de fornecedores e forma prevista persistidos no servidor, respeitando a permissão financeira existente do cliente.
- Verificação: migração da base anterior com backup, persistência após reiniciar, retenção do histórico ao remover fornecedor, pagamentos parciais/agrupados, filtros e teste visual em janela pequena.

## Verificação concluída

### Refinamento solicitado após abrir a prévia

- Descrição passa para a última linha principal e fica opcional. Apenas o valor é obrigatório; vencimento é exigido somente para calcular parcelas ou recorrências.
- Novas contas ficam sem forma prevista selecionada. Uma forma já escolhida em conta antiga é preservada, e pode ser removida pelo usuário. Ao pagar de fato é necessário escolher o meio usado.
- Documento, categoria e centro de custo ficam à vista. Categoria e centro de custo usam listas com cadastro e exclusão pelo botão “+”, compartilhadas com o cliente autorizado.
- Os cadastros são independentes das classificações históricas: remover um nome não altera contas antigas nem recria o cadastro ao reiniciar.
- Total, já pago e “Falta pagar” ganham uma faixa visível no cadastro/registro. A descrição em branco tem identificação de exibição pelo fornecedor, documento ou categoria.
- Prévia separada com dados de teste para conferir esta organização sem interromper o aplicativo aberto.
- Verificação do refinamento: compilação aprovada; testes de migração v4 → v5, campos opcionais, saldo parcial e cadastros aprovados. Testes no Electron como servidor e cliente confirmaram os cadastros de categoria/centro, conta sem descrição/vencimento/forma prevista e pagamento parcial. Janela conferida em 1024 × 600. Versão local de prévia: 0.4.11-preview.1.

- `smoke_simple_finance` aprovou a migração v3 → v4, backup, forma prevista, dados antigos, exclusão do fornecedor sem afetar suas contas e reinício sem recriar o cadastro removido.
- Passaram os testes existentes de rede/permissões, regressões financeiras, PDV, fechamento parcial, caixa, concorrência e identificação no histórico.
- `qa_simple_finance.py` aprovou cadastro de fornecedor dentro da conta, preservação dos campos, forma prevista no pagamento, pagamento parcial, recebimento agrupado com troco e filtros. Os totais foram conferidos dentro da janela de 1024 × 600.
- `qa_simple_finance_client.py` aprovou criação/exclusão de fornecedor no servidor pelo cliente autorizado e conta criada remotamente com Pix previsto.
- `qa_help_finance.py` continuou aprovando pendências por cliente, cadastro de cliente durante uma cobrança, resumo das mesas, ajuda e reabertura do Histórico após consulta de uma mesa.
