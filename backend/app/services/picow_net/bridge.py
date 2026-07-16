"""
PicowNetBridge — top-level orchestrator that ties every subsystem
together and exposes the same shape ``picow_net_bridge.py`` did before.

One bridge instance per simulated chip. The chip emits Ethernet frames
through the WebSocket; each frame goes through ``deliver_packet_out``
which demuxes by ethertype, then by IP protocol or UDP port.

Inbound (host → chip) traffic gets queued via ``inject`` and the WS
worker drains it through the ``picow_packet_in`` event channel.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from .arp import ArpResponder
from .consts import (
    ETHERTYPE_ARP,
    ETHERTYPE_IPV4,
    GATEWAY_IP,
    IPPROTO_ICMP,
    IPPROTO_TCP,
    IPPROTO_UDP,
    STA_IP,
    STA_MAC,
    ip_to_bytes,
)
from .dhcp import (
    DhcpServer,
    is_dhcp_traffic,
    make_dhcp_frame,
)
from .dns import DnsResolver, is_dns_traffic, make_dns_frame
from .icmp import IcmpResponder
from .protocols import Ethernet, IPv4, TCP, UDP
from .tcp_nat import TcpNat
from .udp_nat import UdpNat

logger = logging.getLogger(__name__)

EmitFn = Callable[[str, dict], Awaitable[None]]


class PicowNetBridge:
    """Stack of L2..L7 network helpers for one Pico W simulation."""

    def __init__(self, client_id: str, emit: EmitFn, wifi_enabled: bool) -> None:
        self.client_id = client_id
        self._emit = emit
        self.wifi_enabled = wifi_enabled
        self.running = True
        self._chip_mac = STA_MAC

        self._arp = ArpResponder()
        self._dhcp = DhcpServer()
        self._dns = DnsResolver()
        self._icmp = IcmpResponder()
        self._tcp = TcpNat(self._inject)
        self._udp = UdpNat(self._inject)

    # ── lifecycle ──────────────────────────────────────────────────

    async def start(self) -> None:
        await self._emit('wifi_status', {
            'status': 'started',
            'ssid': 'Velxio-GUEST' if self.wifi_enabled else None,
            'ip': STA_IP if self.wifi_enabled else None,
        })

    async def stop(self) -> None:
        self.running = False
        await asyncio.gather(
            self._tcp.shutdown(),
            self._udp.shutdown(),
            return_exceptions=True,
        )

    # ── chip → host ────────────────────────────────────────────────

    async def deliver_packet_out(self, ether_bytes: bytes) -> None:
        if not self.running or not self.wifi_enabled:
            return
        try:
            frame = Ethernet.parse(ether_bytes)
        except ValueError:
            return

        # Track the chip's MAC. The first frame we see (often a DHCP
        # DISCOVER while ciaddr is 0.0.0.0) tells us what to use.
        if frame.src and any(b for b in frame.src):
            self._chip_mac = bytes(frame.src)

        if frame.ethertype == ETHERTYPE_ARP:
            reply = self._arp.handle(frame)
            if reply is not None:
                await self._inject(reply)
            return

        if frame.ethertype != ETHERTYPE_IPV4:
            return  # IPv6 dropped silently

        try:
            ip = IPv4.parse(frame.payload)
        except ValueError:
            return

        if ip.protocol == IPPROTO_ICMP:
            reply = self._icmp.handle(self._chip_mac, ip)
            if reply is not None:
                await self._inject(reply)
            return

        if ip.protocol == IPPROTO_UDP:
            try:
                udp = UDP.parse(ip.payload)
            except ValueError:
                return
            await self._handle_udp(self._chip_mac, ip, udp)
            return

        if ip.protocol == IPPROTO_TCP:
            try:
                tcp = TCP.parse(ip.payload)
            except ValueError:
                return
            await self._tcp.handle_chip_segment(self._chip_mac, ip, tcp)
            return

        # Unknown L4 — drop.

    async def _handle_udp(self, chip_mac: bytes, ip: IPv4, udp: UDP) -> None:
        # Special case: DHCP. We pretend to be the gateway/server.
        if is_dhcp_traffic(udp):
            result = self._dhcp.handle(chip_mac, udp)
            if result is None:
                return
            dst_ip, src_ip, out_udp = result
            frame = make_dhcp_frame(chip_mac, src_ip, dst_ip, out_udp)
            await self._inject(frame)
            return
        # Special case: DNS to our synthetic resolver.
        if is_dns_traffic(udp) and bytes(ip.dst) == ip_to_bytes(GATEWAY_IP):
            result = await self._dns.handle(bytes(ip.src), udp)
            if result is None:
                return
            chip_dst_ip, host_src_ip, out_udp = result
            await self._inject(make_dns_frame(chip_mac, host_src_ip, chip_dst_ip, out_udp))
            return
        # Anything else — generic UDP NAT.
        await self._udp.handle_chip_datagram(chip_mac, ip, udp)

    # ── host → chip ────────────────────────────────────────────────

    async def _inject(self, frame: bytes) -> None:
        """Queue an Ethernet frame for the chip via the WS bridge."""
        if not self.running:
            return
        import base64
        await self._emit('picow_packet_in', {
            'ether_b64': base64.b64encode(frame).decode('ascii'),
        })


__all__ = ['PicowNetBridge']
