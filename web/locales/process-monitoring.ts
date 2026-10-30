export const processMonitoringRows = `
Processos monitorados|Monitored processes|Procesos monitorizados
Monitorar processo|Monitor process|Monitorizar proceso
Monitorado|Monitored|Monitorizado
Adicionar por nome|Add by name|Agregar por nombre
Marque Monitorar na lista ou informe um nome. A regra acompanha o nome exato, usuário e serviço, não um PID fixo. Requer agente 0.9 ou superior.|Select Monitor in the list or enter a name. Rules follow the exact name, user and service, not a fixed PID. Requires agent 0.9 or later.|Seleccione Monitorizar en la lista o introduzca un nombre. La regla sigue el nombre exacto, usuario y servicio, no un PID fijo. Requiere agente 0.9 o posterior.
Para receber avisos e resumos, habilite Processos monitorados nos canais da organização em Configurações.|To receive alerts and summaries, enable Monitored processes in your organization's channels under Settings.|Para recibir avisos y resúmenes, habilite Procesos monitorizados en los canales de la organización en Configuración.
Monitoramento salvo. O agente aplicará a regra na próxima coleta.|Monitoring saved. The agent will apply the rule on the next collection.|Monitorización guardada. El agente aplicará la regla en la próxima recopilación.
Nome exato do processo|Exact process name|Nombre exacto del proceso
Usuário (opcional)|User (optional)|Usuario (opcional)
Serviço (opcional)|Service (optional)|Servicio (opcional)
Mínimo de instâncias ativas|Minimum active instances|Mínimo de instancias activas
Limite de CPU do host (%) — opcional|Host CPU limit (%) — optional|Límite de CPU del host (%) — opcional
Limite de memória do host (%) — opcional|Host memory limit (%) — optional|Límite de memoria del host (%) — opcional
Duração mínima da condição (segundos)|Minimum condition duration (seconds)|Duración mínima de la condición (segundos)
Avisar quando todas as instâncias forem substituídas entre coletas|Notify when all instances are replaced between collections|Avisar cuando todas las instancias se sustituyan entre recopilaciones
Gerar resumo com IA e verificar logs locais do serviço em incidentes|Generate an AI summary and check local service logs on incidents|Generar resumen con IA y verificar registros locales del servicio en incidentes
O alerta técnico é imediato após a duração configurada; o resumo é enviado depois, uma vez por incidente. A IA usa a franquia da conta e não executa correções.|The technical alert is immediate after the configured duration; the summary follows once per incident. AI uses the account allowance and does not execute fixes.|La alerta técnica es inmediata tras la duración configurada; el resumen se envía después, una vez por incidente. La IA usa la cuota de la cuenta y no ejecuta correcciones.
Buscar processos monitorados|Search monitored processes|Buscar procesos monitorizados
Nome, usuário ou serviço|Name, user or service|Nombre, usuario o servicio
Todos os usuários|All users|Todos los usuarios
Qualquer serviço|Any service|Cualquier servicio
Pausado|Paused|Pausado
Aguardando coleta recente|Awaiting recent collection|Esperando recopilación reciente
Leitura incompleta|Incomplete reading|Lectura incompleta
Monitorando|Monitoring|Monitorizando
Instâncias|Instances|Instancias
Sem leitura recente. Isso não confirma parada do processo.|No valid recent reading. This does not confirm that the process stopped.|Sin lectura reciente válida. Esto no confirma que el proceso se detuvo.
Editar regra|Edit rule|Editar regla
Monitoramento pausado.|Monitoring paused.|Monitorización pausada.
Pausar monitoramento|Pause monitoring|Pausar monitorización
Nenhum processo monitorado com estes filtros.|No monitored processes match these filters.|Ningún proceso monitorizado coincide con estos filtros.
Paginação de processos monitorados|Monitored processes pagination|Paginación de procesos monitorizados
Incidentes de processos — últimos 20|Process incidents — last 20|Incidentes de procesos — últimos 20
Resumo da IA|AI summary|Resumen de IA
Resumo técnico|Technical summary|Resumen técnico
Aguardando resumo e verificação local de logs, quando disponível.|Awaiting summary and local log check, when available.|Esperando resumen y verificación local de registros, cuando estén disponibles.
Paginação de incidentes de processos|Process incident pagination|Paginación de incidentes de procesos
Monitor de processo cadastrado ou alterado|Process monitor created or updated|Monitor de proceso creado o modificado
Monitor de processo pausado|Process monitor paused|Monitor de proceso pausado
Incidente de processo resumido pela IA|Process incident summarized by AI|Incidente de proceso resumido por IA
Monitor de processo não encontrado.|Process monitor not found.|Monitor de proceso no encontrado.
Regra alterada. Atualize antes de salvar.|Rule changed. Refresh before saving.|Regla modificada. Actualice antes de guardar.
Confira o nome, filtros e limites do processo.|Check the process name, filters and limits.|Revise el nombre, filtros y límites del proceso.
Limite de 20 monitores de processos por servidor.|Limit of 20 process monitors per server.|Límite de 20 monitores de procesos por servidor.
Este processo já possui uma regra com os mesmos filtros.|This process already has a rule with the same filters.|Este proceso ya tiene una regla con los mismos filtros.
Coleta de monitoramento de processos inválida.|Invalid process monitoring collection.|Recopilación de monitorización de procesos inválida.
Resultado de monitoramento inválido.|Invalid monitoring result.|Resultado de monitorización inválido.
`;
