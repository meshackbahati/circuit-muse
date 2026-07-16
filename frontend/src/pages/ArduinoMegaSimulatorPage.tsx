/**
 * /arduino-mega-simulator — SEO landing page
 * Target keywords: "arduino mega", "mega 2560", "arduino mega 2560"
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

const META = getSeoMeta('/arduino-mega-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'What is the Arduino Mega 2560?',
    a: 'The Arduino Mega 2560 is a microcontroller board based on the ATmega2560. It offers 256 KB flash memory, 8 KB SRAM, 54 digital I/O pins (15 PWM), 16 analog inputs, and 4 hardware USART channels — making it the go-to board for large, complex Arduino projects.',
  },
  {
    q: 'Can I simulate Arduino Mega 2560 code in my browser?',
    a: 'Yes. Velxio provides full ATmega2560 AVR8 emulation. Select "Arduino Mega 2560" in the board picker, write your sketch, compile, and simulate — with all 54 digital pins and 16 analog inputs available.',
  },
  {
    q: 'Is the Arduino Mega 2560 emulation accurate?',
    a: 'Velxio uses avr8js for cycle-accurate AVR8 instruction emulation. The ATmega2560 shares the same AVR8 core as the ATmega328P but with extended memory, more ports (PORTA–PORTL), and additional timers (Timer3, Timer4, Timer5) — all emulated.',
  },
  {
    q: 'What additional features does the Mega have over Arduino Uno?',
    a: 'Arduino Mega 2560 adds: 8× more flash (256 KB vs 32 KB), 4× more SRAM (8 KB vs 2 KB), 40 extra digital pins, 10 extra analog inputs, 3 extra hardware serial ports (Serial1, Serial2, Serial3), and 3 extra 16-bit timers (Timer3, Timer4, Timer5).',
  },
  {
    q: 'Does the Mega simulator support multiple Serial ports?',
    a: 'Yes. Serial (USART0), Serial1 (USART1), Serial2 (USART2), and Serial3 (USART3) are all emulated. Each appears in the Serial Monitor tab so you can monitor multi-serial communication projects.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Arduino Mega 2560 Simulator — Velxio',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free online Arduino Mega 2560 simulator. Emulate ATmega2560 with 256 KB flash, 54 digital pins, 16 analog inputs, and 4 serial ports — full AVR8 emulation in your browser.',
    url: 'https://velxio.dev/arduino-mega-simulator',
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
        name: 'Arduino Mega 2560 Simulator',
        item: 'https://velxio.dev/arduino-mega-simulator',
      },
    ],
  },
];

export const ArduinoMegaSimulatorPage: React.FC = () => {
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
            {t('seo.mega.hero.title')}
            <br />
            <span className="accent">{t('seo.mega.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.mega.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('arduino-mega-simulator', '/editor')}
            >
              {t('seo.mega.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.mega.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.mega.hero.trust')}</p>
        </section>

        {/* ATmega2560 specs */}
        <section className="seo-section">
          <h2>{t('seo.mega.specs.heading')}</h2>
          <p className="lead">{t('seo.mega.specs.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.mega.specs.flashTitle')}</h3>
              <p>{t('seo.mega.specs.flashBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.mega.specs.gpioTitle')}</h3>
              <p>{t('seo.mega.specs.gpioBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.mega.specs.adcTitle')}</h3>
              <p>{t('seo.mega.specs.adcBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.mega.specs.serialTitle')}</h3>
              <p>{t('seo.mega.specs.serialBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.mega.specs.timersTitle')}</h3>
              <p>{t('seo.mega.specs.timersBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.mega.specs.pwmTitle')}</h3>
              <p>{t('seo.mega.specs.pwmBody')}</p>
            </div>
          </div>
        </section>

        {/* Use cases */}
        <section className="seo-section">
          <h2>{t('seo.mega.uses.heading')}</h2>
          <p className="lead">{t('seo.mega.uses.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.mega.uses.printerTitle')}</h3>
              <p>{t('seo.mega.uses.printerBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.mega.uses.cncTitle')}</h3>
              <p>{t('seo.mega.uses.cncBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.mega.uses.ledTitle')}</h3>
              <p>{t('seo.mega.uses.ledBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.mega.uses.sensorTitle')}</h3>
              <p>{t('seo.mega.uses.sensorBody')}</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="seo-section">
          <h2>{t('seo.mega.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.mega.faq.q${k}`)}</dt>
                <dd>{t(`seo.mega.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div className="seo-bottom">
          <h2>{t('seo.mega.bottom.title')}</h2>
          <p>{t('seo.mega.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('arduino-mega-simulator', '/editor')}
          >
            {t('seo.mega.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
            <Link to={localize('/arduino-emulator')}>{t('seo.links.arduinoEmu')}</Link>
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.links.rpiPico')}</Link>
            <Link to={localize('/examples')}>{t('seo.links.examples')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
