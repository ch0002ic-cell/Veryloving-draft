import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import {
  cacheMapRegion,
  dangerZones,
  getMapboxModule,
  MAP_LOAD_FALLBACK_MESSAGE,
  requestCurrentLocation
} from '../../src/services/mapbox';
import { colors, fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { EmptyState } from '../../src/components/EmptyState';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { LoadingState } from '../../src/components/LoadingState';
import { images } from '../../src/constants/assets';
import { logger } from '../../src/utils/logger';

const DEFAULT_COORDINATES = [-79.3832, 43.6532];

const NativeSafetyMap = memo(function NativeSafetyMap({ Mapbox, coordinates, onLoadError, onStyleLoaded }) {
  return (
    <Mapbox.MapView
      onDidFinishLoadingStyle={onStyleLoaded}
      onMapLoadingError={onLoadError}
      styleURL={Mapbox.StyleURL?.Street}
      style={styles.nativeMap}
    >
      <Mapbox.Camera zoomLevel={13} centerCoordinate={coordinates} animationMode="easeTo" />
      {Mapbox.LocationPuck ? <Mapbox.LocationPuck puckBearingEnabled /> : null}
      {dangerZones.map((zone) => (
        <Mapbox.PointAnnotation key={zone.id} id={zone.id} coordinate={zone.coordinate}>
          <View style={styles.dangerMarker} />
        </Mapbox.PointAnnotation>
      ))}
    </Mapbox.MapView>
  );
});

export default function MapScreen() {
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  const mountedRef = useRef(true);
  const mapStyleReadyRef = useRef(false);
  const requestIdRef = useRef(0);
  const Mapbox = useMemo(() => getMapboxModule(), []);
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const coordinates = useMemo(() => location
    ? [location.coords.longitude, location.coords.latitude]
    : DEFAULT_COORDINATES, [location]);

  const handleMapLoadError = useCallback((mapError) => {
    logger.warn('[Mapbox] Native map style failed to load', {
      name: mapError?.name || 'MapLoadingError'
    });
    if (mountedRef.current && !mapStyleReadyRef.current) {
      setMapLoadFailed(true);
      setError(MAP_LOAD_FALLBACK_MESSAGE);
    }
  }, []);

  const handleMapStyleLoaded = useCallback(() => {
    mapStyleReadyRef.current = true;
  }, []);

  const refreshLocation = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(Mapbox ? null : MAP_LOAD_FALLBACK_MESSAGE);
    try {
      const nextLocation = await requestCurrentLocation();
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLocation(nextLocation);
        if (nextLocation.isCached) {
          const cachedMessage = `Live location is unavailable. Showing your last saved location from ${new Date(nextLocation.cachedAt).toLocaleString()}.`;
          setError(Mapbox ? cachedMessage : `${MAP_LOAD_FALLBACK_MESSAGE} ${cachedMessage}`);
        } else if (Mapbox) {
          cacheMapRegion(nextLocation).catch(() => {});
        }
      }
    } catch (locationError) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        const locationMessage = locationError.message || t('map.updateFailed');
        setError(Mapbox ? locationMessage : `${MAP_LOAD_FALLBACK_MESSAGE} ${locationMessage}`);
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, [Mapbox, t]);

  const retryMapAndLocation = useCallback(() => {
    if (mapLoadFailed) {
      mapStyleReadyRef.current = false;
      setMapLoadFailed(false);
    }
    refreshLocation();
  }, [mapLoadFailed, refreshLocation]);

  useEffect(() => {
    mountedRef.current = true;
    refreshLocation();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refreshLocation]);

  if (Mapbox && !mapLoadFailed) {
    return (
      <View style={styles.fullScreen}>
        <NativeSafetyMap
          Mapbox={Mapbox}
          coordinates={coordinates}
          onLoadError={handleMapLoadError}
          onStyleLoaded={handleMapStyleLoaded}
        />
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
      <FeedbackBanner message={error} actionLabel={t('map.retry')} onAction={retryMapAndLocation} />
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
      <Button title={loading ? t('map.refreshing') : t('map.refresh')} onPress={retryMapAndLocation} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1 },
  nativeMap: { flex: 1 },
  mapStatus: { position: 'absolute', left: 16, right: 16, backgroundColor: colors.paper, borderRadius: 8, overflow: 'hidden' },
  dangerMarker: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: colors.paper, backgroundColor: colors.red },
  savedOverlay: { position: 'absolute', left: 16, right: 16, paddingHorizontal: 8, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 8, elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  mapFallback: { height: 320, borderRadius: 8, backgroundColor: '#DDEBE7', alignItems: 'center', justifyContent: 'center', gap: 8 },
  mapText: { fontFamily: fonts.bold, color: colors.ink, fontSize: 28 },
  coords: { fontFamily: fonts.regular, color: colors.inkSoft },
  zone: { fontFamily: fonts.bold, color: colors.ink },
  sectionTitle: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  muted: { fontFamily: fonts.regular, color: colors.inkSoft }
});
