const { withGradleProperties } = require('@expo/config-plugins');

module.exports = function withVeryLovingGradleProperties(config) {
  return withGradleProperties(config, (config) => {
    const ensure = (type, key, value) => {
      const existing = config.modResults.find((item) => item.type === type && item.key === key);
      if (existing) existing.value = value;
      else config.modResults.push({ type, key, value });
    };

    ensure('property', 'android.useAndroidX', 'true');
    ensure('property', 'android.enableJetifier', 'true');
    ensure('property', 'newArchEnabled', 'true');
    return config;
  });
};
