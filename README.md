# SparkeOPS · Monitoramento Linux com MCP

MVP integrado de SaaS para empresas e prestadores de TI: painel React, API Node.js/TypeScript, agente Linux Python, persistência SQLite, monitoramento contínuo e consultas por IA/MCP.

## Executar na sua máquina

Requer Node.js 22.18 ou superior; a máquina de desenvolvimento possui 22.23.2.

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build
npm.cmd start
```

Abra **http://127.0.0.1:8080**, selecione **Começar agora** e crie sua conta. O painel funciona sem chaves externas. O script `start.ps1` automatiza a instalação das dependências, compilação e início. Não há credencial administrativa padrão.

## O que está implementado

| Área | Funcionalidade |
| --- | --- |
| Contas | Cadastro, login, senha com scrypt, sessão HttpOnly, logout e avaliação de 14 dias |
| Clientes | Organizações separadas, inventário consolidado e filtros por cliente |
| Equipe | Convites de uso único, proprietário/administrador/operador/leitor e acesso por cliente |
| Servidores | Cadastro, instalação temporária, credencial individual, reinstalação, revogação e arquivamento |
| Agente Linux | CPU, memória, disco raiz, rede acumulada, uptime, hostname e serviços configurados |
| Métricas | Histórico agregado por minuto, gráficos, deduplicação e retenção por plano |
| Alertas | Limites de CPU/memória/disco, ausência de comunicação e serviços; duração, reconhecimento e recuperação |
| Notificações | Fila persistente e tentativas de reenvio para webhook HTTPS opcional |
| Assistente | Diagnóstico por regras; OpenAI, Claude, Grok, DeepSeek e Gemini com chaves próprias pelo painel, histórico e franquia diária |
| MCP | Doze ferramentas via Streamable HTTP, incluindo verificações locais de logs, processos e propostas de ações; tokens com escopo, validade e revogação |
| Planos | Limites aplicados no backend, avaliação e três planos comerciais |
| Cobrança | Checkout e portal Stripe quando configurados; atualização por webhook assinado |
| Operação | Auditoria, backup consistente, variáveis de ambiente, Dockerfile e exemplo de proxy HTTPS |

As telas usam dados persistidos; não há métricas demonstrativas misturadas com monitoramento real. A conta criada durante a inspeção visual é identificada como **Ambiente de teste local**, com um servidor ainda sem agente conectado.

## Configurações externas

Para chaves próprias de IA, use **Configurações → Inteligência artificial** com o perfil proprietário: selecione o provedor, informe modelo e chave, salve e teste a conexão. As chaves são cifradas e isoladas por conta. O seletor define o provedor em uso, a IA compartilhada da plataforma (se disponível) ou somente o diagnóstico básico.

Copie `.env.example` para `.env` para configurar a IA compartilhada, Stripe, notificações ou publicação. Credenciais ficam no servidor. Preserve o arquivo mestre `.secrets/ai-master.key` com backup separado do banco. O painel informa quais integrações estão ativas e não simula respostas de IA nem pagamentos reais.

MCP externo funciona com clientes que aceitam URL HTTP e cabeçalho Bearer. OAuth MCP não está implementado. O agente só inicia conexões de saída; ações por SSH exigem aprovação explícita no painel. O MCP prepara propostas, sem executá-las.

## Verificar

```powershell
npm.cmd run check
python -m unittest discover -s tests/agent -v
```

Os testes cobrem isolamento de contas e clientes, perfis, sessões, instalação e revogação de agentes, franquias, alertas e recuperações, cliente MCP oficial, provedor de IA simulado e webhook Stripe assinado. Os testes Python verificam os cálculos do agente com contadores Linux simulados.

## Documentação

- [Desenvolvimento e API](DEVELOPMENT.md)
- [Publicação, agentes, IA, cobrança, MCP e backup](docs/DEPLOYMENT.md)

## Limites do MVP

Preparado para uma instância Node.js com SQLite. Não foi publicado em domínio externo. IA paga e checkout real dependem das suas credenciais. O instalador systemd e a imagem Docker precisam ser validados no ambiente de destino; Linux/WSL e Docker não estão disponíveis nesta máquina. Recuperação de senha por e-mail exige configurar o SMTP da plataforma. MFA ainda não está implementado.

Veja [Serviços, logs e ações aprovadas por SSH](docs/SERVICES-SSH.md) para configurar nginx, Apache e PHP-FPM.


Edição controlada de parâmetros de serviços: comparação antes/depois, sugestão opcional de IA, aprovação, backup no Ubuntu, validação e restauração em caso de falha. Consulte [o fluxo e os perfis suportados](docs/SERVICES-SSH.md).

Modo agente no chat: a IA pode planejar comandos SSH fora do catálogo de monitoramento, com aprovação de cada execução e retorno da saída para análise. Execução administrativa genérica é opt-in no Ubuntu; consulte os limites e a habilitação em docs/SERVICES-SSH.md.

Interface em Português, Inglês e Espanhol, com preferência por usuário e idioma das novas respostas da IA. Veja [Idiomas](docs/I18N.md).

Marca global configurável por administradores explícitos: nome, logo, favicon e cor principal. Veja [Identidade visual](docs/BRANDING.md).


## Instalar diretamente pelo GitHub

O repositório é privado. Autentique sua conta do GitHub com acesso ao projeto; não coloque tokens na URL nem nos comandos salvos.

Instale o Git, se necessário (`sudo apt install git` no Debian/Ubuntu ou `sudo dnf install git` no Rocky/AlmaLinux/Fedora). Depois:

```bash
git clone https://github.com/lucas-TagDev/sparkeops.git
cd sparkeops
bash deploy/install.sh --check
```

Para teste na rede local, substitua o IP pelo endereço do Linux que hospedará o painel e informe seu e-mail:

```bash
sudo bash deploy/install.sh --local \
  --public-url http://IP_DO_LINUX:8080 \
  --admin-email seu@email.com
