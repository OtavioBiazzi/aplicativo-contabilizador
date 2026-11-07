# Caixa PDV 0.4.22

- **Tela de pagamento em tela cheia sem buracos**: na 0.4.21, com a janela grande, sobrava espaço vazio entre Valor Total, Recebido e Troco. Agora as caixas crescem para ocupar a coluna da direita, com o título colado em cada caixa e o número maior. Em telas pequenas fica como antes.
- **Planilha automática desligada ao atualizar para esta versão**: vale também para quem já tinha passado pela 0.4.18 e religado. Acontece uma única vez; se alguém religar depois, a escolha é respeitada.
- **Porta do servidor ocupada não trava mais o app**: se a porta já estiver em uso (por exemplo, outro Caixa PDV aberto no mesmo PC), aparece um aviso normal em vez da janela "A JavaScript error occurred in the main process".

Nada mudou no banco.

Validação: tela de pagamento conferida em 1920x1080, 1339x865, 1280x720 e 1024x600; teste da migração da planilha; QA completo no executável empacotado, como servidor e como cliente.

Atualize servidor e clientes para a mesma versão.
