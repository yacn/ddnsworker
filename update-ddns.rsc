:local ddnsUpdateEndpoint "https://ddns.yacn.me/update"
:local zoneId "351f734a5aed65f0b80560e62acfd56f"
:local mySecretToken ""
:local ddnsDomain "rwc.yacn.me"

:local currentDDNSIP [:resolve $ddnsDomain];
:local currentIP [:resolve domain-name="myip.opendns.com" server="resolver1.opendns.com"];

:if ($currentDDNSIP != $currentIP) do={
    /log info "wan ip changed from $currentDDNSIP to $currentIP"
    /tool fetch http-method=post \
        http-header-field="Content-Type: application/json" \
        http-header-field="My-Secret-Token: $mySecretToken" \
        http-data="{\"zone_id\":\"$zoneId\",\"record\":\"$ddnsDomain\"}" \
        url="$ddnsUpdateEndpoint"
}
