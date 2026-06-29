# Plano de remake do Contabilizador Caixa

Este documento organiza o remake do aplicativo em fases pequenas o bastante para serem testadas, mas grandes o suficiente para deixar o produto com cara de sistema real de comercio.

## Direcao do produto

O app deve continuar rapido para venda na correria: se o usuario digitar so o valor e apertar Enter, a venda deve entrar. As areas mais completas precisam existir para configuracao, relatorio e operacao avancada, mas nao podem atrapalhar o caixa.

A direcao visual recomendada e um estilo de PDV moderno para Windows: limpo, com barras operacionais claras, contraste bom, cores de status e menos cara de pagina web. A referencia do DataCaixa deve inspirar status, abas e densidade operacional, sem copiar o visual antigo de forma literal.

## Principios de implementacao

- Fazer primeiro os fluxos que afetam o uso diario: registrar, fixar barra, apagar, exportar e consultar.
- Separar configuracoes por contexto, em vez de deixar tudo em uma tela longa.
- Criar temas como pacotes visuais completos: app, campos, botoes, barra fixada, relatorios e estados.
- Manter planilha simples por padrao, com modo avancado opcional.
- Toda mudanca de comportamento deve ter teste de smoke no Electron.
- Evitar recurso que parece bonito mas deixa o caixa mais lento.

## Fase 1 - Base critica e barra fixada

Objetivo: corrigir os problemas que mais incomodam no uso real.

Status: iniciada na versao 0.1.4 com tema sincronizado da barra fixada, tema separado da barra, drag pela alca, dinheiro com vinculo de modo, lixeira e exclusao definitiva. Avancada na versao 0.2.4 com sincronizacao configuravel entre Conta e Dinheiro/Troco para manter Mesa/Onibus ao alternar.

Entregas:
- Sincronizar o tema da barra fixada desde a abertura, incluindo tema automatico.
- Adicionar tema proprio da barra fixada, com opcao "seguir tema do app" como padrao.
- Remover bordas pretas/quadradas da janela fixada e garantir transparencia correta.
- Permitir arrastar a barra somente pelas tres bolinhas/alca.
- Corrigir foco do campo de valor para nao passar por cima do prefixo "R$".
- Corrigir troco para nunca sair da caixa, mesmo em telas pequenas.
- Adaptar campo de pessoas: completo quando houver espaco, compacto quando estiver estreito.
- Permitir modo dinheiro com tipo vinculado: Mesa, Venda, Onibus, Balcao/Personalizado.
- Aceitar registro com apenas valor preenchido.
- Criar exclusao definitiva separada de "cancelar" e "enviar para lixeira".

Arquivos provaveis:
- `electron/main.ts`
- `electron/preload.cts`
- `src/App.tsx`
- `src/styles/app.css`
- `src/shared/types.ts`
- `electron/storage.ts`
- `scripts/smoke_playwright.py`

Teste de aceite:
- Abrir app claro, escuro e automatico; a barra fixada deve nascer no tema correto.
- Abrir barra fixada, arrastar somente pela alca e registrar venda com so valor.
- Registrar Mesa/Dinheiro, remover definitivamente e confirmar que nao aparece no historico nem no Excel.

## Fase 2 - Redesign do fluxo principal

Objetivo: transformar a tela principal em um painel operacional bonito e rapido.

Status: iniciada na versao 0.2.0 com navegacao superior em estilo PDV, modulos Caixa/Historico/Relatorios/Rede/Ajustes e estados operacionais no topo.

Entregas:
- Reorganizar topo do app em uma barra de modulo: Caixa, Mesa, Onibus, Dinheiro, Relatorios, Servidor, Ajustes.
- Criar uma area de registro rapido mais objetiva, sem textos redundantes.
- Criar estados visuais de operacao: pronto, salvando, salvo, erro de planilha, pendente.
- Melhorar historico do dia com acoes claras: editar, duplicar, cancelar, lixeira, apagar definitivo.
- Criar filtros rapidos por tipo, mesa, onibus e forma de pagamento.
- Separar "cancelado" de "apagado": cancelado ainda entra como auditoria; apagado definitivo some.

Teste de aceite:
- Fluxo de venda em ate 2 acoes: valor + Enter.
- Fluxo de mesa em ate 3 acoes: tipo mesa + numero + valor.
- Nenhuma acao destrutiva sem confirmacao clara.

