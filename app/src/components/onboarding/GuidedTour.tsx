/**
 * First-run guided tour of the editor.
 *
 * Highlights one part of the workspace at a time with a short explanation.
 * Steps whose target is not on screen (for example in Code-only view or on a
 * narrow window) are skipped. The spotlight is a single element with a large
 * box-shadow, so it stays cheap on machines without GPU compositing.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { lastSeenTourVersion, markTourDone } from './tourStorage';
import './GuidedTour.css';

interface TourStep {
  /** CSS selector of the element to highlight; omit for a centred card. */
  target?: string;
  title: string;
  body: string;
  /** Tour version that introduced the step (default 1). */
  since?: number;
}

const STEPS: TourStep[] = [
  {
    title: 'Welcome to CircuitMuse',
    body: 'Build a circuit, write the code for it and run it, all on your computer. This short tour shows where everything is.',
  },
  {
    target: '.view-mode-toggle',
    title: 'Choose your view',
    body: 'Show only the code, only the circuit, or both side by side.',
  },
  {
    target: '.file-explorer',
    title: 'Your files',
    body: 'Each board has its own files. sketch.ino is the program that runs on the board.',
  },
  {
    target: '.editor-panel',
    title: 'Write code',
    body: 'Edit the program here. Arduino C++ and MicroPython are supported, depending on the board.',
  },
  {
    target: '.board-selector',
    title: 'Pick the board',
    body: 'When a circuit has more than one board, choose which one you are editing and compiling.',
  },
  {
    target: '.add-component-btn',
    title: 'Add parts',
    body: 'Add LEDs, buttons, sensors, displays, motors and more from the parts library.',
  },
  {
    target: '.simulator-panel',
    title: 'Build the circuit',
    body: 'Drag parts to move them. Click a pin and then another pin to draw a wire. Scroll to zoom.',
  },
  {
    target: '.tb-btn-compile',
    title: 'Compile',
    body: 'Checks your code and builds it for the selected board. Errors appear in the output console.',
  },
  {
    target: '.tb-btn-run',
    title: 'Run the simulation',
    body: 'Starts the board so the circuit comes alive. The square button next to it stops it.',
  },
  {
    target: '[data-tour="serial"]',
    title: 'Serial monitor',
    body: 'See what your program prints with Serial.print, and type messages back to the board.',
  },
  {
    target: '[data-tour="scope"]',
    title: 'Oscilloscope',
    body: 'Watch the signal on any pin over time, with frequency and duty cycle readouts.',
  },
  {
    since: 3,
    target: '.schematic-toggle',
    title: 'Schematic view',
    body: 'See the circuit as a schematic, drawn automatically from your wiring. Export it to KiCad to design a PCB.',
  },
  {
    target: '[data-tour="sound"]',
    since: 2,
    title: 'Sound',
    body: 'Buzzers play while the simulation runs: tone() at its real pitch, a pin held HIGH as a beep. Turn sound on or off here.',
  },
  {
    target: '[data-tour="flash"]',
    since: 2,
    title: 'Flash a real board',
    body: 'After compiling, plug in a board by USB and send the program to it. ESP32, Arduino and Pico boards are supported.',
  },
  {
    target: '[data-tour="agent"]',
    title: 'AI assistant',
    body: 'Describe what you want to build. The assistant can add parts, wire them, write code, compile and run. Add a provider key or a local Ollama model in its settings first.',
  },
  {
    target: '[data-tour="menu"]',
    since: 2,
    title: 'Menu',
    body: 'Save, open projects, export and browse examples. Setup installs what the app needs (Arduino CLI, board emulators, the custom chip compiler) with one click each. You can replay this tour here too.',
  },
  {
    title: 'You are ready',
    body: 'Press Run to see the example blink, or open Menu → Examples to start from a finished project.',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 6;
const CARD_WIDTH = 320;
const GAP = 12;

function findTarget(step: TourStep): HTMLElement | null {
  if (!step.target) return null;
  const el = document.querySelector<HTMLElement>(step.target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return null;
  return el;
}

function isAvailable(step: TourStep): boolean {
  return !step.target || findTarget(step) !== null;
}

interface GuidedTourProps {
  onClose: () => void;
  /** Show every step (Menu → Take the tour), not only what is new. */
  forceFull?: boolean;
}

const WHATS_NEW: TourStep = {
  title: "What's new",
  body: 'A few things were added since your last tour. This takes a few seconds.',
};

export const GuidedTour: React.FC<GuidedTourProps> = ({ onClose, forceFull = false }) => {
  // Resolve once on open which steps can be shown in the current layout.
  // Someone who finished an earlier tour sees only the steps added since.
  const steps = useMemo(() => {
    const seen = forceFull ? 0 : lastSeenTourVersion();
    const pool =
      seen > 0
        ? [WHATS_NEW, ...STEPS.filter((st) => (st.since ?? 1) > seen)]
        : STEPS;
    return pool.filter(isAvailable);
  }, [forceFull]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const step = steps[index];
  const isLast = index === steps.length - 1;

  const finish = useCallback(() => {
    markTourDone();
    onClose();
  }, [onClose]);

  const measure = useCallback(() => {
    const el = step ? findTarget(step) : null;
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top - PADDING,
      left: r.left - PADDING,
      width: r.width + PADDING * 2,
      height: r.height + PADDING * 2,
    });
  }, [step]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [measure]);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (isLast) finish();
        else setIndex((i) => i + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, isLast]);

  if (!step) return null;

  // Place the card below the target, above it if there is no room, or centred.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - 32);
  let cardStyle: React.CSSProperties;
  if (rect) {
    const cardHeight = cardRef.current?.offsetHeight ?? 180;
    const below = rect.top + rect.height + GAP;
    const above = rect.top - GAP - cardHeight;
    let top = below + cardHeight <= vh - 16 ? below : above >= 16 ? above : Math.max(16, vh - cardHeight - 16);
    let left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), vw - width - 16);
    if (rect.height > vh - cardHeight - 48) {
      // Tall targets (file list, editor, canvas): put the card beside them
      // when there is room, otherwise inside near the top.
      top = Math.min(vh - cardHeight - 16, Math.max(16, rect.top + 24));
      if (rect.left + rect.width + GAP + width <= vw - 16) left = rect.left + rect.width + GAP;
      else if (rect.left - GAP - width >= 16) left = rect.left - GAP - width;
    }
    cardStyle = { top, left, width };
  } else {
    cardStyle = { top: '50%', left: '50%', width, transform: 'translate(-50%, -50%)' };
  }

  return (
    <div className="tour-root" role="presentation">
      {rect ? (
        <div
          className="tour-spotlight"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ) : (
        <div className="tour-backdrop" />
      )}
      <div
        ref={cardRef}
        className="tour-card"
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
      >
        <div className="tour-step-count">
          Step {index + 1} of {steps.length}
        </div>
        <h3 id="tour-title" className="tour-title">
          {step.title}
        </h3>
        <p id="tour-body" className="tour-body">
          {step.body}
        </p>
        <div className="tour-progress" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={`tour-dot${i === index ? ' tour-dot--active' : ''}`} />
          ))}
        </div>
        <div className="tour-actions">
          {!isLast && (
            <button type="button" className="tour-btn tour-btn--ghost" onClick={finish}>
              Skip tour
            </button>
          )}
          <div className="tour-actions-right">
            {index > 0 && (
              <button type="button" className="tour-btn tour-btn--secondary" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              className="tour-btn tour-btn--primary"
              onClick={() => (isLast ? finish() : setIndex(index + 1))}
            >
              {isLast ? 'Start building' : index === 0 ? 'Show me around' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
