# Processos monitorados e resumo de incidentes

Em **Servidores → Serviços, logs e correções → Processos**, solicite uma coleta. Na linha desejada, clique **Monitorar processo**. Depois de salvar, a linha passa a indicar **Monitorado**. Para processos que não aparecem entre os maiores consumidores, use **Adicionar por nome**.

O cadastro sugere o nome exato (`comm` do Linux), usuário e serviço encontrados na amostra. O PID é apenas histórico: a regra acompanha novas instâncias com os mesmos filtros depois de reinícios. Processos com o mesmo nome, usuário e serviço são tratados em conjunto. Nomes Linux podem ser truncados pelo kernel; utilize o nome que aparece na coleta. Não são lidas linhas de comando ou variáveis de ambiente.

Configure:

- Número mínimo de instâncias ativas; abaixo desse valor, considera-se uma condição de ausência. Zumbis, processos encerrados e processos suspensos não contam como ativos.
- Limites opcionais de CPU e memória em porcentagem do host, agregados para o grupo selecionado. A soma de RSS pode contar memória compartilhada mais de uma vez; não equivale à memória exclusiva do grupo.
- Duração mínima da condição, de 30 a 3.600 segundos. O agente coleta aproximadamente a cada 30 segundos; a confirmação depende das coletas disponíveis.
- Aviso opcional quando todas as identidades PID/início observadas forem substituídas entre coletas. Isso pode indicar reinício planejado ou falha; não comprova um crash. É um evento de troca, sem esperar a duração mínima.
- Resumo com IA e verificação local de logs do serviço associado em incidentes.

Há até 20 regras por servidor, com busca, paginação de cinco regras, edição e pausa. Para reativar uma regra pausada, edite-a e marque **Monitoramento ativo**.

## Atualização do agente

Requer agente **0.9.0 ou superior**. No Ubuntu de teste:

```sh
curl -fsS 'http://192.168.3.41:8080/agent/upgrade.sh' -o /tmp/foxops-upgrade.sh
sudo bash /tmp/foxops-upgrade.sh
```

Em produção, utilize a origem HTTPS da sua instalação. O agente recebe as regras na resposta da próxima coleta e verifica os nomes selecionados em `/proc`, independentemente de estarem na lista dos maiores consumidores. Usa duas amostras para CPU e a identidade PID/início para evitar confundir PIDs reciclados.

Uma leitura parcial, sem permissão ou ausente não é interpretada como queda nem recuperação. Sem dados recentes por dois minutos, a tela indica que está aguardando coleta; os alertas de comunicação do servidor continuam separados. Um processo que cai e retorna totalmente entre duas coletas pode não ter sua ausência observada; a opção de troca de identidades pode detectar algumas dessas situações. Para grupos acima de 200 instâncias, não é feita inferência de reinício.

## Notificações e IA

Em **Configurações → Notificações por organização**, habilite **Processos monitorados** nos canais desejados. Preferências de canais existentes são preservadas: o novo tipo não é ativado silenciosamente. Telegram, WhatsApp e e-mail seguem as credenciais e destinatários daquela organização.

1. Um novo incidente dispara o alerta técnico depois de confirmada a condição. Não se repete a cada coleta.
2. Se houver serviço associado e resumo automático habilitado, é solicitado um job de verificação local de logs ao agente. Apenas contagens e categorias saem do servidor. O resumo aguarda até cerca de um minuto por esse resultado; não afirma ter lido logs indisponíveis.
3. A IA da conta recebe as amostras atual/anterior, condições e limites, e o resumo local disponível. Produz fatos, hipótese quando justificável e próximo passo de investigação. A causa não é apresentada como confirmada sem evidência.
4. É gerado no máximo um resumo por incidente. Ele usa a franquia diária de IA existente. Sem provedor, com IA desativada, franquia esgotada ou erro, fica disponível o resumo técnico e não há repetição automática de chamadas ao provedor.
5. Uma coleta válida dentro dos limites dispara a recuperação. Não são encerrados processos, reiniciados serviços nem executados scripts por esta função.

O painel apresenta os últimos 20 incidentes, cinco por página, incluindo o resumo e o estado da geração. Alterar ou pausar a regra encerra a detecção anterior por mudança de configuração; isso não gera uma falsa mensagem de recuperação. Configurações e geração de resumos ficam na auditoria com o responsável.

Os testes usam coletas e provedores simulados. Depois de atualizar o Ubuntu, valide com um processo de teste antes de usar as regras para processos essenciais.
