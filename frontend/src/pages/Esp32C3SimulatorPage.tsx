/**
 * /esp32-c3-simulator — SEO landing page
 * Target keywords: "esp32-c3 simulator", "risc-v simulator", "esp32 c3 emulator"
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/layout/AppHeader';
import { useLocalizedHref } from '../i18n/useLocalizedNavigate';
import { useSEO } from '../utils/useSEO';
import { getSeoMeta } from '../seoRoutes';
import { trackClickCTA } from '../utils/analytics';
const esp32C3SvgUrl = '/boards/esp32-c3.svg';
import './SEOPage.css';

const META = getSeoMeta('/esp32-c3-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'What is the ESP32-C3?',
    a: 'The ESP32-C3 is a RISC-V single-core microcontroller by Espressif running at 160 MHz (RV32IMC instruction set). It has WiFi + Bluetooth 5.0, 22 GPIO pins, and is one of the first RISC-V MCUs with a mature Arduino ecosystem.',
  },
  {
    q: 'Does the ESP32-C3 simulator run in the browser?',
    a: 'Yes. Unlike the Xtensa-based ESP32, the ESP32-C3 RISC-V emulation runs entirely in the browser — no QEMU backend needed. This makes it the fastest ESP32 variant to simulate.',
  },
  {
    q: 'Is this also a RISC-V simulator?',
    a: 'Yes. The ESP32-C3 uses the RISC-V RV32IMC instruction set. Velxio also supports the CH32V003 (RV32EC at 48 MHz) — another popular RISC-V microcontroller.',
  },
  {
    q: 'Which ESP32-C3 boards are supported?',
    a: 'Velxio supports ESP32-C3 DevKitM-1, Seeed XIAO ESP32-C3, and ESP32-C3 SuperMini (Aitewinrobot). All three use the same RISC-V core.',
  },
  {
    q: 'Can I use Arduino code with ESP32-C3?',
    a: 'Yes. Velxio compiles your .ino sketch using the official ESP32 Arduino core with the ESP32-C3 board target. All standard Arduino functions work — Serial, GPIO, analogRead, etc.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio — Free ESP32-C3 & RISC-V Simulator',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free online ESP32-C3 RISC-V simulator. RV32IMC emulation at 160 MHz via the QEMU lcgamboa backend (libqemu-riscv32). Simulate ESP32-C3 DevKit, XIAO ESP32-C3, SuperMini, and CH32V003.',
    url: 'https://velxio.dev/esp32-c3-simulator',
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
        name: 'ESP32-C3 Simulator',
        item: 'https://velxio.dev/esp32-c3-simulator',
      },
    ],
  },
];

export const Esp32C3SimulatorPage: React.FC = () => {
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
            src={esp32C3SvgUrl}
            alt={t('seo.esp32c3.hero.imageAlt')}
            style={{ height: 120, marginBottom: 24 }}
          />
          <h1>
            {t('seo.esp32c3.hero.title')}
            <br />
            <span className="accent">{t('seo.esp32c3.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.esp32c3.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('esp32-c3-simulator', '/editor')}
            >
              {t('seo.esp32c3.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.esp32c3.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.esp32c3.hero.trust')}</p>
        </section>

        <section className="seo-section">
          <h2>{t('seo.esp32c3.boards.heading')}</h2>
          <p className="lead">{t('seo.esp32c3.boards.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.esp32c3.boards.devkitTitle')}</h3>
              <p>{t('seo.esp32c3.boards.devkitBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32c3.boards.xiaoTitle')}</h3>
              <p>{t('seo.esp32c3.boards.xiaoBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32c3.boards.superTitle')}</h3>
              <p>{t('seo.esp32c3.boards.superBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32c3.boards.chTitle')}</h3>
              <p>{t('seo.esp32c3.boards.chBody')}</p>
            </div>
          </div>
        </section>

        <section className="seo-section">
          <h2>{t('seo.esp32c3.examples.heading')}</h2>
          <p className="lead">{t('seo.esp32c3.examples.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.esp32c3.examples.blinkTitle')}</h3>
              <p>{t('seo.esp32c3.examples.blinkBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32c3.examples.rgbTitle')}</h3>
              <p>{t('seo.esp32c3.examples.rgbBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32c3.examples.buttonTitle')}</h3>
              <p>{t('seo.esp32c3.examples.buttonBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32c3.examples.dhtTitle')}</h3>
              <p>{t('seo.esp32c3.examples.dhtBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32c3.examples.sonarTitle')}</h3>
              <p>{t('seo.esp32c3.examples.sonarBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.esp32c3.examples.servoTitle')}</h3>
              <p>{t('seo.esp32c3.examples.servoBody')}</p>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('seo.esp32c3.examples.viewAll')} →
            </Link>
          </div>
        </section>

        <section className="seo-section">
          <h2>{t('seo.esp32c3.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.esp32c3.faq.q${k}`)}</dt>
                <dd>{t(`seo.esp32c3.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        <div className="seo-bottom">
          <h2>{t('seo.esp32c3.bottom.title')}</h2>
          <p>{t('seo.esp32c3.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('esp32-c3-simulator', '/editor')}
          >
            {t('seo.esp32c3.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/esp32-s3-simulator')}>{t('seo.links.esp32s3')}</Link>
            <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.links.rpiPico')}</Link>
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
            <Link to={localize('/docs/riscv-emulation')}>{t('seo.links.riscvDocs')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
