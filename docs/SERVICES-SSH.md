# Serviços, logs e correções por SSH

## Fluxo

O agente no Linux envia métricas, estado de serviços e resumos de verificações locais de logs. A aplicação Node.js inicia as conexões SSH usadas para ações de correção. A credencial SSH não é enviada para o agente nem para a IA. A conexão sai da máquina onde o FoxOps está rodando em direção à porta SSH do Ubuntu.

Nos detalhes do servidor há o painel **Serviços, logs e correções**, com abas Serviços, Logs e IA, Conexão SSH e Ações e aprovações. A coleta continua independente da IA.

## Atualizar o agente já instalado

No Ubuntu de teste, como root:

```sh
curl -fsS http://192.168.3.41:8080/agent/upgrade.sh -o /tmp/foxops-upgrade.sh
bash /tmp/foxops-upgrade.sh
```

O atualizador usa o endpoint que já está no arquivo protegido do agente, substitui somente o programa, adiciona o usuário do agente aos grupos adm e systemd-journal quando disponíveis e reinicia o serviço. A credencial de instalação não precisa ser gerada novamente. A inclusão nos grupos concede leitura de logs do host ao agente, necessária para journal e arquivos convencionais de erro.

Após atualizar, o painel deverá informar agente 0.5.0. A descoberta de serviços ocorre no primeiro ciclo e a cada cinco minutos; estados e configurações são atualizados aproximadamente a cada 30 segundos. Conferência: `systemctl status foxops-agent` e `journalctl -u foxops-agent -n 50 --no-pager`.

O instalador e o atualizador ainda precisam ser executados no Ubuntu pelo responsável pelo servidor; os testes de coleta usam contadores e respostas systemd simulados no Windows.

## Serviços

A descoberta inclui nginx, apache2/httpd, PHP-FPM com versão (por exemplo php8.3-fpm), MySQL/MariaDB, PostgreSQL, Redis, Docker e RabbitMQ. PHP executado por Apache é acompanhado pelo serviço apache2; PHP-FPM tem sua própria unidade. Não existe um serviço systemd genérico chamado php em todas as distribuições.

Para seleção manual, desmarque descoberta automática e informe as unidades separadas por vírgula. No máximo 20 serviços. O estado é consultado sem shell, com `systemctl is-active`. Não são instalados pacotes nem ativados serviços ausentes automaticamente. Serviços inativos/falhos seguem a duração mínima das regras de alerta; estado desconhecido não comprova recuperação.

## Logs: verificação na própria máquina

Em **Logs e IA**, selecione um serviço e um período e clique em **Verificar na máquina**. O painel cria uma solicitação vinculada ao servidor; o agente a recebe na próxima coleta, lê o journal e os arquivos convencionais de erro acessíveis e classifica os registros no próprio Ubuntu. A solicitação expira em dez minutos se não houver resposta.

A classificação local usa regras, sem modelo de IA instalado no host. O resultado contém somente contagens e categorias (permissão negada, conexão recusada, timeout de upstream, erro de configuração, falta de memória, demais erros e avisos). Mensagens brutas não são enviadas por esse fluxo. O endpoint aceita apenas campos estruturados. Falhas de leitura são reportadas como indisponibilidade, não como servidor saudável.

A leitura é limitada a 500 registros, ao journal e ao final de até 256 KiB dos arquivos convencionais de Nginx, Apache e PHP-FPM. O período é de até 24 horas nos últimos sete dias; arquivos rotacionados não são lidos. Linhas de arquivo sem data reconhecida são contadas como ignoradas. Datas dos arquivos usam o fuso local do Ubuntu. O painel mostra fontes lidas, truncamento e linhas ignoradas. Contagens podem conter eventos repetidos entre journal e arquivo. Não se trata de um arquivo integral nem de prova da ausência de falhas.

**Interpretar resumo com IA** é opcional e envia o resumo, junto ao retrato autorizado do servidor, ao provedor configurado na conta. Não envia as mensagens brutas. No chat, a opção de incluir verificação usa somente um resumo concluído nos últimos dez minutos. Uma proposta de correção continua exigindo aprovação.

