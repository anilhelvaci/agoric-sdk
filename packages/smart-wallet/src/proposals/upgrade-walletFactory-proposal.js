// @ts-check
import { E } from '@endo/far';
import { makeMarshal } from '@endo/marshal';

const { fromEntries, keys, values } = Object;
const { Fail } = assert;

// vstorage paths under published.*
const WALLET_STORAGE_PATH_SEGMENT = 'wallet';
const BOARD_AUX = 'boardAux';

const marshalData = makeMarshal(_val => Fail`data only`);

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

/**
 * @param { BootstrapPowers } powers
 */
export const publishAgoricBrandsDisplayInfo = async ({
  consume: { agoricNames, board, chainStorage },
}) => {
  // @ts-expect-error chainStorage is only falsy in testing
  const boardAux = E(chainStorage).makeChildNode(BOARD_AUX);
  const publishBrandInfo = async brand => {
    const [id, displayInfo, allegedName] = await Promise.all([
      E(board).getId(brand),
      E(brand).getDisplayInfo(),
      E(brand).getAllegedName(),
    ]);
    const node = E(boardAux).makeChildNode(id);
    const aux = marshalData.toCapData(harden({ allegedName, displayInfo }));
    await E(node).setValue(JSON.stringify(aux));
  };

  /** @type {ERef<NameHub>} */
  const brandHub = E(agoricNames).lookup('brand');
  const brands = await E(brandHub).values();
  // tolerate failure; in particular, for the timer brand
  await Promise.allSettled(brands.map(publishBrandInfo));
};
harden(publishAgoricBrandsDisplayInfo);

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
  [publishAgoricBrandsDisplayInfo.name]: {
    consume: { agoricNames: true, board: true, chainStorage: true },
  },
};
harden(manifest);

export const getManifestForUpgrade = (_powers, { walletFactoryRef }) => {
  return harden({
    manifest,
    options: { walletFactoryRef },
  });
};
