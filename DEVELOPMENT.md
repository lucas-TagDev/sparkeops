# Desenvolvimento

## Estrutura

- `src/store.ts`: métricas e compatibilidade da estrutura SQLite inicial.
- `src/platform.ts`: contas, sessões, autorização, clientes, agentes, regras, alertas, tokens e auditoria.
- `src/queries.ts`: consultas compartilhadas por MCP e assistente.
- `src/mcp.ts`: servidor MCP oficial, com instância isolada por requisição.
- `src/assistant.ts`: diagnóstico básico e adaptador OpenAI Responses.
- `src/ai-settings.ts`: chaves próprias cifradas por conta, seleção de provedor e controles de acesso.
- `src/ai-providers.ts`: adaptadores OpenAI, Claude, Grok, DeepSeek e Gemini, com teste de conexão sem inferência.
- `src/billing.ts`: checkout, portal e webhook Stripe.
- `src/worker.ts`: avaliação periódica, notificações e limpeza de retenção.
- `src/app.ts`: API Express, proteção de origem/Host, limites e arquivos estáticos.
- `web/`: painel React em português, responsivo, sem fontes ou imagens externas.
- `agent/`: coleta Python e instalador systemd.
- `tests/node/`: testes unitários, de integração HTTP e do cliente MCP oficial.
- `tests/agent/`: testes dos cálculos e validações do coletor Linux.

## Desenvolvimento local

Na primeira execução, use `npm ci --ignore-scripts`, `npm run build` e `npm start`. O build do painel fica em `dist`. O backend lê `.env` se o arquivo existir e cria o banco configurado por FOXOPS_DATABASE, por padrão `foxops.sqlite3`.

Para editar a API com reinício automático: `npm run dev`. Para editar o React com atualização automática, execute `npm run ui` em outro terminal. O Vite encaminha `/api`, `/agent` e `/mcp` para 127.0.0.1:8080. O uso local do Vite depende de proxy Host/Origin alinhado; o painel servido pela própria API é o caminho de verificação principal.

`npm run typecheck` verifica os tipos de backend, frontend, scripts e testes. O Node instalado executa TypeScript por remoção de tipos; a checagem de tipos é um comando separado. SQLite é nativo do Node e ainda emite aviso experimental na versão 22 instalada. As consultas usam parâmetros e as alterações de esquema são compatíveis com o banco inicial.

## API

