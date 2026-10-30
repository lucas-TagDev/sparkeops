# Identidade visual da plataforma

Abra Configurações > Identidade visual da plataforma usando um administrador global autorizado. O formulário permite nome, logo, favicon e cor principal, com prévia local, confirmação, salvamento e restauração do padrão FoxOps. Salvar a prévia afeta todos os clientes, incluindo login, menu, rodapé, identificação do assistente e título/ícone da aba. Sessões abertas consultam a marca pública a cada minuto; uma atualização da página também a carrega. A troca de idioma preserva o nome personalizado e os arquivos.

## Administradores globais

Defina FOXOPS_PLATFORM_ADMIN_EMAILS no ambiente do servidor com emails separados por vírgula e reinicie a aplicação. A pessoa precisa ter sessão autenticada com esse email e papel owner/admin no workspace atual. Proprietários de contas de clientes NÃO recebem essa autorização automaticamente. A lista não pode ser alterada por cadastro, convite, formulário ou API de branding. Por padrão, uma instalação sem essa configuração não tem nenhum editor global.

Neste ambiente local, a conta de testes qa@foxops.example foi explicitamente autorizada. Em produção, substitua-a pelo email administrativo real. Isso só concede autorização de identidade visual; não cria acesso aos dados ou servidores de outros clientes. O token administrativo legado não é usado.

## Arquivos e armazenamento

Logo: PNG, JPEG ou WebP. Favicon também aceita ICO. Até 512 KB por arquivo; SVG e URLs remotas são recusados. O backend valida o tipo declarado contra a assinatura dos bytes e limita PNG a 4096 pixels por lado. As imagens ficam armazenadas em platform_settings no SQLite e são publicadas somente como imagens nas rotas /branding/logo e /branding/favicon. O endpoint público /api/branding retorna nome, cor e URLs, nunca a lista de administradores. Nome e cor passam por validação; conteúdo é renderizado como texto, não HTML.

A cor principal controla os destaques e os botões principais. A cor do texto dos botões é escolhida para contraste com o fundo; as cores técnicas de gráficos e estados de erro não são redefinidas. Nomes internos de serviços, rotas MCP, unidades do agente e comandos continuam usando identificadores técnicos FoxOps para compatibilidade. A personalização por cliente (white-label independente para cada conta), domínios próprios e emails transacionais não fazem parte desta configuração global.

O backup do banco inclui a marca. Restaurar padrão remove a personalização global; o formulário pede confirmação. Não altera servidores, agentes, credenciais, assinaturas nem o histórico. Atualizações e restaurações entram na auditoria do administrador.

## Verificação

Testes cobrem bloqueio de proprietários de clientes, autenticação, leitura pública, assinatura de imagens, persistência, restauração, idiomas do formulário e aplicação dos metadados. Não foi feita inspeção visual no navegador nesta sessão porque o acesso ao navegador está desabilitado nas configurações do Work.
