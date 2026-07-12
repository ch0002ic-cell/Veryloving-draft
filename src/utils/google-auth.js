export const GOOGLE_SIGN_IN_CANCELLED = 'GOOGLE_SIGN_IN_CANCELLED';

export function isGoogleSignInCancellation(value) {
  const marker = [value?.type, value?.code, value?.message]
    .filter(Boolean)
    .join(' ');
  return value?.type === 'cancelled' || /cancel/i.test(marker);
}

export function googleIdentityFromResponse(response) {
  if (isGoogleSignInCancellation(response)) return null;

  const data = response?.type === 'success' ? response.data : response;
  const profile = data?.user;
  if (!profile?.id) {
    throw new Error('Google Sign-In returned an invalid account response.');
  }

  return {
    identityToken: data.idToken || null,
    user: {
      id: profile.id,
      name: profile.name || null,
      email: profile.email || null,
      provider: 'google'
    }
  };
}

export function googleSignInCancellationError() {
  const error = new Error('Google Sign-In was cancelled.');
  error.code = GOOGLE_SIGN_IN_CANCELLED;
  return error;
}
