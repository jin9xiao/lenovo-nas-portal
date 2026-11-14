#!/usr/bin/env python3
"""Generate deployment settings on a workstation. No credentials are needed."""
import argparse
import ipaddress
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--nas-ip', type=ipaddress.IPv4Address, required=True)
parser.add_argument('--lan', type=ipaddress.IPv4Network, required=True)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
if (args.nas_ip not in args.lan or args.nas_ip.is_loopback or
        args.nas_ip.is_multicast or args.nas_ip.is_unspecified or
        args.lan.prefixlen < 16):
    parser.error('Use a NAS IPv4 address in a trusted LAN subnet (/16 or narrower).')
args.out.mkdir(parents=True, exist_ok=True)
template = Path(__file__).with_name('nginx.conf.template').read_text()
rendered = template.replace('@NAS_IP@', str(args.nas_ip)).replace('@LAN_CIDR@', str(args.lan))
(args.out / 'nginx.conf').write_text(rendered)
(args.out / 'settings.json').write_text(json.dumps({'origin': 'https://%s:9443' % args.nas_ip}) + '\n')
