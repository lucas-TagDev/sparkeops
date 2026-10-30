# Configurar Mercado Pago

Abra **Administração da plataforma → Pagamentos** como administrador geral.

1. Abra **Suas integrações** no painel do Mercado Pago e selecione a aplicação da sua conta brasileira.
2. Copie o **Access Token** para o campo correspondente no SparkeOPS.
3. Configure as notificações da integração usando a **URL do webhook** exibida no SparkeOPS. Selecione pagamentos e planos/assinaturas, incluindo `payment`, `subscription_preapproval` e `subscription_authorized_payment`. Copie a chave de assinatura gerada para o campo **Chave de assinatura do webhook**.
4. Marque **Habilitar novas assinaturas pelo Mercado Pago**, clique em **Salvar credenciais** e depois em **Verificar credencial**. Essa verificação consulta a conta; não cria cobrança.
5. Em **Planos e preços**, salve os valores em BRL e a periodicidade mensal ou anual. As novas assinaturas usam esses valores; a publicação de preços na Stripe pertence apenas à integração Stripe.

O endereço público da instalação precisa usar HTTPS. No servidor, configure `PUBLIC_URL=https://seu-dominio` e o acesso HTTPS/reverse proxy correspondente; reinicie a aplicação após alterar o endereço. Um endereço como `http://192.168.3.41:8080` funciona para testar o painel na rede local, mas não recebe confirmações de pagamento do Mercado Pago. O painel informa essa pendência e não libera novas contratações enquanto o endereço continuar local.

As credenciais são cifradas no banco com a chave de proteção da instalação. Não são devolvidas ao navegador nem registradas na auditoria. Ao editar a configuração, deixe os campos secretos vazios para mantê-los. O backup precisa preservar o banco e o arquivo de proteção `.secrets/ai-master.key` (ou o caminho configurado para ele).

O checkout abre o ambiente do Mercado Pago; dados do cartão não passam pelo painel. Se Stripe e Mercado Pago estiverem disponíveis para o mesmo plano, o cliente escolhe o provedor em **Plano e consumo**. Nesta integração Mercado Pago, os planos são cobrados em reais e vinculados a uma conta brasileira.

Criar ou autorizar uma assinatura não ativa o plano pago por si só. A plataforma verifica a assinatura HMAC da notificação e consulta a fatura, a assinatura e o pagamento na API. A ativação exige pagamento aprovado, valor, moeda e vendedor correspondentes ao cadastro. Notificações repetidas não prolongam o período pago. A confirmação é automática por webhook; o retorno do checkout não concede acesso por conta própria.

O proprietário pode cancelar a assinatura ou uma contratação pendente pelo próprio painel. O cancelamento impede novas cobranças e mantém o acesso até o fim do período pago. Estornos são reconciliados pelas notificações de pagamento. Ao final do período sem renovação confirmada, o acesso aos recursos pagos é bloqueado. Desabilitar Mercado Pago na administração bloqueia novas contratações e mantém o processamento das notificações de assinaturas existentes.

A implementação foi testada com respostas simuladas, incluindo notificações assinadas, duplicatas, valores incompatíveis, cancelamento e estorno. Uma compra real ou de teste na sua conta ainda precisa ser validada após configurar credenciais e o domínio público. A verificação da credencial não comprova a entrega do webhook.

Referências oficiais: [assinaturas com pagamento pendente](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments), [notificações e assinatura de webhooks](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks), [dados de fatura](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-authorized-payment/get).
