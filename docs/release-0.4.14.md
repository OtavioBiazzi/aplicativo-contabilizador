# Caixa PDV 0.4.14

- Cadastro de pessoas com tipo Cliente, Fornecedor ou Cliente e fornecedor. Fornecedores cadastrados nessa tela ficam disponíveis nas contas a pagar, também pelo cliente autorizado.
- Pagamentos e recebimentos com data e hora editáveis, preenchidas com o momento atual. A data escolhida é preservada nas operações individuais e agrupadas.
- Busca por prefixo nas listas cadastradas, reiniciando após uma pausa. Tab percorre os campos sem parar nos botões auxiliares; F2 abre o cadastro correspondente.
- Resumo de Mesas em aberto com saldo pendente, realizado hoje e previsão do total, somando o realizado ao saldo restante das mesas.
- Corrigida a edição do número da mesa no Histórico, sem alterar uma mesa em uso ou a sessão original da venda.
- Descrições geradas automaticamente acompanham mudanças de mesa e pagamento. Nomes, identificações e descrições livres são preservados.
- Filtros por pagamento consideram somente a parcela selecionada nos valores e totais. Uma conta com R$ 30 em crédito e R$ 30 em débito soma R$ 30 ao filtrar crédito. Relatórios e Excel seguem o mesmo recorte; valores dos itens são rateados proporcionalmente sem alterar os dados da venda no banco.
- Nova opção Habilitar aba FREQUENTE em Produtos: exibe, no fim das categorias, até 24 produtos mais vendidos em operações válidas. O ranking usa cache e só é solicitado com a opção habilitada.
- Duplicar produto abre um rascunho para conferir, sem copiar códigos únicos, vínculo de importação ou saldo de estoque. Cancelar não grava o produto.
- Editor compacto de pagamentos no Histórico, com todas as partes editáveis e validação do total. Ícone de detalhes centralizado.
- Migração do banco com backup, preservando os cadastros e os dados financeiros anteriores.

Validação: compilação completa; testes de PDV, rede, concorrência, fechamento parcial, caixa, migrações, regras financeiras e privacidade. Conferência no Electron como servidor e cliente de cadastro, teclado, datas, pagamentos agrupados, duplicação, FREQUENTE, filtros e edição do Histórico. Interface do editor de pagamentos verificada em 1280×720 e 1024×600.

O executável empacotado 0.4.14 passou nos fluxos acima como servidor e cliente, incluindo pagamentos agrupados por HTTP e permissões. O portátil 0.4.14 também abriu com dados isolados e a seleção de modo disponível.

Atualize o servidor e os clientes para a mesma versão.
