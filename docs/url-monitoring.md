# Monitoramento de URLs

O produto **Monitoramento de URLs** está incluído nos planos. O administrador geral define a franquia em **Administração da plataforma → Planos e preços → Editar plano → URLs monitoradas**. Os planos padrão começam com 5 URLs na avaliação, 10 no Essencial, 30 no Equipe e 100 no Prestador. O catálogo mantém os preços existentes. Planos personalizados antigos usam a franquia de servidores como ponto de partida quando não possuem uma franquia de URLs; o administrador pode ajustá-la.

## Cadastrar o primeiro monitor

1. Abra **Monitoramento de URLs** no menu lateral e clique em **Adicionar URL**.
2. Informe um nome e selecione o cliente autorizado.
3. Cadastre a URL pública, por exemplo `https://seusite.com/health`.
4. Escolha GET ou HEAD, intervalo (1 a 60 minutos), tempo limite (5 a 30 segundos), status HTTP esperado e quantidade de falhas consecutivas antes de alertar.
5. Salve. A primeira coleta entra na fila automaticamente. **Verificar agora** inicia uma verificação imediata, respeitando o limite de frequência.

As verificações partem da instalação SparkeOPS. Não exigem agente no site, navegador aberto ou chamadas de IA. A aplicação precisa continuar em execução. O processo agenda coletas e usa registros de execução no banco para impedir coletas duplicadas entre instâncias que compartilhem a mesma base. Sob carga, uma coleta pode começar depois do horário previsto.

## Histórico e incidentes

A lista apresenta estado, status HTTP, latência, disponibilidade nas últimas 24 horas e última coleta. Há busca, filtro por estado e paginação. O painel atualiza os dados a cada 15 segundos; isso é independente do intervalo configurado para as requisições ao site.

Em **Detalhes**, consulte o gráfico de latência, disponibilidade por período, últimas verificações e incidentes. Disponibilidade é a proporção de verificações bem-sucedidas entre as realizadas no período, sem considerar horários sem coleta como disponibilidade comprovada. O gráfico mostra até as últimas 1.000 verificações da janela escolhida, e a tabela mostra as últimas 20. A retenção dos registros segue o plano.

O incidente abre após o número configurado de falhas consecutivas e fecha quando uma coleta retorna o status esperado. Falhas repetidas não geram novos incidentes enquanto o anterior estiver aberto. Eventos `url.alert.opened` e `url.alert.resolved` entram na fila do webhook de alertas existente; a entrega externa depende de `ALERT_WEBHOOK_URL` configurado. Os incidentes também ficam disponíveis nos detalhes do monitor.

Pausar interrompe as verificações e mantém o histórico. Mudar endereço, método ou status esperado inicia uma série de histórico correspondente à nova configuração, preservando os registros anteriores no banco. Arquivar interrompe o monitor e libera a franquia. Reduzir a franquia do plano não apaga monitores existentes; novos cadastros respeitam o limite. Uma mudança de plano na cobrança é recusada se o novo plano não comportar o uso atual de URLs.

## Acessos e endereços

Proprietários, administradores e operadores podem gerenciar monitores nos clientes autorizados. Leitores podem consultar. Monitores, resultados e incidentes permanecem isolados por workspace e por cliente.

Esta versão aceita domínios e IPs públicos HTTP/HTTPS com portas de 1 a 65535, incluindo portas personalizadas como 8080, 8096 e 8443. Endereços privados, loopback, link-local, protocolos diferentes e URLs com usuário/senha são recusados. O serviço verifica os endereços resolvidos por DNS e fixa o endereço na conexão. Cada redirecionamento é validado novamente. Certificados HTTPS são validados e o corpo da resposta não é armazenado.

Sites acessíveis somente pela rede interna não devem ser cadastrados nesse coletor público. O endereço público de um túnel, quando disponível, pode ser usado normalmente.

A validação usa respostas simuladas, incluindo falhas, recuperação, concorrência entre verificações, escopo de clientes e tentativas de acesso a destinos privados. Referências técnicas: [HTTP do Node.js](https://nodejs.org/api/http.html) e [DNS do Node.js](https://nodejs.org/api/dns.html).
