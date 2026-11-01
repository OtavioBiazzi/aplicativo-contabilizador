# Caixa PDV 0.4.15

- Novos lembretes para retirar comandas após o fechamento: avisos compactos no canto direito, usando a paleta do aplicativo, com número da mesa e nome da submesa quando houver. Permanecem até confirmar em OK, sobrevivem à reabertura e ficam ocultos dentro de uma mesa e nos menus.
- Lembretes desativados por padrão, com configuração independente em cada computador em **Menu Gerencial > Mesas > Lembretes**. Permite escolher dias da semana e ignorar mesas específicas, intervalos ou mesas a partir de um número, como `47+`.
- Configurações reorganizadas: **Mesas** reúne Funcionamento, Visual e Lembretes; **Aparência** reúne Interface, Venda e produtos e Avisos gerais. Ajustes visuais locais são aplicados sem reiniciar e permanecem separados das regras do servidor.
- Opção local para ocultar o botão + da grade em **Mesas > Visual**.
- O valor dividido por pessoa passa a ser sugerido ao informar os pagamentos. Cartão, Pix e outros meios são limitados ao saldo restante; dinheiro recebido continua permitindo valores maiores para calcular o troco.
- Menu do botão direito nos itens com Duplicar produto e Alterar peso. O peso recalcula o valor, e a contagem no topo do carrinho fica arredondada sem alterar as quantidades das linhas.
- Transferências preservam o total ajustado manualmente, os centavos e o peso entre origem e destino. Salvamentos antigos não podem reinserir itens já transferidos ou removidos em outro terminal.
- Corrigido o bloqueio do pagamento ao cancelar a abertura manual do caixa. Melhorada a proteção do formulário durante fechamento e transferência, o tratamento de falhas e o timeout da resposta do servidor.

Os avisos de fechamentos realizados em outros computadores são recebidos enquanto há conexão com o servidor. Pendências já recebidas continuam salvas localmente.

Validação: compilação e testes de PDV, rede, financeiro, concorrência, fechamento por escopo, caixa, identidade no Histórico, privacidade e transferências. Fluxos de servidor/cliente conferidos em 1024×600 e 1280×720, incluindo configurações locais, notificações, pagamentos mistos, peso, duplicação, filtros e repetição segura após perder a resposta de um fechamento já gravado. Os relatos raros de perda de itens não foram todos reproduzidos; esta versão corrige os casos concretos identificados.

O executável empacotado 0.4.15 passou nesses fluxos como servidor e cliente. O portátil também foi aberto e sua versão conferida com dados isolados.

Atualize servidor e clientes para a mesma versão.
