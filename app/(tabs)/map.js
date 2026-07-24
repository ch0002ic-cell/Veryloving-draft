import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import {
  cacheMapRegion,
  dangerZones,
    getMapboxModule,
    requestCurrentLocation,
    watchLiveLocation
} from '../../src/services/mapbox';
import { colors, radii, shadows, spacing, typography } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { EmptyState } from '../../src/components/EmptyState';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { LoadingState } from '../../src/components/LoadingState';
import { StatusPill } from '../../src/components/StatusPill';
import { images } from '../../src/constants/assets';
import { logger } from '../../src/utils/logger';
import { shareQuickLocation } from '../../src/services/emergency';
import { loadSavedPlaces, removeSavedPlace, saveCurrentPlace } from '../../src/services/saved-place-store';
import { useAuth } from '../../src/context/AuthContext';
import { useAppState } from '../../src/context/AppContext';
import { evaluateGeofence } from '../../src/services/geofence-evaluator';

const DEFAULT_COORDINATES = [-79.3832, 43.6532];

function DeviceLegend({ isRTL, robotEntities, t, wearableEntities }) {
  const devices = [...wearableEntities, ...robotEntities];
  if (!devices.length) return null;
  return (
    <View style={styles.deviceLegend}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('settings.deviceManagement')}</Text>
      {devices.map((entity) => {
        const deviceName = entity.name || (entity.deviceType === 'wearable' ? t('home.northStarDevice') : t('medication.robot'));
        const connectionLabel = entity.online ? t('safetyCall.connected') : t('safetyCall.offline');
        return (
        <View
          key={`${entity.deviceType}:${entity.deviceId}`}
          accessible
          accessibilityLabel={`${deviceName} · ${connectionLabel}`}
          accessibilityRole="summary"
          style={[styles.deviceLegendRow, isRTL && styles.rtlRow]}
        >
          <View style={styles.deviceLegendIcon}>
            <Ionicons
              accessible={false}
              name={entity.deviceType === 'wearable' ? 'watch-outline' : 'home-outline'}
              size={18}
              color={colors.textPrimary}
            />
          </View>
          <Text style={[styles.deviceLegendName, isRTL && styles.rtlText]}>{deviceName}</Text>
          <StatusPill
            label={connectionLabel}
            tone={entity.online ? 'ok' : 'idle'}
          />
        </View>
        );
      })}
    </View>
  );
}

function locationErrorTranslationKey(error) {
  if (error?.code === 'LOCATION_PERMISSION_DENIED') return 'map.permissionOff';
  if (error?.code === 'LOCATION_NOT_REQUESTED') return 'map.notRequested';
  if (error?.code === 'TIMEOUT') return 'map.timeout';
  return 'map.updateFailed';
}

