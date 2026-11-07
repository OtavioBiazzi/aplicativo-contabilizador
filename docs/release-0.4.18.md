# Caixa PDV 0.4.18

- **Transferir um produto usa o modal padrão**: no botão direito de um produto, "Transferir para outra mesa ou submesa" abre a mesma janela da transferência de vários itens, com o produto já marcado. Nela dá para ajustar a quantidade, escolher mesa e submesa ou marcar mais produtos. O modal antigo foi removido.
- **Clientes mais leves no Wi-Fi**: o servidor compacta o pacote que os clientes baixam a cada atualização (gzip). O conteúdo é o mesmo, só trafega menor, cerca de 5 a 6 vezes. Se a compactação falhar, o servidor manda do jeito antigo.
- **Planilha automática só quando pedir**: a opção "Sincronizar planilha operacional a cada alteração" passa a vir desligada. Ao atualizar para a 0.4.18, ela é desligada uma única vez em cada computador; quem religar depois tem a escolha respeitada. O banco não é alterado. A planilha continua disponível pela exportação manual.
- **Planilha agrupada**: com a opção ligada, os lançamentos feitos em até 3 segundos geram uma planilha só, em vez de uma por lançamento. O banco continua gravado na hora, antes da planilha.

Validação: typecheck e build de produção. Smokes de rede (com a conferência de que o pacote comprimido é idêntico ao original), lembretes, larguras das planilhas e o novo smoke da migração da planilha. QA no Electron com servidor e cliente isolados: lembretes e configurações, fases da 0.4.16, pagamento, desempenho e o novo QA da transferência de um produto (inclui transferência parcial). O executável empacotado 0.4.18 passou no mesmo QA como servidor e como cliente.

Atualize servidor e clientes para a mesma versão.
