/**
 * /circuit-simulator — SEO landing page
 * Target keywords: "circuit simulator", "online circuit simulator",
 * "free circuit simulator", "browser circuit simulator"
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

const META = getSeoMeta('/circuit-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'Is this circuit simulator really free?',
    a: 'Yes. Velxio is fully free and open-source under the GNU AGPLv3 license. No account required, no cloud subscription, no paywalled components — every part of the simulator runs in your browser.',
  },
  {
    q: 'What kind of analog simulation does Velxio use?',
    a: 'Velxio runs ngspice — the open-source SPICE simulator used by professional EDA tools — compiled to WebAssembly via eecircuit-engine. Each tick performs a full Modified Nodal Analysis solve, so non-linear devices (diodes, BJTs, MOSFETs, op-amps with saturation) behave like real silicon, not idealised approximations.',
  },
  {
    q: 'Can I connect a microcontroller to my circuit?',
    a: 'Yes — and this is the unique feature. GPIO pins drive SPICE nets as voltage sources, and ADC inputs read the solved analog node voltages back into your firmware. You can build a PWM-driven RC filter, a transistor switch, an op-amp signal chain, or a MOSFET motor driver and watch the firmware and circuit interact in real time.',
  },
  {
    q: 'What components are available?',
    a: 'Resistors, capacitors, inductors, potentiometers, photoresistors (LDR), photodiodes, NTC thermistors, batteries (9V/AA/coin), 5 BJTs (2N2222, 2N3055, 2N3906, BC547, BC557), 4 MOSFETs (2N7000, IRF540, IRF9540, FQP27P06), 5 op-amps (LM358, LM741, TL072, LM324, ideal), 4 linear regulators (7805, 7812, 7905, LM317), Zener and Schottky diodes, optocouplers (4N25, PC817), relays, L293D dual H-bridge driver, and 7 logic gates plus 7 74HC-series ICs as DIP-14 packages.',
  },
  {
    q: 'Does the simulator have an oscilloscope and voltmeter?',
    a: 'Yes. Velxio includes a multi-channel oscilloscope, voltmeter, ammeter, and signal generator (sine, square, DC) as live instruments you can drop on the canvas. They probe any node or wire and update in real time as the simulation runs.',
  },
  {
    q: 'Is this a Falstad / CircuitLab / Tinkercad alternative?',
    a: 'For analog circuits, yes — and a more accurate one, since Velxio runs the real ngspice engine instead of a simplified solver. Unlike those tools, Velxio also runs the firmware on the microcontroller driving the circuit, so you can validate firmware + hardware together without leaving the browser.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio — Free Online Circuit Simulator',
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Electronics Simulator',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free online circuit simulator with real-time SPICE analog simulation via ngspice-WASM. 100+ components co-simulated with Arduino, ESP32, RP2040, and ATtiny85 firmware. Live oscilloscope, voltmeter, ammeter.',
    url: 'https://velxio.dev/circuit-simulator',
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
        name: 'Circuit Simulator',
        item: 'https://velxio.dev/circuit-simulator',
      },
    ],
  },
];

export const CircuitSimulatorPage: React.FC = () => {
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
            {t('seo.circuit.hero.title')}
            <br />
            <span className="accent">{t('seo.circuit.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.circuit.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('circuit-simulator', '/editor')}
            >
              {t('seo.circuit.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.circuit.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.circuit.hero.trust')}</p>
        </section>

        {/* What */}
        <section className="seo-section">
          <h2>{t('seo.circuit.what.heading')}</h2>
          <p className="lead">{t('seo.circuit.what.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.circuit.cards.passive.title')}</h3>
              <p>{t('seo.circuit.cards.passive.body')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.circuit.cards.diodes.title')}</h3>
              <p>{t('seo.circuit.cards.diodes.body')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.circuit.cards.bjt.title')}</h3>
              <p>{t('seo.circuit.cards.bjt.body')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.circuit.cards.opamp.title')}</h3>
              <p>{t('seo.circuit.cards.opamp.body')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.circuit.cards.logic.title')}</h3>
              <p>{t('seo.circuit.cards.logic.body')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.circuit.cards.power.title')}</h3>
              <p>{t('seo.circuit.cards.power.body')}</p>
            </div>
          </div>
        </section>

        {/* How */}
        <section className="seo-section">
          <h2>{t('seo.circuit.how.heading')}</h2>
          <p className="lead">
            {t('seo.circuit.how.leadPrefix')}
            <strong style={{ color: '#e6edf3' }}>{t('seo.circuit.how.leadHighlight')}</strong>
            {t('seo.circuit.how.leadMid')}
            <code>{t('seo.circuit.how.leadCode')}</code>
            {t('seo.circuit.how.leadSuffix')}
          </p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.circuit.how.wireTitle')}</h3>
              <p>{t('seo.circuit.how.wireBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.circuit.how.solveTitle')}</h3>
              <p>{t('seo.circuit.how.solveBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.circuit.how.probeTitle')}</h3>
              <p>{t('seo.circuit.how.probeBody')}</p>
            </div>
          </div>
        </section>

        {/* Co-simulation */}
        <section className="seo-section">
          <h2>{t('seo.circuit.co.heading')}</h2>
          <p className="lead">{t('seo.circuit.co.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.circuit.co.gpioTitle')}</h3>
              <p>
                <code>{t('seo.circuit.co.gpioBodyCode')}</code>
                {t('seo.circuit.co.gpioBodySuffix')}
              </p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.circuit.co.adcTitle')}</h3>
              <p>
                <code>{t('seo.circuit.co.adcBodyCode')}</code>
                {t('seo.circuit.co.adcBodySuffix')}
              </p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.circuit.co.sameTitle')}</h3>
              <p>{t('seo.circuit.co.sameBody')}</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="seo-section">
          <h2>{t('seo.circuit.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.circuit.faq.q${k}`)}</dt>
                <dd>{t(`seo.circuit.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div className="seo-bottom">
          <h2>{t('seo.circuit.bottom.title')}</h2>
          <p>{t('seo.circuit.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('circuit-simulator', '/editor')}
          >
            {t('seo.circuit.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/spice-simulator')}>{t('seo.links.spice')}</Link>
            <Link to={localize('/electronics-simulator')}>{t('seo.links.electronics')}</Link>
            <Link to={localize('/v2-5')}>{t('seo.links.v25')}</Link>
            <Link to={localize('/examples')}>{t('seo.links.examplesAnalog')}</Link>
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.links.rpiPico')}</Link>
            <Link to={localize('/custom-chip-simulator')}>{t('seo.links.customChip')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
