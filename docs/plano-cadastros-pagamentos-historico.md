# Cadastros, pagamentos, histórico e produtos — 31/10/2026

Base: 0.4.13. Preservar os fluxos existentes, tema escuro e modo simples. Publicação solicitada após a conferência do aplicativo; entrega na versão 0.4.14.

- [x] Cadastro de pessoa com tipo Cliente, Fornecedor ou Ambos. Fornecedor cadastrado por essa tela disponível nas contas a pagar; preservar contas antigas ao alterar o cadastro.
- [x] Pagamento/recebimento com data e hora editáveis, preenchidas com o momento atual; persistir em operações individuais e agrupadas, também pelo cliente.
- [x] Digitação por prefixo nas listas cadastradas, reiniciando após uma pausa; Tab percorre os campos sem parar nos botões auxiliares de cadastro. Manter acesso a esses botões por teclado.
- [x] Resumo de mesas com saldo aberto, realizado do dia e previsão do total (realizado + aberto), sem contar pagamentos duas vezes.
- [x] Edição da mesa de um registro do histórico persistida, sem modificar uma mesa em uso ou a identidade da sessão antiga.
- [x] Atualizar descrições geradas automaticamente quando muda mesa ou pagamento; preservar descrições livres, nomes e identificações.
- [x] Filtro por meio de pagamento considera somente a parcela correspondente no valor mostrado, nos limites de valor e na soma. Exemplo: Crédito 30 + Débito 30 → Crédito soma 30.
- [x] Opção Habilitar aba FREQUENTE em Produtos; aba virtual no fim das categorias operacionais, com os produtos mais vendidos. Sem copiar produtos ou criar categoria no banco.
- [x] Duplicar produto abre rascunho para conferir, sem copiar ID, códigos únicos ou saldo de estoque; cancelar não grava.
- [x] Centralizar o ícone de detalhes/olho no Histórico.
- [x] Editor dos pagamentos do Histórico com formulário compacto, todas as partes editáveis, total validado e respeito às contas a receber vinculadas.
- [x] Verificar migração com backup, tipos/build, rede/concorrência e interface do servidor e cliente, incluindo telas menores.

Decisões: clientes antigos continuam classificados como Cliente; FREQUENTE é opcional e usa até 24 produtos por quantidade vendida em vendas válidas, incluindo fechamentos parciais e excluindo canceladas/excluídas. As vendas antigas são referência para regras, sem restaurar interfaces antigas.

## Resultado da verificação

- Compilação completa e tipagem aprovadas.
- Passaram os testes existentes de PDV, fechamento parcial, concorrência, caixa, rede, regressões financeiras, campos opcionais, migrações e privacidade.
- `smoke_operations_refinements.mjs`: migração v5 → v6 com backup, preservação de cadastros antigos, classificação/vínculo de fornecedor, datas individuais/agrupadas, reenvio, edição histórica sem alterar mesa em uso, descrições automáticas, filtro por pagamento, relatório/Excel e ranking com invalidação do cache.
- `qa_operations_refinements.py`: fluxo no Electron com servidor e cliente, cadastro de fornecedor, Tab sem parar nos botões auxiliares, F2, busca por prefixo com reinício após pausa, pagamentos com data e hora escolhidas, troco, duplicação cancelada/salva, FREQUENTE e histórico. Modal de pagamentos conferido em 1280×720 e 1024×600.
- `qa_operations_network_reports.py`: pagamentos agrupados por HTTP nas duas áreas com data escolhida e reenvio sem duplicar; validação e permissão da preferência de produtos; relatório de débito com R$ 30 de uma venda de R$ 60.
- Capturas e dados de teste isolados em `outputs/qa-operations-20261031/`; nenhuma alteração em bancos reais.
- Release: `qa_operations_refinements.py` e `qa_operations_network_reports.py` aprovados também no executável empacotado 0.4.14 como servidor e cliente, com banco isolado em `outputs/qa-operations-20261031/release-0.4.14/`. Portátil 0.4.14 conferido na inicialização.

Regras complementares:

- A alteração do tipo de cadastro não altera nomes/valores salvos nas contas antigas. O vínculo do fornecedor acompanha o cadastro atual; contas históricas mantêm sua identificação original.
- A duplicação de produto preserva configurações e preço, mas começa sem SKU, código de barras, vínculo de importação ou saldo de estoque. O rascunho pode ser revisto antes de salvar.
- O histórico mantém o registro completo para editar e imprimir. O filtro de pagamento muda o recorte exibido/somado. Nos relatórios/Excel filtrados, os valores dos itens são distribuídos proporcionalmente ao pagamento selecionado, sem alterar quantidade vendida ou preço cadastrado no banco.
- A aba FREQUENTE usa um ranking armazenado em memória e invalidado quando vendas ou produtos mudam; não recalcula o histórico em cada interação de mesa. O ranking só é solicitado com a opção habilitada.
- Dados e preferências de produtos ficam no servidor e obedecem a Gerenciar produtos. A opção não exige liberar personalização operacional do cliente.

As alterações compõem a versão 0.4.14; consulte `docs/release-0.4.14.md` para as notas da entrega.
