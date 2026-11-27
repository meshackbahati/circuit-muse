/**
 * Mute / unmute simulation sound (buzzers). The setting is remembered.
 */
import { useSoundSettings } from '../../simulation/audio/soundEngine';

export function SoundToggle() {
  const muted = useSoundSettings((s) => s.muted);
  const setMuted = useSoundSettings((s) => s.setMuted);
  const label = muted ? 'Sound off' : 'Sound on';
  return (
    <button
      type="button"
      data-tour="sound"
      className={`canvas-serial-btn${muted ? '' : ' canvas-serial-btn-active'}`}
      onClick={() => setMuted(!muted)}
      title={muted ? 'Turn simulation sound on (buzzers)' : 'Mute simulation sound (buzzers)'}
      aria-pressed={!muted}
      aria-label={label}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        {muted ? (
          <>
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </>
        ) : (
          <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
        )}
      </svg>
      {label}
    </button>
  );
}
