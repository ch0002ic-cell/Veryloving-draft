import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { LoadingState } from '../src/components/LoadingState';
import { shareQuickLocation } from '../src/services/emergency';
import { requestCurrentLocation } from '../src/services/mapbox';
import { useI18n } from '../src/context/I18nContext';
import { logger } from '../src/utils/logger';

export default function QuickShareLocation() {
  const { t } = useI18n();
  const mountedRef = useRef(true);
  const startedRef = useRef(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);

  const shareLocation = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const location = await requestCurrentLocation();
      await shareQuickLocation(location);
    } catch (shareError) {
      logger.warn('[QuickShare] Could not share a location snapshot', {
        errorCode: shareError?.code || shareError?.name || 'LOCATION_SHARE_FAILED'
      });
      if (mountedRef.current) {
        setError(shareError?.message || 'We could not share your location. Check location access and try again.');
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!startedRef.current) {
      startedRef.current = true;
      shareLocation();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [shareLocation]);

  return (
    <Screen>
      <Header title={t('quickShare.title')} subtitle={t('quickShare.subtitle')} showBack backLabel={t('common.back')} />
      {busy ? <LoadingState message={t('map.finding')} /> : null}
      {error ? <FeedbackBanner message={error} actionLabel={t('common.retry')} onAction={shareLocation} /> : null}
      {!busy ? (
        <Button
          title={t('quickShare.title')}
          icon="share-social-outline"
          onPress={shareLocation}
        />
      ) : null}
    </Screen>
  );
}
