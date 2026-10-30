# Investigar picos históricos pelo chat

Selecione o servidor no assistente e escreva uma pergunta com data completa, por exemplo:

> Olhei no gráfico e às 22:00 do dia 27/10/2026 teve um pico de memória. Pode verificar o que ocorreu e os alertas desse dia?

O chat reconhece `DD/MM/AAAA` e `AAAA-MM-DD`, com horário `HH:mm` ou `22h`. Usa o fuso IANA do navegador (por exemplo `America/Sao_Paulo`), enviado explicitamente ao backend. A resposta informa a janela e o fuso. Datas impossíveis e futuras são recusadas. Sem horário, a janela é o dia civil; com horário, inclui 30 minutos antes e depois.

A investigação histórica tem prioridade sobre o modo de comandos SSH. Ela não executa correções nem precisa abrir um terminal. São consultados:

- Métricas do período, com médias, mínimos e máximos. Até 120 grupos preservam máximos, reduzindo o volume enviado à IA; o horário de cada ponto representa um intervalo agregado, não o segundo exato do pico.
- Alertas do servidor abertos ou ainda em andamento naquele dia, incluindo os que começaram antes e só se resolveram durante/depois do dia. Até 100 são enviados com indicação de truncamento. A consulta não usa o limite de 200 do inventário de alertas.
- Até três coletas históricas de processos, se existirem; até 15 traces lentos/com erro da janela; até 15 incidentes de processos e sinais preditivos do dia; até 15 ações de remediação registradas naquele dia.
- Leitura local do journal geral e de até três serviços associados a alertas do dia. São pedidos jobs ao agente, e somente contagens/categorias saem do host, sem logs brutos. A janela de logs segue o período ao redor do pico, ou o dia quando não há horário.

O agente precisa ser **0.10.0 ou superior** para logs históricos do sistema. Atualize no Ubuntu:

```sh
curl -fsS 'http://192.168.3.41:8080/agent/upgrade.sh' -o /tmp/foxops-upgrade.sh
sudo bash /tmp/foxops-upgrade.sh
```

Em produção use a origem HTTPS da instalação. O agente aceita leituras locais de até 30 dias e janelas de até 25 horas (dias com mudança de horário). A existência dos logs depende da retenção do journal e das permissões do usuário. Agentes antigos continuam permitindo a análise dos dados já armazenados no painel, sem alegar uma nova leitura histórica de logs.

O chat aguarda aproximadamente 100 segundos pelos jobs. Leituras não concluídas entram como indisponíveis; não bloqueiam o relatório dos demais dados. Cada fonte tem limite de 500 registros, com indicador de truncamento. Um journal vazio não prova que não houve incidente: os registros podem ter expirado. A fila lê uma fonte por ciclo, portanto investigações com vários serviços podem ter resultados parciais.

A IA recebe a investigação autorizada do mesmo usuário/servidor e diferencia evidência e hipótese. Métricas atuais não comprovam o estado passado. Sem uma coleta histórica de processos, não pode atribuir a memória a um processo específico; sem logs de OOM, não pode afirmar que houve OOM. Não há como reconstruir dados nunca coletados ou já removidos pela retenção. Sem IA, o diagnóstico básico apresenta a janela, pico registrado, alertas e cobertura disponível.

Investigações ficam vinculadas ao usuário, servidor e pergunta; acesso é revalidado, e os IDs expiram após uma hora. Solicitações são auditadas. Não há execução automática de comandos nem alteração de configurações.
