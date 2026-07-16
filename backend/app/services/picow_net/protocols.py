"""
Layer-2/3/4 protocol parsers and encoders.

Pure-data dataclasses with `from_bytes` / `to_bytes`. No I/O, no async,
no network state — just bytes ↔ structs. This file is the reference
that every other module in this package depends on.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Optional

from .checksums import internet_checksum, tcp_udp_checksum
from .consts import (
    BROADCAST_MAC,
    ETHERTYPE_ARP,
    ETHERTYPE_IPV4,
    IPPROTO_ICMP,
    IPPROTO_TCP,
    IPPROTO_UDP,
)


# ─── Ethernet ────────────────────────────────────────────────────────

@dataclass
class Ethernet:
    dst: bytes
    src: bytes
    ethertype: int
    payload: bytes

    @classmethod
    def parse(cls, frame: bytes) -> 'Ethernet':
        if len(frame) < 14:
            raise ValueError(f'ethernet frame too short: {len(frame)}')
        return cls(
            dst=frame[0:6],
            src=frame[6:12],
            ethertype=(frame[12] << 8) | frame[13],
            payload=frame[14:],
        )

    def to_bytes(self) -> bytes:
        return self.dst + self.src + struct.pack('!H', self.ethertype) + self.payload


# ─── ARP ─────────────────────────────────────────────────────────────

@dataclass
class Arp:
    htype: int = 1                # Ethernet
    ptype: int = ETHERTYPE_IPV4
    hlen: int = 6
    plen: int = 4
    opcode: int = 1               # 1=request, 2=reply
    sha: bytes = b''              # sender hw addr
    spa: bytes = b''              # sender protocol (IP) addr
    tha: bytes = b''              # target hw addr
    tpa: bytes = b''              # target protocol addr

    @classmethod
    def parse(cls, payload: bytes) -> 'Arp':
        if len(payload) < 28:
            raise ValueError(f'ARP payload too short: {len(payload)}')
        htype, ptype, hlen, plen, opcode = struct.unpack('!HHBBH', payload[:8])
        sha = payload[8:14]
        spa = payload[14:18]
        tha = payload[18:24]
        tpa = payload[24:28]
        return cls(htype, ptype, hlen, plen, opcode, sha, spa, tha, tpa)

    def to_bytes(self) -> bytes:
        return (
            struct.pack('!HHBBH', self.htype, self.ptype, self.hlen, self.plen, self.opcode)
            + self.sha + self.spa + self.tha + self.tpa
        )


# ─── IPv4 ────────────────────────────────────────────────────────────

@dataclass
class IPv4:
    version: int = 4
    ihl: int = 5                  # 5 → 20-byte header (no options)
    dscp: int = 0
    ecn: int = 0
    total_length: int = 0         # populated in to_bytes
    ident: int = 0
    flags: int = 2                # Don't Fragment
    frag_offset: int = 0
    ttl: int = 64
    protocol: int = 0
    checksum: int = 0             # populated in to_bytes
    src: bytes = b'\x00\x00\x00\x00'
    dst: bytes = b'\x00\x00\x00\x00'
    payload: bytes = b''

    @classmethod
    def parse(cls, data: bytes) -> 'IPv4':
        if len(data) < 20:
            raise ValueError(f'IPv4 too short: {len(data)}')
        b0 = data[0]
        version = b0 >> 4
        ihl = b0 & 0x0f
        if ihl < 5:
            raise ValueError(f'bad IHL {ihl}')
        header_len = ihl * 4
        dscp_ecn = data[1]
        total_length = struct.unpack('!H', data[2:4])[0]
        ident = struct.unpack('!H', data[4:6])[0]
        flags_frag = struct.unpack('!H', data[6:8])[0]
        flags = flags_frag >> 13
        frag_offset = flags_frag & 0x1fff
        ttl = data[8]
        protocol = data[9]
        checksum = struct.unpack('!H', data[10:12])[0]
        src = data[12:16]
        dst = data[16:20]
        payload = data[header_len:total_length]
        return cls(
            version=version,
            ihl=ihl,
            dscp=dscp_ecn >> 2,
            ecn=dscp_ecn & 0x3,
            total_length=total_length,
            ident=ident,
            flags=flags,
            frag_offset=frag_offset,
            ttl=ttl,
            protocol=protocol,
            checksum=checksum,
            src=src,
            dst=dst,
            payload=payload,
        )

    def to_bytes(self) -> bytes:
        ihl = 5  # we never emit options
        total_length = ihl * 4 + len(self.payload)
        flags_frag = (self.flags << 13) | self.frag_offset
        dscp_ecn = (self.dscp << 2) | self.ecn

        # Header without checksum first
        header_no_cksum = struct.pack(
            '!BBHHHBBH4s4s',
            (4 << 4) | ihl,
            dscp_ecn,
            total_length,
            self.ident,
            flags_frag,
            self.ttl,
            self.protocol,
            0,
            self.src,
            self.dst,
        )
        cksum = internet_checksum(header_no_cksum)
        header = (
            header_no_cksum[:10]
            + struct.pack('!H', cksum)
            + header_no_cksum[12:]
        )
        return header + self.payload


# ─── TCP ─────────────────────────────────────────────────────────────

@dataclass
class TCP:
    src_port: int
    dst_port: int
    seq: int
    ack: int
    data_offset: int = 5          # 5 → 20-byte header
    flags: int = 0
    window: int = 0
    checksum: int = 0
    urg_ptr: int = 0
    options: bytes = b''
    payload: bytes = b''

    @classmethod
    def parse(cls, segment: bytes) -> 'TCP':
        if len(segment) < 20:
            raise ValueError(f'TCP too short: {len(segment)}')
        src_port, dst_port, seq, ack = struct.unpack('!HHII', segment[:12])
        off_flags = struct.unpack('!H', segment[12:14])[0]
        data_offset = (off_flags >> 12) & 0xf
        flags = off_flags & 0x1ff
        window = struct.unpack('!H', segment[14:16])[0]
        checksum = struct.unpack('!H', segment[16:18])[0]
        urg_ptr = struct.unpack('!H', segment[18:20])[0]
        header_len = data_offset * 4
        if header_len < 20 or header_len > len(segment):
            raise ValueError(f'bad TCP data_offset {data_offset}')
        options = segment[20:header_len]
        payload = segment[header_len:]
        return cls(
            src_port=src_port,
            dst_port=dst_port,
            seq=seq,
            ack=ack,
            data_offset=data_offset,
            flags=flags,
            window=window,
            checksum=checksum,
            urg_ptr=urg_ptr,
            options=options,
            payload=payload,
        )

    def to_bytes(self, src_ip: bytes, dst_ip: bytes) -> bytes:
        # Pad options to 4-byte boundary.
        opts = self.options
        if len(opts) % 4:
            opts = opts + b'\x00' * (4 - len(opts) % 4)
        data_offset = (20 + len(opts)) // 4
        off_flags = (data_offset << 12) | (self.flags & 0x1ff)
        header = struct.pack(
            '!HHIIHHHH',
            self.src_port,
            self.dst_port,
            self.seq & 0xffffffff,
            self.ack & 0xffffffff,
            off_flags,
            self.window,
            0,                       # checksum placeholder
            self.urg_ptr,
        )
        segment = header + opts + self.payload
        cksum = tcp_udp_checksum(src_ip, dst_ip, IPPROTO_TCP, segment)
        return segment[:16] + struct.pack('!H', cksum) + segment[18:]


def parse_tcp_options(opts: bytes) -> dict:
    """Parse TCP options into a {kind → value} dict. Handles MSS, NOP, EOL."""
    out: dict = {}
    i = 0
    while i < len(opts):
        kind = opts[i]
        if kind == 0:        # End of Option List
            break
        if kind == 1:        # NOP
            i += 1
            continue
        if i + 1 >= len(opts):
            break
        length = opts[i + 1]
        if length < 2 or i + length > len(opts):
            break
        value = opts[i + 2:i + length]
        if kind == 2 and length == 4:    # MSS
            out['mss'] = struct.unpack('!H', value)[0]
        elif kind == 3 and length == 3:  # Window Scale
            out['wscale'] = value[0]
        else:
            out[kind] = value
        i += length
    return out


# ─── UDP ─────────────────────────────────────────────────────────────

@dataclass
class UDP:
    src_port: int
    dst_port: int
    length: int = 0
    checksum: int = 0
    payload: bytes = b''

    @classmethod
    def parse(cls, segment: bytes) -> 'UDP':
        if len(segment) < 8:
            raise ValueError(f'UDP too short: {len(segment)}')
        src_port, dst_port, length, checksum = struct.unpack('!HHHH', segment[:8])
        return cls(src_port, dst_port, length, checksum, segment[8:length])

    def to_bytes(self, src_ip: bytes, dst_ip: bytes) -> bytes:
        length = 8 + len(self.payload)
        header = struct.pack('!HHHH', self.src_port, self.dst_port, length, 0)
        segment = header + self.payload
        cksum = tcp_udp_checksum(src_ip, dst_ip, IPPROTO_UDP, segment)
        # UDP checksum 0 is "no checksum" — RFC 768 says when computed
        # checksum is zero we send 0xffff to disambiguate.
        if cksum == 0:
            cksum = 0xffff
        return segment[:6] + struct.pack('!H', cksum) + segment[8:]


# ─── ICMP ────────────────────────────────────────────────────────────

@dataclass
class ICMP:
    type: int = 0
    code: int = 0
    checksum: int = 0
    rest: bytes = b'\x00\x00\x00\x00'  # ID + sequence for echo
    payload: bytes = b''

    @classmethod
    def parse(cls, segment: bytes) -> 'ICMP':
        if len(segment) < 8:
            raise ValueError(f'ICMP too short: {len(segment)}')
        type_, code, checksum = struct.unpack('!BBH', segment[:4])
        rest = segment[4:8]
        payload = segment[8:]
        return cls(type_, code, checksum, rest, payload)

    def to_bytes(self) -> bytes:
        header_no_cksum = struct.pack('!BBH', self.type, self.code, 0) + self.rest + self.payload
        cksum = internet_checksum(header_no_cksum)
        return header_no_cksum[:2] + struct.pack('!H', cksum) + header_no_cksum[4:]


# ─── DHCP ────────────────────────────────────────────────────────────
#
# Layout per RFC 2131. Only fields we actually inspect/emit:
#
#   op (1)  htype (1)  hlen (1)  hops (1)
#   xid (4)
#   secs (2)  flags (2)
#   ciaddr (4)  yiaddr (4)  siaddr (4)  giaddr (4)
#   chaddr (16)
#   sname (64)  file (128)
#   options (variable, prefixed by 4-byte magic cookie 0x63825363)

DHCP_MAGIC = b'\x63\x82\x53\x63'


@dataclass
class Dhcp:
    op: int                         # 1=BOOTREQUEST, 2=BOOTREPLY
    xid: int                        # transaction id
    flags: int = 0
    ciaddr: bytes = b'\x00\x00\x00\x00'
    yiaddr: bytes = b'\x00\x00\x00\x00'
    siaddr: bytes = b'\x00\x00\x00\x00'
    giaddr: bytes = b'\x00\x00\x00\x00'
    chaddr: bytes = b'\x00' * 16    # client hw addr (first 6 bytes are MAC)
    options: dict = field(default_factory=dict)  # {opt_code: value_bytes}

    @classmethod
    def parse(cls, payload: bytes) -> 'Dhcp':
        if len(payload) < 240:
            raise ValueError(f'DHCP too short: {len(payload)}')
        op = payload[0]
        xid = struct.unpack('!I', payload[4:8])[0]
        flags = struct.unpack('!H', payload[10:12])[0]
        ciaddr = payload[12:16]
        yiaddr = payload[16:20]
        siaddr = payload[20:24]
        giaddr = payload[24:28]
        chaddr = payload[28:44]
        if payload[236:240] != DHCP_MAGIC:
            raise ValueError('DHCP magic cookie missing')
        opts: dict = {}
        i = 240
        while i < len(payload):
            code = payload[i]
            if code == 0:           # pad
                i += 1; continue
            if code == 255:         # end
                break
            if i + 1 >= len(payload):
                break
            length = payload[i + 1]
            value = payload[i + 2:i + 2 + length]
            opts[code] = value
            i += 2 + length
        return cls(op, xid, flags, ciaddr, yiaddr, siaddr, giaddr, chaddr, opts)

    def to_bytes(self) -> bytes:
        head = struct.pack(
            '!BBBBIHH4s4s4s4s16s64s128s',
            self.op,
            1,                        # htype = Ethernet
            6,                        # hlen
            0,                        # hops
            self.xid,
            0,                        # secs
            self.flags,
            self.ciaddr,
            self.yiaddr,
            self.siaddr,
            self.giaddr,
            self.chaddr,
            b'',                      # sname
            b'',                      # file
        )
        opts = bytearray(DHCP_MAGIC)
        for code, value in self.options.items():
            opts.append(code)
            opts.append(len(value))
            opts.extend(value)
        opts.append(255)              # end
        return head + bytes(opts)


# ─── DNS (minimal — we only need to wrap a query/response) ───────────

@dataclass
class DnsMessage:
    txid: int
    flags: int
    qd: list                          # list of (qname, qtype, qclass)
    an: list = field(default_factory=list)  # answers (name, type, class, ttl, rdata)

    @classmethod
    def parse(cls, payload: bytes) -> 'DnsMessage':
        if len(payload) < 12:
            raise ValueError(f'DNS too short: {len(payload)}')
        txid, flags, qdcount, ancount, _nscount, _arcount = struct.unpack(
            '!HHHHHH', payload[:12]
        )
        qd: list = []
        offset = 12
        for _ in range(qdcount):
            qname, offset = _read_dns_name(payload, offset)
            qtype, qclass = struct.unpack('!HH', payload[offset:offset + 4])
            offset += 4
            qd.append((qname, qtype, qclass))
        an: list = []
        for _ in range(ancount):
            name, offset = _read_dns_name(payload, offset)
            atype, aclass, ttl, rdlength = struct.unpack(
                '!HHIH', payload[offset:offset + 10]
            )
            offset += 10
            rdata = payload[offset:offset + rdlength]
            offset += rdlength
            an.append((name, atype, aclass, ttl, rdata))
        return cls(txid=txid, flags=flags, qd=qd, an=an)

    def to_bytes(self) -> bytes:
        head = struct.pack(
            '!HHHHHH',
            self.txid,
            self.flags,
            len(self.qd),
            len(self.an),
            0,
            0,
        )
        body = bytearray()
        for qname, qtype, qclass in self.qd:
            body.extend(_write_dns_name(qname))
            body.extend(struct.pack('!HH', qtype, qclass))
        for name, atype, aclass, ttl, rdata in self.an:
            body.extend(_write_dns_name(name))
            body.extend(struct.pack('!HHIH', atype, aclass, ttl, len(rdata)))
            body.extend(rdata)
        return head + bytes(body)


def _read_dns_name(payload: bytes, offset: int) -> tuple[str, int]:
    """Parse a DNS name with simple compression-pointer support."""
    labels: list[str] = []
    seen_pointer = False
    return_offset = offset
    while offset < len(payload):
        length = payload[offset]
        if length == 0:
            offset += 1
            break
        if length & 0xc0 == 0xc0:
            # Pointer — top 2 bits set, next byte completes the offset.
            if not seen_pointer:
                return_offset = offset + 2
                seen_pointer = True
            offset = ((length & 0x3f) << 8) | payload[offset + 1]
            continue
        offset += 1
        labels.append(payload[offset:offset + length].decode('ascii', errors='replace'))
        offset += length
    if not seen_pointer:
        return_offset = offset
    return ('.'.join(labels), return_offset)


def _write_dns_name(name: str) -> bytes:
    out = bytearray()
    if name:
        for label in name.split('.'):
            if not label:
                continue
            data = label.encode('ascii', errors='replace')[:63]
            out.append(len(data))
            out.extend(data)
    out.append(0)
    return bytes(out)


# ─── Convenience: build a complete L2/L3/L4 frame ────────────────────

def make_frame_ipv4(
    dst_mac: bytes,
    src_mac: bytes,
    src_ip: bytes,
    dst_ip: bytes,
    protocol: int,
    l4_payload: bytes,
    ttl: int = 64,
    ident: int = 0,
) -> bytes:
    ipv4 = IPv4(
        protocol=protocol,
        src=src_ip,
        dst=dst_ip,
        ttl=ttl,
        ident=ident,
        payload=l4_payload,
    )
    return Ethernet(dst_mac, src_mac, ETHERTYPE_IPV4, ipv4.to_bytes()).to_bytes()


def make_frame_arp(
    dst_mac: bytes,
    src_mac: bytes,
    arp: Arp,
) -> bytes:
    return Ethernet(dst_mac, src_mac, ETHERTYPE_ARP, arp.to_bytes()).to_bytes()


__all__ = [
    'Ethernet', 'Arp', 'IPv4', 'TCP', 'UDP', 'ICMP', 'Dhcp', 'DnsMessage',
    'parse_tcp_options', 'make_frame_ipv4', 'make_frame_arp',
    'DHCP_MAGIC', 'BROADCAST_MAC',
    'IPPROTO_ICMP', 'IPPROTO_TCP', 'IPPROTO_UDP',
]
