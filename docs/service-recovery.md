# Correção imediata e histórico de tentativas

Em **Servidor → Serviços**, marque **Monitorar serviço** e habilite **Correção imediata** com perfil proprietário ou administrador. A marcação autoriza verificar e reiniciar somente esse serviço, sem solicitar confirmação a cada execução. Exige conexão SSH configurada, fingerprint válido e permissões locais para os comandos.

## Política atual

Para cada novo incidente autorizado, o sistema consulta o estado real via SSH e, se necessário, realiza **até o máximo definido pelo proprietário (cinco tentativas por padrão)**, sem intervalo obrigatório de 15 minutos e sem limite diário. O restart também inicia um serviço parado. A sequência termina assim que confirma `is-active` com sucesso, ou quando perde autorização, há execução indeterminada ou o gateway bloqueia o acesso. Não se trata de um laço infinito: após esgotar o número configurado de tentativas, o incidente fica registrado sem novas repetições automáticas para esse mesmo incidente.

Cada etapa usa o executor de serviços. Nginx, Apache e PHP-FPM passam pelo teste de configuração existente antes do reinício. A automação não executa comandos livres nem edita arquivos de configuração. Os logs são lidos e resumidos localmente pelo agente; a IA analisa os resultados disponíveis e aponta hipóteses somente quando houver evidências. Não há garantia de identificar a causa quando a coleta for insuficiente.

Após concluir, o sistema salva o resultado e envia um resumo pelos canais de **Serviços** habilitados na organização. A análise aguarda aproximadamente 90 segundos pelos dados locais. Se a IA estiver indisponível ou sem franquia, envia o relatório técnico. Com IA configurada, cada planejamento de tentativa consome uma chamada e há um resumo final; veja a seção de investigação da causa.

Um gateway ausente ou uma conexão SSH indeterminada não é uma falha do serviço: a execução para e notifica o bloqueio, sem registrar reinícios fictícios. Gateways antigos que rejeitam serviços personalizados precisam ser atualizados com `upgrade.sh`. Desativar o monitoramento ou a correção revoga a autorização. Alterar a conexão SSH exige reautorizar a configuração. Runbooks automáticos do mesmo serviço são suprimidos para evitar automações simultâneas.

## Histórico

**Servidor → Serviços, logs e correções → Tentativas de correção** mostra busca, filtros e paginação, com cada consulta de estado e cada solicitação de reinício, horários, comandos previstos, saída e resultado. Uma etapa pode conter vários comandos; quando o primeiro falha, os seguintes não executam. Ausência de saída ou erro de conexão não comprova execução bem-sucedida.

O indicador mostra o consumo de tentativas e o limite adotado no último incidente. Sem trabalho pendente, mostra **Nenhuma tentativa agendada**. Não há contagem regressiva diária na nova política. Esperas antigas causadas exclusivamente pela política anterior são liberadas para revalidação, apenas se o incidente e sua autorização ainda estiverem ativos. Tentativas antigas concluídas não são repetidas retroativamente.

Registros anteriores ao vínculo detalhado mostram as ações disponíveis; etapas que não foram gravadas não são reconstruídas.

## Alertas e assistente

**Tratar com o assistente** abre o servidor correto, com o contexto do alerta e o resumo disponível preenchidos na pergunta. Abrir o chat não executa comandos. O usuário revisa e envia a pergunta.

A validação automatizada utiliza SSH, IA e notificações simulados; nenhum teste reinicia serviços reais.


## Limite definido pelo proprietário

Em **Configurações → Correção automática de serviços**, o proprietário do workspace define de 1 a 20 tentativas sequenciais por incidente. O padrão é cinco. Administradores, operadores e leitores podem consultar o limite, mas não alterá-lo. A política é independente por workspace e cada alteração fica na auditoria.

Aumento do máximo vale para novas sequências; redução também limita as próximas etapas de uma sequência em andamento. O histórico preserva o limite capturado ao iniciar cada sequência, mesmo após alterações posteriores, e mostra o limite atual separadamente quando diferente. Alterar a política não reabre incidentes que já concluíram suas tentativas.


## Intervalo opcional entre tentativas

O proprietário pode marcar **Aguardar entre tentativas** e definir **Repetir a cada (minutos)**, entre 1 e 1.440 minutos. A opção começa desmarcada: as tentativas seguem consecutivas. Marcada, cada tentativa malsucedida agenda a próxima para o intervalo escolhido, até alcançar o máximo do incidente. Não reinicia indefinidamente a sequência após esgotar esse máximo.

Ao alterar o intervalo, esperas pendentes são recalculadas a partir da conclusão da última tentativa. Ao desmarcar a espera, a sequência autorizada continua sem intervalo obrigatório. Recuperação do serviço, revogação da autorização ou falha de acesso cancela a execução seguinte. O histórico preserva as etapas e exibe a contagem regressiva.

A tela avisa que repetições e novas análises podem aumentar o custo de solicitações de IA no provedor, respeitando a franquia da conta. O contador não chama a IA e as análises são feitas no planejamento das tentativas e ao final da sequência, evitando consumo a cada atualização de tela ou a cada minuto de espera.


## Investigação da causa antes de agir — agente 0.11.0

Quando houver IA configurada, cada tentativa executa um diagnóstico no servidor: metadados do systemd (estado, resultado e código de saída), classificação dos logs e até oito amostras curtas de erros, com remoção de credenciais comuns. O modelo recebe esses dados e as decisões anteriores e retorna uma ação estruturada para o mesmo serviço: iniciar, reiniciar, recarregar, limpar o bloqueio de falhas, ajustar configuração suportada ou encerrar por falta de solução sustentada. Comandos livres e ações fora desse conjunto são rejeitados. Não há promessa de identificar qualquer causa ou resolver toda falha.

A recuperação verifica o serviço depois da ação. `reset-failed` não é tratado como recuperação por si só: se o serviço continuar parado, a próxima tentativa recebe um novo diagnóstico e pode escolher `start`. O histórico exibe causa investigada, evidências, motivo da ação e resultado da verificação. Sem IA configurada, permanece a recuperação simples por reinício, identificada nas configurações.

A opção **Permitir ajustes automáticos de configuração suportados**, disponível somente ao proprietário, começa desabilitada. Quando habilitada, permite apenas os parâmetros numéricos dos perfis existentes de Nginx, Apache, PHP-FPM e MySQL. A execução exige leitura atual da configuração, hash correspondente, valor permitido, backup, teste e restauração em caso de falha. Não libera arquivos arbitrários nem reparos genéricos em aplicações personalizadas. Falha de restauração interrompe a automação para investigação.

Agora há uma solicitação de IA por planejamento de tentativa, além do resumo final, respeitando as franquias. O contador e a espera não fazem chamadas. A atualização do agente é necessária para disponibilizar o diagnóstico SSH:

```bash
curl -fsS http://192.168.3.41:8080/agent/upgrade.sh -o /tmp/foxops-upgrade.sh
sudo bash /tmp/foxops-upgrade.sh
```

O upgrade também reinstala um gateway ausente quando encontra a instalação SSH gerenciada existente, preservando as credenciais. A alteração da plataforma não corrige silenciosamente os arquivos de um Ubuntu remoto: o upgrade precisa ser executado na máquina. Testes utilizam SSH e IA simulados.
