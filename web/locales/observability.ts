export const observabilityRows = `
Observabilidade e AIOps|Observability and AIOps|Observabilidad y AIOps
Previsões e contexto|Predictions and context|Predicciones y contexto
Instrumentação de traces|Trace instrumentation|Instrumentación de trazas
Previsões e anomalias|Predictions and anomalies|Predicciones y anomalías
Análise estatística local do histórico, sem gastar tokens de IA a cada coleta. A IA recebe apenas o contexto resumido quando consultada.|Local statistical analysis of historical data, with no AI tokens spent per collection. AI receives summarized context only when consulted.|Análisis estadístico local del historial, sin gastar tokens de IA en cada recopilación. La IA recibe contexto resumido solo al consultarla.
Métricas horárias|Hourly metrics|Métricas horarias
Hardware / I/O|Hardware / I/O|Hardware / E/S
Spans na última hora|Spans in the last hour|Spans en la última hora
Coleta desatualizada: previsão suspensa.|Stale telemetry: prediction suspended.|Datos desactualizados: predicción suspendida.
Aprendendo o comportamento deste servidor|Learning this server's behavior|Aprendiendo el comportamiento del servidor
Nenhum desvio persistente ou previsão de saturação identificado.|No persistent deviation or saturation forecast identified.|No se identificaron desviaciones persistentes ni predicciones de saturación.
Temperatura máxima|Maximum temperature|Temperatura máxima
Latência de I/O|I/O latency|Latencia de E/S
Previsão de saturação|Saturation forecast|Predicción de saturación
Anomalia persistente|Persistent anomaly|Anomalía persistente
Referência histórica|Historical baseline|Referencia histórica
Estimativa até 90% de uso|Estimated time to 90% usage|Tiempo estimado hasta un uso del 90%
Qualidade do sinal|Signal quality|Calidad de la señal
Alta|High|Alta
Moderada|Moderate|Moderada
amostras horárias|hourly samples|muestras horarias
Histórico necessário|Required history|Historial necesario
Contexto correlacionado — última hora|Correlated context — last hour|Contexto correlacionado — última hora
Eventos da mesma janela e servidor são correlacionados temporalmente; isso não comprova causalidade. SQL bruto não é armazenado.|Events in the same time window and server are temporally correlated; this does not prove causation. Raw SQL is not stored.|Los eventos de la misma ventana y servidor se correlacionan temporalmente; esto no demuestra causalidad. No se almacena SQL sin procesar.
Operação|Operation|Operación
Duração|Duration|Duración
Sem erro reportado|No error reported|Sin error informado
Nenhum trace recebido nesta janela. Instrumente a aplicação para identificar chamadas e operações específicas.|No traces received in this window. Instrument the application to identify specific calls and operations.|No se recibieron trazas en esta ventana. Instrumente la aplicación para identificar llamadas y operaciones específicas.
Resumos locais de logs|Local log summaries|Resúmenes locales de registros
Processos coletados|Collected processes|Procesos recopilados
Limites da análise|Analysis limitations|Límites del análisis
Atualizado em|Updated at|Actualizado el
Caminho do trace na organização|Trace path within the organization|Ruta de la traza en la organización
Relações entre spans seguem os identificadores enviados pela aplicação; não provam causa raiz.|Span relationships follow identifiers sent by the application; they do not prove root cause.|Las relaciones entre spans siguen los identificadores enviados por la aplicación; no demuestran la causa raíz.
Receber traces OpenTelemetry|Receive OpenTelemetry traces|Recibir trazas OpenTelemetry
Configure um exportador ou Collector OTLP HTTP/JSON. Este receptor aceita JSON, não gRPC nem Protobuf binário. A chave é exclusiva deste servidor.|Configure an OTLP HTTP/JSON exporter or Collector. This receiver accepts JSON, not gRPC or binary Protobuf. The key belongs only to this server.|Configure un exportador o Collector OTLP HTTP/JSON. Este receptor acepta JSON, no gRPC ni Protobuf binario. La clave es exclusiva de este servidor.
SQL completo, cabeçalhos, URLs e baggage não são persistidos. Não envie segredos nos nomes dos spans.|Full SQL attributes, headers, URLs and baggage are not persisted. Do not send secrets in span names.|No se guardan atributos de SQL completo, encabezados, URLs ni baggage. No envíe secretos en los nombres de spans.
Gerar uma nova chave revoga imediatamente a chave anterior. Continuar?|Generating a new key immediately revokes the previous key. Continue?|Generar una clave nueva revoca inmediatamente la anterior. ¿Continuar?
Gerar / rotacionar chave|Generate / rotate key|Generar / rotar clave
Revogar a chave de traces deste servidor?|Revoke this server's tracing key?|¿Revocar la clave de trazas de este servidor?
Revogar chave|Revoke key|Revocar clave
Chave revogada.|Key revoked.|Clave revocada.
Copie agora. A chave não será exibida novamente.|Copy it now. The key will not be shown again.|Cópiela ahora. La clave no volverá a mostrarse.
Ocultar|Hide|Ocultar
Scripts de correção por servidor|Remediation scripts per server|Scripts de corrección por servidor
Novo runbook|New runbook|Nuevo runbook
Cadastre um script existente e descreva quando deve ser usado. A IA pode recomendar o runbook; somente gatilhos explicitamente autorizados executam automaticamente.|Register an existing script and describe when it should be used. AI can recommend the runbook; only explicitly authorized triggers execute automatically.|Registre un script existente y describa cuándo usarlo. La IA puede recomendar el runbook; solo los disparadores autorizados explícitamente se ejecutan automáticamente.
Requer SSH gerenciado e o auxiliar local habilitado com upgrade.sh --enable-runbooks. Scripts devem pertencer a root, ter shebang e execução permitida, sem escrita por grupo ou outros.|Requires managed SSH and the local helper enabled with upgrade.sh --enable-runbooks. Scripts must belong to root, have a shebang and execution permission, with no group or other write permissions.|Requiere SSH administrado y el auxiliar local habilitado con upgrade.sh --enable-runbooks. Los scripts deben pertenecer a root, tener shebang y permiso de ejecución, sin escritura para grupo u otros.
Autorizar a execução automática deste script como root para o gatilho e limites cadastrados?|Authorize this script to run automatically as root for the configured trigger and limits?|¿Autorizar la ejecución automática de este script como root para el disparador y límites configurados?
Runbook salvo.|Runbook saved.|Runbook guardado.
Caminho absoluto do script|Absolute script path|Ruta absoluta del script
Descrição e quando usar|Description and when to use|Descripción y cuándo usar
Gatilho|Trigger|Disparador
Somente manual|Manual only|Solo manual
Serviço específico|Specific service|Servicio específico
Previsão de saturação de disco|Disk saturation forecast|Predicción de saturación de disco
Anomalia de memória|Memory anomaly|Anomalía de memoria
Anomalia de CPU|CPU anomaly|Anomalía de CPU
Anomalia de temperatura|Temperature anomaly|Anomalía de temperatura
Anomalia de I/O|I/O anomaly|Anomalía de E/S
Modo|Mode|Modo
Aprovação humana|Human approval|Aprobación humana
Automático autorizado|Authorized automatic execution|Ejecución automática autorizada
Intervalo mínimo (segundos)|Minimum interval (seconds)|Intervalo mínimo (segundos)
Máximo de execuções em 24 horas|Maximum executions per 24 hours|Máximo de ejecuciones en 24 horas
Runbook habilitado|Runbook enabled|Runbook habilitado
Arquivo recusado pelo servidor. Confira habilitação e permissões.|File rejected by the server. Check enablement and permissions.|Archivo rechazado por el servidor. Revise la habilitación y los permisos.
Arquivo verificado. O conteúdo fica vinculado ao hash exibido.|File verified. Its content is pinned to the displayed hash.|Archivo verificado. El contenido queda vinculado al hash mostrado.
Verificar arquivo no servidor|Verify file on server|Verificar archivo en el servidor
Salvar runbook|Save runbook|Guardar runbook
Desabilitado|Disabled|Deshabilitado
Execução preparada para aprovação.|Execution prepared for approval.|Ejecución preparada para aprobación.
Preparar execução|Prepare execution|Preparar ejecución
Arquivar este runbook e cancelar suas execuções pendentes?|Archive this runbook and cancel its pending executions?|¿Archivar este runbook y cancelar sus ejecuciones pendientes?
Últimas 30 execuções|Last 30 executions|Últimas 30 ejecuciones
Nenhuma execução registrada.|No executions recorded.|No hay ejecuciones registradas.
Executar este script no servidor agora?|Execute this script on the server now?|¿Ejecutar este script en el servidor ahora?
Aguardando aprovação|Awaiting approval|Esperando aprobación
Em execução|Executing|En ejecución
Concluído|Completed|Completado
Resultado indeterminado|Unknown result|Resultado indeterminado
Verificado manualmente|Manually reviewed|Verificado manualmente
Não executado|Not executed|No ejecutado
Rejeitado|Rejected|Rechazado
Confirma que verificou manualmente o servidor e o resultado desta execução? Isso libera novas ações, sem repetir o script.|Confirm that you manually checked the server and this execution's result. This allows new actions without repeating the script.|Confirme que verificó manualmente el servidor y el resultado de esta ejecución. Esto permite nuevas acciones sin repetir el script.
Confirmar verificação manual|Confirm manual review|Confirmar verificación manual
Histórico insuficiente: são necessárias pelo menos 24 amostras horárias cobrindo 24 horas.|Insufficient history: at least 24 hourly samples spanning 24 hours are required.|Historial insuficiente: se requieren al menos 24 muestras horarias que cubran 24 horas.
Três médias horárias consecutivas acima da mediana histórica mais a tolerância robusta (MAD). Associação temporal não comprova falha física.|Three consecutive hourly averages above the historical median plus the robust tolerance (MAD). Temporal association does not prove physical failure.|Tres promedios horarios consecutivos por encima de la mediana histórica más la tolerancia robusta (MAD). La asociación temporal no demuestra una falla física.
Tendência linear de {{0}} pontos percentuais/h; R²={{1}}. Estimativa condicional à continuidade do crescimento; não é probabilidade de falha.|Linear trend of {{0}} percentage points/hour; R²={{1}}. Estimate assumes continued growth; it is not a failure probability.|Tendencia lineal de {{0}} puntos porcentuales/h; R²={{1}}. La estimación supone crecimiento continuo; no es una probabilidad de falla.
Previsão estatística robusta; não é diagnóstico de defeito físico nem garantia de falha futura.|Robust statistical forecast; not a physical fault diagnosis or a guarantee of future failure.|Predicción estadística robusta; no es un diagnóstico de falla física ni una garantía de falla futura.
Temperatura e I/O dependem de sensores e permissões do host; ausência de leitura não significa saúde.|Temperature and I/O depend on host sensors and permissions; missing readings do not establish health.|La temperatura y E/S dependen de sensores y permisos del host; la ausencia de lecturas no significa salud.
Consultas e chamadas específicas exigem instrumentação OpenTelemetry da aplicação.|Specific queries and calls require OpenTelemetry application instrumentation.|Las consultas y llamadas específicas requieren instrumentación OpenTelemetry de la aplicación.
A análise horária exige histórico; padrões sazonais são usados apenas com amostras suficientes.|Hourly analysis requires history; seasonal patterns are used only with enough samples.|El análisis horario requiere historial; los patrones estacionales solo se usan con muestras suficientes.
`;
