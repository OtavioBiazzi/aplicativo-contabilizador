# Plano consolidado — evolução profissional do Contabilizador Caixa

Data de consolidação: 20/09/2026; revisão de andamento: 21/09/2026.
Estado: implementação em prévia local. Release depende da validação do usuário.

Este documento reúne o planejamento anterior de mesas, fechamento, financeiro e cliente/servidor com os requisitos mais recentes de navegação, Menu Gerencial, Caixa, tema escuro, relatórios, escolha de função na inicialização e abertura/fechamento de caixa.

Ele complementa `docs/plano-remake.md` e `docs/plano-remake-historico.md`. Quando houver conflito de interface, as decisões registradas aqui são as mais recentes. As regras anteriores de preservação de dados, backup, validação e ausência de regressões continuam válidas.

## 1. Direção do produto

O aplicativo continuará sendo o mesmo PDV. Venda e Mesas permanecem como áreas principais e seus fluxos visuais serão preservados sempre que possível.

Decisões deste ciclo:

- usar o tema escuro como padrão de novas instalações;
- manter Venda e Mesas como os únicos espaços operacionais fixos;
- abrir Caixa e Menu Gerencial sobre o conteúdo atual, dentro da mesma janela;
- substituir logo/nome do canto esquerdo pelo Total do Dia;
- remover o Modo Caixa Clássico e consolidar o produto no Modo Simples/PDV;
- corrigir integridade de pagamentos, mesas e sincronização antes do acabamento visual;
- permitir ao cliente autorizado o mesmo acesso do servidor conforme permissões;
- preservar `pdv.sqlite`, `ledger.json`, `settings.json`, históricos, perfis e backups existentes.

O tema claro fica registrado para uma etapa posterior e não é prioridade neste ciclo.

## 2. Base técnica

| Referência | Situação | Decisão |
| --- | --- | --- |
| `origin/main`, 0.2.38 | Base antiga | Não usar |
| `codex/remake-pdv-local`, 0.3.27 | Cópia com trabalhos locais | Preservar sem sobrescrever |
| `origin/codex/reports-backup-v0330`, 0.3.53 | Base mais completa, com financeiro e rede | Base recomendada, após verificar se há revisão posterior equivalente |

Antes de implementar, criar checkout isolado da versão realmente usada nos computadores, validar backup restaurável e não misturar automaticamente alterações de branches diferentes.

## 3. Header e navegação

Estrutura proposta:

```text
┌──────────────────────┬──────────┬──────────┬──────────┬───────────────┐
│ Total do dia         │  Venda   │  Mesas   │  Caixa   │       ⚙       │
│ R$ 1.248,50          │          │          │          │               │
└──────────────────────┴──────────┴──────────┴──────────┴───────────────┘
```

- Remover logo, ícone e nome do aplicativo do canto esquerdo.
- Exibir Total do Dia à esquerda, respeitando privacidade e permissões.
- Usar botões grandes e quadrados, integrados ao fundo do header: sem caixa aparente no estado inativo e com bloco de destaque somente no item selecionado.
- Manter ícone e texto de Venda, Mesas e Caixa na mesma linha, como na referência do DataCaixa.
- Fixar somente Venda, Mesas, Caixa e o botão de engrenagem.
- Mostrar Configurações apenas por ícone, com tooltip, `aria-label` e foco de teclado; não exibir o texto no header.
- Remover o botão Módulos e transferir seus acessos para o Menu Gerencial.
- Mesas é a tela-base aberta por padrão; Venda continua como o outro espaço operacional fixo.
- Caixa, Configurações, Financeiro, Relatórios e Rede abrem em janelas internas grandes sobre Mesas, com barra de título arrastável e botão Fechar.
- Atualizar atalhos para o novo modelo.

### Camadas sobrepostas

Caixa, Menu Gerencial e suas páginas serão painéis dentro da mesma janela Electron, não janelas nativas separadas.

