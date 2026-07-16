/**
 * /raspberry-pi-simulator — SEO landing page
 * Target keywords: "raspberry pi simulator", "raspberry pi 3 emulator", "raspberry pi emulator online"
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/layout/AppHeader';
import { useLocalizedHref } from '../i18n/useLocalizedNavigate';
import { useSEO } from '../utils/useSEO';
import { getSeoMeta } from '../seoRoutes';
import { trackClickCTA } from '../utils/analytics';
import raspberryPi3Svg from '../assets/Raspberry_Pi_3_illustration.svg';
import './SEOPage.css';

const META = getSeoMeta('/raspberry-pi-simulator')!;

const FAQ_ITEMS = [
  {
    q: 'Can I simulate a Raspberry Pi 3 in my browser?',
    a: 'Yes. Velxio emulates a full Raspberry Pi 3B using QEMU raspi3b — ARM Cortex-A53 quad-core at 1.2 GHz running Raspberry Pi OS (Linux). You get a real terminal to run Python, bash, and system commands.',
  },
  {
    q: 'Is this Raspberry Pi simulator free?',
    a: 'Yes. Velxio is 100% free and open-source (GNU AGPLv3). No account, no subscription — simulate Raspberry Pi 3 code in your browser or self-host with Docker.',
  },
  {
    q: 'Can I run Python scripts on the Raspberry Pi simulator?',
    a: 'Yes. The emulated Raspberry Pi 3 runs full Raspberry Pi OS with Python 3 pre-installed. You can run Python scripts, use RPi.GPIO for GPIO control, install pip packages, and more.',
  },
  {
    q: 'What is the difference between Pi Pico and Pi 3 simulation?',
    a: 'Raspberry Pi Pico (RP2040) is a microcontroller — runs Arduino C++ code, no OS. Raspberry Pi 3 is a full Linux computer — runs Python, bash, and system services. Velxio supports both.',
  },
  {
    q: 'Does it support GPIO on Raspberry Pi 3?',
    a: 'Yes. The QEMU-emulated Raspberry Pi 3 supports GPIO via RPi.GPIO and gpiozero Python libraries. Control LEDs, read buttons, and interface with sensors from Python.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio — Free Raspberry Pi 3 Simulator',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free online Raspberry Pi 3 simulator with full ARM Cortex-A53 Linux emulation via QEMU. Run Python, bash, and RPi.GPIO in your browser — no Raspberry Pi hardware needed.',
    url: 'https://velxio.dev/raspberry-pi-simulator',
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
        name: 'Raspberry Pi Simulator',
        item: 'https://velxio.dev/raspberry-pi-simulator',
      },
    ],
  },
];

export const RaspberryPiSimulatorPage: React.FC = () => {
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
            src={raspberryPi3Svg}
            alt={t('seo.rpi.hero.imageAlt')}
            style={{ height: 140, marginBottom: 24 }}
          />
          <h1>
            {t('seo.rpi.hero.title')}
            <br />
            <span className="accent">{t('seo.rpi.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.rpi.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('rpi-simulator', '/editor')}
            >
              {t('seo.rpi.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/docs/raspberry-pi3-emulation')} className="seo-btn-secondary">
              {t('seo.rpi.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.rpi.hero.trust')}</p>
        </section>

        <section className="seo-section">
          <h2>{t('seo.rpi.what.heading')}</h2>
          <p className="lead">{t('seo.rpi.what.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.rpi.what.pythonTitle')}</h3>
              <p>{t('seo.rpi.what.pythonBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.rpi.what.gpioTitle')}</h3>
              <p>{t('seo.rpi.what.gpioBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.rpi.what.linuxTitle')}</h3>
              <p>{t('seo.rpi.what.linuxBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.rpi.what.armTitle')}</h3>
              <p>{t('seo.rpi.what.armBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.rpi.what.sdTitle')}</h3>
              <p>{t('seo.rpi.what.sdBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.rpi.what.multiTitle')}</h3>
              <p>{t('seo.rpi.what.multiBody')}</p>
            </div>
          </div>
        </section>

        <section className="seo-section">
          <h2>{t('seo.rpi.compare.heading')}</h2>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.rpi.compare.picoTitle')}</h3>
              <p>
                {t('seo.rpi.compare.picoBodyPrefix')}
                <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.rpi.compare.picoLink')} →</Link>
              </p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.rpi.compare.pi3Title')}</h3>
              <p>{t('seo.rpi.compare.pi3Body')}</p>
            </div>
          </div>
        </section>

        <section className="seo-section">
          <h2>{t('seo.rpi.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.rpi.faq.q${k}`)}</dt>
                <dd>{t(`seo.rpi.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        <div className="seo-bottom">
          <h2>{t('seo.rpi.bottom.title')}</h2>
          <p>{t('seo.rpi.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('rpi-simulator', '/editor')}
          >
            {t('seo.rpi.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.links.pico')}</Link>
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
            <Link to={localize('/docs/raspberry-pi3-emulation')}>{t('seo.links.pi3Docs')}</Link>
            <Link to={localize('/examples')}>{t('seo.links.examplesPlain')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
