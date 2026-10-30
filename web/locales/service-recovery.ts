export const recoveryRows = `
Permitir ajustes automáticos de configuração suportados|Allow supported automatic configuration repairs|Permitir ajustes automáticos de configuración compatibles
Autoriza parâmetros numéricos suportados de Nginx, Apache, PHP-FPM e MySQL, com backup, teste e restauração quando houver falha. Não autoriza arquivos arbitrários, comandos livres ou alterações em outros serviços.|Authorizes supported numeric settings for Nginx, Apache, PHP-FPM and MySQL, with backup, validation and rollback on failure. Does not authorize arbitrary files, free-form commands or changes to other services.|Autoriza parámetros numéricos compatibles de Nginx, Apache, PHP-FPM y MySQL, con copia de seguridad, validación y restauración en caso de error. No autoriza archivos arbitrarios, comandos libres ni cambios en otros servicios.
Com IA configurada, cada tentativa investiga a causa antes de agir e pode consumir uma nova solicitação de IA. Sem IA, a recuperação permanece no modo simples de reinício.|With AI configured, each attempt investigates the cause before acting and may use another AI request. Without AI, recovery remains a simple restart.|Con IA configurada, cada intento investiga la causa antes de actuar y puede consumir otra solicitud de IA. Sin IA, la recuperación sigue siendo un reinicio simple.
Diagnóstico e decisão da IA|AI diagnosis and decision|Diagnóstico y decisión de la IA
Causa investigada|Investigated cause|Causa investigada
Evidências|Evidence|Evidencias
Ação escolhida|Selected action|Acción elegida
Diagnóstico local|Local diagnosis|Diagnóstico local
Verificação após correção|Post-repair verification|Verificación después de la corrección
Iniciar serviço|Start service|Iniciar servicio
Limpar bloqueio de falhas|Reset failure lockout|Restablecer bloqueo por fallos
Recarregar serviço|Reload service|Recargar servicio
Ajustar configuração|Repair configuration|Ajustar configuración

Autorizar correção imediata de {{0}}? O sistema poderá verificar e reiniciar somente este serviço, sem pedir aprovação a cada incidente. Serão feitas até {{1}} tentativas por incidente, seguindo o intervalo configurado pelo proprietário e parando quando recuperar. A IA analisará os logs e o resultado; nenhuma configuração será editada.|Authorize immediate recovery of {{0}}? The system may check and restart only this service without per-incident approval. Up to {{1}} attempts per incident, following the owner's configured interval and stopping on recovery. AI will analyze logs and results; no configuration will be edited.|¿Autorizar la corrección inmediata de {{0}}? El sistema podrá verificar y reiniciar solo este servicio sin aprobación por incidente. Hasta {{1}} intentos por incidente, siguiendo el intervalo configurado por el propietario y deteniéndose al recuperar. La IA analizará registros y resultados; no se editará ninguna configuración.

Aguardar entre tentativas|Wait between attempts|Esperar entre intentos
Desmarcado: executa as tentativas em sequência. Marcado: aguarda o intervalo escolhido entre elas, respeitando o máximo por incidente.|Unchecked: runs attempts consecutively. Checked: waits the selected interval between them, respecting the per-incident maximum.|Desmarcado: ejecuta los intentos consecutivamente. Marcado: espera el intervalo elegido entre ellos, respetando el máximo por incidente.
Repetir a cada (minutos)|Repeat every (minutes)|Repetir cada (minutos)
Repetições e novas análises podem aumentar os custos com solicitações de IA no seu provedor. O consumo continua sujeito à franquia de IA da conta.|Repetitions and new analyses may increase AI request costs with your provider. Usage remains subject to the account's AI allowance.|Las repeticiones y los nuevos análisis pueden aumentar los costos de solicitudes de IA con su proveedor. El consumo sigue sujeto a la cuota de IA de la cuenta.
Até {{0}} tentativas por incidente. A sequência para ao confirmar a recuperação.|Up to {{0}} attempts per incident. The sequence stops when recovery is confirmed.|Hasta {{0}} intentos por incidente. La secuencia se detiene al confirmar la recuperación.
Intervalo entre tentativas: {{0}} minutos.|Interval between attempts: {{0}} minutes.|Intervalo entre intentos: {{0}} minutos.
Sem intervalo entre tentativas.|No interval between attempts.|Sin intervalo entre intentos.

Limite atual para novos incidentes|Current limit for new incidents|Límite actual para nuevos incidentes
Limite ao iniciar esta sequência|Limit when this sequence started|Límite al iniciar esta secuencia

Correção automática de serviços|Automatic service recovery|Corrección automática de servicios
Defina quantas tentativas sequenciais podem ocorrer por incidente nos serviços com Correção imediata habilitada. A sequência para quando recuperar; não há intervalo obrigatório nem limite diário.|Set the number of sequential attempts per incident for services with immediate recovery enabled. The sequence stops on recovery; there is no mandatory cooldown or daily limit.|Defina cuántos intentos secuenciales se permiten por incidente para servicios con corrección inmediata habilitada. La secuencia se detiene al recuperar; no hay intervalo obligatorio ni límite diario.
Máximo de tentativas por incidente|Maximum attempts per incident|Máximo de intentos por incidente
Escolha de 1 a 20 tentativas. Apenas o proprietário pode alterar. Aumentos valem para novas sequências; reduções também limitam as próximas etapas de uma sequência em andamento.|Choose 1 to 20 attempts. Only the owner can change this. Increases apply to new sequences; reductions also limit upcoming steps in an active sequence.|Elija de 1 a 20 intentos. Solo el propietario puede cambiarlo. Los aumentos se aplican a nuevas secuencias; las reducciones también limitan los siguientes pasos de una secuencia en curso.
O proprietário do workspace define este limite.|The workspace owner sets this limit.|El propietario del workspace define este límite.
Limite de tentativas atualizado.|Attempt limit updated.|Límite de intentos actualizado.
Limite de tentativas do incidente atingido|Incident attempt limit reached|Límite de intentos del incidente alcanzado
Até {{0}} tentativas sequenciais por incidente, sem intervalo ou limite diário. A sequência para ao confirmar a recuperação.|Up to {{0}} sequential attempts per incident, with no cooldown or daily limit. The sequence stops when recovery is confirmed.|Hasta {{0}} intentos secuenciales por incidente, sin intervalo ni límite diario. La secuencia se detiene al confirmar la recuperación.
Autoriza até {{0}} tentativas sequenciais por incidente. O proprietário define o limite nas configurações.|Authorizes up to {{0}} sequential attempts per incident. The owner sets the limit in settings.|Autoriza hasta {{0}} intentos secuenciales por incidente. El propietario define el límite en configuración.
Autorizar correção imediata de {{0}}? O sistema poderá verificar e reiniciar somente este serviço, sem pedir aprovação a cada incidente. Serão feitas até {{1}} tentativas sequenciais por incidente, sem intervalo ou limite diário, parando quando recuperar. A IA analisará os logs e o resultado; nenhuma configuração será editada.|Authorize immediate recovery of {{0}}? The system can check and restart only this service without approval per incident. Up to {{1}} sequential attempts per incident, with no cooldown or daily limit, stopping on recovery. AI analyzes logs and results; no configuration is edited.|¿Autorizar la corrección inmediata de {{0}}? El sistema podrá verificar y reiniciar solo este servicio sin aprobación por incidente. Hasta {{1}} intentos secuenciales por incidente, sin intervalo ni límite diario, deteniéndose al recuperar. La IA analizará registros y resultados; no se editará ninguna configuración.

Até 5 tentativas sequenciais por incidente, sem intervalo ou limite diário. A sequência para ao confirmar a recuperação.|Up to 5 sequential attempts per incident, with no cooldown or daily limit. The sequence stops when recovery is confirmed.|Hasta 5 intentos secuenciales por incidente, sin intervalo ni límite diario. La secuencia se detiene al confirmar la recuperación.
tentativas no último incidente|attempts in the latest incident|intentos en el último incidente
restantes na sequência|remaining in this sequence|restantes en esta secuencia
Tentativas por incidente|Attempts per incident|Intentos por incidente
Cinco tentativas concluídas neste incidente|Five attempts completed for this incident|Cinco intentos completados en este incidente
Autoriza até 5 tentativas sequenciais de recuperação por incidente, sem intervalo ou limite diário. Exige SSH configurado.|Authorizes up to 5 sequential recovery attempts per incident, with no cooldown or daily limit. SSH configuration is required.|Autoriza hasta 5 intentos secuenciales de recuperación por incidente, sin intervalo ni límite diario. Requiere SSH configurado.
Autorizar correção imediata de {{0}}? O sistema poderá verificar e reiniciar somente este serviço, sem pedir aprovação a cada incidente. Serão feitas até 5 tentativas sequenciais por incidente, sem intervalo ou limite diário, parando quando recuperar. A IA analisará os logs e o resultado; nenhuma configuração será editada.|Authorize immediate recovery of {{0}}? The system can check and restart only this service without approval per incident. Up to 5 sequential attempts per incident, with no cooldown or daily limit, stopping on recovery. AI analyzes logs and results; no configuration is edited.|¿Autorizar la corrección inmediata de {{0}}? El sistema podrá verificar y reiniciar solo este servicio sin aprobación por incidente. Hasta 5 intentos secuenciales por incidente, sin intervalo ni límite diario, deteniéndose al recuperar. La IA analizará registros y resultados; no se editará ninguna configuración.

Nenhuma tentativa agendada|No attempt scheduled|Ningún intento programado
Intervalo entre reinícios|Interval between restarts|Intervalo entre reinicios

Aguardando próxima tentativa|Waiting for next attempt|Esperando el próximo intento
Limite: 3 reinícios nas últimas 24 horas e intervalo mínimo de 15 minutos. O contador usa o horário do servidor.|Limit: 3 restarts in the last 24 hours and a minimum 15-minute interval. The countdown uses server time.|Límite: 3 reinicios en las últimas 24 horas y un intervalo mínimo de 15 minutos. El contador usa la hora del servidor.
Correção desativada|Recovery disabled|Corrección desactivada
Resultado indeterminado: verifique o servidor|Indeterminate result: check the server|Resultado indeterminado: verifique el servidor
Tentativa em execução|Attempt in progress|Intento en ejecución
Limite diário atingido|Daily limit reached|Límite diario alcanzado
Aguardando intervalo|Waiting for interval|Esperando el intervalo
Aguardando verificação para executar|Waiting for pre-execution checks|Esperando verificación para ejecutar
Disponível para novos incidentes|Available for new incidents|Disponible para nuevos incidentes
reinícios nas últimas 24 horas|restarts in the last 24 hours|reinicios en las últimas 24 horas
disponíveis|available|disponibles
Uso do limite de reinícios|Restart limit usage|Uso del límite de reinicios
Próxima tentativa em|Next attempt in|Próximo intento en
Nova tentativa permitida em|New attempt allowed in|Nuevo intento permitido en
Liberação prevista|Expected availability|Disponibilidad prevista
Agendada enquanto o alerta estiver ativo e a correção permanecer autorizada.|Scheduled while the alert is active and recovery remains authorized.|Programado mientras la alerta esté activa y la corrección siga autorizada.
Aguardando liberação para iniciar a tentativa.|Waiting for availability to start the attempt.|Esperando disponibilidad para iniciar el intento.

Tentativas de correção|Recovery attempts|Intentos de corrección
Tentativas de correção imediata|Immediate recovery attempts|Intentos de corrección inmediata
Veja o que foi solicitado ao servidor, as respostas recebidas e a análise da IA. Um comando rejeitado não confirma que o serviço foi reiniciado.|See what was requested from the server, the responses received and the AI analysis. A rejected command does not confirm the service was restarted.|Consulte lo solicitado al servidor, las respuestas recibidas y el análisis de la IA. Un comando rechazado no confirma que el servicio se haya reiniciado.
Rejeitado pelo gateway|Rejected by gateway|Rechazado por el gateway
Nenhum comando enviado ao servidor neste registro.|No command sent to the server in this record.|No se envió ningún comando al servidor en este registro.
Registro anterior: exibindo os comandos vinculados disponíveis; etapas sem vínculo não podem ser reconstruídas.|Earlier record: showing available linked commands; unlinked steps cannot be reconstructed.|Registro anterior: se muestran los comandos vinculados disponibles; no se pueden reconstruir pasos sin vínculo.
Consulta de estado|Status check|Consulta de estado
Solicitação de reinício|Restart request|Solicitud de reinicio
Comandos previstos para esta etapa|Commands planned for this step|Comandos previstos para este paso
Resposta do servidor|Server response|Respuesta del servidor
Ainda não há resposta registrada.|No response recorded yet.|Todavía no hay respuesta registrada.
Resultado da tentativa|Attempt outcome|Resultado del intento
Resumo da investigação|Investigation summary|Resumen de la investigación
Nenhuma tentativa de correção encontrada.|No recovery attempts found.|No se encontraron intentos de corrección.

Falha na correção|Recovery failed|Falló la corrección
Resultado indeterminado|Indeterminate outcome|Resultado indeterminado
Não executado|Not executed|No ejecutado
Servidor indisponível para investigação.|Server unavailable for investigation.|Servidor no disponible para investigación.

Correção imediata|Immediate recovery|Corrección inmediata
Tratar com o assistente|Handle with assistant|Tratar con el asistente
Preparando resumo da investigação…|Preparing investigation summary…|Preparando resumen de la investigación…
Correção imediata atualizada.|Immediate recovery updated.|Corrección inmediata actualizada.
Autoriza uma tentativa de reinício por incidente, até 3 por dia e com intervalo mínimo de 15 minutos. Exige SSH configurado.|Authorizes one restart attempt per incident, up to 3 per day and at least 15 minutes apart. SSH configuration is required.|Autoriza un intento de reinicio por incidente, hasta 3 por día y con un intervalo mínimo de 15 minutos. Requiere SSH configurado.
Autorizar correção imediata de {{0}}? O sistema poderá verificar e reiniciar somente este serviço, sem pedir aprovação a cada incidente. Limite: uma tentativa por incidente, até 3 por dia, com intervalo mínimo de 15 minutos. A IA analisará os logs e o resultado; nenhuma configuração será editada.|Authorize immediate recovery for {{0}}? The system can check and restart only this service without asking for approval for each incident. Limit: one attempt per incident, up to 3 per day, at least 15 minutes apart. AI will analyze logs and the outcome; no configuration will be edited.|¿Autorizar la corrección inmediata de {{0}}? El sistema podrá verificar y reiniciar solo este servicio sin solicitar aprobación en cada incidente. Límite: un intento por incidente, hasta 3 por día, con un intervalo mínimo de 15 minutos. La IA analizará los registros y el resultado; no se editará ninguna configuración.
recovered|Recovered|Recuperado
skipped|Skipped|Omitido
unknown|Indeterminate|Indeterminado
executing|Executing|En ejecución
failed|Failed|Fallido
`;
