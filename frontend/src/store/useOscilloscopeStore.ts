/**
 * Oscilloscope / Logic Analyzer store.
 *
 * Captures pin HIGH/LOW transitions with microsecond-level timestamps
 * derived from the CPU cycle counter and renders them as waveforms.
 *
 * Channels are keyed by (boardId, pin) so multiple boards with the same
 * logical pin number can be monitored independently.
 *
 * Trigger model — matches a real digital storage scope:
 *
 *   - `auto`   free-running display; the window's right edge tracks the
 *              latest sample.  This is the default and the behaviour
 *              existing test suites depend on.
 *
 *   - `normal` window pins around each triggering edge: the trigger
 *              event lands at `triggerPosition * windowMs` from the
 *              left, with the rest of the window showing post-trigger
 *              samples.  The window holds steady until the next edge.
 *
 *   - `single` arms once: on the first triggering edge after arming the
 *              scope captures, then sets `running = false` so the trace
 *              freezes for inspection.  User must click "Single" again
 *              to re-arm.
 *
 * Edge detection looks at the configured trigger channel only.  The
 * trigger fires when the newly-pushed sample's state differs from the
 * previous one on that channel AND the transition matches the configured
 * `triggerEdge` (rising / falling / either).
 */

import { create } from 'zustand';

export const MAX_SAMPLES = 10_000;

/** Distinct colors cycled through when adding new channels */
export const CHANNEL_COLORS = [
  '#00ff41',
  '#ff6b6b',
  '#4fc3f7',
  '#ffd54f',
  '#ce93d8',
  '#80cbc4',
  '#ffb74d',
  '#f06292',
];

export interface OscChannel {
  id: string;
  /** Board that owns this channel */
  boardId: string;
  pin: number;
  label: string;
  color: string;
}

export interface OscSample {
  /** Time in milliseconds from simulation start */
  timeMs: number;
  state: boolean;
}

export type TriggerMode = 'auto' | 'normal' | 'single';
export type TriggerEdge = 'rising' | 'falling' | 'either';
export type TriggerStatus = 'idle' | 'armed' | 'triggered' | 'captured';

interface OscilloscopeState {
  /** Whether the panel is visible */
  open: boolean;
  /** Whether capture is active (pause/resume independently of simulation) */
  running: boolean;
  /** Milliseconds per horizontal division (10 divisions shown) */
  timeDivMs: number;
  /** Channels currently monitored */
  channels: OscChannel[];
  /** Circular sample buffers keyed by channel id */
  samples: Record<string, OscSample[]>;

  // ── Trigger ───────────────────────────────────────────────────────────────
  triggerMode: TriggerMode;
  /** Channel that triggers the scope. `null` = first channel; reset on remove. */
  triggerChannelId: string | null;
  triggerEdge: TriggerEdge;
  /**
   * Fraction (0..1) of the visible window where the trigger event lands.
   * 0   = trigger at the left edge (all post-trigger samples)
   * 0.5 = trigger at the centre (default, equal pre and post)
   * 1   = trigger at the right edge (all pre-trigger samples)
   */
  triggerPosition: number;
  /** Simulator time of the most-recently latched trigger, or `null` when
   *  the scope is armed and waiting for an edge. */
  triggeredAtMs: number | null;
  /** Status surface for the UI badge. */
  triggerStatus: TriggerStatus;

  // ── Actions ────────────────────────────────────────────────────────────────

  toggleOscilloscope: () => void;
  setCapturing: (running: boolean) => void;
  setTimeDivMs: (ms: number) => void;
  addChannel: (boardId: string, pin: number, pinLabel: string) => void;
  removeChannel: (id: string) => void;
  /** Push one sample; drops the oldest if the buffer is full */
  pushSample: (channelId: string, timeMs: number, state: boolean) => void;
  clearSamples: () => void;

  setTriggerMode: (mode: TriggerMode) => void;
  setTriggerChannel: (channelId: string | null) => void;
  setTriggerEdge: (edge: TriggerEdge) => void;
  setTriggerPosition: (pos: number) => void;
  /** Reset the trigger (re-arm for single-shot, clear "triggered" status). */
  rearmTrigger: () => void;
}

/**
 * Test whether a new sample's state vs. the previous state constitutes a
 * triggering edge under the configured edge mode.  Exported so the
 * trigger logic can be unit-tested in isolation.
 */
export function matchesTriggerEdge(prevState: boolean, newState: boolean, edge: TriggerEdge): boolean {
  if (prevState === newState) return false;
  if (edge === 'either') return true;
  if (edge === 'rising' && !prevState && newState) return true;
  if (edge === 'falling' && prevState && !newState) return true;
  return false;
}

/**
 * Resolve the channel id the trigger should listen on.  If the user
 * hasn't explicitly picked one (or picked one that's since been removed),
 * fall back to the first channel — the most common single-channel case.
 */
function resolveTriggerChannelId(
  triggerChannelId: string | null,
  channels: OscChannel[],
): string | null {
  if (triggerChannelId && channels.some((c) => c.id === triggerChannelId)) {
    return triggerChannelId;
  }
  return channels[0]?.id ?? null;
}

