# Caixa PDV 0.4.7

- Busca de várias mesas de uma vez (`001, 004, 021`) no mapa, Histórico e Relatórios, inclusive exportação.
- Cadastro de produtos e categorias editável no cliente quando o servidor libera edição de configurações e gerenciamento de produtos. Sem essas permissões, continua bloqueado.
- Avisos informativos do PDV respeitam a opção de notificações; erros que impedem a operação continuam visíveis.
- Renomear submesa agora troca o nome existente, inclusive quando está vazia, preservando itens lançados por outro terminal.
- Filtro de produtos com texto legível e linhas de resultado de altura estável mesmo quando só há um produto.
- Nova opção em Operação para ocultar a identificação da pessoa no fechamento total.
- Venda e Mesa mantêm carrinhos separados ao alternar telas; mudanças pendentes da mesa são gravadas ao sair dela.

Validação: compilação de produção, testes de rede, fechamento, concorrência, histórico e caixa; conferência no Electron dos filtros, renomeação, carrinhos, avisos e identificação no pagamento.

Atualize servidor e clientes para a mesma versão.
