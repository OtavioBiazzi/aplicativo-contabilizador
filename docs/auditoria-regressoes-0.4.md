# Auditoria de regressões e recuperação dos fluxos

Referências: v0.3.53 (última anterior à 0.4.0) e v0.4.3 (atual).

## Escopo e evidências antes de alterar

- Carrinho: ambas as versões mostram “Comprimido” no cabeçalho. Remover somente esse indicador, preservando a compressão e as quantidades.
- Transferência: o destino já é buscado e aberto, mas o callback atual usa a navegação do header; navegar para Mesas novamente incrementa a chave do PDV e desmonta a mesa recém-aberta. Separar a navegação interna da ação de voltar ao início pelo header; impedir autosaves antigos de cruzarem a transferência.
- Histórico: a ocultação da descrição de mesas já existia na v0.3.53. A conversão não inclui os nomes associados aos pagamentos. Exibir descrições, submesas e clientes; incluir nomes na pesquisa. Conferir filtros, produtos, pagamentos, edição, recibos, cancelamento, lixeira e restauração.
- Financeiro: os filtros comparam exclusivamente vencimento; contas sem vencimento são excluídas por qualquer limite. Distinguir emissão/vencimento explicitamente, normalizar datas e usar emissão como referência das contas sem vencimento. Preservar o mês inicial e os filtros de situação.
- Recebimento por cliente: novidade; a versão anterior recebia conta por conta. Criar visualização por cliente com saldo integral, sem limitar o total ao período da consulta de contas. Abater primeiro vencimentos mais antigos, depois emissão; gravar todos os abatimentos em uma transação e guardar a operação para impedir recebimentos duplicados.
- Atualização: o download/instalador já é local e não depende do servidor, mas a tela de espera retorna antes de renderizar o acesso e os avisos de atualização. Disponibilizar verificação/instalação nessa tela e manter o acesso no cliente conectado.

## Validação prevista

- Tipos e compilação do frontend/Electron.
- Regressões de mesas, concorrência, fechamento parcial, caixa e rede.
- Recebimento consolidado: parcial, integral, contas canceladas/excluídas, clientes com mesmo nome, troco, excesso, reenvio e persistência.
- Datas: mês, limites inclusivos, data sem vencimento, ISO, datas antigas e seleção de emissão/vencimento.
- Interface: compressão sem alterar cabeçalho; transferência permanece no destino; nomes no histórico; clientes/saldos e atualização com servidor desconectado.

## Resultado

Implementado para a v0.4.4, mantendo a interface e as melhorias das versões 0.4.x.

| Área | Evidência / mudança | Validação |
| --- | --- | --- |
| Carrinho comprimido | Indicador textual removido; agrupamento e quantidade preservados | Duas linhas viram uma e os limites do cabeçalho permanecem idênticos no Electron |
| Transferência | Navegação interna não remonta o PDV; fila de gravação é concluída antes de abrir o destino; autosave fica suspenso durante a operação | Mesa 001/Ana → Mesa 002/Destino; contexto e total de R$ 20 preservados |
| Histórico | Descrições de mesas voltam a aparecer; nomes dos pagamentos e das contas vinculadas entram na descrição e busca; filtro parcial inclui vendas parciais de submesas | Nome Maria Auditoria e Pix + Dinheiro visíveis na consulta |
| Edição de fechamento | Edição comum não regrava pagamentos inalterados. Vendas mistas usam editor de todos os pagamentos, acessível pelo ícone de carteira | Descrição editada sem perder os dois pagamentos; alteração de valores para 5 + 5; cancelamento/restauração verificados |
| Datas financeiras | Emissão como padrão no mês atual; vencimento selecionável; conta sem vencimento usa emissão; limites inclusivos e horário local | Conta sem data e vencimento do mês seguinte aparecem na consulta por emissão |
| Contas a receber | Aba Por cliente exibe todo saldo pendente; recebimento total/parcial distribui por vencimento mais antigo | R$ 38 em contas de R$ 20 + R$ 30 deixa R$ 12; conferência local e cliente real |
| Contas a pagar | Aba Por fornecedor e pagamento consolidado com mesma regra | R$ 38 em contas de R$ 20 + R$ 30 deixa R$ 12; conferência pela interface |
| Seleção de contas | Checkbox por linha e Receber/Pagar selecionadas; seleção deve pertencer ao mesmo cliente/fornecedor | R$ 25 em duas contas de R$ 10 + R$ 20 deixa R$ 5; uma terceira conta de R$ 15 permanece intacta |
| Integridade | Uma transação por distribuição; identificador persistente impede repetição; servidor recalcula saldo e valida propriedade das contas | Reenvio, reinício, excesso, homônimos, conta cancelada/excluída e concorrência |
| Atualização do cliente | Verificação/instalação local na espera de conexão; menu Atualizações conectado continua independente | Consulta real ao GitHub com endereço do servidor indisponível; menu acessível no cliente conectado |

## Testes executados

- `npm run build` (tipagem frontend e Electron, build de produção).
- `scripts/smoke_regressions.mjs`: datas locais, referências, distribuição, troco, seleção, saldo excedido, homônimos, idempotência e edição de pagamentos.
- `scripts/smoke_network.mjs`: protocolo, permissões, reconexão, snapshot, versões, mesas e novos comandos financeiros HTTP com reenvio e seleção.
- `scripts/smoke_pdv.mjs`, `scripts/smoke_concurrent_tables.mjs`, `scripts/smoke_scope_close.mjs`, `scripts/smoke_cash_shift.mjs`.
- Playwright conectado ao Electron com banco isolado: filtros financeiros, saldo por cliente/fornecedor, recebimento selecionado, recebimento pelo cliente real, contexto da transferência, compressão, nomes e editor do histórico, atualização sem servidor. Capturas em `outputs/audit-*.png`.

## Limites e decisões

- Esta auditoria combina comparação de código com testes dos fluxos indicados. Não promete ausência de qualquer defeito em todas as funções possíveis.
- Algumas falhas relatadas já existiam antes da 0.4.0 (indicador de compressão e ocultação da descrição). Foram corrigidas pelo efeito observado, sem assumir que toda falha surgiu na atualização.
- Duplicar uma venda do PDV como lançamento já era recusado pelo backend antigo. O comando incompatível agora fica desabilitado, evitando um botão que sempre falhava; não cria cópias de operações financeiras concluídas.
- Fornecedores são agrupados pelo nome salvo, ignorando caixa e espaços extras; contas sem fornecedor continuam na pesquisa individual. Clientes usam ID de cadastro, sem juntar pessoas com o mesmo nome.
- Vendas que originaram contas a receber mantêm os pagamentos financeiros geridos pela tela de contas. O editor de pagamentos não contorna esse controle.
- O teste de atualização verificou consulta e acesso sem servidor. O instalador não foi acionado na base de testes para não substituir a instalação do usuário durante a auditoria.
- Não foram alterados dados reais; testes usam diretórios isolados.
