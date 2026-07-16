"""
Pico W backend network bridge — full unit + integration coverage.

The bridge is split across:
  backend/app/services/picow_net/
    bridge.py          — orchestrator
    protocols.py       — Ethernet/IPv4/TCP/UDP/ICMP/ARP/DHCP/DNS codecs
    checksums.py       — RFC 1071 + pseudo-header
    arp.py / dhcp.py / dns.py / icmp.py / tcp_nat.py / udp_nat.py

These tests run *without* the frontend — we synthesise the chip's
side of every interaction (ARP requests, DHCP DISCOVERs, TCP segments,
UDP datagrams, ICMP echo) and assert the bridge produces correct
replies. Where real network I/O is involved (TCP open, DNS lookup,
UDP datagram), we stand up a tiny local server inside the test.
"""

from __future__ import annotations

import asyncio
import socket
import struct
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'backend'))

from app.services.picow_net.checksums import (  # noqa: E402
    internet_checksum,
    tcp_udp_checksum,
)
from app.services.picow_net.consts import (  # noqa: E402
    ETHERTYPE_ARP,
    ETHERTYPE_IPV4,
    GATEWAY_IP,
    GATEWAY_MAC,
    IPPROTO_ICMP,
    IPPROTO_TCP,
    IPPROTO_UDP,
    STA_IP,
    STA_MAC,
    TCP_ACK,
    TCP_FIN,
    TCP_PSH,
    TCP_SYN,
    ip_to_bytes,
)
from app.services.picow_net.protocols import (  # noqa: E402
    Arp,
    Dhcp,
    DnsMessage,
    Ethernet,
    ICMP,
    IPv4,
    TCP,
    UDP,
    DHCP_MAGIC,
    parse_tcp_options,
)
from app.services.picow_net.bridge import PicowNetBridge  # noqa: E402


# ─── checksum primitives ────────────────────────────────────────────

class TestChecksums:
    """Hand-computed RFC 1071 examples + a real TCP segment."""

    def test_internet_checksum_zero_input(self):
        # Sum of nothing is 0; one's complement of 0 is 0xffff.
        assert internet_checksum(b'\x00\x00') == 0xffff

    def test_internet_checksum_all_ones_cancels(self):
        # 0xffff + 0xffff carries to 1, end-around adds → 0xffff.
        # complement → 0.
        assert internet_checksum(b'\xff\xff\xff\xff') == 0

    def test_ipv4_header_checksum_known_value(self):
        # IPv4 header with checksum=0:
        #   45 00 00 28 00 00 40 00 40 06 00 00 7f 00 00 01 7f 00 00 01
        # Per RFC 1071 worked example: cksum = 0xb96a-ish (actually 0xb961).
        hdr = bytes.fromhex('4500002800004000400600007f0000017f000001')
        c = internet_checksum(hdr)
        # Re-inserting and re-summing should yield 0xffff.
        verified = (hdr[:10] + struct.pack('!H', c) + hdr[12:])
        s = internet_checksum(verified)
        assert s == 0

    def test_tcp_checksum_round_trip(self):
        src_ip = ip_to_bytes('10.0.0.1')
        dst_ip = ip_to_bytes('10.0.0.2')
        # Bare TCP segment: SYN, src 1234, dst 80, seq=1, ack=0
        seg = struct.pack('!HHIIHHHH',
            1234, 80, 1, 0, (5 << 12) | TCP_SYN, 65535, 0, 0,
        )
        c = tcp_udp_checksum(src_ip, dst_ip, IPPROTO_TCP, seg)
        seg_with = seg[:16] + struct.pack('!H', c) + seg[18:]
        # Rolling checksum over the whole thing should verify.
        from app.services.picow_net.checksums import (
            tcp_udp_pseudo_header, ones_complement_sum,
        )
        pseudo = tcp_udp_pseudo_header(src_ip, dst_ip, IPPROTO_TCP, len(seg_with))
        assert ones_complement_sum(pseudo + seg_with) == 0xffff


# ─── protocol parsers ───────────────────────────────────────────────

