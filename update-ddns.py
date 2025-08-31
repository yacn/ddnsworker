#!/usr/bin/env python3

"""
Script without external dependencies to update a DDNS record


TODO:
- rename MY_SECRET_TOKEN to DDNS_UPDATE_AUTH_TOKEN
"""

import http.client
import json
import logging
import os

from urllib.parse import urlencode, urlparse

MYIP_ENDPOINT = 'https://ddns.yacn.me'
DDNS_UPDATE_ENDPOINT = 'https://ddns.yacn.me/update'
CLOUDFLARE_DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query'
ZONE_ID = '351f734a5aed65f0b80560e62acfd56f'
DDNS_DOMAIN = 'rwc.yacn.me'
MY_SECRET_TOKEN = os.environ.get('DDNS_UPDATE_AUTH_TOKEN')

LOG = logging.getLogger(__name__)

def get(uri: str, headers: dict = {}, params: dict = {}) -> http.client.HTTPResponse:
    parsed_uri = urlparse(uri)
    conn = http.client.HTTPSConnection(parsed_uri.netloc)
    path = parsed_uri.path
    if params:
        encoded_params = urlencode(params)
        path = f"{path}?{encoded_params}"

    conn.request("GET", path, headers=headers)
    response = conn.getresponse()
    return response

def post_json(uri: str, headers: dict = {}, json: dict = {}) -> http.client.HTTPResponse:
    parsed_uri = urlparse(uri)
    conn = http.client.HTTPSConnection(parsed_uri.netloc)
    conn.request("POST", parsed_uri.path, headers={**headers, 'Content-Type': 'application/json'}, body=json.dumps(json))
    response = conn.getresponse()
    return response

def dns_over_https_query(doh_endpoint: str, name: str, type_: str) -> str:
    params = {'name': name, 'type': type_}
    resp = get(doh_endpoint, params=params, headers={'Accept': 'application/dns-json'})
    data = resp.read()
    if resp.status != 200:
        raise Exception(f"dns over https query failed: {data}")
    body = json.loads(data.decode('utf-8'))
    return body.get('Answer', [{}])[0].get('data', '')

def get_my_ip() -> str:
    resp = get(MYIP_ENDPOINT)
    return resp.read().decode('utf-8').rstrip()

def main():
    if not MY_SECRET_TOKEN:
        raise Exception("DDNS_UPDATE_AUTH_TOKEN is not set")

    current_ddns_ip = dns_over_https_query(CLOUDFLARE_DOH_ENDPOINT, DDNS_DOMAIN, 'A')
    my_ip = get_my_ip()
    if current_ddns_ip != my_ip:
        LOG.info(f"WAN IP changed from {current_ddns_ip} to {my_ip}")
        resp = post_json(
            DDNS_UPDATE_ENDPOINT,
            headers={'My-Secret-Token': MY_SECRET_TOKEN},
            json={'zone_id': ZONE_ID, 'record': DDNS_DOMAIN},
        )
        print(resp.read().decode('utf-8'))

if __name__ == '__main__':
    main()