As rotas antigas de ingestão/leitura de amostras foram preservadas por compatibilidade. O agente 0.4 não envia amostras automaticamente: isso exige opt-in adicional `ship_raw_logs: true` no arquivo local e autorização no backend. O novo painel e o MCP usam verificações locais. Registros legados já armazenados seguem a retenção de sete dias.

## SSH automático na instalação

O instalador pergunta se deve configurar SSH. Também aceita `--setup-ssh` (junto de `--allow-lan-http` no teste de rede) ou `--no-ssh`. Ao escolher SSH, poderá instalar OpenSSH Server e sudo pelo apt e ativar o serviço SSH; não altera o firewall ou a configuração de autenticação existente.

A inscrição do agente emite uma autorização de cadastro SSH de uso único, válida por 15 minutos e vinculada à credencial desse servidor. O instalador root cria o usuário dedicado **foxops-ssh**, gera uma chave Ed25519, instala a chave pública e envia a chave privada e a fingerprint de host para o painel do cliente. A chave privada fica cifrada no painel e o arquivo temporário é removido do Ubuntu após confirmação. Se o envio falhar, o acesso novo é revogado e a chave permanece em arquivo root 0600 para uma tentativa posterior. Nenhuma chave é impressa no terminal.

A chave pública tem comando forçado e restrições de encaminhamento/terminal. Um validador root aceita apenas consulta de hostname, testes de configuração e operações de estado/reload/restart para os serviços suportados. Não libera um terminal livre nem sudo irrestrito. Serviço personalizado fora da lista exige configuração manual. Um usuário foxops-ssh preexistente fora desta instalação é recusado.

Para agente já instalado, o proprietário abre **Conexão SSH → Autorizar configuração automática**. Depois baixa novamente o atualizador e executa:

```sh
curl -fsS http://192.168.3.41:8080/agent/upgrade.sh -o /tmp/foxops-upgrade.sh
bash /tmp/foxops-upgrade.sh --setup-ssh
```

Cole a autorização temporária quando o programa pedir. Confirme o IP/DNS acessível pelo painel; o IP sugerido pela rota pode precisar de ajuste em redes com NAT. O cadastro automático não substitui uma conexão SSH existente. Para refazê-lo, remova a conexão pelo painel e gere uma nova autorização. Use HTTPS em produção. A opção HTTP de LAN é destinada ao teste local.

## Configurar SSH

O proprietário da conta informa host/IP real do Ubuntu, porta (geralmente 22), usuário e chave privada ou senha. A frase secreta da chave é opcional. Esses dados são cifrados com a mesma infraestrutura de proteção usada pelas chaves de IA, vinculados à conta e ao servidor. A API não os devolve. Faça backup separado do arquivo mestre de proteção.

