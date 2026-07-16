/**
 * /raspberry-pi-pico-simulator — SEO landing page
 * Target keywords: "raspberry pi pico simulator", "rp2040 emulator", "rp2040 simulator"
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/layout/AppHeader';
import { useLocalizedHref } from '../i18n/useLocalizedNavigate';
import { useSEO } from '../utils/useSEO';
import { getSeoMeta } from '../seoRoutes';
import { trackClickCTA } from '../utils/analytics';
const piPicoSvgUrl = '/boards/pi-pico.svg';
import './SEOPage.css';

const META = getSeoMeta('/raspberry-pi-pico-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'Is this Raspberry Pi Pico simulator free?',
    a: 'Yes. Velxio is completely free and open-source (GNU AGPLv3). Simulate RP2040 code in your browser — no Raspberry Pi hardware needed, no account, no payment.',
  },
  {
    q: 'How does the RP2040 emulation work?',
    a: 'Velxio uses rp2040js — the open-source RP2040 emulator — to simulate the ARM Cortex-M0+ CPU at 133 MHz. Your code is compiled with the official Arduino-Pico core by Earle Philhower.',
  },
  {
    q: 'Does it support Raspberry Pi Pico W?',
    a: 'Yes. Both Raspberry Pi Pico and Pico W are supported. The RP2040 core emulation is identical — WiFi features are planned for a future update.',
  },
  {
    q: 'Can I use Arduino code with Raspberry Pi Pico?',
    a: 'Yes. Velxio compiles your .ino sketch using the arduino-pico core (by Earle Philhower). Standard Arduino functions like Serial, digitalWrite, analogRead, and I2C/SPI work out of the box.',
  },
  {
    q: 'What components work with Pico simulation?',
    a: 'All 48+ components: LEDs, resistors, buttons, DHT22, HC-SR04, servo motors, 7-segment displays, RGB LEDs, NTC sensors, joysticks, and more. Wire them to any of the 26 GPIO pins.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: META.title.split(' | ')[0],
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (browser-based)',
    description: META.description,
    url: META.url,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@type': 'Person', name: 'David Montero Crespo' },
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
      { '@type': 'ListItem', position: 2, name: 'Raspberry Pi Pico Simulator', item: META.url },
    ],
  },
];

export const RaspberryPiPicoSimulatorPage: React.FC = () => {
  const { t } = useTranslation();
  const localize = useLocalizedHref();
  useSEO({ ...META, jsonLd: JSON_LD });

  const faqKeys = ['1', '2', '3', '4', '5'] as const;

  return (
    <div className="seo-page">
      <AppHeader />
      <main>
        <section className="seo-hero">
          <img
            src={piPicoSvgUrl}
            alt={t('seo.pico.hero.imageAlt')}
            style={{ height: 120, marginBottom: 24 }}
          />
          <h1>
            {t('seo.pico.hero.title')}
            <br />
            <span className="accent">{t('seo.pico.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.pico.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('rpi-pico-simulator', '/editor')}
            >
              {t('seo.pico.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.pico.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.pico.hero.trust')}</p>
        </section>

        <section className="seo-section">
          <h2>{t('seo.pico.boards.heading')}</h2>
          <p className="lead">{t('seo.pico.boards.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.pico.boards.picoTitle')}</h3>
              <p>{t('seo.pico.boards.picoBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.pico.boards.picoWTitle')}</h3>
              <p>{t('seo.pico.boards.picoWBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.pico.boards.specsTitle')}</h3>
              <p>{t('seo.pico.boards.specsBody')}</p>
            </div>
          </div>
        </section>

        <section className="seo-section">
          <h2>{t('seo.pico.examples.heading')}</h2>
          <p className="lead">{t('seo.pico.examples.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.pico.examples.blinkTitle')}</h3>
              <p>{t('seo.pico.examples.blinkBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.pico.examples.echoTitle')}</h3>
              <p>{t('seo.pico.examples.echoBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.pico.examples.i2cTitle')}</h3>
              <p>{t('seo.pico.examples.i2cBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.pico.examples.adcTitle')}</h3>
              <p>{t('seo.pico.examples.adcBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.pico.examples.dhtTitle')}</h3>
              <p>{t('seo.pico.examples.dhtBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.pico.examples.servoTitle')}</h3>
              <p>{t('seo.pico.examples.servoBody')}</p>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.pico.examples.viewAll')} →
            </Link>
          </div>
        </section>

        <section className="seo-section">
          <h2>{t('seo.pico.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.pico.faq.q${k}`)}</dt>
                <dd>{t(`seo.pico.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        <div className="seo-bottom">
          <h2>{t('seo.pico.bottom.title')}</h2>
          <p>{t('seo.pico.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('rpi-pico-simulator', '/editor')}
          >
            {t('seo.pico.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/examples')}>{t('seo.links.examples')}</Link>
            <Link to={localize('/docs/rp2040-emulation')}>{t('seo.links.rp2040Docs')}</Link>
            <Link to={localize('/raspberry-pi-simulator')}>{t('seo.links.rpi')}</Link>
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
