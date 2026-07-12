# Objetivo atual — Contabilizador Caixa com PDV integrado

Este documento define o objetivo atual do projeto. A ideia principal não mudou: transformar o Contabilizador Caixa em um sistema local de caixa e PDV mais completo, simples, rápido e confiável, inspirado no fluxo do DataCaixa, mas sem transformá-lo em um sistema de estoque, fiscal ou ERP.

## Plano de estabilização atual

Este plano é a referência para concluir as correções solicitadas após as fases iniciais do remake.

Uma funcionalidade somente deve ser marcada como concluída quando o fluxo real estiver consistente e validado, e não apenas porque a tela, o botão ou parte da estrutura foi criada.

## Regras de execução

* Trabalhar uma fase por vez.
* Antes de implementar qualquer correção, verificar se a função já existe e testar o comportamento atual.
* Não recriar telas, bancos, componentes ou fluxos que já estejam funcionando corretamente.
* Corrigir primeiro problemas financeiros, persistência de dados e integridade das operações.
* Deixar ajustes exclusivamente visuais para depois das correções funcionais.
* Preservar compatibilidade com os dados e funcionalidades existentes.
* Criar e validar um backup antes de qualquer migração, limpeza de importação, alteração estrutural no SQLite ou transformação de dados.
* Comparar os fluxos atuais com versões anteriores funcionais e restaurar recursos que tenham sido removidos ou quebrados.
* Ao terminar cada fase, registrar:

  * o que foi concluído;
  * o que ficou parcial;
  * o que depende de validação manual;
  * quais regressões ainda existem.
* Nenhuma fase deve ser considerada concluída enquanto houver regressão conhecida em uma função que já funcionava anteriormente.
* Não gerar build, commit, push ou release enquanto a fase atual apresentar regressões conhecidas.

## Mapa de estado atual

Os itens abaixo já possuem uma base implementada no projeto e devem ser preservados. Eles ainda podem receber correções e melhorias, mas não devem ser substituídos por outra implementação sem necessidade comprovada.

* Banco SQLite do PDV, sistema de backups e integração básica com vendas.
* Fluxo principal das abas Venda, Mesas, Histórico, Relatórios, Rede e Ajuste.
* Venda direta e Mesas utilizando a mesma base de vendas.
* Pagamentos múltiplos e exportação integrada para Excel.
* Cliente remoto com bloqueio de alterações operacionais controladas pelo servidor.
* Importação Cose com Coca Mini, prévia da importação e proteção de produtos manuais.
* Complementos vinculados individualmente por produto.
* Transferência parcial de itens.
* Fechamento parcial com estados de itens pagos, ainda sujeito à validação completa do fluxo.
* Notificações com duração configurável no aplicativo principal.
* Proteção ao sair da aba Venda com carrinho aberto.

Os itens abaixo são considerados parciais até serem verificados no uso real.

* Produtos vendidos por peso e edição do valor final.
* Foco inicial, Enter, Esc, setas, Tab e atalhos dos modais.
* Submesas e separação entre mesa principal e submesas.
* Sincronização de mesa aberta entre cliente e servidor.
* Responsividade dos modais e dos cards de produtos.
* Histórico, Relatórios e Excel para Mesas, fechamentos parciais e pagamentos mistos.
* Temas claro, escuro, DataCaixa e DataCaixa escuro, incluindo contraste de todos os estados.
* Redimensionamento persistente das áreas de categorias, produtos, carrinho e painel lateral.

## Fase A — Venda, peso e carrinho

* Manter a aba Venda completamente pronta para novos lançamentos após finalizar uma venda.
* Após concluir uma venda, limpar somente os dados da operação finalizada.
* Manter categorias, produtos, pesquisa, botões, painel de totais e demais controles carregados e funcionais.
* Corrigir o problema em que, após finalizar uma venda, os produtos ou controles da tela desaparecem e impedem novos lançamentos.
* Ao tentar sair da aba Venda com produtos ainda não finalizados no carrinho, exibir um modal de confirmação.
* Informar claramente que sair da Venda apagará os produtos da operação atual.
* Oferecer as opções:

  * Continuar na venda;
  * Sair e cancelar a venda.
* Limpar o carrinho somente quando o usuário confirmar explicitamente o cancelamento.
* Limpar automaticamente a pesquisa após lançar um produto.
* Selecionar automaticamente o último item lançado.
* Rolar o carrinho automaticamente até o último produto lançado.
* Ao navegar pelo carrinho usando as setas, manter o item selecionado sempre visível.
* Caso a seleção saia da área visível, rolar automaticamente a lista até o item selecionado.
* Eliminar a duplicação eventual do último produto lançado.
* Remover o ícone de lixeira redundante ao lado do carrinho, pois já existe um botão específico para cancelar a venda.
* Permitir desconto sobre o total da venda utilizando o mesmo padrão de modal existente no fluxo de Mesas.
* Manter a altura e o alinhamento da barra superior ao mostrar ou ocultar o total do dia.
* O valor exibido e o texto “Privado” devem ocupar uma área reservada de tamanho fixo, evitando que a barra aumente ou diminua de tamanho.

