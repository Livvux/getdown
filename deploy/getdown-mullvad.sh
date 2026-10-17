#!/bin/bash
set -euo pipefail

# This service owns only these priorities,  getdown's source net.
SUBNET=192.168.240.0/28
STATE=/var/lib/getdown-mullvad/exit-id
CONFIG=/etc/getdown-mullvad.conf

ensure_rule() {
  local family=$1 priority=$2
  shift 2
  if ! ip "$family" rule show priority "$priority" | grep -q .; then
    ip "$family" rule add priority "$priority" "$@"
  fi
}

remove_rules() {
  local family priority
  for family in -4 -6; do
    for priority in 5259 5260 5261 5262 5263 5264; do
      while ip "$family" rule show priority "$priority" | grep -q .; do
        ip "$family" rule del priority "$priority"
      done
    done
  done
}

stop_vpn() {
  if [[ -f "$STATE" ]]; then
    local current
    current=$(tailscale debug prefs | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ExitNodeID", ""))')
    if [[ "$(cat "$STATE")" == pending || "$current" == "$(cat "$STATE")" ]]; then
      tailscale set --exit-node= --exit-node-allow-lan-access=false
    fi
    rm -f "$STATE"
  fi
  remove_rules
  # Keep the forwarding guard: stopped/unavailable VPN must fail closed.
}

prepare_routes() {
    # Keep all other host/container traffic on its existing main route.
    # More-specific tailnet/subnet routes still come from Tailscale table 52.
    # Preserve bridge neighbor reachability before the exit-table fallback.
    ensure_rule -4 5259 from "$SUBNET" to "$SUBNET" lookup main
    ensure_rule -4 5260 from "$SUBNET" lookup 52
    ensure_rule -4 5261 from "$SUBNET" unreachable
    for family in -4 -6; do
      ensure_rule "$family" 5262 lookup 52 suppress_prefixlength 0
      ensure_rule "$family" 5263 lookup main
      ensure_rule "$family" 5264 unreachable
    done
}

case "${1:-}" in
  prepare)
    prepare_routes
    ;;
  start)
    # shellcheck source=/dev/null
    source "$CONFIG"
    : "${MULLVAD_EXIT_NODE:?Set a Mullvad Tailscale IP in $CONFIG}"
    [[ "$MULLVAD_EXIT_NODE" =~ ^100\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
    initial_exit=$(tailscale debug prefs | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ExitNodeID", ""))')
    if [[ -n "$initial_exit" && (! -f "$STATE" || "$(cat "$STATE")" != "$initial_exit") ]]; then
      echo 'An exit node is already selected; refusing to replace another configuration.' >&2
      exit 1
    fi
    trap 'stop_vpn' ERR
    nft list table inet getdown_mullvad >/dev/null
    iptables -w -t nat -C POSTROUTING -s "$SUBNET" -o tailscale0 -j MASQUERADE 2>/dev/null || \
      iptables -w -t nat -A POSTROUTING -s "$SUBNET" -o tailscale0 -j MASQUERADE

    prepare_routes
    mkdir -p "$(dirname "$STATE")"
    if [[ -z "$initial_exit" ]]; then echo pending > "$STATE"; fi
    tailscale set --exit-node="$MULLVAD_EXIT_NODE" --exit-node-allow-lan-access=true
    tailscale debug prefs | python3 -c 'import json,sys;print(json.load(sys.stdin)["ExitNodeID"])' > "${STATE}.tmp"
    mv "${STATE}.tmp" "$STATE"
    # The host's ordinary internet route must not become tailscale0.
    if ip -4 route get 1.1.1.1 | grep -q 'dev tailscale0'; then
      echo 'Refusing to route ordinary host traffic through Mullvad.' >&2
      false
    fi
    ;;
  stop)
    stop_vpn
    ;;
  rollback)
    stop_vpn
    iptables -w -t nat -D POSTROUTING -s "$SUBNET" -o tailscale0 -j MASQUERADE 2>/dev/null || true
    ;;
  *)
    echo "Usage: $0 prepare|start|stop|rollback" >&2
    exit 2
    ;;
esac
