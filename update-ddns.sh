#!/usr/bin/env bash

# external requirements:
# - dig (dnsutils)
# - jq
# - curl

set -e

ddns_update_endpoint="https://ddns.yacn.me/update"
zone_id="351f734a5aed65f0b80560e62acfd56f"
ddns_domain="rwc.yacn.me"

ddns_update_auth_token="${DDNS_UPDATE_AUTH_TOKEN}"

if [[ "${ddns_update_auth_token}" == "" ]]; then
	echo "DDNS_UPDATE_AUTH_TOKEN is not set"
	exit 1
fi

current_ddns_ip="$(dig +short "$ddns_domain")"
current_ip="$(dig +short txt ch whoami.cloudflare @1.1.1.1 | tr -d '"')"
# or: dig +short myip.opendns.com @resolver1.opendns.com

if [[ "$current_ddns_ip" != "$current_ip" ]]; then
	json_body=$(export zone_id="$zone_id" ddns_domain="$ddns_domain"; jq -nrc '{zone_id: env.zone_id, record: env.ddns_domain}')
	echo "WAN IP has changed from $current_ddns_ip to $current_ip"
	curl -H "Content-Type: application/json" \
		-H "My-Secret-Token: $ddns_update_auth_token" \
		--data "$json_body" \
		"$ddns_update_endpoint"
fi
