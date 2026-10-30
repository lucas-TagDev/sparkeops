# Observabilidade e AIOps

Abra um servidor em **Servidores → Observabilidade e AIOps**. As abas são **Previsões e contexto**, **Runbooks** e **Instrumentação de traces**.

## Previsões e anomalias

O motor atual é estatístico e explicável: medianas e desvio absoluto mediano (MAD) formam uma referência dinâmica; regressão linear estima a saturação de disco. Não é um modelo treinado para prever defeitos físicos de SSD ou CPU. Leituras de I/O e temperatura são sinais para investigação, não um diagnóstico SMART nem uma data de falha de hardware.

- CPU, memória, disco, temperatura máxima disponível e latência de I/O são agregados por hora. O período de referência é de até 30 dias, limitado pela retenção do plano.
- Para anomalias são necessários pelo menos 24 pontos cobrindo 24 horas. Três médias horárias recentes precisam ultrapassar a referência robusta e a tolerância mínima. Um pico isolado não basta.
- Quando há pelo menos 12 referências no mesmo horário aproximado (UTC, ±1 hora), elas são usadas para reduzir ruído de sazonalidade diária; caso contrário, utiliza-se o histórico disponível.
- Previsão de disco exige pelo menos 48 pontos cobrindo 48 horas, crescimento acima de 0,01 ponto percentual/hora e R² ≥ 0,8. Só apresenta estimativas para atingir 90% nos próximos sete dias, enquanto o uso atual ainda está abaixo de 90%.
- A coleta precisa estar recente. A ausência de novos dados suspende previsões. Horas parcialmente coletadas são excluídas da análise.
- A avaliação de incidentes preditivos ocorre a cada cinco minutos. Os alertas fixos existentes continuam operando em seus intervalos e durações próprios.
- Em **Configurações → Notificações por organização**, habilite **Previsões e anomalias** nos canais desejados. Canais antigos preservam sua seleção anterior; o novo tipo não é habilitado silenciosamente.

O agente 0.8.0 lê sensores disponíveis em `/sys/class/hwmon` e diferenças dos contadores de `/proc/diskstats`. A temperatura é a maior leitura disponível, não necessariamente a temperatura da CPU. A latência é a maior média por dispositivo de bloco, em milissegundos por operação; pode crescer por carga, virtualização, filas ou problemas físicos. Em hosts sem acesso a esses dados, a leitura fica ausente. Não são executados testes de carga nem benchmarks.

Referência dos contadores Linux: https://cdn.kernel.org/doc/html/latest/admin-guide/iostats.html

## Contexto, logs e traces

O contexto reúne previsões, os últimos resumos locais de logs, uma amostra recente de processos e até 20 spans lentos/com erro da última hora. Logs e processos continuam sendo verificados localmente pelo agente; a correlação utiliza resultados já recebidos. Não é alegada uma nova investigação em tempo real sem uma coleta solicitada. A relação temporal não comprova causa raiz.

O assistente e a investigação por comandos recebem esse contexto e as descrições dos runbooks do servidor selecionado. Descrições e dados recebidos são conteúdo não confiável; não autorizam execução. As ferramentas MCP `get_observability_context`, `list_runbooks` e `request_runbook` respeitam servidor, organização e permissões. O último apenas prepara uma solicitação para aprovação humana.

Em **Instrumentação de traces**, um administrador gera uma chave exclusiva do servidor. Ela aparece uma vez e é armazenada apenas como hash. Rotacionar ou revogar a chave invalida a anterior.

O receptor é `POST /api/telemetry/v1/traces`, com `Authorization: Bearer <chave>` e `Content-Type: application/json`. Aceita **OTLP HTTP/JSON** (`resourceSpans → scopeSpans → spans`), não gRPC ou Protobuf binário. Configure um exportador/Collector que suporte JSON; não basta apontar um exportador binário para esta URL. Em produção, use HTTPS.

Cada span precisa de `traceId` (32 caracteres hex), `spanId` (16 hex), `startTimeUnixNano`, `endTimeUnixNano` e, para construir relações, `parentSpanId`. Informe `service.name` nos atributos do recurso. Propague W3C Trace Context entre aplicações. Ao clicar num trace, o painel mostra até 200 spans da mesma organização, incluindo servidores diferentes autorizados nesse escopo.

