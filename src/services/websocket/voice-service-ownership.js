export class VoiceServiceOwnership {
  constructor() {
    this.current = null;
    this.sequence = 0;
  }

  claim(owner, service, onRevoked) {
    if (!owner) throw new TypeError('Voice service owner is required.');
    if (!service || typeof service.disconnect !== 'function') {
      throw new TypeError('Voice service is invalid.');
    }
    if (onRevoked !== undefined && typeof onRevoked !== 'function') {
      throw new TypeError('Voice service revocation handler is invalid.');
    }
    const previous = this.current;
    this.current = Object.freeze({
      owner,
      service,
      onRevoked,
      sequence: ++this.sequence
    });
    if (previous && previous.owner !== owner) {
      try { previous.onRevoked?.(); } catch {}
    }
    return previous;
  }

  owns(owner, service) {
    return this.current?.owner === owner && this.current?.service === service;
  }

  release(owner, service) {
    if (!this.owns(owner, service)) return false;
    this.current = null;
    return true;
  }
}

export const voiceServiceOwnership = new VoiceServiceOwnership();