class TestProtocols:
    def test_ethernet_round_trip(self):
        f = Ethernet(dst=STA_MAC, src=GATEWAY_MAC, ethertype=ETHERTYPE_IPV4,
                     payload=b'hello')
        assert Ethernet.parse(f.to_bytes()) == f

    def test_ipv4_round_trip(self):
        ip = IPv4(
            protocol=IPPROTO_TCP,
            src=ip_to_bytes('1.2.3.4'),
            dst=ip_to_bytes('5.6.7.8'),
            payload=b'\x00' * 20,
        )
        out = ip.to_bytes()
        ip2 = IPv4.parse(out)
        assert ip2.src == ip.src and ip2.dst == ip.dst
        assert ip2.protocol == IPPROTO_TCP
        # Header checksum verifies.
        from app.services.picow_net.checksums import internet_checksum
        assert internet_checksum(out[:20]) == 0

    def test_tcp_options_parser(self):
        # MSS=1460, NOP, SACK-permitted (kind=4 length=2)
        opts = b'\x02\x04\x05\xb4\x01\x04\x02'
        parsed = parse_tcp_options(opts)
        assert parsed['mss'] == 1460
        assert 4 in parsed

    def test_arp_round_trip(self):
        a = Arp(
            opcode=1,
            sha=STA_MAC,
            spa=ip_to_bytes(STA_IP),
            tha=b'\x00' * 6,
            tpa=ip_to_bytes(GATEWAY_IP),
        )
        b = a.to_bytes()
        a2 = Arp.parse(b)
        assert a2.opcode == 1
        assert bytes(a2.spa) == ip_to_bytes(STA_IP)

    def test_dhcp_round_trip(self):
        d = Dhcp(
            op=1, xid=0xdeadbeef,
            chaddr=STA_MAC + b'\x00' * 10,
            options={53: bytes([1])},
        )
        out = d.to_bytes()
        assert DHCP_MAGIC in out
        d2 = Dhcp.parse(out)
        assert d2.xid == 0xdeadbeef
        assert d2.options.get(53) == bytes([1])

    def test_dns_round_trip(self):
        m = DnsMessage(
            txid=0x4242,
            flags=0x0100,
            qd=[('example.com', 1, 1)],
        )
        b = m.to_bytes()
        m2 = DnsMessage.parse(b)
        assert m2.txid == 0x4242
        assert m2.qd[0][0] == 'example.com'


# ─── bridge — ARP ───────────────────────────────────────────────────

class _Capture:
    """Helper that captures every (kind, data) emit() call."""
    def __init__(self):
        self.events: list[tuple[str, dict]] = []

    async def __call__(self, kind: str, data: dict) -> None:
        self.events.append((kind, data))

    def latest_packet_in(self) -> bytes | None:
        for k, d in reversed(self.events):
            if k == 'picow_packet_in':
                import base64
                return base64.b64decode(d['ether_b64'])
        return None

    def all_packets_in(self) -> list[bytes]:
        out: list[bytes] = []
        import base64
        for k, d in self.events:
            if k == 'picow_packet_in':
                out.append(base64.b64decode(d['ether_b64']))
        return out


def _make_arp_request(sender_mac: bytes, sender_ip: str, target_ip: str) -> bytes:
    arp = Arp(
        opcode=1,
        sha=sender_mac,
        spa=ip_to_bytes(sender_ip),
        tha=b'\x00' * 6,
        tpa=ip_to_bytes(target_ip),
    )
    return Ethernet(
        dst=b'\xff' * 6,
        src=sender_mac,
        ethertype=ETHERTYPE_ARP,
        payload=arp.to_bytes(),
    ).to_bytes()


@pytest.mark.asyncio
async def test_arp_responder_replies_for_gateway():
    cap = _Capture()
    bridge = PicowNetBridge('test', cap, wifi_enabled=True)
    await bridge.start()

    await bridge.deliver_packet_out(_make_arp_request(STA_MAC, STA_IP, GATEWAY_IP))
    pkt = cap.latest_packet_in()
    assert pkt is not None
    eth = Ethernet.parse(pkt)
    assert eth.ethertype == ETHERTYPE_ARP
    arp = Arp.parse(eth.payload)
    assert arp.opcode == 2
    assert bytes(arp.sha) == GATEWAY_MAC
    assert bytes(arp.spa) == ip_to_bytes(GATEWAY_IP)


