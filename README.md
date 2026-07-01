# Contabilizador Caixa

Aplicativo desktop para registrar vendas, mesas, onibus, pagamentos em dinheiro, troco, divisoes de conta, estornos, extras e lancamentos personalizados com exportacao automatica para Excel ou CSV.

Esta primeira versao foi pensada para uso diario em caixa: abrir, digitar valor, descrever a mesa/cliente/onibus, registrar e manter o arquivo do dia sempre atualizado.

## Plano de remake

O roadmap de redesign e evolucao do app esta em [`docs/plano-remake.md`](docs/plano-remake.md). Ele organiza barra fixada, temas, relatorios, configuracoes, servidor, permissoes, icone, atualizacoes e qualidade em fases testaveis.

## Stack escolhida

- **Electron**: melhor encaixe para app desktop real, janela sempre visivel, acesso a arquivos locais, dialogos de pasta e empacotamento Windows.
- **React + Vite + TypeScript**: interface rapida, componentizada e facil de evoluir.
- **XLSX local + CSV nativo**: geracao local de planilhas `.xlsx` e `.csv`, sem depender de Excel aberto.
- **Express + WebSocket**: servidor local com senha para outro computador na mesma rede visualizar ou registrar lancamentos.
- **JSON local como fonte confiavel**: os arquivos Excel/CSV sao exportacoes; o historico principal fica salvo localmente para reduzir risco de perda.

## Funcionalidades implementadas

