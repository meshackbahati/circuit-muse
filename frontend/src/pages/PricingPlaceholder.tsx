/**
 * PricingPlaceholder — the route at /pricing.
 *
 * In the open-source build this renders a minimal heading + slot div. It
 * exists so that:
 *  1. Private overlays can portal-inject a real PricingPage into the slot
 *     (data-velxio-slot="pricing-page") without forking this file.
 *  2. Self-hosters who navigate to /pricing get a polite "this image
 *     doesn't sell anything" page rather than a 404.
 *
 * The route is registered in App.tsx. The slot pattern is the same as
 * data-velxio-slot="user-menu" / "admin-tabs" / "admin-tab-content".
 */

import { useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { AppHeader } from '../components/layout/AppHeader';

export const PricingPlaceholder = () => {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = 'Pricing — Velxio';
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#1e1e1e', color: '#e8e8e8' }}>
      <AppHeader />
      <div data-velxio-slot="pricing-page">
        {/* Default content — only visible if no overlay is mounted (i.e.
            self-hosted OSS image without a private pricing overlay). */}
        <main
          style={{
            maxWidth: 720,
            margin: '60px auto',
            padding: '0 24px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            lineHeight: 1.6,
          }}
        >
          <h1 style={{ marginTop: 0 }}>{t('pricing.title')}</h1>
          <p>{t('pricing.selfHosted')}</p>
          <p>
            <Trans
              i18nKey="pricing.hostedVersion"
              components={{
                link: (
                  <a
                    href="https://velxio.dev"
                    style={{ color: '#4fc3f7', textDecoration: 'none' }}
                  />
                ),
              }}
            />
          </p>
          <p style={{ color: '#888', fontSize: 13, marginTop: 32 }}>
            <Trans
              i18nKey="pricing.sourceCode"
              components={{
                link: (
                  <a
                    href="https://github.com/davidmonterocrespo24/velxio"
                    style={{ color: '#888' }}
                  />
                ),
              }}
            />
          </p>
        </main>
      </div>
    </div>
  );
};

export default PricingPlaceholder;
