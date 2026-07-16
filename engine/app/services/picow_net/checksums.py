"""
RFC 1071 one's complement checksum + TCP/UDP pseudo-header helpers.

These are the only "tricky" bits in the stack — we implement them
deliberately and have unit tests against known IPv4 / TCP examples
from the RFCs.
"""

from __future__ import annotations

import struct


def ones_complement_sum(data: bytes) -> int:
    """RFC 1071 16-bit one's complement sum, returned BEFORE inversion."""
    if len(data) & 1:
        data = data + b'\x00'
    s = 0
    for hi, lo in zip(data[0::2], data[1::2]):
        s += (hi << 8) | lo
    while s >> 16:
        s = (s & 0xffff) + (s >> 16)
    return s


def internet_checksum(data: bytes) -> int:
    """Final checksum: invert the one's-complement sum."""
    return (~ones_complement_sum(data)) & 0xffff


def tcp_udp_pseudo_header(src_ip: bytes, dst_ip: bytes, protocol: int, length: int) -> bytes:
    """
    The pseudo-header that goes into TCP/UDP checksum but isn't
    transmitted. Per RFC 793 §3.1:

        src_ip (4)  dst_ip (4)  zero (1)  protocol (1)  length (2)
    """
    return src_ip + dst_ip + bytes([0, protocol]) + struct.pack('!H', length)


def tcp_udp_checksum(
    src_ip: bytes, dst_ip: bytes, protocol: int, segment: bytes
) -> int:
    """Compute the checksum field for a TCP or UDP segment."""
    pseudo = tcp_udp_pseudo_header(src_ip, dst_ip, protocol, len(segment))
    return internet_checksum(pseudo + segment)
