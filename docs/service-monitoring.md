# Serviços selecionados e resumos de incidentes

Em **Servidores → Serviços, logs e correções → Serviços**, marque **Monitorar serviço** nas linhas dos serviços essenciais. Ao lado aparece **Resumo IA**, que pode ser ativado ou desativado individualmente.

- Serviços selecionados alertam em `inactive`, `failed` ou `not_loaded`, respeitando a duração configurada nas regras do servidor. `unknown` e perda de comunicação não comprovam queda ou recuperação.
- Serviços não selecionados preservam a política de descoberta existente: no modo automático, somente `failed` abre incidente; unidades inativas podem ser normais.
- Desmarcar uma seleção impede novos incidentes daquele serviço. Incidentes anteriores preservam seu histórico e só são recuperados quando o estado `active` for observado.
- A seleção inicial habilita o resumo; esse uso da IA é informado ao lado da lista. É possível manter o monitor ativo e desabilitar somente o resumo.
- Há até 100 serviços selecionados por servidor. Busca e paginação da lista continuam funcionando.

O agente **0.9.1** recebe as unidades selecionadas como obrigatórias e continua consultando seu estado mesmo se desaparecerem da descoberta automática. Atualize com o script de upgrade habitual. Os nomes selecionados têm prioridade sobre o limite de descoberta de 1.000 serviços.

Quando um novo alerta abrir, a plataforma envia o aviso técnico sem aguardar a IA. Em seguida solicita ao agente a verificação local do journal daquele serviço, na janela dos cinco minutos anteriores. O resumo aguarda cerca de um minuto pelo resultado. Somente contagens e categorias são retornadas ao painel/provedor, sem enviar logs brutos automaticamente.

A IA recebe o alerta histórico, o estado mais recentemente reportado, o horário de recuperação quando houver e o resumo local disponível. Produz no máximo um resumo por incidente, com fatos, hipótese quando sustentada e próximo passo. Um estado inativo pode corresponder a parada planejada; não se inventa crash, OOM ou causa raiz. Sem logs disponíveis, a causa permanece não confirmada.

O resumo utiliza o provedor e a franquia diária da conta. Se a IA estiver indisponível, desligada ou a franquia esgotada, permanece o alerta e o resumo técnico. Não há repetição automática de chamadas ao provedor para o mesmo incidente nem execução de correções.

Em **Configurações → Notificações por organização**, habilite **Serviços** nos canais Telegram, WhatsApp ou e-mail desejados. As opções de abertura e recuperação continuam sendo respeitadas. O resumo da IA segue a opção de abertura. O painel mostra os últimos 20 relatórios, cinco por página e com detalhes recolhidos.

Selecionar um serviço não reenvia incidentes antigos. Alterar sua seleção ou o resumo cancela relatórios ainda pendentes ou em geração, preservando relatórios concluídos. A auditoria registra alterações e geração de resumos.
