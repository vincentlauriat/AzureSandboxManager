'use strict';

/**
 * Azure Resource Manager client built on the App Service managed identity.
 *
 * Token retrieval follows the documented App Service REST contract, which is
 * NOT the IMDS endpoint used on virtual machines:
 * https://learn.microsoft.com/azure/app-service/overview-managed-identity
 *
 *   GET ${IDENTITY_ENDPOINT}?resource=<uri>&api-version=2019-08-01
 *   X-IDENTITY-HEADER: ${IDENTITY_HEADER}
 */

const ARM_RESOURCE = 'https://management.azure.com';
const TOKEN_API_VERSION = '2019-08-01';

// Refresh slightly before expiry so a collection never starts with a token
// that dies mid-flight.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

class ArmAccessError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'ArmAccessError';
    this.status = status ?? null;
    this.code = code ?? null;
    // A missing managed identity is an expected pre-configuration state, not a
    // crash: it must read as 'denied' so the UI offers the setup instructions.
    this.denied = status === 401 || status === 403 || status === 404 || code === 'NoManagedIdentity';
  }
}

class ArmClient {
  constructor({ fetchImpl = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
    this.fetch = fetchImpl;
    this.env = env;
    this.now = now;
    this.cachedToken = null;
  }

  get available() {
    return Boolean(this.env.IDENTITY_ENDPOINT && this.env.IDENTITY_HEADER);
  }

  async getToken() {
    if (this.cachedToken && this.cachedToken.expiresAtMs - EXPIRY_MARGIN_MS > this.now()) {
      return this.cachedToken.value;
    }
    if (!this.available) {
      throw new ArmAccessError(
        'No managed identity available: IDENTITY_ENDPOINT and IDENTITY_HEADER are not set. ' +
          'This is expected when running outside App Service.',
        { code: 'NoManagedIdentity' }
      );
    }

    const url = `${this.env.IDENTITY_ENDPOINT}?resource=${encodeURIComponent(ARM_RESOURCE)}&api-version=${TOKEN_API_VERSION}`;
    const response = await this.fetch(url, {
      headers: { 'X-IDENTITY-HEADER': this.env.IDENTITY_HEADER },
    });

    if (!response.ok) {
      throw new ArmAccessError(`Token endpoint returned HTTP ${response.status}`, {
        status: response.status,
        code: 'TokenEndpointError',
      });
    }

    const body = await response.json();
    // expires_on is a STRING of epoch seconds, not a number. Parsing it as-is
    // and comparing against Date.now() silently yields a token that looks
    // permanently expired.
    const expiresAtMs = Number.parseInt(body.expires_on, 10) * 1000;
    if (!Number.isFinite(expiresAtMs)) {
      throw new ArmAccessError(`Token endpoint returned an unparsable expires_on: ${body.expires_on}`, {
        code: 'TokenEndpointError',
      });
    }

    this.cachedToken = { value: body.access_token, expiresAtMs };
    return body.access_token;
  }

  /** GET an ARM path (absolute, starting with /subscriptions/...) and return parsed JSON. */
  async get(path, apiVersion) {
    const token = await this.getToken();
    const separator = path.includes('?') ? '&' : '?';
    const url = `${ARM_RESOURCE}${path}${separator}api-version=${apiVersion}`;
    const response = await this.fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!response.ok) {
      let code = null;
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        code = body?.error?.code ?? null;
        message = body?.error?.message ?? message;
      } catch {
        // A non-JSON error body is still an error; keep the status.
      }
      throw new ArmAccessError(message, { status: response.status, code });
    }

    return response.json();
  }

  /** GET a paged ARM list, following nextLink until exhausted. */
  async getAll(path, apiVersion) {
    const first = await this.get(path, apiVersion);
    const items = first.value ?? [];
    let next = first.nextLink;
    const token = await this.getToken();

    while (next) {
      const response = await this.fetch(next, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        throw new ArmAccessError(`Paging failed with HTTP ${response.status}`, { status: response.status });
      }
      const page = await response.json();
      items.push(...(page.value ?? []));
      next = page.nextLink;
    }
    return items;
  }
}

module.exports = { ArmClient, ArmAccessError, ARM_RESOURCE, TOKEN_API_VERSION };
