/**
 * /esp32-simulator — SEO landing page
 * Target keywords: "esp32 simulator", "esp32 emulator", "esp32 emulator online"
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/layout/AppHeader';
import { useLocalizedHref } from '../i18n/useLocalizedNavigate';
import { useSEO } from '../utils/useSEO';
import { getSeoMeta } from '../seoRoutes';
import { trackClickCTA } from '../utils/analytics';
const esp32SvgUrl = '/boards/esp32-devkit-v1.svg';
import './SEOPage.css';

const META = getSeoMeta('/esp32-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'Is this ESP32 simulator free?',
    a: 'Yes. Velxio is completely free and open-source (GNU AGPLv3). Simulate ESP32 code in your browser or self-host the entire platform with one Docker command — no account, no payment.',
  },
  {
    q: 'How does the ESP32 emulation work?',
    a: 'Velxio uses QEMU (lcgamboa fork) to emulate the Xtensa LX6 CPU at 240 MHz. Your Arduino sketch is compiled with the official ESP32 Arduino core and the resulting firmware runs on the emulated hardware — same as real silicon.',
  },
  {
    q: 'Which ESP32 boards are supported?',
    a: 'Velxio supports ESP32 DevKit V1, ESP32 DevKit C V4, ESP32-CAM, Arduino Nano ESP32, ESP32-S3 DevKitC, XIAO ESP32-S3, ESP32-C3 DevKit, XIAO ESP32-C3, and ESP32-C3 SuperMini.',
  },
  {
    q: 'Can I simulate ESP32 with sensors and displays?',
    a: 'Yes. Connect 48+ interactive components: DHT22, HC-SR04 ultrasonic, MPU6050 IMU, servo motors, ILI9341 TFT display, LEDs, buttons, 7-segment displays, and more.',
  },
  {
    q: 'Does it support Serial Monitor for ESP32?',
    a: 'Yes. The Serial Monitor works with ESP32 just like Arduino — auto baud-rate detection, real-time TX/RX output, and send commands back to your running sketch.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio — Free ESP32 Simulator & Emulator',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free online ESP32 simulator with real Xtensa LX6 emulation via QEMU. Simulate ESP32, ESP32-S3, and ESP32-CAM code with 48+ interactive components — no install, no account.',
    url: 'https://velxio.dev/esp32-simulator',
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
        name: 'ESP32 Simulator',
        item: 'https://velxio.dev/esp32-simulator',
      },
    ],
  },
];

export const Esp32SimulatorPage: React.FC = () => {
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
          <img
            src={esp32SvgUrl}
            alt={t('seo.esp32.hero.imageAlt')}
            style={{ height: 120, marginBottom: 24 }}
          />
          <h1>
            {t('seo.esp32.hero.title')}
            <br />
            <span className="accent">{t('seo.esp32.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.esp32.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('esp32-simulator', '/editor')}
            >
              {t('seo.esp32.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.esp32.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.esp32.hero.trust')}</p>
        </section>

        {/* Supported ESP32 boards */}
        <section className="seo-section">
          <h2>{t('seo.esp32.boards.heading')}</h2>
          <p className="lead">{t('seo.esp32.boards.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.esp32.boards.devkitTitle')}</h3>
              <p>{t('seo.esp32.boards.devkitBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32.boards.s3Title')}</h3>
              <p>{t('seo.esp32.boards.s3Body')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32.boards.camTitle')}</h3>
              <p>{t('seo.esp32.boards.camBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32.boards.nanoTitle')}</h3>
              <p>{t('seo.esp32.boards.nanoBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32.boards.xiaoTitle')}</h3>
              <p>{t('seo.esp32.boards.xiaoBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32.boards.c3Title')}</h3>
              <p>
                {t('seo.esp32.boards.c3BodyPrefix')}
                <Link to={localize('/esp32-c3-simulator')}>{t('seo.esp32.boards.c3Link')} →</Link>
              </p>
            </div>
          </div>
        </section>

        {/* Example projects */}
        <section className="seo-section">
          <h2>{t('seo.esp32.examples.heading')}</h2>
          <p className="lead">{t('seo.esp32.examples.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.esp32.examples.blinkTitle')}</h3>
              <p>{t('seo.esp32.examples.blinkBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32.examples.echoTitle')}</h3>
              <p>{t('seo.esp32.examples.echoBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32.examples.dhtTitle')}</h3>
              <p>{t('seo.esp32.examples.dhtBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32.examples.sonarTitle')}</h3>
              <p>{t('seo.esp32.examples.sonarBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32.examples.servoTitle')}</h3>
              <p>{t('seo.esp32.examples.servoBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32.examples.segTitle')}</h3>
              <p>{t('seo.esp32.examples.segBody')}</p>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.esp32.examples.viewAll')} →
            </Link>
          </div>
        </section>

        {/* FAQ */}
        <section className="seo-section">
          <h2>{t('seo.esp32.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.esp32.faq.q${k}`)}</dt>
                <dd>{t(`seo.esp32.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div className="seo-bottom">
          <h2>{t('seo.esp32.bottom.title')}</h2>
          <p>{t('seo.esp32.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('esp32-simulator', '/editor')}
          >
            {t('seo.esp32.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/examples')}>{t('seo.links.examples')}</Link>
            <Link to={localize('/docs/esp32-emulation')}>{t('seo.links.esp32Docs')}</Link>
            <Link to={localize('/esp32-c3-simulator')}>{t('seo.links.esp32c3')}</Link>
            <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.links.rpiPico')}</Link>
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
