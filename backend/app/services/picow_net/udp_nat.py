"""
UDP NAT — chip-initiated outbound UDP datagrams.

Per (chip_port, dst_ip, dst_port) we keep a host-side asyncio
DatagramTransport that:

  - Sends the chip's payload to the real host
  - Receives responses and wraps them back into Ethernet+IPv4+UDP
    frames addressed to the chip

Idle UDP flows are reaped after UDP_IDLE_TIMEOUT seconds.
"""

from __future__ import annotations

import asyncio
import logging
import socket
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, Tuple

from .consts import GATEWAY_MAC, IPPROTO_UDP, bytes_to_ip
from .protocols import IPv4, UDP, make_frame_ipv4

logger = logging.getLogger(__name__)

UDP_IDLE_TIMEOUT = 60.0

InjectFn = Callable[[bytes], Awaitable[None]]


@dataclass
class _UdpFlow:
    chip_mac: bytes
    chip_ip: bytes
    chip_port: int
    dst_ip: bytes
    dst_port: int
    transport: asyncio.DatagramTransport
    last_used: float


class _UdpProto(asyncio.DatagramProtocol):
    """asyncio DatagramProtocol that funnels host→chip packets back."""

    def __init__(self, flow_key: Tuple[bytes, int, bytes, int],
                 nat: 'UdpNat') -> None:
        self._flow_key = flow_key
        self._nat = nat
        self.transport: asyncio.DatagramTransport | None = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self.transport = transport  # type: ignore[assignment]

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        loop = asyncio.get_event_loop()
        loop.create_task(self._nat._on_host_datagram(self._flow_key, data))

    def error_received(self, exc: Exception) -> None:
        logger.debug('[picow-udp] %s', exc)


class UdpNat:
    def __init__(self, inject: InjectFn) -> None:
        self._inject = inject
        self._flows: Dict[Tuple[bytes, int, bytes, int], _UdpFlow] = {}
        self._reaper_task: asyncio.Task | None = None

    # ── Entry from bridge ──────────────────────────────────────────

    async def handle_chip_datagram(
        self,
        chip_mac: bytes,
        ip: IPv4,
        udp: UDP,
    ) -> None:
        key = (bytes(ip.src), udp.src_port, bytes(ip.dst), udp.dst_port)
        flow = self._flows.get(key)
        if flow is None:
            flow = await self._open_flow(chip_mac, ip, udp, key)
            if flow is None:
                return
        flow.last_used = time.monotonic()
        try:
            flow.transport.sendto(udp.payload)
        except Exception:
            logger.exception('[picow-udp] send failed')
            self._reap_flow(key)

    # ── Per-flow lifecycle ─────────────────────────────────────────

    async def _open_flow(
        self,
        chip_mac: bytes,
        ip: IPv4,
        udp: UDP,
        key: Tuple[bytes, int, bytes, int],
    ) -> _UdpFlow | None:
        loop = asyncio.get_event_loop()
        try:
            transport, _proto = await loop.create_datagram_endpoint(
                lambda: _UdpProto(key, self),
                remote_addr=(bytes_to_ip(bytes(ip.dst)), udp.dst_port),
                family=socket.AF_INET,
            )
        except (OSError, asyncio.TimeoutError) as e:
            logger.info('[picow-udp] open flow failed %s:%d %s',
                        bytes_to_ip(bytes(ip.dst)), udp.dst_port, e)
            return None
        flow = _UdpFlow(
            chip_mac=chip_mac,
            chip_ip=bytes(ip.src),
            chip_port=udp.src_port,
            dst_ip=bytes(ip.dst),
            dst_port=udp.dst_port,
            transport=transport,
            last_used=time.monotonic(),
        )
        self._flows[key] = flow
        if self._reaper_task is None:
            self._reaper_task = asyncio.create_task(self._reaper())
        return flow

    async def _on_host_datagram(
        self,
        key: Tuple[bytes, int, bytes, int],
        data: bytes,
    ) -> None:
        flow = self._flows.get(key)
        if flow is None:
            return
        flow.last_used = time.monotonic()
        # Build chip-bound packet: source = (dst_ip, dst_port), dest = (chip_ip, chip_port).
        udp = UDP(
            src_port=flow.dst_port,
            dst_port=flow.chip_port,
            payload=data,
        )
        ipv4_payload = udp.to_bytes(flow.dst_ip, flow.chip_ip)
        frame = make_frame_ipv4(
            dst_mac=flow.chip_mac,
            src_mac=GATEWAY_MAC,
            src_ip=flow.dst_ip,
            dst_ip=flow.chip_ip,
            protocol=IPPROTO_UDP,
            l4_payload=ipv4_payload,
        )
        await self._inject(frame)

    def _reap_flow(self, key: Tuple[bytes, int, bytes, int]) -> None:
        flow = self._flows.pop(key, None)
        if flow is not None:
            try:
                flow.transport.close()
            except Exception:
                pass

    async def _reaper(self) -> None:
        try:
            while True:
                await asyncio.sleep(UDP_IDLE_TIMEOUT / 2)
                cutoff = time.monotonic() - UDP_IDLE_TIMEOUT
                stale = [k for k, f in self._flows.items() if f.last_used < cutoff]
                for k in stale:
                    self._reap_flow(k)
                if not self._flows:
                    self._reaper_task = None
                    return
        except asyncio.CancelledError:
            return

    async def shutdown(self) -> None:
        for key in list(self._flows.keys()):
            self._reap_flow(key)
        if self._reaper_task is not None:
            self._reaper_task.cancel()
            self._reaper_task = None
