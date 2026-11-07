# Plano 0.4.16 — lembretes, carrinho, financeiro e fechamento de conta

Base: 0.4.15 (`49d2a8a`), branch `melhorias-0.4.16`. Nada foi implementado ainda: este documento organiza os pedidos, mostra onde cada coisa fica no código e define a ordem para não quebrar o que já funciona.

Legenda: **[pronto p/ fazer]** entendido e localizado · **[decidir]** tem uma escolha marcada como padrão; confirme ou troque · **[bloqueado]** depende de algo que ainda não tenho.

---

## Fase 1 — Ajustes pequenos (baixo risco)

### 1.1 Tirar as setinhas da caixa de quantidade **[pronto p/ fazer]**
- **Onde:** `src/PdvApp.tsx` (`.pdv-cart-add-quantity`, input `type="number"` entre os botões − e +). Mesmo padrão em `.pdv-inline-stepper` (partes da divisão avançada).
- **Como:** CSS escondendo os spin buttons (`::-webkit-inner-spin-button`, `appearance: textfield`) só nesses campos que já têm − e +. A caixa continua aceitando digitação, e as setas ↑/↓ do teclado continuam funcionando.
- **Não muda:** os outros campos numéricos de configuração (altura, margens etc.), que não têm − e + ao lado.

### 1.2 "Alterar peso" passa a ser por valor **[decidir]**
- **Onde:** menu do botão direito do carrinho (`runItemAction("quantity")`) → `ItemEditModal`, modo `quantity` com `isMeasured`.
- **Hoje:** digita gramas, e o valor é recalculado.
- **Proposta:** o campo principal vira **Valor (R$)**, e o app calcula e mostra o peso resultante embaixo (ex.: "≈ 412 g"). Fórmula: `gramas = (valor + desconto do item) / (preço unitário × fator por grama)`. O total final fica exatamente o valor digitado, sem erro de centavos.
- **Padrão escolhido:** só valor, com o peso apenas como informação. Alternativa: manter um botão "digitar em gramas" para quem preferir.
- **Nome no menu:** "Alterar valor (peso)".
- **Continua igual:** desabilitado para item já pago; desconto do item preservado; transferências mantêm peso e centavos (corrigido na 0.4.15).

### 1.3 Botão + das mesas obedecendo o servidor **[pronto p/ fazer]**
- **Problema:** `hideQuickValue` é guardado só no `localStorage` de cada computador (`TableCloseReminders.tsx`), então o cliente nunca recebe o que o servidor marcou.
- **Proposta:**
  - Nova regra do servidor em `PdvSettings`: `hideTableQuickValue`, gravada no SQLite (`pdvStore.ts`, mesmo padrão de `table_count`) e enviada aos clientes como as demais configurações de Mesas.
  - Em **Mesas > Funcionamento** (servidor): "Ocultar o botão + em todos os computadores".
  - A opção local em **Mesas > Visual** continua: "Ocultar só neste computador".
  - Regra efetiva: oculta se o servidor **ou** o computador local mandar ocultar. O cliente vê a opção do servidor, mas travada, como as outras regras.

### 1.4 Privacidade no resumo "Mesas em aberto" **[pronto p/ fazer]**
- **Onde:** `src/components/OpenTablesSummary.tsx`, aberto pelo menu do Total do dia (`App.tsx`).
- **Proposta:**
  - Passar a mesma regra do Total do dia (`settings.privacy.hideHeaderTotal`).
  - Com privacidade ligada, **Realizado hoje** e **Previsão do total** mostram "Privado".
  - **Saldo que ainda falta fechar** e a lista de mesas continuam visíveis.
  - Ao desativar a privacidade no menu, os valores aparecem.

---

## Fase 2 — Lembretes de comandas e avisos

Arquivos centrais: `src/components/TableCloseReminders.tsx`, `src/shared/closeReminders.ts`, `electron/main.ts` (`publishTableClosed`), `electron/localServer.ts`, `src/App.tsx` (recebimento via WebSocket e `Toast`), `src/styles/table-close-reminders.css`.

### 2.1 De quais computadores eu recebo lembrete **[decidir]**
- **Causa do problema:** o servidor chama `publishTableClosed` para qualquer fechamento, inclusive os feitos pelo cliente, e envia para a própria tela. O aviso não diz quem fechou.
- **Proposta:**
  - O aviso passa a levar a **origem**: `originDevice` (nome do computador) e um id do terminal.
  - Nova opção local em **Mesas > Lembretes**: "Avisar fechamentos feitos: **só neste computador** / **em todos os computadores**".
  - **Padrão escolhido:** "só neste computador", que é o que você esperava. Quem quiser ver tudo marca "todos".
  - Avisos antigos já pendentes (sem origem) continuam aparecendo até OK.

