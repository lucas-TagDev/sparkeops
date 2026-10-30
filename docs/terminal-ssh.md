# Terminal SSH no painel

Em **Servidores → Serviços, logs e correções → Terminal SSH**, o proprietário pode habilitar o terminal para a conexão cadastrada. Proprietários e administradores podem conectar; operadores e leitores não podem. Alterar a conexão SSH exige habilitação novamente.

O terminal possui cores ANSI, teclado interativo, redimensionamento, expansão, limpeza de tela e desconexão. Comandos digitados executam diretamente com as permissões da conta SSH. Não passam por aprovação da IA. O conteúdo não é enviado à IA nem gravado na auditoria da plataforma; o servidor remoto pode manter seu próprio histórico de shell. A auditoria registra quem habilitou, abriu e encerrou sessões.

Para uma conta SSH convencional, configure as credenciais e fingerprint em **Conexão SSH**, habilite o terminal e conecte. O SSH remoto precisa permitir PTY e shell.

## Usuário dedicado foxops-ssh

O acesso gerenciado é restrito por padrão. Para permitir uma shell administrativa como root, habilite explicitamente no Ubuntu:

```sh
curl -fsS 'http://192.168.3.41:8080/agent/upgrade.sh' -o /tmp/foxops-upgrade.sh
sudo bash /tmp/foxops-upgrade.sh --enable-terminal
```

Em produção use a origem HTTPS da instalação. Depois, habilite também o terminal no painel. O upgrade permite PTY na chave gerenciada e cria um marcador root `/etc/foxops-terminal-enabled`. A shell só abre com PTY e esse marcador válido. As operações restritas existentes continuam funcionando.

`--disable-terminal` bloqueia novas shells gerenciadas no Ubuntu. **Desabilitar terminal** no painel encerra as sessões ativas desse servidor. A alteração local não mata sessões já abertas; encerre-as pelo painel também.

O formato `restrict,pty,command=...` segue a documentação OpenSSH: https://man.openbsd.org/sshd.8

## Sessões e publicação

Tickets de conexão duram 60 segundos, são de uso único e vinculados à sessão autenticada do navegador, usuário, organização, servidor e revisão SSH. As credenciais ficam no backend, no cofre existente. O fingerprint é verificado em cada conexão. Mudanças de acesso são revalidadas a cada 15 segundos. Cada usuário pode abrir duas sessões; o limite por servidor é três e por workspace oito.

Dez minutos sem digitação ou uma hora de duração encerram a sessão. Fechar ou trocar a aba do terminal desconecta. Reconexão é manual, sem reenvio de comandos. Limpar a tela só limpa o terminal visual. Processos remotos podem sobreviver a uma desconexão conforme seu comportamento e o da shell; desconectar não garante rollback ou cancelamento de um comando remoto.

O proxy de produção deve permitir WebSocket para `/api/v1/terminal/socket` e preservar `Host` e `Origin` da aplicação. A origem precisa coincidir com `PUBLIC_URL`. Use HTTPS/WSS em produção. A atualização não altera configurações do seu proxy automaticamente.

Validação local inclui SSH real com servidor simulado: teclado, saída, PTY, tamanho, fingerprint, revogação, origem e ticket. Não foi aberta uma shell na VM do usuário para testes.
