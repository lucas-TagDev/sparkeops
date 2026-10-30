# FoxOps · Monitoramento Linux com MCP

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

Preparado para uma instância Node.js com SQLite. Não foi publicado em domínio externo. IA paga e checkout real dependem das suas credenciais. O instalador systemd e a imagem Docker precisam ser validados no ambiente de destino; Linux/WSL e Docker não estão disponíveis nesta máquina. Recuperação de senha por e-mail, MFA e coleta de logs ficam fora desta versão.

Veja [Serviços, logs e ações aprovadas por SSH](docs/SERVICES-SSH.md) para configurar nginx, Apache e PHP-FPM.


Edição controlada de parâmetros de serviços: comparação antes/depois, sugestão opcional de IA, aprovação, backup no Ubuntu, validação e restauração em caso de falha. Consulte [o fluxo e os perfis suportados](docs/SERVICES-SSH.md).

Modo agente no chat: a IA pode planejar comandos SSH fora do catálogo de monitoramento, com aprovação de cada execução e retorno da saída para análise. Execução administrativa genérica é opt-in no Ubuntu; consulte os limites e a habilitação em docs/SERVICES-SSH.md.

Interface em Português, Inglês e Espanhol, com preferência por usuário e idioma das novas respostas da IA. Veja [Idiomas](docs/I18N.md).

Marca global configurável por administradores explícitos: nome, logo, favicon e cor principal. Veja [Identidade visual](docs/BRANDING.md).


## Instalador da plataforma no Linux

Gere o pacote com `npm run package:linux`. O guia [Instalação Linux](docs/instalacao-linux.md) inclui instalação local, produção com HTTPS, atualização e backups. O instalador da plataforma é `deploy/install.sh`; o arquivo `agent/install.sh` instala somente o agente monitorado.
