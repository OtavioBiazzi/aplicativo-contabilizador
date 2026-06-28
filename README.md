# Contabilizador Caixa

Aplicativo desktop para registrar vendas, mesas, onibus, pagamentos em dinheiro, troco, divisoes de conta, estornos, extras e lancamentos personalizados com exportacao automatica para Excel ou CSV.

Esta primeira versao foi pensada para uso diario em caixa: abrir, digitar valor, descrever a mesa/cliente/onibus, registrar e manter o arquivo do dia sempre atualizado.

## Stack escolhida

- **Electron**: melhor encaixe para app desktop real, janela sempre visivel, acesso a arquivos locais, dialogos de pasta e empacotamento Windows.
- **React + Vite + TypeScript**: interface rapida, componentizada e facil de evoluir.
- **ExcelJS + CSV nativo**: geracao local de planilhas `.xlsx` e `.csv`.
- **Express + WebSocket**: servidor local com senha para outro computador na mesma rede visualizar ou registrar lancamentos.
- **JSON local como fonte confiavel**: os arquivos Excel/CSV sao exportacoes; o historico principal fica salvo localmente para reduzir risco de perda.

## Funcionalidades implementadas

- Registro rapido com valor, descricao, tipo, pessoas, mesa, onibus, pagamento e observacoes.
- Descricao automatica como `Venda` quando o campo fica vazio.
- Modos de lancamento: Venda, Mesa, Onibus, Dinheiro/Troco, Divisao de conta, Taxa, Extra, Cancelado/Estorno e Personalizado.
- Divisao de conta com arredondamento por multiplos de R$ 0,05 a R$ 5,00 e direcao para cima, para baixo ou mais proxima.
- Modo dinheiro/troco com quebra em notas e moedas do real.
- Historico editavel com filtros, duplicar, cancelar e remover sem apagar fisicamente do historico interno.
- Relatorios por periodo com total geral, total por tipo, mesa, onibus, forma de pagamento, media, maior venda e sobras.
- Exportacao automatica para Excel ou CSV.
- Organizacao dos arquivos por dia, mes com abas, arquivo fixo ou arquivos separados por tipo.
- Configuracoes persistentes: tema, cor principal, densidade, layout, campos do modo fixado, colunas do arquivo, pasta padrao, formato, backup e padroes de lancamento.
- Modo fixado/flutuante em janela separada, sem borda de aplicativo, com barra rapida sempre visivel.
- Barra fixada com alternancia Conta/Dinheiro, seletor de tipo, Mesa/Onibus contextual, divisao por pessoas, campo Pago com e troco direto na barra.
- Planilha simples por padrao com Data, Hora, Valor pago, Descricao, Tipo, Pessoas, Pago com, Troco e linha TOTAL.
- Lancamentos removidos deixam de aparecer na exportacao Excel/CSV.
- Servidor local com senha, permissoes e atualizacao em tempo real via WebSocket.
- Smoke test da interface com Playwright.

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

Quando backup automatico estiver ativo, arquivos existentes sao copiados para a subpasta `backups/` antes da nova exportacao.

## Servidor local

1. Abra a aba **Servidor**.
2. Defina porta e senha.
3. Escolha permissoes: visualizar, registrar, editar ou apagar.
4. Clique em **Abrir servidor**.
5. Em outro computador da mesma rede, abra o endereco mostrado pelo app.

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
- Remover lancamentos marca o item como removido; o historico interno preserva o registro.
- Se a exportacao falhar, o lancamento continua salvo no JSON local e a exportacao fica pendente para nova tentativa.