### 2.2 Dar baixa em um computador some nos outros **[decidir]**
- **Proposta:**
  - Ao clicar OK num lembrete, o computador avisa o servidor. Nova rota `POST /api/pdv/close-notices/:id/ack` para o cliente; IPC para o servidor.
  - O servidor repassa `close-notice-ack` para a própria tela e para todos os clientes, e cada um remove aquele lembrete.
  - O id confirmado entra na lista "já visto", então um reenvio atrasado não traz o lembrete de volta.
- **Padrão escolhido:** sincronização ligada, com opção local para desligar ("Confirmar aqui não remove dos outros").
- **Limite:** como já acontece hoje com os próprios avisos, só sincroniza enquanto estiver conectado. Uma baixa dada offline não remove dos outros depois.

### 2.3 Minimizar e limitar a pilha de lembretes **[pronto p/ fazer]**
- **Proposta:**
  - Cabeçalho fino no topo da pilha, "Comandas (N)", com uma setinha para **minimizar/expandir**. Minimizado, fica só uma pílula "N comandas ▴" no canto.
  - O estado é guardado por computador.
  - **Limite configurável** de lembretes visíveis (padrão **4**, de 1 a 10) em Mesas > Lembretes. Passando disso, a pilha para de crescer e vira lista com rolagem interna, com altura fixa.
  - Lembrete novo com a pilha minimizada: a pílula atualiza o número e pisca uma vez, sem abrir sozinha e sem cobrir a tela.
  - Em telas pequenas (≤ 700 px de altura) o limite efetivo cai para no máximo 3.

### 2.4 Avisos (toasts) com a mesma aparência e sem conflito **[pronto p/ fazer]**
- **Hoje:** o `Toast` (`.toast`, fixo em `bottom: 22px; right: 22px`, z-index 40) e os lembretes (`.table-close-reminders`, `bottom: 8px; right: 8px`, z-index 300) disputam o mesmo canto e se sobrepõem.
- **Proposta:**
  - Um único **dock de notificações** no canto inferior direito, com duas áreas empilhadas: avisos temporários em cima e lembretes de comanda embaixo. Nada se sobrepõe.
  - Os dois com o mesmo cartão: borda, cor da paleta, tamanho de fonte e botão de fechar. A cor da borda indica sucesso, erro ou informação.
  - Avisos continuam sumindo sozinhos no tempo configurado. Lembretes continuam até OK.
  - A regra que esconde os lembretes dentro de mesa e de menus continua valendo só para eles. Avisos de erro seguem visíveis.
- **Fora do escopo:** os `PdvNoticeModal` (janelas de erro que bloqueiam a operação) continuam como janela, porque exigem atenção.

---

## Fase 3 — Financeiro e clientes

### 3.1 Botão direito "Ver detalhes" **[pronto p/ fazer]**
- **Onde:** `src/components/FinancialGrid.tsx`, usado por Contas a pagar (`App.tsx`, `PayablesPanel`), Contas a receber (`PdvApp.tsx`, `ReceivablesScreen`), saldos por fornecedor/cliente e Clientes (`CustomersScreen`).
- **Como:** `FinancialGrid` ganha um `onContextMenu(row, x, y)` opcional. Cada tela monta seu menu só com ações que **já existem**, desabilitadas quando não se aplicam.
- **Contas a pagar / receber:**
  - Ver detalhes: abre o painel que já existe, com emissão, vencimento, documento, parcela, pagamentos e linha do tempo.
  - Editar.
  - Pagar/Receber.
  - Recibo.
  - Marcar para pagamento agrupado.
- **Saldo por fornecedor/cliente:** Ver contas desta pessoa; Pagar/Receber.
- **Clientes:** Ver ficha; Ver contas pendentes; Editar cadastro.
- **Fecha com:** Esc, clique fora ou rolagem. O menu reaproveita o `ContextMenu` do PDV para ter a mesma aparência.

### 3.2 Contas vencidas sempre visíveis **[decidir]**
- **Proposta:**
  - Com a caixa **A pagar** marcada, contas com saldo e situação **Vencida** aparecem mesmo fora do período escolhido, no topo, com a etiqueta "Vencida · fora do período".
  - Pesquisa por texto continua filtrando normalmente.
  - Vale também para **Contas a receber**, porque o pedido "seção de clientes também" foi entendido assim.
- **Totais (padrão escolhido):** "Falta pagar/receber" passa a incluir essas vencidas, já que estão na lista, e um rodapé discreto separa "das quais vencidas fora do período: R$ X".
- **Ajuste:** o aviso "Ver todas em aberto (N fora do filtro)" passa a contar só as não vencidas.

---

## Fase 4 — Seleção múltipla no carrinho **[decidir]**

