"""
DNS proxy — when MicroPython resolves a hostname (e.g. for
``urequests.get('http://example.com')``), the lwIP stack sends a
recursive query to ``DNS_IP``. We forward the request to the host's
real resolver and wrap the answer back into a DNS response.

Only A-records are answered; anything else returns an empty
authoritative reply so the client retries.

The resolution is async via ``asyncio.get_running_loop().getaddrinfo``
so the network bridge thread doesn't block.
"""

from __future__ import annotations

import asyncio
import socket
import struct
from typing import Optional

from .consts import DNS_IP, GATEWAY_MAC, ip_to_bytes
from .protocols import (
    BROADCAST_MAC,
    DnsMessage,
    UDP,
    make_frame_ipv4,
)

# DNS flag bits
DNS_FLAG_QR = 0x8000      # 1 = response
DNS_FLAG_AA = 0x0400      # authoritative answer
DNS_FLAG_RA = 0x0080      # recursion available
DNS_FLAG_RD = 0x0100      # recursion desired
DNS_FLAG_RCODE_NOERROR = 0
DNS_FLAG_RCODE_SERVFAIL = 2
DNS_FLAG_RCODE_NXDOMAIN = 3

DNS_TYPE_A = 1
DNS_TYPE_AAAA = 28
DNS_CLASS_IN = 1


class DnsResolver:
    """
    Async DNS resolver.

    Returns (chip_dst_ip, host_src_ip, udp_response) tuples that the
    bridge wraps into Ethernet+IPv4 and injects to the chip.
    """

    def __init__(self) -> None:
        self._cache: dict[str, list[bytes]] = {}

    async def handle(
        self,
        chip_src_ip: bytes,
        udp: UDP,
    ) -> Optional[tuple[bytes, bytes, UDP]]:
        try:
            req = DnsMessage.parse(udp.payload)
        except ValueError:
            return None
        if not req.qd:
            return None
        qname, qtype, qclass = req.qd[0]

        # Build response skeleton (mirror txid + qd, RA flag).
        resp_flags = DNS_FLAG_QR | DNS_FLAG_RA | (req.flags & DNS_FLAG_RD)
        if qclass != DNS_CLASS_IN or qtype not in (DNS_TYPE_A, DNS_TYPE_AAAA):
            # Empty NOERROR reply.
            resp = DnsMessage(txid=req.txid, flags=resp_flags, qd=req.qd, an=[])
            return self._wrap(chip_src_ip, udp, resp)

        if qtype == DNS_TYPE_AAAA:
            # We don't proxy IPv6 — return NOERROR with no answers so the
            # client falls back to A-records.
            resp = DnsMessage(txid=req.txid, flags=resp_flags, qd=req.qd, an=[])
            return self._wrap(chip_src_ip, udp, resp)

        # A-record query. Resolve via host.
        addrs = await self._resolve_a(qname)
        if not addrs:
            resp = DnsMessage(
                txid=req.txid,
                flags=resp_flags | DNS_FLAG_RCODE_NXDOMAIN,
                qd=req.qd,
                an=[],
            )
            return self._wrap(chip_src_ip, udp, resp)

        an = []
        for ip4 in addrs:
            an.append((qname, DNS_TYPE_A, DNS_CLASS_IN, 60, ip4))
        resp = DnsMessage(txid=req.txid, flags=resp_flags, qd=req.qd, an=an)
        return self._wrap(chip_src_ip, udp, resp)

    async def _resolve_a(self, hostname: str) -> list[bytes]:
        if hostname in self._cache:
            return self._cache[hostname]
        loop = asyncio.get_running_loop()
        try:
            infos = await loop.getaddrinfo(
                hostname, None,
                family=socket.AF_INET,
                type=socket.SOCK_STREAM,
            )
        except (socket.gaierror, OSError):
            return []
        addrs: list[bytes] = []
        for info in infos:
            sockaddr = info[4]
            if isinstance(sockaddr, tuple) and len(sockaddr) >= 1:
                ip = sockaddr[0]
                try:
                    addrs.append(socket.inet_aton(ip))
                except OSError:
                    continue
        # de-dup preserving order
        seen: set = set()
        deduped: list[bytes] = []
        for a in addrs:
            if a not in seen:
                deduped.append(a)
                seen.add(a)
        self._cache[hostname] = deduped
        return deduped

    def _wrap(
        self,
        chip_src_ip: bytes,
        original_udp: UDP,
        resp: DnsMessage,
    ) -> tuple[bytes, bytes, UDP]:
        out_udp = UDP(
            src_port=53,
            dst_port=original_udp.src_port,
            payload=resp.to_bytes(),
        )
        return chip_src_ip, ip_to_bytes(DNS_IP), out_udp


def is_dns_traffic(udp: UDP) -> bool:
    return udp.dst_port == 53


def make_dns_frame(
    chip_mac: bytes,
    src_ip: bytes,
    dst_ip: bytes,
    udp: UDP,
) -> bytes:
    return make_frame_ipv4(
        dst_mac=chip_mac,
        src_mac=GATEWAY_MAC,
        src_ip=src_ip,
        dst_ip=dst_ip,
        protocol=17,
        l4_payload=udp.to_bytes(src_ip, dst_ip),
    )
