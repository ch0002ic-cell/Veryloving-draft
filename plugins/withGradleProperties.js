const { withGradleProperties } = require('@expo/config-plugins');

function upsertGradleProperty(properties, key, value) {
  const existing = properties.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
  } else {
    properties.push({ type: 'property', key, value });
  }
  return properties;
}

module.exports = function withVeryLovingGradleProperties(config) {
  return withGradleProperties(config, (propertiesConfig) => {
    upsertGradleProperty(propertiesConfig.modResults, 'android.useAndroidX', 'true');
    upsertGradleProperty(propertiesConfig.modResults, 'android.enableJetifier', 'true');
    upsertGradleProperty(propertiesConfig.modResults, 'newArchEnabled', 'true');
    return propertiesConfig;
  });
};

module.exports.upsertGradleProperty = upsertGradleProperty;