@pytest.mark.asyncio
async def test_arp_responder_answers_for_arbitrary_host():
    """Slirp-style: every IP outside the LAN resolves to the gateway MAC."""
    cap = _Capture()
    bridge = PicowNetBridge('test', cap, wifi_enabled=True)
    await bridge.start()
    await bridge.deliver_packet_out(_make_arp_request(STA_MAC, STA_IP, '8.8.8.8'))
    pkt = cap.latest_packet_in()
    assert pkt is not None
    arp = Arp.parse(Ethernet.parse(pkt).payload)
    assert arp.opcode == 2
    assert bytes(arp.sha) == GATEWAY_MAC
    assert bytes(arp.spa) == ip_to_bytes('8.8.8.8')


# ─── bridge — DHCP ──────────────────────────────────────────────────

def _make_dhcp_msg(msg_type: int, xid: int = 0xdeadbeef) -> bytes:
    dhcp = Dhcp(
        op=1, xid=xid,
        chaddr=STA_MAC + b'\x00' * 10,
        options={53: bytes([msg_type])},
    )
    udp = UDP(src_port=68, dst_port=67, payload=dhcp.to_bytes())
    src_ip = ip_to_bytes('0.0.0.0')
    dst_ip = ip_to_bytes('255.255.255.255')
    ip = IPv4(
        protocol=IPPROTO_UDP, src=src_ip, dst=dst_ip,
        payload=udp.to_bytes(src_ip, dst_ip),
    )
    return Ethernet(
        dst=b'\xff' * 6, src=STA_MAC,
        ethertype=ETHERTYPE_IPV4, payload=ip.to_bytes(),
    ).to_bytes()


@pytest.mark.asyncio
async def test_dhcp_offer_then_ack():
    cap = _Capture()
    bridge = PicowNetBridge('test', cap, wifi_enabled=True)
    await bridge.start()

    await bridge.deliver_packet_out(_make_dhcp_msg(1))   # DISCOVER
    await bridge.deliver_packet_out(_make_dhcp_msg(3))   # REQUEST

    pkts = cap.all_packets_in()
    assert len(pkts) == 2
    for raw in pkts:
        eth = Ethernet.parse(raw)
        ip = IPv4.parse(eth.payload)
        udp = UDP.parse(ip.payload)
        d = Dhcp.parse(udp.payload)
        assert d.op == 2  # BOOTREPLY
        assert bytes(d.yiaddr) == ip_to_bytes(STA_IP)
        # Server-id option (54) must be the gateway IP.
        assert d.options[54] == ip_to_bytes(GATEWAY_IP)


# ─── bridge — ICMP echo ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_icmp_echo_reply():
    cap = _Capture()
    bridge = PicowNetBridge('test', cap, wifi_enabled=True)
    await bridge.start()

    icmp = ICMP(
        type=8, code=0,
        rest=struct.pack('!HH', 0x1234, 0x0001),
        payload=b'velxio-ping-payload',
    )
    ip = IPv4(
        protocol=IPPROTO_ICMP,
        src=ip_to_bytes(STA_IP),
        dst=ip_to_bytes('1.1.1.1'),
        payload=icmp.to_bytes(),
    )
    frame = Ethernet(GATEWAY_MAC, STA_MAC, ETHERTYPE_IPV4, ip.to_bytes()).to_bytes()
    await bridge.deliver_packet_out(frame)

    pkt = cap.latest_packet_in()
    assert pkt is not None
    rip = IPv4.parse(Ethernet.parse(pkt).payload)
    rcmp = ICMP.parse(rip.payload)
    assert rcmp.type == 0  # ECHO REPLY
    assert rcmp.payload == b'velxio-ping-payload'
    assert rcmp.rest == struct.pack('!HH', 0x1234, 0x0001)


# ─── bridge — UDP NAT (full round-trip via local echo server) ───────

