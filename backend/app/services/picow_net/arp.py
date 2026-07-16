"""
ARP responder — answers chip ARP requests for the synthetic gateway
and any IP the chip wants to talk to.

The cyw43 lwIP stack will do an ARP lookup for the destination MAC of
its first packet to a remote host. We don't run a real network — there's
no real MAC behind the gateway IP. So we synthesize the gateway MAC
(``GATEWAY_MAC``) for everything, exactly the way QEMU's slirp does.
"""

from __future__ import annotations

from .consts import ARP_REPLY, ARP_REQUEST, GATEWAY_MAC, STA_IP, ip_to_bytes
from .protocols import Arp, Ethernet, make_frame_arp


class ArpResponder:
    """Stateless. Decides whether to answer an ARP request, and how."""

    def handle(self, frame: Ethernet) -> bytes | None:
        try:
            arp = Arp.parse(frame.payload)
        except ValueError:
            return None

        if arp.opcode != ARP_REQUEST:
            # We don't track replies; they shouldn't happen anyway since
            # we never send ARP requests to the chip.
            return None

        # Only answer requests that come from our own STA.
        if bytes(arp.spa) != ip_to_bytes(STA_IP):
            return None

        target_ip = bytes(arp.tpa)
        # We answer for *any* IP — the only network the chip can reach
        # is via the gateway, so all IPs map to GATEWAY_MAC.
        reply = Arp(
            opcode=ARP_REPLY,
            sha=GATEWAY_MAC,
            spa=target_ip,
            tha=arp.sha,
            tpa=arp.spa,
        )
        return make_frame_arp(arp.sha, GATEWAY_MAC, reply)
