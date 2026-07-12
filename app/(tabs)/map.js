import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { dangerZones, getMapboxModule, requestCurrentLocation } from '../../src/services/mapbox';
import { colors, fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';

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
        {loading || error ? (
          <View style={styles.mapStatus}>
            {loading ? <ActivityIndicator color={colors.orange} /> : null}
            <Text accessibilityRole={error ? 'alert' : undefined} style={[styles.statusText, error && styles.error]}>
              {loading ? t('map.finding') : error}
            </Text>
            {error ? <Button title={t('map.retry')} variant="ghost" onPress={refreshLocation} /> : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Screen>
      <Header title={t('map.title')} subtitle={t('map.previewSubtitle')} />
      <View style={styles.mapFallback}>
        {loading ? <ActivityIndicator color={colors.orange} /> : <Text style={styles.mapText}>{t('map.preview')}</Text>}
        <Text style={styles.coords}>{coordinates.join(', ')}</Text>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {dangerZones.map((zone) => (
        <Card key={zone.id}>
          <Text style={styles.zone}>{t(zone.nameKey)}</Text>
          <Text style={styles.muted}>{t('map.risk', { risk: t(`map.risks.${zone.risk}`), radius: zone.radius })}</Text>
        </Card>
      ))}
      <Button title={loading ? t('map.refreshing') : t('map.refresh')} onPress={refreshLocation} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1 },
  nativeMap: { flex: 1 },
  mapStatus: { position: 'absolute', top: 64, left: 16, right: 16, padding: 12, alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8 },
  statusText: { fontFamily: fonts.regular, color: colors.ink, textAlign: 'center' },
  mapFallback: { height: 320, borderRadius: 8, backgroundColor: '#DDEBE7', alignItems: 'center', justifyContent: 'center', gap: 8 },
  mapText: { fontFamily: fonts.bold, color: colors.ink, fontSize: 28 },
  coords: { fontFamily: fonts.regular, color: colors.inkSoft },
  zone: { fontFamily: fonts.bold, color: colors.ink },
  muted: { fontFamily: fonts.regular, color: colors.inkSoft },
  error: { fontFamily: fonts.regular, color: colors.red, lineHeight: 20, textAlign: 'center' }
});