- Esc fecha somente a camada superior, respeitando alterações pendentes.
- Venda ou Mesas fecham a camada e navegam para a área escolhida.
- Não empilhar páginas gerenciais. Uma página substitui o conteúdo da camada e oferece Voltar.
- Modais de confirmação, pagamento e edição aparecem acima da camada.
- O estado interno permite abrir diretamente a página certa por atalho.
- Ao fechar, preservar carrinho, mesa, submesa, filtros e rolagem quando seguro.

## 4. Padronização no Modo Simples/PDV

- Ativar o visual simples por padrão, com cantos discretos e áreas operacionais mais quadradas.
- Remover da interface a escolha Clássico/PDV, barra fixa e configurações exclusivas do modo antigo.
- Migrar configurações ainda úteis: privacidade, planilha, pastas, atalhos e rede.
- Não apagar dados legados; mantê-los disponíveis para histórico e exportação.
- Mapear dependências de exportação, backup, atualização e servidor antes de remover código.
- Fazer migração idempotente e backup antes da primeira abertura na nova versão.

**Aceite:** uma instalação antiga abre no fluxo novo com seus dados, e Venda, Mesas, Caixa, relatórios, rede, backup e atualização continuam acessíveis.

## 5. Menu Gerencial

O botão de engrenagem abrirá uma central inspirada no anexo 3, adaptada às funções reais do aplicativo.

| Grupo | Acessos |
| --- | --- |
| Cadastros | Produtos e categorias, Clientes, Formas de pagamento, Mesas e submesas |
| Financeiro | Contas a receber, Contas a pagar, Caixa, Consultar vendas |
| Relatórios | Visão geral, Vendas, Produtos por categoria, Pagamentos, Mesas e horários, Financeiro |
| Operação | Impressão e recibos, Importações, Exportações, Backup e restauração |
| Sistema | Aparência, Atendimento e pagamentos, Atalhos, Rede e terminais, Usuários e permissões, Atualizações, Diagnóstico |

- Cada opção abre página própria dentro da camada.
- Adicionar busca no topo por função/configuração.
- Mostrar apenas opções autorizadas.
- Separar preferências locais, compartilhadas e administrativas.
- Indicar a máquina onde impressão, arquivo, backup ou servidor serão operados.
- Relatórios terão páginas próprias e filtros específicos.

## 6. Tema escuro profissional

O escuro será padrão para novas instalações. Preferências já salvas serão respeitadas na migração.

- Fundo geral em azul-marinho muito escuro.
- Header em azul mais vivo, com ativo destacado por cor quente controlada.
- Painéis e modais em níveis distintos de azul/cinza.
- Filtros com fundo e borda próprios.
- Cards com contraste entre cabeçalho, corpo, status e seleção.
- Ações primárias, secundárias, perigosas e desabilitadas diferentes.
- Totais, alertas e estados com hierarquia tipográfica clara.
- Status sempre com texto/ícone além da cor.
- Foco, hover, seleção e pressionado claramente visíveis.
- Usar tokens compartilhados, sem correções de cor isoladas por tela.

**Aceite:** áreas, controles e estados são distinguíveis em 1366×768 e 1920×1080, com zoom de 100% a 125%.

## 7. Cards e filtros das mesas

Manter aproximadamente o tamanho atual dos cards e incluir:

- número e status;
- horário de abertura;
- valor total pendente;
- quantidade de clientes;
- observação curta quando houver espaço.

Mesas livres exibem `Qnt. clientes: 0`; o número só aumenta quando for informado na mesa.

| Status | Cor |
| --- | --- |
| Livre | Azul |
| Ocupada | Vermelho |
| Reservada | Roxo |
| Fechamento | Verde |

- Restaurar e preservar Fechamento, inclusive no filtro.
- Truncar textos longos sem sobrepor valores.
- Atualizar somente o card afetado quando possível.

Ordem dos filtros:

```text
[ Pesquisa ] [ Produtos e quantidades ] [ ● Geral ] [ ● Livre ] [ ● Ocupada ] [ ● Reservada ] [ ● Fechamento ]
```

