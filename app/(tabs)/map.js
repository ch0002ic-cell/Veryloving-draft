import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import {
  cacheMapRegion,
  dangerZones,
  getMapboxModule,
  requestCurrentLocation
} from '../../src/services/mapbox';
import { colors, fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { EmptyState } from '../../src/components/EmptyState';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { LoadingState } from '../../src/components/LoadingState';
import { images } from '../../src/constants/assets';
import { logger } from '../../src/utils/logger';
import { shareQuickLocation } from '../../src/services/emergency';
import { loadSavedPlaces, removeSavedPlace, saveCurrentPlace } from '../../src/services/saved-place-store';
import { useAuth } from '../../src/context/AuthContext';
import { useAppState } from '../../src/context/AppContext';
import {
  createRobotFeatureCollection,
  selectMapCameraCoordinates
} from '../../src/services/robotics-telemetry';

const DEFAULT_COORDINATES = [-79.3832, 43.6532];

function locationErrorTranslationKey(error) {
  if (error?.code === 'LOCATION_PERMISSION_DENIED') return 'map.permissionOff';
  if (error?.code === 'LOCATION_NOT_REQUESTED') return 'map.notRequested';
  if (error?.code === 'TIMEOUT') return 'map.timeout';
  return 'map.updateFailed';
}

const NativeSafetyMap = memo(function NativeSafetyMap({ Mapbox, coordinates, onLoadError, onStyleLoaded, robotFeatureCollection, t }) {
  return (
    <Mapbox.MapView
      onDidFinishLoadingStyle={onStyleLoaded}
      onMapLoadingError={onLoadError}
      styleURL={Mapbox.StyleURL?.Street}
      style={styles.nativeMap}
    >
      <Mapbox.Camera zoomLevel={13} centerCoordinate={coordinates} animationMode="easeTo" />
      {Mapbox.LocationPuck ? <Mapbox.LocationPuck puckBearingEnabled /> : null}
      {robotFeatureCollection.features.length ? (
        <Mapbox.ShapeSource id="robot-entities" shape={robotFeatureCollection}>
          <Mapbox.CircleLayer
            id="robot-entities-dot"
            style={{
              circleColor: colors.orange,
              circleRadius: 9,
              circleStrokeColor: colors.paper,
              circleStrokeWidth: 3
            }}
          />
          <Mapbox.SymbolLayer
            id="robot-entities-heading"
            style={{
              textAllowOverlap: true,
              textColor: colors.ink,
              textField: '▲',
              textRotate: ['get', 'heading'],
              textRotationAlignment: 'map',
              textSize: 12
            }}
          />
          <Mapbox.SymbolLayer
            id="robot-entities-label"
            style={{
              textAllowOverlap: true,
              textColor: colors.ink,
              textField: ['get', 'label'],
              textHaloColor: colors.paper,
              textHaloWidth: 2,
              textOffset: [0, 1.5],
              textSize: 12
            }}
          />
        </Mapbox.ShapeSource>
      ) : null}
      {dangerZones.map((zone) => {
        const zoneTitle = t(zone.nameKey);
        const zoneDescription = t('map.risk', {
          risk: t(`map.risks.${zone.risk}`),
          radius: zone.radius
        });
        return (
          <Mapbox.PointAnnotation
            key={zone.id}
            id={zone.id}
            coordinate={zone.coordinate}
            title={zoneTitle}
            snippet={zoneDescription}
          >
            <View
              accessible
              accessibilityHint={zoneDescription}
              accessibilityLabel={zoneTitle}
              accessibilityRole="image"
              collapsable={false}
              style={styles.dangerMarker}
            />
          </Mapbox.PointAnnotation>
        );
      })}
    </Mapbox.MapView>
  );
});

export default function MapScreen() {
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState(null);
  const [savedPlaceAction, setSavedPlaceAction] = useState(null);
  const [savedPlaceFeedback, setSavedPlaceFeedback] = useState(null);
  const mountedRef = useRef(true);
  const mapStyleReadyRef = useRef(false);
  const requestIdRef = useRef(0);
  const shareInProgressRef = useRef(false);
  const Mapbox = useMemo(() => getMapboxModule(), []);
  const insets = useSafeAreaInsets();
  const { isRTL, locale, t } = useI18n();
  const { user } = useAuth();
  const { robotEntities, roboticsError, setRoboticsError } = useAppState();
  const userCoordinates = useMemo(() => location
    ? [location.coords.longitude, location.coords.latitude]
    : DEFAULT_COORDINATES, [location]);
  const robotFeatureCollection = useMemo(
    () => createRobotFeatureCollection(robotEntities),
    [robotEntities]
  );
  const coordinates = useMemo(
    () => selectMapCameraCoordinates(userCoordinates, robotEntities, DEFAULT_COORDINATES),
    [robotEntities, userCoordinates]
  );
  const localizedFeedbackMessage = useCallback((feedback) => {
    if (!feedback?.translationKey) return null;
    const translationOptions = feedback.capturedAt
      ? {
          ...feedback.translationOptions,
          capturedAt: new Date(feedback.capturedAt).toLocaleString(locale)
        }
      : feedback.translationOptions;
    const message = t(feedback.translationKey, translationOptions);
    return feedback.prefixTranslationKey
      ? `${t(feedback.prefixTranslationKey)} ${message}`
      : message;
  }, [locale, t]);

  const handleMapLoadError = useCallback((mapError) => {
    logger.warn('[Mapbox] Native map style failed to load', {
      name: mapError?.name || 'MapLoadingError'
    });
    if (mountedRef.current && !mapStyleReadyRef.current) {
      setMapLoadFailed(true);
      setError({ translationKey: 'releaseCritical.mapUnavailable' });
    }
  }, []);

  const handleMapStyleLoaded = useCallback(() => {
    mapStyleReadyRef.current = true;
  }, []);

  const refreshLocation = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(Mapbox ? null : { translationKey: 'releaseCritical.mapUnavailable' });
    try {
      const nextLocation = await requestCurrentLocation();
      if (mountedRef.current && requestId === requestIdRef.current) {
        setPermissionDenied(false);
        setLocation(nextLocation);
        if (nextLocation.isCached) {
          setError({
            capturedAt: nextLocation.cachedAt,
            prefixTranslationKey: Mapbox ? undefined : 'releaseCritical.mapUnavailable',
            translationKey: 'releaseCritical.mapCachedLocation'
          });
        } else if (Mapbox) {
          cacheMapRegion(nextLocation).catch(() => {});
        }
      }
    } catch (locationError) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setPermissionDenied(locationError?.code === 'LOCATION_PERMISSION_DENIED');
        setError({
          prefixTranslationKey: Mapbox ? undefined : 'releaseCritical.mapUnavailable',
          translationKey: locationErrorTranslationKey(locationError)
        });
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, [Mapbox]);

  const retryMapAndLocation = useCallback(() => {
    if (mapLoadFailed) {
      mapStyleReadyRef.current = false;
      setMapLoadFailed(false);
    }
    refreshLocation();
  }, [mapLoadFailed, refreshLocation]);

  const handleQuickShare = useCallback(async () => {
    if (shareInProgressRef.current) return;
    shareInProgressRef.current = true;
    setSharing(true);
    setShareError(null);
    try {
      const shareLocation = location || await requestCurrentLocation();
      if (mountedRef.current && !location) setLocation(shareLocation);
      await shareQuickLocation(shareLocation, { locale });
    } catch (shareLocationError) {
      logger.warn('[Mapbox] Could not open the location share sheet', {
        errorCode: shareLocationError?.code || shareLocationError?.name || 'LOCATION_SHARE_FAILED',
        usedCachedLocation: Boolean(location?.isCached)
      });
      if (mountedRef.current) {
        setPermissionDenied(shareLocationError?.code === 'LOCATION_PERMISSION_DENIED');
        setShareError({ translationKey: 'releaseCritical.locationShareFailed' });
      }
    } finally {
      shareInProgressRef.current = false;
      if (mountedRef.current) setSharing(false);
    }
  }, [locale, location]);

  const savePlace = useCallback(async () => {
    if (!user?.id || savedPlaceAction) return;
    setSavedPlaceAction('save');
    setSavedPlaceFeedback(null);
    try {
      const currentLocation = location || await requestCurrentLocation();
      if (mountedRef.current && !location) setLocation(currentLocation);
      const next = await saveCurrentPlace(user.id, currentLocation);
      if (mountedRef.current) {
        setPermissionDenied(false);
        setSavedPlaces(next);
        setSavedPlaceFeedback({ tone: 'success', translationKey: 'releaseCritical.placeSaved' });
      }
    } catch (saveError) {
      if (mountedRef.current) {
        setPermissionDenied(saveError?.code === 'LOCATION_PERMISSION_DENIED');
        setSavedPlaceFeedback({ tone: 'error', translationKey: 'releaseCritical.savePlaceFailed' });
      }
    } finally {
      if (mountedRef.current) setSavedPlaceAction(null);
    }
  }, [location, savedPlaceAction, user?.id]);

  const removePlace = useCallback(async (placeId) => {
    if (!user?.id || savedPlaceAction) return;
    setSavedPlaceAction(placeId);
    setSavedPlaceFeedback(null);
    try {
      const next = await removeSavedPlace(user.id, placeId);
      if (mountedRef.current) setSavedPlaces(next);
    } catch {
      if (mountedRef.current) {
        setSavedPlaceFeedback({ tone: 'error', translationKey: 'releaseCritical.savePlaceFailed' });
      }
    } finally {
      if (mountedRef.current) setSavedPlaceAction(null);
    }
  }, [savedPlaceAction, user?.id]);

  const savedPlaceLabel = useCallback((place) => (
    `${t('releaseCritical.savedPlace')} · ${new Date(place.capturedAt).toLocaleString(locale)}`
  ), [locale, t]);

  useEffect(() => {
    mountedRef.current = true;
    refreshLocation();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refreshLocation]);

  useEffect(() => {
    let active = true;
    if (!user?.id) {
      setSavedPlaces([]);
      return () => { active = false; };
    }
    setSavedPlaces(null);
    loadSavedPlaces(user.id)
      .then((places) => {
        if (active) setSavedPlaces(places);
      })
      .catch(() => {
        if (!active) return;
        setSavedPlaces([]);
        setSavedPlaceFeedback({ tone: 'error', translationKey: 'releaseCritical.savePlaceFailed' });
      });
    return () => { active = false; };
  }, [user?.id]);

  if (Mapbox && !mapLoadFailed) {
    return (
      <View style={styles.fullScreen}>
        <NativeSafetyMap
          Mapbox={Mapbox}
          coordinates={coordinates}
          onLoadError={handleMapLoadError}
          onStyleLoaded={handleMapStyleLoaded}
          robotFeatureCollection={robotFeatureCollection}
          t={t}
        />
        {loading ? (
          <View style={[styles.mapStatus, { top: insets.top + 12 }]}>
            <LoadingState compact message={t('map.finding')} />
          </View>
        ) : null}
        {shareError || error ? (
          <View style={[styles.mapStatus, { top: insets.top + 12 }]}>
            <FeedbackBanner
              message={localizedFeedbackMessage(shareError || error)}
              actionLabel={permissionDenied ? t('common.settings') : t('common.retry')}
              onAction={permissionDenied
                ? () => Linking.openSettings().catch(() => {})
                : shareError ? handleQuickShare : refreshLocation}
            />
          </View>
        ) : null}
        {roboticsError ? (
          <View style={[styles.mapStatus, { top: insets.top + 84 }]}>
            <FeedbackBanner
              message={roboticsError.message}
              actionLabel={t('common.close')}
              onAction={() => setRoboticsError(null)}
            />
          </View>
        ) : null}
        <View style={[styles.savedOverlay, { bottom: insets.bottom + 16 }]}>
          <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('map.savedTitle')}</Text>
          {savedPlaces === null ? <LoadingState compact message={t('common.loading')} /> : null}
          {savedPlaces?.length ? (
            <View style={[styles.savedPlaceRow, isRTL && styles.rtlRow]}>
              <View style={styles.savedPlaceCopy}>
                <Text style={[styles.zone, isRTL && styles.rtlText]}>{savedPlaceLabel(savedPlaces[savedPlaces.length - 1])}</Text>
                <Text style={[styles.muted, isRTL && styles.rtlText]}>
                  {savedPlaces[savedPlaces.length - 1].latitude.toFixed(5)}, {savedPlaces[savedPlaces.length - 1].longitude.toFixed(5)}
                </Text>
              </View>
              <Button
                title={t('common.remove')}
                variant="ghost"
                compact
                loading={savedPlaceAction === savedPlaces[savedPlaces.length - 1].id}
                disabled={Boolean(savedPlaceAction) && savedPlaceAction !== savedPlaces[savedPlaces.length - 1].id}
                onPress={() => removePlace(savedPlaces[savedPlaces.length - 1].id)}
              />
            </View>
          ) : savedPlaces ? <Text style={[styles.muted, isRTL && styles.rtlText]}>{t('map.savedEmptyTitle')}</Text> : null}
          <FeedbackBanner
            message={localizedFeedbackMessage(savedPlaceFeedback)}
            tone={savedPlaceFeedback?.tone}
            actionLabel={permissionDenied ? t('common.settings') : undefined}
            onAction={permissionDenied ? () => Linking.openSettings().catch(() => {}) : undefined}
          />
          <Button
            title={t('releaseCritical.saveCurrentPlace')}
            icon="bookmark-outline"
            onPress={savePlace}
            loading={savedPlaceAction === 'save'}
            disabled={Boolean(savedPlaceAction) && savedPlaceAction !== 'save'}
          />
          <Button
            title={t('quickShare.title')}
            icon="share-social-outline"
            onPress={handleQuickShare}
            loading={sharing}
          />
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <Header title={t('map.title')} subtitle={t('map.previewSubtitle')} />
      <View style={styles.mapFallback}>
        {loading ? <LoadingState compact message={t('map.finding')} /> : <Text style={[styles.mapText, isRTL && styles.rtlText]}>{t('map.preview')}</Text>}
        <Text style={styles.coords}>{coordinates.join(', ')}</Text>
      </View>
      <FeedbackBanner
        message={localizedFeedbackMessage(error)}
        actionLabel={permissionDenied ? t('common.settings') : t('map.retry')}
        onAction={permissionDenied
          ? () => Linking.openSettings().catch(() => {})
          : retryMapAndLocation}
      />
      {roboticsError ? (
        <FeedbackBanner
          message={roboticsError.message}
          actionLabel={t('common.close')}
          onAction={() => setRoboticsError(null)}
        />
      ) : null}
      {dangerZones.map((zone) => (
        <Card key={zone.id}>
          <Text style={[styles.zone, isRTL && styles.rtlText]}>{t(zone.nameKey)}</Text>
          <Text style={[styles.muted, isRTL && styles.rtlText]}>{t('map.risk', { risk: t(`map.risks.${zone.risk}`), radius: zone.radius })}</Text>
        </Card>
      ))}
      <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('map.savedTitle')}</Text>
      {savedPlaces === null ? <LoadingState message={t('common.loading')} /> : null}
      {savedPlaces?.length ? savedPlaces.map((place) => (
        <Card key={place.id} style={styles.savedPlaceCard}>
          <Text style={[styles.zone, isRTL && styles.rtlText]}>{savedPlaceLabel(place)}</Text>
          <Text style={styles.coords}>{place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}</Text>
          <Button
            title={t('common.remove')}
            variant="ghost"
            compact
            loading={savedPlaceAction === place.id}
            disabled={Boolean(savedPlaceAction) && savedPlaceAction !== place.id}
            onPress={() => removePlace(place.id)}
          />
        </Card>
      )) : savedPlaces ? (
        <EmptyState
          compact
          image={images.mapOnboarding}
          title={t('map.savedEmptyTitle')}
          message={t('map.savedEmptyMessage')}
        />
      ) : null}
      <FeedbackBanner
        message={localizedFeedbackMessage(savedPlaceFeedback)}
        tone={savedPlaceFeedback?.tone}
        actionLabel={permissionDenied ? t('common.settings') : undefined}
        onAction={permissionDenied ? () => Linking.openSettings().catch(() => {}) : undefined}
      />
      <Button
        title={t('releaseCritical.saveCurrentPlace')}
        icon="bookmark-outline"
        onPress={savePlace}
        loading={savedPlaceAction === 'save'}
        disabled={Boolean(savedPlaceAction) && savedPlaceAction !== 'save'}
      />
      {shareError ? (
        <FeedbackBanner
          message={localizedFeedbackMessage(shareError)}
          actionLabel={permissionDenied ? t('common.settings') : t('common.retry')}
          onAction={permissionDenied
            ? () => Linking.openSettings().catch(() => {})
            : handleQuickShare}
        />
      ) : null}
      <Button
        title={t('quickShare.title')}
        icon="share-social-outline"
        onPress={handleQuickShare}
        loading={sharing}
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
  savedOverlay: { position: 'absolute', left: 16, right: 16, paddingHorizontal: 8, paddingBottom: 8, gap: 8, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 8, elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  mapFallback: { height: 320, borderRadius: 8, backgroundColor: '#DDEBE7', alignItems: 'center', justifyContent: 'center', gap: 8 },
  mapText: { fontFamily: fonts.bold, color: colors.ink, fontSize: 28 },
  coords: { fontFamily: fonts.regular, color: colors.inkSoft },
  zone: { fontFamily: fonts.bold, color: colors.ink },
  sectionTitle: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  muted: { fontFamily: fonts.regular, color: colors.inkSoft },
  savedPlaceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  savedPlaceCopy: { flex: 1, minWidth: 0 },
  savedPlaceCard: { gap: 8 }
});
