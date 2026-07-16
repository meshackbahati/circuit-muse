"""
picow_net — Userspace network stack for Velxio's Pico W emulator.

Public surface is the ``PicowNetBridge`` class. Everything else
(``protocols``, ``tcp_nat``, ``udp_nat``, ``arp``, ``dhcp``,
``dns``, ``icmp``) is an implementation detail.

See:
  - docs/PICO_W_WIFI_EMULATION.md
  - docs/wiki/picow-cyw43-emulation.md
  - test/backend/integration/test_picow_net_bridge.py
"""

from .bridge import PicowNetBridge

__all__ = ['PicowNetBridge']