Limites: 256 KB e 500 spans por requisição; 30 requisições/minuto por chave; 10.000 spans por servidor em uma hora. Aceita spans das últimas 24 horas e até 60 segundos no futuro, com duração máxima de uma hora. Reenvios com o mesmo par trace/span são deduplicados. A retenção segue o plano.

Apenas atributos selecionados de operação são armazenados (`db.system.name`, `db.operation.name`, `rpc.system`, `rpc.service`, `http.request.method`). Atributos de SQL completo, URLs, cabeçalhos, eventos e baggage são descartados. Nomes de spans e serviços continuam sendo dados enviados pela aplicação: não inclua senhas, SQL com parâmetros ou informações pessoais nesses nomes. Sem instrumentação, a plataforma não consegue atribuir uma CPU alta a uma consulta específica.

Referência OTLP JSON: https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding

## Cadastrar e habilitar um runbook

1. Configure o SSH gerenciado do servidor no painel.
2. No Ubuntu, atualize o agente e habilite o executor restrito:

   ```sh
   curl -fsS 'http://192.168.3.41:8080/agent/upgrade.sh' -o /tmp/foxops-upgrade.sh
   sudo bash /tmp/foxops-upgrade.sh --enable-runbooks
   ```

   Use a origem HTTPS da sua instalação em produção. `--disable-runbooks` bloqueia o executor local preservando o monitoramento.

3. Crie um script real, com shebang e permissão de execução, em um caminho dentro de `/opt`, `/srv` ou `/usr/local` (recomendado: `/opt/foxops-runbooks/`). O arquivo e todos os diretórios pais devem pertencer a root e não permitir escrita por grupo/outros. Links simbólicos não são aceitos. O limite é 1 MB. O painel não cria nem transfere scripts automaticamente.
4. Na aba **Runbooks**, informe nome, descrição de quando utilizar e caminho absoluto. Use **Verificar arquivo no servidor** para obter o SHA-256. Essa ação apenas inspeciona o arquivo.
5. Escolha o gatilho e modo. **Aprovação humana** prepara uma solicitação para o administrador revisar. **Automático autorizado** requer confirmação explícita e aplica-se apenas ao gatilho exato cadastrado. A IA não escolhe scripts automaticamente por texto livre.
6. Defina intervalo mínimo (300–86.400 segundos), limite diário (1–12) e habilite o runbook. São permitidos até 30 runbooks por servidor.

Gatilhos: CPU, memória, disco, offline, serviço exato (`service:nginx`) e previsões/anomalias suportadas (`predictive:disk_percent:forecast`, por exemplo). O disparo automático exige um **novo** incidente ainda aberto, autorização atual do administrador que cadastrou, mesma revisão de configuração e conexão SSH, e menos de cinco minutos desde a criação da solicitação. Não reaplica a correção repetidamente ao mesmo incidente. Incidentes anteriores ao cadastro não são reproduzidos.

O script executa como root, sem argumentos fornecidos pela IA, ambiente reduzido e timeout de 30 segundos; a saída é limitada e segredos comuns são ocultados. Pode falhar ou deixar efeitos parciais: escreva scripts idempotentes e adequados ao seu serviço. O executor é bloqueado localmente por padrão, verifica hash e permissões a cada execução, usa trava por host e identificador persistente para impedir repetição do mesmo pedido. Não deixa processos do grupo em segundo plano. Saídas limitadas/timeout e perda de conexão deixam resultado indeterminado, sem repetição automática.

Os scripts devem incluir sua própria validação e estratégia de restauração. Não existe rollback genérico para scripts arbitrários. Para gatilhos de serviço, também é consultado `systemctl is-active` depois de um retorno zero. Execução concluída não fecha o incidente automaticamente: a coleta seguinte confirma a recuperação. Alterar o conteúdo exige verificar o arquivo e salvar novamente no painel.

Execuções ficam na aba com horário, motivo, estado, aprovação e saída. Auditoria registra o administrador responsável; ações automáticas registram quem as autorizou. Se o resultado ficou indeterminado, confira o servidor e use **Confirmar verificação manual** para liberar novas ações; isso não repete nem declara sucesso da execução anterior.

## Validação

Os testes locais usam servidores e provedores simulados para verificar previsão, isolamento de organizações, chaves, formato OTLP, deduplicação, cancelamento e autorização de scripts. A validação em um Ubuntu real e aplicações instrumentadas continua sendo necessária antes de habilitar automação na sua organização.
