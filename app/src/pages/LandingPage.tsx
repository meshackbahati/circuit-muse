import { Link } from 'react-router-dom';
import {
  Cpu as IcoChip,
  CircuitBoard as IcoCpu,
  Code2 as IcoCode,
  Zap as IcoZap,
  Layers as IcoLayers,
  Monitor as IcoMonitor,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trackVisitGitHub, trackClickCTA } from '../utils/analytics';
import { AppHeader } from '../components/layout/AppHeader';
import { useLocalizedHref } from '../i18n/useLocalizedNavigate';
import { useSEO } from '../utils/useSEO';
import { getSeoMeta } from '../seoRoutes';
import raspberryPi3Svg from '../assets/Raspberry_Pi_3_illustration.svg';
import './LandingPage.css';

const GITHUB_URL = 'https://github.com/davidmonterocrespo24/circuit-muse';
const PAYPAL_URL = 'https://paypal.me/odoonext';
const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/davidmonterocrespo24';

/* GitHub keeps a custom (filled) glyph — Lucide's outline doesn't match the brand. */
const IcoGitHub = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

/* ── Board SVGs ───────────────────────────────────────── */

const BoardATtiny85 = () => (
  <svg viewBox="0 0 60 50" className="board-svg" style={{ maxWidth: '100px' }}>
    {/* PCB - small square DIP board */}
    <rect
      x="2"
      y="2"
      width="56"
      height="46"
      rx="2"
      fill="#1a3a1a"
      stroke="#0d2a0d"
      strokeWidth="1.5"
    />
    {/* ATtiny85 DIP-8 chip center */}
    <rect
      x="18"
      y="12"
      width="24"
      height="28"
      rx="1"
      fill="#111"
      stroke="#2a2a2a"
      strokeWidth="1"
    />
    {/* Notch */}
    <path d="M28 12 Q30 9 32 12" fill="#222" stroke="#333" strokeWidth="0.5" />
    {/* DIP pins left */}
    {[0, 1, 2, 3].map((i) => (
      <rect key={`l${i}`} x="8" y={15 + i * 6} width="10" height="3.5" rx="0.5" fill="#d4a017" />
    ))}
    {/* DIP pins right */}
    {[0, 1, 2, 3].map((i) => (
      <rect key={`r${i}`} x="42" y={15 + i * 6} width="10" height="3.5" rx="0.5" fill="#d4a017" />
    ))}
    {/* Chip label */}
    <text x="30" y="26" textAnchor="middle" fill="#333" fontFamily="monospace" fontSize="4">
      ATtiny
    </text>
    <text x="30" y="32" textAnchor="middle" fill="#333" fontFamily="monospace" fontSize="4">
      85
    </text>
    {/* Status LED */}
    <circle cx="50" cy="8" r="2" fill="#00ff88" opacity="0.85" />
    <text x="30" y="46" textAnchor="middle" fill="#00aa55" fontFamily="monospace" fontSize="3.5">
      AVR · 8KB · DIP-8
    </text>
  </svg>
);

