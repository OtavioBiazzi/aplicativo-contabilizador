# Caixa PDV 0.4.23

- **Lembrete de comanda some nos dois PCs**: o OK dado em um computador era avisado aos outros só naquele instante; se o outro estivesse reconectando, dormindo ou com o app fechado, o lembrete ficava lá para sempre. Agora o servidor guarda os OKs, e cada computador confere essa lista ao abrir, a cada 20 segundos e ao voltar para a janela. O OK dado em qualquer PC sempre remove o lembrete nos outros.
- **Fechar a conta sem lembrete (comanda já retirada)**: na tela de pagamento, com a conta paga, a tecla **] º** (ao lado do Enter) finaliza como o Enter, mas sem criar lembrete em nenhum computador, e já conta como OK. Dá para trocar em Lembretes de comandas: tecla ] º, segurar Shift, segurar Ctrl ou desativado.
- **Avisar fechamentos só dos outros computadores**: em Lembretes de comandas, além de 'Só neste computador' e 'Em todos', agora tem 'Só nos outros computadores'.
- **Tamanho dos lembretes**: em Lembretes de comandas dá para escolher Normal, Compacto ou Pequeno. Ajuda em telas de 1300.
- **Aproximação ao dividir um item**: nova opção 'Aproximar também ao dividir um item entre pessoas', junto da aproximação. Ex.: R$ 25,00 em 3 com R$ 0,50 fica 8,50 + 8,50 + 8,00; a última parte fica com a diferença e o total não muda. Na janela de dividir dá para ligar ou desligar na hora.
- **Tela de pagamento menor em telas pequenas**: em 1366x768, 1300 e parecidas ela ocupava a tela inteira. Agora fica com o mesmo jeito, só que um pouco menor e com folga em volta. Em 1920x1080 continua igual.
- **Atalhos só ao passar o mouse**: os botões não mostram mais F1, F2, Esc escritos; o atalho aparece na dica ao passar o mouse.
- **Planilha automática**: segue como na 0.4.22 (desligada uma única vez ao atualizar; quem religar tem a escolha respeitada).

Nada mudou no banco. O servidor passa a guardar os OKs dos lembretes em `close-notice-acks.json`, na pasta de dados.

Validação: tela de pagamento conferida em 1920x1080, 1366x768, 1300x760, 1280x720 e 1024x600; QA completo no executável empacotado, como servidor e como cliente, incluindo OK perdido recuperado, tecla ], Ctrl, Enter normal, 'só nos outros computadores', tamanho dos lembretes e divisão de item com aproximação.

Atualize servidor e clientes para a mesma versão.