- Registro rapido com valor, descricao, tipo, pessoas, mesa, onibus, pagamento e observacoes.
- Descricao automatica como `Venda` quando o campo fica vazio.
- Modos de lancamento: Venda, Mesa, Onibus, Dinheiro/Troco, Divisao de conta, Taxa, Extra, Cancelado/Estorno e Personalizado.
- Divisao de conta com arredondamento por multiplos de R$ 0,05 a R$ 5,00 e direcao para cima, para baixo ou mais proxima.
- Divisao de conta com aviso opcional de quanto sera cobrado a mais ou a menos quando o arredondamento alterar o total.
- Modo dinheiro/troco com quebra em notas e moedas do real.
- Historico editavel com filtros, duplicar, cancelar, lixeira, restauracao e exclusao definitiva.
- Relatorios por periodo iniciando no mes atual, com filtros por tipo, mesa, onibus, forma de pagamento e busca, fechamento, tendencia diaria com dia da semana, ranking, alertas, origem/caixa e exportacao do recorte filtrado.
- Exportacao automatica para Excel ou CSV, com XLSX formatado, cabecalho, filtro, congelamento da primeira linha, larguras ajustadas e linha TOTAL com formulas.
- Organizacao dos arquivos por dia real do lancamento, mes com abas, arquivo fixo ou arquivos separados por tipo.
- Importacao de planilhas Excel/CSV/TSV compativeis com previa, confirmacao e deduplicacao por ID ou assinatura do lancamento.
- Importacao de pasta inteira com varias planilhas `.xlsx`, `.csv` e `.tsv`, incluindo varios dias de movimento.
- Diagnostico em **Ajustes > Avancado** com pasta de dados, pasta de planilhas, estado da exportacao, ultimos eventos e backups recentes.
- Backup local do caixa em JSON, com historico e configuracoes, mais restauracao segura criando backup do estado atual antes de substituir dados.
- Configuracoes persistentes: tema padrao DataCaixa PDV, DataCaixa escuro, cor principal, densidade, layout, abas rapidas, campos do modo fixado, mesa/onibus ativaveis separadamente, colunas do arquivo, pasta padrao, formato, backup e padroes de lancamento.
- Perfis de configuracao para alternar rapidamente entre PC, Notebook, tela pequena, fixado e perfis personalizados, sem trocar pasta de arquivos, planilha ou servidor.
- Criacao de perfil por campo proprio dentro dos ajustes, com aplicacao real de tema, densidade, padroes e barra fixada.
- Exportacao e importacao de configuracoes em JSON, com importacao em rascunho antes de aplicar.
- Modo fixado/flutuante em janela separada, sem borda de aplicativo, com barra rapida sempre visivel.
- Barra fixada com abas rapidas configuraveis, alternancia Conta/Dinheiro, seletor de tipo, campos Mesa e Onibus separados, divisao por pessoas, campo Pago com, troco direto e elementos que podem ser ocultados.
- Alternancia Conta/Dinheiro pode manter o contexto atual: Conta Onibus vira Dinheiro/Onibus e volta para Onibus.
- Presets da barra fixada: Caixa completo, Mesa rapida, Onibus enxuto, Dinheiro e troco e Minimalista, todos editaveis depois.
- Presets da barra fixada ajustam apenas a barra, sem alterar fonte, densidade ou layout global do aplicativo.
- Editor de abas rapidas nos ajustes para ativar, renomear, escolher modo, vincular Dinheiro/Troco e reordenar a barra fixada.
- Barra fixada com tema proprio opcional, seguindo o tema principal por padrao, transparencia corrigida, limite minimo menor para notebooks e arraste apenas pela alca de tres pontos.
- Barra fixada entra em modo baixo automaticamente quando a janela e reduzida, escondendo rotulos e compactando botoes/campos para ocupar menos altura.
- Temas DataCaixa PDV, DataCaixa PDV escuro e Italia como base do remake visual, com contraste revisado em menus e hovers.
- Modo Dinheiro/Troco aceita registro com apenas valor e permite vincular o pagamento a Mesa, Balcao/Venda, Onibus, Extra ou Personalizado.
- Historico com lixeira, restauracao e exclusao definitiva.
- Planilha simples por padrao com Data, Hora, Valor pago, Descricao, Tipo, Pessoas, Pago com, Troco e linha TOTAL por formula.
- Lancamentos removidos deixam de aparecer na exportacao Excel/CSV.
- Total do dia, painel lateral e servidor local somam somente lancamentos do dia atual.
- Servidor local com senha, permissoes, cliente remoto dentro do proprio app, mini-caixa web em estilo DataCaixa, cadastro remoto, edicao, cancelamento, lixeira, origem do dispositivo e atualizacao em tempo real via WebSocket.
- Cliente remoto obedece o contrato do servidor: modos permitidos, campos visiveis, mesa/onibus, pagamento e descricao seguem o computador principal para nao mudar o formato do Excel.
- O modo operacional do cliente e independente por maquina: um PC pode registrar Onibus enquanto outro fica em Mesa ou Dinheiro, desde que esses modos estejam permitidos pelo servidor.
- Permissoes, campos da barra e modos permitidos mudam em tempo real nos clientes conectados, incluindo a barra fixada aberta.
- Cliente remoto volta automaticamente para modo local quando o servidor e desligado ou a conexao cai.
- Permissao opcional para o servidor liberar acesso local completo do cliente a aparencia, vendas, perfis, barra fixada e barra rapida, sem liberar planilha, backup, servidor, avancado ou contrato do Excel.
- Relatorios no cliente remoto respeitam as permissoes do servidor: sem permissao de totais, o cliente nao recalcula valores mesmo mudando periodo.
- Modo leve para clientes remotos: o app cliente carrega os lancamentos recentes e metadados de contagem, reduzindo trafego e memoria em PCs mais fracos.
- Historico local renderiza em blocos com **Mostrar mais**, evitando tabelas gigantes na tela de uma vez.
- Relatorios usam calculos memorizados e busca suavizada para manter a interface responsiva com historico maior.
- Navegacao em estilo PDV por modulos: Caixa, Historico, Relatorios, Rede e Ajustes.
- Marca CDA no topo esquerdo do aplicativo usando o icone real do projeto.
- Configuracoes por categorias: Aparencia, Barra fixada, Barra rapida, Vendas, Planilha, Relatorios, Servidor, Atalhos, Atualizacoes e Avancado.
- Categoria Perfis para aplicar, atualizar, criar e remover perfis sem mexer nos dados de venda.
- Tela de configuracoes com cabecalho por categoria, presets operacionais e layout mais controlado para monitores grandes.
- Cabecalho principal contextual por aba, separando operacao de caixa, historico, relatorios, rede e ajustes.
- Privacidade local para ocultar total do topo/painel e abrir relatorios com totais escondidos sem apagar valores.
- Permissoes remotas separadas para ver valores de vendas e ver totais sensiveis no servidor.
- Aba Rede com criador de servidor, instrucoes de conexao para outro PC e permissoes separadas.
- Checagem de releases pela area de Atualizacoes, com botao para baixar, fechar, instalar e abrir o app de novo sem abrir o GitHub nem janela de terminal.
- Icone do aplicativo em `assets/icon/`, configurado para instalador, janela e atalhos.
- Smoke test da interface com Playwright, cobrindo previa de importacao, backup/restauracao, deduplicacao, barra fixada, preset Onibus enxuto, relatorios profissionais, servidor e planilha.