- Remover o texto isolado “Mesa” e alinhar tudo à esquerda.
- Círculos: Geral cinza; Livre azul; Ocupada vermelho; Reservada roxo; Fechamento verde.
- Buscar `001`, `01` ou `1` localiza Mesa 1 de modo exato, sem trazer 10/11/100.
- **Ver histórico da mesa** abre Caixa/Histórico com a mesa exata aplicada.

### Quantidade mínima e texto sem acentos

- `café` encontra mesas com ao menos um Café.
- `2 cafés`, `2x café` ou `café >= 2` encontra mesas com pelo menos duas unidades.
- Sem quantidade, usar mínimo 1.
- Definir se a soma abrange toda a mesa ou a submesa selecionada e mostrar esse escopo.
- Produtos por peso usam a unidade real, sem converter gramas em unidades inteiras.
- Pesquisa de produtos, categorias, clientes e mesas ignora acentos e caixa: `cafe`, `café` e `CAFÉ` são equivalentes.

## 8. Pessoas e organização dentro da mesa

### Pessoas

- Reutilizar `people` como fonte única.
- Colocar Pessoas no topo direito, onde hoje aparece quantidade de produto.
- Permitir digitação e +/−, com mínimo 1.
- Salvar apenas a alteração de pessoas, sem reenviar todo o carrinho.
- Sincronizar entre terminais com revisão da sessão.
- Mostrar como **Qnt. clientes** no card.
- Usar como sugestão inicial para dividir conta, sem alterar valores automaticamente.

### Carrinho

- Remover o texto “Carrinho”.
- Colocar o botão Produtos nesse espaço.
- Exibir quantidade de produtos/itens à esquerda do botão Produtos.
- Remover Limpar e Repetir desse cabeçalho.
- Preservar formas seguras de remover item/cancelar nos locais próprios.
- Não redesenhar a grade, os cards de produtos e os modais principais além dessa reorganização.

## 9. Caixa e Histórico

O botão Caixa abre uma camada com três páginas:

| Página | Conteúdo |
| --- | --- |
| Movimentação | Vendas, recebimentos, suprimentos, sangrias, abertura e fechamento |
| Histórico | Filtros atuais, vendas, mesa/submesa, pagamentos e origem |
| Fechamentos | Turnos encerrados, responsável, esperado, contado e diferenças |

No Histórico:

- preservar filtros e funções atuais;
- adicionar Hoje, Ontem, 7 dias e Período;
- filtrar por mesa/submesa, pagamento, status, operador e terminal;
- mostrar itens, adicionais, desconto/acréscimo, pagamentos e linha do tempo;
- manter cancelamento/estorno auditável;
- reimprimir comprovante existente;
- exportar todo o recorte, não só a página visível;
- aceitar abertura direta já filtrada por mesa.

### Editar fechamento com pagamentos múltiplos

- Carregar todas as parcelas/meios vinculados à venda.
- Permitir adicionar, alterar e remover cada pagamento.
- Recalcular informado, restante e troco.
- Impedir soma inválida.
- Preservar IDs de pagamentos mantidos e auditar antes/depois.
- Atualizar histórico, relatório e exportação de forma consistente.
- Débito + Pix deve exibir e permitir editar as duas parcelas.

## 10. Controle opcional de caixa

Criar configuração compartilhada **Controle de turno de caixa**.

### Automático

- Padrão compatível com o comportamento atual.
- Não exige abertura/fechamento manual.

### Manual

- Antes da primeira venda financeira do turno, pedir abertura.
- Registrar saldo inicial em dinheiro, responsável, terminal e observação.
- Permitir suprimento e sangria com motivo e auditoria.
- Separar saldo esperado em dinheiro dos outros pagamentos.
- No fechamento, registrar valor contado, diferença e observação.
- Depois de fechar, exigir novo turno para vender.
- Definir virada de dia, queda, turno pendente e troca de terminal.
- Cada terminal pode ter caixa próprio, consolidado pelo servidor.

Conta a receber só entra no caixa quando recebida; venda, dinheiro físico e título a receber são conceitos separados.

## 11. Financeiro profissional

Contas a receber/pagar serão páginas do Menu Gerencial inspiradas na referência:

