# Lembretes de comandas e revisão de fechamento

Escopo solicitado em 01/11/2026. Base: 0.4.14. Alterações incluídas na entrega 0.4.15.

## Decisões

- Lembretes desativados por padrão. Configuração em Menu Gerencial > Mesas > Lembretes.
- Preferências e confirmações locais: cada cliente e servidor escolhe seu modo, dias e exceções. Não são enviadas como configuração do servidor.
- Aviso apenas após confirmação durável de um fechamento integral, da principal ou de uma submesa. Pagamento parcial avulso e cancelamento não significam comanda encerrada e não geram aviso.
- Exceções aceitam `47`, `47+` (47 em diante) e intervalos/listas como `10-15, 47+`. Dias seguem a data/hora local do fechamento.
- Avisos formam uma coluna compacta à direita. Largura padrão; nomes de submesa podem aumentar a altura. Muitos avisos geram rolagem na coluna, sem expulsar botões da tela.
- Sem expiração. OK remove apenas aquele aviso; pendências sobrevivem à reabertura. Desativar a função oculta pendências sem confirmá-las.
- A coluna aparece na grade de mesas e se esconde dentro de uma mesa, Venda, gerenciais e modais. Eventos recebidos enquanto está oculta continuam pendentes.
- Clientes recebem eventos de fechamento enquanto conectados; a resposta HTTP do fechamento próprio também entrega o aviso, caso o WebSocket falhe naquele momento. IDs de venda impedem duplicação por reenvio. Não há reconstrução de fechamentos ocorridos enquanto um computador esteve desconectado/fechado.
- Ocultar o + da grade também é uma preferência local, preservando o padrão atual de exibi-lo.

## Alterações

- Valor por pessoa passa como sugestão ao lançamento de cada meio, limitado ao restante; não muda o total da conta nem registra pagamentos fictícios.
- Valor de cartão/Pix/outros/recebível maior que o restante é limitado automaticamente. Dinheiro recebido pode exceder para calcular troco.
- Menu de contexto dos itens: Duplicar produto cria outra linha com novo ID e sem pagamentos anteriores; Alterar peso permite informar gramas e recalcula o valor pela unidade do lançamento. Contagem superior arredondada; linhas mantêm quantidades exatas.
- Corrigido o bloqueio do formulário ao cancelar a abertura manual do caixa; cancelamento do pagamento é impedido enquanto sua gravação está em andamento.
- Timeout de requisições remotas cobre também a leitura do corpo da resposta. Falhas na preparação do fechamento são mostradas ao operador.
- Transferências preservam totais ajustados manualmente, rateando os centavos e mantendo a soma entre origem/destino; peso mostrado acompanha a quantidade transferida.
- Salvamento com base antiga rejeita a reinserção de item já removido/transferido em outro terminal. Linhas com total alterado manualmente não são agrupadas pelo preço de cadastro ao adicionar outro produto.
- Snapshots recebidos durante fechamento/transferência não substituem o rascunho do pagamento.

## Validação

- `npm run build`.
- `scripts/smoke_close_reminders.mjs`: padrão desativado, dias/exceções, transferência de preço ajustado e por peso, soma exata dos centavos, salvamento antigo e repetição de fechamento.
- Suites existentes: PDV, rede, fechamento por escopo, concorrência, caixa, regressões financeiras, identidade no histórico, privacidade/status e refinamentos da 0.4.14.
- `scripts/qa_close_reminders.py`: Electron servidor/cliente isolados, portas CDP 9401/9402 e API 46641; exige perfis novos para o fluxo completo. Confere configuração local, fechamento misto, pagamentos, notificações, itens e recuperação de abertura manual.

Os relatos raros de perda de itens/travamento não são considerados integralmente reproduzidos. Há causas concretas corrigidas acima e testes dos fluxos relacionados; não se afirma que toda possível condição de rede/concorrência foi eliminada.

### Resultados observados

- Compilação e todas as suites listadas passaram com bases isoladas.
- Cliente configurou lembretes sem permissão de personalização operacional do servidor. Servidor continuou desativado e exibindo o + enquanto o cliente o ocultava.
- Fechamento real no cliente de R$ 60 dividido em duas pessoas sugeriu R$ 30. Débito/Pix acima do restante foram limitados; dinheiro R$ 9.999 continuou aceito como recebido.
- Avisos de mesa e submesa chegaram pelo WebSocket, com exceção 47+ respeitada; reabertura, confirmação, desativação/reativação e reenvio foram conferidos.
- Alterar 2,43 kg para 3.000 g recalculou R$ 24,30 para R$ 30. Duplicação criou ID distinto, sem copiar pagamento; contagem superior ficou inteira.
- Cancelar abertura manual e tentar fechar novamente funcionou sem sair da mesa. Uma resposta perdida após o commit do servidor foi simulada: o formulário liberou a tentativa, com exatamente uma venda final.
- Após abrir pagamento, voltar e cancelar a mesa, Histórico respondeu aos filtros por lista de mesas, situação, limpar e meio de pagamento. A falha rara reportada não foi reproduzida nesse cenário; a lógica desses filtros foi preservada.
- Capturas em `outputs/qa-close-reminders-20261101/`: pilha de avisos, configurações locais, carrinho e Histórico; limites da coluna conferidos em 1024×600 e 1280×720. Muitos avisos podem cobrir cards à direita até confirmação; a pesquisa permite localizar uma mesa sem remover pendências.

## Organização e compactação após revisão visual

- Avisos reduzidos de 258 × 78 px para 210 × 48 px nas mesas comuns. Submesas preservam o número da mesa e o nome completo, quebrando linhas quando necessário.
- Detalhes claros/brancos e botão OK neutro, sem destaques amarelos. Fundo, texto, bordas e foco usam as variáveis de tema do aplicativo (`--panel`, `--panel-2`, `--text`, `--muted`, `--line` e `--accent`).
- Mesas concentra Funcionamento (estrutura e regras compartilhadas), Visual (grade, status e botão + locais) e Lembretes (ativação, dias e exceções locais).
- Aparência separa Interface (tema, cabeçalho, janelas), Venda e produtos (grade/consulta) e Avisos gerais (mensagens informativas e duração).
- Campos de mesa e seus presets saíram de Aparência. Ordem de produtos foi movida da estrutura das mesas para a área dos produtos.
- Trocar de aba aguarda o salvamento pendente. O editor visual local registra somente os campos da aba e avisa as outras instâncias da interface no mesmo computador, aplicando a mudança sem reiniciar.
- Corrigida a disputa entre referências de salvamento do editor local e do editor compartilhado. Clientes sem personalização do servidor podem editar Visual/Lembretes; Funcionamento continua protegido.
- `scripts/qa_settings_sections.py` verifica organização, permissões, salvamento entre abas, aplicação imediata, independência servidor/cliente e dimensões em 1024 × 600 e 1280 × 720.

Validação final desta revisão: compilação completa, suites de lembretes/transferências e fechamento por escopo, fluxo completo `qa_close_reminders.py` e organização `qa_settings_sections.py` passaram. Capturas conferidas visualmente nas duas resoluções; campos do editor visual usam o tema escuro e controles compactos.

Entrega 0.4.15: instalador e portátil gerados; versão empacotada conferida como servidor e cliente com dados isolados nas duas suites de interface. Portátil conferido na seleção inicial de modo. Todos os executáveis testados informaram 0.4.15.
