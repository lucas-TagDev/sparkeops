# Publicação e operação

O projeto executa em Node.js e mantém os dados em SQLite. O painel e a API usam a mesma origem. A versão atual é um MVP para uma instância da aplicação; múltiplas réplicas exigem migração do armazenamento e coordenação do worker.

## Publicar em um servidor Linux

1. Instale Node.js 22.18 ou superior, ou use Docker.
2. Copie o projeto, instale com `npm ci --ignore-scripts` e execute `npm run build`.
3. Copie `.env.example` para `.env` e configure `PUBLIC_URL=https://monitoramento.suaempresa.com`, `HOST=127.0.0.1` e `NODE_ENV=production`.
4. Inicie `npm start` sob um gerenciador de serviços, com usuário sem privilégios e diretório de dados gravável.
5. Use um proxy HTTPS na frente da API. Um exemplo Caddy está em `deploy/Caddyfile.example`.
6. Aponte o domínio para o servidor. O Host encaminhado deve corresponder a PUBLIC_URL. Configure `TRUST_PROXY=1` apenas se o acesso direto à API estiver restrito a um único proxy confiável.
7. Abra o endereço e crie a conta proprietária. Contas de clientes e prestadores são separadas; dentro de cada conta podem existir vários clientes.

No Docker, `.env` precisa existir e conter PUBLIC_URL com HTTPS. `docker compose up -d --build` mantém o banco no volume `foxops-data` e publica a porta apenas no loopback do host. Use o proxy HTTPS no host. A imagem executa como usuário `node`. Docker não estava disponível no ambiente Windows de desenvolvimento; a imagem e o compose precisam de validação no destino.

Não configure FOXOPS_ADMIN_TOKEN em produção. Essa variável ativa exclusivamente a compatibilidade com a primeira API de desenvolvimento; o processo recusa sua presença em modo de produção.

## Ativar IA

No Assistente, selecione o cliente e o servidor da conversa. O padrão é um servidor específico; Todos os servidores deste cliente é uma opção explícita para visão consolidada. Cada servidor tem seu próprio histórico, separado da conversa consolidada. O envio à IA inclui somente o servidor selecionado, seus alertas e até seis interações anteriores do mesmo escopo. O assistente consulta métricas já recebidas; conversar não executa nova coleta no Linux. As mensagens antigas da versão anterior ficam no histórico consolidado.

### Chaves próprias pelo painel

O proprietário de cada conta acessa **Configurações → Inteligência artificial**. Há cartões para **OpenAI, Claude, Grok, DeepSeek e Gemini**. Em cada um, informe o ID do modelo e a chave, marque Habilitar e salve. Não há necessidade de editar `.env` para as chaves dos clientes. A primeira configuração habilitada vira a seleção inicial; depois, o seletor de modo ou o botão Usar no assistente define o provedor em uso. Salvar outros provedores não altera uma escolha explícita já feita.

Testar conexão consulta a lista de modelos do provedor usando a chave já salva. Não envia métricas nem gera texto. A ausência do modelo na listagem é exibida como aviso: aliases e permissões podem variar. O cadastro não valida a chave com chamadas externas automaticamente. Teste os modelos disponíveis na sua própria conta; não há um ID de modelo fixo imposto pelo produto.

As credenciais são cifradas com AES-256-GCM e vinculadas à conta e ao provedor como dados autenticados. As respostas da API de configurações nunca contêm a chave completa, partes dela ou o ciphertext. Administradores podem consultar metadados; somente o proprietário salva, seleciona, testa ou remove credenciais. Membros autorizados usam o assistente com a configuração da própria conta e os dados dos clientes que podem acessar.

A proteção usa um arquivo de 32 bytes gerado automaticamente na primeira gravação. Por padrão, ele fica em `.secrets/ai-master.key` junto do diretório do banco. No Docker fica sob `/data/.secrets/`, no volume persistente. `FOXOPS_AI_KEY_FILE` permite escolher outro caminho persistente. O arquivo não deve ir para Git nem ser copiado para a imagem Docker. Faça backup seguro desse arquivo **separadamente do banco**: sem ele não é possível abrir as credenciais antigas. A aplicação não gera outra chave automaticamente se já existirem credenciais cifradas e o arquivo estiver ausente.