Informe também a fingerprint SHA256 da chave de host, obtida no console confiável do Ubuntu, por exemplo:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
```

Copie somente o campo que começa com SHA256:. Se o SSH negociar outra chave de host, a fingerprint correspondente precisa ser usada; obtenha-a no servidor para a chave negociada. O cliente nunca aceita automaticamente uma identidade desconhecida. Testar SSH consulta apenas o hostname e não altera serviços.

Use HTTPS no painel para cadastrar credenciais reais. Para produção, prefira um usuário dedicado e chave SSH com sudo sem senha limitado aos comandos necessários, em vez de login root. A conta usada precisa conseguir executar os caminhos dos comandos apresentados na revisão. Não há tentativa interativa de senha sudo.

## Correções e aprovações

A IA pode sugerir status, configtest, reload ou restart para serviços presentes no retrato atual. O backend ignora sugestões com serviços desconhecidos ou ações fora da lista. A sugestão não cria uma execução: clique em Preparar e revise os comandos na aba Ações e aprovações. Operadores podem preparar; somente proprietário e administrador podem aprovar e executar.

Os comandos são templates fixos no backend. Nginx, Apache e PHP-FPM passam por teste de sintaxe antes de reload/restart; se o teste falhar, a sequência para. A execução termina com consulta de estado. Não há terminal livre, comandos shell gerados pelo modelo, edição livre de arquivos, instalação de pacotes ou exclusão de dados. Corrigir erros de configuração arbitrários exige análise e mudança específica fora desses templates.

As propostas expiram em 15 minutos e deixam de valer se a conexão SSH for alterada. Só uma ação pode executar por servidor. A mesma proposta não pode ser aprovada duas vezes. Resultados, aprovador e auditoria são armazenados. Se a conexão cair, houver timeout ou a aplicação reiniciar durante a execução, o resultado é indeterminado: verifique o serviço antes de repetir. Não há repetição automática de uma ação.

MCP inclui request_local_log_check (solicita leitura no host), get_local_log_checks e get_service_logs (resumos locais), além de propose_service_action (somente proposta). A aprovação e execução não são expostas pelo MCP. Não é necessário expor uma porta MCP no Ubuntu: o MCP do FoxOps encaminha a solicitação ao agente pela resposta da coleta autenticada.

## Validação

Os testes incluem um servidor SSH local de teste para verificar fingerprint, autenticação, saída e interrupção da sequência após erro. As ações, permissões, revogação, concorrência e criptografia são testadas sem conectar aos servidores do usuário. Nenhum serviço real foi reiniciado pelo desenvolvimento dessa funcionalidade.

## Processos que mais consomem recursos

Nos detalhes do servidor, abra **Processos → Consultar processos agora**. A solicitação é exclusiva desse servidor e chega ao agente pela próxima coleta. O agente 0.5 lê os metadados em /proc duas vezes com intervalo mínimo de um segundo, calcula a variação dos tempos de CPU e retorna a união dos dez maiores por CPU e dez maiores por memória (até vinte processos, sem duplicar PID).

O painel permite ordenar por CPU ou memória e consultar as dez últimas coletas, retidas por sete dias. Mostra PID, nome, usuário, estado, memória residente, tempo desde o início e serviço identificado pelo cgroup, quando acessível. Não coleta linha de comando completa, argumentos nem variáveis de ambiente. PID reciclado ou processo iniciado durante a medição não é usado como se tivesse uma amostra comparável. A CPU é normalizada em relação à capacidade total do host (0 a 100%), como no painel; difere do modo do top em que um núcleo representa 100%.

A leitura tem limites de 20 mil processos e cinco segundos por passagem. Resultados parciais, leituras inacessíveis e processos encerrados são sinalizados. hidepid, contêineres e permissões podem restringir a visibilidade. A memória residente inclui páginas compartilhadas; somar as porcentagens não dá a memória exclusiva do conjunto. Nenhuma amostra isolada comprova problema ou erro de configuração.

**Analisar processos com IA** envia somente a coleta selecionada e o retrato autorizado desse servidor para o provedor da conta. A coleta precisa ter menos de dez minutos. No assistente também existe uma opção explícita para incluir a coleta recente do servidor escolhido. O MCP oferece request_process_snapshot e get_process_snapshots, sem comandos arbitrários.

Para um processo ligado a um serviço monitorado, o painel oferece preparar uma verificação de configuração (Nginx, Apache e PHP-FPM) ou consulta de estado. A preparação leva a Ações e aprovações; somente depois de aprovada a ação é executada por SSH. As sugestões da IA seguem a mesma aprovação. Não há encerramento direto de PID nem ajuste arbitrário de limites. A edição controlada de configuração está descrita abaixo. Os testes de configuração existentes continuam sendo executados antes de reload/restart dos serviços suportados. Uma configuração inválida deve ser corrigida com uma mudança específica, não escondida por reinícios repetidos.

Para atualizar um agente já instalado, execute o atualizador sem --setup-ssh; a conexão SSH existente é preservada.

## Edição controlada de configuração

A aba **Configurações de serviços** lê parâmetros pelo SSH, permite valores manuais ou uma sugestão da IA e prepara uma diferença antes/depois na aba Ações e aprovações. Somente proprietário/administrador aprova. A leitura e preparação são permitidas também ao operador. O arquivo completo nunca é enviado à IA; somente os valores numéricos suportados e o retrato do servidor.

Perfis iniciais: Nginx `/etc/nginx/nginx.conf` (worker_processes, incluindo substituir auto por um número), Apache `/etc/apache2/apache2.conf` (Timeout e KeepAliveTimeout), PHP-FPM `/etc/php/VERSAO/fpm/pool.d/www.conf` (pm.max_children e pm.max_requests, seção www) e MySQL `/etc/mysql/mysql.conf.d/mysqld.cnf` (max_connections, seção mysqld). As diretivas precisam existir uma única vez, ativas e no formato reconhecido. Não há inclusão de seções, parâmetros arbitrários, edição de paths personalizados ou diagnóstico SQL. MariaDB e PostgreSQL não têm perfil de edição nesta versão.

O auxiliar exige arquivo root, sem links simbólicos ou escrita por grupo/outros, e diretórios seguros. Uma hash impede aplicar sobre um arquivo alterado desde a leitura. Há bloqueio local entre operações FoxOps. Edições externas não participam do bloqueio; evite alterar o arquivo manualmente enquanto uma proposta é aplicada.

Na aprovação, o auxiliar valida a configuração atual, salva backup root 0600 em `/var/lib/foxops-config/backups`, escreve atomicamente, valida e recarrega o serviço. MySQL usa `mysqld --validate-config` e reinício: pode interromper conexões. Validador indisponível ou configuração inicial inválida recusam a operação sem alterar o arquivo. Este fluxo ajusta parâmetros numéricos; não repara erros arbitrários de sintaxe.

Se o teste da proposta falhar, restaura o arquivo sem recarregar. Se a ativação falhar, restaura e tenta recuperar o serviço. O painel distingue restauração e falha de recuperação. Reversão não garante ausência de impacto ou saúde funcional da aplicação: a confirmação usa o validador e systemctl is-active. Crash, falta de energia ou perda de conexão podem deixar resultado indeterminado e exigem conferência manual. Não repita automaticamente. Os backups permanecem no servidor; não há expurgo automático nesta versão.

Atualize os auxiliares no Ubuntu executando novamente o upgrade. Quando o gateway SSH gerenciado já existe, o atualizador instala o editor e atualiza o gateway sem gerar outra chave. Em instalações novas, eles são instalados ao escolher SSH. Usuários SSH manuais precisam da mesma instalação root do editor e de permissão sudo específica; não libere sudo irrestrito.

Testes de escrita e rollback usam arquivos temporários e comandos simulados, sem alterar serviços reais. Faça o piloto em um servidor de teste antes do uso em produção.

## Descoberta ampla (agente 0.6)

A descoberta automática agora combina list-unit-files e list-units --all do systemd, incluindo serviços personalizados e instâncias carregadas. Não usa a antiga lista fixa. Até mil unidades com nomes válidos são reportadas; templates sem instância não representam serviços executáveis e são ignorados. Há limites de nome e tamanho para proteger a ingestão. A listagem é refeita a cada cinco minutos e o estado é consultado em lote a cada coleta. No modo automático, somente failed gera incidente de serviço; inactive e not_loaded são exibidos como estados informativos. Na seleção manual permanece o limite de vinte unidades e o alerta de inatividade conforme as regras. Serviços fora do systemd, como processos avulsos e contêineres individuais, não são inventariados como unidades.

## Chat com verificação sob demanda (agente 0.7)

Cada envio no chat, com um servidor específico selecionado, solicita uma verificação ao agente antes de chamar a IA. A entrega ocorre na próxima coleta autenticada (normalmente até 30 segundos). O chat mostra o andamento, aguarda até 90 segundos e recusa responder como se houvesse diagnóstico atual quando não recebe o resultado. As solicitações expiram em 120 segundos. O resultado é vinculado à pergunta e ao servidor, sem consulta automática de outros clientes ou servidores.

O planejador local identifica nomes de serviços, Cloudflare/cloudflared e SSH, solicita processos para pedidos de CPU/memória/consumo e resumos de logs para serviços identificados. Não é execução arbitrária de comandos e não cobre qualquer investigação imaginável: pedidos fora das ferramentas são informados como não verificados. A leitura continua no próprio host; a IA só recebe o resultado depois de concluído. Alterações continuam exigindo aprovação.

Para verificar uma aplicação de origem HTTP, o administrador pode configurar `diagnostic_origin_url` no arquivo protegido do agente, por exemplo `http://127.0.0.1:8081/`. Somente loopback é aceito; credenciais, query strings, fragmentos, proxies e redirecionamentos são recusados. O teste usa HEAD, com timeout. Sem essa configuração, o chat informa que a origem não foi testada. Isso não prova DNS público nem a saúde do túnel Cloudflare: estado de serviço, logs e resposta local são evidências parciais. Um 405 no HEAD também precisa ser investigado, não prova indisponibilidade da aplicação.