@pytest.mark.asyncio
async def test_udp_nat_round_trip():
    """Stand up a local UDP echo server and verify chip→host→chip flow."""
    loop = asyncio.get_event_loop()
    received: list[bytes] = []

    class EchoProto(asyncio.DatagramProtocol):
        def __init__(self):
            self.transport: asyncio.DatagramTransport | None = None
        def connection_made(self, t):
            self.transport = t
        def datagram_received(self, data, addr):
            received.append(data)
            assert self.transport is not None
            self.transport.sendto(b'echo:' + data, addr)

    server_transport, _ = await loop.create_datagram_endpoint(
        EchoProto, local_addr=('127.0.0.1', 0),
    )
    server_host, server_port = server_transport.get_extra_info('sockname')

    cap = _Capture()
    bridge = PicowNetBridge('test', cap, wifi_enabled=True)
    await bridge.start()

    udp = UDP(src_port=33333, dst_port=server_port, payload=b'velxio-udp')
    ip = IPv4(
        protocol=IPPROTO_UDP,
        src=ip_to_bytes(STA_IP),
        dst=ip_to_bytes(server_host),
        payload=udp.to_bytes(ip_to_bytes(STA_IP), ip_to_bytes(server_host)),
    )
    frame = Ethernet(GATEWAY_MAC, STA_MAC, ETHERTYPE_IPV4, ip.to_bytes()).to_bytes()
    await bridge.deliver_packet_out(frame)

    # Wait up to 2 s for the echo to arrive back.
    for _ in range(40):
        if cap.latest_packet_in() is not None:
            break
        await asyncio.sleep(0.05)

    server_transport.close()
    await bridge.stop()

    assert received == [b'velxio-udp']
    pkt = cap.latest_packet_in()
    assert pkt is not None
    rip = IPv4.parse(Ethernet.parse(pkt).payload)
    rudp = UDP.parse(rip.payload)
    assert rudp.payload == b'echo:velxio-udp'
    assert rudp.dst_port == 33333


# ─── bridge — TCP NAT (full RFC 793 handshake + data + close) ──────

@pytest.mark.asyncio
async def test_tcp_nat_full_round_trip():
    """Spin up a local HTTP-shaped server and walk through the whole TCP
    state machine: SYN → SYN+ACK → ACK → data → FIN."""

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        data = await reader.readuntil(b'\r\n\r\n')
        assert b'GET /hello' in data
        writer.write(b'HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello')
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(handle, '127.0.0.1', 0)
    server_host, server_port = server.sockets[0].getsockname()

    cap = _Capture()
    bridge = PicowNetBridge('test', cap, wifi_enabled=True)
    await bridge.start()

    chip_port = 44444
    chip_isn = 0x1000

    async def send_tcp(seq: int, ack: int, flags: int, payload: bytes = b''):
        tcp = TCP(
            src_port=chip_port, dst_port=server_port,
            seq=seq, ack=ack, flags=flags, window=65535,
            payload=payload,
        )
        ip = IPv4(
            protocol=IPPROTO_TCP,
            src=ip_to_bytes(STA_IP),
            dst=ip_to_bytes(server_host),
            payload=tcp.to_bytes(ip_to_bytes(STA_IP), ip_to_bytes(server_host)),
        )
        frame = Ethernet(GATEWAY_MAC, STA_MAC, ETHERTYPE_IPV4, ip.to_bytes()).to_bytes()
        await bridge.deliver_packet_out(frame)

    async def wait_for_segment_with_flags(
        expected_flags: int, start_idx: int = 0, timeout: float = 2.0,
    ) -> tuple[TCP, int]:
        """Scan from start_idx onward; return (tcp, index_after_match)."""
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            for i in range(start_idx, len(cap.events)):
                k, d = cap.events[i]
                if k != 'picow_packet_in':
                    continue
                import base64
                raw = base64.b64decode(d['ether_b64'])
                eth = Ethernet.parse(raw)
                if eth.ethertype != ETHERTYPE_IPV4:
                    continue
                ip = IPv4.parse(eth.payload)
                if ip.protocol != IPPROTO_TCP:
                    continue
                tcp = TCP.parse(ip.payload)
                if (tcp.flags & expected_flags) == expected_flags:
                    return tcp, i + 1
            await asyncio.sleep(0.02)
        raise AssertionError(f'no TCP segment with flags 0x{expected_flags:x} arrived')

    # 1. SYN
    await send_tcp(seq=chip_isn, ack=0, flags=TCP_SYN)
    syn_ack, idx = await wait_for_segment_with_flags(TCP_SYN | TCP_ACK)
    assert syn_ack.ack == chip_isn + 1
    server_isn = syn_ack.seq

    # 2. ACK the SYN+ACK and immediately PSH a GET request.
    request = b'GET /hello HTTP/1.1\r\nHost: x\r\n\r\n'
    await send_tcp(
        seq=chip_isn + 1, ack=server_isn + 1,
        flags=TCP_ACK | TCP_PSH, payload=request,
    )

    # 3. Read the response. We expect:
    #    - an ACK for our request
    #    - a PSH+ACK with HTTP/1.1 200 OK + body
    #    - a FIN+ACK from the server
    response_segments = []
    deadline = asyncio.get_event_loop().time() + 3.0
    fin_seen = False
    while asyncio.get_event_loop().time() < deadline and not fin_seen:
        for i in range(idx, len(cap.events)):
            k, d = cap.events[i]
            if k != 'picow_packet_in':
                continue
            import base64
            raw = base64.b64decode(d['ether_b64'])
            eth = Ethernet.parse(raw)
            if eth.ethertype != ETHERTYPE_IPV4:
                continue
            ip = IPv4.parse(eth.payload)
            if ip.protocol != IPPROTO_TCP:
                continue
            tcp = TCP.parse(ip.payload)
            if tcp.payload:
                response_segments.append(tcp.payload)
            if tcp.flags & TCP_FIN:
                fin_seen = True
        idx = len(cap.events)
        await asyncio.sleep(0.02)

    assert fin_seen
    body = b''.join(response_segments)
    assert b'HTTP/1.1 200 OK' in body
    assert body.endswith(b'hello')

    # 4. Send our own FIN to close the chip side cleanly.
    await send_tcp(
        seq=chip_isn + 1 + len(request),
        ack=server_isn + 1 + len(body) + 1,
        flags=TCP_ACK | TCP_FIN,
    )

    server.close()
    await server.wait_closed()
    await bridge.stop()