Chave desabilitada, removida ou modo desligado deixam o assistente no diagnóstico básico. Falhas de autenticação não fazem troca automática de provedor ou uso da chave global. A escolha de provedor é explícita e registrada na auditoria. O consumo por chamada permanece contabilizado na conta; a cobrança da API própria é feita diretamente pelo provedor.

Em produção, cadastre chaves somente com HTTPS. A UI sinaliza que HTTP na rede de teste não cifra o tráfego. As integrações foram verificadas com respostas simuladas; a validação real depende da chave e do modelo que o proprietário cadastrar.

Referências das integrações: [OpenAI](https://developers.openai.com/api/docs/guides/text), [Claude](https://platform.claude.com/docs/en/api/overview), [Grok](https://docs.x.ai/developers/model-capabilities/legacy/chat-completions), [DeepSeek](https://api-docs.deepseek.com/) e [Gemini](https://ai.google.dev/api/generate-content).

### IA compartilhada da plataforma

Opcionalmente, configure `OPENAI_API_KEY` e `OPENAI_MODEL` na aplicação e reinicie o serviço. Essa configuração disponibiliza a opção IA da plataforma no seletor da conta. A chave nunca vai para o navegador. O assistente envia somente o retrato autorizado do cliente selecionado e a pergunta; não executa comandos e o adaptador OpenAI usa `store:false`.

O modo básico funciona sem IA e não interpreta perguntas livres: apresenta um resumo por regras. A UI distingue os dois modos. O consumo diário é reservado antes da chamada; falhas do provedor devolvem a franquia. O total de tokens informado pelo provedor é registrado. A integração foi verificada com resposta simulada; nenhuma chamada paga foi feita.

Referência: [geração de texto e Responses API](https://developers.openai.com/api/docs/guides/text).

## Ativar pagamentos

Configure na sua conta Stripe três preços de assinatura recorrente e defina:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_GROWTH`
- `STRIPE_PRICE_MSP`

O valor monetário é definido no Stripe, não há preços fictícios no produto. Configure o endpoint `https://SEU_DOMINIO/api/billing/webhook` para `customer.subscription.created`, `customer.subscription.updated` e `customer.subscription.deleted`. Ative o portal de cobrança no Stripe para permitir gerenciamento da assinatura existente.

Comece com credenciais de teste. O checkout apenas redireciona o proprietário para o Stripe; o plano só muda após webhook assinado. Eventos repetidos são deduplicados e eventos mais antigos não substituem o estado mais novo. Planos menores que o uso atual não podem ser selecionados no checkout. O portal Stripe precisa ser configurado para impedir mudanças incompatíveis com os limites definidos neste projeto; alterações pelo portal devem ser revisadas na configuração comercial.

Não foram criados produtos, preços ou cobranças reais. Os testes verificam assinatura do webhook e atualização do plano com eventos de teste gerados localmente. País, tributos, documentos fiscais e condições comerciais dependem da operação que venderá o serviço.

## Notificações

`ALERT_WEBHOOK_URL` ativa um destino HTTPS definido pelo operador da aplicação para eventos de abertura e recuperação. O worker avalia regras a cada 15 segundos, grava uma fila persistente e repete falhas até oito vezes com espera crescente. A entrega é pelo menos uma vez: use `alert_id` e `event` para deduplicação no receptor. Não há envio de e-mail nem canais individuais por cliente nesta versão.

## Instalar os agentes

Nos detalhes do servidor, o histórico permite exibir ou ocultar CPU, memória e disco. A escala automática amplia pequenas variações e mostra os limites reais no eixo; a escala completa mantém 0 a 100%. O seletor de período inclui 15 minutos, 1/6/24 horas, 7 dias ou datas e horários personalizados (até 90 dias, respeitando os dados disponíveis pela retenção). O período personalizado usa o fuso local do navegador e só muda ao clicar em Aplicar período. Passe o cursor no gráfico ou use o controle de pontos pelo teclado para consultar média, mínimo e máximo. O eixo usa os horários das coletas; intervalos sem dados não são interpolados. Períodos grandes são agregados em intervalos maiores para manter a janela completa em até 1000 pontos.

No painel, cadastre um servidor dentro do cliente correto. O token de instalação dura 15 minutos e só pode ser usado uma vez. O instalador baixa o agente, solicita o token sem mostrá-lo no terminal, troca por uma credencial individual, cria o usuário `foxops-agent` e instala o serviço systemd.

O arquivo `/etc/foxops-agent/config.json` fica com permissão 0600. Para monitorar serviços, edite a lista `services`, por exemplo `["nginx", "postgresql"]`, e reinicie `foxops-agent`. Os nomes dos serviços são validados e consultados com `systemctl is-active`, sem shell. O painel também configura descoberta e coleta de logs no agente 0.3. Ações por SSH são separadas e exigem aprovação; veja [Serviços e SSH](SERVICES-SSH.md).

Comandos de operação: `systemctl status foxops-agent`, `journalctl -u foxops-agent`, `systemctl restart foxops-agent`. O agente envia métricas aproximadamente a cada 30 segundos. A rede é apresentada em bytes acumulados das interfaces, excluindo loopback; não é uma taxa instantânea. O disco monitorado é o volume raiz.

Para desenvolvimento remoto, use um túnel SSH e configure o agente com o endereço loopback encaminhado. Nunca use localhost de outro servidor como se fosse a máquina onde o painel roda.

Para teste temporário na mesma rede privada, configure HOST com o IP da interface local e PUBLIC_URL com `http://IP:8080`, em modo development. Acesse o painel por esse mesmo endereço. Execute o instalador com o segundo argumento `--allow-lan-http`: ele permite HTTP apenas para IPs literais RFC1918 (10/8, 172.16/12 e 192.168/16), grava essa opção no arquivo protegido do agente e mantém a exigência de HTTPS para endereços públicos. Nesse modo o tráfego não é criptografado; use somente na rede de teste confiável. Uma eventual regra de firewall deve ser limitada ao endereço/porta da aplicação e à sub-rede de teste.

## MCP externo

Crie um token no painel, selecione o cliente autorizado e copie uma única vez. Endpoint: `https://SEU_DOMINIO/mcp`. Transporte: Streamable HTTP stateless, autenticação `Authorization: Bearer TOKEN`. Tokens duram 7, 30 ou 90 dias e podem ser revogados imediatamente.

Ferramentas: `list_organizations`, `list_servers`, `get_server_health`, `query_metrics`, `list_alerts`, `get_service_status`. Todas usam a mesma camada de consultas autorizadas do assistente integrado e são somente leitura.

O exemplo `scripts/mcp-client.ts` usa o cliente oficial do SDK. Defina FOXOPS_ENDPOINT e FOXOPS_MCP_TOKEN e execute `npm run mcp:check`. Tokens não são passados pela linha de comando. O formato de configuração visual varia conforme o cliente.

Esta versão atende clientes que aceitam Bearer configurável. Não implementa OAuth, descoberta de autorização nem registro dinâmico; clientes que exigem esses recursos não são suportados ainda. Não há promessa de integração automática com qualquer ferramenta de IA. Referência: [SDK oficial MCP](https://ts.sdk.modelcontextprotocol.io/server).

## Backup e recuperação

Execute `npm run backup` para gerar uma cópia consistente usando a API SQLite de backup, inclusive com a aplicação em uso. Armazene cópias criptografadas fora da máquina e defina a periodicidade na sua infraestrutura. A pasta backups não é versionada.

Para restaurar: pare a aplicação, preserve uma cópia do banco atual, copie o backup escolhido para FOXOPS_DATABASE e reinicie. Teste a restauração em uma instalação separada antes de depender do procedimento. Não execute limpeza de volumes Docker sem backup.

Retenção de métricas: 7 dias na avaliação, 30/60/90 dias nos planos pagos. O worker faz limpeza aproximadamente a cada hora; a auditoria é mantida por 90 dias. Arquivar um servidor revoga sua credencial, resolve seus alertas e libera espaço no plano, preservando as métricas até a retenção. Não há interface de restauração de servidores arquivados nesta versão.

## Limites verificados

Cadastro/login, convites, isolamento de clientes, sessão, perfis, revogação, franquias, alertas e recuperação, consultas MCP com o cliente oficial, assistente simulado e webhook Stripe assinado são cobertos por testes. O painel foi inspecionado no navegador com dados fictícios de uma conta local.

Antes de receber clientes reais, valide o instalador em uma distribuição Linux com systemd e faça um piloto completo com domínio HTTPS, backup/restauração, IA e Stripe em modo de teste. A máquina de desenvolvimento não tem Linux/WSL nem Docker disponíveis. Recuperação de senha por e-mail, MFA e OAuth MCP não fazem parte deste MVP.

