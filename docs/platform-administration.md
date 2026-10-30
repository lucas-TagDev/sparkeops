# Administração geral da plataforma

O menu **Administração da plataforma** aparece apenas para contas autorizadas por `FOXOPS_PLATFORM_ADMIN_EMAILS` que tenham perfil de proprietário ou administrador. Ser proprietário de uma empresa não concede acesso global.

Na lista, pesquise pelo nome da empresa, nome ou e-mail de um membro e selecione **Gerenciar**. A lista é paginada. Os totais mostram usuários, clientes e servidores do workspace.

A área permite renomear workspaces, criar e renomear clientes, convidar membros, editar seus perfis e clientes autorizados e remover seu acesso ao workspace. Os convites expiram após 24 horas e devem ser compartilhados pelo administrador.

Proprietários e administradores têm acesso a todos os clientes do workspace. Operadores e leitores precisam de pelo menos um cliente autorizado. Não é permitido remover ou rebaixar o último proprietário, nem alterar o próprio acesso pela administração geral.

Alterações de perfil encerram as sessões desse usuário no workspace. A remoção também revoga seus tokens MCP nesse workspace, preservando seus outros vínculos. Cada alteração administrativa registra o nome e e-mail do administrador na auditoria do workspace afetado e da conta administrativa.

A lista global retorna metadados de contas e membros. Senhas, chaves de IA e credenciais de agentes não são retornadas.

## Planos e preços

Na administração geral, abra a aba **Planos e preços**. Os planos originais são preservados e podem ser editados. **Novo plano** cria uma opção comercial com código próprio. O cadastro permite definir nome, descrição, preço em BRL/USD/EUR, cobrança mensal ou anual, limites de servidores, clientes, consultas de IA e retenção de métricas. O preço é armazenado em centavos; a interface aceita vírgula ou ponto decimal.

O plano de avaliação permanece gratuito e ativo. Seu prazo é aplicado a novos cadastros. Alterar seus limites ou os limites de um plano pago afeta os workspaces desse plano; reduzir a retenção permite que a limpeza periódica remova métricas antigas. O limite de IA de desenvolvimento, quando configurado explicitamente por ambiente, continua tendo prioridade no ambiente de desenvolvimento.

**Salvar plano** grava o catálogo e seus limites. Para vender online, configure `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET`; em seguida salve o preço e selecione **Publicar preço na Stripe**. A publicação cria um preço recorrente para futuras contratações. Não é necessário cadastrar manualmente códigos de preço de planos novos no ambiente. Configurações antigas de `STRIPE_PRICE_*` continuam aceitas como preços legados, e seu vínculo ao plano fica preservado para webhooks.

Editar valor, moeda ou periodicidade suspende novas contratações desse preço até a publicação da nova versão. Desmarcar **Disponível para novas contratações** retira o plano da vitrine e bloqueia novos checkouts. Workspaces existentes permanecem no plano. A tela **Plano e consumo** usa os nomes, preços e limites do catálogo salvo.

Assinaturas existentes não são reajustadas por essa publicação: continuam com seu preço contratado na Stripe. O histórico de vínculos de preços é mantido para que webhooks de preços antigos continuem reconhecidos, inclusive após a desativação comercial do plano. O checkout valida o preço, moeda, periodicidade e versão do catálogo antes de abrir a cobrança. As mudanças ficam na auditoria com o administrador responsável.

A integração foi validada com a Stripe simulada, sem gerar cobranças ou alterar assinaturas reais. Referências: [criação de preços](https://docs.stripe.com/api/prices/create) e [gestão de preços](https://docs.stripe.com/products-prices/manage-prices).
