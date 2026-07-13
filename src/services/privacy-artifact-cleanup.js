export async function purgePrivacyArtifacts(purgers) {
  const results = await Promise.allSettled(
    purgers.map((purge) => Promise.resolve().then(() => purge()))
  );
  return {
    failures: results.filter((item) => item.status === 'rejected').length
  };
}
