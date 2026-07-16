"""
picow_net_bridge — Pico W (CYW43439) network bridge (FACADE).

This module is now a thin facade over ``app.services.picow_net``,
which contains the real userspace network stack:

    picow_net/
    ├── bridge.py         PicowNetBridge orchestrator
    ├── protocols.py      Ethernet/IPv4/TCP/UDP/ICMP/ARP/DHCP/DNS codecs
    ├── checksums.py      RFC 1071 + TCP/UDP pseudo-header
    ├── arp.py            ARP responder
    ├── dhcp.py           DHCP server
    ├── dns.py            DNS proxy
    ├── icmp.py           ICMP echo
    ├── tcp_nat.py        Full RFC 793 TCP state machine
    ├── udp_nat.py        UDP NAT with idle reaper
    └── consts.py         Network parameters

The frontend's chip-side gSPI emulator
(``frontend/src/simulation/cyw43/``) is unchanged. The wire-format
contract between the two halves is documented in
``docs/PICO_W_WIFI_EMULATION.md``.

Reference upstream IoT projects we test against:
  github.com/KritishMohapatra/100_Days_100_IoT_Projects
"""

from __future__ import annotations

import logging
import os
from typing import Awaitable, Callable, Dict

from app.services.picow_net import PicowNetBridge

logger = logging.getLogger(__name__)

# Network reach is gated on this single env-var so it can be disabled
# in CI / sandboxed environments. When False, every outbound IP packet
# is silently dropped at deliver_packet_out().
_NET_ENABLED = os.environ.get('VELXIO_PICOW_NET', 'true').lower() not in (
    '0', 'false', 'no',
)


class PicowNetManager:
    """Singleton-like manager mirroring esp_qemu_manager API surface."""

    def __init__(self) -> None:
        self._instances: Dict[str, PicowNetBridge] = {}

    # ── Lifecycle ──────────────────────────────────────────────────

    async def start_instance(
        self,
        client_id: str,
        callback: Callable[[str, dict], Awaitable[None]],
        wifi_enabled: bool,
    ) -> None:
        if client_id in self._instances:
            return
        bridge = PicowNetBridge(client_id, callback, wifi_enabled)
        self._instances[client_id] = bridge
        logger.info('[picow:%s] start wifi_enabled=%s', client_id, wifi_enabled)
        await bridge.start()

    async def stop_instance(self, client_id: str) -> None:
        bridge = self._instances.pop(client_id, None)
        if bridge is None:
            return
        await bridge.stop()
        logger.info('[picow:%s] stop', client_id)

    def has_instance(self, client_id: str) -> bool:
        return client_id in self._instances

    # ── Outbound traffic — chip → host ─────────────────────────────

    async def deliver_packet_out(self, client_id: str, ether_b64: str) -> None:
        bridge = self._instances.get(client_id)
        if bridge is None:
            return
        if not _NET_ENABLED:
            return
        import base64
        try:
            ether = base64.b64decode(ether_b64)
        except Exception:
            logger.warning('[picow:%s] bad ether_b64', client_id)
            return
        await bridge.deliver_packet_out(ether)


# Module-level singleton — same pattern as esp_qemu_manager.
picow_net_manager = PicowNetManager()