const BoardCH32V003 = () => (
  <svg viewBox="0 0 60 80" className="board-svg" style={{ maxWidth: '90px' }}>
    {/* PCB */}
    <rect
      x="2"
      y="2"
      width="56"
      height="76"
      rx="2"
      fill="#0a2a0a"
      stroke="#061a06"
      strokeWidth="1.5"
    />
    {/* CH32V003 chip */}
    <rect
      x="18"
      y="22"
      width="24"
      height="22"
      rx="1"
      fill="#1a1a1a"
      stroke="#2a2a2a"
      strokeWidth="1"
    />
    {[0, 1, 2, 3].map((i) => (
      <rect key={`cl${i}`} x="14" y={25 + i * 4.5} width="4" height="2.5" rx="0.4" fill="#888" />
    ))}
    {[0, 1, 2, 3].map((i) => (
      <rect key={`cr${i}`} x="42" y={25 + i * 4.5} width="4" height="2.5" rx="0.4" fill="#888" />
    ))}
    <text x="30" y="31" textAnchor="middle" fill="#363636" fontFamily="monospace" fontSize="3.5">
      CH32
    </text>
    <text x="30" y="37" textAnchor="middle" fill="#363636" fontFamily="monospace" fontSize="3.5">
      V003
    </text>
    {/* Pins left */}
    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
      <rect key={`pl${i}`} x="0" y={8 + i * 9} width="4" height="5" rx="0.5" fill="#d4a017" />
    ))}
    {/* Pins right */}
    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
      <rect key={`pr${i}`} x="56" y={8 + i * 9} width="4" height="5" rx="0.5" fill="#d4a017" />
    ))}
    {/* USB */}
    <rect x="20" y="70" width="20" height="7" rx="2" fill="#555" stroke="#444" strokeWidth="1" />
    {/* LED */}
    <circle cx="48" cy="14" r="2" fill="#00ff44" opacity="0.85" />
    <text x="30" y="79" textAnchor="middle" fill="#00aa44" fontFamily="monospace" fontSize="3.5">
      RV32EC · 48 MHz
    </text>
  </svg>
);
/* ── Features ─────────────────────────────────────────────
 * Title / description copy lives in src/i18n/locales/<lang>/common.json
 * under landing.features.<key>.{title,desc}; the array here just maps
 * an icon to each translation key.
 * ──────────────────────────────────────────────────────────── */
const features = [
  { icon: <IcoZap />,     key: 'spice' },
  { icon: <IcoCpu />,     key: 'engines' },
  { icon: <IcoChip />,    key: 'customChips' },
  { icon: <IcoLayers />,  key: 'components' },
  { icon: <IcoMonitor />, key: 'instruments' },
  { icon: <IcoCode />,    key: 'monaco' },
] as const;

/* ── Sponsor SVG icon ─────────────────────────────────── */
const IcoSponsor = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
    <path d="M8 14h.01M12 18h.01M16 14h.01" />
  </svg>
);


