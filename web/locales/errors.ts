export const errorRows = `
Agente inválido.|Invalid agent.|Agente inválido.
Credencial de agente inválida.|Invalid agent credential.|Credencial de agente inválida.
SSH já cadastrado. Remova a conexão no painel antes de cadastrar outra.|SSH already registered. Remove the connection in the dashboard before adding another.|SSH ya registrado. Elimina la conexión en el panel antes de añadir otra.
Autorização SSH expirada ou inválida. Gere outra no painel.|SSH authorization expired or invalid. Generate another in the dashboard.|Autorización SSH caducada o inválida. Genera otra en el panel.
O cadastro automático exige chave privada do usuário dedicado foxops-ssh.|Automatic setup requires a private key for the dedicated foxops-ssh user.|La configuración automática requiere una clave privada del usuario dedicado foxops-ssh.
SSH já cadastrado; não será substituído pelo agente.|SSH already registered; the agent will not replace it.|SSH ya registrado; el agente no lo sustituirá.
Escolha um serviço monitorado e um período de até 24 horas nos últimos 7 dias.|Choose a monitored service and a period of up to 24 hours within the last 7 days.|Elige un servicio monitorizado y un período de hasta 24 horas en los últimos 7 días.
Aguarde a verificação em andamento.|Wait for the current check to finish.|Espera a que termine la verificación actual.
Resumo local inválido.|Invalid local summary.|Resumen local inválido.
Verificação encerrada ou pertencente a outro servidor.|Check closed or belongs to another server.|Verificación finalizada o perteneciente a otro servidor.
Provedor de IA inválido.|Invalid AI provider.|Proveedor de IA inválido.
Não foi possível conectar ao provedor de IA. Tente novamente.|Could not connect to the AI provider. Try again.|No se pudo conectar al proveedor de IA. Inténtalo de nuevo.
O provedor retornou uma resposta inválida.|The provider returned an invalid response.|El proveedor devolvió una respuesta inválida.
O modelo não retornou texto. Confira a disponibilidade do modelo ou tente novamente.|The model returned no text. Check model availability or try again.|El modelo no devolvió texto. Comprueba su disponibilidad o inténtalo de nuevo.
Proteção das chaves de IA não configurada corretamente.|AI key protection is not configured correctly.|La protección de claves de IA no está configurada correctamente.
Restaure o arquivo de proteção antes de cadastrar novas chaves.|Restore the protection file before adding new keys.|Restaura el archivo de protección antes de añadir nuevas claves.
Não foi possível proteger a chave. Verifique as permissões de armazenamento.|Could not protect the key. Check storage permissions.|No se pudo proteger la clave. Comprueba los permisos de almacenamiento.
A chave de proteção da instalação não está disponível. Restaure o arquivo de proteção junto com o backup.|The installation protection key is unavailable. Restore the protection file with the backup.|La clave de protección de la instalación no está disponible. Restaura el archivo de protección junto con la copia de seguridad.
Não foi possível abrir a credencial de IA. Verifique a chave de proteção ou cadastre a credencial novamente.|Could not open the AI credential. Check the protection key or register the credential again.|No se pudo abrir la credencial de IA. Comprueba la clave de protección o registra de nuevo la credencial.
Informe um identificador de modelo válido, com até 150 caracteres.|Enter a valid model ID of up to 150 characters.|Introduce un ID de modelo válido de hasta 150 caracteres.
Informe se o provedor deve ficar habilitado.|Specify whether the provider should be enabled.|Indica si el proveedor debe estar habilitado.
Informe uma chave de API válida, sem espaços.|Enter a valid API key without spaces.|Introduce una clave de API válida sin espacios.
Cadastre a chave de API deste provedor.|Add this provider's API key.|Añade la clave de API de este proveedor.
Modo de IA inválido.|Invalid AI mode.|Modo de IA inválido.
Cadastre e habilite este provedor antes de selecioná-lo.|Add and enable this provider before selecting it.|Añade y habilita este proveedor antes de seleccionarlo.
A IA da plataforma ainda não foi disponibilizada.|Platform AI is not available yet.|La IA de la plataforma aún no está disponible.
Salve a chave e o modelo antes de testar.|Save the key and model before testing.|Guarda la clave y el modelo antes de probar.
Não foi possível testar a conexão com o provedor.|Could not test the provider connection.|No se pudo probar la conexión con el proveedor.
Muitas solicitações. Aguarde um pouco e tente novamente.|Too many requests. Wait a moment and try again.|Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.
O corpo deve ser um objeto JSON.|The body must be a JSON object.|El cuerpo debe ser un objeto JSON.
Host não permitido. Configure PUBLIC_URL.|Host not allowed. Configure PUBLIC_URL.|Host no permitido. Configura PUBLIC_URL.
Origem não permitida.|Origin not allowed.|Origen no permitido.
Detalhes inválidos.|Invalid details.|Detalles inválidos.
Rota administrativa legada desativada.|Legacy administrative route disabled.|Ruta administrativa antigua deshabilitada.
Acesso administrativo necessário.|Administrative access required.|Se requiere acceso administrativo.
Informe organization.|Provide organization.|Indica organization.
Corpo muito grande.|Request body too large.|Cuerpo de solicitud demasiado grande.
Rota não encontrada.|Route not found.|Ruta no encontrada.
Informe início e fim do período.|Provide the start and end of the period.|Indica el inicio y el fin del período.
Escreva uma pergunta de até 2000 caracteres.|Write a question of up to 2000 characters.|Escribe una pregunta de hasta 2000 caracteres.
Selecione um servidor válido.|Select a valid server.|Selecciona un servidor válido.
Servidor não pertence ao cliente selecionado.|Server does not belong to the selected customer.|El servidor no pertenece al cliente seleccionado.
Selecione um servidor para a verificação ao vivo.|Select a server for the live check.|Selecciona un servidor para la verificación en vivo.
Diagnóstico ainda não concluído, expirado ou de outra pergunta.|Diagnosis is incomplete, expired or for another question.|El diagnóstico está incompleto, caducado o corresponde a otra pregunta.
Selecione um servidor específico para analisar logs.|Select a specific server to analyze logs.|Selecciona un servidor específico para analizar registros.
Selecione o servidor da verificação local.|Select the server for the local check.|Selecciona el servidor de la verificación local.
Solicite uma verificação local na aba Logs e IA e aguarde o agente responder.|Request a local check in Logs and AI and wait for the agent to respond.|Solicita una verificación local en Registros e IA y espera la respuesta del agente.
Selecione um servidor para analisar os processos.|Select a server to analyze processes.|Selecciona un servidor para analizar los procesos.
Consulte os processos na aba Processos e aguarde o agente responder.|Query processes in the Processes tab and wait for the agent to respond.|Consulta los procesos en la pestaña Procesos y espera la respuesta del agente.
O contexto deste cliente é muito grande. Reduza os detalhes coletados antes de consultar a IA.|This customer's context is too large. Reduce collected details before querying AI.|El contexto de este cliente es demasiado grande. Reduce los detalles recopilados antes de consultar a la IA.
O provedor de IA está indisponível. Tente novamente ou use o diagnóstico básico.|The AI provider is unavailable. Try again or use basic diagnosis.|El proveedor de IA no está disponible. Inténtalo de nuevo o usa el diagnóstico básico.
Plano inválido.|Invalid plan.|Plan inválido.
Pagamentos ainda não configurados pelo administrador.|Payments are not configured by the administrator yet.|El administrador aún no ha configurado los pagos.
Este plano não comporta o uso atual da conta.|This plan does not support the account's current usage.|Este plan no admite el uso actual de la cuenta.
Gerencie sua assinatura existente no portal de cobrança.|Manage your existing subscription in the billing portal.|Gestiona tu suscripción existente en el portal de facturación.
Pagamentos ainda não configurados.|Payments not configured yet.|Pagos aún sin configurar.
Nenhuma assinatura vinculada à conta.|No subscription linked to the account.|No hay ninguna suscripción vinculada a la cuenta.
Webhook de cobrança não configurado.|Billing webhook not configured.|Webhook de facturación sin configurar.
Assinatura do webhook inválida.|Invalid webhook signature.|Firma del webhook inválida.
Selecione um servidor e escreva a pergunta.|Select a server and write your question.|Selecciona un servidor y escribe la pregunta.
Investigação expirada ou não encontrada.|Investigation expired or not found.|Investigación caducada o no encontrada.
Revise ou aguarde o comando pendente antes de continuar.|Review or wait for the pending command before continuing.|Revisa o espera el comando pendiente antes de continuar.
Uma execução ficou indeterminada. Verifique o servidor antes de iniciar outra investigação.|An execution result is indeterminate. Check the server before starting another investigation.|Una ejecución quedó indeterminada. Comprueba el servidor antes de iniciar otra investigación.
Limite de cinco comandos atingido. Revise os resultados e inicie outra investigação se necessário.|Five-command limit reached. Review results and start another investigation if needed.|Se alcanzó el límite de cinco comandos. Revisa los resultados e inicia otra investigación si es necesario.
Configure uma IA para investigar usando comandos.|Configure an AI provider to investigate using commands.|Configura una IA para investigar mediante comandos.
A IA não retornou um plano válido. Nenhum comando foi executado.|AI did not return a valid plan. No command was executed.|La IA no devolvió un plan válido. No se ejecutó ningún comando.
Plano de comandos inválido.|Invalid command plan.|Plan de comandos inválido.
Limite de cinco comandos atingido. Nenhum comando adicional foi preparado.|Five-command limit reached. No additional command was prepared.|Se alcanzó el límite de cinco comandos. No se preparó ningún comando adicional.
Leitura expirada ou conexão SSH alterada. Leia a configuração novamente.|Read expired or SSH connection changed. Read the configuration again.|La lectura caducó o cambió la conexión SSH. Lee de nuevo la configuración.
Escolha Nginx, Apache, PHP-FPM ou MySQL identificado neste servidor.|Choose Nginx, Apache, PHP-FPM or MySQL identified on this server.|Elige Nginx, Apache, PHP-FPM o MySQL identificado en este servidor.
Resposta de configuração inválida.|Invalid configuration response.|Respuesta de configuración inválida.
Informe valores para alterar.|Enter values to change.|Introduce valores para cambiar.
Parâmetro ausente, não suportado ou fora do intervalo permitido.|Parameter missing, unsupported or outside the allowed range.|Parámetro ausente, no admitido o fuera del intervalo permitido.
Nenhum valor foi alterado.|No values changed.|No se cambió ningún valor.
Explique o problema ou objetivo (5 a 700 caracteres).|Explain the problem or objective (5 to 700 characters).|Explica el problema u objetivo (5 a 700 caracteres).
A IA não retornou um ajuste válido. Revise os valores manualmente.|AI did not return a valid change. Review values manually.|La IA no devolvió un ajuste válido. Revisa los valores manualmente.
Atualize o agente para 0.7 ou superior para verificar pedidos do chat diretamente no servidor.|Update the agent to 0.7 or later to check chat requests directly on the server.|Actualiza el agente a 0.7 o posterior para verificar las solicitudes del chat directamente en el servidor.
Já existe uma verificação em andamento neste servidor.|A check is already running on this server.|Ya hay una verificación en curso en este servidor.
Verificação não encontrada.|Check not found.|Verificación no encontrada.
Diagnóstico inválido.|Invalid diagnosis.|Diagnóstico inválido.
Métricas ou serviços inválidos.|Invalid metrics or services.|Métricas o servicios inválidos.
Verificação encerrada ou de outro servidor.|Check closed or belongs to another server.|Verificación finalizada o de otro servidor.
Ação ou serviço inválido.|Invalid action or service.|Acción o servicio inválido.
Este serviço não tem teste de configuração disponível.|No configuration test is available for this service.|Este servicio no tiene prueba de configuración disponible.
Selecione até 20 serviços válidos.|Select up to 20 valid services.|Selecciona hasta 20 servicios válidos.
Coleta de logs desabilitada.|Log collection disabled.|Recopilación de registros deshabilitada.
Envie no máximo 30 eventos.|Send no more than 30 events.|Envía como máximo 30 eventos.
Evento de log inválido.|Invalid log event.|Evento de registro inválido.
Serviço inválido.|Invalid service.|Servicio inválido.
Informe host, porta, usuário e fingerprint SSH válidos.|Enter a valid host, port, user and SSH fingerprint.|Introduce host, puerto, usuario y huella SSH válidos.
Chave privada SSH inválida.|Invalid SSH private key.|Clave privada SSH inválida.
Senha SSH inválida.|Invalid SSH password.|Contraseña SSH inválida.
Frase secreta inválida.|Invalid passphrase.|Frase de contraseña inválida.
Cadastre uma chave privada ou senha SSH.|Add an SSH private key or password.|Añade una clave privada o contraseña SSH.
Configure o SSH deste servidor.|Configure SSH for this server.|Configura el SSH de este servidor.
Comando inválido.|Invalid command.|Comando inválido.
Comando muito grande para o executor.|Command too large for the executor.|Comando demasiado grande para el ejecutor.
Auxiliar de configuração indisponível. Atualize o agente e os auxiliares SSH.|Configuration helper unavailable. Update the agent and SSH helpers.|Auxiliar de configuración no disponible. Actualiza el agente y los auxiliares SSH.
Falha SSH: confira rede, autenticação e fingerprint do servidor.|SSH failed: check network, authentication and server fingerprint.|Fallo SSH: comprueba red, autenticación y huella del servidor.
O serviço precisa estar identificado ou configurado no monitoramento.|The service must be identified or configured in monitoring.|El servicio debe estar identificado o configurado en la monitorización.
Configure a conexão SSH antes de preparar uma ação.|Configure the SSH connection before preparing an action.|Configura la conexión SSH antes de preparar una acción.
Ação expirada, já utilizada ou conexão alterada. Prepare uma nova ação.|Action expired, already used or connection changed. Prepare a new action.|Acción caducada, ya utilizada o conexión modificada. Prepara una nueva acción.
Já existe uma execução neste servidor. Aguarde o resultado.|An execution is already running on this server. Wait for the result.|Ya hay una ejecución en este servidor. Espera el resultado.
E-mail inválido.|Invalid email.|Correo electrónico inválido.
Use uma senha de 12 a 128 caracteres.|Use a password of 12 to 128 characters.|Usa una contraseña de 12 a 128 caracteres.
E-mail já cadastrado. Faça login.|Email already registered. Sign in.|Correo ya registrado. Inicia sesión.
E-mail ou senha incorretos.|Incorrect email or password.|Correo o contraseña incorrectos.
Acesso expirado. Faça login novamente.|Access expired. Sign in again.|Acceso caducado. Inicia sesión de nuevo.
Idioma inválido.|Invalid language.|Idioma inválido.
Faça login para continuar.|Sign in to continue.|Inicia sesión para continuar.
Seu perfil não permite esta ação.|Your role does not allow this action.|Tu rol no permite esta acción.
Cliente não encontrado ou sem permissão.|Customer not found or access denied.|Cliente no encontrado o sin permiso.
Seu período de uso terminou. Consulte o plano da conta.|Your usage period has ended. Check the account plan.|Tu período de uso ha terminado. Consulta el plan de la cuenta.
Limite de clientes do plano atingido.|Plan customer limit reached.|Se alcanzó el límite de clientes del plan.
Servidor não encontrado.|Server not found.|Servidor no encontrado.
Limite de servidores do plano atingido.|Plan server limit reached.|Se alcanzó el límite de servidores del plan.
Token de instalação obrigatório.|Installation token required.|Token de instalación obligatorio.
Token expirado ou já utilizado. Gere outro no painel.|Token expired or already used. Generate another in the dashboard.|Token caducado o ya utilizado. Genera otro en el panel.
Assinatura inativa. Consulte o plano da conta.|Subscription inactive. Check the account plan.|Suscripción inactiva. Consulta el plan de la cuenta.
Use uma janela entre 1 e 168 horas.|Use a window between 1 and 168 hours.|Usa un período de entre 1 y 168 horas.
Informe início e fim válidos, com início anterior ao fim e intervalo máximo de 90 dias.|Enter valid start and end times, with start before end and a maximum range of 90 days.|Introduce inicio y fin válidos, con inicio anterior al fin y un intervalo máximo de 90 días.
Alerta não encontrado.|Alert not found.|Alerta no encontrada.
Validade permitida: 7, 30 ou 90 dias.|Allowed validity: 7, 30 or 90 days.|Validez permitida: 7, 30 o 90 días.
Token MCP inválido, revogado ou expirado.|MCP token invalid, revoked or expired.|Token MCP inválido, revocado o caducado.
Perfil inválido.|Invalid role.|Rol inválido.
Selecione os clientes autorizados.|Select authorized customers.|Selecciona los clientes autorizados.
Selecione pelo menos um cliente.|Select at least one customer.|Selecciona al menos un cliente.
Convite inválido ou expirado.|Invitation invalid or expired.|Invitación inválida o caducada.
Informe sua senha atual para aceitar o convite.|Enter your current password to accept the invitation.|Introduce tu contraseña actual para aceptar la invitación.
Você já faz parte desta conta.|You already belong to this account.|Ya perteneces a esta cuenta.
Não é possível remover este membro.|This member cannot be removed.|No se puede eliminar a este miembro.
Conversa inválida.|Invalid conversation.|Conversación inválida.
Aguarde a consulta de processos em andamento.|Wait for the current process query.|Espera la consulta de procesos en curso.
Resultado de processos inválido.|Invalid process result.|Resultado de procesos inválido.
Processo inválido.|Invalid process.|Proceso inválido.
Contagem de processos inválida.|Invalid process count.|Conteo de procesos inválido.
Consulta encerrada ou pertencente a outro servidor.|Query closed or belongs to another server.|Consulta finalizada o perteneciente a otro servidor.
Agente indisponível.|Agent unavailable.|Agente no disponible.
Verificações locais indisponíveis.|Local checks unavailable.|Verificaciones locales no disponibles.
Ações indisponíveis.|Actions unavailable.|Acciones no disponibles.
Ferramenta desconhecida.|Unknown tool.|Herramienta desconocida.
Organização e nome são obrigatórios (até 120 caracteres).|Organization and name are required (up to 120 characters).|Organización y nombre son obligatorios (hasta 120 caracteres).
event_id inválido.|Invalid event_id.|event_id inválido.
Informe cpu_percent, memory_percent e disk_percent entre 0 e 100.|Provide cpu_percent, memory_percent and disk_percent between 0 and 100.|Indica cpu_percent, memory_percent y disk_percent entre 0 y 100.
JSON inválido.|Invalid JSON.|JSON inválido.
Falha interna.|Internal error.|Error interno.
Não foi possível concluir a solicitação.|Could not complete the request.|No se pudo completar la solicitud.
Chave inválida ou sem permissão neste provedor.|Key invalid or not authorized for this provider.|Clave inválida o sin permiso para este proveedor.
Verifique o saldo e os limites da conta no provedor.|Check your provider account balance and limits.|Comprueba el saldo y los límites de tu cuenta en el proveedor.
Modelo ou recurso indisponível. Confira o identificador do modelo.|Model or resource unavailable. Check the model ID.|Modelo o recurso no disponible. Comprueba el ID del modelo.
O provedor recusou a configuração. Confira o modelo e as permissões da chave.|The provider rejected the configuration. Check the model and key permissions.|El proveedor rechazó la configuración. Comprueba el modelo y los permisos de la clave.
O provedor de IA está indisponível. Tente novamente mais tarde.|The AI provider is unavailable. Try again later.|El proveedor de IA no está disponible. Inténtalo más tarde.
`;
