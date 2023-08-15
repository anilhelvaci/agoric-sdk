// @ts-check
import { AmountMath, BrandShape } from '@agoric/ertp';
import { UnguardedHelperI } from '@agoric/internal/src/typeGuards.js';
import {
  observeIteration,
  observeNotifier,
  subscribeEach,
} from '@agoric/notifier';
import {
  M,
  makeScalarBigMapStore,
  makeScalarBigSetStore,
  prepareExoClassKit,
} from '@agoric/vat-data';
import { PowerFlags } from '@agoric/vats/src/walletFlags.js';
import {
  PublicTopicShape,
  makeRecorderTopic,
} from '@agoric/zoe/src/contractSupport/topics.js';
import { InstanceHandleShape } from '@agoric/zoe/src/typeGuards.js';
import { E } from '@endo/far';
import { Far, deeplyFulfilled } from '@endo/marshal';

const { details: X, quote: q, Fail } = assert;

/**
 * @typedef {import('@agoric/zoe/src/zoeService/utils').Instance<
 *   import('@agoric/inter-protocol/src/psm/psm.js').start
 * >} PsmInstance
 */

/**
 * @typedef {object} ProvisionPoolKitReferences
 * @property {ERef<BankManager>} bankManager
 * @property {ERef<import('@agoric/vats').NameAdmin>} namesByAddressAdmin
 * @property {ERef<
 *   import('@agoric/vats/src/core/startWalletFactory').WalletFactoryStartResult['creatorFacet']
 * >} walletFactory
 */

/**
 * @typedef {object} MetricsNotification Metrics naming scheme is that nouns are
 *   present values and past-participles are accumulative.
 * @property {bigint} walletsProvisioned count of new wallets provisioned
 * @property {Amount<'nat'>} totalMintedProvided running sum of Minted provided
 *   to new wallets
 * @property {Amount<'nat'>} totalMintedConverted running sum of Minted ever
 *   received by the contract from PSM
 */

/**
 * Given attenuated access to the funding purse, handle requests to provision
 * smart wallets.
 *
 * @param {(depositBank: ERef<Bank>) => Promise<void>} sendInitialPayment
 * @param {() => void} onProvisioned
 *
 * @typedef {import('@agoric/vats/src/vat-bank.js').Bank} Bank
 */
export const makeBridgeProvisionTool = (sendInitialPayment, onProvisioned) => {
  /** @param {ProvisionPoolKitReferences} refs */
  const makeBridgeHandler = ({
    bankManager,
    namesByAddressAdmin,
    walletFactory,
  }) =>
    Far('provisioningHandler', {
      fromBridge: async obj => {
        obj.type === 'PLEASE_PROVISION' ||
          Fail`Unrecognized request ${obj.type}`;
        console.info('PLEASE_PROVISION', obj);
        const { address, powerFlags } = obj;
        powerFlags.includes(PowerFlags.SMART_WALLET) ||
          Fail`missing SMART_WALLET in powerFlags`;

        const bank = E(bankManager).getBankForAddress(address);
        // only proceed if we can provide funds
        await sendInitialPayment(bank);

        const [_, created] = await E(walletFactory).provideSmartWallet(
          address,
          bank,
          namesByAddressAdmin,
        );
        if (created) {
          onProvisioned();
        }
        console.info(created ? 'provisioned' : 're-provisioned', address);
      },
    });
  return makeBridgeHandler;
};

/**
 * @param {import('@agoric/vat-data').Baggage} baggage
 * @param {{
 *   makeRecorderKit: import('@agoric/zoe/src/contractSupport/recorder.js').MakeRecorderKit;
 *   params: any;
 *   poolBank: import('@endo/far').ERef<Bank>;
 *   zcf: ZCF;
 * }} powers
 */
