#!/usr/bin/env bash

DEVFLOW_NGINX_CONFIG_DEFAULT=/etc/nginx/conf.d/devflow.conf
DEVFLOW_NGINX_MARKER_DEFAULT='# Managed by DevFlow installer. Do not merge with another application.'

proxy_persistent_backup() {
  local source="$1" backup_root="$2" operation="$3" backup_path
  [[ -f "$source" && -n "$backup_root" ]] || return 0
  install -d -m 0750 "$backup_root"
  backup_path="$(mktemp "$backup_root/devflow.conf.$(date -u +%Y%m%dT%H%M%SZ).$operation.XXXXXX")"
  install -m 0640 "$source" "$backup_path"
}

proxy_restore_transaction() {
  local target="$1" transaction_backup="$2" had_previous="$3"
  if [[ "$had_previous" == true ]]; then
    mv -f -- "$transaction_backup" "$target"
  else
    rm -f -- "$target" "$transaction_backup"
  fi
  nginx -t >/dev/null 2>&1 || return 1
  systemctl reload nginx >/dev/null 2>&1 || return 1
}

promote_host_nginx_config() {
  local candidate="$1"
  local target="${2:-$DEVFLOW_NGINX_CONFIG_DEFAULT}"
  local marker="${3:-$DEVFLOW_NGINX_MARKER_DEFAULT}"
  local backup_root="${4:-}"
  local parent staged transaction_backup had_previous=false

  [[ -f "$candidate" ]] || { log ERROR "Configuração candidata ausente: $candidate"; return 1; }
  [[ "$(head -n1 "$candidate" 2>/dev/null || true)" == "$marker" ]] \
    || { log ERROR 'A configuração candidata não possui o marcador DevFlow.'; return 1; }
  parent="$(dirname "$target")"
  [[ -d "$parent" ]] || { log ERROR "Diretório persistente do Nginx ausente: $parent"; return 1; }

  transaction_backup="$(mktemp "$parent/.devflow-transaction.XXXXXX")"
  if [[ -e "$target" ]]; then
    [[ "$(head -n1 "$target" 2>/dev/null || true)" == "$marker" ]] \
      || { rm -f -- "$transaction_backup"; log ERROR "$target pertence a outro sistema."; return 1; }
    cp -a -- "$target" "$transaction_backup"
    had_previous=true
    proxy_persistent_backup "$target" "$backup_root" before-promote
  fi

  staged="$(mktemp "$parent/.devflow-candidate.XXXXXX")"
  install -m 0644 "$candidate" "$staged"
  mv -f -- "$staged" "$target"

  if ! nginx -t >/dev/null 2>&1; then
    if ! proxy_restore_transaction "$target" "$transaction_backup" "$had_previous"; then
      rm -f -- "$candidate"
      log ERROR 'A candidata foi rejeitada e a restauração automática do Nginx falhou; intervenção manual é obrigatória.'
      return 1
    fi
    rm -f -- "$candidate"
    log ERROR 'A configuração Nginx candidata foi rejeitada; a configuração anterior foi restaurada.'
    return 1
  fi
  if ! systemctl reload nginx >/dev/null 2>&1; then
    if ! proxy_restore_transaction "$target" "$transaction_backup" "$had_previous"; then
      rm -f -- "$candidate"
      log ERROR 'O reload falhou e a restauração automática do Nginx também falhou; intervenção manual é obrigatória.'
      return 1
    fi
    rm -f -- "$candidate"
    log ERROR 'O reload do Nginx falhou; a configuração anterior foi restaurada e recarregada.'
    return 1
  fi

  rm -f -- "$candidate" "$transaction_backup"
}

remove_host_nginx_config() {
  local target="${1:-$DEVFLOW_NGINX_CONFIG_DEFAULT}"
  local marker="${2:-$DEVFLOW_NGINX_MARKER_DEFAULT}"
  local backup_root="${3:-}"
  local parent transaction_backup

  [[ -e "$target" ]] || return 0
  [[ "$(head -n1 "$target" 2>/dev/null || true)" == "$marker" ]] \
    || { log ERROR "$target não é uma rota gerenciada pelo DevFlow."; return 1; }
  parent="$(dirname "$target")"
  transaction_backup="$(mktemp "$parent/.devflow-remove.XXXXXX")"
  cp -a -- "$target" "$transaction_backup"
  proxy_persistent_backup "$target" "$backup_root" before-remove
  rm -f -- "$target"

  if ! nginx -t >/dev/null 2>&1 || ! systemctl reload nginx >/dev/null 2>&1; then
    mv -f -- "$transaction_backup" "$target"
    nginx -t >/dev/null 2>&1 || true
    systemctl reload nginx >/dev/null 2>&1 || true
    log ERROR 'A remoção da rota DevFlow falhou; o arquivo exclusivo foi restaurado.'
    return 1
  fi
  rm -f -- "$transaction_backup"
}
