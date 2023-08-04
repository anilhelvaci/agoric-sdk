// @ts-check
import { E } from '@endo/far';

const WALLET_STORAGE_PATH_SEGMENT = 'wallet';

const { fromEntries, keys, values } = Object;

// borrow zip, allValues from @agoric/interal
// but don't bring in all of @endo/marshal etc.
/** @type { <X, Y>(xs: X[], ys: Y[]) => [X, Y][]} */
const zip = (xs, ys) => harden(xs.map((x, i) => [x, ys[+i]]));

/** @type { <T extends Record<string, ERef<any>>>(obj: T) => Promise<{ [K in keyof T]: Awaited<T[K]>}> } */
const allValues = async obj => {
  const resolved = await Promise.all(values(obj));
  // @ts-expect-error cast
  return harden(fromEntries(zip(keys(obj), resolved)));
};

/**
 * @param { BootstrapPowers } powers
 *
 * @param {object} config
 * @param {{ walletFactoryRef: VatSourceRef & { bundleID: string } }} config.options
 */
export const upgradeWalletFactory = async (
  {
    consume: {
      contractKits,
      governedContractKits,
      chainStorage,
      walletBridgeManager: walletBridgeManagerP,
    },
    instance: {
      consume: { walletFactory: wfInstanceP, provisionPool: ppInstanceP },
    },
  },
  config,
) => {
  console.log('upgradeWalletFactory: config', config);
  const { walletFactoryRef } = config.options;

  // console.log('upgradeWalletFactory: awaiting instances etc.');
  const { wfInstance, ppInstance, walletBridgeManager, storageNode } =
    await allValues({
      wfInstance: wfInstanceP,
      ppInstance: ppInstanceP,
      walletBridgeManager: walletBridgeManagerP,
      // @ts-expect-error chainStorage is only falsy in testing
      storageNode: E(chainStorage).makeChildNode(WALLET_STORAGE_PATH_SEGMENT),
    });
  // console.log('upgradeWalletFactory: awaiting contract kits');
  const { wfKit, ppKit } = await allValues({
    wfKit: E(contractKits).get(wfInstance),
    ppKit: E(governedContractKits).get(ppInstance),
  });
  // console.log('upgradeWalletFactory: awaiting walletReviver');
  const walletReviver = await E(ppKit.creatorFacet).getWalletReviver();
  const newPrivateArgs = harden({
    storageNode,
    walletBridgeManager,
    walletReviver,
  });

  console.log(
    'upgradeWalletFactory: upgrading with newPrivateArgs',
    newPrivateArgs,
  );
  await E(wfKit.adminFacet).upgradeContract(
    walletFactoryRef.bundleID,
    newPrivateArgs,
  );
  console.log('upgradeWalletFactory: done');
};
harden(upgradeWalletFactory);

/** @type { import("@agoric/vats/src/core/lib-boot").BootstrapManifest } */
const manifest = {
  [upgradeWalletFactory.name]: {
    // include rationale for closely-held, high authority capabilities
    consume: {
      contractKits: `to upgrade walletFactory using its adminFacet`,
      governedContractKits:
        'to get walletReviver from provisionPool.creatorFacet',
      chainStorage: 'to allow walletFactory to (continue) write to vstorage',
      walletBridgeManager: 'to handle bridged cosmos SpendAction messages',
    },
    // widely-shared, low authority instance handles need no rationale
    instance: {
      consume: { walletFactory: true, provisionPool: true },
    },
  },
};
harden(manifest);

export const getManifestForUpgrade = (_powers, { walletFactoryRef }) => {
  return harden({
    manifest,
    options: { walletFactoryRef },
  });
};
