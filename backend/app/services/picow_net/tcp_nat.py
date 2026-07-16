"""
TCP NAT — chip-initiated outbound connections to the host network.

The implementation follows RFC 793 §3.4-§3.9 closely enough to handle
real-world MicroPython workloads:

  - Three-way handshake (SYN → SYN+ACK → ACK)
  - Bidirectional data flow with proper seq/ack accounting
  - Half-close handling (FIN from either side)
  - RST as the cheap escape hatch on protocol errors
  - MSS option negotiation (we advertise TCP_MSS = MTU - 40)
  - Window clamped to TCP_WINDOW (no window scaling)

Per-connection state lives in a TcpConnection object keyed by
(chip_port, dst_ip, dst_port). Each connection owns an asyncio
StreamReader/StreamWriter to the real host endpoint.

States we transition through, simplified to chip-initiated only:

      CLOSED
        │ chip SYN
        ▼
      SYN_RCVD          ── send SYN+ACK back to chip
        │ chip ACK
        ▼
      ESTABLISHED       ── pump bytes both ways
        │
        ├── chip FIN ──► CLOSE_WAIT  ── after host close: LAST_ACK ──► CLOSED
        └── host EOF ──► FIN_WAIT_1  ── after chip ACK:   FIN_WAIT_2 ──► CLOSED

We deliberately don't implement TIME_WAIT — the chip does, we just GC
once both sides have FIN'd. This is the same simplification slirp uses.

Sequence numbers wrap at 2³² — every comparison goes through
``_seq_lt`` / ``_seq_geq`` which use modular arithmetic.
"""

from __future__ import annotations

import asyncio
import logging
import random
import struct
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, Optional, Tuple

from .consts import (
    GATEWAY_MAC,
    IPPROTO_TCP,
    TCP_ACK,
    TCP_FIN,
    TCP_MSS,
    TCP_PSH,
    TCP_RST,
    TCP_SYN,
    TCP_WINDOW,
    bytes_to_ip,
)
from .protocols import IPv4, TCP, make_frame_ipv4, parse_tcp_options

logger = logging.getLogger(__name__)

InjectFn = Callable[[bytes], Awaitable[None]]


# ─── Sequence number arithmetic (modular 32-bit) ─────────────────────

def _seq_add(a: int, b: int) -> int:
    return (a + b) & 0xffffffff


def _seq_lt(a: int, b: int) -> bool:
    """RFC 1323-style: a < b modulo 2^32."""
    return ((a - b) & 0xffffffff) >= 0x80000000


def _seq_leq(a: int, b: int) -> bool:
    return a == b or _seq_lt(a, b)


def _seq_diff(a: int, b: int) -> int:
    """Distance a - b modulo 2^32, signed."""
    d = (a - b) & 0xffffffff
    if d & 0x80000000:
        d -= 0x100000000
    return d


# ─── Per-connection state ────────────────────────────────────────────

class _State:
    SYN_RCVD = 'SYN_RCVD'
    ESTABLISHED = 'ESTABLISHED'
    FIN_WAIT_1 = 'FIN_WAIT_1'      # we (host side) sent FIN, waiting for chip ACK
    FIN_WAIT_2 = 'FIN_WAIT_2'      # chip ACKed our FIN
    CLOSE_WAIT = 'CLOSE_WAIT'      # chip sent FIN, host still has more to send
    LAST_ACK = 'LAST_ACK'          # both sides FIN'd, waiting for last ACK
    CLOSED = 'CLOSED'


@dataclass
class TcpConnection:
    chip_ip: bytes
    chip_port: int
    dst_ip: bytes
    dst_port: int
    chip_mac: bytes
    state: str = _State.CLOSED
    chip_isn: int = 0          # initial chip seq we observed
    our_isn: int = 0           # initial seq we picked
    our_seq: int = 0           # next seq we'll put on the wire chipward
    chip_seq: int = 0          # next seq we expect from chip
    chip_window: int = 0
    mss: int = TCP_MSS
    host_reader: Optional[asyncio.StreamReader] = None
    host_writer: Optional[asyncio.StreamWriter] = None
    host_pump_task: Optional[asyncio.Task] = None
    last_activity: float = 0.0

    def key(self) -> Tuple[bytes, int, bytes, int]:
        return (self.chip_ip, self.chip_port, self.dst_ip, self.dst_port)


