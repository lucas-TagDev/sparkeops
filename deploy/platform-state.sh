#!/usr/bin/env bash
# Somente funções; pode ser carregado sem alterar o sistema.
platform_previous_release() {
  local current=$1 candidate
  [[ -e "$current" ]] || return 0
  candidate=$(readlink -f -- "$current" 2>/dev/null) || return 0
  [[ -d "$candidate" && -f "$candidate/src/server.ts" ]] || return 0
  printf '%s\n' "$candidate"
}

platform_unit_loaded() {
  local state
  state=$(systemctl show --property=LoadState --value "$1" 2>/dev/null) || return 1
  [[ "$state" == loaded ]]
}

platform_stop_if_loaded() {
  platform_unit_loaded "$1" || return 0
  systemctl stop "$1"
}
