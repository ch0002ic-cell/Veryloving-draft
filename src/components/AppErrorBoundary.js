import { Component } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, spacing } from '../constants/theme';
import { logger } from '../utils/logger';

export class AppErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    logger.error('[UI] Unhandled render error', {
      name: error?.name || 'RenderError'
    });
  }

  reset = () => {
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View accessibilityRole="alert" style={styles.fallback}>
        <Text style={styles.title}>{this.props.title}</Text>
        <Text style={styles.message}>{this.props.message}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={this.reset}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonLabel}>{this.props.retryLabel}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.cream
  },
  title: { fontFamily: fonts.bold, color: colors.ink, fontSize: 22, textAlign: 'center' },
  message: { maxWidth: 420, fontFamily: fonts.regular, color: colors.inkSoft, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  button: { minHeight: 50, minWidth: 140, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingHorizontal: 18, backgroundColor: colors.ink },
  buttonLabel: { fontFamily: fonts.semibold, color: '#fff', fontSize: 16 },
  pressed: { opacity: 0.7 }
});
