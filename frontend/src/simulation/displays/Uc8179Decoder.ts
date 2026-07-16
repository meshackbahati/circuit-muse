/**
 * Uc8179Decoder — UltraChip UC8179 / GD7965, the MONO controller behind the
 * 7.5" 800x480 Waveshare / GoodDisplay panels (GxEPD2_750_T7).
 *
 * Same command FAMILY as the UC8159c (0x10/0x13 DTM, 0x12 refresh) but 1 bit
 * per pixel (8 px/byte) with a partial window (0x90). GxEPD2 writes the VISIBLE
 * image to 0x13 (DTM2 "current"); 0x10 is the "previous" buffer (ignored).
 *
 * Each image write is framed:
 *   0x91 partial-in, 0x90 window (x0/x1/y0/y1 px, MSB-first, byte-aligned x),
 *   0x13 + row-major 1bpp data, 0x92 partial-out.
 * Latches on 0x12 DISPLAY_REFRESH. `0xFF is white` per the driver, so a set bit
 * is white. Data lands at ABSOLUTE pixel coords inside the window, so compose
 * is just the RAM (no rotation, no window-union). The composed Frame reuses the
 * SSD168x palette (0=black, 1=white) so the same paintFrame() renders it.
 */

import type { Frame } from './SSD168xDecoder';

export const UC8179_CMD_POWER_OFF       = 0x02;
export const UC8179_CMD_POWER_ON        = 0x04;
export const UC8179_CMD_DEEP_SLEEP      = 0x07;
export const UC8179_CMD_DTM1            = 0x10; // previous/old buffer (ignored)
export const UC8179_CMD_DISPLAY_REFRESH = 0x12;
export const UC8179_CMD_DTM2            = 0x13; // current/new image (visible)
export const UC8179_CMD_PARTIAL_WINDOW  = 0x90;

export interface Uc8179DecoderOptions {
  width: number;
  height: number;
  onFlush?: (frame: Frame) => void;
}

export class Uc8179Decoder {
  readonly width: number;
  readonly height: number;
  /** width*height palette indices (0=black, 1=white), default white. */
  ram: Uint8Array;

  private currentCmd = -1;
  private params: number[] = [];
  private activeVisible = false; // true while streaming 0x13 (DTM2)
  private winX0 = 0;
  private winX1 = 0;
  private winY0 = 0;
  private winY1 = 0;
  private cx = 0;
  private cy = 0;

  refreshedCount = 0;
  unknownCmds: number[] = [];
  inDeepSleep = false;

  private readonly onFlush?: (frame: Frame) => void;

  constructor(opts: Uc8179DecoderOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.ram = new Uint8Array(opts.width * opts.height).fill(1); // white
    this.winX1 = opts.width - 1;
    this.winY1 = opts.height - 1;
    this.onFlush = opts.onFlush;
  }

  feed(byte: number, dcHigh: boolean): void {
    if (!dcHigh) this.beginCommand(byte & 0xff);
    else this.handleData(byte & 0xff);
  }

  reset(): void {
    this.ram.fill(1);
    this.currentCmd = -1;
    this.params = [];
    this.activeVisible = false;
    this.winX0 = 0;
    this.winX1 = this.width - 1;
    this.winY0 = 0;
    this.winY1 = this.height - 1;
    this.cx = 0;
    this.cy = 0;
    this.inDeepSleep = false;
  }

  composeFrame(): Frame {
    return { width: this.width, height: this.height, pixels: this.ram.slice() };
  }

  private beginCommand(cmd: number): void {
    this.currentCmd = cmd;
    this.params = [];
    if (cmd === UC8179_CMD_DTM2) {
      this.activeVisible = true;
      this.cx = this.winX0;
      this.cy = this.winY0;
      return;
    }
    if (cmd === UC8179_CMD_DTM1) {
      this.activeVisible = false; // old buffer — ignore its data
      return;
    }
    if (cmd === UC8179_CMD_DISPLAY_REFRESH) {
      this.refreshedCount += 1;
      this.onFlush?.(this.composeFrame());
      return;
    }
    // 0x90 + init commands consume data in handleData; others are no-ops.
  }

  private handleData(byte: number): void {
    const cmd = this.currentCmd;
    this.params.push(byte);
    if (cmd === UC8179_CMD_DEEP_SLEEP) {
      if (byte === 0xa5) this.inDeepSleep = true;
      return;
    }
    if (cmd === UC8179_CMD_PARTIAL_WINDOW && this.params.length === 9) {
      const p = this.params;
      this.winX0 = (p[0] << 8) | p[1];
      this.winX1 = (p[2] << 8) | p[3];
      this.winY0 = (p[4] << 8) | p[5];
      this.winY1 = (p[6] << 8) | p[7];
      return;
    }
    if (cmd === UC8179_CMD_DTM2 && this.activeVisible) {
      this.writeImageByte(byte);
    }
  }

  private writeImageByte(byte: number): void {
    // 8 px, MSB = leftmost. bit=1 -> white(1), bit=0 -> black(0).
    const w = this.width;
    const cy = this.cy;
    if (cy >= 0 && cy < this.height) {
      const base = cy * w;
      for (let k = 0; k < 8; k++) {
        const x = this.cx + k;
        if (x >= this.winX0 && x <= this.winX1 && x >= 0 && x < w) {
          this.ram[base + x] = byte & (0x80 >> k) ? 1 : 0;
        }
      }
    }
    this.cx += 8;
    if (this.cx > this.winX1) {
      this.cx = this.winX0;
      this.cy += 1;
    }
  }
}
