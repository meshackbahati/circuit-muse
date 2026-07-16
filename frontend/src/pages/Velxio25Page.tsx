/**
 * /v2-5 — Velxio 2.5 Release Landing Page
 * Highlights ngspice-WASM analog co-simulation, expanded SPICE catalog,
 * real-time instruments (ammeter, voltmeter, oscilloscope), and the new
 * hybrid digital+analog workflow.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/layout/AppHeader';
import { useLocalizedHref } from '../i18n/useLocalizedNavigate';
import { useSEO } from '../utils/useSEO';
import { getSeoMeta } from '../seoRoutes';
import { trackClickCTA } from '../utils/analytics';
import './SEOPage.css';
import './Velxio2Page.css';

const GITHUB_URL = 'https://github.com/davidmonterocrespo24/velxio';
const DISCORD_URL = 'https://discord.gg/3mARjJrh4E';

/* ── SVG Icons (no emojis) ─────────────────────────────── */
const IcoRocket = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </svg>
);

const IcoWave = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12h3l3-9 4 18 3-12 3 6h4" />
  </svg>
);

const IcoResistor = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12h4l1-3 2 6 2-6 2 6 2-6 1 3h6" />
  </svg>
);

const IcoTransistor = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8" />
    <path d="M9 7v10M9 12h6l-3-4M15 12l-3 4" />
  </svg>
);

const IcoMeter = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 12l4-4" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);

const IcoChip = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4" />
  </svg>
);

const IcoSensor = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IcoLightning = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const IcoBook = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

const IcoTestTube = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5V2" />
    <path d="M8.5 2h7" />
    <path d="M14.5 16h-5" />
  </svg>
);

const IcoGitHub = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

const IcoDiscord = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const IcoStar = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio 2.5 — Arduino + SPICE Analog Circuit Simulator',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (browser-based)',
    softwareVersion: '2.5.0',
    description:
      'Velxio 2.5 brings real-time ngspice-WASM analog simulation to the browser. Hybrid digital+analog co-simulation: resistors, capacitors, inductors, op-amps, transistors, voltmeters, ammeters — wired to Arduino, ESP32, RP2040 GPIO/ADC. 40+ circuit examples. Free and open-source.',
    url: 'https://velxio.dev/v2-5',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@type': 'Person', name: 'David Montero Crespo' },
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Velxio', item: 'https://velxio.dev/' },
      { '@type': 'ListItem', position: 2, name: 'Velxio 2.5', item: 'https://velxio.dev/v2-5' },
    ],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What is new in Velxio 2.5?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Velxio 2.5 adds real-time analog circuit simulation via ngspice-WASM. You can now mix SPICE-accurate analog parts — resistors, capacitors, inductors, diodes, transistors, op-amps, voltage regulators — with Arduino, ESP32, and RP2040 boards on the same canvas. Includes live ammeters, voltmeters, an oscilloscope, and 40+ new circuit examples.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is this a SPICE simulator in the browser?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. Velxio 2.5 runs ngspice compiled to WebAssembly (via eecircuit-engine) entirely in the browser. No server, no install, no account. Works offline after first load.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can I connect an Arduino to analog components?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. GPIO pins drive SPICE nets as voltage sources, and ADC inputs read analog node voltages back into the firmware. analogRead() returns the real SPICE-solved value at that net.',
        },
      },
    ],
  },
];

