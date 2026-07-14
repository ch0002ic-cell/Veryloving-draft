import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { colors } from '../constants/theme';

export function AppleSignInButton({ disabled, loading, onPress, title }) {
  const [runtime, setRuntime] = useState({ status: 'loading', module: null });

  useEffect(() => {
    let active = true;
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
  }, []);

  if (runtime.status === 'loading') {
    return (
      <View accessibilityLabel={title} style={styles.loading}>
        <ActivityIndicator color={colors.ink} />
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
    <View pointerEvents={disabled ? 'none' : 'auto'} style={[styles.wrap, disabled && styles.disabled]}>
      <AppleAuthenticationButton
        buttonStyle={AppleAuthenticationButtonStyle.BLACK}
        buttonType={AppleAuthenticationButtonType.SIGN_IN}
        cornerRadius={8}
        onPress={onPress}
        style={styles.button}
      />
      {loading ? (
        <View pointerEvents="none" style={styles.overlay}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { width: '100%', height: 50 },
  disabled: { opacity: 0.45 },
  loading: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: colors.controlBorder,
    borderRadius: 8,
    borderWidth: 1,
    height: 50,
    justifyContent: 'center'
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 8,
    justifyContent: 'center'
  },
  wrap: { height: 50 }
});
