/**
 * /electronics-simulator — SEO landing page
 * Target keywords: "electronics simulator", "online electronics simulator",
 * "free electronics simulator", "online breadboard"
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

const META = getSeoMeta('/electronics-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'Is Velxio a complete electronics simulator?',
    a: 'Yes. Velxio combines a SPICE-accurate analog solver, 19 simulated microcontrollers (Arduino, ESP32, RP2040, ATtiny85, Raspberry Pi 3), 100+ components, an oscilloscope, voltmeter, ammeter, and signal generator — everything you need to design and validate an electronics project end-to-end.',
  },
  {
    q: 'Can I use it like a virtual breadboard?',
    a: 'Yes. Drop components on the canvas, drag wires between pins, and the simulator builds the SPICE netlist automatically. Wires snap to a grid; components rotate in 90° increments; signal-type colours mark VCC, GND, digital, and analog routes.',
  },
  {
    q: 'Do I need to install anything?',
    a: 'No. Open velxio.dev in any modern browser and start. The SPICE solver and the AVR / RP2040 emulators run locally in your browser; Xtensa and RISC-V boards (ESP32, ESP32-C3, CH32V003) plus Raspberry Pi 3 Linux run through QEMU lcgamboa, bundled in the Docker image. Compilation of Arduino sketches uses the cloud arduino-cli backend.',
  },
  {
    q: 'Is it good for teaching electronics?',
    a: 'Yes — that is one of the design goals. Free, no install, no account, no licence cost. 100+ pre-wired example circuits cover voltage dividers, RC filters, op-amp amplifiers, transistor switches, rectifiers, and complete Arduino projects. Great for university labs and self-learners.',
  },
  {
    q: 'Is Velxio a Tinkercad / Falstad alternative?',
    a: 'Yes — and a more accurate one. Velxio runs real ngspice (the engine professional EDA tools use), and unlike those tools it also runs the firmware on the microcontroller driving the circuit. Open-source under AGPLv3.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio — Free Online Electronics Simulator',
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Electronics Simulator',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free online electronics simulator. SPICE-accurate analog parts wired to 19 simulated microcontrollers. 100+ components, oscilloscope, voltmeter, ammeter — your virtual breadboard.',
    url: 'https://velxio.dev/electronics-simulator',
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
        name: 'Electronics Simulator',
        item: 'https://velxio.dev/electronics-simulator',
      },
    ],
  },
];

export const ElectronicsSimulatorPage: React.FC = () => {
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
            {t('seo.electronics.hero.title')}
            <br />
            <span className="accent">{t('seo.electronics.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.electronics.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('electronics-simulator', '/editor')}
            >
              {t('seo.electronics.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.electronics.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.electronics.hero.trust')}</p>
        </section>

        {/* What's inside */}
        <section className="seo-section">
          <h2>{t('seo.electronics.inside.heading')}</h2>
          <p className="lead">{t('seo.electronics.inside.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.electronics.inside.spiceTitle')}</h3>
              <p>{t('seo.electronics.inside.spiceBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.electronics.inside.mcuTitle')}</h3>
              <p>{t('seo.electronics.inside.mcuBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.electronics.inside.chipsTitle')}</h3>
              <p>{t('seo.electronics.inside.chipsBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.electronics.inside.instrumentsTitle')}</h3>
              <p>{t('seo.electronics.inside.instrumentsBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.electronics.inside.componentsTitle')}</h3>
              <p>{t('seo.electronics.inside.componentsBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.electronics.inside.ideTitle')}</h3>
              <p>{t('seo.electronics.inside.ideBody')}</p>
            </div>
          </div>
        </section>

        {/* For teachers / students */}
        <section className="seo-section">
          <h2>{t('seo.electronics.audience.heading')}</h2>
          <p className="lead">{t('seo.electronics.audience.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.electronics.audience.coursesTitle')}</h3>
              <p>{t('seo.electronics.audience.coursesBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.electronics.audience.labsTitle')}</h3>
              <p>{t('seo.electronics.audience.labsBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.electronics.audience.makersTitle')}</h3>
              <p>{t('seo.electronics.audience.makersBody')}</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="seo-section">
          <h2>{t('seo.electronics.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.electronics.faq.q${k}`)}</dt>
                <dd>{t(`seo.electronics.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div className="seo-bottom">
          <h2>{t('seo.electronics.bottom.title')}</h2>
          <p>{t('seo.electronics.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('electronics-simulator', '/editor')}
          >
            {t('seo.electronics.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/circuit-simulator')}>{t('seo.links.circuit')}</Link>
            <Link to={localize('/spice-simulator')}>{t('seo.links.spice')}</Link>
            <Link to={localize('/v2-5')}>{t('seo.links.v25')}</Link>
            <Link to={localize('/examples')}>{t('seo.links.examplesAll')}</Link>
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.links.rpiPico')}</Link>
            <Link to={localize('/attiny85-simulator')}>{t('seo.links.attiny85')}</Link>
            <Link to={localize('/custom-chip-simulator')}>{t('seo.links.customChip')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
