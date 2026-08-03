#!/usr/bin/env bash

PROVIDER_IMPLEMENTATION_NAME=legacy-docker-nginx
PROVIDER_MUTABLE_RESOURCES='/opt/devflow/config/proxy; rota DevFlow e override externos gerenciados pelo adaptador legado; somente fullpassword_nginx quando explicitamente autorizado'

provider_detect() { fullpassword_adapter_discover; }
provider_check() { fullpassword_adapter_preflight; }
provider_dry_run() { provider_check; }
provider_prepare() { validate_domain "$1"; provider_check; }
provider_install() { log WARN 'Provider legacy-docker-nginx esta descontinuado e exige selecao explicita.'; }
provider_activate() { install_fullpassword_proxy_adapter "$1" "$2" "$3"; }
provider_validate() { fullpassword_adapter_preflight; }
provider_health() { fullpassword_public_health; }
provider_update() { promote_fullpassword_proxy_config "$1" "${2:-fullpassword-shared.conf.template}" "$DEVFLOW_DOMAIN" healthy; }
provider_rollback() { provider_update "$@"; }
provider_uninstall() { uninstall_fullpassword_proxy_adapter; }
