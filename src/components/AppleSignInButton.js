import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { colors, radii, sizes } from '../constants/theme';

export function AppleSignInButton({ disabled, loading, nativeModuleAllowed = true, onPress, title }) {
  const [runtime, setRuntime] = useState({ status: 'loading', module: null });

  useEffect(() => {
    let active = true;
    if (nativeModuleAllowed !== true) {
      setRuntime({
        status: nativeModuleAllowed === false ? 'unavailable' : 'loading',
        module: null
      });
      return () => { active = false; };
    }
    import('expo-apple-authentication').then(async (appleModule) => {
      const AppleAuthentication = typeof appleModule.isAvailableAsync === 'function'
        ? appleModule
        : appleModule.default;
      const available = Boolean(AppleAuthentication)
        && await AppleAuthentication.isAvailableAsync();
      if (active) {
        setRuntime({
          status: available ? 'ready' : 'unavailable',
          module: available ? AppleAuthentication : null
        });
      }
    }).catch(() => {
      if (active) setRuntime({ status: 'unavailable', module: null });
    });
    return () => { active = false; };
  }, [nativeModuleAllowed]);

  if (runtime.status === 'loading') {
    return (
      <View
        accessible
        accessibilityLabel={title}
        accessibilityLiveRegion="polite"
        accessibilityRole="progressbar"
        accessibilityState={{ busy: true, disabled: true }}
        style={styles.loading}
      >
        <ActivityIndicator color={colors.textPrimary} />
      </View>
    );
  }

  if (!runtime.module) {
    // A stale development client can be missing the native module even when
    // configuration is valid. Keep an actionable button so AuthContext can
    // report that build error instead of silently removing the method.
    return <Button title={title} icon="logo-apple" disabled={disabled} loading={loading} onPress={onPress} />;
  }

  const {
    AppleAuthenticationButton,
    AppleAuthenticationButtonStyle,
    AppleAuthenticationButtonType
  } = runtime.module;
  return (
    <View
      accessible
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(loading), disabled: Boolean(disabled || loading) }}
      onAccessibilityTap={disabled || loading ? undefined : onPress}
      pointerEvents={disabled || loading ? 'none' : 'auto'}
      style={[styles.wrap, disabled && styles.disabled]}
    >
      <AppleAuthenticationButton
        accessible={false}
        buttonStyle={AppleAuthenticationButtonStyle.BLACK}
        buttonType={AppleAuthenticationButtonType.SIGN_IN}
        cornerRadius={radii.md}
        onPress={onPress}
        style={styles.button}
      />
      {loading ? (
        <View pointerEvents="none" style={styles.overlay}>
          <ActivityIndicator color={colors.textInverse} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { width: '100%', height: sizes.control },
  disabled: { opacity: 0.45 },
  loading: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderControl,
    borderRadius: radii.md,
    borderWidth: 1,
    height: sizes.control,
    justifyContent: 'center'
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: colors.scrim,
    borderRadius: radii.md,
    justifyContent: 'center'
  },
  wrap: { height: sizes.control }
});