```

Para produção com domínio HTTPS:

```bash
sudo bash deploy/install.sh \
  --public-url https://monitor.suaempresa.com \
  --admin-email seu@email.com
```

Em produção, o instalador configura o proxy HTTPS e emite o certificado automaticamente. **Antes de continuar, o domínio deve apontar para o servidor e as portas TCP 80 e 443 devem estar abertas no firewall, provedor e NAT.** O instalador exige essa confirmação e mantém a renovação automática do certificado. Veja o [guia completo](docs/instalacao-linux.md). Cadastre a primeira conta no painel com o e-mail informado para administrar a plataforma.

Para atualizar a instalação existente, dentro do clone:

```bash
git pull --ff-only
sudo bash deploy/install.sh
```

O instalador preserva as configurações existentes e faz backup dos dados antes da troca de versão. Não repita as opções da primeira instalação na atualização.

## Instalador da plataforma no Linux

Gere o pacote com `npm run package:linux`. O guia [Instalação Linux](docs/instalacao-linux.md) inclui instalação local, produção com HTTPS, atualização e backups. O instalador da plataforma é `deploy/install.sh`; o arquivo `agent/install.sh` instala somente o agente monitorado.


## CAPTCHA nos formulários públicos

Configure o **Cloudflare Turnstile** em **Administração da plataforma → Segurança e CAPTCHA**. Informe Site Key e Secret Key, teste o desafio no painel e habilite separadamente cadastro, login e solicitação/redefinição de senha. A Secret Key fica criptografada e a validação também ocorre no servidor. Veja o [guia Turnstile](docs/turnstile.md).


## Desinstalar

No Linux, execute `sudo bash deploy/uninstall.sh` para remover programa e serviços preservando os dados. Use `--dry-run` para simular ou `--purge-data` para remover também os dados, com confirmação obrigatória. Veja os detalhes no [guia Linux](docs/instalacao-linux.md#remover-a-instalação).


## Modelos locais e APIs compatíveis

Use **API compatível / Local** nas configurações de IA para conectar LM Studio e serviços compatíveis com Chat Completions. O administrador geral autoriza o destino em **Endpoints de IA**; o proprietário informa URL base, modelo e chave opcional. Veja o [guia de LLM local](docs/llm-local.md).


## Confirmação de novas contas

O administrador geral pode habilitar **Exigir confirmação de e-mail nos novos cadastros** em **Administração da plataforma → E-mails da plataforma**. Requer SMTP habilitado; teste o envio antes de ativar. Novas contas ficam sem sessão até confirmar o link, com validade de 30 minutos e opção de reenvio. Contas existentes não são bloqueadas. Consulte o [guia de e-mails](docs/platform-email.md).

- [Painéis públicos para TV](docs/paineis-publicos.md): publique servidores e URLs selecionados em um link de consulta.

