export const REMOTE_DATA_EXPORT_STATUS = Object.freeze({
  included: 'included',
  unavailable: 'unavailable',
  notConfigured: 'not-configured'
});

export async function loadAccountBoundExportData(accountId, {
  loadEmergencyContacts,
  loadSavedPlaces,
  loadMedicalProfile = async () => null
}) {
  if (!accountId) return { emergencyContacts: [], savedPlaces: [], medicalProfile: null };
  const [emergencyContacts, savedPlaces, medicalProfile] = await Promise.all([
    loadEmergencyContacts(accountId),
    loadSavedPlaces(accountId),
    loadMedicalProfile(accountId)
  ]);
  return { emergencyContacts, savedPlaces, medicalProfile };
}

export function remoteDataExportErrorCode(error) {
  const candidate = error?.code || error?.name;
  return typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(candidate)
    ? candidate
    : 'REMOTE_EXPORT_FAILED';
}

async function loadRemoteDataForExport({ backendEnabled, accessToken, fetchRemoteData }) {
  if (!backendEnabled) {
    return {
      data: null,
      status: REMOTE_DATA_EXPORT_STATUS.notConfigured,
      errorCode: null
    };
  }
  if (!accessToken) {
    return {
      data: null,
      status: REMOTE_DATA_EXPORT_STATUS.unavailable,
      errorCode: 'SAFETY_AUTHENTICATION_REQUIRED'
    };
  }
  try {
    return {
      data: await fetchRemoteData(accessToken),
      status: REMOTE_DATA_EXPORT_STATUS.included,
      errorCode: null
    };
  } catch (error) {
    return {
      data: null,
      status: REMOTE_DATA_EXPORT_STATUS.unavailable,
      errorCode: remoteDataExportErrorCode(error)
    };
  }
}

/**
 * Attach remote export data without allowing a network/auth failure to discard
 * the already assembled local privacy snapshot.
 */
export async function attachRemoteDataToExport(snapshot, options) {
  const remote = await loadRemoteDataForExport(options);
  return {
    ...snapshot,
    remoteData: remote.data,
    remoteDataStatus: remote.status,
    remoteDataErrorCode: remote.errorCode
  };
}
