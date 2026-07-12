const { withGradleProperties } = require('@expo/config-plugins');

const REQUIRED_PROPERTIES = [
  ['org.gradle.jvmargs', '-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8'],
  ['android.useAndroidX', 'true'],
  ['android.enableJetifier', 'true'],
  ['newArchEnabled', 'true']
];

function upsertGradleProperty(properties, key, value) {
  const existing = properties.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
  } else {
    properties.push({ type: 'property', key, value });
  }
  return properties;
}

function applyVeryLovingGradleProperties(properties) {
  for (const [key, value] of REQUIRED_PROPERTIES) {
    upsertGradleProperty(properties, key, value);
  }
  return properties;
}

module.exports = function withVeryLovingGradleProperties(config) {
  return withGradleProperties(config, (propertiesConfig) => {
    applyVeryLovingGradleProperties(propertiesConfig.modResults);
    return propertiesConfig;
  });
};

module.exports.applyVeryLovingGradleProperties = applyVeryLovingGradleProperties;
module.exports.upsertGradleProperty = upsertGradleProperty;
