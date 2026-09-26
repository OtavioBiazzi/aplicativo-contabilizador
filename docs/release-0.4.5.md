# Caixa PDV 0.4.5

- Botão de verificar atualização centralizado na tela de conexão do cliente.
- Histórico mostra o nome da mesa temporária, da submesa e a identificação informada no pagamento, inclusive em fechamentos completos de submesa. A identificação também está disponível no fechamento de toda a mesa.
- Registros anteriores aproveitam nomes ainda presentes nas observações e nos pagamentos. Nomes que nunca foram salvos não podem ser reconstruídos.
- Cancelamento no cliente usa a mesa devolvida pelo servidor, sem aguardar outra consulta completa. Pendências de produtos continuam sendo salvas antes do cancelamento.
- Fechamentos e cancelamentos confirmam após gravar o banco; a planilha automática passa a ser atualizada em segundo plano. Exportações são serializadas e a saída normal do aplicativo aguarda os trabalhos pendentes.
- Consultas de lançamentos deixam de carregar os produtos de todas as vendas antigas. Saldo do caixa é calculado diretamente no banco; edição e cancelamento de venda consultam apenas a venda envolvida.
- Histórico usa índices de clientes e contas vinculadas para evitar buscas repetidas.

Validação: build de produção, testes de identidade/histórico, igualdade dos lançamentos, fila de exportação, financeiro, rede, concorrência, fechamento e saldo do caixa; conferência visual e de fluxos no Electron com dados isolados.

No teste isolado inicial com 1.500 vendas e 15.000 produtos, a montagem dos lançamentos passou de 244 ms para 68 ms, mantendo os mesmos resultados. Essa medição não representa o tempo completo de uma operação pela rede.

Atualize servidor e clientes para a mesma versão.