## Requisitos

- Node.js 22 ou superior.
- npm 10 ou superior.
- Windows recomendado para gerar instalador `.exe` com Electron Builder.

## Instalar

```bash
npm install
```

## Rodar em desenvolvimento

```bash
npm run dev
```

Esse comando inicia o Vite, compila o processo principal do Electron em modo watch e abre o aplicativo desktop.

## Build de producao

```bash
npm run build
```

O build gera:

- `dist/`: interface React compilada.
- `dist-electron/`: processo principal e preload do Electron compilados.

## Gerar aplicativo instalavel

```bash
npm run dist
```

Os instaladores ficam em `release/`.

## Usar o app

1. Abra o app.
2. Digite o valor principal.
3. Escolha o tipo de lancamento ou deixe como `Venda`.
4. Preencha descricao, mesa, onibus ou dados de pagamento quando precisar.
5. Clique em **Registrar**.

Atalhos principais:

- `Enter`: registrar.
- `Ctrl + D`: modo Dinheiro/Troco.
- `Ctrl + M`: modo Mesa.
- `Ctrl + O`: modo Onibus.
- `Ctrl + F`: abrir/fechar barra fixada.
- `Ctrl + H`: historico.
- `Ctrl + ,`: configuracoes.
- `Ctrl + R`: repetir ultimo lancamento.

Os atalhos podem ser alterados ou desativados em **Ajustes > Atalhos**: clique no comando, pressione a nova combinacao ou use **Desativar**.

## Arquivos locais

O app salva dados internos no diretorio de dados do Electron do usuario e exporta planilhas para a pasta configurada em **Configuracoes > Arquivos**.

Por padrao, a pasta de exportacao e:

```text
Documentos/Contabilizador Caixa
```

Exemplos de arquivos:

```text
vendas-2026-06-28.xlsx
caixa-2026-06.xlsx
caixa-geral.csv
venda-2026-06-28.xlsx
onibus-2026-06-28.xlsx
```

Em **Ajustes > Planilha e backup**, use **Importar Excel/CSV** para trazer planilhas antigas compativeis para o historico do app. Antes de gravar, o app mostra uma previa com linhas novas, duplicadas, ignoradas, avisos e uma amostra dos lancamentos. Linhas `TOTAL` sao ignoradas e lancamentos repetidos sao pulados automaticamente.

Use **Importar pasta** para apontar uma pasta com varios arquivos de dias diferentes. O app procura `.xlsx`, `.csv` e `.tsv`, pula duplicados e atualiza o historico local.

Na mesma area, **Gerar/abrir arquivo** forca uma nova exportacao e abre a pasta no arquivo atual do dia, mes ou modo configurado. Se o Excel estiver segurando o arquivo aberto, o lancamento permanece salvo no banco local e a exportacao fica pendente para uma nova tentativa.

Quando backup automatico estiver ativo, arquivos existentes sao copiados para a subpasta `backups/` antes da nova exportacao. O backup interno do caixa fica em **Ajustes > Avancado** e salva o JSON principal do app para restauracao futura.

## Servidor local

1. Abra a aba **Rede**.
2. Use **Criar servidor** para definir porta e senha.
3. Em **Permissoes**, escolha visualizar, registrar, editar, apagar, ver totais vendidos e, se quiser, liberar o acesso local completo do cliente.
4. Clique em **Abrir servidor**.
5. Em outro computador da mesma rede, abra o endereco mostrado pelo app ou use a subaba **Conectar** para montar o link.
6. Para usar outro PC com o proprio aplicativo, abra **Rede > Conectar**, informe endereco, senha e nome do caixa, e clique em **Conectar no app**.

No modo cliente, a aparencia local continua podendo ser ajustada, mas o resultado enviado para o Excel segue o computador principal. Se o servidor esconder descricao, tipo, mesa, onibus, pagamento ou outro campo da barra, o cliente tambem nao envia esse campo. A barra fixada do cliente usa a mesma sessao remota e manda os lancamentos para o caixa principal.

Cada computador escolhe seu modo de trabalho localmente. Por exemplo, o servidor pode estar atendendo Mesa, um cliente pode registrar Onibus e outro pode usar Dinheiro/Troco ao mesmo tempo. O servidor so limita quais modos e campos sao aceitos para manter a planilha consistente.

