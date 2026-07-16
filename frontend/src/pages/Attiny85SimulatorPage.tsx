/**
 * /attiny85-simulator — SEO landing page
 * Target keywords: "attiny85 simulator", "attiny85 emulator",
 * "attiny85 online simulator", "free attiny85 simulator"
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

const META = getSeoMeta('/attiny85-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'Is this a real ATtiny85 emulator?',
    a: 'Yes. Velxio uses avr8js — the cycle-accurate AVR8 emulator — to execute compiled ATtiny85 firmware byte-for-byte exactly as it would run on a real DIP-8 chip.',
  },
  {
    q: 'Which ATtiny85 features are supported?',
    a: 'All 6 GPIO pins (PB0–PB5), Timer0 (8-bit) with PWM, Timer1 (8-bit) with PWM and high-speed mode, the watchdog timer, 10-bit ADC with 4 input channels (ADC0–ADC3), USI peripheral for I²C (TWI) and SPI bit-banging, pin-change interrupts, and external interrupts (INT0).',
  },
  {
    q: 'How do I program the ATtiny85 in Velxio?',
    a: 'Write your sketch in the Monaco editor in C/C++ (Arduino syntax). Velxio compiles it via the bundled arduino-cli using the ATTinyCore board package and produces a real .hex file — the same one you would flash via USBasp.',
  },
  {
    q: 'Can I use Arduino-compatible libraries?',
    a: 'Yes. The Library Manager indexes the full Arduino library registry. Many libraries work on ATtiny85 with appropriate pin assignments — TinyWireM for I²C, SoftwareSerial via USI, TinyServo, etc.',
  },
  {
    q: 'Can I wire it to analog circuits?',
    a: 'Yes. Velxio includes a real-time SPICE solver — wire the ATtiny85 ADC pin to a voltage divider, an op-amp output, or an NTC thermistor bridge and analogRead() will return the actual SPICE-solved voltage at that pin.',
  },
  {
    q: 'Is it free?',
    a: 'Yes — Velxio is fully free and open-source under GNU AGPLv3. No account required.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio — Free Online ATtiny85 Simulator',
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'AVR Microcontroller Emulator',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free online ATtiny85 simulator with cycle-accurate AVR8 emulation. All 6 I/O pins, Timer0/Timer1 PWM, 10-bit ADC, USI for I²C/SPI, watchdog. Wire it to real SPICE analog circuits.',
    url: 'https://velxio.dev/attiny85-simulator',
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
        name: 'ATtiny85 Simulator',
        item: 'https://velxio.dev/attiny85-simulator',
      },
    ],
  },
];

export const Attiny85SimulatorPage: React.FC = () => {
  const { t } = useTranslation();
  const localize = useLocalizedHref();
  useSEO({ ...META, jsonLd: JSON_LD });

  const faqKeys = ['1', '2', '3', '4', '5', '6'] as const;

  return (
    <div className="seo-page">
      <AppHeader />
      <main>
        {/* Hero */}
        <section className="seo-hero">
          <h1>
            {t('seo.attiny85.hero.title')}
            <br />
            <span className="accent">{t('seo.attiny85.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.attiny85.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('attiny85-simulator', '/editor')}
            >
              {t('seo.attiny85.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.attiny85.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.attiny85.hero.trust')}</p>
        </section>

        {/* Specs */}
        <section className="seo-section">
          <h2>{t('seo.attiny85.specs.heading')}</h2>
          <p className="lead">{t('seo.attiny85.specs.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.attiny85.specs.coreTitle')}</h3>
              <p>{t('seo.attiny85.specs.coreBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.attiny85.specs.gpioTitle')}</h3>
              <p>{t('seo.attiny85.specs.gpioBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.attiny85.specs.timersTitle')}</h3>
              <p>{t('seo.attiny85.specs.timersBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.attiny85.specs.adcTitle')}</h3>
              <p>{t('seo.attiny85.specs.adcBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.attiny85.specs.usiTitle')}</h3>
              <p>{t('seo.attiny85.specs.usiBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.attiny85.specs.wdtTitle')}</h3>
              <p>{t('seo.attiny85.specs.wdtBody')}</p>
            </div>
          </div>
        </section>

        {/* What you can do */}
        <section className="seo-section">
          <h2>{t('seo.attiny85.build.heading')}</h2>
          <p className="lead">{t('seo.attiny85.build.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.attiny85.build.blinkTitle')}</h3>
              <p>{t('seo.attiny85.build.blinkBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.attiny85.build.buttonTitle')}</h3>
              <p>{t('seo.attiny85.build.buttonBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.attiny85.build.ntcTitlePrefix')}</h3>
              <p>
                {t('seo.attiny85.build.ntcBodyPrefix')}
                <code>{t('seo.attiny85.build.ntcBodyCode')}</code>
                {t('seo.attiny85.build.ntcBodySuffix')}
              </p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.attiny85.build.i2cTitle')}</h3>
              <p>{t('seo.attiny85.build.i2cBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.attiny85.build.spiTitle')}</h3>
              <p>{t('seo.attiny85.build.spiBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.attiny85.build.analogTitle')}</h3>
              <p>{t('seo.attiny85.build.analogBody')}</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="seo-section">
          <h2>{t('seo.attiny85.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.attiny85.faq.q${k}`)}</dt>
                <dd>{t(`seo.attiny85.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div className="seo-bottom">
          <h2>{t('seo.attiny85.bottom.title')}</h2>
          <p>{t('seo.attiny85.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('attiny85-simulator', '/editor')}
          >
            {t('seo.attiny85.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
            <Link to={localize('/atmega328p-simulator')}>{t('seo.links.atmega')}</Link>
            <Link to={localize('/arduino-mega-simulator')}>{t('seo.links.mega')}</Link>
            <Link to={localize('/circuit-simulator')}>{t('seo.links.circuit')}</Link>
            <Link to={localize('/spice-simulator')}>{t('seo.links.spice')}</Link>
            <Link to={localize('/custom-chip-simulator')}>{t('seo.links.customChip')}</Link>
            <Link to={localize('/examples')}>{t('seo.links.examplesPlain')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
