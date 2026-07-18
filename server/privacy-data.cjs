'use strict';

const PRIVACY_DATASETS = Object.freeze([
  // Manufacturer erasure must complete while the account still owns both its
  // binding and active credential. Nothing account-bound is deleted locally
  // until this external processor has confirmed completion.
  ['manufacturer', 'manufacturerPrivacyRepository'],
  ['safety', 'safetyRepository'],
  ['deviceActions', 'actionOutboxRepository'],
  ['pushRegistrations', 'pushRepository'],
  ['devices', 'robotRepository'],
  // Credentials are the final deletion stage so any failed owned-data delete
  // remains retryable by the authenticated account.
  ['sessions', 'authSessionRepository']
]);

function privacyFailure(operation, dataset, cause) {
  const error = new Error(`Account ${operation} could not complete for ${dataset}.`);
  error.name = 'PrivacyDataError';
  error.code = `PRIVACY_${operation.toUpperCase()}_${dataset.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_FAILED`;
  error.dataset = dataset;
  error.statusCode = 503;
  error.cause = cause;
  return error;
}

/**
 * Aggregate every account-bound backend store behind one export/delete gate.
 * Missing repositories are represented explicitly in exports and surfaced by
 * `missingRepositories`; a production deployment can therefore fail its
 * configuration check instead of silently omitting a data processor.
 */
function createPrivacyDataCoordinator(repositories = {}) {
  const beforeAccountDeletion = repositories.beforeAccountDeletion;
  const configured = PRIVACY_DATASETS.map(([dataset, repositoryName]) => ({
    dataset,
    repositoryName,
    repository: repositories[repositoryName]
  }));

  return {
    missingRepositories() {
      return configured
        .filter(({ repository }) => !repository
          || typeof repository.exportUserData !== 'function'
          || typeof repository.deleteUserData !== 'function')
        .map(({ repositoryName }) => repositoryName);
    },

    async exportUserData(userId) {
      if (typeof userId !== 'string' || !userId) throw new TypeError('A user is required for privacy export.');
      const result = {};
      for (const { dataset, repository } of configured) {
        if (typeof repository?.exportUserData !== 'function') {
          result[dataset] = { status: 'not-configured', data: null };
          continue;
        }
        try {
          result[dataset] = {
            status: 'included',
            data: await repository.exportUserData(userId)
          };
        } catch (error) {
          throw privacyFailure('export', dataset, error);
        }
      }
      return { schemaVersion: 1, datasets: result };
    },

    async deleteUserData(userId, { recoverySessionId } = {}) {
      if (typeof userId !== 'string' || !userId) throw new TypeError('A user is required for privacy deletion.');
      const authRepository = repositories.authSessionRepository;
      if (typeof authRepository?.beginAccountDeletion === 'function') {
        await authRepository.beginAccountDeletion(userId, Date.now(), recoverySessionId);
      }
      // Persist the account-deletion fence first, then drain any robot action
      // that already passed its attempt guard. Manufacturer erasure must run
      // only after this hook returns, otherwise a delayed command could
      // repopulate or act on a robot after its account data was erased.
      if (typeof beforeAccountDeletion === 'function') {
        try {
          await beforeAccountDeletion(userId);
        } catch (error) {
          throw privacyFailure('delete', 'deviceActionFence', error);
        }
      }
      const attempts = [];
      let accountFinalized = false;
      for (const { dataset, repository } of configured) {
        if (typeof repository?.deleteUserData !== 'function') {
          attempts.push({ dataset, status: 'not-configured' });
          continue;
        }
        try {
          if (dataset === 'sessions' && typeof repository.finalizeAccountDeletion === 'function') {
            await repository.finalizeAccountDeletion(userId, { recoverySessionId });
            accountFinalized = true;
          } else {
            await repository.deleteUserData(userId);
          }
          attempts.push({ dataset, status: 'deleted' });
        } catch (error) {
          attempts.push({ dataset, status: 'failed', error: privacyFailure('delete', dataset, error) });
          // This is deliberately fail-fast. Continuing could erase a binding
          // needed by the manufacturer request or revoke the only credential
          // with which the account can retry an incomplete deletion.
          break;
        }
      }
      const failures = attempts.filter(({ status }) => status === 'failed');
      if (failures.length) {
        const error = new Error('Account deletion did not complete across every configured data store.');
        error.name = 'PrivacyDataAggregateError';
        error.code = 'PRIVACY_DELETE_INCOMPLETE';
        error.statusCode = 503;
        error.failures = failures.map(({ dataset, error: failure }) => ({ dataset, code: failure.code }));
        throw error;
      }
      if (!accountFinalized && typeof authRepository?.completeAccountDeletion === 'function') {
        await authRepository.completeAccountDeletion(userId);
      }
      return {
        deleted: attempts.filter(({ status }) => status === 'deleted').map(({ dataset }) => dataset),
        notConfigured: attempts.filter(({ status }) => status === 'not-configured').map(({ dataset }) => dataset)
      };
    }
  };
}

module.exports = { PRIVACY_DATASETS, createPrivacyDataCoordinator };
