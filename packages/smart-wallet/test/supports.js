import * as ActionType from '@agoric/internal/src/action-types.js';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';
import centralSupplyBundle from '@agoric/vats/bundles/bundle-centralSupply.js';
import {
  installBootContracts,
  makeAddressNameHubs,
  makeBoard,
} from '@agoric/vats/src/core/basic-behaviors.js';
import { setupClientManager } from '@agoric/vats/src/core/chain-behaviors.js';
import '@agoric/vats/src/core/types.js';
import { makeAgoricNamesAccess, makePromiseSpace } from '@agoric/vats';
import { buildRootObject as boardRoot } from '@agoric/vats/src/vat-board.js';
import { buildRootObject as mintsRoot } from '@agoric/vats/src/vat-mints.js';
import { makeMockChainStorageRoot } from '@agoric/internal/src/storage-test-utils.js';
import { makeZoeKit } from '@agoric/zoe';
import { makeRatio } from '@agoric/zoe/src/contractSupport/ratio.js';
import { eventLoopIteration } from '@agoric/internal/src/testing-utils.js';
import { makeFakeVatAdmin } from '@agoric/zoe/tools/fakeVatAdmin.js';
import { makeLoopback } from '@endo/captp';
import { E, Far } from '@endo/far';
import { makeScalarBigMapStore } from '@agoric/vat-data';
import { makeFakeBankKit } from '@agoric/vats/tools/bank-utils.js';
import { Fail } from '@agoric/assert';

export { ActionType };

/**
 * @param {object} kit
 * @param {Brand<'nat'>} kit.brand
 * @param {Issuer<'nat'>} kit.issuer
 * @param {Mint<'nat'>} [kit.mint]
 */
export const withAmountUtils = kit => {
  return {
    ...kit,
    /**
     * @param {NatValue} v
     */
    make: v => AmountMath.make(kit.brand, v),
    makeEmpty: () => AmountMath.makeEmpty(kit.brand),
    /**
     * @param {NatValue} n
     * @param {NatValue} [d]
     */
    makeRatio: (n, d) => makeRatio(n, kit.brand, d),
  };
};
/** @typedef {ReturnType<typeof withAmountUtils>} AmountUtils */

/**
 *
 * @param {ERef<StoredFacet>} subscription
 */
export const subscriptionKey = subscription => {
  return E(subscription)
    .getStoreKey()
    .then(storeKey => {
      const [prefix, unique] = storeKey.storeSubkey.split(':');
      prefix === 'fake' ||
        Fail`subscriptionKey helper only supports fake storage`;
      return unique;
    });
};

const setUpZoeForTest = async () => {
  const { makeFar } = makeLoopback('zoeTest');
  const { zoeService, feeMintAccess } = await makeFar(
    makeZoeKit(makeFakeVatAdmin(() => {}).admin),
  );
  /** @type {import('@endo/far').ERef<ZoeService>} */
  const zoe = makeFar(zoeService);
  return {
    zoe,
    feeMintAccess,
  };
};
harden(setUpZoeForTest);

/** @returns {import('@agoric/vats').BridgeManager} */
const makeFakeBridgeManager = () =>
  Far('fakeBridgeManager', {
    register(bridgeId, handler) {
      return Far('scopedBridgeManager', {
        fromBridge(_obj) {
          assert.fail(`expected fromBridge`);
        },
        toBridge(obj) {
          handler || Fail`No handler for ${bridgeId}`;
          // Rely on interface guard for validation.
          // This should also be validated upstream but don't rely on it.
          // @ts-expect-error handler possibly undefined
          return E(handler).fromBridge(obj);
        },
        setHandler(newHandler) {
          handler = newHandler;
        },
      });
    },
  });
/**
 *
 * @param {*} log
 * @returns {Promise<ChainBootstrapSpace>}>}
 */
export const makeMockTestSpace = async log => {
  const space = /** @type {any} */ (makePromiseSpace(log));
  const { consume, produce } =
    /** @type { BootstrapPowers & { consume: { loadVat: (n: 'mints') => MintsVat, loadCriticalVat: (n: 'mints') => MintsVat }} } */ (
      space
    );
  const { agoricNames, spaces } = makeAgoricNamesAccess();
  produce.agoricNames.resolve(agoricNames);

  const { zoe, feeMintAccess } = await setUpZoeForTest();
  produce.zoe.resolve(zoe);
  produce.feeMintAccess.resolve(feeMintAccess);

  const vatLoader = name => {
    switch (name) {
      case 'mints':
        return mintsRoot();
      case 'board': {
        const baggage = makeScalarBigMapStore('baggage');
        return boardRoot({}, {}, baggage);
      }
      default:
        throw Error('unknown loadVat name');
    }
  };
  produce.loadVat.resolve(vatLoader);
  produce.loadCriticalVat.resolve(vatLoader);

  const bldKit = makeIssuerKit('BLD');
  produce.bldIssuerKit.resolve(bldKit);
  produce.bridgeManager.resolve(makeFakeBridgeManager());

  const storageRoot = makeMockChainStorageRoot();
  produce.chainStorage.resolve(storageRoot);

  produce.testFirstAnchorKit.resolve(makeIssuerKit('AUSD', 'nat'));

  const fakeBankKit = makeFakeBankKit([]);

  produce.bankManager.resolve(
    Promise.resolve(
      Far(
        'mockBankManager',
        /** @type {any} */ ({
          getBankForAddress: _a => fakeBankKit.bank,
        }),
      ),
    ),
  );

  await Promise.all([
    // @ts-expect-error
    makeBoard({ consume, produce, ...spaces }),
    makeAddressNameHubs({ consume, produce, ...spaces }),
    installBootContracts({ consume, produce, ...spaces }),
    setupClientManager({ consume, produce, ...spaces }),
  ]);

  return space;
};

/**
 * @param {bigint} value
 * @param {{
 *   feeMintAccess: ERef<FeeMintAccess>,
 *   zoe: ERef<ZoeService>,
 * }} powers
 * @returns {Promise<Payment>}
 */
export const mintCentralPayment = async (
  value,
  { feeMintAccess: feeMintAccessP, zoe },
) => {
  const feeMintAccess = await feeMintAccessP;

  const centralSupply = await E(zoe).install(centralSupplyBundle);

  const { creatorFacet: supplier } = await E(zoe).startInstance(
    centralSupply,
    {},
    { bootstrapPaymentValue: value },
    { feeMintAccess },
  );
  return E(supplier).getBootstrapPayment();
};

/**
 *
 * @param {ERef<{getPublicTopics: () => import('@agoric/zoe/src/contractSupport').TopicsRecord}>} hasTopics
 * @param {string} subscriberName
 */
export const topicPath = (hasTopics, subscriberName) => {
  return E(hasTopics)
    .getPublicTopics()
    .then(subscribers => subscribers[subscriberName])
    .then(tr => tr.storagePath);
};

/** @type {<T>(subscriber: ERef<Subscriber<T>>) => Promise<T>} */
export const headValue = async subscriber => {
  await eventLoopIteration();
  const record = await E(subscriber).subscribeAfter();
  return record.head.value;
};
