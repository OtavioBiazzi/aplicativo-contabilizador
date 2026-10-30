# Caixa PDV 0.4.13

- Privacidade padrão ajustada para ocultar o Total do Dia e o Total filtrado do Histórico, mantendo valores individuais, detalhes, edição e recibos acessíveis.
- Atualização automática do antigo perfil padrão Reservado, preservando perfis personalizados e alterações posteriores. As regras continuam definidas pelo servidor, com ativação independente em cada computador.
- Acesso ao recibo separado da visibilidade dos totais. Permissões do servidor para visualizar valores, totais e imprimir continuam sendo respeitadas.
- Destino local de impressão identificado como Este computador, separado do Computador servidor.
- Falhas de conexão ou impressão aparecem dentro do recibo e permitem tentar novamente. A abertura do PDF de apoio não é mais informada como impressão bem-sucedida.
- Recibos PDF com texto selecionável e tamanho consistente. Contas longas em A4 são divididas em páginas, sem encolher todo o conteúdo.
- Ajustes no papel de 58 mm, no cabeçalho e na altura do recibo térmico. Papel personalizado respeita a altura configurada; documentos muito longos paginam sem cortar os itens.
- Prévia do recibo do Histórico ajustada para não ser recortada pela janela interna.

Validação: compilação de produção; testes de PDV, rede, identificação no Histórico e migração dos perfis; interface em 1024×600 com servidor e cliente; PDF e encaminhamento de impressão nos dois sentidos, incluindo falhas e recuperação. Recibos de 58 mm, 80 mm, papel personalizado e A4 conferidos, com preservação de todos os itens e do rodapé nos documentos longos. As filas de impressão foram simuladas; não houve impressão física em papel.

O executável empacotado 0.4.13 foi conferido como servidor e cliente, incluindo salvamento real de PDFs e conferência dos valores. Documentos longos preservaram os 200 itens no papel de 80 mm e os 100 itens no A4. O portátil 0.4.13 também abriu com dados isolados.

Atualize o servidor e os clientes para a mesma versão.
