# Caixa PDV 0.4.10

- Contas a pagar e a receber mais simples: menos botões e colunas visíveis, com cancelamento, exclusão e recibos em “Mais ações”. A ação de pagar/receber várias contas aparece ao marcar as contas.
- Filtros resumidos a busca, situação e período. Datas específicas e escolha entre emissão/vencimento ficam em “Escolher datas”. Ampliar o período mantém a situação escolhida.
- Cadastro de conta a pagar com descrição, fornecedor, valor, forma prevista, emissão, vencimento e observação. Pix vem selecionado inicialmente; a forma escolhida é lembrada ao pagar.
- Cadastro de conta a receber com cliente, descrição, valor, vencimento e observação. Campos extras ficam recolhidos em “Mais opções”.
- Campo de conta corrente/conta prevista removido dos formulários. Os dados anteriores são preservados ao editar contas antigas.
- Novo cadastro de fornecedores em Contas a Pagar, com criação e exclusão também pelo cliente autorizado. Remover um fornecedor mantém suas contas antigas e não recria o cadastro ao reiniciar.
- Pagamento e recebimento em uma janela com forma e valor preenchidos, incluindo pagamentos parciais, recebimentos agrupados e troco em dinheiro.
- Melhor aproveitamento de telas menores, mantendo os totais visíveis e a rolagem na lista de contas.

Validação: compilação e geração do instalador; testes de migração com backup, fornecedores, reinício, rede/permissões, financeiro, PDV, caixa, concorrência e fechamento parcial. Conferência no Electron como servidor e cliente, em 1280 × 720 e 1024 × 600, incluindo preservação de dados antigos e pagamentos/recebimentos parciais e agrupados.

Atualize servidor e clientes para a mesma versão.
