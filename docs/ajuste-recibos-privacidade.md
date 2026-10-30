# Recibos e privacidade — ajustes locais após a 0.4.12

Solicitação de 30/10/2026: conferir impressão e manter o histórico utilizável com a privacidade ativa, ocultando os totais sem bloquear os lançamentos e recibos.

## Comportamento

- Perfil padrão Totais ocultos: oculta o Total do Dia e o Total filtrado do Histórico; valores de cada lançamento, detalhes, edição e recibos continuam acessíveis.
- Migração única do antigo perfil padrão Reservado. Perfis personalizados e alterações feitas após a migração são preservados.
- A definição dos perfis continua compartilhada pelo servidor; a ativação permanece independente por computador.
- As permissões do servidor para visualizar valores, totais e imprimir continuam sendo respeitadas.
- O recibo pode ser aberto sem depender da visibilidade do total da tela.
- Destino local de impressão identificado como Este computador, separado de Computador servidor.
- Falhas de conexão/impressão aparecem dentro do recibo, mantendo a janela e a possibilidade de tentar novamente.
- Se a impressão local falhar, o PDF de apoio continua sendo gerado/aberto, mas a operação não é informada como impressão bem-sucedida.
- Recibos PDF passam pelo renderizador de impressão: texto selecionável, escala consistente e paginação de A4 sem encolher toda a conta em uma página.
- Papel de 58 mm usa a largura correspondente; cabeçalho não sobrepõe descrição e total.
- Altura térmica acompanha o conteúdo, sem reservar a altura vazia da janela oculta. Papel personalizado respeita a altura mínima configurada; recibos muito longos paginam.
- Prévia do Histórico usa o mesmo contêiner superior de modais, evitando recorte por janelas internas.

## Evidências

- `npm run build`: aprovado.
- `smoke_privacy_table_status.mjs`: perfil padrão, preservação de personalização, persistência/reinício e status de mesas aprovados.
- `smoke_network.mjs`, `smoke_pdv.mjs` e `smoke_history_identity.mjs`: aprovados.
- `qa_receipt_ui.py`: aprovado no Electron, com servidor e cliente conectados, em 1024×600. Conferiu totais ocultos, lançamentos/detalhes/edição acessíveis, prévia com valores e salvamento PDF.
- O mesmo teste conferiu impressão cliente → servidor e servidor → cliente, erro remoto, falha de fila local, recuperação e respeito às permissões.
- `qa_receipt_render.cjs`: aprovado com papel de 58 mm, 80 mm, personalizado e A4. Recibo térmico com 200 itens gerou 3 páginas; A4 com 100 itens gerou 4 páginas.
- `qa_receipt_pdf_content.py`: todos os itens e o rodapé presentes nos documentos curtos e longos.
- `qa_payable_receipt_pdf.cjs`: recibo de conta a pagar com documento, fornecedor, pagamentos e saldo aprovado em 80 mm e A4.
- PDFs renderizados e inspecionados visualmente; cabeçalho estreito e margens das páginas conferidos.
- Executável empacotado 0.4.13: servidor e cliente aprovados em `qa_packaged_receipts.py`, com prévia, privacidade e salvamento de PDF nas três áreas. Valores, todos os itens e rodapé dos PDFs longos conferidos. Portátil 0.4.13 aberto com banco isolado e seleção de modo visível.

Todos os dados foram isolados em `outputs/`. As filas de impressão dos testes foram simuladas para não gastar papel nem enviar trabalhos às impressoras do usuário. Isso verifica o conteúdo, as opções e o encaminhamento pelo aplicativo; não atesta o funcionamento de uma impressora física ou de seu driver.

Estes ajustes compõem a versão 0.4.13; consulte `docs/release-0.4.13.md` para as notas da entrega.
