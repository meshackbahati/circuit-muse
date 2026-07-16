"""
ICMP echo (ping) responder — synthesises an Echo Reply for any Echo
Request the chip sends. The reply mirrors the ID + sequence + payload
exactly per RFC 792, so MicroPython's `usocket.ping`-style helpers see
the round-trip they expect.

Other ICMP types are dropped silently.
"""

from __future__ import annotations

from .consts import GATEWAY_MAC, ICMP_ECHO_REPLY, ICMP_ECHO_REQUEST, IPPROTO_ICMP
from .protocols import ICMP, IPv4, make_frame_ipv4


class IcmpResponder:
    """Echo replies for `ping`. Stateless."""

    def handle(self, chip_mac: bytes, ip: IPv4) -> bytes | None:
        try:
            icmp = ICMP.parse(ip.payload)
        except ValueError:
            return None
        if icmp.type != ICMP_ECHO_REQUEST:
            return None

        reply = ICMP(
            type=ICMP_ECHO_REPLY,
            code=0,
            rest=icmp.rest,
            payload=icmp.payload,
        )
        return make_frame_ipv4(
            dst_mac=chip_mac,
            src_mac=GATEWAY_MAC,
            src_ip=ip.dst,                     # we are pretending to be the dst
            dst_ip=ip.src,
            protocol=IPPROTO_ICMP,
            l4_payload=reply.to_bytes(),
        )
