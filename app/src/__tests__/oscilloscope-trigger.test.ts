/**
 * Oscilloscope trigger logic
 *
 * The trigger turns the otherwise free-running scope into something that
 * actually behaves like a digital storage scope — windows pin around
 * detected edges instead of scrolling away from sparse activity.  These
 * tests pin down the three modes (auto / normal / single), the three
 * edge selectors (rising / falling / either), and the re-arm flow.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useOscilloscopeStore,
  matchesTriggerEdge,
} from '../store/useOscilloscopeStore';

const initialState = useOscilloscopeStore.getState();

beforeEach(() => {
  useOscilloscopeStore.setState({
    ...initialState,
    channels: [],
    samples: {},
    triggerMode: 'auto',
    triggerChannelId: null,
    triggerEdge: 'rising',
    triggerPosition: 0.5,
    triggeredAtMs: null,
    triggerStatus: 'idle',
    running: true,
  });
});

describe('matchesTriggerEdge', () => {
  it('detects rising edges only when prev=LOW → new=HIGH', () => {
    expect(matchesTriggerEdge(false, true, 'rising')).toBe(true);
    expect(matchesTriggerEdge(true, false, 'rising')).toBe(false);
    expect(matchesTriggerEdge(false, false, 'rising')).toBe(false);
  });

  it('detects falling edges only when prev=HIGH → new=LOW', () => {
    expect(matchesTriggerEdge(true, false, 'falling')).toBe(true);
    expect(matchesTriggerEdge(false, true, 'falling')).toBe(false);
    expect(matchesTriggerEdge(true, true, 'falling')).toBe(false);
  });

  it('detects both directions when edge is either', () => {
    expect(matchesTriggerEdge(false, true, 'either')).toBe(true);
    expect(matchesTriggerEdge(true, false, 'either')).toBe(true);
    expect(matchesTriggerEdge(true, true, 'either')).toBe(false);
    expect(matchesTriggerEdge(false, false, 'either')).toBe(false);
  });
});

describe('pushSample under each trigger mode', () => {
  it('auto mode never sets triggeredAtMs', () => {
    const s = useOscilloscopeStore.getState();
    s.addChannel('uno-1', 1, 'D1');
    const chId = useOscilloscopeStore.getState().channels[0].id;

    s.pushSample(chId, 0, false);
    s.pushSample(chId, 1, true); // rising edge — auto ignores
    s.pushSample(chId, 2, false); // falling edge — auto ignores

    expect(useOscilloscopeStore.getState().triggeredAtMs).toBeNull();
    expect(useOscilloscopeStore.getState().samples[chId]).toHaveLength(3);
  });

  it('normal mode latches triggeredAtMs on the configured rising edge', () => {
    const s = useOscilloscopeStore.getState();
    s.addChannel('uno-1', 1, 'D1');
    const chId = useOscilloscopeStore.getState().channels[0].id;
    s.setTriggerMode('normal');

    s.pushSample(chId, 0, false); // first sample — no prior state, no trigger
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBeNull();
    s.pushSample(chId, 1, true);  // ↑ rising — trigger fires
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBe(1);
    expect(useOscilloscopeStore.getState().triggerStatus).toBe('triggered');
    s.pushSample(chId, 2, false); // ↓ falling — not "rising", no re-trigger
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBe(1);
    s.pushSample(chId, 3, true);  // ↑ rising — re-trigger to new time
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBe(3);
  });

  it('single-shot mode stops capture after the first triggering edge', () => {
    const s = useOscilloscopeStore.getState();
    s.addChannel('uno-1', 1, 'D1');
    const chId = useOscilloscopeStore.getState().channels[0].id;
    s.setTriggerMode('single');

    s.pushSample(chId, 0, false);
    s.pushSample(chId, 1, true);  // ↑ trigger → capture, freeze
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBe(1);
    expect(useOscilloscopeStore.getState().running).toBe(false);
    expect(useOscilloscopeStore.getState().triggerStatus).toBe('captured');

    // Further pushes are ignored (`running === false` early-exit + capture lock)
    s.pushSample(chId, 2, false);
    s.pushSample(chId, 3, true);
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBe(1);
    expect(useOscilloscopeStore.getState().samples[chId]).toHaveLength(2);
  });

  it('rearmTrigger resumes single-shot capture', () => {
    const s = useOscilloscopeStore.getState();
    s.addChannel('uno-1', 1, 'D1');
    const chId = useOscilloscopeStore.getState().channels[0].id;
    s.setTriggerMode('single');

    s.pushSample(chId, 0, false);
    s.pushSample(chId, 1, true); // capture
    expect(useOscilloscopeStore.getState().running).toBe(false);

    s.rearmTrigger();
    expect(useOscilloscopeStore.getState().running).toBe(true);
    expect(useOscilloscopeStore.getState().triggerStatus).toBe('armed');
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBeNull();

    s.pushSample(chId, 2, false);
    s.pushSample(chId, 3, true); // re-capture
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBe(3);
  });

  it('falling-edge selector ignores rising edges', () => {
    const s = useOscilloscopeStore.getState();
    s.addChannel('uno-1', 1, 'D1');
    const chId = useOscilloscopeStore.getState().channels[0].id;
    s.setTriggerMode('normal');
    s.setTriggerEdge('falling');

    s.pushSample(chId, 0, false);
    s.pushSample(chId, 1, true);   // rising — ignored
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBeNull();
    s.pushSample(chId, 2, false);  // falling — fires
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBe(2);
  });

  it('only the configured trigger channel fires the trigger', () => {
    const s = useOscilloscopeStore.getState();
    s.addChannel('uno-1', 1, 'D1');
    s.addChannel('uno-1', 13, 'D13');
    const [chD1, chD13] = useOscilloscopeStore.getState().channels.map((c) => c.id);
    s.setTriggerMode('normal');
    s.setTriggerChannel(chD13);

    s.pushSample(chD1, 0, false);
    s.pushSample(chD1, 1, true);  // edge on D1 — should NOT trigger (channel mismatch)
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBeNull();
    s.pushSample(chD13, 0, false);
    s.pushSample(chD13, 1, true); // edge on D13 — triggers
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBe(1);
  });

  it('removing the trigger channel falls back to the first remaining channel', () => {
    const s = useOscilloscopeStore.getState();
    s.addChannel('uno-1', 1, 'D1');
    s.addChannel('uno-1', 13, 'D13');
    const [chD1, chD13] = useOscilloscopeStore.getState().channels.map((c) => c.id);
    s.setTriggerMode('normal');
    s.setTriggerChannel(chD13);

    s.removeChannel(chD13);
    expect(useOscilloscopeStore.getState().triggerChannelId).toBeNull();

    // With triggerChannelId === null, the resolver falls back to the first
    // remaining channel (chD1) so rising edges on D1 now trigger.
    s.pushSample(chD1, 0, false);
    s.pushSample(chD1, 1, true);
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBe(1);
  });

  it('clearSamples re-arms the trigger', () => {
    const s = useOscilloscopeStore.getState();
    s.addChannel('uno-1', 1, 'D1');
    const chId = useOscilloscopeStore.getState().channels[0].id;
    s.setTriggerMode('normal');

    s.pushSample(chId, 0, false);
    s.pushSample(chId, 1, true);
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBe(1);

    s.clearSamples();
    expect(useOscilloscopeStore.getState().triggeredAtMs).toBeNull();
    expect(useOscilloscopeStore.getState().triggerStatus).toBe('armed');
    expect(useOscilloscopeStore.getState().samples[chId]).toHaveLength(0);
  });
});
