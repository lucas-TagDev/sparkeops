# Painéis públicos para TV

O proprietário ou administrador da organização pode abrir **Painéis públicos** no menu, criar um painel e selecionar servidores e monitores de URLs. Para cada grupo, escolha não incluir, incluir todos (inclusive futuros recursos), ou somente os selecionados. Podem existir até 10 painéis por workspace.

Defina o título, escolha se deseja publicar CPU/memória/disco e os domínios das URLs, e ative o link público. Por padrão, os endereços ficam ocultos. Mesmo quando habilitados, apenas a origem (protocolo, domínio e porta) é publicada, sem caminho, parâmetros ou credenciais.

Copie o link e abra no navegador da TV, sem login. O painel atualiza a cada 15 segundos, oferece tela cheia, filtros por tipo e rotação automática das páginas a cada 20 segundos. Os cartões mostram o último estado recebido, as métricas autorizadas e, para URLs, latência, disponibilidade das verificações em 24 horas e histórico recente. Ausência de coleta não é apresentada como serviço saudável.

**Qualquer pessoa com o link poderá visualizar o conteúdo publicado.** Escolha os nomes e recursos considerando essa visibilidade. O link permite apenas consulta: não oferece SSH, comandos, logs, dados de usuários ou acesso ao assistente. O token fica no fragmento do endereço e é enviado no cabeçalho de autorização, sem cookies. Não coloque esse link em páginas públicas se não quiser distribuí-lo.

Para interromper o acesso, desative ou exclua o painel. **Trocar link** invalida imediatamente o anterior: atualize o endereço na TV. O link também fica indisponível enquanto a assinatura/avaliação da organização estiver inativa. Nenhum histórico é excluído por essa funcionalidade.

Use o domínio HTTPS público da instalação para acesso fora da rede. Um endereço de rede local só funcionará em dispositivos que consigam alcançar essa rede.
