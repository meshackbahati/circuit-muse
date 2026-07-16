/**
 * virtual_ap
 *
 * Synthetic access point that the emulated CYW43 advertises to scans
 * and accepts joins from. Mirrors the role of slirp's virtual NIC on
 * the ESP32 path — the simulated board sees a real-looking AP and
 * gets an IP, while traffic above L2 is bridged out by Velxio.
 *
 * SSID and BSSID are deliberately Velxio-namespaced ("Velxio-GUEST"
 * with a locally-administered MAC) so this code carries no Wokwi
 * marks. If you fork Velxio and want a different default, change
 * DEFAULT_AP — every test/example uses this single source of truth.
 */

export interface VirtualAp {
  ssid: string;
  /** 6-byte MAC. Bit 1 of the first byte is set → locally-administered. */
  bssid: Uint8Array;
  /** 2.4 GHz channel (1-13). */
  channel: number;
  /** Receive signal strength to advertise, in dBm (negative). */
  rssi: number;
  /** True if the AP requires a passphrase. We accept any password. */
  secured: boolean;
}

/** The default AP every Pico W simulation joins. */
export const DEFAULT_AP: VirtualAp = {
  ssid: 'Velxio-GUEST',
  // 02:42:DA:42:00:01 — locally-administered, "DA" mnemonic = David / Velxio.
  bssid: new Uint8Array([0x02, 0x42, 0xda, 0x42, 0x00, 0x01]),
  channel: 6,
  rssi: -40,
  secured: false,
};

/** The MAC address the emulated chip presents as its own. */
export const DEFAULT_STA_MAC = new Uint8Array([0x02, 0x42, 0xda, 0x00, 0x00, 0x42]);

/** The IP address the emulated DHCP server hands out to the STA. */
export const DEFAULT_STA_IP = '10.13.37.42';
export const DEFAULT_GATEWAY = '10.13.37.1';
export const DEFAULT_NETMASK = '255.255.255.0';
export const DEFAULT_DNS = '10.13.37.1';

/**
 * Build the BSS-info blob that the chip would deliver in a
 * WLC_E_ESCAN_RESULT event for ``ap``. Layout follows the wl_bss_info
 * struct (version 109 / 0x6D) — fields the host driver actually reads
 * are populated; reserved fields are zero.
 */
export function bssInfoBlob(ap: VirtualAp): Uint8Array {
  // Sized for version 109 minimum (~0x180 bytes). Pad to 384 so any
  // optional IE region fits without overrun.
  const total = 384;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);

  let off = 0;
  dv.setUint32(off, 109, true); off += 4;             // version
  dv.setUint32(off, total, true); off += 4;           // length
  buf.set(ap.bssid, off); off += 6;                   // bssid
  dv.setUint16(off, 100, true); off += 2;             // beacon_period (TUs)
  dv.setUint16(off, 0x0421, true); off += 2;          // capability — ESS + Privacy if secured
  if (!ap.secured) buf[off - 1] &= ~0x10;
  // SSID
  const ssidBytes = new TextEncoder().encode(ap.ssid);
  buf[off] = ssidBytes.length; off += 1;              // ssid_len
  buf.set(ssidBytes.subarray(0, 32), off); off += 32; // ssid (zero-padded)
  // Rates
  dv.setUint32(off, 8, true); off += 4;               // nrates
  // 1, 2, 5.5, 11, 6, 12, 18, 24 Mbps × 2 (in 500 kbps units)
  buf.set([0x82, 0x84, 0x8b, 0x96, 0x0c, 0x18, 0x30, 0x60], off);
  off += 16;
  dv.setUint16(off, ap.channel, true); off += 2;      // channel
  dv.setUint16(off, 0, true); off += 2;               // atim_window
  buf[off] = 1; off += 1;                             // dtim_period
  dv.setInt16(off, ap.rssi, true); off += 2;          // rssi (signed)
  buf[off] = -90; off += 1;                           // phy_noise (signed)
  buf[off] = 1; off += 1;                             // n_cap (HT)
  dv.setUint32(off, 0, true); off += 4;               // nbss_cap
  buf[off] = ap.channel; off += 1;                    // ctl_ch
  off += 4;                                           // reserved32
  buf[off] = 0; off += 1;                             // flags
  off += 3;                                           // reserved[3]
  // basic_mcs[16], ie_offset, ie_length, …  — leave zero, total length
  // already declared above.
  return buf;
}

/** Helper: parse a 6-byte MAC into "aa:bb:cc:dd:ee:ff" for tests/logs. */
export function formatMac(mac: Uint8Array): string {
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join(':');
}