const CHANGE_SECTIONS = [
  {
    icon: <IcoWave />,
    title: 'ngspice-WASM Engine',
    color: '#007acc',
    items: [
      'ngspice compiled to WebAssembly via eecircuit-engine (lazy-loaded)',
      'Real-time transient analysis at ~60 Hz solve rate',
      'Full Modified Nodal Analysis — not a linear approximation',
      'Always-on mode: every circuit is SPICE-solved, no toggle needed',
      'Browser-native — no server, no install, no account',
      'Works offline after first load',
    ],
  },
  {
    icon: <IcoResistor />,
    title: 'Passive Components',
    color: '#4a9e6b',
    items: [
      'Resistor — custom value + common presets (220Ω, 1k, 10k, 100k)',
      'Capacitor — electrolytic, ceramic, polarity-aware (10nF–1mF)',
      'Inductor — custom value + presets (100µH–10mH)',
      'Potentiometer — live slider updates SPICE resistance',
      'Photoresistor (LDR) and Photodiode — lux-driven',
      'NTC thermistor — temperature-driven resistance',
    ],
  },
  {
    icon: <IcoTransistor />,
    title: 'Active Semiconductors',
    color: '#c8701a',
    items: [
      '5 BJTs: 2N2222, 2N3055, 2N3906, BC547, BC557',
      '4 MOSFETs: 2N7000, IRF540, IRF9540, FQP27P06 (P/N-channel)',
      '5 op-amps: LM358, LM741, TL072, LM324, ideal — with saturation rails',
      '4 linear regulators: 7805, 7812, 7905, LM317 with dropout',
      'Diodes: 1N4148, 1N4007, 1N5817, 1N5819, Zener 1N4733',
      'Optocouplers 4N25 and PC817 with CTR modelling',
    ],
  },
  {
    icon: <IcoChip />,
    title: 'Logic & Integrated Circuits',
    color: '#8957e5',
    items: [
      '7 basic logic gates: AND, OR, NAND, NOR, XOR, XNOR, NOT',
      '8 multi-input gates (3 and 4 inputs)',
      '7 74HC-series ICs as DIP-14 packages',
      '3 flip-flops: D, T, JK (edge-triggered digital)',
      'Relay (SPDT) with coil inductance, hysteresis, flyback diode',
      'L293D dual H-bridge motor driver',
    ],
  },
  {
    icon: <IcoMeter />,
    title: 'Live Instruments',
    color: '#a8304d',
    items: [
      'Ammeter — live current reading wired between any two nodes',
      'Voltmeter — live node voltage with probe leads',
      'Oscilloscope with multi-channel capture',
      'Signal generator — sine, square, DC (configurable frequency, amplitude, offset)',
      'Batteries: 9V, AA, coin-cell with realistic ESR',
      'LED brightness scales with actual current',
    ],
  },
  {
    icon: <IcoLightning />,
    title: 'Board Co-Simulation',
    color: '#b08800',
    items: [
      'Digital GPIO pins drive SPICE nets as voltage sources in real time',
      'ADC inputs read solved analog node voltages back into firmware',
      'analogRead() returns real SPICE-solved node values',
      'Arduino + transistor + motor — wired and solved together',
      'ESP32 + op-amp + sensor — co-simulated end-to-end',
      'Board-less circuits — pure analog workbenches are now a first-class mode',
    ],
  },
  {
    icon: <IcoSensor />,
    title: 'Sensor Sliders',
    color: '#4a9e6b',
    items: [
      'Photodiode illumination slider (0–1000 lux)',
      'Photoresistor illumination slider with LDR curve',
      'NTC temperature slider (-40–125 °C)',
      'Gas sensor, flame sensor, tilt switch — live panels',
      'Property changes invalidate the netlist memo → next tick re-solves',
      'Live sliders while running, number inputs while stopped',
    ],
  },
  {
    icon: <IcoTestTube />,
    title: 'Examples & Testing',
    color: '#1a7f37',
    items: [
      '40 new analog/hybrid circuit examples added',
      'Voltage dividers, RC filters, op-amp amplifiers, rectifiers',
      'Transistor switches, relay drivers, H-bridge circuits',
      'Full-wave rectifier, Wheatstone bridge, Schmitt trigger',
      'End-to-end SPICE behaviour tests (capacitor charging, rectification)',
      '164+ sandbox tests passing against ngspice reference results',
    ],
  },
  {
    icon: <IcoBook />,
    title: 'Docs & DX',
    color: '#6e7681',
    items: [
      'New circuit-emulation.md — implementation deep-dive',
      'Electrical simulation user guide in the docs site',
      'ngspice gotchas documented (unicode in titles, MOSFET Level=3)',
      'Separated useElectricalStore for clean state boundaries',
      'Reference sandbox in test/test_circuit/ for fast iteration',
      'VITE_ELECTRICAL_SIM build flag to disable if needed',
    ],
  },
];

