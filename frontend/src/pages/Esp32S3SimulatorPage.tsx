/**
 * /esp32-s3-simulator — SEO landing page
 * Target keywords: "esp32-s3 simulator", "esp32 s3 emulator"
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/layout/AppHeader';
import { useLocalizedHref } from '../i18n/useLocalizedNavigate';
import { useSEO } from '../utils/useSEO';
import { getSeoMeta } from '../seoRoutes';
import { trackClickCTA } from '../utils/analytics';
const esp32S3SvgUrl = '/boards/esp32-s3.svg';
import './SEOPage.css';

const META = getSeoMeta('/esp32-s3-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'What is the ESP32-S3?',
    a: 'The ESP32-S3 is an Xtensa LX7 dual-core microcontroller by Espressif running at 240 MHz. It adds USB OTG, vector instructions for AI/ML, and up to 45 GPIO pins compared to the original ESP32.',
  },
  {
    q: 'Is the ESP32-S3 simulator free?',
    a: 'Yes. Velxio is 100% free and open-source. Simulate ESP32-S3 code in your browser with real Xtensa LX7 emulation via QEMU — no cloud, no subscription.',
  },
  {
    q: 'Which ESP32-S3 boards are supported?',
    a: 'Velxio supports ESP32-S3 DevKitC-1, Seeed XIAO ESP32-S3, and Arduino Nano ESP32 (which uses the ESP32-S3 chip).',
  },
  {
    q: 'Can I use Arduino libraries with ESP32-S3?',
    a: 'Yes. Velxio compiles your sketch with the official ESP32 Arduino core. Install any library from the Arduino Library Manager and use it in your ESP32-S3 project.',
  },
  {
    q: 'What is the difference between ESP32 and ESP32-S3?',
    a: 'The ESP32-S3 uses the newer Xtensa LX7 architecture (vs LX6), adds USB OTG for native USB device support, includes vector instructions for AI workloads, and has more GPIO pins (45 vs 34).',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio — Free ESP32-S3 Simulator',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free online ESP32-S3 simulator with real Xtensa LX7 emulation via QEMU at 240 MHz. Simulate ESP32-S3 DevKitC, XIAO ESP32-S3, and Arduino Nano ESP32.',
    url: 'https://velxio.dev/esp32-s3-simulator',
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
      {
        '@type': 'ListItem',
        position: 2,
        name: 'ESP32-S3 Simulator',
        item: 'https://velxio.dev/esp32-s3-simulator',
      },
    ],
  },
];

export const Esp32S3SimulatorPage: React.FC = () => {
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
            src={esp32S3SvgUrl}
            alt={t('seo.esp32s3.hero.imageAlt')}
            style={{ height: 120, marginBottom: 24 }}
          />
          <h1>
            {t('seo.esp32s3.hero.title')}
            <br />
            <span className="accent">{t('seo.esp32s3.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.esp32s3.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('esp32-s3-simulator', '/editor')}
            >
              {t('seo.esp32s3.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.esp32s3.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.esp32s3.hero.trust')}</p>
        </section>

        <section className="seo-section">
          <h2>{t('seo.esp32s3.boards.heading')}</h2>
          <p className="lead">{t('seo.esp32s3.boards.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.esp32s3.boards.devkitTitle')}</h3>
              <p>{t('seo.esp32s3.boards.devkitBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32s3.boards.xiaoTitle')}</h3>
              <p>{t('seo.esp32s3.boards.xiaoBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32s3.boards.nanoTitle')}</h3>
              <p>{t('seo.esp32s3.boards.nanoBody')}</p>
            </div>
          </div>
        </section>

        <section className="seo-section">
          <h2>{t('seo.esp32s3.diff.heading')}</h2>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.esp32s3.diff.cpuTitle')}</h3>
              <p>{t('seo.esp32s3.diff.cpuBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32s3.diff.usbTitle')}</h3>
              <p>{t('seo.esp32s3.diff.usbBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32s3.diff.vectorTitle')}</h3>
              <p>{t('seo.esp32s3.diff.vectorBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32s3.diff.gpioTitle')}</h3>
              <p>{t('seo.esp32s3.diff.gpioBody')}</p>
            </div>
          </div>
        </section>

        <section className="seo-section">
          <h2>{t('seo.esp32s3.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.esp32s3.faq.q${k}`)}</dt>
                <dd>{t(`seo.esp32s3.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        <div className="seo-bottom">
          <h2>{t('seo.esp32s3.bottom.title')}</h2>
          <p>{t('seo.esp32s3.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('esp32-s3-simulator', '/editor')}
          >
            {t('seo.esp32s3.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/esp32-c3-simulator')}>{t('seo.links.esp32c3')}</Link>
            <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.links.rpiPico')}</Link>
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
            <Link to={localize('/docs/esp32-emulation')}>{t('seo.links.esp32Docs')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