### Produtos vendidos por peso

* Fazer o valor final informado manualmente prevalecer sempre.
* Utilizar o peso em gramas ou quilogramas somente como informação de apoio.
* Se o usuário informar que o valor final do produto é R$ 2,00, o lançamento deve ser exatamente de R$ 2,00.
* Não recalcular o valor final para R$ 2,04, R$ 1,99 ou qualquer outro valor.
* Aplicar alteração de preço e desconto sobre o valor final do produto.
* Nunca aplicar alteração de preço ou desconto diretamente sobre o peso ou a quantidade em gramas.
* Corrigir casos em que a edição de preço mostra ou altera o valor do quilograma em vez do valor final que será lançado.
* Confirmar e lançar produtos vendidos por peso ou valor pressionando Enter.
* O Enter deve funcionar imediatamente ao abrir o modal, sem exigir clique prévio.

## Fase B — Mesas, submesas e lançamento avulso

### Lançamento avulso

* Exibir o lançamento avulso apenas como um botão `+`.
* Não exibir o texto “Avulso — Registrar valor sem produto”.
* Utilizar o mesmo padrão visual e a mesma cor de fundo das mesas livres.
* Posicionar o botão `+` após a última mesa configurada.
* Ao clicar no botão `+`, abrir diretamente o fluxo de registro de valor manual sem produto.

### Mesas e submesas

* Separar efetivamente os itens da mesa principal e de cada submesa.
* Cada submesa deve exibir somente os produtos lançados dentro dela.
* Ao criar ou acessar uma submesa vazia, não exibir produtos da mesa principal.
* Trocar de submesa não pode esconder, apagar, duplicar, substituir ou misturar os itens da mesa principal.
* Manter todos os itens persistidos corretamente ao alternar entre mesa principal e submesas.
* Exibir uma versão resumida da observação diretamente na grade de mesas.
* Permitir identificar a mesa pela observação sem precisar abri-la.
* Reduzir ou adaptar a fonte dos nomes e observações quando necessário.
* Impedir sobreposição entre nome da mesa, observação, status e demais informações.
* Usar truncamento controlado ou quebra adequada quando o texto for muito longo.
* Desabilitar o botão Cancelar quando a mesa estiver vazia.
* Não destacar Cancelar como uma ação disponível quando não houver itens na mesa.
* Após transferir uma mesa, abrir automaticamente a mesa de destino.
* Exemplo: ao transferir a Mesa 20 para a Mesa 2, abrir a Mesa 2 após concluir a operação.
* Manter os modos Mesa, Avulso e Ônibus configuráveis e consistentes.
* Permitir definir um modo padrão nas configurações.
* Permitir alterar o modo diretamente durante o uso da mesa, quando aplicável.

## Fase C — Fechamento parcial e pagamentos

### Persistência do fechamento parcial

* Persistir corretamente:

  * itens pagos;
  * valores pagos;
  * forma de pagamento;
  * descrição do pagamento;
  * mesa;
  * submesa;
  * identificador da operação;
  * data e horário;
  * estado de cada item.
* Após um pagamento parcial, marcar os produtos pagos de forma visível.
* Impedir que itens já pagos sejam selecionados novamente.
* Calcular os próximos fechamentos parciais considerando somente os itens pendentes.
* Manter os pagamentos registrados ao sair e entrar novamente na mesa.
* Preservar a seleção pendente até que o usuário:

  * conclua o pagamento;
  * cancele a operação;
  * limpe manualmente a seleção.
* Não perder a seleção apenas por retornar à tela anterior ou adicionar novos produtos.

### Navegação e atalhos

* Definir o foco inicial em Fechar total ao abrir o menu de fechamento.
* Permitir navegar pelas opções usando as setas.
* Usar Enter para entrar na opção selecionada.
* Usar Enter para confirmar valores e avançar pelas etapas.
* Usar Esc para retornar à etapa anterior.
* Ao retornar com Esc, preservar dados e seleções ainda não concluídos.
* Garantir que Enter, Esc, Tab, setas e atalhos funcionem imediatamente ao abrir o modal.
* Não exigir que o usuário clique dentro do modal para ativar os atalhos.
* Mapear:

  * F1 para Débito;
  * F2 para Crédito;
  * F3 para Pix;
  * F4 para Dinheiro.