export const prepareProvisionPoolKit = (
  baggage,
  { makeRecorderKit, params, poolBank, zcf },
) => {
  const zoe = zcf.getZoeService();

  const makeProvisionPoolKitInternal = prepareExoClassKit(
    baggage,
    'ProvisionPoolKit',
    {
      machine: M.interface('ProvisionPoolKit machine', {
        addRevivableAddresses: M.call(M.arrayOf(M.string())).returns(),
        getWalletReviver: M.call().returns(
          M.remotable('ProvisionPoolKit wallet reviver'),
        ),
        setReferences: M.callWhen({
          bankManager: M.eref(M.remotable('bankManager')),
          namesByAddressAdmin: M.eref(M.remotable('nameAdmin')),
          walletFactory: M.eref(M.remotable('walletFactory')),
        }).returns(),
        makeHandler: M.call().returns(M.remotable('BridgeHandler')),
        initPSM: M.call(BrandShape, InstanceHandleShape).returns(),
      }),
      walletReviver: M.interface('ProvisionPoolKit wallet reviver', {
        reviveWallet: M.callWhen(M.string()).returns(
          M.remotable('SmartWallet'),
        ),
        ackWallet: M.call(M.string()).returns(M.boolean()),
      }),
      helper: UnguardedHelperI,
      public: M.interface('ProvisionPoolKit public', {
        getPublicTopics: M.call().returns({ metrics: PublicTopicShape }),
      }),
    },
    /**
     * @param {object} opts
     * @param {Purse<'nat'>} opts.fundPurse
     * @param {Brand} opts.poolBrand
     * @param {StorageNode} opts.metricsNode
     */
    ({ fundPurse, poolBrand, metricsNode }) => {
      /** @type {import('@agoric/zoe/src/contractSupport/recorder.js').RecorderKit<MetricsNotification>} */
      const metricsRecorderKit = makeRecorderKit(metricsNode);

      /** @type {MapStore<Brand, PsmInstance>} */
      const brandToPSM = makeScalarBigMapStore('brandToPSM', { durable: true });
      const revivableAddresses = makeScalarBigSetStore('revivableAddresses', {
        durable: true,
        keyShape: M.string(),
      });

      /**
       * to be set by `setReferences`
       *
       * @type {Partial<ProvisionPoolKitReferences>}
       */
      const references = {
        bankManager: undefined,
        namesByAddressAdmin: undefined,
        walletFactory: undefined,
      };

      return {
        brandToPSM,
        fundPurse,
        metricsRecorderKit,
        poolBrand,
        walletsProvisioned: 0n,
        totalMintedProvided: AmountMath.makeEmpty(poolBrand),
        totalMintedConverted: AmountMath.makeEmpty(poolBrand),
        revivableAddresses,
        ...references,
      };
    },
    {
      // aka "limitedCreatorFacet"
      machine: {
        /** @param {string[]} oldAddresses */
        addRevivableAddresses(oldAddresses) {
          console.log('revivableAddresses count', oldAddresses.length);
          this.state.revivableAddresses.addAll(oldAddresses);
        },
        getWalletReviver() {
          return this.facets.walletReviver;
        },
        /** @param {ProvisionPoolKitReferences} erefs */
        async setReferences(erefs) {
          const { bankManager, namesByAddressAdmin, walletFactory } = erefs;
          const obj = harden({
            bankManager,
            namesByAddressAdmin,
            walletFactory,
          });
          const refs = await deeplyFulfilled(obj);
          Object.assign(this.state, refs);
        },
        makeHandler() {
          const { bankManager, namesByAddressAdmin, walletFactory } =
            this.state;
          if (!bankManager || !namesByAddressAdmin || !walletFactory) {
            throw Fail`must set references before handling requests`;
          }
          const { helper } = this.facets;
          // a bit obtuse but leave for backwards compatibility with tests
          const innerMaker = makeBridgeProvisionTool(
            bank => helper.sendInitialPayment(bank),
            () => helper.onProvisioned(),
          );
          return innerMaker({
            bankManager,
            namesByAddressAdmin,
            walletFactory,
          });
        },
        /**
         * @param {Brand} brand
         * @param {PsmInstance} instance
         */
        initPSM(brand, instance) {
          const { brandToPSM } = this.state;
          brandToPSM.init(brand, instance);
        },
      },
      walletReviver: {
        /** @param {string} address */
        async reviveWallet(address) {
          const {
            revivableAddresses,
            bankManager,
            namesByAddressAdmin,
            walletFactory,
          } = this.state;
          if (!bankManager || !namesByAddressAdmin || !walletFactory) {
            throw Fail`must set references before handling requests`;
          }
          revivableAddresses.has(address) ||
            Fail`non-revivable address ${address}`;
          const bank = E(bankManager).getBankForAddress(address);
          const [wallet, _created] = await E(walletFactory).provideSmartWallet(
            address,
            bank,
            namesByAddressAdmin,
          );
          return wallet;
        },
        /**
         * @param {string} address
         * @returns {boolean} isRevive
         */
        ackWallet(address) {
          const { revivableAddresses } = this.state;
          if (!revivableAddresses.has(address)) {
            return false;
          }
          revivableAddresses.delete(address);
          return true;
        },
      },
      helper: {
        publishMetrics() {
          const {
            metricsRecorderKit,
            walletsProvisioned,
            totalMintedConverted,
            totalMintedProvided,
          } = this.state;
          void metricsRecorderKit.recorder.write(
            harden({
              walletsProvisioned,
              totalMintedProvided,
              totalMintedConverted,
            }),
          );
        },
        onTrade(converted) {
          const { state, facets } = this;
          state.totalMintedConverted = AmountMath.add(
            state.totalMintedConverted,
            converted,
          );
          facets.helper.publishMetrics();
        },
        onSendFunds(provided) {
          const { state, facets } = this;
          state.totalMintedProvided = AmountMath.add(
            state.totalMintedProvided,
            provided,
          );
          facets.helper.publishMetrics();
        },
        onProvisioned() {
          const { state, facets } = this;
          state.walletsProvisioned += 1n;
          facets.helper.publishMetrics();
        },
        /** @param {ERef<Bank>} destBank */
        async sendInitialPayment(destBank) {
          const {
            facets: { helper },
            state: { fundPurse, poolBrand },
          } = this;
          const perAccountInitialAmount = /** @type {Amount<'nat'>} */ (
            params.getPerAccountInitialAmount()
          );
          const initialPmt = await E(fundPurse).withdraw(
            perAccountInitialAmount,
          );

          const destPurse = E(destBank).getPurse(poolBrand);
          return E(destPurse)
            .deposit(initialPmt)
            .then(amt => {
              helper.onSendFunds(perAccountInitialAmount);
              console.log('provisionPool sent', amt);
            })
            .catch(reason => {
              console.error(X`initial deposit failed: ${q(reason)}`);
              void E(fundPurse).deposit(initialPmt);
              throw reason;
            });
        },
        /**
         * @param {object} [options]
         * @param {MetricsNotification} [options.metrics]
         */
        start({ metrics } = {}) {
          const {
            state: { brandToPSM, poolBrand },
            facets: { helper },
          } = this;

          // Must match. poolBrand is from durable state and the param is from
          // the contract, so it technically can change between incarnations.
          // That would be a severe bug.
          AmountMath.coerce(poolBrand, params.getPerAccountInitialAmount());

          void observeIteration(
            subscribeEach(E(poolBank).getAssetSubscription()),
            {
              updateState: async desc => {
                console.log('provisionPool notified of new asset', desc.brand);
                await zcf.saveIssuer(desc.issuer, desc.issuerName);
                /** @type {ERef<Purse>} */
                // @ts-expect-error vbank purse is close enough for our use.
                const exchangePurse = E(poolBank).getPurse(desc.brand);
                void observeNotifier(
                  E(exchangePurse).getCurrentAmountNotifier(),
                  {
                    updateState: async amount => {
                      console.log('provisionPool balance update', amount);
                      if (
                        AmountMath.isEmpty(amount) ||
                        amount.brand === poolBrand
                      ) {
                        return;
                      }
                      if (!brandToPSM.has(desc.brand)) {
                        console.error(
                          'funds arrived but no PSM instance',
                          desc.brand,
                        );
                        return;
                      }
                      const instance = brandToPSM.get(desc.brand);
                      const payment = E(exchangePurse).withdraw(amount);
                      await helper
                        .swap(payment, amount, instance)
                        .catch(async reason => {
                          console.error(X`swap failed: ${reason}`);
                          const resolvedPayment = await payment;
                          return E(exchangePurse).deposit(resolvedPayment);
                        });
                    },
                    fail: reason => console.error(reason),
                  },
                );
              },
            },
          );

          if (metrics) {
            // Restore state.
            // we publishMetrics() below
            const {
              walletsProvisioned,
              totalMintedProvided,
              totalMintedConverted,
            } = metrics;
            assert.typeof(walletsProvisioned, 'bigint');
            AmountMath.coerce(poolBrand, totalMintedProvided);
            AmountMath.coerce(poolBrand, totalMintedConverted);
            Object.assign(this.state, {
              walletsProvisioned,
              totalMintedProvided,
              totalMintedConverted,
            });
            helper.publishMetrics();
          }
        },
        /**
         * @param {ERef<Payment>} payIn
         * @param {Amount} amount
         * @param {PsmInstance} instance
         */
        async swap(payIn, amount, instance) {
          const {
            facets: { helper },
            state: { fundPurse },
          } = this;
          const psmPub = E(zoe).getPublicFacet(instance);
          const proposal = harden({ give: { In: amount } });
          const invitation = E(psmPub).makeWantMintedInvitation();
          const seat = E(zoe).offer(invitation, proposal, { In: payIn });
          const payout = await E(seat).getPayout('Out');
          const rxd = await E(fundPurse).deposit(payout);
          helper.onTrade(rxd);
          return rxd;
        },
      },
      public: {
        getPublicTopics() {
          return {
            metrics: makeRecorderTopic(
              'Provision Pool metrics',
              this.state.metricsRecorderKit,
            ),
          };
        },
      },
    },
    {
      finish: ({ facets }) => {
        facets.helper.publishMetrics();
      },
    },
  );

  /**
   * Prepare synchronous values before passing to real Exo maker
   *
   * @param {object} opts
   * @param {Brand} opts.poolBrand
   * @param {ERef<StorageNode>} opts.storageNode
   */
  const makeProvisionPoolKit = async ({ poolBrand, storageNode }) => {
    /** @type {Purse<'nat'>} */
    // @ts-expect-error vbank purse is close enough for our use.
    const fundPurse = await E(poolBank).getPurse(poolBrand);
    const metricsNode = await E(storageNode).makeChildNode('metrics');

    return makeProvisionPoolKitInternal({
      fundPurse,
      poolBrand,
      metricsNode,
    });
  };

  return makeProvisionPoolKit;
};
