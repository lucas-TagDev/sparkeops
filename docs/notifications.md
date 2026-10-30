# Notificações por organização

Proprietários e administradores acessam **Configurações → Notificações por organização** e selecionam a organização. Cada organização tem configurações independentes para Telegram, WhatsApp Business e e-mail. Operadores e leitores não consultam nem alteram essas credenciais. O escopo de organização da sessão também é respeitado.

Selecione abertura e/ou recuperação e os tipos: falta de comunicação, CPU, memória, disco, serviços e URLs. A detecção continua respeitando os limites e a duração configurados nas regras do monitor. Não há envio periódico enquanto o mesmo incidente permanece aberto. Configurar um canal não dispara alertas históricos.

## Telegram

Crie um bot no BotFather. Cole o token e o ID do chat de destino. O usuário deve iniciar uma conversa com o bot; para grupos, adicione o bot e permita o envio de mensagens. Salve, habilite e use **Enviar teste salvo**.

Documentação: https://core.telegram.org/bots/api#sendmessage

## WhatsApp Business

Configure o token da API oficial Meta, ID do número comercial, número destinatário com código do país (somente dígitos), versão suportada da Graph API, nome do modelo aprovado e seu idioma (ex.: `pt_BR`). O modelo deve ter **exatamente uma variável de texto no corpo `{{1}}`** para receber o resumo completo, sem outros parâmetros obrigatórios. Exemplo de corpo: `Notificação do monitoramento: {{1}}`.

O destinatário precisa autorizar as mensagens. Cadastro, aprovação do modelo e eventuais cobranças são feitos na Meta. Não é integração via QR code do WhatsApp pessoal. O envio de teste usa o modelo e destinatário salvos.

Documentação do formato: https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/

## E-mail

Informe servidor SMTP público, porta 465 (TLS direto) ou 587 (STARTTLS obrigatório), usuário, senha, remetente autorizado pelo provedor e até dez destinatários separados por vírgula. Certificados TLS são verificados. Endereços SMTP internos, locais e reservados são bloqueados. Não são enviados logs nem arquivos por e-mail.

## Entregas e credenciais

Credenciais são criptografadas usando o cofre existente da instalação e nunca retornadas pela API. Campos secretos vazios preservam o valor salvo. Desative o canal para interromper novos envios e cancelar pendências quando o worker as processar. Alterações e testes ficam registrados com o autor na auditoria.

A fila trata cada canal separadamente. Uma falha é repetida até oito tentativas com intervalo crescente (máximo uma hora). O painel mostra os últimos 20 envios e seus estados; registros terminados são removidos após 30 dias. “Enviado” significa aceito pelo provedor SMTP/API, não confirmação de leitura ou entrega ao aparelho. Retentativas após uma falha de rede podem duplicar uma mensagem já aceita pelo provedor.

O webhook global antigo continua independente das notificações por organização. Faça backup do banco e do arquivo `.secrets/ai-master.key` (ou `FOXOPS_AI_KEY_FILE`) juntos. Perder a chave impede recuperar as credenciais.
