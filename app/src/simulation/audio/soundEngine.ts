/**
 * Shared audio output for parts that make sound (buzzers).
 *
 * One AudioContext for the whole app: browsers limit how many can exist, and
 * each costs memory. It is created on first use and unlocked on the first
 * user gesture (autoplay policy). Volume and mute are remembered per viewer.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'circuit-muse_sound';

interface SoundSettings {
  muted: boolean;
  volume: number; // 0..1
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
}

function loadSettings(): { muted: boolean; volume: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        muted: Boolean(parsed.muted),
        volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : 0.5,
      };
    }
  } catch {
    // Storage unavailable: use defaults.
  }
  return { muted: false, volume: 0.5 };
}

function saveSettings(muted: boolean, volume: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted, volume }));
  } catch {
    // Not persisted; the setting still applies for this session.
  }
}

export const useSoundSettings = create<SoundSettings>((set, get) => ({
  ...loadSettings(),
  setMuted: (muted) => {
    set({ muted });
    saveSettings(muted, get().volume);
    applyMasterGain();
  },
  setVolume: (volume) => {
    const v = Math.min(1, Math.max(0, volume));
    set({ volume: v });
    saveSettings(get().muted, v);
    applyMasterGain();
  },
}));

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlockInstalled = false;

/** Square waves are loud; keep the full-volume level comfortable. */
const MAX_GAIN = 0.15;

function masterLevel(): number {
  const { muted, volume } = useSoundSettings.getState();
  return muted ? 0 : volume * MAX_GAIN;
}

function applyMasterGain(): void {
  if (!ctx || !master) return;
  master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.02);
}

function installUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const unlock = () => {
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

function getContext(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === 'undefined') return null;
  const AudioCtor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null;
  if (!ctx) {
    try {
      ctx = new AudioCtor();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = masterLevel();
    master.connect(ctx.destination);
    installUnlock();
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return { ctx, master: master! };
}

/** A continuous tone source, e.g. one buzzer. */
export class ToneVoice {
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private frequency = 0;

  get playing(): boolean {
    return this.osc !== null;
  }

  /** Start or retune. Frequencies outside the audible range are ignored. */
  play(frequency: number, level = 1): void {
    if (!Number.isFinite(frequency) || frequency < 20 || frequency > 20_000) {
      this.stop();
      return;
    }
    const audio = getContext();
    if (!audio) return;
    const { ctx: c, master: m } = audio;
    if (!this.osc) {
      this.gain = c.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(m);
      this.osc = c.createOscillator();
      this.osc.type = 'square';
      this.osc.frequency.value = frequency;
      this.osc.connect(this.gain);
      this.osc.start();
      // Short fade-in avoids a click at the start of each beep.
      this.gain.gain.setTargetAtTime(Math.min(1, Math.max(0, level)), c.currentTime, 0.004);
    } else if (Math.abs(frequency - this.frequency) > 0.5) {
      this.osc.frequency.setTargetAtTime(frequency, c.currentTime, 0.003);
      this.gain?.gain.setTargetAtTime(Math.min(1, Math.max(0, level)), c.currentTime, 0.004);
    }
    this.frequency = frequency;
  }

  stop(): void {
    if (!this.osc || !ctx) {
      this.osc = null;
      return;
    }
    const osc = this.osc;
    const gain = this.gain;
    this.osc = null;
    this.gain = null;
    this.frequency = 0;
    const end = ctx.currentTime + 0.03;
    gain?.gain.setTargetAtTime(0, ctx.currentTime, 0.005);
    try {
      osc.stop(end);
    } catch {
      // Already stopped.
    }
    osc.onended = () => {
      osc.disconnect();
      gain?.disconnect();
    };
  }
}
