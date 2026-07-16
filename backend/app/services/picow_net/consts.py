"""
Network parameters for Velxio's Pico W virtual network.

The simulated STA lives on its own /24 ("10.13.37.0/24") with a
synthetic gateway at .1 and the chip at .42 (the same address the
frontend's virtual_ap.ts hands out — these MUST stay in sync).

All MAC addresses use the locally-administered prefix `02:42:DA:…`.
"""

from __future__ import annotations

# ── L3 ────────────────────────────────────────────────────────────────
SUBNET = '10.13.37.0/24'
NETMASK = '255.255.255.0'
GATEWAY_IP = '10.13.37.1'
DNS_IP = '10.13.37.1'
STA_IP = '10.13.37.42'
BROADCAST_IP = '10.13.37.255'

# ── L2 ────────────────────────────────────────────────────────────────
# Must match frontend/src/simulation/cyw43/virtual-ap.ts.
STA_MAC = bytes.fromhex('0242da000042')
GATEWAY_MAC = bytes.fromhex('0242da42ffff')
BROADCAST_MAC = b'\xff\xff\xff\xff\xff\xff'

# ── Tunables ─────────────────────────────────────────────────────────
# Maximum Transmission Unit. lwIP on Pico W defaults to 1500.
MTU = 1500

# TCP send/receive buffer windows we advertise. 64 KiB is the largest
# value representable in a single 16-bit window field — anything larger
# would need window scaling, which not every MicroPython version
# supports cleanly.
TCP_WINDOW = 65535

# Maximum Segment Size we advertise during SYN/ACK. Must be MTU - 40
# (20 IPv4 header + 20 TCP header).
TCP_MSS = MTU - 40  # 1460

# DHCP lease length we hand out (seconds).
DHCP_LEASE_SECONDS = 86400

# How long an idle TCP connection survives before we collect it.
TCP_IDLE_TIMEOUT = 600.0

# ── Ethertypes ───────────────────────────────────────────────────────
ETHERTYPE_IPV4 = 0x0800
ETHERTYPE_ARP = 0x0806
ETHERTYPE_IPV6 = 0x86dd

# ── IPv4 protocol numbers ────────────────────────────────────────────
IPPROTO_ICMP = 1
IPPROTO_TCP = 6
IPPROTO_UDP = 17

# ── TCP flag bits ────────────────────────────────────────────────────
TCP_FIN = 0x01
TCP_SYN = 0x02
TCP_RST = 0x04
TCP_PSH = 0x08
TCP_ACK = 0x10
TCP_URG = 0x20

# ── ARP opcodes ──────────────────────────────────────────────────────
ARP_REQUEST = 1
ARP_REPLY = 2

# ── ICMP types ───────────────────────────────────────────────────────
ICMP_ECHO_REPLY = 0
ICMP_ECHO_REQUEST = 8
ICMP_DEST_UNREACHABLE = 3

# ── DHCP message types ───────────────────────────────────────────────
DHCP_DISCOVER = 1
DHCP_OFFER = 2
DHCP_REQUEST = 3
DHCP_DECLINE = 4
DHCP_ACK = 5
DHCP_NAK = 6
DHCP_RELEASE = 7
DHCP_INFORM = 8


def ip_to_bytes(ip: str) -> bytes:
    """Dotted-quad → 4-byte big-endian."""
    return bytes(int(p) for p in ip.split('.'))


def bytes_to_ip(b: bytes) -> str:
    return '.'.join(str(x) for x in b)