O histórico ganha horário de verificação concluída. Não é um canal de execução em tempo real: depende da próxima comunicação do agente. Para testes de consultas MCP externas continuam disponíveis as ferramentas específicas já existentes.

## Descoberta da origem cloudflared (agente 0.7.1)

O diagnóstico do chat tenta identificar automaticamente a origem: lê ExecStart pelo systemd sem devolver argumentos, procura uma URL loopback explícita ou configuração YAML nas pastas padrão /etc/cloudflared e /usr/local/etc/cloudflared. Extrai somente URLs HTTP/HTTPS locais de diretivas service simples; não envia arquivos completos, credenciais, tokens, caminhos de certificados ou argumentos à IA. Configurações complexas, caminhos fora dessas pastas e arquivos inacessíveis são limitações explícitas.

Quando identifica --token/--token-file, trata o túnel como gerenciado remotamente. Nesse modo, pode extrair a origem do último registro de atualização de configuração do processo atual no journal, vinculado pelo InvocationID. Se não houver esse registro acessível, não inventa a origem e não usa arquivos locais antigos de outra instalação. Configuração remota não pode ser deduzida apenas pelo serviço estar ativo. São testadas até cinco origens loopback encontradas; redirects, proxies, credenciais e URLs externas continuam recusados. URLs não são enviadas à IA, somente a origem da descoberta e os resultados HTTP. A configuração explícita diagnostic_origin_url continua tendo preferência.

