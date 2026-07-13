const pendingMutations = new Set();
let cleanupLocked = false;

function cleanupLockedError() {
  const error = new Error('Local user data is being cleared.');
  error.code = 'LOCAL_DATA_CLEANUP_LOCKED';
  return error;
}

export function runLocalUserDataMutation(mutation) {
  if (cleanupLocked) return Promise.reject(cleanupLockedError());

  const operation = Promise.resolve().then(mutation);
  pendingMutations.add(operation);
  operation.then(
    () => pendingMutations.delete(operation),
    () => pendingMutations.delete(operation)
  );
  return operation;
}

export async function lockAndDrainLocalUserDataMutations() {
  if (cleanupLocked) throw cleanupLockedError();
  cleanupLocked = true;
  await Promise.allSettled([...pendingMutations]);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    cleanupLocked = false;
  };
}