Mudancas de permissoes, campos da barra e modos permitidos sao enviadas em tempo real para os clientes conectados. Se o servidor ocultar Mesa, Onibus, pagamento, descricao ou totais vendidos, a tela principal, a barra fixada e os relatorios do cliente atualizam sem reiniciar.

Se a permissao **Acesso local completo do cliente** estiver ativada, o cliente pode ajustar aparencia, vendas, perfis, barra fixada e barra rapida para caber melhor naquele PC. Mesmo assim, o servidor continua mandando nas regras que afetam a planilha: modos permitidos, campos aceitos, mesa/onibus, pagamento, descricao, arquivos, backup, servidor, avancado e permissoes sensiveis.

Para PCs mais fracos, o cliente remoto trabalha em modo leve por padrao: baixa os lancamentos mais recentes para historico/operacao e recebe do servidor a contagem do dia e os totais permitidos. O computador servidor continua mantendo o historico completo e a planilha principal.

Enquanto conectado como cliente, os ajustes que mudam planilha, backup, servidor e avancado ficam somente leitura. Sem a permissao de acesso local completo, Vendas, Perfis, Barra fixada e Barra rapida tambem ficam travados. O usuario ainda consegue ver essas telas; ao clicar nelas, o app avisa que so o computador servidor pode editar. Ao desconectar, ou se o servidor for desligado, as configuracoes locais daquele PC voltam a ser editaveis normalmente.

Quando este computador esta com o servidor aberto, a opcao **Conectar** fica desativada ate o servidor ser desligado. Assim o mesmo app nao tenta ser caixa principal e cliente de outro caixa ao mesmo tempo.

Se o servidor estiver desligado, o aplicativo continua funcionando normalmente no computador principal.

## Smoke test

O teste visual usa Playwright com uma ponte Electron simulada.

```bash
python -m pip install playwright
python -m playwright install chromium
python scripts/smoke_playwright.py
```

No desenvolvimento local deste projeto, o teste abre o Electron real via porta de depuracao e validou:

- carregamento da tela principal;
- registro de uma venda;
- aparicao no historico;
- abertura dos relatorios;
- filtros mensais padrao, dia da semana e origem/caixa nos relatorios;
- marca CDA no topo e cabecalho da categoria de ajustes;
- categoria Perfis e API de exportar/importar configuracoes;
- barra fixada com troca de modo e troco;
- elementos configuraveis da barra fixada;
- barra fixada compacta em 76px de altura com controles principais visiveis;
- importacao CSV e XLSX com deduplicacao;
- hover legivel no tema DataCaixa;
- total de hoje sem somar lancamentos de ontem;
- exportacao diaria separada pela data real do lancamento;
- cliente remoto dentro do app, mini-caixa web, totais mascarados, permissao em tempo real, payload remoto limitado, modo operacional independente, registro, edicao, cancelamento e lixeira;
- desconexao automatica do cliente quando o servidor para e permissao de acesso local completo liberada pelo servidor;
- XLSX com estilo, filtro e formula de total;
- ausencia de erros de console.

## Estrutura

```text
electron/
  main.ts          Processo principal, janela, IPC e comandos nativos
  preload.ts       Ponte segura exposta ao React
  storage.ts       JSON local e operacoes de lancamento
  exporter.ts      Exportacao Excel/CSV e backups
  localServer.ts   Servidor HTTP/WebSocket local
src/
  App.tsx          Interface principal
  main.tsx         Bootstrap React
  shared/          Tipos, defaults e calculos reutilizaveis
  styles/          CSS da aplicacao
scripts/
  smoke_playwright.py
```

## Observacoes de seguranca

- O servidor local exige senha.
- A senha e configuravel pelo usuario.
- O app usa `contextIsolation` no Electron e expõe ao renderer somente uma API controlada pelo preload.
- A permissao **Ver totais vendidos** mascara valores monetarios na API remota quando desativada.
- Remover lancamentos envia o item para a lixeira; apagar definitivo remove do historico local.
- Se a exportacao falhar, o lancamento continua salvo no JSON local e a exportacao fica pendente para nova tentativa.
- Avisos do Windows SmartScreen/antivirus so reduzem de forma consistente com assinatura de codigo por certificado confiavel; o app ja define nome, icone e metadados do instalador.