Referências oficiais: https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/ e https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/ .

## Investigação por comandos escolhidos pela IA

O chat agora oferece o modo **Investigar usando comandos SSH**, habilitado na interface para contas com IA configurada e perfil com permissão de preparar ações. A IA pode propor comandos fora do catálogo MCP: ler portas, inspecionar discos, descobrir arquivos de configuração e consultar parâmetros. O usuário recebe o comando completo e a justificativa. Somente proprietário/administrador pode aprovar. A ferramenta não executa nada na fase de planejamento. Após a aprovação, executa exatamente a proposta vinculada ao servidor/conexão e devolve a saída para uma nova etapa de análise. Cada próximo comando exige outra aprovação. Há limite de cinco etapas por investigação, 30 segundos por comando e saída limitada a 16 KB. Timeout e limite de saída deixam resultado indeterminado e interrompem a continuação automática. Comandos podem ter efeitos antes de falhar: nunca repita sem conferir.

O catálogo de monitoramento continua disponível ao desmarcar esse modo. O modo genérico é administrativo e não é um sandbox: depois de habilitado no host, a chave SSH dedicada pode executar comandos root por esse caminho. A aprovação é aplicada pelo backend FoxOps; proteja o servidor do painel e a credencial SSH. O administrador do Ubuntu precisa habilitar explicitamente a extensão com `bash /tmp/foxops-upgrade.sh --enable-approved-commands`, depois de baixar novamente o atualizador. Atualizações normais não habilitam essa permissão. Para revogar, execute o atualizador com --disable-approved-commands. Isso preserva monitoramento e os templates anteriores.

No modo genérico não existe garantia automática de backup ou rollback para qualquer comando. Esses recursos continuam disponíveis no editor restrito de configurações. A IA é instruída a investigar antes de alterar e a não tratar um pedido de diagnóstico como autorização de correção. Um aumento de disco exige identificar dispositivo, partições, filesystem, LVM e espaço subjacente e pode depender do provedor da VM; a IA não pode presumir que um comando SSH cria capacidade física ou de nuvem.

A saída aprovada é enviada ao provedor da conta para análise. Não aprove comandos que exibam credenciais, chaves privadas, ambientes completos ou dados sensíveis. Há máscara de padrões comuns, mas ela não garante remoção de todos os segredos. Os comandos e os resultados ficam registrados nas ações e no histórico do chat. Não há execução automática de comandos novos sem aprovação nesta versão.
