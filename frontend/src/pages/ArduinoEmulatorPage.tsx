/**
 * /arduino-emulator — SEO landing page
 * Target keywords: "arduino emulator"
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

const META = getSeoMeta('/arduino-emulator')!;

const FAQ_ITEMS = [
  {
    q: 'What is an Arduino emulator?',
    a: 'An Arduino emulator reproduces the behavior of a physical Arduino microcontroller in software — CPU instruction execution, peripheral registers (GPIO, USART, ADC, timers, PWM), and interrupts — with no hardware required.',
  },
  {
    q: "How accurate is Velxio's Arduino emulation?",
    a: 'Velxio uses avr8js, which provides cycle-accurate AVR8 instruction emulation. Every AVR opcode is faithfully emulated at 16 MHz, making it reliable for developing and debugging real firmware before flashing to hardware.',
  },
  {
    q: 'Which Arduino boards can Velxio emulate?',
    a: 'Arduino Uno (ATmega328P), Arduino Nano, Arduino Mega 2560 (ATmega2560), ATtiny85 (AVR8), Arduino Leonardo (ATmega32u4), Arduino Pro Mini, Raspberry Pi Pico and Pico W (RP2040), and multiple ESP32/RISC-V boards. 19 boards across 5 CPU architectures.',
  },
  {
    q: 'What peripherals are emulated?',
    a: 'GPIO ports (PORTB, PORTC, PORTD), hardware timers (Timer0, Timer1, Timer2), 8/16-bit PWM, USART serial, 10-bit ADC (analog inputs), SPI, and I2C. All standard Arduino library functions work correctly.',
  },
  {
    q: 'How is Velxio different from Wokwi?',
    a: 'Velxio is fully self-hosted and open-source under GNU AGPLv3. It uses the same avr8js emulation library as Wokwi but runs entirely on your own machine — no cloud dependency, no registration, no subscription.',
  },
];

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Velxio Arduino Emulator',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (browser-based)',
    description:
      'Free, open-source Arduino emulator with cycle-accurate AVR8 emulation at 16 MHz. Emulate Arduino Uno, Nano, Mega and Raspberry Pi Pico in your browser — no cloud, no install.',
    url: 'https://velxio.dev/arduino-emulator',
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
        name: 'Arduino Emulator',
        item: 'https://velxio.dev/arduino-emulator',
      },
    ],
  },
];

export const ArduinoEmulatorPage: React.FC = () => {
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
            {t('seo.arduinoEmu.hero.title')}
            <br />
            <span className="accent">{t('seo.arduinoEmu.hero.accent')}</span>
          </h1>
          <p className="subtitle">{t('seo.arduinoEmu.hero.subtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('arduino-emulator', '/editor')}
            >
              {t('seo.arduinoEmu.hero.ctaPrimary')} →
            </Link>
            <Link to={localize('/docs/emulator')} className="seo-btn-secondary">
              {t('seo.arduinoEmu.hero.ctaSecondary')}
            </Link>
          </div>
          <p className="seo-trust">{t('seo.arduinoEmu.hero.trust')}</p>
        </section>

        {/* Emulation accuracy */}
        <section className="seo-section">
          <h2>{t('seo.arduinoEmu.accuracy.heading')}</h2>
          <p className="lead">
            {t('seo.arduinoEmu.accuracy.leadPrefix')}
            <strong style={{ color: '#e6edf3' }}>{t('seo.arduinoEmu.accuracy.leadAvr')}</strong>
            {t('seo.arduinoEmu.accuracy.leadMid')}
            <strong style={{ color: '#e6edf3' }}>{t('seo.arduinoEmu.accuracy.leadRp')}</strong>
            {t('seo.arduinoEmu.accuracy.leadSuffix')}
          </p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.arduinoEmu.accuracy.isaTitle')}</h3>
              <p>{t('seo.arduinoEmu.accuracy.isaBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduinoEmu.accuracy.timersTitle')}</h3>
              <p>
                {t('seo.arduinoEmu.accuracy.timersBodyPrefix')}
                <code>{t('seo.arduinoEmu.accuracy.timersBodyCode1')}</code>
                {t('seo.arduinoEmu.accuracy.timersBodyMid')}
                <code>{t('seo.arduinoEmu.accuracy.timersBodyCode2')}</code>
                {t('seo.arduinoEmu.accuracy.timersBodySuffix')}
              </p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduinoEmu.accuracy.usartTitle')}</h3>
              <p>
                {t('seo.arduinoEmu.accuracy.usartBodyPrefix')}
                <code>{t('seo.arduinoEmu.accuracy.usartBodyCode')}</code>
                {t('seo.arduinoEmu.accuracy.usartBodySuffix')}
              </p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduinoEmu.accuracy.adcTitle')}</h3>
              <p>
                {t('seo.arduinoEmu.accuracy.adcBodyPrefix')}
                <code>{t('seo.arduinoEmu.accuracy.adcBodyCode')}</code>
                {t('seo.arduinoEmu.accuracy.adcBodySuffix')}
              </p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduinoEmu.accuracy.rpTitle')}</h3>
              <p>{t('seo.arduinoEmu.accuracy.rpBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduinoEmu.accuracy.riscvTitle')}</h3>
              <p>{t('seo.arduinoEmu.accuracy.riscvBody')}</p>
            </div>
          </div>
        </section>

        {/* Supported boards */}
        <section className="seo-section">
          <h2>{t('seo.arduinoEmu.boards.heading')}</h2>
          <p className="lead">{t('seo.arduinoEmu.boards.lead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('seo.arduinoEmu.boards.avrTitle')}</h3>
              <p>{t('seo.arduinoEmu.boards.avrBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduinoEmu.boards.rpTitle')}</h3>
              <p>{t('seo.arduinoEmu.boards.rpBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduinoEmu.boards.riscvTitle')}</h3>
              <p>{t('seo.arduinoEmu.boards.riscvBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduinoEmu.boards.xtensaTitle')}</h3>
              <p>{t('seo.arduinoEmu.boards.xtensaBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('seo.arduinoEmu.boards.armTitle')}</h3>
              <p>{t('seo.arduinoEmu.boards.armBody')}</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="seo-section">
          <h2>{t('seo.arduinoEmu.faq.heading')}</h2>
          <dl className="seo-faq">
            {faqKeys.map((k) => (
              <React.Fragment key={k}>
                <dt>{t(`seo.arduinoEmu.faq.q${k}`)}</dt>
                <dd>{t(`seo.arduinoEmu.faq.a${k}`)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div className="seo-bottom">
          <h2>{t('seo.arduinoEmu.bottom.title')}</h2>
          <p>{t('seo.arduinoEmu.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('arduino-emulator', '/editor')}
          >
            {t('seo.arduinoEmu.bottom.cta')} →
          </Link>
          <div className="seo-internal-links">
            <Link to={localize('/arduino-simulator')}>{t('seo.links.arduino')}</Link>
            <Link to={localize('/atmega328p-simulator')}>{t('seo.links.atmega')}</Link>
            <Link to={localize('/esp32-simulator')}>{t('seo.links.esp32')}</Link>
            <Link to={localize('/raspberry-pi-pico-simulator')}>{t('seo.links.rpiPico')}</Link>
            <Link to={localize('/examples')}>{t('seo.links.examples')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