export const useOscilloscopeStore = create<OscilloscopeState>((set, get) => ({
  open: false,
  running: true,
  timeDivMs: 1,
  channels: [],
  samples: {},

  triggerMode: 'auto',
  triggerChannelId: null,
  triggerEdge: 'rising',
  triggerPosition: 0.5,
  triggeredAtMs: null,
  triggerStatus: 'idle',

  toggleOscilloscope: () => set((s) => ({ open: !s.open })),

  setCapturing: (running) => set({ running }),

  setTimeDivMs: (ms) => set({ timeDivMs: ms }),

  addChannel: (boardId: string, pin: number, pinLabel: string) => {
    const { channels } = get();
    // Deduplicate by (boardId, pin)
    if (channels.some((c) => c.boardId === boardId && c.pin === pin)) return;

    const id = `osc-ch-${boardId}-${pin}`;
    const color = CHANNEL_COLORS[channels.length % CHANNEL_COLORS.length];

    set((s) => ({
      channels: [...s.channels, { id, boardId, pin, label: pinLabel, color }],
      samples: { ...s.samples, [id]: [] },
    }));
  },

  removeChannel: (id) => {
    set((s) => {
      const { [id]: _removed, ...rest } = s.samples;
      // If the removed channel was the trigger source, fall back to the
      // first remaining channel via the resolver — keeps the trigger
      // working without forcing the user to re-pick.
      const remainingChannels = s.channels.filter((c) => c.id !== id);
      const nextTriggerCh =
        s.triggerChannelId === id ? null : s.triggerChannelId;
      return {
        channels: remainingChannels,
        samples: rest,
        triggerChannelId: nextTriggerCh,
      };
    });
  },

  pushSample: (channelId, timeMs, state) => {
    const s = get();
    if (!s.running) return;

    const buf = s.samples[channelId];
    if (!buf) return;

    // Trigger detection happens BEFORE we mutate the buffer so we can
    // peek at the previous state on the trigger channel.  Auto mode
    // skips this entirely — the scope free-runs.
    let nextTriggeredAtMs = s.triggeredAtMs;
    let nextRunning = s.running;
    let nextStatus = s.triggerStatus;

    if (s.triggerMode !== 'auto') {
      const triggerChId = resolveTriggerChannelId(s.triggerChannelId, s.channels);
      if (triggerChId === channelId) {
        const triggerBuf = s.samples[triggerChId];
        if (triggerBuf && triggerBuf.length > 0) {
          const prevState = triggerBuf[triggerBuf.length - 1].state;
          const single = s.triggerMode === 'single';
          // Single-shot: once we've captured (status === 'captured'),
          // ignore further edges until the user explicitly re-arms.
          const captureLocked = single && s.triggerStatus === 'captured';
          if (!captureLocked && matchesTriggerEdge(prevState, state, s.triggerEdge)) {
            nextTriggeredAtMs = timeMs;
            if (single) {
              nextRunning = false;
              nextStatus = 'captured';
            } else {
              nextStatus = 'triggered';
            }
          }
        }
      }
    }

    set((cur) => {
      const curBuf = cur.samples[channelId];
      if (!curBuf) return cur;
      const next = curBuf.slice();
      if (next.length >= MAX_SAMPLES) next.shift();
      next.push({ timeMs, state });
      return {
        samples: { ...cur.samples, [channelId]: next },
        ...(nextTriggeredAtMs !== cur.triggeredAtMs ? { triggeredAtMs: nextTriggeredAtMs } : {}),
        ...(nextRunning !== cur.running ? { running: nextRunning } : {}),
        ...(nextStatus !== cur.triggerStatus ? { triggerStatus: nextStatus } : {}),
      };
    });
  },

  clearSamples: () => {
    const { channels } = get();
    const fresh: Record<string, OscSample[]> = {};
    channels.forEach((c) => {
      fresh[c.id] = [];
    });
    set({
      samples: fresh,
      triggeredAtMs: null,
      // Clearing samples re-arms whatever mode we're in.
      triggerStatus: get().triggerMode === 'auto' ? 'idle' : 'armed',
    });
  },

  setTriggerMode: (mode) => {
    set((s) => ({
      triggerMode: mode,
      // Switching modes is implicitly a re-arm — drop any latched trigger
      // and set the status appropriate to the new mode.
      triggeredAtMs: null,
      triggerStatus: mode === 'auto' ? 'idle' : 'armed',
      // If switching to a capture mode while paused, resume capture so
      // the next edge can land.  The user can pause manually after if
      // they want.
      running: mode === 'auto' ? s.running : true,
    }));
  },

  setTriggerChannel: (channelId) => {
    set({
      triggerChannelId: channelId,
      triggeredAtMs: null,
      triggerStatus: get().triggerMode === 'auto' ? 'idle' : 'armed',
    });
  },

  setTriggerEdge: (edge) => {
    set({
      triggerEdge: edge,
      triggeredAtMs: null,
      triggerStatus: get().triggerMode === 'auto' ? 'idle' : 'armed',
    });
  },

  setTriggerPosition: (pos) => {
    set({ triggerPosition: Math.max(0, Math.min(1, pos)) });
  },

  rearmTrigger: () => {
    set((s) => ({
      triggeredAtMs: null,
      triggerStatus: s.triggerMode === 'auto' ? 'idle' : 'armed',
      running: true,
    }));
  },
}));