- comandos visíveis no topo;
- abas Pesquisa e Registro;
- busca, período, situação e filtros;
- tabela densa, ordenável e paginada;
- Novo, Alterar, Excluir, Receber/Pagar, Cancelar/Estornar e Recibo;
- totais do recorte no rodapé;
- detalhes e pagamentos sem perder filtros;
- baixas parciais com saldo claro;
- idempotência contra recebimento/pagamento repetido;
- permissões de valores aplicadas à tela e exportação.

## 12. Relatórios por categoria

Criar página **Produtos por categoria**:

- filtrar período, categoria, produto e origem;
- selecionar uma ou várias categorias;
- ordenar por quantidade, faturamento ou nome;
- escolher colunas: produto, categoria, quantidade, preço médio, total e participação;
- preset **Produção/cozinha**: produto + quantidade, sem valores;
- preset **Gerencial**: quantidade + preço + total;
- preset **Personalizado**: escolha manual;
- pré-visualizar e exportar nos formatos suportados;
- usuários sem permissão financeira nunca recebem valores na tela ou arquivo.

## 13. Escolha Servidor ou Cliente ao iniciar

Sem preferência válida, mostrar antes da interface:

```text
Como este computador será usado?
[ Entrar como Servidor ]  [ Entrar como Cliente ]
[ ] Manter esta opção como padrão
```

### Servidor

- Inicializar banco, serviços e servidor local antes de liberar operações.

### Cliente

- Usar Auto Conexão salva: host, senha e dispositivo.
- Mostrar **Aguardando conexão com o servidor…**.
- Reconectar progressivamente e oferecer Tentar agora.
- Permitir editar conexão sem entrar numa base local independente.
- Baixar estado autoritativo e validar protocolo ao conectar.

### Preferência

- Se marcada, iniciar diretamente no modo salvo.
- Oferecer **Alterar função deste computador** no Menu Gerencial.
- Ter forma de ignorar temporariamente o padrão durante a abertura.
- Nunca transformar cliente desconectado automaticamente em servidor.

## 14. Permissões cliente/servidor

O cliente terá o mesmo nível funcional do servidor se for Administrador e tiver as permissões necessárias.

- Servidor permanece autoridade dos dados compartilhados.
- Verificar permissões na API, não apenas na interface.
- Separar vendas, mesas, financeiro, relatórios, catálogo, configurações, usuários, rede, backup e valores sensíveis.
- Preferências locais funcionam sem conexão.
- Alterações compartilhadas offline são rascunhos pendentes, nunca apresentadas como aplicadas.
- Importação remota envia o arquivo, não somente caminho local.
- Impressão, arquivo e backup identificam a máquina executora.
- Auditar usuário, terminal, antes/depois e resultado.

## 15. Transferência de mesas/submesas

- Padrão: **Manter mesa principal e submesas**.
- Juntar tudo na principal exige escolha explícita.
- Mostrar prévia de origem/destino.
- Preservar identidade e nome de submesas.
- Resolver colisão de nomes sem misturar silenciosamente.
- Abrir a mesa destino ao concluir.
- Usar operação idempotente.

## 16. Sincronização, duplicidade e fechamento

### Fechamento atômico

Uma única operação envia sessão, escopo, revisão, itens, pagamentos, ajustes e ID. Na mesma transação o servidor:

1. valida sessão/revisão;
2. confirma que a conta segue aberta;
3. registra venda e todos os pagamentos;
4. encerra mesa principal ou submesa;
5. preserva outras contas;
6. grava auditoria e nova revisão;
7. persiste antes de responder sucesso.

Reenvio devolve o mesmo resultado. Segunda operação para a mesma conta recebe **Esta conta já foi fechada** e atualiza a tela.

### Lançamentos simultâneos

- Identidade estável para sessão, submesa e item.
- Operações incrementais de item, sem substituir o carrinho inteiro.
- Revisão por mesa/sessão.
- Dois terminais lançando em submesas distintas mantêm ambos os lançamentos.
- Conflito no mesmo item é explícito; nunca apaga silenciosamente.
- Fila offline valida sessão/revisão.
- Dado antigo nunca recria mesa/submesa encerrada.

