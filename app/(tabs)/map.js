import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { dangerZones, getMapboxModule, requestCurrentLocation } from '../../src/services/mapbox';
import { colors, fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { EmptyState } from '../../src/components/EmptyState';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { LoadingState } from '../../src/components/LoadingState';
import { images } from '../../src/constants/assets';

const DEFAULT_COORDINATES = [-79.3832, 43.6532];

const NativeSafetyMap = memo(function NativeSafetyMap({ Mapbox, coordinates }) {
  return (
    <Mapbox.MapView style={styles.nativeMap}>
      <Mapbox.Camera zoomLevel={13} centerCoordinate={coordinates} animationMode="easeTo" />
      {dangerZones.map((zone) => (
        <Mapbox.PointAnnotation key={zone.id} id={zone.id} coordinate={zone.coordinate} />
      ))}
    </Mapbox.MapView>
  );
});

export default function MapScreen() {
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const Mapbox = useMemo(() => getMapboxModule(), []);
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const coordinates = useMemo(() => location
    ? [location.coords.longitude, location.coords.latitude]
    : DEFAULT_COORDINATES, [location]);

  const refreshLocation = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const nextLocation = await requestCurrentLocation();
      if (mountedRef.current && requestId === requestIdRef.current) setLocation(nextLocation);
    } catch (locationError) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError(locationError.message || t('map.updateFailed'));
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    mountedRef.current = true;
    refreshLocation();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refreshLocation]);

  if (Mapbox) {
    return (
      <View style={styles.fullScreen}>
        <NativeSafetyMap Mapbox={Mapbox} coordinates={coordinates} />
        {loading ? (
          <View style={[styles.mapStatus, { top: insets.top + 12 }]}>
            <LoadingState compact message={t('map.finding')} />
          </View>
        ) : null}
        {error ? (
          <View style={[styles.mapStatus, { top: insets.top + 12 }]}>
            <FeedbackBanner message={error} actionLabel={t('map.retry')} onAction={refreshLocation} />
          </View>
        ) : null}
        <View style={[styles.savedOverlay, { bottom: insets.bottom + 16 }]}>
          <EmptyState
            compact
            image={images.mapOnboarding}
            title={t('map.savedEmptyTitle')}
            message={t('map.savedEmptyMessage')}
          />
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <Header title={t('map.title')} subtitle={t('map.previewSubtitle')} />
      <View style={styles.mapFallback}>
        {loading ? <LoadingState compact message={t('map.finding')} /> : <Text style={styles.mapText}>{t('map.preview')}</Text>}
        <Text style={styles.coords}>{coordinates.join(', ')}</Text>
      </View>
      <FeedbackBanner message={error} actionLabel={t('map.retry')} onAction={refreshLocation} />
      {dangerZones.map((zone) => (
        <Card key={zone.id}>
          <Text style={styles.zone}>{t(zone.nameKey)}</Text>
          <Text style={styles.muted}>{t('map.risk', { risk: t(`map.risks.${zone.risk}`), radius: zone.radius })}</Text>
        </Card>
      ))}
      <Text style={styles.sectionTitle}>{t('map.savedTitle')}</Text>
      <EmptyState
        compact
        image={images.mapOnboarding}
        title={t('map.savedEmptyTitle')}
        message={t('map.savedEmptyMessage')}
      />
      <Button title={loading ? t('map.refreshing') : t('map.refresh')} onPress={refreshLocation} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1 },
  nativeMap: { flex: 1 },
  mapStatus: { position: 'absolute', left: 16, right: 16, backgroundColor: colors.paper, borderRadius: 8, overflow: 'hidden' },
  savedOverlay: { position: 'absolute', left: 16, right: 16, paddingHorizontal: 8, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 8, elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  mapFallback: { height: 320, borderRadius: 8, backgroundColor: '#DDEBE7', alignItems: 'center', justifyContent: 'center', gap: 8 },
  mapText: { fontFamily: fonts.bold, color: colors.ink, fontSize: 28 },
  coords: { fontFamily: fonts.regular, color: colors.inkSoft },
  zone: { fontFamily: fonts.bold, color: colors.ink },
  sectionTitle: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  muted: { fontFamily: fonts.regular, color: colors.inkSoft }
});
