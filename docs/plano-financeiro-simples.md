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


### Cabeçalho estável, valores à direita e acesso do cliente

- Pesquisa, Por fornecedor/cliente e Registro compartilham a mesma barra de ações, abas e filtro. A visão agrupada usa o botão principal Pagar/Receber; não desaparece mais a barra ao trocar de aba.
- A consulta agrupada continua somando todas as pendências do fornecedor/cliente, independentemente do período. Situação e período ficam fixos em Em aberto/Todo o período nessa visão; a busca continua disponível.
- Valores ficam nas últimas colunas, à direita, e os resumos terminam com Falta pagar/Falta receber. Retirados os textos “Totais do filtro”, a nota sobre canceladas/excluídas, a instrução para selecionar linhas e o seletor “Linhas”. A paginação continua disponível quando há mais de 25 registros.
- O atalho para pendências fora do período fica junto à busca, sem criar uma faixa adicional que empurre o conteúdo. Ele limpa o período mantendo somente as contas em aberto.
- A permissão Gerenciar produtos controla criação, edição e exclusão de produtos/categorias pelo cliente sem exigir também a permissão dos ajustes operacionais. A restrição é conferida na interface e no servidor.
- Rede → Permissões oferece “Liberar acesso completo”. O servidor precisa salvar essa escolha; permissões existentes não são ampliadas automaticamente. Mesas, clientes e contas a pagar/receber continuam vinculados à permissão financeira; conexão e aparência continuam locais em cada computador.
- Verificação: compilação e testes de rede, financeiro simples e campos opcionais aprovados. No Electron, conferidos cabeçalhos em 1280 × 720 e 1024 × 600 (incluindo datas personalizadas), paginação, pagamentos agrupados, criação/edição de produto e criação de despesa pelo cliente, revogação de permissões em tempo real e o preset de acesso completo. O atalho de pendências também preservou a situação ao limpar datas.


### Ajuste dos pagamentos registrados no formulário compacto

- As colunas fixas da edição de pagamentos ultrapassavam a largura do formulário e provocavam rolagem lateral. Os campos agora usam colunas flexíveis, com observação na linha seguinte e adaptação pela largura do próprio formulário.
- O resumo e o botão Adicionar permanecem dentro da seção, inclusive quando há vários pagamentos. Mantida a rolagem vertical para chegar aos campos inferiores.
- Compilação aprovada. `qa_payable_fit.py` conferiu limites e foco dos campos em 1280, 1024 e 800 pixels e em formulário de 420 pixels. Também editou/incluiu/removeu pagamentos e conferiu a persistência dos meios, observação, R$ 115 pagos e saldo de R$ 5 numa conta de R$ 120 com dados isolados.


## Revisão visual e operacional — 29/10/2026

- [x] Pesquisa e Registro compartilham a mesma janela em Contas a Pagar/Receber.
- [x] Comandos compactos, datas visíveis, colunas separadas e totais à direita.
- [x] Caixas independentes A pagar/Pagas e A receber/Recebidas; canceladas/excluídas no menu complementar.
- [x] Produtos, Categorias, Adicionais e Clientes usam lista, comandos no topo e Registro no mesmo espaço.
- [x] Revisão de contraste, formulários compactos e pesquisa sem acentos nesses cadastros.
- [x] Histórico pelo botão direito da mesa abre na data atual.
- [x] Preservar marcação explícita de fechamento e priorizar sua cor verde.
- [x] Remover Ir para Mesas do resumo de mesas abertas.
- [x] Perfis de privacidade definidos pelo servidor: criar, duplicar, editar, excluir e associar ao Total do Dia ativado/desativado. O cliente recebe as mesmas regras e mantém a ativação local independente.
- [x] Valores no histórico sempre visíveis, somente durante pesquisa ou sempre ocultos, conforme o perfil.
- [x] Visão Geral mais compacta com indicadores e ações organizados.
- [x] Validação dos perfis, filtros combinados, cliente conectado e status de fechamento.

Ideias posteriores: atalhos de teclado configuráveis; repetir uma despesa com revisão antes de salvar; pesquisas favoritas; diagnóstico de tempo de resposta da rede. São sugestões e não fazem parte desta implementação.


Validação: compilação completa; smoke de rede, PDV, concorrência entre submesas e perfis/status; QA visual em 1024×600 e 1280×720; criação/edição, pagamentos agrupados, quatro combinações dos filtros de situação, perfil compartilhado com ativação independente e histórico exato da mesa no dia. O fechamento de Configurações aguarda ajustes pendentes para evitar perda de edições rápidas.


### Ajustes após conferência da interface — 29/10/2026

- Corrigido o zero solto no formulário de estoque: sinalizadores numéricos do cadastro agora são tratados como booleanos na interface.
- Margem interna consistente nos painéis Dados e preços / Estoque e códigos.
- Filtro principal com data de emissão/vencimento, intervalo, pesquisa e seleção de abertas/quitadas à direita. O botão Mais filtros fica antes das caixas; atalhos de período e demais situações ficam nesse menu.
- Duplicar abre um novo registro para revisão em Pagar e Receber. São copiados os dados de cadastro, sem pagamentos, identidade da venda, eventos ou parcelamento anterior. Cancelar não grava nada.
- Recibo na barra principal das duas telas. Pagar apresenta fornecedor, documento, datas, valor, pagamentos e saldo; Receber também prepara recibos de contas manuais/antigas sem venda presente no resumo operacional.
- Prévia do recibo fora do contêiner da janela gerencial, com fechamento e ações visíveis em 1024×600 e 1280×720.
- Validados cadastro duplicado e prévia pelo cliente, persistência no servidor, PDFs de 80 mm/A4, smoke de PDV e rede.