* Exibir as dicas de atalhos somente quando o usuário passar o mouse sobre os respectivos botões.
* Não manter as indicações de teclas ocupando espaço permanentemente na interface.

### Confirmação de segurança

* Ao pressionar Enter na etapa final do fechamento, não concluir imediatamente a operação.
* Exibir uma confirmação de segurança antes de finalizar o pagamento ou fechamento.
* Permitir confirmar definitivamente pressionando Enter novamente.
* Permitir cancelar ou retornar usando Esc.
* Evitar fechamentos acidentais causados por pressionamento involuntário de teclas.

### Pagamentos e divisão

* Reduzir e reorganizar os ícones de editar e remover pagamentos.
* Posicionar o ícone de remover de forma discreta, preferencialmente abaixo do ícone de editar ou em tamanho menor.
* Não utilizar um ícone de lixeira excessivamente grande.
* Corrigir o cálculo de aproximação da divisão por pessoas.
* Expor as opções:

  * sem aproximação;
  * aproximação em R$ 0,25;
  * aproximação em R$ 0,50;
  * valor personalizado.
* Garantir que o valor aproximado e a diferença gerada sejam exibidos de forma clara.
* Manter pagamentos separados por forma de pagamento durante o fechamento.

## Fase D — Cliente, servidor e sincronização

* Garantir que a aba Venda apareça no cliente PDV em qualquer resolução.
* Testar especialmente resoluções menores, como 1366×768.
* Remover a antiga barra de venda quando o cliente estiver conectado no modo PDV.
* Não exibir apenas a mensagem de conexão mantendo a barra antiga ativa.
* Aplicar em tempo real as regras definidas pelo servidor.
* Impedir que o cliente altere:

  * produtos;
  * preços;
  * complementos;
  * regras financeiras;
  * configurações operacionais;
  * importações;
  * configurações globais.
* Permitir ao cliente somente preferências visuais locais autorizadas, como:

  * resolução;
  * tamanho dos elementos;
  * densidade;
  * quantidade de mesas ou produtos por linha;
  * dimensões das áreas da interface.
* Sincronizar alterações de uma mesa mesmo quando ela estiver aberta.
* Exemplo: se o servidor lançar um produto em uma mesa aberta no cliente, o cliente deve visualizar a alteração sem sair e reabrir a mesa.
* Não sobrescrever automaticamente uma edição local ainda não concluída.
* Criar controle de versão, bloqueio temporário ou aviso de conflito quando servidor e cliente alterarem a mesma mesa.
* Definir uma política segura para queda de rede.
* Permitir ao servidor escolher entre:

  * bloquear completamente as operações do cliente até a conexão voltar;
  * utilizar uma fila offline controlada e sincronizada posteriormente.
* Não permitir operação offline sem controle, pois isso pode gerar vendas duplicadas, perda de dados ou conflitos.

## Fase E — Produtos, importação e complementos

### Produtos e categorias

* Corrigir cards de produtos com nomes longos.
* Manter nome e preço em áreas separadas.
* Fixar o preço em uma região própria do card.
* Impedir que palavras do nome fiquem sobre o preço.
* Não resolver o problema apenas aumentando indefinidamente a altura do card.
* Utilizar quebra controlada, truncamento e tooltip quando necessário.
* Corrigir também textos longos em:

  * categorias;
  * filtros;
  * área de pesquisa;
  * títulos;
  * botões.
* Impedir que o nome da categoria ultrapasse o espaço disponível.
* Organizar os produtos automaticamente em ordem alfabética.
* Usar A–Z como padrão.
* Permitir selecionar Z–A como configuração global.
* Remover a opção de ordenação manual do cadastro individual do produto.

### Importação Cose

* Corrigir o contraste da prévia de importação da Cose.
* Corrigir especificamente o texto “Confira a informação”, evitando texto branco sobre fundo branco.
* Garantir contraste adequado em temas claro e escuro.
* Corrigir a remoção e a reimportação da lista da Cose.
* Preservar produtos criados manualmente.
* Preservar ou reconstruir corretamente os vínculos de complementos.
* Evitar duplicação de produtos após reimportar.
* Manter Coca Mini por R$ 5,00 no preset da importação.

### Complementos

* Revisar os complementos permitidos por produto.
* Não liberar adicionais genéricos para todos os produtos.
* Cada adicional deve aparecer somente nos produtos aos quais estiver vinculado.
* Preservar os vínculos corretos ao remover, atualizar ou reimportar produtos.

## Fase F — Interface, redimensionamento e acessibilidade

### Redimensionamento

* Restaurar os redimensionadores das áreas de:

  * categorias;
  * produtos;
  * carrinho;
  * painel de fechamento à direita;
  * proporção entre categorias, produtos e lista de itens.
