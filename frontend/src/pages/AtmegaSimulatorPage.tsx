/**
 * /atmega328p-simulator — SEO landing page
 * Target keywords: "atmega328p", "atmega", "atmega 328p", "atmega328p arduino"
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

const META = getSeoMeta('/atmega328p-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'What is the ATmega328P?',
    a: 'The ATmega328P is an 8-bit AVR microcontroller by Microchip (formerly Atmel). It is the heart of the Arduino Uno and Arduino Nano, running at 16 MHz with 32 KB flash, 2 KB SRAM, and 1 KB EEPROM.',
  },
  {
    q: 'Can I simulate ATmega328P register-level code?',
    a: "Yes. Velxio's AVR8 emulation faithfully executes all ATmega328P registers: DDRB/C/D, PORTB/C/D, PINB/C/D, TCCR0/1/2, OCR0/1/2, UBRR, UDR, ADCL/ADCH, and all interrupt vectors — including direct register manipulation without the Arduino abstraction layer.",
  },
  {
    q: 'Does it emulate ATmega328P timers correctly?',
    a: 'Timer0 (8-bit), Timer1 (16-bit), and Timer2 (8-bit) are all emulated with full prescaler support, PWM modes, overflow interrupts, and Output Compare Match interrupts. millis(), delay(), analogWrite(), and tone() all work correctly.',
  },
  {
    q: 'Can I use analogRead() and analogWrite() in the simulator?',
    a: 'Yes. The 10-bit ADC (analogRead) and PWM output (analogWrite on pins 3, 5, 6, 9, 10, 11) are fully emulated. You can connect simulated sensors, potentiometers, and any wokwi-elements analog component.',
  },
  {
    q: 'Can I simulate USART / Serial on ATmega328P?',
    a: 'Yes. USART0 is fully emulated. Serial.begin(), Serial.print(), Serial.println(), and Serial.read() all work. The built-in Serial Monitor shows TX output and lets you send RX data to the running program.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'ATmega328P Simulator — Velxio',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free browser-based ATmega328P simulator. Full AVR8 emulation at 16 MHz — PORTB, PORTC, PORTD, Timer0/1/2, ADC, USART, PWM — with 48+ interactive components. No install required.',
    url: 'https://velxio.dev/atmega328p-simulator',
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
        name: 'ATmega328P Simulator',
        item: 'https://velxio.dev/atmega328p-simulator',
      },
    ],
  },
];

export const AtmegaSimulatorPage: React.FC = () => {
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
            {t('seo.atmega.hero.title')}
            <br />
            <span className="accent">{t('seo.atmega.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.atmega.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('atmega-simulator', '/editor')}
            >
              {t('seo.atmega.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/docs/emulator')} className="seo-btn-secondary">
              {t('seo.atmega.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.atmega.hero.trust')}</p>
        </section>

        {/* ATmega328P specs */}
        <section className="seo-section">
          <h2>{t('seo.atmega.specs.heading')}</h2>
          <p className="lead">{t('seo.atmega.specs.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.atmega.specs.coreTitle')}</h3>
              <p>{t('seo.atmega.specs.coreBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.atmega.specs.flashTitle')}</h3>
              <p>{t('seo.atmega.specs.flashBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.atmega.specs.gpioTitle')}</h3>
              <p>{t('seo.atmega.specs.gpioBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.atmega.specs.timersTitle')}</h3>
              <p>{t('seo.atmega.specs.timersBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.atmega.specs.adcTitle')}</h3>
              <p>{t('seo.atmega.specs.adcBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.atmega.specs.usartTitle')}</h3>
              <p>{t('seo.atmega.specs.usartBody')}</p>
            </div>
          </div>
        </section>

        {/* Compatible boards */}
        <section className="seo-section">
          <h2>{t('seo.atmega.boards.heading')}</h2>
          <p className="lead">{t('seo.atmega.boards.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.atmega.boards.unoTitle')}</h3>
              <p>{t('seo.atmega.boards.unoBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.atmega.boards.nanoTitle')}</h3>
              <p>{t('seo.atmega.boards.nanoBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.atmega.boards.proTitle')}</h3>
              <p>{t('seo.atmega.boards.proBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.atmega.boards.tinyTitle')}</h3>
              <p>{t('seo.atmega.boards.tinyBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.atmega.boards.megaTitle')}</h3>
              <p>{t('seo.atmega.boards.megaBody')}</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="seo-section">
          <h2>{t('seo.atmega.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.atmega.faq.q${k}`)}</dt>
                <dd>{t(`seo.atmega.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div className="seo-bottom">
          <h2>{t('seo.atmega.bottom.title')}</h2>
          <p>{t('seo.atmega.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('atmega-simulator', '/editor')}
          >
            {t('seo.atmega.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
            <Link to={localize('/arduino-emulator')}>{t('seo.links.arduinoEmu')}</Link>
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.links.rpiPico')}</Link>
            <Link to={localize('/examples')}>{t('seo.links.exampleSketches')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
