# Instalação da plataforma no Linux

Este instalador instala o painel, a API, o banco SQLite e os workers. O agente de monitoramento é instalado separadamente nos servidores, pelo comando apresentado no painel.

## Compatibilidade

O instalador identifica Debian/Ubuntu (apt), RHEL/Rocky/AlmaLinux/Fedora (dnf) e openSUSE (zypper). Requer systemd em execução, kernel 4.18+, glibc 2.28+, arquitetura x86_64 ou ARM64, acesso à internet, root/sudo e util-linux/flock. Não suporta Alpine/musl, sistemas 32 bits ou distribuições antigas sem esses requisitos.

Alvos recomendados para homologação: Ubuntu 22.04/24.04, Debian 12/13 e Rocky/AlmaLinux 9/10. A detecção e os testes locais do instalador não substituem um teste real em cada distribuição. Reserve pelo menos 2 GB de RAM e espaço para dependências, builds e backups; o consumo de dados aumenta com o uso.

O Node 24.22.2 é instalado de forma isolada em `/opt/foxops/runtime`, sem substituir o Node do sistema. O arquivo vem do domínio oficial nodejs.org e seu SHA-256 é conferido com o manifesto oficial. O aplicativo roda como usuário `foxops`, sem privilégios de root.

## Instalar diretamente pelo GitHub

O repositório é privado. Autentique sua conta do GitHub com acesso ao projeto; não coloque tokens na URL nem nos comandos salvos.

Instale o Git, se necessário (`sudo apt install git` no Debian/Ubuntu ou `sudo dnf install git` no Rocky/AlmaLinux/Fedora). Depois:

```bash
git clone https://github.com/lucas-TagDev/sparkeops.git
cd sparkeops
bash deploy/install.sh --check
```

Para teste na rede local, substitua o IP pelo endereço do Linux que hospedará o painel e informe seu e-mail:

```bash
sudo bash deploy/install.sh --local \
  --public-url http://IP_DO_LINUX:8080 \
  --admin-email seu@email.com
```

Para produção com domínio HTTPS:

```bash
sudo bash deploy/install.sh \
  --public-url https://monitor.suaempresa.com \
  --admin-email seu@email.com
```

Em produção, o instalador configura o proxy HTTPS e emite o certificado automaticamente. **Antes de continuar, o domínio deve apontar para o servidor e as portas TCP 80 e 443 devem estar abertas no firewall, provedor e NAT.** O instalador exige essa confirmação e mantém a renovação automática do certificado. Cadastre a primeira conta no painel com o e-mail informado para administrar a plataforma.

Para atualizar a instalação existente, dentro do clone:

```bash
git pull --ff-only
sudo bash deploy/install.sh
```

O instalador preserva as configurações existentes e faz backup dos dados antes da troca de versão. Não repita as opções da primeira instalação na atualização.

## Gerar e transferir o pacote

Na máquina do projeto:

```powershell
npm run package:linux
scp releases/sparkeops-platform-0.1.0.tar.gz releases/sparkeops-platform-0.1.0.tar.gz.sha256 root@IP_DO_LINUX:/tmp/
```

O pacote exporta somente arquivos da aplicação. Não inclui `.env`, banco de clientes, chaves, node_modules nem backups da instalação atual. Uma instalação em outra máquina começa vazia; transferir os dados exige uma migração separada.

No Linux:

```bash
cd /tmp
sha256sum -c sparkeops-platform-0.1.0.tar.gz.sha256
tar -xzf sparkeops-platform-0.1.0.tar.gz
cd sparkeops-platform-0.1.0
bash deploy/install.sh --check
```

## Teste na rede local

Substitua o IP pelo endereço do Linux que hospedará a plataforma:

```bash
sudo bash deploy/install.sh --local \
  --public-url http://192.168.3.180:8080 \
  --admin-email administrador@suaempresa.com
```

Abra a URL e cadastre a conta com o mesmo e-mail informado para receber acesso à Administração da plataforma. Não existe senha padrão. Este modo usa HTTP e é destinado a testes em rede confiável; use HTTPS para a implantação pública. Se houver firewall, libere explicitamente a porta configurada para os clientes desejados. O instalador não altera regras de firewall.

## Produção com domínio HTTPS

```bash
sudo bash deploy/install.sh \
  --public-url https://monitor.suaempresa.com \
  --admin-email administrador@suaempresa.com
```

Nesse modo o instalador executa toda a configuração do HTTPS:

1. Exibe o aviso obrigatório e pede `SIM` confirmando DNS e portas abertas.
2. Verifica se o domínio resolve e se as portas locais 80/443 estão disponíveis para o proxy da plataforma.
3. Baixa o Caddy de uma release oficial e confere o checksum publicado (SHA-256 ou SHA-512, conforme o manifesto).
4. Cria o proxy dedicado `sparkeops-https`, apontando para a aplicação em `127.0.0.1:8080`, com suporte ao terminal WebSocket.
5. Solicita o certificado público ao Let's Encrypt, configura redirecionamento HTTP → HTTPS e mantém renovação automática.
6. Aguarda até 180 segundos e valida uma resposta HTTPS com certificado confiável antes de declarar sucesso.

**Pré-requisitos obrigatórios:** registros DNS A e, quando existir, AAAA apontando corretamente para o servidor; portas TCP 80 e 443 liberadas no firewall do Linux, no provedor e no roteador/NAT. Também é necessário acesso de saída à internet. O instalador não tem como modificar DNS, firewall do provedor ou roteador por você. Um registro IPv6 incorreto também pode impedir a emissão.

Em execução não interativa, confirme explicitamente os requisitos:

```bash
sudo bash deploy/install.sh \
  --public-url https://monitor.suaempresa.com \
  --admin-email administrador@suaempresa.com \
  --confirm-dns-ports
```

O aviso continua sendo exibido; a opção registra a confirmação sem pedir uma resposta no terminal. As atualizações em produção também exibem o aviso e pedem a confirmação.

Se as portas estiverem ocupadas por Nginx, Apache ou outro proxy, o instalador para com uma explicação, sem substituir configurações ou parar esses serviços. Use um servidor dedicado ou libere as portas antes de tentar novamente. O domínio precisa ser público; não use IP, localhost ou um domínio interno para certificados públicos.

O proxy usa `/etc/foxops/https.Caddyfile`, binário em `/opt/foxops/proxy/caddy` e dados persistentes em `/var/lib/sparkeops-https`. Ele não altera `/etc/caddy/Caddyfile`. O HTTPS local é verificado pelo instalador, mas a confirmação da acessibilidade externa depende das regras de rede informadas pelo operador.

Se a emissão falhar, a instalação não é marcada como concluída. Consulte `sudo journalctl -u sparkeops-https` e corrija DNS/portas antes de repetir. Em uma atualização, o instalador tenta restaurar as configurações anteriores do proxy e da aplicação. O modo `--local` permanece HTTP e não instala o proxy.

## Administração e operação

```bash
sudo systemctl status foxops
sudo systemctl restart foxops
sudo journalctl -u foxops -f
```

- Programa e versões: `/opt/foxops/releases`; versão ativa: `/opt/foxops/current`.
- Banco e chave mestre: `/var/lib/foxops` (incluindo `.secrets/ai-master.key`).
- Configuração: `/etc/foxops/foxops.env`, acessível somente por root.
- Backups anteriores a atualizações: `/var/backups/foxops`.

SMTP, Stripe, Mercado Pago, identidade visual e planos são configurados pela Administração da plataforma. Chaves de IA e notificações da organização são configuradas pelo proprietário do workspace.

## Atualizar sem reinstalar os dados

Gere e transfira um novo pacote; extraia em uma pasta separada e execute:

```bash
sudo bash deploy/install.sh
```

A configuração existente é preservada. A nova versão é compilada antes de parar o serviço. Depois o instalador para a aplicação, cria um backup com banco, arquivo mestre e configuração, troca a versão ativa e verifica `/health`. Haverá uma breve interrupção, inclusive dos terminais SSH.

Se a ativação falhar, o instalador tenta voltar ao código e ao serviço anteriores. Ele **não desfaz migrações do banco automaticamente**; se a versão anterior não iniciar, restaure o backup completo de forma controlada com o serviço parado. Não apague a chave mestre: o banco sozinho não permite recuperar as credenciais criptografadas.

Backups de atualização não substituem uma rotina periódica de backup externo. O instalador preserva releases e backups antigos; acompanhe o espaço em disco e remova versões antigas somente após validar a atualização.

Referências de runtime: [downloads oficiais do Node.js](https://nodejs.org/en/download) e [requisitos de plataforma do Node.js](https://github.com/nodejs/node/blob/v24.x/BUILDING.md).

HTTPS automático: [documentação do Caddy](https://caddyserver.com/docs/automatic-https).