* Permitir redimensionamento horizontal e vertical quando fizer sentido.
* Respeitar limites mínimos e máximos seguros.
* Impedir que uma área fique pequena demais para ser utilizada.
* Salvar os tamanhos por usuário.
* No cliente, salvar somente preferências visuais permitidas.
* Não permitir que preferências visuais do cliente alterem o servidor.
* Permitir configurar a densidade visual.
* Permitir configurar a quantidade de produtos por linha.
* Permitir ajustar o carrinho para exibir uma quantidade aproximada de itens, como dez produtos visíveis, de acordo com a resolução e o tamanho definido pelo usuário.

### Modais e responsividade

* Corrigir altura, largura, rolagem e contraste dos modais de:

  * produtos;
  * peso;
  * pagamento;
  * fechamento;
  * cancelamento;
  * importação.
* Garantir que os modais de peso e pagamento caibam completamente em telas 1366×768.
* Usar rolagem interna quando o conteúdo ultrapassar o espaço disponível.
* Não exigir que o usuário role ou arraste a página inteira para visualizar o modal.
* Garantir que listas extensas de produtos possam ser roladas até o fim.
* Corrigir o modal de cancelamento no tema escuro.
* A lista de produtos deve acompanhar corretamente o tema do restante do modal.
* Evitar listas escuras dentro de modais claros e textos claros sobre fundos claros.
* Corrigir o campo Qtde. no tema escuro.
* O valor da quantidade não pode aparecer preto sobre fundo preto.

### Navegação e notificações

* Revisar Tab, Enter, Esc, setas e foco inicial em todos os modais importantes.
* Definir uma ordem lógica de navegação por Tab.
* Destacar visualmente o elemento atualmente focado.
* Padronizar as notificações do PDV, aplicativo principal e componentes antigos ainda utilizados.
* Fazer as notificações desaparecerem automaticamente.
* Criar uma configuração global de duração das notificações.
* Aplicar o mesmo padrão visual e de tempo de exibição em todo o sistema.

## Fase G — Histórico, relatórios, regressão e entrega

### Histórico e filtros

* Permitir buscar por:

  * descrição do pagamento;
  * número ou nome da mesa;
  * submesa;
  * valor exato;
  * faixa de valores;
  * forma de pagamento;
  * data;
  * status;
  * outras informações já registradas.
* Permitir pesquisas como:

  * “Mesa 3”;
  * vendas de R$ 120,00;
  * vendas entre R$ 100,00 e R$ 150,00;
  * pagamentos com determinada descrição;
  * pagamentos realizados em Débito ou Pix.

### Relatórios e Excel

* Garantir que Venda, Mesa, Submesa, fechamento parcial e pagamentos mistos alimentem corretamente:

  * Histórico;
  * Relatórios;
  * exportação Excel.
* Separar Débito, Crédito, Pix e Dinheiro nos relatórios.
* Não consolidar automaticamente todas as operações com múltiplas formas como apenas “Misto”.
* Registrar cada pagamento individualmente, mantendo também o vínculo com a venda ou mesa completa.
* Validar cancelamentos, edições, transferências e pagamentos parciais.
* Impedir duplicação de registros e valores.
* Garantir que alterações sejam refletidas corretamente nos totais.

### Regressão e validação final

* Comparar os principais fluxos atuais com versões anteriores que funcionavam corretamente.
* Restaurar funcionalidades removidas ou quebradas durante alterações recentes.
* Testar todos os fluxos financeiros no servidor e no cliente.
* Testar:

  * venda direta;
  * venda por peso;
  * alteração de preço;
  * descontos;
  * carrinho;
  * mesa principal;
  * submesa;
  * transferência;
  * transferência parcial;
  * fechamento total;
  * fechamento parcial;
  * pagamentos múltiplos;
  * divisão por pessoas;
  * aproximação;
  * cancelamentos;
  * Histórico;
  * Relatórios;
  * Excel;
  * sincronização;
  * queda e retorno da rede.
* Testar nas resoluções:

  * 1366×768;
  * 1920×1080.
* Revisar os temas:

  * claro;
  * escuro;
  * DataCaixa;
  * DataCaixa escuro;
  * demais temas ativos no projeto.
* Validar contraste, foco, rolagem, atalhos e responsividade em todos os temas.
* Criar e validar backup antes de qualquer migração final.
* Somente depois da validação completa:

  * gerar o build;
  * testar o executável gerado;
  * criar o commit;
  * realizar o push;
  * criar a nova release.
* Não publicar uma release enquanto existir regressão conhecida em fluxo financeiro, persistência, sincronização, Histórico, Relatórios ou Excel.