Sessões do painel usam cookie HttpOnly `foxops_session`, SameSite=Lax, Secure quando PUBLIC_URL usa HTTPS. A API rejeita origens e hosts inesperados. O agente e MCP têm credenciais distintas; nenhum deles aceita o cookie como autorização.

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/health` | Estado do processo |
| GET | `/api/config` | Disponibilidade das integrações, sem segredos |
| POST | `/api/auth/signup` | Nome, empresa, e-mail e senha de 12 a 128 caracteres |
| POST | `/api/auth/login` | E-mail e senha |
| POST | `/api/auth/logout` | Invalida a sessão |
| POST | `/api/auth/accept-invite` | Token, nome e senha; usuários existentes usam a senha atual |
| GET | `/api/v1/me` | Usuário, conta, limites e organizações autorizadas |
| GET/POST | `/api/v1/organizations` | Listar/criar clientes |
| GET/POST | `/api/v1/servers` | Listar/cadastrar servidores |
| GET | `/api/v1/servers/:id` | Saúde e detalhes |
| GET | `/api/v1/servers/:id/history?hours=6` | Histórico, 1 a 168 horas, até 1000 pontos agregados |
| GET/PUT | `/api/v1/servers/:id/rules` | Limites e duração mínima |
| POST | `/api/v1/servers/:id/enrollment` | Novo token temporário |
| POST | `/api/v1/servers/:id/revoke` | Revoga a credencial do agente |
| POST | `/api/v1/servers/:id/archive` | Arquiva, revoga acesso e libera franquia |
| POST | `/api/agent/enroll` | Troca token temporário por credencial individual |
| POST | `/api/metrics` | Envio autenticado de métricas e detalhes |
| GET | `/api/v1/alerts` | Até 200 eventos autorizados |
| POST | `/api/v1/alerts/:id/acknowledge` | Reconhecimento de incidente |
| GET/POST | `/api/v1/tokens` | Listar/criar tokens MCP |
| DELETE | `/api/v1/tokens/:id` | Revogar token próprio |
| POST | `/mcp` | Streamable HTTP, somente Bearer MCP |
| GET | `/api/v1/members` | Membros, para administradores |
| POST | `/api/v1/invites` | Convite com perfil e clientes permitidos |
| DELETE | `/api/v1/members/:id` | Remove acesso, sessões e tokens |
| GET | `/api/v1/accounts` | Contas às quais o usuário pertence |
| POST | `/api/v1/accounts/switch` | Troca a sessão para outra conta autorizada |
| GET | `/api/v1/audit` | Até 100 eventos da conta, para administradores |
| GET | `/api/v1/chat?organization=ID` | Histórico do usuário no cliente |
| GET | `/api/v1/ai/status` | Estado da IA da conta, sem credenciais |
| GET/PUT | `/api/v1/ai/settings` | Metadados e modo/provedor selecionado |
| PUT/DELETE | `/api/v1/ai/providers/:provider` | Salvar, substituir, habilitar ou remover chave própria |
| POST | `/api/v1/ai/providers/:provider/test` | Consulta autenticada de modelos, sem métricas nem inferência |
| POST | `/api/v1/assistant` | organization, question e modo opcional diagnostic |
| GET | `/api/v1/billing` | Planos, limites e disponibilidade de checkout |
| POST | `/api/v1/billing/checkout` | Plano, exclusivo do proprietário |
| POST | `/api/v1/billing/portal` | Portal da assinatura existente |
| POST | `/api/billing/webhook` | Corpo bruto e assinatura Stripe |

Envelope de métricas: `{ "event_id": "identificador-unico", "metrics": { "cpu_percent": 10, "memory_percent": 20, "disk_percent": 30 }, "details": {} }`. Os três valores devem ser números finitos entre 0 e 100. A deduplicação é por servidor e evento. A referência de tempo é o recebimento pela API, não um relógio confiado ao agente. Detalhes não têm autorização independente: são vinculados ao mesmo token do servidor.

O token de instalação é válido por 15 minutos e armazenado somente como hash. O agente definitivo tem outra credencial. Tokens MCP são revogáveis e expiram; as permissões do membro são revalidadas em cada requisição. A seleção visual de cliente não determina autorização: o backend verifica conta, organização e perfil em cada consulta.

## Regras e planos

Padrões: CPU 85%, memória 90%, disco 90%, ausência de comunicação 120 segundos, duração mínima 60 segundos. A checagem periódica ocorre a cada 15 segundos e também após uma coleta. Ficar offline não prova recuperação de um alerta de utilização. Serviços com estado desconhecido também não provam recuperação.

Uma conta em avaliação tem 14 dias, 5 servidores e 3 clientes. Os planos pagos têm franquias de servidores, clientes, histórico e IA definidas em PLANS. O uso de IA só é debitado quando o provedor está configurado. Após expiração ou assinatura inativa, o inventário continua acessível; a ingestão e novas consultas MCP/IA ficam bloqueadas até regularização.

## Compatibilidade e validação

A rota antiga `/api/servers` só existe se FOXOPS_ADMIN_TOKEN for explicitamente configurado e não pode ser usada em produção. Não use essa rota para o painel novo. Registros legados sem associação às organizações novas não são expostos automaticamente a contas recém-criadas.

Execute `npm run check` e `python -m unittest discover -s tests/agent -v`. Os testes HTTP exigem acesso ao loopback. O teste de IA usa um provedor simulado; o teste Stripe usa assinaturas geradas localmente; nenhum deles chama serviços pagos. O instalador foi preparado para Linux com systemd, mas não foi executado nessa plataforma durante esta sessão.