export const Velxio25Page: React.FC = () => {
  const { t } = useTranslation();
  const localize = useLocalizedHref();
  useSEO({ ...getSeoMeta('/v2-5')!, jsonLd: JSON_LD });

  return (
    <div className="seo-page">
      <AppHeader />
      <main>
        {/* ── Hero ── */}
        <section className="v2-hero">
          <div className="v2-version-badge">
            <IcoRocket /> {t('v25.versionBadge')}
          </div>
          <h1>
            Velxio 2.5
            <br />
            <span className="accent">{t('v25.heroAccent')}</span>
          </h1>
          <p className="subtitle">{t('v25.heroSubtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('velxio-v2-5', '/editor')}
            >
              <IcoLightning />
              {t('v25.tryV25')}
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="seo-btn-secondary">
              <IcoGitHub /> {t('landing.hero.ctaGithub')}
            </a>
          </div>

          <div className="v2-community-row">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="v2-community-btn v2-star-btn">
              <IcoStar />
              <span>{t('starBanner.cta')}</span>
            </a>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="v2-community-btn v2-discord-btn">
              <IcoDiscord />
              <span>{t('v2.joinDiscord')}</span>
            </a>
          </div>
        </section>

        {/* ── Why SPICE matters ── */}
        <section className="seo-section">
          <h2>{t('v25.fullEmulation')}</h2>
          <p className="lead">{t('v25.fullEmulationLead')}</p>

          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('v25.notLinear')}</h3>
              <p>{t('v25.notLinearBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v25.realFirmware')}</h3>
              <p>{t('v25.realFirmwareBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v25.browserOffline')}</h3>
              <p>{t('v25.browserOfflineBody')}</p>
            </div>
          </div>
        </section>

        {/* ── Component catalog ── */}
        <section className="seo-section">
          <h2>{t('v25.catalogHeading')}</h2>
          <p className="lead">{t('v25.catalogLead')}</p>

          <div className="v2-changelog">
            {CHANGE_SECTIONS.map((section) => (
              <div key={section.title} className="v2-change-block">
                <div className="v2-change-header" style={{ color: section.color }}>
                  {section.icon}
                  <h3>{section.title}</h3>
                </div>
                <ul className="v2-change-list">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ── Co-simulation highlight ── */}
        <section className="seo-section">
          <h2>{t('v25.coSimHeading')}</h2>
          <p className="lead">{t('v25.coSimLead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('v25.driveMotor')}</h3>
              <p>{t('v25.driveMotorBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v25.readSensor')}</h3>
              <p>{t('v25.readSensorBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v25.liveInstruments')}</h3>
              <p>{t('v25.liveInstrumentsBody')}</p>
            </div>
          </div>
        </section>

        {/* ── Examples ── */}
        <section className="seo-section">
          <h2>{t('v25.examplesHeading')}</h2>
          <p className="lead">{t('v25.examplesLead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('v25.examples.fundamentals.title')}</h3>
              <p>{t('v25.examples.fundamentals.body')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v25.examples.diodes.title')}</h3>
              <p>{t('v25.examples.diodes.body')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v25.examples.opamps.title')}</h3>
              <p>{t('v25.examples.opamps.body')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v25.examples.transistors.title')}</h3>
              <p>{t('v25.examples.transistors.body')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v25.examples.arduino.title')}</h3>
              <p>{t('v25.examples.arduino.body')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v25.examples.sensors.title')}</h3>
              <p>{t('v25.examples.sensors.body')}</p>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('examples.browseAll')}
            </Link>
          </div>
        </section>

        {/* ── Outcome ── */}
        <section className="seo-section">
          <h2>{t('v25.outcomeHeading')}</h2>
          <p className="lead">{t('v25.outcomeLead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('v25.outcome.teach')}</h3>
              <p>{t('v25.outcome.teachBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v25.outcome.prototype')}</h3>
              <p>{t('v25.outcome.prototypeBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v25.outcome.openSource')}</h3>
              <p>{t('v25.outcome.openSourceBody')}</p>
            </div>
          </div>
        </section>

        {/* ── Built on ── */}
        <section className="seo-section">
          <h2>{t('v2.builtOnOss')}</h2>
          <p className="lead">{t('v25.builtOnOssLead')}</p>
          <div className="v2-repos">
            <a href="https://ngspice.sourceforge.io/" target="_blank" rel="noopener noreferrer" className="v2-repo-card">
              <IcoGitHub />
              <div>
                <h3>ngspice</h3>
                <p>The open-source SPICE circuit simulator — powers every analog solve in Velxio 2.5</p>
              </div>
            </a>
            <a href="https://github.com/danchitnis/eecircuit-engine" target="_blank" rel="noopener noreferrer" className="v2-repo-card">
              <IcoGitHub />
              <div>
                <h3>eecircuit-engine</h3>
                <p>ngspice compiled to WebAssembly — the bridge that makes browser SPICE possible</p>
              </div>
            </a>
            <a href="https://github.com/wokwi/avr8js" target="_blank" rel="noopener noreferrer" className="v2-repo-card">
              <IcoGitHub />
              <div>
                <h3>avr8js</h3>
                <p>AVR8 CPU emulator in JavaScript — Arduino Uno, Nano, Mega, ATtiny85</p>
              </div>
            </a>
            <a href="https://github.com/wokwi/rp2040js" target="_blank" rel="noopener noreferrer" className="v2-repo-card">
              <IcoGitHub />
              <div>
                <h3>rp2040js</h3>
                <p>RP2040 emulator — Raspberry Pi Pico and Pico W</p>
              </div>
            </a>
            <a href="https://github.com/wokwi/wokwi-elements" target="_blank" rel="noopener noreferrer" className="v2-repo-card">
              <IcoGitHub />
              <div>
                <h3>wokwi-elements</h3>
                <p>Web Components for electronic parts — LEDs, buttons, sensors, displays</p>
              </div>
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="v2-repo-card v2-repo-card--primary">
              <IcoGitHub />
              <div>
                <h3>Velxio</h3>
                <p>This project — free, open-source Arduino + SPICE co-simulator</p>
              </div>
            </a>
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <div className="seo-bottom">
          <h2>{t('v25.bottom.title')}</h2>
          <p>{t('v25.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('velxio-v2-5', '/editor')}
          >
            {t('v2.bottom.cta')}
          </Link>

          <div className="v2-bottom-community">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="v2-community-btn v2-star-btn">
              <IcoStar />
              <span>{t('starBanner.cta')}</span>
            </a>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="v2-community-btn v2-discord-btn">
              <IcoDiscord />
              <span>{t('v2.joinDiscord')}</span>
            </a>
          </div>

          <div className="seo-internal-links">
            <Link to={localize('/')}>{t('header.nav.home')}</Link>
            <Link to={localize('/v2')}>Velxio 2.0</Link>
            <Link to={localize('/examples')}>{t('header.nav.examples')}</Link>
            <Link to={localize('/docs/intro')}>{t('header.nav.documentation')}</Link>
            <Link to={localize('/arduino-simulator')}>Arduino Simulator</Link>
            <Link to={localize('/esp32-simulator')}>ESP32 Simulator</Link>
            <Link to={localize('/raspberry-pi-pico-simulator')}>RP2040 Simulator</Link>
            <Link to={localize('/about')}>{t('header.nav.about')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
