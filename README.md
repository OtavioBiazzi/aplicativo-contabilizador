# Caixa PDV

Aplicativo desktop para Windows de caixa/PDV local, feito para bares, restaurantes e pequenos comércios que trabalham com **mesas, comandas e vários computadores na mesma rede**. Tudo funciona offline, sem mensalidade e sem depender de nuvem.

> Versão atual: **0.4.20** · [Baixar na página de Releases](https://github.com/OtavioBiazzi/aplicativo-contabilizador/releases)
>
> O projeto começou como "Contabilizador Caixa" (uma calculadora de caixa com exportação para Excel) e evoluiu para um PDV completo. O histórico de cada versão está nas notas das releases e em [`docs/`](docs/).

## Instalação

Na página de [Releases](https://github.com/OtavioBiazzi/aplicativo-contabilizador/releases), baixe o arquivo da última versão:

| Arquivo | Para quê |
| --- | --- |
| `Caixa.PDV.Setup.<versão>.exe` | Instalador (atalho na área de trabalho e no menu iniciar) |
| `Caixa.PDV.<versão>.exe` | Versão portátil, sem instalar |

O Windows pode mostrar o aviso do SmartScreen, pois o instalador ainda não tem assinatura de código por certificado pago. O app pode se atualizar sozinho em **Menu Gerencial > Atualizações** (também disponível na tela de conexão do cliente).

## O que o app faz

### Vendas e mesas
- **Venda direta** e **Mesas** com carrinhos separados; quantidade, desconto, observação, peso (o valor é recalculado) e duplicar produto pelo botão direito.
- **Mesas** com número de pessoas, reserva, submesas nomeadas, transferência de itens entre mesas, busca por várias mesas (`001, 004, 021`) e resumo de mesas em aberto (realizado hoje + saldo pendente = previsão do total).
- **Divisão de conta** por pessoas, divisão avançada com partes nomeadas e submesas, e divisão de um item entre pessoas. O valor por pessoa já vem sugerido no pagamento.
- **Pagamentos múltiplos** na mesma conta, pagamentos parciais, dinheiro recebido com cálculo de troco e limite pelo saldo restante nos demais meios.
- **Lembretes de retirada de comandas** após o fechamento (desativados por padrão, configuráveis por dia da semana e por mesa).

### Produtos
- Categorias, adicionais, favoritos, disponibilidade, códigos e controle de estoque com quantidade mínima (alertas na Visão Geral).
- Importação de produtos, duplicação de cadastro e aba opcional **FREQUENTE** com os mais vendidos.

### Histórico, relatórios e recibos
- **Histórico** de todas as vendas, com edição (inclusive de todos os meios de pagamento), cancelamento e filtros por mesa, dia, pagamento e produto.
- **Relatórios** com comparativo de período, produtos por categoria, formas de pagamento, recebimentos, mesas e vendas, horários e auditoria, com exportação para Excel/CSV.
- **Recibos** com prévia, impressão e PDF nos formatos 58 mm, 80 mm, A4 e papel personalizado.
- **Caixa**: abertura, fechamento (total ou parcial) e saldo.

### Financeiro
- **Contas a pagar** e **contas a receber** com parcelas e recorrência, pagamento e recebimento parcial ou agrupado, saldo por cliente e por fornecedor, filtros por emissão ou vencimento e recibos.
- **Cadastro de pessoas** como Cliente, Fornecedor ou Ambos.
- Categorias e centros de custo.

### Rede (servidor e clientes)
- Um computador é o **servidor** e os demais se conectam como **clientes**, com conexão automática ou manual e sincronização em tempo real.
- **Permissões** definidas no servidor (ver valores, ver totais, imprimir, editar configurações, gerenciar produtos, acesso completo).
- **Perfis de privacidade** editáveis, para esconder totais ou valores conforme quem está usando. Isso é uma proteção de tela, não uma barreira de segurança.
- Aparência, avisos e preferências visuais são locais em cada computador.
- Servidor e clientes devem estar **na mesma versão**.

### Outros
- Ajuda pesquisável dentro do app (mais de 25 tutoriais com atalhos), atalhos de teclado (Tab, F2 para cadastros, busca por prefixo).
- Barra fixada sempre visível, temas e interface compacta (testada em 1024×600).
- Exportação automática da planilha do dia em segundo plano.

## Onde ficam os dados

Os dados ficam na pasta do usuário, em `AppData\Roaming\<nome do app>\data` (o Menu Gerencial tem atalhos para abrir as pastas de dados e de planilhas):

| Arquivo | Conteúdo |
| --- | --- |
| `pdv.sqlite` | Banco principal do PDV (vendas, mesas, produtos, financeiro) |
| `settings.json` | Configurações |
| `ledger.json` | Lançamentos do modo calculadora antigo |
| `planilhas/` | Planilhas Excel/CSV exportadas (são saídas, não o banco) |

Faça backup dessa pasta (ou da pasta de planilhas, se ela estiver sincronizada na nuvem).

## Tecnologias

- **Electron** + **React 19** + **Vite** + **TypeScript**
- **SQLite** (`sql.js`) como banco local
- **Express** + **WebSocket** para o servidor da rede local
- **pdf-lib** (recibos em PDF), **jszip** e geração de XLSX/CSV
- **electron-builder** (instalador NSIS e versão portátil)

## Desenvolvimento

Requisitos: Node.js 20+ e Windows.

```bash
npm install
npm run dev          # Vite + Electron com recarga
npm run typecheck    # checagem de tipos
npm run build        # gera dist/ e dist-electron/
npm run start        # build + abre o app
npm run dist         # gera o instalador em release/
```

Testes de fumaça (rodam sobre o build):

```bash
npm run smoke:pdv       # núcleo do PDV
npm run smoke:network   # servidor, clientes e sincronização
```

Há também scripts `smoke_*.mjs` e `qa_*.py` em [`scripts/`](scripts/) para fluxos específicos (concorrência entre terminais, financeiro, recibos, privacidade, layout em vários tamanhos de tela). Os `qa_*.py` precisam de Python com Playwright.

### Estrutura

```text
electron/
  main.ts            Processo principal, janelas, IPC e atualização
  pdvStore.ts        Banco SQLite do PDV (vendas, mesas, financeiro)
  pdvExporter.ts     Exportação Excel/CSV do PDV
  pdvReceipt.ts      Recibos (prévia, impressão e PDF)
  productImporter.ts Importação de produtos
  localServer.ts     Servidor HTTP/WebSocket da rede local
  storage.ts         Armazenamento JSON do modo calculadora antigo
  preload.cts        Ponte entre o Electron e a interface
src/
  PdvApp.tsx         Interface do PDV
  App.tsx            Interface do modo calculadora antigo e configurações
  shared/            Tipos, valores padrão e cálculos
  styles/            CSS
docs/                Planos de cada fase, auditoria e notas de release
scripts/             Testes de fumaça e QA
```

## Documentação

- Notas de cada versão: [Releases](https://github.com/OtavioBiazzi/aplicativo-contabilizador/releases) e `docs/release-*.md`
- Contexto geral do projeto: [`docs/CONTEXTO-CAIXA-PDV.md`](docs/CONTEXTO-CAIXA-PDV.md)
- Planos por área: [`docs/`](docs/)

## Licença

[MIT](LICENSE) © Otavio Biazzi