### Recuperação e desempenho

- Timeout mostra **Conferindo fechamento…** e consulta pelo mesmo ID.
- Impressão, relatório e exportação não bloqueiam confirmação financeira.
- Aplicar a resposta do servidor sem snapshot completo quando possível.
- Deduplicar evento HTTP/WebSocket da mesma operação.
- Mostrar conectado, reconectando, última sincronização e pendências.
- Medir clique → persistência → resposta → tela; meta inicial p95 até 1 s em rede local saudável.

## 17. Entrada numérica

- Valor sugerido é substituído pelo primeiro dígito do teclado digital.
- Exemplo: `72,00` sugerido + tecla `1` = `1,00`.
- Depois do primeiro dígito, formar o novo valor normalmente.
- Se o usuário selecionou/editou manualmente, respeitar cursor/seleção.
- Padronizar Backspace, Limpar, vírgula, zero e Enter.
- Aplicar a peso/valor, pagamento, desconto, acréscimo, abertura, suprimento, sangria e fechamento.
- Não misturar valor, quantidade e peso.

## 18. Atalhos afetados

- Histórico de hoje → Caixa > Histórico com Hoje.
- Relatório do dia → Menu Gerencial > Relatórios > Vendas com Hoje.
- Privacidade → Menu Gerencial > Sistema > Privacidade.
- Configurações → Menu Gerencial.
- Esc fecha só a camada superior.
- Enter confirma somente a ação principal ativa e mantém proteção contra duplo envio.
- Exibir atalhos nas dicas e na página Atalhos.

## 19. Fases de implementação

| Fase | Prioridade | Entrega | Critério para avançar |
| --- | --- | --- | --- |
| 0 | P0 | Congelar base, backup, inventário e reprodução | Versão e banco de teste confirmados |
| 1 | P0 | Sessões, revisões, operações incrementais, fechamento atômico e edição multipagamento | Dois terminais sem perda/duplicidade |
| 2 | P0 | Transferência e pesquisas exata/sem acento/quantidade | Cenários funcionais aprovados |
| 3 | P1 | Seletor Servidor/Cliente e permissões | Administrador e operador validados |
| 4 | P1 | Header, Caixa/Menu Gerencial e remoção visual do clássico | Navegação/atalhos sem perda de contexto |
| 5 | P1 | Tema escuro, cards/filtros, pessoas e carrinho | Validação visual e funcional |
| 6 | P1 | Caixa manual opcional | Conciliação e relatórios aprovados |
| 7 | P1 | Financeiro e relatório por categoria | Totais, permissões e exportação aprovados |
| 8 | P2 | Migração, desempenho, documentação e candidato | Testes e validação manual do usuário |

Uma fase só termina com o fluxo completo funcionando; botão ou tela isolados não contam.

## 20. Matriz mínima de validação

| Cenário | Resultado esperado |
| --- | --- |
| Cliente e servidor lançam em submesas diferentes | Ambos permanecem |
| Dois terminais fecham Ronaldo | Um fechamento e um efeito financeiro |
| Resposta se perde após persistir | Reenvio retorna resultado original |
| Carrinho antigo chega depois do fechamento | Conflito; itens não reaparecem |
| Transferir mesa com submesas | Hierarquia preservada por padrão |
| Buscar `001` | Apenas Mesa 1 |
| Buscar `2 cafes` | Mesas com pelo menos dois Cafés |
| Buscar `cafe` para produto `Café` | Produto encontrado |
| Ver histórico da Mesa 1 | Caixa abre com Mesa 1 exata |
| Editar Débito + Pix | Duas parcelas editáveis |
| Relatório Produção de Café | Quantidades sem valores |
| Sem permissão financeira | Arquivo sem valores sensíveis |
| Cliente abre antes do servidor | Aguarda e conecta automaticamente |
| Cliente administrador | Mesmas funções autorizadas do servidor |
| Teclado sobre `72,00` | Primeiro `1` resulta em `1,00` |
| Caixa automático | Nenhuma abertura exigida |
| Caixa manual | Abertura exigida uma vez por turno |
| Fechamento com diferença | Diferença/responsável auditados |
| Abrir/fechar Caixa sobre Mesa | Contexto da mesa preservado |

