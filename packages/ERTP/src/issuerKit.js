// @ts-check
// @jessie-check

import { assert } from '@agoric/assert';
import { assertPattern } from '@agoric/store';
import { makeScalarBigMapStore, vivifyRootPorter } from '@agoric/vat-data';

import { AssetKind, assertAssetKind } from './amountMath.js';
import { coerceDisplayInfo } from './displayInfo.js';
import { vivifyPaymentLedger } from './paymentLedger.js';

import './types.js';

/** @typedef {import('@agoric/vat-data').Porter} Porter */

/**
 * @template {AssetKind} K
 * @param {Porter} issuerPorter
 * @param {ShutdownWithFailure=} optShutdownWithFailure If this issuer fails
 * in the middle of an atomic action (which btw should never happen), it
 * potentially leaves its ledger in a corrupted state. If this function was
 * provided, then the failed atomic action will call it, so that some
 * larger unit of computation, like the enclosing vat, can be shutdown
 * before anything else is corrupted by that corrupted state.
 * See https://github.com/Agoric/agoric-sdk/issues/3434
 * @returns {IssuerKit<K>}
 */
export const vivifyIssuerKit = (
  issuerPorter,
  optShutdownWithFailure = undefined,
) => {
  const issuerBaggage = issuerPorter.getBaggage();
  const name = issuerBaggage.get('name');
  const assetKind = issuerBaggage.get('assetKind');
  const displayInfo = issuerBaggage.get('displayInfo');
  const elementSchema = issuerBaggage.get('elementSchema');
  assert.typeof(name, 'string');
  assertAssetKind(assetKind);

  // Add assetKind to displayInfo, or override if present
  const cleanDisplayInfo = coerceDisplayInfo(displayInfo, assetKind);
  if (optShutdownWithFailure !== undefined) {
    assert.typeof(optShutdownWithFailure, 'function');
  }

  if (elementSchema !== undefined) {
    assertPattern(elementSchema);
  }

  // Attenuate the powerful authority to mint and change balances
  const { issuer, mint, brand } = vivifyPaymentLedger(
    issuerPorter,
    name,
    assetKind,
    cleanDisplayInfo,
    elementSchema,
    optShutdownWithFailure,
  );

  return harden({
    brand,
    issuer,
    mint,
    displayInfo: cleanDisplayInfo,
  });
};
harden(vivifyIssuerKit);

/**
 * @template {AssetKind} K
 * The name becomes part of the brand in asset descriptions.
 * The name is useful for debugging and double-checking
 * assumptions, but should not be trusted wrt any external namespace.
 * For example, anyone could create a new issuer kit with name 'BTC', but
 * it is not bitcoin or even related. It is only the name according
 * to that issuer and brand.
 *
 * The assetKind will be used to import a specific mathHelpers
 * from the mathHelpers library. For example, natMathHelpers, the
 * default, is used for basic fungible tokens.
 *
 *  `displayInfo` gives information to the UI on how to display the amount.
 *
 * @param {Porter} issuerPorter
 * @param {string} name
 * @param {K} [assetKind=AssetKind.NAT]
 * @param {AdditionalDisplayInfo} [displayInfo={}]
 * @param {ShutdownWithFailure=} optShutdownWithFailure If this issuer fails
 * in the middle of an atomic action (which btw should never happen), it
 * potentially leaves its ledger in a corrupted state. If this function was
 * provided, then the failed atomic action will call it, so that some
 * larger unit of computation, like the enclosing vat, can be shutdown
 * before anything else is corrupted by that corrupted state.
 * See https://github.com/Agoric/agoric-sdk/issues/3434
 * @param {Partial<{elementSchema: Pattern}>} [options]
 * @returns {IssuerKit<K>}
 */
export const makeDurableIssuerKit = (
  issuerPorter,
  name,
  // @ts-expect-error K could be instantiated with a different subtype of AssetKind
  assetKind = AssetKind.NAT,
  displayInfo = harden({}),
  optShutdownWithFailure = undefined,
  { elementSchema = undefined } = {},
) => {
  const issuerBaggage = issuerPorter.getBaggage();
  issuerBaggage.init('name', name);
  issuerBaggage.init('assetKind', assetKind);
  issuerBaggage.init('displayInfo', displayInfo);
  issuerBaggage.init('elementSchema', elementSchema);
  return vivifyIssuerKit(issuerPorter, optShutdownWithFailure);
};
harden(makeDurableIssuerKit);

/**
 * @template {AssetKind} K
 * The name becomes part of the brand in asset descriptions.
 * The name is useful for debugging and double-checking
 * assumptions, but should not be trusted wrt any external namespace.
 * For example, anyone could create a new issuer kit with name 'BTC', but
 * it is not bitcoin or even related. It is only the name according
 * to that issuer and brand.
 *
 * The assetKind will be used to import a specific mathHelpers
 * from the mathHelpers library. For example, natMathHelpers, the
 * default, is used for basic fungible tokens.
 *
 *  `displayInfo` gives information to the UI on how to display the amount.
 *
 * @param {string} name
 * @param {K} [assetKind=AssetKind.NAT]
 * @param {AdditionalDisplayInfo} [displayInfo={}]
 * @param {ShutdownWithFailure=} optShutdownWithFailure If this issuer fails
 * in the middle of an atomic action (which btw should never happen), it
 * potentially leaves its ledger in a corrupted state. If this function was
 * provided, then the failed atomic action will call it, so that some
 * larger unit of computation, like the enclosing vat, can be shutdown
 * before anything else is corrupted by that corrupted state.
 * See https://github.com/Agoric/agoric-sdk/issues/3434
 * @param {Partial<{elementSchema: Pattern}>} [options]
 * @returns {IssuerKit<K>}
 */
export const makeIssuerKit = (
  name,
  // @ts-expect-error K could be instantiated with a different subtype of AssetKind
  assetKind = AssetKind.NAT,
  displayInfo = harden({}),
  optShutdownWithFailure = undefined,
  { elementSchema = undefined } = {},
) =>
  makeDurableIssuerKit(
    vivifyRootPorter(
      makeScalarBigMapStore('dropped issuer kit', { durable: true }),
    ),
    name,
    assetKind,
    displayInfo,
    optShutdownWithFailure,
    { elementSchema },
  );
harden(makeIssuerKit);
