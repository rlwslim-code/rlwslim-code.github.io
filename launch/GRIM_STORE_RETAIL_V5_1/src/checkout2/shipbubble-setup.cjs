'use strict';

// Admin-only, read-only provider configuration discovery. This module never
// books a courier, changes an address, debits a shipping wallet or exposes
// the Shipbubble API key to the browser.
const BASE = 'https://api.shipbubble.com/v1/shipping';

class ShipbubbleSetupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ShipbubbleSetupError';
    this.code = code;
    this.status = 503;
  }
}

const positiveCode = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const safeText = (value, max = 180) =>
  typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max) : '';

function normalizeAddresses(payload) {
  if (!Array.isArray(payload?.results)) {
    throw new ShipbubbleSetupError('PROVIDER_RESPONSE_INVALID', 'Shipbubble did not return a validated-address list.');
  }
  return payload.results
    .filter(item => positiveCode(item?.address_code))
    .map(item => {
      const a = item.address_data || item;
      return {
        addressCode: Number(item.address_code),
        city: safeText(a.city, 80),
        state: safeText(a.state, 80),
        country: safeText(a.country, 80),
        countryCode: safeText(a.country_code, 4),
        formattedAddress: safeText(a.formatted_address || a.street, 220),
      };
    })
    .filter(a => a.countryCode === 'NG' || a.country.toLowerCase() === 'nigeria')
    .sort((a, b) => {
      const score = x => (/ekiti/i.test(x.state) ? 2 : 0) + (/oye/i.test(x.city + ' ' + x.formattedAddress) ? 2 : 0);
      return score(b) - score(a);
    })
    .slice(0, 100);
}

function normalizeCategories(payload) {
  if (!Array.isArray(payload)) {
    throw new ShipbubbleSetupError('PROVIDER_RESPONSE_INVALID', 'Shipbubble did not return package categories.');
  }
  return payload.filter(item => positiveCode(item?.category_id))
    .map(item => ({ categoryId: Number(item.category_id), name: safeText(item.category, 100) }))
    .slice(0, 100);
}

function createProviderSetup({apiKey, fetchImpl = globalThis.fetch, timeoutMs = 12000}) {
  if (typeof apiKey !== 'string' || apiKey.length < 8 || /[\s\x00-\x1f]/.test(apiKey)) {
    throw new ShipbubbleSetupError('SHIPBUBBLE_KEY_MISSING', 'A Shipbubble Production API key is not configured on the server.');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  async function read(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${BASE}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403
          ? 'SHIPBUBBLE_AUTH_REJECTED' : 'SHIPBUBBLE_UNAVAILABLE';
        throw new ShipbubbleSetupError(code, response.status === 401 || response.status === 403
          ? 'Shipbubble rejected the server key or API access is disabled.'
          : 'Unable to read Shipbubble setup information.');
      }
      const data = await response.json();
      if (data?.status !== 'success') {
        throw new ShipbubbleSetupError('SHIPBUBBLE_REJECTED', 'Shipbubble could not retrieve setup information.');
      }
      return data.data;
    } catch (error) {
      if (error instanceof ShipbubbleSetupError) throw error;
      throw new ShipbubbleSetupError('SHIPBUBBLE_UNAVAILABLE', 'Unable to contact Shipbubble. Try again later.');
    } finally {
      clearTimeout(timer);
    }
  }

  return async function getProviderSetup() {
    const [addresses, categories] = await Promise.all([
      read('/address'),
      read('/labels/categories'),
    ]);
    return {
      addresses: normalizeAddresses(addresses),
      categories: normalizeCategories(categories),
    };
  };
}

module.exports = {createProviderSetup, normalizeAddresses, normalizeCategories, ShipbubbleSetupError};
