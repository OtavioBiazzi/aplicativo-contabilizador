# Caixa PDV 0.4.24

- **Submesa fechada em outro PC não trava mais a mesa**: se um computador fechava uma submesa enquanto outro lançava itens em outra submesa da mesma mesa, o segundo dava erro de "conta já fechada" e os últimos itens lançados se perdiam ao sair da mesa. Agora os itens já fechados são ignorados e o resto, inclusive o que acabou de ser lançado, é gravado normalmente.
- **OK do lembrete sempre remove em todos os PCs**: a opção "Ao confirmar em OK aqui, remover também dos outros computadores" saiu; o OK dado em qualquer computador sempre tira o lembrete dos outros. Cada computador confere a lista do servidor a cada 10 segundos.
- **Mesa S/N (sem número)**: uma mesa fixa no mapa, logo antes do "+", para anotações e submesas que ainda não têm mesa. Funciona como qualquer mesa (submesas, fechamento, histórico) e aparece como "Mesa S/N". Na busca, digite s/n.
- **Previsão de lançamentos em Mesas em aberto**: mostra os lançamentos feitos hoje, quantos faltam (cada submesa conta 1 e a parte principal da mesa conta mais 1) e a previsão final. A lista ganhou a coluna Lançamentos.
- **Duplo clique em vários itens selecionados**: abre o Remover de todos os selecionados, como o menu do botão direito.
- **Identificação do pagamento sem foco automático**: a caixa "Nome da pessoa / identificação" não vem mais selecionada, então tecla apertada sem querer não escreve nela.
- **Privacidade: total só na caixa**: nova opção nos Ajustes de privacidade. Com ela, mesmo sem privacidade, o topo mostra "Clique para ver" no lugar do valor; o valor aparece na parte de baixo da caixa que abre ao clicar no Total do dia. Vale só para o computador onde foi marcada.

Nada mudou no banco. A mesa S/N usa o número reservado 999.

Atualize servidor e clientes para a mesma versão.