## 21. Qualidade e release

- Backup e ensaio de migração em cópia dos dados.
- Esquema versionado e migrações idempotentes.
- Typecheck, build, smoke de PDV/rede e testes de caixa/concorrência.
- Teste com duas instâncias e depois dois computadores reais.
- Testar teclado, mouse, foco, zoom e resoluções-alvo.
- Conferir Histórico, Excel/CSV/PDF, recibos e relatórios após pagamentos mistos e estornos.
- Abrir o candidato local com dados de teste isolados para o usuário validar.
- Não publicar release, instalador definitivo, tag, push ou atualização antes da aprovação explícita do usuário.
- Se houver problema, corrigir, testar novamente e abrir outra prévia.

## 22. Resultado esperado

Venda e Mesas continuam diretas. Caixa reúne movimentação, histórico e turnos sem perder o contexto. O Menu Gerencial organiza financeiro, relatórios, cadastros e configurações. O tema escuro separa bem as áreas e os cards mostram abertura, total e clientes.

## 23. Andamento verificado em 21/09/2026

Esta seção registra o estado da prévia local, sem alterar os critérios das fases acima.

| Área | Estado | Próxima validação |
| --- | --- | --- |
| Header, tema escuro, Mesas/Venda, Menu Gerencial e janelas internas | Implementados na prévia; removida a aba obsoleta Operação PDV e corrigidos contraste, moldura financeira, indicador do header e cartão do total | Revisão visual do usuário em sua resolução |
| Contas a receber/pagar, histórico, filtros e controle de caixa automático/manual | Fluxos implementados e smoke automatizado aprovado; no modo automático não é oferecida abertura manual | Exercitar lançamentos, estornos e fechamento com dados reais de teste |
| Relatórios | Uma única área de relatório por tipo, acessada por uma coluna própria no Menu Gerencial: resumo, produtos por categoria, pagamentos, recebimentos, mesas, horários e auditoria. O relatório de produtos permite quantidade, preço médio e valor total opcionais | Conferir arquivo de produção sem valores e arquivo gerencial com valores, usando vendas reais de teste |
| Servidor/cliente, mesa/submesa e fechamento concorrente | Implementação e smoke de rede/concorrência aprovados; duas instâncias locais conectaram, o cliente retomou automaticamente após iniciar antes do servidor e abriu Produtos, Financeiro, Relatórios e Rede com permissões liberadas. O cliente pode alterar IP/senha localmente na espera e no menu Rede, escolhendo conexão manual ou automática; essa configuração não é enviada ao servidor. A tela Rede do cliente foi reduzida à conexão, sem registro rápido ou cópia do histórico | Testar dois computadores reais e lançamentos simultâneos pela interface; confirmar permissões de cada perfil |
| Inicialização Servidor/Cliente, teclado numérico, busca sem acentos e mesa exata | Implementados na prévia; verificações locais realizadas | Teste manual do usuário nos fluxos de trabalho habituais |
| Caixa manual avançado | Abertura, fechamento e movimentação implementados; saldo esperado inclui vendas, recebimentos e despesas em dinheiro. Responsável, terminal e observações ficam auditados, e diferença exige justificativa; smoke de conciliação aprovado | Validar o fluxo e o reflexo nos relatórios com operações reais de teste |
| Migração, desempenho e release | Build e smoke aprovados; prévia aberta com cópia isolada dos dados | Ensaio de migração/backup, medir privacidade no computador mais lento, aprovação explícita antes da release |

Não marcar as fases como concluídas apenas por esses testes locais. A validação em dois computadores e a revisão da prévia pelo usuário seguem pendentes.

O visual será sustentado por operações versionadas, fechamentos idempotentes e permissões reais, corrigindo duplicidade, submesa que não fecha e lançamento concorrente perdido em vez de apenas esconder esses defeitos.
