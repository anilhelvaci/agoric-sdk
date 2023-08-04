// cf https://github.com/Agoric/agoric-sdk/blob/ta/deployment-types/packages/deploy-script-support/src/externalTypes.js
/**
 * @callback PublishBundleRef
 * @param {ERef<VatSourceRef>} bundle
 * @returns {Promise<VatSourceRef>}
 */
/**
 * @typedef {{
 *  bundleSource: typeof import('@endo/bundle-source').default,
 *  now: () => number,
 *  lookup: (...path: string[]) => unknown,
 *  publishBundle: PublishBundleRef,
 *  pathResolve: (...path: string[]) => string,
 *  cacheDir: string,
 * }} DeployScriptEndownments
 */
/**
 * @typedef {{
 * agoricNames: ERef<NameHub>,
 * bank: ERef<import("@agoric/vats/src/vat-bank.js").Bank>,
 * board: ERef<import("@agoric/vats").Board>,
 * faucet: unknown,
 * myAddressNameAdmin: ERef<import("@agoric/vats").NameAdmin>,
 * namesByAddress: ERef<NameHub>,
 * scratch: ERef<import('@agoric/internal/src/scratch.js').ScratchPad>,
 * zoe: ERef<ZoeService>,
 * }} CanonicalHome
 */
/**
 * @callback DeployScriptFunction
 * @param {Promise<CanonicalHome>} homeP
 * @param {DeployScriptEndownments} endowments
 * @returns {Promise<void>}
 */
