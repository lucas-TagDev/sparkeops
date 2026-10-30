export const terminalRows = `
Terminal SSH|SSH terminal|Terminal SSH
Carregando terminal…|Loading terminal…|Cargando terminal…
Conecte para abrir uma sessão interativa no servidor.|Connect to open an interactive server session.|Conéctese para abrir una sesión interactiva en el servidor.
Configure primeiro a conexão SSH deste servidor.|Configure this server's SSH connection first.|Configure primero la conexión SSH de este servidor.
Conectado|Connected|Conectado
Conectando…|Connecting…|Conectando…
Desconectado|Disconnected|Desconectado
Conectar|Connect|Conectar
Desconectar|Disconnect|Desconectar
Limpar tela|Clear screen|Limpiar pantalla
Restaurar tamanho|Restore size|Restaurar tamaño
Expandir terminal|Expand terminal|Expandir terminal
Terminal interativo do servidor|Interactive server terminal|Terminal interactiva del servidor
Terminal direto: os comandos digitados executam no servidor. O conteúdo da sessão não é enviado à IA nem gravado no histórico do chat.|Direct terminal: typed commands execute on the server. Session content is not sent to AI or saved in chat history.|Terminal directa: los comandos escritos se ejecutan en el servidor. El contenido no se envía a la IA ni se guarda en el historial del chat.
Inatividade: 10 min · Duração máxima: 1 h · Reconexão sempre manual|Idle timeout: 10 min · Maximum duration: 1 h · Manual reconnection|Inactividad: 10 min · Duración máxima: 1 h · Reconexión manual
Habilitar terminal|Enable terminal|Habilitar terminal
Desabilitar terminal|Disable terminal|Deshabilitar terminal
Habilitar acesso ao terminal interativo? Os comandos digitados executam diretamente com as permissões da conta SSH, sem aprovação por comando da IA.|Enable interactive terminal access? Typed commands execute directly with the SSH account's permissions, without per-command AI approval.|¿Habilitar acceso al terminal interactivo? Los comandos escritos se ejecutan con los permisos de la cuenta SSH, sin aprobación por comando de la IA.
O proprietário precisa habilitar o terminal para esta conexão SSH. Alterar as credenciais exige habilitação novamente.|The owner must enable the terminal for this SSH connection. Changing credentials requires enabling it again.|El propietario debe habilitar el terminal para esta conexión SSH. Cambiar las credenciales requiere habilitarlo de nuevo.
Habilitar o terminal do usuário SSH gerenciado no Ubuntu|Enable the managed SSH user's terminal on Ubuntu|Habilitar el terminal del usuario SSH administrado en Ubuntu
O usuário gerenciado é restrito por padrão. Para permitir uma shell administrativa, execute no Ubuntu como root:|The managed user is restricted by default. To allow an administrative shell, run on Ubuntu as root:|El usuario administrado está restringido por defecto. Para permitir una shell administrativa, ejecute en Ubuntu como root:
Depois habilite o terminal no painel e conecte. Para bloquear novas shells no Ubuntu, use --disable-terminal e encerre as sessões ativas no painel.|Then enable the terminal in the dashboard and connect. To block new shells on Ubuntu, use --disable-terminal and end active sessions in the dashboard.|Después habilite el terminal en el panel y conéctese. Para bloquear nuevas shells en Ubuntu, use --disable-terminal y cierre las sesiones activas en el panel.
Sessão encerrada.|Session closed.|Sesión cerrada.
Terminal desabilitado pelo proprietário.|Terminal disabled by the owner.|Terminal deshabilitado por el propietario.
Sessão encerrada após 10 minutos sem digitação.|Session closed after 10 minutes without typing.|Sesión cerrada tras 10 minutos sin escribir.
Limite de uma hora atingido. Conecte novamente.|One-hour limit reached. Connect again.|Se alcanzó el límite de una hora. Conéctese de nuevo.
Conexão interrompida. Nenhum comando foi reenviado.|Connection interrupted. No commands were resent.|Conexión interrumpida. No se reenviaron comandos.
Acesso ou conexão SSH alterado. A sessão foi encerrada.|Access or SSH connection changed. Session closed.|El acceso o conexión SSH cambió. Sesión cerrada.
A sessão foi encerrada por uma mensagem inválida.|Session closed due to an invalid message.|Sesión cerrada por un mensaje inválido.
Volume de saída excedido. Conecte novamente.|Output limit exceeded. Connect again.|Se excedió el límite de salida. Conéctese de nuevo.
O servidor recusou o terminal interativo. Confira a configuração SSH.|The server refused the interactive terminal. Check SSH settings.|El servidor rechazó el terminal interactivo. Revise la configuración SSH.
O servidor encerrou a sessão SSH.|The server closed the SSH session.|El servidor cerró la sesión SSH.
Falha SSH. Confira rede, credenciais e fingerprint.|SSH failed. Check the network, credentials and fingerprint.|Error SSH. Revise la red, credenciales y fingerprint.
Resposta inválida do terminal.|Invalid terminal response.|Respuesta del terminal inválida.
Não foi possível abrir o terminal. Confira a conexão SSH e o suporte a WebSocket no proxy.|Unable to open the terminal. Check SSH connectivity and WebSocket support in the proxy.|No se pudo abrir el terminal. Revise la conexión SSH y el soporte WebSocket del proxy.
Escolha se o terminal deve estar habilitado.|Choose whether the terminal should be enabled.|Elija si el terminal debe estar habilitado.
Terminal SSH habilitado|SSH terminal enabled|Terminal SSH habilitado
Terminal SSH desabilitado|SSH terminal disabled|Terminal SSH deshabilitado
Sessão de terminal SSH iniciada|SSH terminal session started|Sesión de terminal SSH iniciada
Sessão de terminal SSH encerrada|SSH terminal session closed|Sesión de terminal SSH cerrada
`;