const NativeSafetyMap = memo(function NativeSafetyMap({ Mapbox, coordinates, deviceFeatureCollection, robotPathFeatureCollection, onLoadError, onStyleLoaded, t }) {
  const deviceSourceRef = useRef(null);
  const robotPathSourceRef = useRef(null);
  useEffect(() => {
    // ShapeSource exposes setNativeProps rather than setData in the installed
    // native SDK. Updating it explicitly prevents stale markers after resume.
    deviceSourceRef.current?.setNativeProps?.({ shape: deviceFeatureCollection });
  }, [deviceFeatureCollection]);
  useEffect(() => {
    robotPathSourceRef.current?.setNativeProps?.({ shape: robotPathFeatureCollection });
  }, [robotPathFeatureCollection]);
  return (
    <Mapbox.MapView
      onDidFinishLoadingStyle={onStyleLoaded}
      onMapLoadingError={onLoadError}
      styleURL={Mapbox.StyleURL?.Street}
      style={styles.nativeMap}
    >
      <Mapbox.Camera zoomLevel={13} centerCoordinate={coordinates} animationMode="easeTo" />
      {Mapbox.LocationPuck ? <Mapbox.LocationPuck puckBearingEnabled /> : null}
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
      {Mapbox.ShapeSource && Mapbox.SymbolLayer ? (
        <Mapbox.ShapeSource ref={deviceSourceRef} id="paired-device-locations" shape={deviceFeatureCollection}>
          <Mapbox.SymbolLayer
            id="paired-device-markers"
            style={{
              textField: ['match', ['get', 'device_type'], 'wearable', '●', '⌂'],
              textSize: 22,
              textColor: ['match', ['get', 'device_type'], 'wearable', colors.textPrimary, colors.textSecondary],
              textHaloColor: colors.surfaceRaised,
              textHaloWidth: 2,
              textAllowOverlap: true
            }}
          />
        </Mapbox.ShapeSource>
      ) : null}
      {Mapbox.ShapeSource && Mapbox.LineLayer ? (
        <Mapbox.ShapeSource ref={robotPathSourceRef} id="home-robot-navigation-paths" shape={robotPathFeatureCollection}>
          <Mapbox.LineLayer
            id="home-robot-navigation-lines"
            style={{ lineColor: colors.textSecondary, lineWidth: 4, lineOpacity: 0.8, lineCap: 'round', lineJoin: 'round' }}
          />
        </Mapbox.ShapeSource>
      ) : null}
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
  const [liveLocationAllowed, setLiveLocationAllowed] = useState(false);
  const [appIsActive, setAppIsActive] = useState(() => !['background', 'inactive'].includes(AppState.currentState));
  const [savedPlaces, setSavedPlaces] = useState(null);
  const [savedPlaceAction, setSavedPlaceAction] = useState(null);
  const [savedPlaceFeedback, setSavedPlaceFeedback] = useState(null);
  const [geofenceFeedback, setGeofenceFeedback] = useState(null);
  const geofenceStatesRef = useRef(new Map());
  const mountedRef = useRef(true);
  const mapStyleReadyRef = useRef(false);
  const requestIdRef = useRef(0);
  const shareInProgressRef = useRef(false);
  const Mapbox = useMemo(() => getMapboxModule(), []);
  const insets = useSafeAreaInsets();
  const { isRTL, locale, t } = useI18n();
  const { user } = useAuth();
  const { wearableEntities, robotEntities } = useAppState();
  const [deviceFeatureCollection, setDeviceFeatureCollection] = useState({ type: 'FeatureCollection', features: [] });
  const [robotPathFeatureCollection, setRobotPathFeatureCollection] = useState({ type: 'FeatureCollection', features: [] });
  useEffect(() => {
    const features = [...wearableEntities, ...robotEntities].flatMap((entity) => {
      const longitude = Number(entity?.location?.longitude ?? entity?.longitude);
      const latitude = Number(entity?.location?.latitude ?? entity?.latitude);
      if (!Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return [];
      return [{
        type: 'Feature',
        id: `${entity.deviceType}:${entity.deviceId}`,
        properties: { device_id: entity.deviceId, device_type: entity.deviceType, name: entity.name || '' },
        geometry: { type: 'Point', coordinates: [longitude, latitude] }
      }];
    });
    setDeviceFeatureCollection({ type: 'FeatureCollection', features });
    const robotPaths = robotEntities.flatMap((entity) => {
      const coordinates = Array.isArray(entity?.navigationPath) ? entity.navigationPath : [];
      if (coordinates.length < 2) return [];
      return [{
        type: 'Feature',
        id: `path:${entity.deviceId}`,
        properties: { device_id: entity.deviceId, device_type: 'home_robot' },
        geometry: { type: 'LineString', coordinates }
      }];
    });
    setRobotPathFeatureCollection({ type: 'FeatureCollection', features: robotPaths });
  }, [robotEntities, wearableEntities]);
  useEffect(() => {
    if (!location || !Array.isArray(savedPlaces)) return;
    const activeIds = new Set(savedPlaces.map((place) => place.id));
    for (const storedId of geofenceStatesRef.current.keys()) {
      if (!activeIds.has(storedId)) geofenceStatesRef.current.delete(storedId);
    }
    for (const place of savedPlaces) {
      const previousState = geofenceStatesRef.current.get(place.id) || 'unknown';
      const result = evaluateGeofence({ geofence: place, location, previousState });
      if (result.state !== 'unknown') geofenceStatesRef.current.set(place.id, result.state);
      if (result.transition === 'enter' || result.transition === 'exit') {
        setGeofenceFeedback({
          tone: result.transition === 'enter' ? 'success' : 'error',
          translationKey: result.transition === 'enter' ? 'map.geofenceEntered' : 'map.geofenceExited',
          translationOptions: { radius: place.radiusMeters }
        });
      }
    }
  }, [location, savedPlaces]);
  const coordinates = useMemo(() => location
    ? [location.coords.longitude, location.coords.latitude]
    : DEFAULT_COORDINATES, [location]);
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

  const openSystemSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch (settingsError) {
      logger.recoverable('[Mapbox] Could not open system settings', {
        errorCode: settingsError?.code || settingsError?.name || 'SETTINGS_LINK_FAILED'
      });
      if (mountedRef.current) {
        setShareError(null);
        setSavedPlaceFeedback(null);
        setError({ translationKey: 'settings.linkFailed' });
      }
    }
  }, []);

  const handleMapLoadError = useCallback((mapError) => {
    logger.recoverable('[Mapbox] Native map style failed to load', {
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
        setLiveLocationAllowed(true);
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
        setLiveLocationAllowed(false);
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
      if (mountedRef.current) {
        setLiveLocationAllowed(true);
        if (!location) setLocation(shareLocation);
      }
      await shareQuickLocation(shareLocation, { locale });
    } catch (shareLocationError) {
      logger.recoverable('[Mapbox] Could not open the location share sheet', {
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
      if (mountedRef.current) {
        setLiveLocationAllowed(true);
        if (!location) setLocation(currentLocation);
      }
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
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppIsActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);

  useFocusEffect(useCallback(() => {
    // Do not turn a declined in-app rationale into an immediate native prompt,
    // and do not retain a location watcher while this tab/app is inactive.
    if (loading || !liveLocationAllowed || !appIsActive) return undefined;
    let active = true;
    let liveSubscription;
    watchLiveLocation((nextLocation) => {
      if (active && mountedRef.current) setLocation(nextLocation);
    }).then((subscription) => {
      if (active) liveSubscription = subscription;
      else subscription?.remove?.();
    }).catch((liveError) => {
      logger.recoverable('[Mapbox] Live location updates are unavailable', {
        errorCode: liveError?.code || liveError?.name || 'LIVE_LOCATION_UNAVAILABLE'
      });
      if (active && mountedRef.current) {
        setLiveLocationAllowed(false);
        setPermissionDenied(liveError?.code === 'LOCATION_PERMISSION_DENIED');
        setError({ translationKey: locationErrorTranslationKey(liveError) });
      }
    });
    return () => {
      active = false;
      liveSubscription?.remove?.();
    };
  }, [appIsActive, liveLocationAllowed, loading]));

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
          deviceFeatureCollection={deviceFeatureCollection}
          robotPathFeatureCollection={robotPathFeatureCollection}
          coordinates={coordinates}
          onLoadError={handleMapLoadError}
          onStyleLoaded={handleMapStyleLoaded}
          t={t}
        />
        {loading ? (
          <View style={[styles.mapStatus, { top: insets.top + spacing.mdSm }]}>
            <LoadingState compact message={t('map.finding')} />
          </View>
        ) : null}
        {shareError || error ? (
          <View style={[styles.mapStatus, { top: insets.top + spacing.mdSm }]}>
            <FeedbackBanner
              message={localizedFeedbackMessage(shareError || error)}
              actionLabel={permissionDenied ? t('common.settings') : t('common.retry')}
              onAction={permissionDenied
                ? openSystemSettings
                : shareError ? handleQuickShare : refreshLocation}
            />
          </View>
        ) : null}
        <ScrollView
          contentContainerStyle={styles.savedOverlayContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={[styles.savedOverlay, { bottom: insets.bottom + spacing.md }]}
        >
          <DeviceLegend
            isRTL={isRTL}
            robotEntities={robotEntities}
            t={t}
            wearableEntities={wearableEntities}
          />
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('map.savedTitle')}</Text>
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
            onAction={permissionDenied ? openSystemSettings : undefined}
          />
          <FeedbackBanner
            message={localizedFeedbackMessage(geofenceFeedback)}
            tone={geofenceFeedback?.tone}
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
        </ScrollView>
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
        onAction={permissionDenied ? openSystemSettings : retryMapAndLocation}
      />
      <FeedbackBanner
        message={localizedFeedbackMessage(geofenceFeedback)}
        tone={geofenceFeedback?.tone}
      />
      {wearableEntities.length || robotEntities.length ? (
        <Card>
          <DeviceLegend
            isRTL={isRTL}
            robotEntities={robotEntities}
            t={t}
            wearableEntities={wearableEntities}
          />
        </Card>
      ) : null}
      {dangerZones.map((zone) => (
        <Card key={zone.id}>
          <Text style={[styles.zone, isRTL && styles.rtlText]}>{t(zone.nameKey)}</Text>
          <Text style={[styles.muted, isRTL && styles.rtlText]}>{t('map.risk', { risk: t(`map.risks.${zone.risk}`), radius: zone.radius })}</Text>
        </Card>
      ))}
      <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('map.savedTitle')}</Text>
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
        onAction={permissionDenied ? openSystemSettings : undefined}
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
          onAction={permissionDenied ? openSystemSettings : handleQuickShare}
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
  mapStatus: { position: 'absolute', left: spacing.md, right: spacing.md, backgroundColor: colors.surfaceRaised, borderRadius: radii.lg, overflow: 'hidden' },
  dangerMarker: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: colors.surfaceRaised, backgroundColor: colors.redAccessible },
  savedOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    maxHeight: '58%',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.xl,
    ...shadows.raised
  },
  savedOverlayContent: { padding: spacing.mdSm, gap: spacing.sm },
  mapFallback: { height: 320, borderRadius: radii.xl, backgroundColor: colors.surfaceMapFallback, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  mapText: { ...typography.display, color: colors.textPrimary },
  coords: { ...typography.caption, color: colors.textSecondary },
  zone: { ...typography.label, color: colors.textPrimary },
  sectionTitle: { ...typography.heading, color: colors.textPrimary },
  muted: { ...typography.caption, color: colors.textSecondary },
  savedPlaceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  savedPlaceCopy: { flex: 1, minWidth: 0 },
  savedPlaceCard: { gap: spacing.sm },
  deviceLegend: { gap: spacing.sm },
  deviceLegendRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deviceLegendIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceMuted
  },
  deviceLegendName: { flex: 1, ...typography.label, color: colors.textPrimary }
});