# ─── NAT manager ─────────────────────────────────────────────────────

class TcpNat:
    """
    Manages every chip-initiated TCP connection. ``inject`` is the
    callback the bridge gives us to push Ethernet frames back to the
    chip; calls into the manager are made from the bridge whenever an
    IP-with-protocol-TCP frame arrives from the chip.
    """

    def __init__(self, inject: InjectFn) -> None:
        self._inject = inject
        self._conns: Dict[Tuple[bytes, int, bytes, int], TcpConnection] = {}

    # ── Entry point from the bridge ────────────────────────────────

    async def handle_chip_segment(
        self, chip_mac: bytes, ip: IPv4, tcp: TCP,
    ) -> None:
        key = (bytes(ip.src), tcp.src_port, bytes(ip.dst), tcp.dst_port)
        conn = self._conns.get(key)

        if tcp.flags & TCP_RST:
            # Chip aborted — tear down silently.
            if conn:
                await self._close(conn, send_rst=False)
            return

        if conn is None:
            if tcp.flags & TCP_SYN and not (tcp.flags & TCP_ACK):
                await self._on_passive_syn(chip_mac, ip, tcp)
            else:
                # Stray segment with no connection: respond with RST.
                await self._send_rst(chip_mac, ip, tcp)
            return

        # Update bookkeeping that's the same in every state.
        conn.chip_window = tcp.window

        if conn.state == _State.SYN_RCVD:
            await self._on_handshake_complete(conn, tcp)
        elif conn.state == _State.ESTABLISHED:
            await self._on_data(conn, tcp)
        elif conn.state == _State.FIN_WAIT_1:
            await self._on_fin_wait_1(conn, tcp)
        elif conn.state == _State.FIN_WAIT_2:
            await self._on_fin_wait_2(conn, tcp)
        elif conn.state == _State.CLOSE_WAIT:
            # Chip should be quiet; ignore unless RST/FIN retransmit.
            pass
        elif conn.state == _State.LAST_ACK:
            if tcp.flags & TCP_ACK and _seq_geq_or_eq(tcp.ack, _seq_add(conn.our_seq, 0)):
                await self._close(conn, send_rst=False)

    # ── State handlers ─────────────────────────────────────────────

    async def _on_passive_syn(self, chip_mac: bytes, ip: IPv4, tcp: TCP) -> None:
        """Chip is opening a new connection — we play the server."""
        opts = parse_tcp_options(tcp.options)
        mss = opts.get('mss', TCP_MSS)
        if mss > TCP_MSS:
            mss = TCP_MSS

        our_isn = random.randint(0, 0xffffffff)
        conn = TcpConnection(
            chip_ip=bytes(ip.src),
            chip_port=tcp.src_port,
            dst_ip=bytes(ip.dst),
            dst_port=tcp.dst_port,
            chip_mac=chip_mac,
            state=_State.CLOSED,
            chip_isn=tcp.seq,
            our_isn=our_isn,
            our_seq=_seq_add(our_isn, 1),     # SYN counts as 1 byte
            chip_seq=_seq_add(tcp.seq, 1),
            chip_window=tcp.window,
            mss=mss,
            last_activity=asyncio.get_event_loop().time(),
        )

        # Try to establish the host-side connection. If it fails we
        # send RST to the chip and never store the connection.
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(bytes_to_ip(conn.dst_ip), conn.dst_port),
                timeout=10.0,
            )
        except (OSError, asyncio.TimeoutError) as e:
            logger.info(
                '[picow-tcp] connect %s:%d failed: %s',
                bytes_to_ip(conn.dst_ip), conn.dst_port, e,
            )
            await self._send_rst(chip_mac, ip, tcp)
            return

        conn.host_reader = reader
        conn.host_writer = writer
        conn.state = _State.SYN_RCVD
        self._conns[conn.key()] = conn

        # Send SYN+ACK back. Advertise our MSS option.
        await self._send(conn, flags=TCP_SYN | TCP_ACK,
                         seq=conn.our_isn, ack=conn.chip_seq,
                         options=_mss_option(conn.mss))

        # Start the host → chip pump. It will block until handshake completes.
        conn.host_pump_task = asyncio.create_task(self._pump_host_to_chip(conn))

    async def _on_handshake_complete(self, conn: TcpConnection, tcp: TCP) -> None:
        """We're SYN_RCVD; this should be the chip's ACK of our SYN+ACK."""
        if not (tcp.flags & TCP_ACK):
            return
        if tcp.ack != conn.our_seq:
            # Stale or duplicate; ignore.
            return
        conn.state = _State.ESTABLISHED
        # Some clients piggyback data on the final handshake ACK.
        if tcp.payload:
            await self._on_data(conn, tcp)

    async def _on_data(self, conn: TcpConnection, tcp: TCP) -> None:
        # Reject out-of-order. The chip will retransmit.
        if tcp.payload:
            if tcp.seq != conn.chip_seq:
                # Re-ACK what we have (forces retransmit).
                await self._ack_only(conn)
                return
            assert conn.host_writer is not None
            try:
                conn.host_writer.write(tcp.payload)
                await conn.host_writer.drain()
            except (ConnectionError, OSError):
                await self._close(conn, send_rst=True)
                return
            conn.chip_seq = _seq_add(conn.chip_seq, len(tcp.payload))
            await self._ack_only(conn)
        elif (tcp.flags & TCP_ACK) and tcp.ack and tcp.seq == conn.chip_seq:
            # Pure ACK or keep-alive — nothing to do.
            pass

        if tcp.flags & TCP_FIN:
            conn.chip_seq = _seq_add(conn.chip_seq, 1)
            conn.state = _State.CLOSE_WAIT
            # Tell the host side we're done sending.
            if conn.host_writer is not None:
                try:
                    conn.host_writer.write_eof()
                except (OSError, ConnectionError):
                    pass
            await self._ack_only(conn)
            # Stay in CLOSE_WAIT until the host pump finishes draining
            # whatever's still inbound, then it transitions to LAST_ACK.

    async def _on_fin_wait_1(self, conn: TcpConnection, tcp: TCP) -> None:
        # Waiting for the chip to ACK our FIN.
        if (tcp.flags & TCP_ACK) and tcp.ack == conn.our_seq:
            conn.state = _State.FIN_WAIT_2
        if tcp.flags & TCP_FIN:
            conn.chip_seq = _seq_add(conn.chip_seq, 1)
            await self._ack_only(conn)
            await self._close(conn, send_rst=False)

    async def _on_fin_wait_2(self, conn: TcpConnection, tcp: TCP) -> None:
        if tcp.flags & TCP_FIN:
            conn.chip_seq = _seq_add(conn.chip_seq, 1)
            await self._ack_only(conn)
            await self._close(conn, send_rst=False)

    # ── Host → chip pump ───────────────────────────────────────────

    async def _pump_host_to_chip(self, conn: TcpConnection) -> None:
        """Read bytes from the real host socket and segment them to the chip."""
        try:
            assert conn.host_reader is not None
            # Wait for handshake to complete before pushing.
            while conn.state == _State.SYN_RCVD:
                await asyncio.sleep(0.005)

            while conn.state in (_State.ESTABLISHED, _State.CLOSE_WAIT):
                chunk = await conn.host_reader.read(conn.mss)
                if not chunk:
                    break
                # Segment if needed (read() should already cap at mss).
                while chunk:
                    seg = chunk[:conn.mss]
                    chunk = chunk[conn.mss:]
                    await self._send(
                        conn, flags=TCP_ACK | TCP_PSH,
                        seq=conn.our_seq, ack=conn.chip_seq,
                        payload=seg,
                    )
                    conn.our_seq = _seq_add(conn.our_seq, len(seg))
                    conn.last_activity = asyncio.get_event_loop().time()

            # Host side EOF — send FIN.
            if conn.state == _State.ESTABLISHED:
                conn.state = _State.FIN_WAIT_1
                await self._send(conn, flags=TCP_ACK | TCP_FIN,
                                 seq=conn.our_seq, ack=conn.chip_seq)
                conn.our_seq = _seq_add(conn.our_seq, 1)
            elif conn.state == _State.CLOSE_WAIT:
                conn.state = _State.LAST_ACK
                await self._send(conn, flags=TCP_ACK | TCP_FIN,
                                 seq=conn.our_seq, ack=conn.chip_seq)
                conn.our_seq = _seq_add(conn.our_seq, 1)

        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception('[picow-tcp] pump crashed')
            await self._close(conn, send_rst=True)

    # ── Frame emission ─────────────────────────────────────────────

    async def _send(
        self,
        conn: TcpConnection,
        flags: int,
        seq: int,
        ack: int,
        options: bytes = b'',
        payload: bytes = b'',
    ) -> None:
        tcp = TCP(
            src_port=conn.dst_port,             # chip's "remote" = our destination
            dst_port=conn.chip_port,
            seq=seq & 0xffffffff,
            ack=ack & 0xffffffff,
            flags=flags,
            window=TCP_WINDOW,
            options=options,
            payload=payload,
        )
        # Note: we swap src/dst here because we're emitting the chip's
        # peer's segment — what would have come back from the host.
        ipv4_payload = tcp.to_bytes(conn.dst_ip, conn.chip_ip)
        frame = make_frame_ipv4(
            dst_mac=conn.chip_mac,
            src_mac=GATEWAY_MAC,
            src_ip=conn.dst_ip,
            dst_ip=conn.chip_ip,
            protocol=IPPROTO_TCP,
            l4_payload=ipv4_payload,
        )
        await self._inject(frame)

    async def _ack_only(self, conn: TcpConnection) -> None:
        await self._send(
            conn, flags=TCP_ACK,
            seq=conn.our_seq, ack=conn.chip_seq,
        )

    async def _send_rst(self, chip_mac: bytes, ip: IPv4, tcp: TCP) -> None:
        rst = TCP(
            src_port=tcp.dst_port,
            dst_port=tcp.src_port,
            seq=tcp.ack if (tcp.flags & TCP_ACK) else 0,
            ack=_seq_add(tcp.seq, 1 if (tcp.flags & TCP_SYN) else len(tcp.payload)),
            flags=TCP_RST | TCP_ACK,
            window=0,
        )
        ipv4_payload = rst.to_bytes(bytes(ip.dst), bytes(ip.src))
        frame = make_frame_ipv4(
            dst_mac=chip_mac,
            src_mac=GATEWAY_MAC,
            src_ip=bytes(ip.dst),
            dst_ip=bytes(ip.src),
            protocol=IPPROTO_TCP,
            l4_payload=ipv4_payload,
        )
        await self._inject(frame)

    # ── Teardown ───────────────────────────────────────────────────

    async def _close(self, conn: TcpConnection, send_rst: bool) -> None:
        if conn.state == _State.CLOSED:
            return
        conn.state = _State.CLOSED
        if send_rst:
            try:
                rst = TCP(
                    src_port=conn.dst_port,
                    dst_port=conn.chip_port,
                    seq=conn.our_seq,
                    ack=conn.chip_seq,
                    flags=TCP_RST,
                )
                ipv4_payload = rst.to_bytes(conn.dst_ip, conn.chip_ip)
                await self._inject(make_frame_ipv4(
                    dst_mac=conn.chip_mac,
                    src_mac=GATEWAY_MAC,
                    src_ip=conn.dst_ip,
                    dst_ip=conn.chip_ip,
                    protocol=IPPROTO_TCP,
                    l4_payload=ipv4_payload,
                ))
            except Exception:
                pass
        if conn.host_writer is not None:
            try:
                conn.host_writer.close()
            except Exception:
                pass
        if conn.host_pump_task is not None and not conn.host_pump_task.done():
            conn.host_pump_task.cancel()
        self._conns.pop(conn.key(), None)

    async def shutdown(self) -> None:
        for conn in list(self._conns.values()):
            await self._close(conn, send_rst=True)


# ─── helpers ────────────────────────────────────────────────────────

def _mss_option(mss: int) -> bytes:
    return b'\x02\x04' + struct.pack('!H', mss)


def _seq_geq_or_eq(a: int, b: int) -> bool:
    return a == b or not _seq_lt(a, b)
