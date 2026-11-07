# Caixa PDV 0.4.17

- **Edições no Caixa mais rápidas**: ao editar uma venda, trocar a forma de pagamento, cancelar ou mandar para a lixeira — no servidor ou pelos clientes — o app confirma assim que grava no banco. A planilha automática é atualizada logo em seguida, em segundo plano, como já acontecia nos fechamentos de mesa. Antes, cada edição esperava a planilha inteira, com todo o histórico, ser regerada; quanto mais vendas, mais demorava. A venda direta também ficou mais rápida pelo mesmo motivo.
- **Medidor de desempenho** em Menu Gerencial > Backup e diagnóstico. Mostra o tamanho do banco, o tempo de cada gravação, o tempo da planilha automática e o tamanho do pacote que os clientes baixam a cada atualização. As cores indicam a situação: verde está tudo certo, amarelo vale acompanhar e vermelho é hora de otimizar.
- **Planilhas sem nome cortado**: as planilhas do app calculam a largura de cada coluna pelo maior texto que ela tem. O relatório de produtos, o histórico e as listas de contas a pagar e a receber passam a sair em .xlsx (o CSV não guarda a largura das colunas), com uma janela para escolher onde salvar.

Validação: typecheck e build de produção. Smokes de PDV, rede, concorrência, lembretes, regressões, histórico (inclui planilha adiada) e o novo smoke das larguras das planilhas. QA no Electron com servidor e cliente isolados: lembretes e configurações, fases da 0.4.16, pagamento e o novo QA de desempenho. Esse QA confere que a edição de forma de pagamento responde sem esperar a planilha, que a planilha é atualizada em seguida e que o medidor aparece com os quatro números.

O executável empacotado 0.4.17 passou em todo esse QA como servidor e como cliente. O portátil também foi aberto e teve a versão conferida, com dados isolados.

Atualize servidor e clientes para a mesma versão.
