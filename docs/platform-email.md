# E-mails da plataforma

Em **Administração da plataforma → E-mails da plataforma**, o administrador geral cadastra servidor SMTP, porta (587 com STARTTLS ou 465 com TLS), usuário, senha e endereço remetente. O nome exibido usa a identidade visual da plataforma. Salve e use **Enviar teste para meu e-mail**. O teste é enviado apenas ao administrador autenticado.

A configuração é global e independente dos canais de alertas das organizações. O servidor SMTP precisa resolver para um endereço público e apresentar certificado TLS válido. Configure o remetente autorizado e os registros SPF/DKIM/DMARC conforme seu provedor. A URL exibida é a `PUBLIC_URL` da instalação; use HTTPS em produção.

Com o envio habilitado:

- Novos cadastros recebem boas-vindas.
- **Esqueci minha senha**, na entrada, envia um link de recuperação. A resposta pública é igual para endereços existentes e desconhecidos.
- **Configurações → E-mail da minha conta** solicita o novo endereço e a senha atual. O endereço só é alterado após confirmação no novo e-mail. O endereço anterior recebe aviso após a mudança.
- Recuperações e redefinições pelo administrador geram avisos de segurança, sem incluir senhas nos e-mails.

Links expiram em 30 minutos, são de uso único e são invalidados após mudança de senha ou e-mail. Desativação e redefinição administrativa também invalidam os links pendentes. Alterações encerram sessões e revogam tokens MCP do usuário. A troca de e-mail de um administrador geral exige atualizar a lista `FOXOPS_PLATFORM_ADMIN_EMAILS` para preservar sua permissão global.

Credenciais SMTP e mensagens pendentes são criptografadas usando o cofre da instalação. Inclua `.secrets/ai-master.key` no backup protegido. O banco guarda somente hashes dos tokens de recuperação; links completos permanecem apenas dentro das mensagens cifradas até o envio.

O worker tenta novamente falhas de envio, até cinco tentativas, sem enviar links já expirados. A tela informa pendências, falhas e último envio. Após o envio, o conteúdo é apagado; registros antigos são limpos automaticamente. Sem um provedor configurado, nenhum e-mail é enviado.

Verificação automatizada usa SMTP simulado e não envia mensagens reais. A entrega efetiva depende de salvar credenciais válidas e testar o remetente no ambiente de produção.

## Alterar a própria senha

Em **Configurações → Alterar minha senha**, qualquer usuário autenticado pode informar a senha atual, uma nova senha de 12 a 128 caracteres e sua confirmação. A nova senha deve ser diferente da anterior. A operação funciona sem SMTP; quando habilitado, o e-mail envia um aviso sem incluir a senha.

As sessões antigas, tokens MCP e links de recuperação pendentes são invalidados. O navegador que solicitou a alteração recebe uma nova sessão e continua conectado. A ação fica registrada na auditoria como `user.password.changed`.


## Confirmação obrigatória de conta (opcional)

Em **Administração da plataforma → E-mails da plataforma**, o administrador geral pode marcar **Exigir confirmação de e-mail nos novos cadastros**. A opção vem desligada. Habilite e teste primeiro o SMTP e configure PUBLIC_URL com o endereço público correto.

Enquanto habilitada, novos cadastros e novas contas criadas por convite recebem um link de confirmação com validade de 30 minutos. O cadastro não cria sessão autenticada e o login não é liberado antes da confirmação. O link abre uma tela com um botão de confirmação: apenas abrir a URL por GET não ativa a conta, para evitar ativação por scanners de e-mail.

A tela de entrada oferece reenvio com resposta genérica, limites por IP/e-mail e CAPTCHA de cadastro quando configurado. Reenviar invalida links anteriores. Os tokens são de uso único, vinculados ao e-mail e à senha atuais e armazenados somente como hash; o e-mail na fila é criptografado. Trocar a senha invalida um link antigo: solicite outro na tela de entrada.

Contas existentes não são bloqueadas ao ativar a opção. Desabilitar a exigência permite login às contas pendentes; reabilitar volta a exigir a confirmação das contas que ficaram pendentes. Contas desativadas por um administrador não podem ser reativadas pelo link. Os clientes não podem alterar essa política global.

O SMTP não pode ser desabilitado enquanto a exigência estiver ligada. O envio é assíncrono; acompanhe a fila e teste a entrega real. Os testes automatizados usam um remetente simulado.
