import { Component } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { colors, layout, spacing, typography } from '../constants/theme';
import { logger } from '../utils/logger';

export class AppErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // The boundary has contained the render failure and presents a retry UI.
    // Keep the diagnostic observable without promoting a handled failure into
    // a second React Native LogBox surface.
    logger.recoverable('[UI] Render error contained by the application boundary', {
      name: error?.name || 'RenderError'
    });
  }

  reset = () => {
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.fallback}>
        <Text style={styles.title}>{this.props.title}</Text>
        <Text style={styles.message}>{this.props.message}</Text>
        <Button
          accessibilityLabel={this.props.retryLabel}
          onPress={this.reset}
          style={styles.button}
          title={this.props.retryLabel}
        />
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
    backgroundColor: colors.surfaceCanvas
  },
  title: { ...typography.titleLarge, color: colors.textPrimary, textAlign: 'center' },
  message: { width: '100%', maxWidth: layout.readableMaxWidth, ...typography.bodyLarge, color: colors.textSecondary, textAlign: 'center' },
  button: { width: '100%', maxWidth: layout.readableMaxWidth }
});