# ─── bridge — DNS proxy (uses host resolver) ────────────────────────

@pytest.mark.asyncio
async def test_dns_proxy_localhost():
    """Resolve 'localhost' through the bridge — should return 127.0.0.1."""
    cap = _Capture()
    bridge = PicowNetBridge('test', cap, wifi_enabled=True)
    await bridge.start()

    query = DnsMessage(txid=0x1234, flags=0x0100, qd=[('localhost', 1, 1)])
    udp = UDP(src_port=12345, dst_port=53, payload=query.to_bytes())
    src_ip = ip_to_bytes(STA_IP)
    dst_ip = ip_to_bytes(GATEWAY_IP)
    ip = IPv4(
        protocol=IPPROTO_UDP, src=src_ip, dst=dst_ip,
        payload=udp.to_bytes(src_ip, dst_ip),
    )
    frame = Ethernet(GATEWAY_MAC, STA_MAC, ETHERTYPE_IPV4, ip.to_bytes()).to_bytes()
    await bridge.deliver_packet_out(frame)

    pkt = cap.latest_packet_in()
    assert pkt is not None
    rip = IPv4.parse(Ethernet.parse(pkt).payload)
    rudp = UDP.parse(rip.payload)
    resp = DnsMessage.parse(rudp.payload)
    assert resp.txid == 0x1234
    assert resp.flags & 0x8000     # response bit
    # localhost should always resolve, regardless of host config.
    assert any(rdata == b'\x7f\x00\x00\x01' for (_, _, _, _, rdata) in resp.an)


# ─── bridge — wifi disabled = silent drop ──────────────────────────

@pytest.mark.asyncio
async def test_wifi_disabled_silently_drops_packets():
    cap = _Capture()
    bridge = PicowNetBridge('test', cap, wifi_enabled=False)
    await bridge.start()

    await bridge.deliver_packet_out(_make_arp_request(STA_MAC, STA_IP, GATEWAY_IP))
    # No packets should have been injected.
    assert all(k != 'picow_packet_in' for k, _ in cap.events)