- **Base:** o carrinho já usa `selectedItemIds: string[]`, hoje sempre com 1 item.
- **Seleção:**
  - Clique seleciona um. **Shift+clique** seleciona o intervalo; **Ctrl+clique** adiciona ou remove.
  - **Esc** ou clique em área vazia limpa a seleção.
  - Itens pagos não entram.
  - Com o carrinho **comprimido**, a seleção múltipla fica desligada, porque cada linha representa vários lançamentos.
- **Menu do botão direito com vários itens:**
  - Cabeçalho "**N itens selecionados**".
  - As opções que não funcionam com vários aparecem desabilitadas, com o motivo no tooltip ("disponível para um item por vez").
- **O que funciona com vários:**
  - Duplicar.
  - Remover/cancelar, com uma confirmação listando os itens.
  - Transferir para outra mesa ou submesa.
  - Desconto em %, aplicado a cada item.
  - Adicionar observação (a mesma em todos).
- **Só para um item:** alterar quantidade/valor, alterar preço, desconto em R$, dividir item, mover/colocar antes ou depois.
- **Risco principal (cliente/servidor):** transferências e remoções de mesa passam pelo servidor com chave de idempotência. Para não ficar meio feito se a rede cair no meio, a operação em lote será enviada como **uma única requisição** com a lista de itens, e não como N requisições. Isso exige conferir e, se preciso, estender as rotas de transferência e remoção em `localServer.ts` e `pdvStore.ts`.
- **Plano B:** se as rotas exigirem mudança grande, esta fase entra só com Duplicar, Observação e Desconto %, ações locais do carrinho. Transferir e Remover em lote ficam para depois.

---

## Fase 5 — Tela de fechamento de conta no estilo da referência **[bloqueado]**

- **Pedido:** deixar o fechamento (`PaymentModal`, `src/PdvApp.tsx`) parecido com a tela do outro sistema, com pesquisa de clientes, cadastro rápido etc., sem repetir funções que já existem em outro lugar (ex.: desconto).
- **Bloqueio:** **a imagem de referência não veio na mensagem.** Sem ela não dá para desenhar nada parecido. Envie o print (ou os prints: tela inteira, pesquisa de cliente aberta, cadastro rápido).
- **O que já sei do nosso lado:**
  - O `PaymentModal` tem meios por atalho (F-keys, incluindo F6 = Conta a receber), lista de pagamentos, pagamentos anteriores, identificação da pessoa e observação.
  - O cadastro de cliente já pode ser chamado de dentro da cobrança (`onSaveCustomer`).
  - O desconto da conta fica hoje no `TableCloseMenu`, antes do pagamento.
- **Com a imagem em mãos:** faço um comparativo campo a campo (o que já temos, o que muda de lugar, o que seria novo, o que fica de fora por repetir) e só então desenho a tela.

---

## Ordem, testes e entrega

1. **Fase 1 → 2 → 3 → 4.** A Fase 5 começa quando a imagem chegar e pode correr em paralelo com a 3 ou a 4.
2. Um commit por item, para facilitar desfazer só o que der problema.
3. **Testes a cada fase:**
   - `npm run typecheck` e `npm run build`.
   - Smokes existentes ligados ao que mudou: `smoke_close_reminders.mjs`, `smoke_pdv.mjs`, `smoke_network.mjs`, `smoke_concurrent_tables.mjs`, `smoke_privacy_table_status.mjs`, `smoke_payable_optional.mjs`, e o QA de financeiro e layout.
   - Novos casos nos smokes para: origem e sincronização dos lembretes, botão + vindo do servidor, valor por peso, vencidas fora do período e lote do carrinho.
4. **Conferência no Electron:**
   - Servidor + cliente em 1024×600 e 1280×720.
   - Lembretes com 0, 1, 4 e 12 avisos, minimizado e expandido.
   - Aviso aparecendo junto com lembretes.
5. **Entrega:**
   - Versão **0.4.16**, com `docs/release-0.4.16.md` no mesmo formato das anteriores.
   - Nada vai para o GitHub nem para as Releases sem você pedir.
   - Lembrete: servidor e clientes precisam atualizar juntos, porque as Fases 2 e 4 mudam a comunicação entre eles.

## Decisões pendentes (padrões já escolhidos)

| # | Pergunta | Padrão |
| --- | --- | --- |
| 1.2 | Alterar peso: só valor, ou valor + opção de gramas? | Só valor, peso mostrado como informação |
| 2.1 | Lembretes de quais computadores? | Só deste computador (opção para "todos") |
| 2.2 | Baixa sincronizada entre computadores? | Ligada (opção para desligar) |
| 3.2 | Vencidas fora do período também em Contas a receber, e somando no total? | Sim nos dois |
| 4 | Seleção múltipla com Transferir/Remover em lote? | Sim, em requisição única; Plano B se ficar grande |
| 5 | Imagem da tela de referência | **Falta enviar** |
