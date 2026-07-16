/**
 * /spice-simulator — SEO landing page
 * Target keywords: "spice simulator online", "ngspice browser",
 * "free spice simulator", "spice in browser"
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

const META = getSeoMeta('/spice-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'Is this real ngspice running in my browser?',
    a: 'Yes. Velxio loads ngspice compiled to WebAssembly via the open-source eecircuit-engine. The same SPICE engine that powers professional EDA workflows runs in your browser tab — no server, no install.',
  },
  {
    q: 'What kind of analysis does it run?',
    a: 'Real-time transient analysis. The solver runs Modified Nodal Analysis on every tick (~60 Hz) so you see waveforms evolve as the circuit runs. Non-linear devices iterate to convergence at every step.',
  },
  {
    q: 'Which SPICE device models are supported?',
    a: 'Resistors, capacitors, inductors, ideal voltage and current sources, diodes (1N4148, 1N4007, 1N5817, 1N5819, Zener 1N4733), BJTs (2N2222, 2N3055, 2N3906, BC547, BC557), MOSFETs (2N7000, IRF540, IRF9540, FQP27P06 — Level 3 model), op-amps (LM358, LM741, TL072, LM324, ideal) with saturation rails, linear regulators (7805, 7812, 7905, LM317), optocouplers (4N25, PC817), and relay coils with inductance.',
  },
  {
    q: 'Can I write raw SPICE netlists?',
    a: 'Velxio builds the netlist for you from the schematic — wire components on the canvas and the simulator generates the SPICE cards. You don’t have to handwrite netlists, but the underlying engine is full ngspice and accepts standard device cards.',
  },
  {
    q: 'Does it include instruments?',
    a: 'Yes — multi-channel oscilloscope, voltmeter, ammeter, and signal generator (sine / square / DC, configurable frequency, amplitude, offset). All instruments probe live SPICE node voltages and branch currents.',
  },
  {
    q: 'Can SPICE talk to a microcontroller?',
    a: 'Yes. This is the unique feature. Arduino / ESP32 / RP2040 / ATtiny85 GPIOs drive SPICE voltage sources; ADC inputs read solved node voltages. Build a real firmware-driven analog signal chain end-to-end in one tool.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio — Free Online SPICE Simulator (ngspice-WASM)',
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'SPICE Circuit Simulator',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free online SPICE simulator running ngspice in WebAssembly. Real device models, full Modified Nodal Analysis, live oscilloscope and meters. Co-simulates with Arduino, ESP32, RP2040, and ATtiny85 firmware.',
    url: 'https://velxio.dev/spice-simulator',
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
        name: 'SPICE Simulator',
        item: 'https://velxio.dev/spice-simulator',
      },
    ],
  },
];

export const SpiceSimulatorPage: React.FC = () => {
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
            {t('seo.spice.hero.title')}
            <br />
            <span className="accent">{t('seo.spice.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.spice.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('spice-simulator', '/editor')}
            >
              {t('seo.spice.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/v2-5')} className="seo-btn-secondary">
              {t('seo.spice.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.spice.hero.trust')}</p>
        </section>

        {/* Why */}
        <section className="seo-section">
          <h2>{t('seo.spice.why.heading')}</h2>
          <p className="lead">{t('seo.spice.why.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.spice.why.realTitle')}</h3>
              <p>{t('seo.spice.why.realBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.spice.why.noServerTitle')}</h3>
              <p>{t('seo.spice.why.noServerBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.spice.why.coTitle')}</h3>
              <p>{t('seo.spice.why.coBody')}</p>
            </div>
          </div>
        </section>

        {/* Devices */}
        <section className="seo-section">
          <h2>{t('seo.spice.devices.heading')}</h2>
          <p className="lead">{t('seo.spice.devices.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.spice.devices.passivesTitle')}</h3>
              <p>{t('seo.spice.devices.passivesBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.spice.devices.diodesTitle')}</h3>
              <p>{t('seo.spice.devices.diodesBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.spice.devices.bjtTitle')}</h3>
              <p>{t('seo.spice.devices.bjtBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.spice.devices.mosfetTitle')}</h3>
              <p>{t('seo.spice.devices.mosfetBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.spice.devices.opampTitle')}</h3>
              <p>{t('seo.spice.devices.opampBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.spice.devices.regulatorsTitle')}</h3>
              <p>{t('seo.spice.devices.regulatorsBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.spice.devices.logicTitle')}</h3>
              <p>{t('seo.spice.devices.logicBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.spice.devices.powerTitle')}</h3>
              <p>{t('seo.spice.devices.powerBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.spice.devices.sourcesTitle')}</h3>
              <p>{t('seo.spice.devices.sourcesBody')}</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="seo-section">
          <h2>{t('seo.spice.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.spice.faq.q${k}`)}</dt>
                <dd>{t(`seo.spice.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div className="seo-bottom">
          <h2>{t('seo.spice.bottom.title')}</h2>
          <p>{t('seo.spice.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('spice-simulator', '/editor')}
          >
            {t('seo.spice.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/circuit-simulator')}>{t('seo.links.circuit')}</Link>
            <Link to={localize('/electronics-simulator')}>{t('seo.links.electronics')}</Link>
            <Link to={localize('/v2-5')}>{t('seo.links.v25')}</Link>
            <Link to={localize('/examples')}>{t('seo.links.examplesAnalog')}</Link>
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/custom-chip-simulator')}>{t('seo.links.customChip')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