## Fase 3 - Temas completos

Objetivo: fazer temas reais, nao apenas trocar cor principal.

Status: avancada na versao 0.2.5 com tema claro padrao migrado para base azul de PDV e hover do DataCaixa corrigido para nao perder contraste em menus e configuracoes.

Temas:
- Claro suave: padrao confortavel, menos branco puro.
- Escuro: contraste bom sem fundo preto puro.
- Alto contraste: leitura e acessibilidade.
- DataCaixa PDV: azul operacional, status por cor, abas densas, bom para comercio.
- Italia: verde, branco e vermelho de forma elegante, com verde como base e vermelho apenas para estados/alertas.

Entregas:
- Expandir `ThemeMode` para incluir `datacaixa` e `italia`.
- Criar tokens CSS por tema: fundo, superficie, texto, borda, acento, sucesso, alerta, perigo, barra fixada.
- Corrigir todos os pontos que ficam presos na cor antiga.
- Ajustar controle de opacidade para chegar corretamente ao final.

Teste de aceite:
- Trocar tema e confirmar que app principal, barra fixada, botoes, campos, relatorios e servidor mudam juntos.
- Nenhum texto deve ficar ilegivel em qualquer tema.

## Fase 4 - Configuracoes refeitas por categoria

Objetivo: deixar configuracao entendivel para usuario leigo e completa para usuario avancado.

Status: iniciada na versao 0.2.0 com navegacao lateral de categorias, restauracao por categoria, atalhos editaveis e area de atualizacoes. Avancada na versao 0.2.2 com cabecalho por categoria, largura controlada para monitores grandes e grids mais previsiveis. Avancada na versao 0.2.3 com perfis aplicaveis e exportacao/importacao de configuracoes em JSON.

Categorias:
- Aparencia
- Barra fixada
- Barra rapida
- Vendas e mesas
- Dinheiro e troco
- Planilha e backup
- Relatorios
- Servidor e sincronizacao
- Permissoes
- Atalhos
- Atualizacoes
- Avancado

Entregas:
- Criar navegacao lateral dentro de Ajustes.
- Colocar explicacoes curtas apenas onde ajuda.
- Adicionar restaurar padroes por categoria.
- Adicionar exportar/importar configuracoes.
- Criar perfis: PC, Notebook, Tela pequena, Fixado, DataCaixa, Italia.

Teste de aceite:
- Usuario consegue achar configuracao de barra fixada sem procurar na tela inteira.
- Restaurar tema nao apaga vendas.
- Restaurar tudo pede confirmacao forte e preserva backup.

## Fase 5 - Relatorios profissionais

Objetivo: transformar relatorios em uma area de analise real.

Status: iniciada na versao 0.2.0 com filtros por periodo, tipo, mesa, onibus, pagamento, busca, totais sensiveis e exportacao filtrada.

Entregas:
- Filtros por periodo, tipo, mesa, onibus, forma de pagamento e origem.
- Cards de metricas: total, quantidade, media, maior venda, dinheiro, sobras, cancelados.
- Tabelas resumidas por mesa, onibus, tipo e pagamento.
- Exportar relatorio filtrado.
- Permissao para ocultar totais sensiveis.
- Estado "sem dados" com orientacao simples.

Teste de aceite:
- Filtrar um periodo e exportar apenas o que foi filtrado.
- Usuario sem permissao de totais nao ve valores sensiveis.

## Fase 6 - Barra rapida personalizavel

Objetivo: permitir personalizacao sem virar bagunca.

Status: iniciada na versao 0.2.1 com abas rapidas persistentes, editor em Ajustes, ativar/desativar, renomear, reordenar, modo compacto e vinculo Dinheiro/Troco.

Entregas:
- Criar modelo de "abas rapidas": Conta, Dinheiro, Mesa, Onibus e Personalizada.
- Permitir ativar/desativar abas.
- Permitir escolher campos por aba.
- Permitir ordem das abas.
- Atalhos por aba.
- Presets prontos para evitar que o usuario precise montar tudo do zero.

Decisao importante:
- Nao criar um construtor livre demais no primeiro momento. Comecar com presets editaveis e campos controlados.

