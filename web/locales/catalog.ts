import { settingsRows } from "./settings.ts";
import { recoveryRows } from "./service-recovery.ts";
import { platformEmailRows } from "./platform-email.ts";
import { accountRows } from "./accounts.ts";
import { urlRows } from "./urls.ts";
import { historicalRows } from "./historical.ts";
import { alertHistoryRows } from "./alert-history.ts";
import { agentGuideRows } from "./agent-guide.ts";
import { terminalRows } from "./terminal.ts";
import { serverRemovalRows } from "./server-removal.ts";
import { serverIconRows } from "./server-icons.ts";
import { serviceMonitoringRows } from "./service-monitoring.ts";
import { processMonitoringRows } from "./process-monitoring.ts";
import { conversationContextRows } from "./conversation-context.ts";
import { commandReviewRows } from "./command-review.ts";
import { actionHistoryRows } from "./action-history.ts";
import { observabilityRows } from "./observability.ts";
import { notificationRows } from "./notifications.ts";
import { paymentRows } from "./payments.ts";
import { auditRows } from "./audit.ts";
import { supplementRows } from "./supplement.ts";
import { brandingRows } from "./branding.ts";
import { errorRows } from "./errors.ts";
import { templateRows } from "./templates.ts";
import { detailRows } from "./details.ts";
// Source strings are stable catalog keys. Technical identifiers are deliberately preserved.
export const rows = `
Visão geral|Overview|Vista general
Servidores|Servers|Servidores
Clientes|Customers|Clientes
Alertas|Alerts|Alertas
Assistente|Assistant|Asistente
Assistente IA|AI assistant|Asistente IA
Integrações MCP|MCP integrations|Integraciones MCP
Equipe e acessos|Team and access|Equipo y acceso
Plano e consumo|Plan and usage|Plan y consumo
Configurações|Settings|Configuración
MONITORAMENTO|MONITORING|MONITORIZACIÓN
Avaliação|Trial|Prueba
Proprietário|Owner|Propietario
Administrador|Administrator|Administrador
Operador|Operator|Operador
Leitor|Viewer|Lector
Atualizar|Refresh|Actualizar
Atualizar gráfico|Refresh chart|Actualizar gráfico
Atualizar resultados|Refresh results|Actualizar resultados
Ver alertas|View alerts|Ver alertas
Adicionar servidor|Add server|Añadir servidor
Adicionar servidor Linux|Add Linux server|Añadir servidor Linux
Todos os clientes|All customers|Todos los clientes
Todos os clientes permitidos|All permitted customers|Todos los clientes permitidos
Todos os servidores deste cliente|All servers for this customer|Todos los servidores de este cliente
Filtrar por cliente|Filter by customer|Filtrar por cliente
Última atualização|Last updated|Última actualización
Servidores monitorados|Monitored servers|Servidores monitorizados
Servidores online|Online servers|Servidores en línea
Alertas ativos|Active alerts|Alertas activas
Nenhum incidente ativo|No active incidents|Sin incidentes activos
Nenhum servidor offline|No offline servers|Sin servidores desconectados
Sem comunicação|No communication|Sin comunicación
Seus servidores|Your servers|Tus servidores
Ver todos|View all|Ver todos
SERVIDOR / CLIENTE|SERVER / CUSTOMER|SERVIDOR / CLIENTE
MEMÓRIA|MEMORY|MEMORIA
DISCO|DISK|DISCO
Em atenção|Needs attention|Requiere atención
Tudo tranquilo por aqui|Everything looks good|Todo está tranquilo
Monitoramento independente de IA|Monitoring independent of AI|Monitorización independiente de la IA
Explorar assistente|Explore assistant|Explorar asistente
Configurar MCP|Configure MCP|Configurar MCP
Ver meu plano|View my plan|Ver mi plan
Sair|Sign out|Cerrar sesión
Abrir menu|Open menu|Abrir menú
Fechar erro|Dismiss error|Cerrar error
Buscar servidor|Search servers|Buscar servidor
Buscar servidor…|Search servers…|Buscar servidor…
Buscar serviço|Search services|Buscar servicio
Estado|Status|Estado
Ativos|Active|Activos
Inativos|Inactive|Inactivos
Com falha|Failed|Con fallo
Demais estados|Other states|Otros estados
Todos os estados|All states|Todos los estados
Por página|Per page|Por página
Serviços por página|Services per page|Servicios por página
Paginação dos serviços|Service pagination|Paginación de servicios
Página|Page|Página
Página anterior|Previous page|Página anterior
Próxima página|Next page|Página siguiente
de|of|de
no total|total|en total
Nenhum serviço encontrado|No services found|No se encontraron servicios
Nenhum serviço corresponde à busca e ao estado selecionado.|No services match the search and selected status.|Ningún servicio coincide con la búsqueda y el estado seleccionado.
Serviços|Services|Servicios
Serviço|Service|Servicio
Serviços, logs e correções|Services, logs and repairs|Servicios, registros y correcciones
Logs e IA|Logs and AI|Registros e IA
Processos|Processes|Procesos
Configurações de serviços|Service configuration|Configuración de servicios
Conexão SSH|SSH connection|Conexión SSH
Ações e aprovações|Actions and approvals|Acciones y aprobaciones
Agente|Agent|Agente
Agente e sistema|Agent and system|Agente y sistema
Hostname|Hostname|Nombre del host
Sistema|System|Sistema
Rede recebida / enviada|Network received / sent|Red recibida / enviada
Informações da última coleta, sem execução remota.|Information from the latest collection, without remote execution.|Información de la última recopilación, sin ejecución remota.
Reinstalar agente|Reinstall agent|Reinstalar agente
Revogar acesso|Revoke access|Revocar acceso
Arquivar servidor|Archive server|Archivar servidor
Credencial revogada.|Credential revoked.|Credencial revocada.
Servidor arquivado.|Server archived.|Servidor archivado.
Descobrir automaticamente serviços instalados|Automatically discover installed services|Detectar automáticamente los servicios instalados
Serviços selecionados (separados por vírgula)|Selected services (comma separated)|Servicios seleccionados (separados por comas)
Salvar monitoramento|Save monitoring|Guardar monitorización
Monitoramento configurado. Aguarde a próxima coleta.|Monitoring configured. Wait for the next collection.|Monitorización configurada. Espera la próxima recopilación.
Aguardando coleta|Waiting for collection|Esperando recopilación
Aguardando descoberta de serviços ou atualização do agente.|Waiting for service discovery or an agent update.|Esperando la detección de servicios o una actualización del agente.
Regras de alerta|Alert rules|Reglas de alerta
Memória (%)|Memory (%)|Memoria (%)
Disco (%)|Disk (%)|Disco (%)
Sem comunicação (s)|No communication (s)|Sin comunicación (s)
Duração mínima (s)|Minimum duration (s)|Duración mínima (s)
Salvar regras|Save rules|Guardar reglas
Regras salvas.|Rules saved.|Reglas guardadas.
Histórico de utilização|Usage history|Historial de uso
Últimos 15 minutos|Last 15 minutes|Últimos 15 minutos
Última hora|Last hour|Última hora
Últimas 6 horas|Last 6 hours|Últimas 6 horas
Últimas 24 horas|Last 24 hours|Últimas 24 horas
Últimos 7 dias|Last 7 days|Últimos 7 días
Data e horário personalizados|Custom date and time|Fecha y hora personalizadas
Período do histórico|History period|Período del historial
Métricas do gráfico|Chart metrics|Métricas del gráfico
Memória|Memory|Memoria
Disco|Disk|Disco
Rede|Network|Red
Escala|Scale|Escala
Escala do gráfico|Chart scale|Escala del gráfico
Automática · ampliar variações|Automatic · magnify variations|Automática · ampliar variaciones
Completa · 0 a 100%|Full · 0 to 100%|Completa · 0 a 100%
Data e hora inicial|Start date and time|Fecha y hora de inicio
Data e hora final|End date and time|Fecha y hora de fin
De|From|Desde
Até|To|Hasta
Aplicar período|Apply period|Aplicar período
Horário local:|Local time:|Hora local:
Escolha a data e o horário|Choose date and time|Elige la fecha y la hora
Carregando histórico…|Loading history…|Cargando historial…
Sem coletas neste período|No samples in this period|Sin muestras en este período
Passe o cursor para consultar um ponto|Hover to inspect a point|Pasa el cursor para consultar un punto
Consultar coleta pelo teclado|Inspect sample using keyboard|Consultar muestra con el teclado
Ponto do histórico|History point|Punto del historial
Médias por intervalos de|Averages over intervals of|Promedios por intervalos de
minuto(s) ·|minute(s) ·|minuto(s) ·
pontos ·|points ·|puntos ·
coletas.|samples.|muestras.
Lacunas não são ligadas por uma linha.|Gaps are not connected by a line.|Los intervalos sin datos no se unen con una línea.
Escala ampliada: observe os valores do eixo.|Magnified scale: check the axis values.|Escala ampliada: observa los valores del eje.
Defina o início e o fim e clique em Aplicar período.|Set the start and end, then click Apply period.|Define el inicio y el fin y pulsa Aplicar período.
Escolha início anterior ao fim e um intervalo de até 90 dias.|Choose a start before the end and a range of up to 90 days.|Elige un inicio anterior al fin y un intervalo de hasta 90 días.
Escolha outro intervalo ou aguarde o envio de métricas pelo agente.|Choose another range or wait for the agent to send metrics.|Elige otro intervalo o espera a que el agente envíe métricas.
Consultar processos agora|Check processes now|Consultar procesos ahora
Ordenar processos|Sort processes|Ordenar procesos
Maior CPU|Highest CPU|Mayor CPU
Maior memória|Highest memory|Mayor memoria
Coleta de processos|Process sample|Muestra de procesos
Analisar processos com IA|Analyze processes with AI|Analizar procesos con IA
Processo / PID|Process / PID|Proceso / PID
Usuário|User|Usuario
Tempo|Elapsed time|Tiempo
Serviço / investigação|Service / investigation|Servicio / investigación
Sem associação identificada|No association found|Sin asociación identificada
Preparar verificação do serviço|Prepare service check|Preparar verificación del servicio
MiB residentes|MiB resident|MiB residentes
Coletado em|Collected at|Recopilado el
processos visíveis ·|visible processes ·|procesos visibles ·
leituras inacessíveis, encerradas ou sem amostra comparável.|readings inaccessible, exited, or without a comparable sample.|lecturas inaccesibles, finalizadas o sin una muestra comparable.
· intervalo de|· sample interval|· intervalo de
· estado|· state|· estado
Análise da coleta selecionada|Analysis of the selected sample|Análisis de la muestra seleccionada
Processando solicitação…|Processing request…|Procesando solicitud…
Processando…|Processing…|Procesando…
Diagnóstico|Diagnosis|Diagnóstico
Diagnóstico básico|Basic diagnosis|Diagnóstico básico
Somente diagnóstico básico|Basic diagnosis only|Solo diagnóstico básico
Consulta solicitada. O agente mede os processos no próprio Ubuntu na próxima coleta.|Request submitted. The agent measures processes on Ubuntu during the next collection.|Solicitud enviada. El agente medirá los procesos en Ubuntu durante la próxima recopilación.
Filtrar logs por serviço|Filter logs by service|Filtrar registros por servicio
Selecione um serviço para verificar|Select a service to check|Selecciona un servicio para verificar
Período da verificação local|Local check period|Período de verificación local
Verificar na máquina|Check on server|Verificar en el servidor
Interpretar resumo com IA|Interpret summary with AI|Interpretar resumen con IA
Análise concluída. Nenhum comando foi executado.|Analysis completed. No command was executed.|Análisis completado. No se ejecutó ningún comando.
Logs atualizados.|Logs refreshed.|Registros actualizados.
Fontes lidas:|Sources read:|Fuentes leídas:
Permissão negada|Permission denied|Permiso denegado
Conexão recusada|Connection refused|Conexión rechazada
Tempo de espera do upstream|Upstream timeout|Tiempo de espera del upstream
Erro de configuração|Configuration error|Error de configuración
Falta de memória|Out of memory|Falta de memoria
Outros erros|Other errors|Otros errores
Avisos|Warnings|Avisos
Aguardando agente|Waiting for agent|Esperando al agente
Enviado ao agente|Sent to agent|Enviado al agente
Concluído|Completed|Completado
Expirou|Expired|Caducado
Expirou sem resposta|Expired without a response|Caducado sin respuesta
Limite de 500 registros atingido.|Limit of 500 records reached.|Se alcanzó el límite de 500 registros.
Host ou IP do Ubuntu|Ubuntu host or IP|Host o IP de Ubuntu
Porta SSH|SSH port|Puerto SSH
Usuário SSH|SSH user|Usuario SSH
Autenticação|Authentication|Autenticación
Chave privada|Private key|Clave privada
Chave privada SSH|SSH private key|Clave privada SSH
Senha|Password|Contraseña
Senha SSH|SSH password|Contraseña SSH
Senha do usuário SSH|SSH user password|Contraseña del usuario SSH
Frase secreta da chave (opcional)|Key passphrase (optional)|Frase de contraseña de la clave (opcional)
Fingerprint da chave do servidor (SHA256)|Server key fingerprint (SHA256)|Huella de la clave del servidor (SHA256)
Salvar SSH|Save SSH|Guardar SSH
Testar SSH|Test SSH|Probar SSH
Remover SSH|Remove SSH|Eliminar SSH
Autorizar configuração automática|Authorize automatic setup|Autorizar configuración automática
Obtenha no console do Ubuntu, por exemplo:|Obtain it from the Ubuntu console, for example:|Obtenla en la consola de Ubuntu, por ejemplo:
Cole esta autorização apenas quando o instalador pedir no Ubuntu:|Paste this authorization only when the installer prompts on Ubuntu:|Pega esta autorización solo cuando el instalador la solicite en Ubuntu:
Conexão SSH salva com credencial criptografada.|SSH connection saved with an encrypted credential.|Conexión SSH guardada con la credencial cifrada.
Credencial SSH removida.|SSH credential removed.|Credencial SSH eliminada.
Credencial salva · deixe vazio para manter|Credential saved · leave blank to keep|Credencial guardada · deja vacío para conservarla
SSH conectado; consulta de hostname concluída.|SSH connected; hostname query completed.|SSH conectado; consulta del nombre del host completada.
Autorização válida por 15 minutos e usada uma única vez.|Authorization valid for 15 minutes and usable once.|Autorización válida durante 15 minutos y de un solo uso.
Remover a credencial SSH deste servidor?|Remove this server's SSH credential?|¿Eliminar la credencial SSH de este servidor?
Ação|Action|Acción
Motivo|Reason|Motivo
Selecione|Select|Selecciona
Consultar estado|Check status|Consultar estado
Validar configuração|Validate configuration|Validar configuración
Recarregar serviço|Reload service|Recargar servicio
Reiniciar serviço|Restart service|Reiniciar servicio
Preparar ação para revisão|Prepare action for review|Preparar acción para revisión
Aprovar e executar|Approve and execute|Aprobar y ejecutar
Rejeitar|Reject|Rechazar
Rejeitado|Rejected|Rechazado
Executando|Executing|Ejecutando
Falhou|Failed|Falló
Aguardando aprovação|Awaiting approval|Pendiente de aprobación
Resultado indeterminado|Indeterminate result|Resultado indeterminado
Restaurado após falha|Restored after failure|Restaurado tras el fallo
Verifique a restauração e o serviço|Check restoration and service|Verifica la restauración y el servicio
Ação preparada. Revise e aprove para executar.|Action prepared. Review and approve to execute.|Acción preparada. Revisa y aprueba para ejecutar.
Ação rejeitada.|Action rejected.|Acción rechazada.
Execução encerrada. Confira o resultado registrado.|Execution ended. Check the recorded result.|Ejecución finalizada. Revisa el resultado registrado.
Preparar para aprovação|Prepare for approval|Preparar para aprobación
Preparar|Prepare|Preparar
para aprovação|for approval|para aprobación
Sugestão:|Suggestion:|Sugerencia:
Ajustes de configuração com revisão e restauração|Configuration changes with review and restoration|Ajustes de configuración con revisión y restauración
Serviço para ajustar configuração|Service to configure|Servicio para ajustar la configuración
Ler configuração pelo SSH|Read configuration over SSH|Leer configuración por SSH
Arquivo:|File:|Archivo:
. Ativação:|. Activation:|. Activación:
· atual:|· current:|· actual:
Permitido:|Allowed:|Permitido:
Objetivo do ajuste|Adjustment objective|Objetivo del ajuste
Problema ou objetivo do ajuste|Problem or adjustment objective|Problema u objetivo del ajuste
Descreva o problema observado e o resultado esperado.|Describe the observed problem and expected outcome.|Describe el problema observado y el resultado esperado.
Pedir sugestão à IA|Ask AI for a suggestion|Pedir sugerencia a la IA
Comparação antes/depois|Before/after comparison|Comparación antes/después
Preparar alteração para aprovação|Prepare change for approval|Preparar cambio para aprobación
Alteração de configuração revisada|Reviewed configuration change|Cambio de configuración revisado
Recarregamento|Reload|Recarga
Reinício: pode interromper conexões|Restart: may interrupt connections|Reinicio: puede interrumpir conexiones
recarregamento do serviço|service reload|recarga del servicio
reinício do serviço (pode interromper conexões)|service restart (may interrupt connections)|reinicio del servicio (puede interrumpir conexiones)
Ajuste numérico revisado no painel.|Numeric change reviewed in the dashboard.|Ajuste numérico revisado en el panel.
FoxOps Assistente|FoxOps Assistant|Asistente FoxOps
Cliente da conversa|Conversation customer|Cliente de la conversación
Servidor da conversa|Conversation server|Servidor de la conversación
Conversa sobre|Conversation about|Conversación sobre
Limpar conversa|Clear conversation|Limpiar conversación
Conversa limpa.|Conversation cleared.|Conversación limpiada.
Desfazer|Undo|Deshacer
Pergunta ao assistente|Question for the assistant|Pregunta al asistente
Enviar pergunta|Send question|Enviar pregunta
Investigar usando comandos SSH, com aprovação antes de cada execução|Investigate using SSH commands, with approval before each execution|Investigar con comandos SSH, con aprobación antes de cada ejecución
Incluir verificação local de logs neste pedido|Include a local log check in this request|Incluir verificación local de registros en esta solicitud
Incluir nova coleta de processos neste pedido|Include a new process sample in this request|Incluir una nueva muestra de procesos en esta solicitud
Comandos SSH após aprovação|SSH commands after approval|Comandos SSH tras aprobación
Consultas pelo agente|Agent queries|Consultas mediante el agente
Modo de análise|Analysis mode|Modo de análisis
Usar IA configurada|Use configured AI|Usar IA configurada
Usar diagnóstico básico|Use basic diagnosis|Usar diagnóstico básico
Comando proposto para|Command proposed for|Comando propuesto para
Aprovar comando e continuar análise|Approve command and continue analysis|Aprobar comando y continuar análisis
Analisar o resultado da investigação|Analyze investigation results|Analizar el resultado de la investigación
Preparando investigação por comandos SSH…|Planning an SSH command investigation…|Preparando investigación con comandos SSH…
Executando o comando aprovado no servidor…|Executing the approved command on the server…|Ejecutando el comando aprobado en el servidor…
Analisando a saída do comando…|Analyzing command output…|Analizando la salida del comando…
Solicitando verificação no servidor…|Requesting a server check…|Solicitando verificación en el servidor…
Verificando no servidor… aguardando o agente receber o pedido.|Checking the server… waiting for the agent to receive the request.|Verificando el servidor… esperando a que el agente reciba la solicitud.
O agente recebeu o pedido. Verificando na máquina…|The agent received the request. Checking on the server…|El agente recibió la solicitud. Verificando en el servidor…
Verificação recebida. Analisando o resultado…|Check received. Analyzing results…|Verificación recibida. Analizando el resultado…
O que acontece no seu ambiente?|What is happening in your environment?|¿Qué ocurre en tu entorno?
Como está a saúde deste ambiente?|How healthy is this environment?|¿Cuál es el estado de este entorno?
O que precisa de atenção?|What needs attention?|¿Qué necesita atención?
Há risco de falta de espaço em disco?|Is there a risk of running out of disk space?|¿Hay riesgo de quedarse sin espacio en disco?
Confirmar ação|Confirm action|Confirmar acción
Confirmar|Confirm|Confirmar
Cancelar|Cancel|Cancelar
Fechar confirmação|Close confirmation|Cerrar confirmación
Salvar|Save|Guardar
Concluir|Done|Finalizar
E-mail|Email|Correo electrónico
Nome|Name|Nombre
Seu nome|Your name|Tu nombre
Seu perfil|Your role|Tu perfil
Perfil|Role|Rol
Sua senha|Your password|Tu contraseña
Como podemos chamar você?|What should we call you?|¿Cómo te llamas?
Nome da empresa|Company name|Nombre de la empresa
Nome do seu workspace|Workspace name|Nombre de tu espacio de trabajo
Empresa ou operação|Company or operation|Empresa u operación
Criar minha conta|Create my account|Crear mi cuenta
Entrar no workspace|Sign in to workspace|Entrar al espacio de trabajo
Começar agora|Get started|Comenzar ahora
Aceitar convite|Accept invitation|Aceptar invitación
Já tem uma conta?|Already have an account?|¿Ya tienes una cuenta?
Ainda não tem uma conta?|Don't have an account yet?|¿Aún no tienes una cuenta?
Pelo menos 12 caracteres|At least 12 characters|Al menos 12 caracteres
Você foi convidado|You are invited|Has recibido una invitación
BEM-VINDO AO FOXOPS|WELCOME TO FOXOPS|BIENVENIDO A FOXOPS
Bom ter você por aqui.|Good to have you here.|Nos alegra verte aquí.
Entre para acompanhar o seu ambiente.|Sign in to monitor your environment.|Inicia sesión para supervisar tu entorno.
Crie seu acesso ou use a senha da sua conta existente.|Create your login or use your existing account password.|Crea tu acceso o usa la contraseña de tu cuenta existente.
Crie sua conta. Avaliação de 14 dias, até 5 servidores.|Create your account. 14-day trial, up to 5 servers.|Crea tu cuenta. Prueba de 14 días, hasta 5 servidores.
Senhas protegidas e acesso isolado por cliente.|Protected passwords and isolated customer access.|Contraseñas protegidas y acceso aislado por cliente.
SEU AMBIENTE, SOB CONTROLE|YOUR ENVIRONMENT, UNDER CONTROL|TU ENTORNO, BAJO CONTROL
Sua infraestrutura.|Your infrastructure.|Tu infraestructura.
Sem pontos|Without blind|Sin puntos
cegos.|spots.|ciegos.
LINUX. CONTEXTO. CONTROLE.|LINUX. CONTEXT. CONTROL.|LINUX. CONTEXTO. CONTROL.
Métricas e alertas contínuos|Continuous metrics and alerts|Métricas y alertas continuas
Múltiplos clientes, um painel|Multiple customers, one dashboard|Varios clientes, un panel
Assistente integrado + MCP|Integrated assistant + MCP|Asistente integrado + MCP
Sua operação merece clareza.|Your operation deserves clarity.|Tu operación merece claridad.
MENOS RUÍDO. MAIS CONTEXTO.|LESS NOISE. MORE CONTEXT.|MENOS RUIDO. MÁS CONTEXTO.
Suas métricas têm uma história para contar.|Your metrics have a story to tell.|Tus métricas tienen una historia que contar.
SEU PRÓXIMO PASSO|YOUR NEXT STEP|TU SIGUIENTE PASO
Conecte sua operação.|Connect your operation.|Conecta tu operación.
Leve no servidor. Completo na operação.|Lightweight on servers. Complete for operations.|Ligero en el servidor. Completo en la operación.
Observabilidade Linux, com contexto.|Linux observability, with context.|Observabilidad Linux, con contexto.
Conexões autenticadas · Acesso por cliente|Authenticated connections · Per-customer access|Conexiones autenticadas · Acceso por cliente
Um olhar completo sobre a saúde da sua infraestrutura.|A complete view of your infrastructure health.|Una vista completa del estado de tu infraestructura.
Adicione clientes, convide sua equipe e conecte ferramentas de IA com acesso de consulta.|Add customers, invite your team and connect AI tools with query access.|Añade clientes, invita a tu equipo y conecta herramientas de IA con acceso de consulta.
Investigue seu ambiente com o assistente ou conecte sua própria IA via MCP.|Investigate your environment with the assistant or connect your own AI via MCP.|Investiga tu entorno con el asistente o conecta tu propia IA mediante MCP.
Monitoramento que conecta servidores, pessoas e inteligência. Do primeiro Linux à operação de todos os seus clientes.|Monitoring that connects servers, people and intelligence. From your first Linux server to all your customers' operations.|Monitorización que conecta servidores, personas e inteligencia. Desde tu primer Linux hasta la operación de todos tus clientes.
Coleta por agente Linux, conexão de saída e acesso de consulta. Você mantém o controle.|Linux agent collection, outbound connection and query access. You stay in control.|Recopilación mediante agente Linux, conexión saliente y acceso de consulta. Mantienes el control.
Inventário de servidores|Server inventory|Inventario de servidores
Inventário e métricas recentes|Inventory and recent metrics|Inventario y métricas recientes
Acompanhe cada servidor. Antecipe o próximo problema.|Monitor every server. Anticipate the next problem.|Supervisa cada servidor. Anticípate al próximo problema.
Nenhum servidor cadastrado|No servers registered|No hay servidores registrados
Seu próximo servidor começa aqui|Your next server starts here|Tu próximo servidor empieza aquí
Conecte primeiro servidor|Connect first server|Conecta el primer servidor
Conectar primeiro servidor|Connect first server|Conectar el primer servidor
Conecte seu servidor|Connect your server|Conecta tu servidor
Nome do servidor|Server name|Nombre del servidor
Cliente|Customer|Cliente
Novo cliente|New customer|Nuevo cliente
Criar cliente|Create customer|Crear cliente
Cliente criado.|Customer created.|Cliente creado.
Clientes autorizados|Authorized customers|Clientes autorizados
Clientes permitidos|Permitted customers|Clientes permitidos
Todos os seus clientes, cada um no seu próprio ambiente.|All your customers, each in their own environment.|Todos tus clientes, cada uno en su propio entorno.
Uma operação, muitos clientes.|One operation, many customers.|Una operación, muchos clientes.
Ambiente isolado ·|Isolated environment ·|Entorno aislado ·
server(s)|server(s)|servidor(es)
servidor(es)|server(s)|servidor(es)
servidores|servers|servidores
cliente(s)|customer(s)|cliente(s)
alertas ativos|active alerts|alertas activas
Convidar pessoa|Invite person|Invitar persona
Convidar para o workspace|Invite to workspace|Invitar al espacio de trabajo
Gerar convite|Generate invitation|Generar invitación
Convite pronto|Invitation ready|Invitación lista
Pessoas no workspace|People in workspace|Personas en el espacio de trabajo
As pessoas certas, com os acessos certos.|The right people with the right access.|Las personas adecuadas con los accesos adecuados.
Acesso removido.|Access removed.|Acceso eliminado.
Novo token|New token|Nuevo token
Novo token MCP|New MCP token|Nuevo token MCP
Criar token de leitura|Create read token|Crear token de lectura
Seus tokens de acesso|Your access tokens|Tus tokens de acceso
Token criado|Token created|Token creado
Token criado. Configure-o no seu cliente MCP.|Token created. Configure it in your MCP client.|Token creado. Configúralo en tu cliente MCP.
Token revogado.|Token revoked.|Token revocado.
Retenção|Retention|Retención
Retenção de métricas|Metrics retention|Retención de métricas
Validade|Validity|Validez
Escopo|Scope|Ámbito
Conta|Account|Cuenta
Uso único. Válido até|Single use. Valid until|Uso único. Válido hasta
Informe este token quando solicitado|Enter this token when prompted|Introduce este token cuando se solicite
Copie agora. O token completo não será exibido novamente.|Copy now. The full token will not be shown again.|Cópialo ahora. El token completo no se volverá a mostrar.
Conecte seu cliente MCP|Connect your MCP client|Conecta tu cliente MCP
Ferramentas disponíveis|Available tools|Herramientas disponibles
Leve contexto real para sua IA.|Bring real context to your AI.|Lleva contexto real a tu IA.
Sua infraestrutura, conectada às ferramentas de IA.|Your infrastructure, connected to AI tools.|Tu infraestructura, conectada a herramientas de IA.
Sua próxima conexão começa com um token|Your next connection starts with a token|Tu próxima conexión empieza con un token
MCP com token|MCP with token|MCP con token
Registro de auditoria|Audit log|Registro de auditoría
Últimos 100 eventos|Last 100 events|Últimos 100 eventos
Nenhum evento registrado|No events recorded|Sin eventos registrados
As ações e consultas autorizadas aparecerão aqui.|Authorized actions and queries will appear here.|Las acciones y consultas autorizadas aparecerán aquí.
Preferências e rastreabilidade do seu workspace.|Workspace preferences and traceability.|Preferencias y trazabilidad de tu espacio de trabajo.
Inteligência artificial|Artificial intelligence|Inteligencia artificial
Provedor de IA|AI provider|Proveedor de IA
Modo do assistente|Assistant mode|Modo del asistente
Provedor padrão do assistente|Default assistant provider|Proveedor predeterminado del asistente
Chaves da sua conta|Your account keys|Claves de tu cuenta
Chave da API|API key|Clave de API
Cole sua chave de API|Paste your API key|Pega tu clave de API
Chave protegida · Atualizada em|Protected key · Updated at|Clave protegida · Actualizada el
Chave salva · deixe vazio para manter|Key saved · leave blank to keep|Clave guardada · deja vacío para conservarla
Chave removida.|Key removed.|Clave eliminada.
Habilitar|Enable|Habilitar
Modelo|Model|Modelo
ID do modelo disponível na sua conta|Model ID available in your account|ID del modelo disponible en tu cuenta
Exemplos para escolher|Examples to choose from|Ejemplos para elegir
Catálogo oficial|Official catalog|Catálogo oficial
Obter chave|Get key|Obtener clave
Testar conexão|Test connection|Probar conexión
Teste de conexão concluído.|Connection test completed.|Prueba de conexión completada.
Usar no assistente|Use in assistant|Usar en el asistente
Em uso|In use|En uso
Disponível|Available|Disponible
Não configurado|Not configured|Sin configurar
Modo do assistente atualizado.|Assistant mode updated.|Modo del asistente actualizado.
IA da plataforma|Platform AI|IA de la plataforma
IA|AI|IA
Assistente por regras|Rule-based assistant|Asistente basado en reglas
Salve as alterações antes de testar|Save changes before testing|Guarda los cambios antes de probar
Último teste:|Last test:|Última prueba:
conexão confirmada|connection confirmed|conexión confirmada
· indisponível|· unavailable|· no disponible
· minha chave|· my key|· mi clave
Salvar alterações|Save changes|Guardar cambios
Plano atual|Current plan|Plan actual
SEU PLANO ATUAL|YOUR CURRENT PLAN|TU PLAN ACTUAL
Consultas de IA hoje|AI calls today|Consultas de IA hoy
Escolher plano|Choose plan|Elegir plan
Gerenciar assinatura e pagamentos|Manage subscription and payments|Gestionar suscripción y pagos
Preço definido no checkout|Price shown at checkout|Precio indicado al pagar
Pagamento não configurado|Payments not configured|Pagos sin configurar
Pagamentos Stripe|Stripe payments|Pagos Stripe
Configuração comercial do proprietário|Owner billing configuration|Configuración comercial del propietario
Um plano que acompanha o seu crescimento.|A plan that grows with you.|Un plan que acompaña tu crecimiento.
PARA EQUIPES EM CRESCIMENTO|FOR GROWING TEAMS|PARA EQUIPOS EN CRECIMIENTO
Mais contexto para sua equipe.|More context for your team.|Más contexto para tu equipo.
MCP e alertas incluídos|MCP and alerts included|MCP y alertas incluidos
consultas de IA por dia|AI calls per day|consultas de IA por día
dias de histórico|days of history|días de historial
dias|days|días
até|up to|hasta
7 dias|7 days|7 días
30 dias|30 days|30 días
90 dias|90 days|90 días
Notificações webhook|Webhook notifications|Notificaciones webhook
Estado das integrações|Integration status|Estado de las integraciones
Nenhum alerta ativo|No active alerts|Sin alertas activas
Incidentes e recuperações|Incidents and recoveries|Incidentes y recuperaciones
Reconhecer|Acknowledge|Reconocer
Recuperados|Recovered|Recuperados
Crítico|Critical|Crítico
Atenção|Warning|Atención
Aberto em|Opened at|Abierto el
Todo o histórico|All history|Todo el historial
Nenhum evento neste filtro|No events match this filter|Ningún evento coincide con este filtro
O que precisa de atenção, antes de virar um problema.|What needs attention before it becomes a problem.|Lo que necesita atención antes de convertirse en un problema.
Precisam da sua atenção|Need your attention|Requieren tu atención
Verifique os agentes e a rede|Check agents and network|Verifica los agentes y la red
Saúde e última comunicação|Health and last communication|Estado y última comunicación
Histórico agregado por minuto|History aggregated by minute|Historial agregado por minuto
Estado dos serviços configurados|Configured service status|Estado de los servicios configurados
Preparando seu ambiente…|Preparing your environment…|Preparando tu entorno…
Transforme métricas em próximos passos.|Turn metrics into next steps.|Convierte métricas en próximos pasos.
Sua operação começa aqui.|Your operation starts here.|Tu operación empieza aquí.
Do terminal ao painel em poucos minutos.|From terminal to dashboard in minutes.|Del terminal al panel en pocos minutos.
Cadastrar e instalar agente|Register and install agent|Registrar e instalar agente
No terminal do servidor Linux|On the Linux server terminal|En el terminal del servidor Linux
Baixe o instalador e execute com permissão de administrador.|Download the installer and run it with administrator privileges.|Descarga el instalador y ejecútalo con permisos de administrador.
Entendi, acompanhar servidor|Got it, monitor server|Entendido, supervisar servidor
Ex.: Acme Tecnologia|E.g. Acme Technology|Ej.: Acme Tecnología
Ex.: Minha ferramenta de IA|E.g. My AI tool|Ej.: Mi herramienta de IA
Ex.: producao-web-01|E.g. production-web-01|Ej.: produccion-web-01
Ex.: serviço falhou após uma atualização|E.g. service failed after an update|Ej.: el servicio falló tras una actualización
Ex.: nginx, mysql, ssh…|E.g. nginx, mysql, ssh…|Ej.: nginx, mysql, ssh…
← Voltar ao inventário|← Back to inventory|← Volver al inventario
Última coleta:|Last collected:|Última recopilación:
Sem coleta|No samples|Sin muestras
 (você)| (you)| (tú)
· Expira|· Expires|· Caduca
· máx.|· max.|· máx.
mín.|min.|mín.
Idioma|Language|Idioma
Idioma salvo.|Language saved.|Idioma guardado.
Idioma da interface|Interface language|Idioma de la interfaz
Não foi possível salvar o idioma.|Could not save language.|No se pudo guardar el idioma.
Atualizando idioma…|Updating language…|Actualizando idioma…
Idioma detectado pelo navegador|Language detected from browser|Idioma detectado del navegador
Siga com cuidado|Proceed carefully|Procede con cuidado
`;
export const catalog: Record<string, { en: string; es: string }> = {};
for (const row of (
  rows +
  "\n" +
  detailRows +
  "\n" +
  templateRows +
  "\n" +
  errorRows +
  "\n" +
  supplementRows +
  "\n" +
  brandingRows +
  "\n" +
  auditRows +
  "\n" +
  paymentRows +
  "\n" +
  urlRows +
  "\n" +
  notificationRows +
  "\n" +
  observabilityRows +
  "\n" +
  actionHistoryRows +
  "\n" +
  commandReviewRows +
  "\n" +
  conversationContextRows +
  "\n" +
  processMonitoringRows +
  "\n" +
  serviceMonitoringRows +
  "\n" +
  serverIconRows +
  "\n" +
  serverRemovalRows +
  "\n" +
  terminalRows +
  "\n" +
  agentGuideRows +
  "\n" +
  alertHistoryRows +
  "\n" +
  historicalRows +
  "\n" +
  accountRows +
  "\n" +
  platformEmailRows +
  "\n" +
  recoveryRows +
  "\n" +
  settingsRows
)
  .trim()
  .split("\n")) {
  const [key, en, es] = row.split("|");
  if (key && en && es) catalog[key.replace(/\s+/g, " ").trim()] = { en, es };
}