/* ── Component ────────────────────────────────────────── */
export const LandingPage: React.FC = () => {
  const { t } = useTranslation();
  const localize = useLocalizedHref();
  useSEO({
    ...getSeoMeta('/')!,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is CircuitMuse free?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. CircuitMuse is completely free and open-source under the GNU AGPLv3 license. No account required, no cloud subscription. Run it at circuit-muse.dev or self-host with one Docker command.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can CircuitMuse simulate analog circuits?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. CircuitMuse 2.5 includes real-time SPICE analog simulation via ngspice compiled to WebAssembly. You can mix passive and active analog parts (resistors, capacitors, op-amps, BJTs, MOSFETs, regulators, diodes) with Arduino, ESP32, and RP2040 firmware on the same canvas — GPIO drives SPICE nets, ADC reads solved node voltages.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I create my own custom chips?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. CircuitMuse implements the Wokwi Custom Chips API. Write your chip in C, Rust, or AssemblyScript; CircuitMuse compiles it to WebAssembly and runs it on the canvas like any other component, with pin I/O, attribute reads, timers, and I²C/SPI bus integration.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does CircuitMuse work offline?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'The SPICE solver and the AVR / RP2040 CPU emulators run in your browser. Xtensa and RISC-V boards (ESP32, ESP32-S3, ESP32-C3), STM32 (ARM Cortex-M) and Raspberry Pi 3/4/5 Linux run through QEMU, bundled in the Docker image. Compilation of Arduino sketches requires the arduino-cli backend. Self-hosted Docker deployments work fully offline once running.',
          },
        },
        {
          '@type': 'Question',
          name: 'What boards does CircuitMuse support?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'CircuitMuse supports 30+ boards across 6 CPU architectures: AVR8 (Arduino Uno, Nano, Mega 2560, ATtiny85), RP2040 (Raspberry Pi Pico, Pico W), Xtensa QEMU (ESP32, ESP32-S3, ESP32-CAM, Nano ESP32), RISC-V QEMU (ESP32-C3, XIAO ESP32-C3), ARM Cortex-M QEMU (STM32 Blue Pill, Black Pill, F401, F4 Discovery, Netduino, Olimex H405), and ARM Cortex-A QEMU (Raspberry Pi 3, 4 and 5 running Linux).',
          },
        },
        {
          '@type': 'Question',
          name: 'Is CircuitMuse a Wokwi / Falstad / Tinkercad alternative?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. CircuitMuse is a free, self-hosted alternative to Wokwi for microcontroller simulation, and a more accurate alternative to Falstad and Tinkercad for analog circuits — CircuitMuse runs the real ngspice engine and also runs the firmware on the microcontroller driving the circuit, all in one tool.',
          },
        },
      ],
    },
  });

  return (
    <div className="landing">
      <AppHeader />

      {/* Hero */}
      <section className="landing-hero">
        <div className="hero-left">
          <h1 className="hero-title">
            {t('landing.hero.titleLine1')}
            <br />
            <span className="hero-accent">{t('landing.hero.titleAccent')}</span>
          </h1>
          <p className="hero-subtitle">{t('landing.hero.subtitle')}</p>
          <div className="hero-ctas">
            <Link
              to={localize('/editor')}
              className="cta-primary"
              onClick={() => trackClickCTA('landing', '/editor')}
            >
              <IcoZap />
              {t('landing.hero.ctaPrimary')}
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={trackVisitGitHub}
              className="cta-secondary"
            >
              <IcoGitHub />
              {t('landing.hero.ctaGithub')}
            </a>
          </div>
          {/*
            Slot for the app's OS-detect CircuitMuse Desktop download
            CTA. Sits BELOW the online-editor CTAs so users see "try
            online" first, then a softer "or download to go faster
            offline" affordance. Pure OSS leaves it empty.
          */}
          <div data-circuit-muse-slot="landing-hero-download-cta" />
          <p className="hero-trust-line">{t('landing.hero.trustLine')}</p>
        </div>
        <div className="hero-right">
          <picture>
            <source srcSet="/marketing/hero-editor.webp" type="image/webp" />
            <source srcSet="/marketing/hero-editor.png" type="image/png" />
            <img
              src="/marketing/hero-editor.png"
              alt={t('landing.hero.imageAlt')}
              className="hero-preview-img"
              loading="eager"
              fetchPriority="high"
            />
          </picture>
        </div>
      </section>

      {/* Boards */}
      <section className="landing-section">
        <div className="section-header">
          <span className="section-label">{t('landing.boards.label')}</span>
          <h2 className="section-title">
            {t('landing.boards.titleLine1')}
            <br />
            {t('landing.boards.titleLine2')}
          </h2>
          <p className="section-sub">{t('landing.boards.subtitle')}</p>
        </div>

        {/* ── AVR8 · avr8js ────────────────────────────────────────── */}
        <div className="board-group">
          <div
            className="board-group-header"
            style={{ '--grp-color': '#0071e3' } as React.CSSProperties}
          >
            <span className="board-group-engine">avr8js</span>
            <span className="board-group-label">AVR8 · ATmega · 16 MHz</span>
          </div>
          <div className="boards-row">
            <div className="board-card-sm">
              <div className="board-img-box">
                <picture>
                  <source
                    type="image/webp"
                    srcSet="/boards/arduino-uno.webp 1x, /boards/arduino-uno@2x.webp 2x"
                  />
                  <source
                    type="image/png"
                    srcSet="/boards/arduino-uno.png 1x, /boards/arduino-uno@2x.png 2x"
                  />
                  <img
                    src="/boards/arduino-uno.svg"
                    alt="Arduino Uno"
                    className="board-img-sm"
                    loading="lazy"
                  />
                </picture>
              </div>
              <span className="board-name-sm">Arduino Uno</span>
              <span className="board-chip-sm">ATmega328p · 32 KB</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <picture>
                  <source
                    type="image/webp"
                    srcSet="/boards/arduino-nano.webp 1x, /boards/arduino-nano@2x.webp 2x"
                  />
                  <source
                    type="image/png"
                    srcSet="/boards/arduino-nano.png 1x, /boards/arduino-nano@2x.png 2x"
                  />
                  <img
                    src="/boards/arduino-nano.svg"
                    alt="Arduino Nano"
                    className="board-img-sm"
                    loading="lazy"
                  />
                </picture>
              </div>
              <span className="board-name-sm">Arduino Nano</span>
              <span className="board-chip-sm">ATmega328p · 32 KB</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <picture>
                  <source
                    type="image/webp"
                    srcSet="/boards/arduino-mega.webp 1x, /boards/arduino-mega@2x.webp 2x"
                  />
                  <source
                    type="image/png"
                    srcSet="/boards/arduino-mega.png 1x, /boards/arduino-mega@2x.png 2x"
                  />
                  <img
                    src="/boards/arduino-mega.svg"
                    alt="Arduino Mega 2560"
                    className="board-img-sm"
                    loading="lazy"
                  />
                </picture>
              </div>
              <span className="board-name-sm">Arduino Mega 2560</span>
              <span className="board-chip-sm">ATmega2560 · 256 KB</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <BoardATtiny85 />
              </div>
              <span className="board-name-sm">ATtiny85</span>
              <span className="board-chip-sm">AVR · 8 KB · DIP-8</span>
            </div>
          </div>
        </div>

        {/* ── RP2040 · rp2040js ────────────────────────────────────── */}
        <div className="board-group">
          <div
            className="board-group-header"
            style={{ '--grp-color': '#a8192a' } as React.CSSProperties}
          >
            <span className="board-group-engine">rp2040js</span>
            <span className="board-group-label">RP2040 · Dual ARM Cortex-M0+ · 133 MHz</span>
          </div>
          <div className="boards-row">
            <div className="board-card-sm">
              <div className="board-img-box">
                <picture>
                  <source
                    type="image/webp"
                    srcSet="/boards/pi-pico.webp 1x, /boards/pi-pico@2x.webp 2x"
                  />
                  <source
                    type="image/png"
                    srcSet="/boards/pi-pico.png 1x, /boards/pi-pico@2x.png 2x"
                  />
                  <img
                    src="/boards/pi-pico.svg"
                    alt="Raspberry Pi Pico"
                    className="board-img-sm"
                    loading="lazy"
                  />
                </picture>
              </div>
              <span className="board-name-sm">Raspberry Pi Pico</span>
              <span className="board-chip-sm">RP2040 · 264 KB RAM</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <picture>
                  <source
                    type="image/webp"
                    srcSet="/boards/pi-pico-w.webp 1x, /boards/pi-pico-w@2x.webp 2x"
                  />
                  <source
                    type="image/png"
                    srcSet="/boards/pi-pico-w.png 1x, /boards/pi-pico-w@2x.png 2x"
                  />
                  <img
                    src="/boards/pi-pico-w.svg"
                    alt="Raspberry Pi Pico W"
                    className="board-img-sm"
                    loading="lazy"
                  />
                </picture>
              </div>
              <span className="board-name-sm">Raspberry Pi Pico W</span>
              <span className="board-chip-sm">RP2040 + WiFi</span>
            </div>
          </div>
        </div>

        {/* ── RISC-V · RV32IMC · QEMU lcgamboa ───────────────────────────── */}
        <div className="board-group">
          <div
            className="board-group-header"
            style={{ '--grp-color': '#4a9e6b' } as React.CSSProperties}
          >
            <span className="board-group-engine">QEMU lcgamboa</span>
            <span className="board-group-label">RISC-V · RV32IMC · 160 MHz · libqemu-riscv32</span>
          </div>
          <div className="boards-row">
            <div className="board-card-sm">
              <div className="board-img-box">
                <picture>
                  <source
                    type="image/webp"
                    srcSet="/boards/esp32-c3.webp 1x, /boards/esp32-c3@2x.webp 2x"
                  />
                  <source
                    type="image/png"
                    srcSet="/boards/esp32-c3.png 1x, /boards/esp32-c3@2x.png 2x"
                  />
                  <img
                    src="/boards/esp32-c3.svg"
                    alt="ESP32-C3"
                    className="board-img-sm"
                    loading="lazy"
                  />
                </picture>
              </div>
              <span className="board-name-sm">ESP32-C3 DevKit</span>
              <span className="board-chip-sm">RV32IMC · 4 MB flash</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <img src="/boards/xiao-esp32-c3.svg" alt="XIAO ESP32-C3" className="board-img-sm" />
              </div>
              <span className="board-name-sm">XIAO ESP32-C3</span>
              <span className="board-chip-sm">RV32IMC · compact</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <img
                  src="/boards/esp32c3-supermini.svg"
                  alt="ESP32-C3 SuperMini"
                  className="board-img-sm"
                />
              </div>
              <span className="board-name-sm">ESP32-C3 SuperMini</span>
              <span className="board-chip-sm">RV32IMC · mini form</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <BoardCH32V003 />
              </div>
              <span className="board-name-sm">CH32V003 (RISC-V)</span>
              <span className="board-chip-sm">RV32EC · 48 MHz</span>
            </div>
          </div>
        </div>

        {/* ── Xtensa LX6/LX7 · QEMU ────────────────────────────────── */}
        <div className="board-group">
          <div
            className="board-group-header"
            style={{ '--grp-color': '#c8701a' } as React.CSSProperties}
          >
            <span className="board-group-engine">QEMU · Xtensa</span>
            <span className="board-group-label">Xtensa LX6/LX7 · 240 MHz · backend required</span>
          </div>
          <div className="boards-row">
            <div className="board-card-sm">
              <div className="board-img-box">
                <picture>
                  <source
                    type="image/webp"
                    srcSet="/boards/esp32-devkit-v1.webp 1x, /boards/esp32-devkit-v1@2x.webp 2x"
                  />
                  <source
                    type="image/png"
                    srcSet="/boards/esp32-devkit-v1.png 1x, /boards/esp32-devkit-v1@2x.png 2x"
                  />
                  <img
                    src="/boards/esp32-devkit-v1.svg"
                    alt="ESP32 DevKit V1"
                    className="board-img-sm"
                    loading="lazy"
                  />
                </picture>
              </div>
              <span className="board-name-sm">ESP32 DevKit V1</span>
              <span className="board-chip-sm">LX6 · 4 MB flash</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <img
                  src="/boards/esp32-devkit-c-v4.svg"
                  alt="ESP32 DevKit C V4"
                  className="board-img-sm"
                />
              </div>
              <span className="board-name-sm">ESP32 DevKit C V4</span>
              <span className="board-chip-sm">LX6 · 4 MB flash</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <img src="/boards/esp32-cam.svg" alt="ESP32-CAM" className="board-img-sm" />
              </div>
              <span className="board-name-sm">ESP32-CAM</span>
              <span className="board-chip-sm">LX6 · camera module</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <img src="/boards/esp32-s3.svg" alt="ESP32-S3" className="board-img-sm" />
              </div>
              <span className="board-name-sm">ESP32-S3 DevKit</span>
              <span className="board-chip-sm">LX7 · 4 MB flash</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <picture>
                  <source
                    type="image/webp"
                    srcSet="/boards/xiao-esp32-s3.webp 1x, /boards/xiao-esp32-s3@2x.webp 2x"
                  />
                  <source
                    type="image/png"
                    srcSet="/boards/xiao-esp32-s3.png 1x, /boards/xiao-esp32-s3@2x.png 2x"
                  />
                  <img
                    src="/boards/xiao-esp32-s3.svg"
                    alt="XIAO ESP32-S3"
                    className="board-img-sm"
                    loading="lazy"
                  />
                </picture>
              </div>
              <span className="board-name-sm">XIAO ESP32-S3</span>
              <span className="board-chip-sm">LX7 · compact</span>
            </div>
            <div className="board-card-sm">
              <div className="board-img-box">
                <img
                  src="/boards/arduino-nano-esp32.svg"
                  alt="Arduino Nano ESP32"
                  className="board-img-sm"
                />
              </div>
              <span className="board-name-sm">Arduino Nano ESP32</span>
              <span className="board-chip-sm">LX7 · Nano form</span>
            </div>
          </div>
        </div>

        {/* ── ARM · Linux · QEMU ───────────────────────────────────── */}
        <div className="board-group">
          <div
            className="board-group-header"
            style={{ '--grp-color': '#a8304d' } as React.CSSProperties}
          >
            <span className="board-group-engine">QEMU · ARM</span>
            <span className="board-group-label">ARM Cortex-A53 · Linux · backend required</span>
          </div>
          <div className="boards-row">
            <div className="board-card-sm">
              <div className="board-img-box">
                <img src={raspberryPi3Svg} alt="Raspberry Pi 3B" className="board-img-sm" />
              </div>
              <span className="board-name-sm">Raspberry Pi 3B</span>
              <span className="board-chip-sm">Cortex-A53 · 1.2 GHz · Linux</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="landing-section landing-section-alt">
        <div className="section-header">
          <span className="section-label">{t('landing.features.label')}</span>
          <h2 className="section-title">{t('landing.features.title')}</h2>
          <p className="section-sub">{t('landing.features.subtitle')}</p>
        </div>
        <div className="features-grid">
          {features.map((f) => (
            <div key={f.key} className="feature-card">
              <div className="feature-icon">{f.icon}</div>
              <h3 className="feature-title">{t(`landing.features.${f.key}.title`)}</h3>
              <p className="feature-desc">{t(`landing.features.${f.key}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* AI agent */}
      <section className="landing-section landing-ai">
        <div className="section-header">
          <span className="section-label">{t('landing.ai.label')}</span>
          <h2 className="section-title">{t('landing.ai.title')}</h2>
          <p className="section-sub">{t('landing.ai.subtitle')}</p>
        </div>
        <div className="ai-grid">
          <div className="ai-card">
            <h3 className="ai-card-title">{t('landing.ai.cards.wire.title')}</h3>
            <p className="ai-card-desc">{t('landing.ai.cards.wire.desc')}</p>
          </div>
          <div className="ai-card">
            <h3 className="ai-card-title">{t('landing.ai.cards.code.title')}</h3>
            <p className="ai-card-desc">{t('landing.ai.cards.code.desc')}</p>
          </div>
          <div className="ai-card">
            <h3 className="ai-card-title">{t('landing.ai.cards.debug.title')}</h3>
            <p className="ai-card-desc">{t('landing.ai.cards.debug.desc')}</p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="landing-section landing-section-alt landing-pricing">
        <div className="section-header">
          <span className="section-label">{t('landing.pricing.label')}</span>
          <h2 className="section-title">{t('landing.pricing.title')}</h2>
          <p className="section-sub">{t('landing.pricing.subtitle')}</p>
        </div>
        <div className="pricing-grid">
          <div className="pricing-card">
            <div className="pricing-card-name">{t('landing.pricing.tiers.free.name')}</div>
            <div className="pricing-card-price">
              <span className="pricing-card-amount">$0</span>
              <span className="pricing-card-period">/mo</span>
            </div>
            <p className="pricing-card-tagline">{t('landing.pricing.tiers.free.tagline')}</p>
            <ul className="pricing-card-features">
              <li>{t('landing.pricing.tiers.free.f1')}</li>
              <li>{t('landing.pricing.tiers.free.f2')}</li>
              <li>{t('landing.pricing.tiers.free.f3')}</li>
            </ul>
            <Link to={localize('/editor')} className="pricing-card-cta pricing-card-cta-secondary">
              {t('landing.pricing.tiers.free.cta')}
            </Link>
          </div>
          <div className="pricing-card">
            <div className="pricing-card-name">{t('landing.pricing.tiers.maker.name')}</div>
            <div className="pricing-card-price">
              <span className="pricing-card-amount">$7</span>
              <span className="pricing-card-period">/mo</span>
            </div>
            <p className="pricing-card-tagline">{t('landing.pricing.tiers.maker.tagline')}</p>
            <ul className="pricing-card-features">
              <li>{t('landing.pricing.tiers.maker.f1')}</li>
              <li>{t('landing.pricing.tiers.maker.f2')}</li>
              <li>{t('landing.pricing.tiers.maker.f3')}</li>
            </ul>
            <Link to={localize('/pricing')} className="pricing-card-cta pricing-card-cta-secondary">
              {t('landing.pricing.tiers.maker.cta')}
            </Link>
          </div>
          <div className="pricing-card pricing-card-featured">
            <div className="pricing-card-badge">{t('landing.pricing.popular')}</div>
            <div className="pricing-card-name">{t('landing.pricing.tiers.pro.name')}</div>
            <div className="pricing-card-price">
              <span className="pricing-card-amount">$19</span>
              <span className="pricing-card-period">/mo</span>
            </div>
            <p className="pricing-card-tagline">{t('landing.pricing.tiers.pro.tagline')}</p>
            <ul className="pricing-card-features">
              <li>{t('landing.pricing.tiers.pro.f1')}</li>
              <li>{t('landing.pricing.tiers.pro.f2')}</li>
              <li>{t('landing.pricing.tiers.pro.f3')}</li>
            </ul>
            <Link to={localize('/pricing')} className="pricing-card-cta pricing-card-cta-primary">
              {t('landing.pricing.tiers.pro.cta')}
            </Link>
          </div>
        </div>
        <div className="pricing-classroom-banner">
          <span>
            {t(
              'landing.pricing.classroomBanner',
              'Bringing CircuitMuse into a course? CircuitMuse for Classroom gives every student Pro access from $40/year.',
            )}
          </span>
          <Link to={localize('/classroom')} className="pricing-classroom-banner-cta">
            {t('landing.pricing.classroomCta', 'See classroom plans →')}
          </Link>
        </div>
      </section>

      {/* Support */}
      <section className="landing-support">
        <div className="support-content">
          <div className="support-icon">
            <IcoSponsor />
          </div>
          <h2 className="support-title">{t('landing.support.title')}</h2>
          <p className="support-sub">{t('landing.support.subtitle')}</p>
          <div className="support-btns">
            <a
              href={GITHUB_SPONSORS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="support-btn support-btn-gh"
            >
              <IcoGitHub /> {t('landing.support.ctaSponsors')}
            </a>
            <a
              href={PAYPAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="support-btn support-btn-pp"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z" />
              </svg>
              {t('landing.support.ctaPaypal')}
            </a>
          </div>
        </div>
      </section>

      {/* Licensing */}
      <section className="landing-section landing-licensing">
        <div className="section-header">
          <span className="section-label">{t('landing.licensing.label')}</span>
          <h2 className="section-title">{t('landing.licensing.title')}</h2>
          <p className="section-sub">{t('landing.licensing.subtitle')}</p>
        </div>
        <div className="licensing-grid">
          <div className="licensing-card">
            <span className="licensing-card-badge">AGPLv3</span>
            <h3 className="licensing-card-title">{t('landing.licensing.opensource.title')}</h3>
            <p className="licensing-card-desc">{t('landing.licensing.opensource.desc')}</p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="licensing-card-link"
              onClick={trackVisitGitHub}
            >
              {t('landing.licensing.opensource.cta')}
            </a>
          </div>
          <div className="licensing-card">
            <span className="licensing-card-badge licensing-card-badge-commercial">
              {t('landing.licensing.commercial.badge')}
            </span>
            <h3 className="licensing-card-title">{t('landing.licensing.commercial.title')}</h3>
            <p className="licensing-card-desc">{t('landing.licensing.commercial.desc')}</p>
            <a
              href="mailto:hello@circuit-muse.dev?subject=CircuitMuse"
              className="licensing-card-link"
            >
              {t('landing.licensing.commercial.cta')}
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-brand">
          <span>CircuitMuse</span>
        </div>
        <div className="footer-links">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" onClick={trackVisitGitHub}>
            {t('header.nav.github')}
          </a>
          <Link to={localize('/docs')}>{t('header.nav.documentation')}</Link>
          <Link to={localize('/examples')}>{t('header.nav.examples')}</Link>
          <Link to={localize('/editor')}>{t('header.nav.editor')}</Link>
          <Link to={localize('/pricing')}>{t('header.nav.pricing')}</Link>
          <Link to={localize('/classroom')}>{t('header.nav.classroom', 'For schools')}</Link>
          <Link to={localize('/about')}>{t('header.nav.about')}</Link>
        </div>
        <p className="footer-copy">{t('footer.about')}</p>
      </footer>
    </div>
  );
};
