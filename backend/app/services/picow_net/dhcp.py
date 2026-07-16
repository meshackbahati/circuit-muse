"""
DHCP server — synthesises OFFER and ACK responses so MicroPython's
DHCP client receives a real handshake and ``wlan.ifconfig()`` returns
proper addresses.

We answer two messages:
  - DISCOVER  → OFFER  (with yiaddr=STA_IP, sets the lease)
  - REQUEST   → ACK    (confirms the lease)

Other DHCP messages (DECLINE, RELEASE, INFORM) are accepted but no
visible response — RELEASE just clears our (single-tenant) lease.

Per RFC 2131:
  - server identifier (option 54) = GATEWAY_IP
  - subnet mask       (option 1)  = 255.255.255.0
  - router            (option 3)  = GATEWAY_IP
  - DNS servers       (option 6)  = DNS_IP
  - lease time        (option 51) = DHCP_LEASE_SECONDS
"""

from __future__ import annotations

import struct
from typing import Optional

from .consts import (
    DHCP_ACK,
    DHCP_DISCOVER,
    DHCP_LEASE_SECONDS,
    DHCP_OFFER,
    DHCP_REQUEST,
    DNS_IP,
    GATEWAY_IP,
    GATEWAY_MAC,
    STA_IP,
    ip_to_bytes,
)
from .protocols import (
    BROADCAST_MAC,
    Dhcp,
    UDP,
    make_frame_ipv4,
)


# DHCP option codes
OPT_SUBNET_MASK = 1
OPT_ROUTER = 3
OPT_DNS = 6
OPT_HOSTNAME = 12
OPT_REQUESTED_IP = 50
OPT_LEASE_TIME = 51
OPT_MESSAGE_TYPE = 53
OPT_SERVER_ID = 54
OPT_PARAMETER_REQUEST_LIST = 55
OPT_RENEWAL_TIME = 58
OPT_REBINDING_TIME = 59
OPT_END = 255


class DhcpServer:
    """One instance per simulated chip — single-tenant network."""

    def __init__(self) -> None:
        self.lease_active = False

    def handle(
        self,
        chip_mac: bytes,
        udp: UDP,
    ) -> Optional[tuple[bytes, bytes, UDP]]:
        """
        Returns (dst_ip, src_ip, response_udp) or None.
        Caller wraps in IPv4+Ethernet using GATEWAY_MAC as src.
        """
        try:
            req = Dhcp.parse(udp.payload)
        except ValueError:
            return None
        if req.op != 1:                # not BOOTREQUEST
            return None
        msg_type_bytes = req.options.get(OPT_MESSAGE_TYPE, b'')
        if not msg_type_bytes:
            return None
        msg_type = msg_type_bytes[0]

        if msg_type == DHCP_DISCOVER:
            return self._build_response(req, DHCP_OFFER, chip_mac)
        if msg_type == DHCP_REQUEST:
            self.lease_active = True
            return self._build_response(req, DHCP_ACK, chip_mac)
        # DECLINE / RELEASE / INFORM — ignored.
        return None

    def _build_response(
        self,
        req: Dhcp,
        msg_type: int,
        chip_mac: bytes,
    ) -> tuple[bytes, bytes, UDP]:
        gw_ip = ip_to_bytes(GATEWAY_IP)
        sta_ip = ip_to_bytes(STA_IP)
        dns_ip = ip_to_bytes(DNS_IP)
        lease_secs = DHCP_LEASE_SECONDS

        resp = Dhcp(
            op=2,                     # BOOTREPLY
            xid=req.xid,
            flags=req.flags,
            ciaddr=req.ciaddr,
            yiaddr=sta_ip,
            siaddr=gw_ip,
            giaddr=req.giaddr,
            chaddr=chip_mac.ljust(16, b'\x00'),
            options={
                OPT_MESSAGE_TYPE: bytes([msg_type]),
                OPT_SERVER_ID: gw_ip,
                OPT_LEASE_TIME: struct.pack('!I', lease_secs),
                OPT_RENEWAL_TIME: struct.pack('!I', lease_secs // 2),
                OPT_REBINDING_TIME: struct.pack('!I', (lease_secs * 7) // 8),
                OPT_SUBNET_MASK: bytes([255, 255, 255, 0]),
                OPT_ROUTER: gw_ip,
                OPT_DNS: dns_ip,
            },
        )
        # DHCP responses go from server (gateway, port 67) to client
        # (broadcast or unicast STA, port 68).
        out_udp = UDP(
            src_port=67,
            dst_port=68,
            payload=resp.to_bytes(),
        )
        return sta_ip, gw_ip, out_udp


def is_dhcp_traffic(udp: UDP) -> bool:
    return udp.dst_port == 67 or udp.src_port == 67


def make_dhcp_frame(
    chip_mac: bytes,
    src_ip: bytes,
    dst_ip: bytes,
    udp: UDP,
    use_broadcast_dst: bool = True,
) -> bytes:
    """Wrap a DHCP UDP segment in IPv4 + Ethernet for delivery to the chip."""
    dst_mac = BROADCAST_MAC if use_broadcast_dst else chip_mac
    return make_frame_ipv4(
        dst_mac=dst_mac,
        src_mac=GATEWAY_MAC,
        src_ip=src_ip,
        dst_ip=dst_ip,
        protocol=17,                  # UDP
        l4_payload=udp.to_bytes(src_ip, dst_ip),
    )
