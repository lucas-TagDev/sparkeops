#!/usr/bin/env bash
# Não executado pelo instalador. Remoção explícita da plataforma SparkeOPS.
set -Eeuo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
PURGE=0 YES=0 DRY_RUN=0
BASE=/opt/foxops
DATA=/var/lib/foxops
CONFIG=/etc/foxops
HTTPS_DATA=/var/lib/sparkeops-https
fail() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --purge-data) PURGE=1; shift;;
    --yes) YES=1; shift;;
    --dry-run) DRY_RUN=1; shift;;
    --help|-h)
      cat <<'HELP'
Desinstalar a plataforma SparkeOPS:
  sudo bash deploy/uninstall.sh
Simular sem alterar nada:
  sudo bash deploy/uninstall.sh --dry-run
Remover também dados, chaves e certificados (exige digitar APAGAR DADOS):
  sudo bash deploy/uninstall.sh --purge-data

Por padrão preserva /var/lib/foxops, /etc/foxops e /var/lib/sparkeops-https.
Backups em /var/backups/foxops são preservados em todos os modos.
--yes confirma somente a remoção do programa; não dispensa a confirmação dos dados.
Não remove agentes das máquinas monitoradas ou outros proxies do servidor.
HELP
      exit 0;;
    *) fail "Opção desconhecida: $1";;
  esac
done
[[ $(uname -s) == Linux ]] || fail 'Execute este desinstalador no servidor Linux.'
((DRY_RUN || EUID == 0)) || fail 'Execute com sudo ou como root.'
command -v systemctl >/dev/null || fail 'systemd é necessário.'
# Rejeite caminhos redirecionados, antes de parar serviços ou remover qualquer arquivo.
for path in /opt "$BASE" /var/lib "$DATA" /etc "$CONFIG" "$HTTPS_DATA" /var/cache/foxops /etc/systemd/system/foxops.service /etc/systemd/system/sparkeops-https.service /etc/foxops/https.Caddyfile; do
  [[ ! -L "$path" ]] || fail "Remoção recusada: caminho é um link simbólico: $path"
done
if [[ -e "$BASE" ]]; then
  [[ $(readlink -f -- "$BASE") == /opt/foxops && -d "$BASE/releases" && -d "$BASE/runtime" ]] || fail 'Diretório da aplicação não corresponde a uma instalação reconhecida.'
fi
if [[ -f /etc/systemd/system/foxops.service ]]; then
  grep -qx 'WorkingDirectory=/opt/foxops/current' /etc/systemd/system/foxops.service && grep -qx 'User=foxops' /etc/systemd/system/foxops.service || fail 'foxops.service não corresponde ao serviço da plataforma.'
fi
if [[ -f /etc/systemd/system/sparkeops-https.service ]]; then
  grep -qx '# Managed by SparkeOPS installer' /etc/systemd/system/sparkeops-https.service || fail 'Proxy HTTPS não pertence ao instalador.'
fi
if [[ -f "$CONFIG/https.Caddyfile" ]]; then
  grep -qx '# Managed by SparkeOPS installer' "$CONFIG/https.Caddyfile" || fail 'Configuração HTTPS não pertence ao instalador.'
fi
printf 'Serão parados e removidos os serviços da plataforma e do proxy HTTPS.\n'
printf 'Serão removidos o programa em /opt/foxops e o cache de instalação.\n'
if ((PURGE)); then
  printf 'ATENÇÃO: banco, clientes, credenciais, chave mestre, configurações e certificados também serão apagados.\n'
else
  printf 'Banco, credenciais, configurações e certificados serão preservados para reinstalação.\n'
fi
printf 'Os backups existentes em /var/backups/foxops serão mantidos.\n'
((DRY_RUN == 0)) || { printf 'Simulação concluída. Nenhuma alteração realizada.\n'; exit 0; }
if ((PURGE)); then
  [[ -t 0 ]] || fail 'Remoção de dados exige confirmação em um terminal interativo.'
  read -r -p 'Para apagar os dados, digite exatamente APAGAR DADOS: ' answer
  [[ "$answer" == 'APAGAR DADOS' ]] || fail 'Remoção cancelada.'
elif ((YES == 0)); then
  [[ -t 0 ]] || fail 'Use --yes para confirmar a remoção do programa sem apagar os dados.'
  read -r -p 'Remover o programa preservando os dados? Digite REMOVER: ' answer
  [[ "$answer" == REMOVER ]] || fail 'Remoção cancelada.'
fi
exec 9>/run/foxops-install.lock
flock -n 9 || fail 'Outra instalação ou remoção está em execução.'
for unit in sparkeops-https.service foxops.service; do
  if [[ -f "/etc/systemd/system/$unit" ]]; then
    systemctl stop "$unit"
    systemctl disable "$unit"
    rm -f -- "/etc/systemd/system/$unit"
  fi
done
systemctl daemon-reload
# Alvos fixos verificados acima; não há expansão de caminhos informados pelo usuário.
rm -rf -- /opt/foxops /var/cache/foxops
if ((PURGE)); then
  rm -rf -- /var/lib/foxops /etc/foxops /var/lib/sparkeops-https
fi
# Usuários de serviço são preservados para manter a propriedade dos dados e permitir reinstalação.
printf 'SparkeOPS desinstalado. Nenhum agente remoto ou proxy de terceiros foi removido.\n'
if ((PURGE == 0)); then printf 'Dados preservados em /var/lib/foxops; configurações em /etc/foxops.\n'; fi
