# Cloudflare Turnstile

Em **Administração da plataforma → Segurança e CAPTCHA**, o administrador geral configura a Site Key pública e a Secret Key protegida por criptografia. Clientes não podem alterar essa configuração global.

1. Crie um widget no [painel Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile).
2. Autorize o hostname mostrado no painel SparkeOPS (a partir de PUBLIC_URL), sem protocolo, caminho ou porta.
3. Informe Site Key e Secret Key. Inicialmente deixe a proteção desabilitada e salve.
4. Use **Testar configuração salva**, conclua o desafio e pressione **Validar teste no servidor**.
5. Marque os formulários desejados, habilite a proteção e salve. Para trocar de Site Key, informe também a Secret Key correspondente.

São protegidos o cadastro (incluindo aceite de convites), o login e a solicitação/conclusão da redefinição de senha. As opções podem ser habilitadas separadamente. A confirmação de mudança de e-mail e a troca autenticada de senha mantêm suas próprias validações.

A validação no servidor consulta o Siteverify da Cloudflare, confere o hostname e a ação, rejeita tokens vencidos ou reutilizados e mantém os limites de tentativas existentes. Os tokens de desafio não são armazenados em texto: somente hashes temporários são retidos para impedir reutilização concorrente. A Secret Key nunca é enviada ao navegador nem incluída nos registros de auditoria.

Quando a proteção está habilitada, uma indisponibilidade ou falha de verificação bloqueia o formulário. A interface permite repetir o desafio. Teste antes de sair da sessão administrativa; uma sessão já autenticada permite desabilitar o CAPTCHA no painel caso a configuração esteja incorreta.

O CAPTCHA vem desabilitado por padrão. Instalações locais também precisam de um hostname autorizado na Cloudflare e de PUBLIC_URL consistente com o endereço de acesso. Os testes automatizados usam uma Cloudflare simulada e não substituem o teste com suas chaves e seu domínio.

Referências oficiais: [integração no navegador](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/) e [validação no servidor](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