Teste de aceite:
- Usuario cria uma aba "Onibus" com valor, numero do onibus, descricao e enviar.
- Barra continua compacta e legivel em largura pequena.

## Fase 7 - Servidor, conexao e permissoes

Objetivo: fazer o servidor parecer uma funcao segura e compreensivel.

Status: iniciada na versao 0.2.0 com subabas Criar servidor, Conectar e Permissoes, alem de mascara de valores quando totais sensiveis estao ocultos. Avancada na versao 0.2.1 com cliente remoto melhorado e API remota para editar, cancelar, enviar para lixeira e apagar definitivamente conforme permissoes.

Entregas:
- Separar "Criar servidor" e "Conectar a servidor".
- Explicar em linguagem simples: o que e servidor local, IP, porta, senha e permissao.
- Configurar o que sincroniza: lancamentos, configuracoes, relatorios, somente hoje.
- Permissoes por dispositivo: visualizar, registrar, editar, apagar, ver totais.
- Tela de dispositivos conectados com desconectar.
- Cliente remoto mais bonito e coerente com o app.

Teste de aceite:
- Um segundo PC/celular na rede conecta com senha.
- Dispositivo sem permissao de totais nao recebe totais pela API.

## Fase 8 - Icone, instalador e confiabilidade no Windows

Objetivo: deixar o app mais profissional no sistema.

Status: iniciada na versao 0.2.0 com icone em `assets/icon/`, fundo preto removido, `.ico` gerado e metadados do instalador configurados. Avancada na versao 0.2.2 com marca CDA no topo esquerdo do app. Assinatura de codigo ainda depende de certificado.

Entregas:
- Copiar o icone de referencia para `assets/icon/`.
- Remover fundo preto e gerar `.ico` com tamanhos corretos.
- Configurar icone no Electron Builder.
- Configurar `publisherName`, `productName`, atalhos e metadados do instalador.
- Documentar que reduzir SmartScreen/aviso de virus de verdade exige certificado de assinatura de codigo.
- Preparar assinatura no build quando houver certificado.

Teste de aceite:
- App mostra icone correto na janela, taskbar, atalho e instalador.
- Instalador cria atalhos corretos.

## Fase 9 - Atualizacoes via GitHub

Objetivo: avisar sobre releases novas sem atrapalhar o caixa.

Status: iniciada na versao 0.2.0 com checagem discreta de ultima release do GitHub na area de Atualizacoes.

Entregas:
- Checar releases do GitHub de forma discreta.
- Mostrar aviso pequeno em Ajustes ou rodape.
- Confirmar antes de baixar/instalar.
- Nunca atualizar durante registro ativo sem confirmacao.
- Preservar dados e configuracoes.

Decisao tecnica:
- Usar `electron-updater` depois que o instalador, icone e metadados estiverem estaveis.
- A versao portatil pode apenas abrir a pagina da release; auto-update completo fica melhor no instalador.

Teste de aceite:
- App detecta release nova e mostra aviso discreto.
- Instalador atualizado preserva dados locais.

## Fase 10 - Testes, release e controle de qualidade

Objetivo: cada versao sair testada e facil de baixar.

Status: smoke test cobre janela principal, tema DataCaixa, relatorios, barra fixada, planilha e servidor remoto com permissoes.

Entregas:
- Smoke test para janela principal.
- Smoke test para barra fixada.
- Smoke test para planilha.
- Smoke test para servidor local.
- Smoke test para tema DataCaixa e Italia.
- Checklist antes de release.
- Publicacao no GitHub com instalador e portatil.

## Primeiro pacote recomendado

Para a proxima implementacao, o melhor pacote e a Fase 1 inteira, mais uma pequena base da Fase 3:

1. Corrigir tema/barra fixada desde a abertura.
2. Fazer drag somente pela alca.
3. Corrigir foco do campo de valor.
4. Corrigir layout do troco.
5. Adicionar tipo tambem no modo dinheiro.
6. Criar apagar definitivo.
7. Criar tokens iniciais para temas `datacaixa` e `italia`, mesmo que a tela completa venha depois.
8. Atualizar smoke test e gerar release.

Esse pacote resolve bugs reais, melhora a sensacao do app e cria base para o remake visual sem quebrar tudo de uma vez.
