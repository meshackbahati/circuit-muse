/**
 * /arduino-simulator — SEO landing page
 * Target keywords: "arduino simulator", "arduino simulator free"
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

const META = getSeoMeta('/arduino-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'Is this Arduino simulator free?',
    a: 'Yes. Velxio is completely free and open-source (GNU AGPLv3). No account, no payment, no cloud subscription — run it in your browser or self-host it with one Docker command.',
  },
  {
    q: 'Does the Arduino simulator work without installing anything?',
    a: 'The simulation engine runs entirely in your browser. Compiling code requires the arduino-cli backend, which you can run locally or via Docker. No IDE installation is needed.',
  },
  {
    q: 'What Arduino boards can I simulate?',
    a: 'Velxio supports 19 boards: Arduino Uno (ATmega328P), Arduino Nano, Arduino Mega 2560, ATtiny85, Arduino Leonardo, Arduino Pro Mini (AVR8) — plus Raspberry Pi Pico (RP2040), ESP32-C3 / XIAO ESP32-C3 / CH32V003 (RISC-V), ESP32 / ESP32-S3 / ESP32-CAM (Xtensa via QEMU), and Raspberry Pi 3B (Linux via QEMU).',
  },
  {
    q: 'Can I simulate LEDs, sensors, and displays?',
    a: 'Yes. Velxio includes 48+ interactive wokwi-elements: LEDs, resistors, buttons, servo motors, ultrasonic sensors, ILI9341 TFT displays, LCD, NeoPixel strips, buzzers, DHT22, and more.',
  },
  {
    q: 'Is Velxio a Wokwi alternative?',
    a: 'Yes. Velxio is a free, self-hosted alternative to Wokwi. It uses the same avr8js emulation library and wokwi-elements visual components, but runs entirely on your own machine with no cloud dependency.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio — Free Online Arduino Simulator',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free online Arduino simulator with real AVR8 emulation at 16 MHz. Simulate Arduino code with 48+ interactive electronic components directly in your browser — no install, no account.',
    url: 'https://velxio.dev/arduino-simulator',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@type': 'Person', name: 'David Montero Crespo' },
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  },
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Velxio', item: 'https://velxio.dev/' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Arduino Simulator',
        item: 'https://velxio.dev/arduino-simulator',
      },
    ],
  },
];

export const ArduinoSimulatorPage: React.FC = () => {
  const { t } = useTranslation();
  const localize = useLocalizedHref();
  useSEO({ ...META, jsonLd: JSON_LD });

  const faqKeys = ['1', '2', '3', '4', '5'] as const;

  return (
    <div className="seo-page">
      <AppHeader />
      <main>
        {/* Hero */}
        <section className="seo-hero">
          <h1>
            {t('seo.arduino.hero.title')}
            <br />
            <span className="accent">{t('seo.arduino.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.arduino.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('arduino-simulator', '/editor')}
            >
              {t('seo.arduino.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.arduino.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.arduino.hero.trust')}</p>
        </section>

        {/* What you can simulate */}
        <section className="seo-section">
          <h2>{t('seo.arduino.what.heading')}</h2>
          <p className="lead">{t('seo.arduino.what.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.arduino.what.unoTitle')}</h3>
              <p>{t('seo.arduino.what.unoBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduino.what.megaTitle')}</h3>
              <p>{t('seo.arduino.what.megaBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduino.what.componentsTitle')}</h3>
              <p>{t('seo.arduino.what.componentsBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduino.what.serialTitle')}</h3>
              <p>
                {t('seo.arduino.what.serialBodyPrefix')}
                <code>{t('seo.arduino.what.serialBodyCode')}</code>
                {t('seo.arduino.what.serialBodySuffix')}
              </p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduino.what.multiTitle')}</h3>
              <p>{t('seo.arduino.what.multiBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduino.what.libTitle')}</h3>
              <p>{t('seo.arduino.what.libBody')}</p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="seo-section">
          <h2>{t('seo.arduino.how.heading')}</h2>
          <p className="lead">
            {t('seo.arduino.how.leadPrefix')}
            <strong style={{ color: '#e6edf3' }}>{t('seo.arduino.how.leadHighlight')}</strong>
            {t('seo.arduino.how.leadSuffix')}
          </p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.arduino.how.writeTitle')}</h3>
              <p>{t('seo.arduino.how.writeBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduino.how.compileTitle')}</h3>
              <p>{t('seo.arduino.how.compileBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduino.how.simulateTitle')}</h3>
              <p>{t('seo.arduino.how.simulateBody')}</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="seo-section">
          <h2>{t('seo.arduino.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.arduino.faq.q${k}`)}</dt>
                <dd>{t(`seo.arduino.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div className="seo-bottom">
          <h2>{t('seo.arduino.bottom.title')}</h2>
          <p>{t('seo.arduino.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('arduino-simulator', '/editor')}
          >
            {t('seo.arduino.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/examples')}>{t('seo.links.examples')}</Link>
            <Link to={localize('/arduino-emulator')}>{t('seo.links.arduinoEmu')}</Link>
            <Link to={localize('/atmega328p-simulator')}>{t('seo.links.atmega')}</Link>
            <Link to={localize('/arduino-mega-simulator')}>{t('seo.links.mega')}</Link>
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.links.rpiPico')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
