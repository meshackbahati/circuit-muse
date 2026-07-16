/**
 * /custom-chip-simulator — SEO landing page
 * Target keywords: "custom chip simulator", "custom chip arduino",
 * "wokwi custom chips", "build custom ic"
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

const META = getSeoMeta('/custom-chip-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'What is a custom chip in Velxio?',
    a: 'A custom chip is a user-defined integrated circuit. You write the chip\'s logic in C, Rust, or AssemblyScript — Velxio compiles it to WebAssembly, instantiates it on the canvas like any other component, and drives its pins from the simulator.',
  },
  {
    q: 'Which API does Velxio use?',
    a: 'Velxio implements the Wokwi Custom Chips API — the same API used by Wokwi — so chips you write for Velxio are portable to Wokwi and vice versa. Velxio adds a WASI shim so you can use standard library functions in your chip code.',
  },
  {
    q: 'What can I build?',
    a: 'Behavioural models of real ICs (sensors, decoders, level translators, protocol bridges), custom digital logic, sensor stand-ins for hardware you don\'t have yet, and protocol-level mocks for testing firmware. Chips can drive pins, read attributes, register timers, and bridge to I²C / SPI buses.',
  },
  {
    q: 'How do I share or reuse a chip?',
    a: 'Save the chip to your Velxio account and reuse it across projects. The chip definition includes its pin layout, attributes, and the compiled WASM — drop it onto any project canvas like a built-in component.',
  },
  {
    q: 'Do I need a backend to run my chip?',
    a: 'No. Compiled chip WASM runs in the same browser tab as the rest of the simulation. Pin updates, attribute reads, and timer ticks are all local.',
  },
  {
    q: 'Can my custom chip talk to an Arduino?',
    a: 'Yes — that is the typical use case. Wire its pins to Arduino GPIOs, SPI, or I²C lines and the firmware on the Arduino interacts with your chip exactly like a real IC.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio — Free Online Custom Chip Simulator',
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'IC Authoring & Simulation',
    operatingSystem: 'Any (browser-based)',
    description:
      'Define your own integrated circuits in C, Rust, or AssemblyScript using the Wokwi-compatible Custom Chips API. Compile to WebAssembly and drive pins, attributes, timers, I²C and SPI from your simulated chip. Free and open-source.',
    url: 'https://velxio.dev/custom-chip-simulator',
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
        name: 'Custom Chip Simulator',
        item: 'https://velxio.dev/custom-chip-simulator',
      },
    ],
  },
];

export const CustomChipSimulatorPage: React.FC = () => {
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
            {t('seo.customChip.hero.title')}
            <br />
            <span className="accent">{t('seo.customChip.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.customChip.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('custom-chip-simulator', '/editor')}
            >
              {t('seo.customChip.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/docs/intro')} className="seo-btn-secondary">
              {t('seo.customChip.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.customChip.hero.trust')}</p>
        </section>

        {/* What you can do */}
        <section className="seo-section">
          <h2>{t('seo.customChip.build.heading')}</h2>
          <p className="lead">{t('seo.customChip.build.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.customChip.build.sensorTitle')}</h3>
              <p>{t('seo.customChip.build.sensorBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.customChip.build.bridgeTitle')}</h3>
              <p>{t('seo.customChip.build.bridgeBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.customChip.build.logicTitle')}</h3>
              <p>{t('seo.customChip.build.logicBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.customChip.build.icTitle')}</h3>
              <p>{t('seo.customChip.build.icBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.customChip.build.fixturesTitle')}</h3>
              <p>{t('seo.customChip.build.fixturesBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.customChip.build.reuseTitle')}</h3>
              <p>{t('seo.customChip.build.reuseBody')}</p>
            </div>
          </div>
        </section>

        {/* API capabilities */}
        <section className="seo-section">
          <h2>{t('seo.customChip.api.heading')}</h2>
          <p className="lead">{t('seo.customChip.api.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.customChip.api.pinTitle')}</h3>
              <p>{t('seo.customChip.api.pinBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.customChip.api.attrTitle')}</h3>
              <p>{t('seo.customChip.api.attrBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.customChip.api.timersTitle')}</h3>
              <p>{t('seo.customChip.api.timersBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.customChip.api.i2cTitle')}</h3>
              <p>{t('seo.customChip.api.i2cBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.customChip.api.spiTitle')}</h3>
              <p>{t('seo.customChip.api.spiBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.customChip.api.wasiTitle')}</h3>
              <p>{t('seo.customChip.api.wasiBody')}</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="seo-section">
          <h2>{t('seo.customChip.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.customChip.faq.q${k}`)}</dt>
                <dd>{t(`seo.customChip.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div className="seo-bottom">
          <h2>{t('seo.customChip.bottom.title')}</h2>
          <p>{t('seo.customChip.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('custom-chip-simulator', '/editor')}
          >
            {t('seo.customChip.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/circuit-simulator')}>{t('seo.links.circuit')}</Link>
            <Link to={localize('/spice-simulator')}>{t('seo.links.spice')}</Link>
            <Link to={localize('/electronics-simulator')}>{t('seo.links.electronics')}</Link>
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.links.rpiPico')}</Link>
            <Link to={localize('/attiny85-simulator')}>{t('seo.links.attiny85')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
