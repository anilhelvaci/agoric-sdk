// @ts-check

import { Fail, NonNullish } from '@agoric/assert';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';
import { CONTRACT_ELECTORATE, ParamTypes } from '@agoric/governance';
import { deeplyFulfilledObject, makeTracer } from '@agoric/internal';
import { makeFakeStorageKit } from '@agoric/internal/src/storage-test-utils.js';
import { makeNotifierFromSubscriber } from '@agoric/notifier';
import { makeNameHubKit } from '@agoric/vats';
import { makeBoard } from '@agoric/vats/src/lib-board.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { E } from '@endo/eventual-send';
import { Far } from '@endo/marshal';
import { makePromiseKit } from '@endo/promise-kit';

const trace = makeTracer('BootVFUpg');

export const vfV1BundleName = 'vaultFactoryV1';

const inKit = makeIssuerKit('bucks');
const collateralKit = makeIssuerKit('moola');

export const buildRootObject = async () => {
  const storageKit = makeFakeStorageKit('vaultFactoryUpgradeTest');
  const { nameAdmin: namesByAddressAdmin } = makeNameHubKit();
  const timer = buildManualTimer();
  const marshaller = makeBoard().getReadonlyMarshaller();

  /** @type {ZoeService} */
  let zoeService;
  /** @type {FeeMintAccess} */
  let feeMintAccess;

  /** @type {PromiseKit<ZoeService>} */
  const { promise: zoe, ...zoePK } = makePromiseKit();
  const { promise: committeeCreator, ...ccPK } = makePromiseKit();

  /** @type {VatAdminSvc} */
  let vatAdmin;

  let initialPoserInvitation;
  let poserInvitationAmount;

  // for startInstance
  /**
   * @type {{
   * committee?: Installation<import('@agoric/governance/src/committee').start>,
   * vaultFactoryV1?: Installation<import('../../../src/vaultFactory/vaultFactory').prepare>,
   * puppetContractGovernor?: Installation<import('@agoric/governance/tools/puppetContractGovernor').start>,
   * }}
   */
  const installations = {};

  /** @type {import('@agoric/governance/tools/puppetContractGovernor').PuppetContractGovernorKit<import('../../../src/vaultFactory/vaultFactory.js').prepare>} */
  let governorFacets;
  /** @type {ReturnType<Awaited<ReturnType<import('../../../src/vaultFactory/vaultFactory.js').prepare>>['creatorFacet']['getLimitedCreatorFacet']>} */
  let vfLimitedFacet;

  /** @type {Omit<import('@agoric/zoe/src/zoeService/utils.js').StartParams<import('../../../src/vaultFactory/vaultFactory.js').prepare>['terms'], 'issuers' | 'brands'>} */
  const vfTerms = {
    timer,

    governedParams: {
      // @ts-expect-error missing value
      [CONTRACT_ELECTORATE]: {
        type: ParamTypes.INVITATION,
      },
    },
  };
  const staticPrivateArgs = {
    storageNode: storageKit.rootNode,
    marshaller,
    namesByAddressAdmin,
  };

  return Far('root', {
    bootstrap: async (vats, devices) => {
      vatAdmin = await E(vats.vatAdmin).createVatAdminService(devices.vatAdmin);
      ({ feeMintAccess, zoeService } = await E(vats.zoe).buildZoe(
        vatAdmin,
        undefined,
        'zcf',
      ));
      zoePK.resolve(zoeService);

      const v1BundleId = await E(vatAdmin).getBundleIDByName(vfV1BundleName);
      v1BundleId || Fail`bundleId must not be empty`;
      installations.vaultFactoryV1 = await E(zoe).installBundleID(v1BundleId);

      installations.puppetContractGovernor = await E(zoe).installBundleID(
        await E(vatAdmin).getBundleIDByName('puppetContractGovernor'),
      );

      installations.committee = await E(zoe).installBundleID(
        await E(vatAdmin).getBundleIDByName('committee'),
      );
      const ccStartResult = await E(zoe).startInstance(
        installations.committee,
        harden({}),
        {
          committeeName: 'Demos',
          committeeSize: 1,
        },
        {
          storageNode: storageKit.rootNode.makeChildNode('thisCommittee'),
          marshaller,
        },
      );
      ccPK.resolve(ccStartResult.creatorFacet);

      const poserInvitationP = E(committeeCreator).getPoserInvitation();
      [initialPoserInvitation, poserInvitationAmount] = await Promise.all([
        poserInvitationP,
        E(E(zoe).getInvitationIssuer()).getAmountOf(poserInvitationP),
      ]);

      vfTerms.governedParams[CONTRACT_ELECTORATE].value = poserInvitationAmount;
    },

    buildV1: async () => {
      trace(`BOOT buildV1 start`);
      // build the contract vat from ZCF and the contract bundlecap

      const governorTerms = await deeplyFulfilledObject(
        harden({
          timer,
          governedContractInstallation: NonNullish(
            installations.vaultFactoryV1,
          ),
          governed: {
            terms: vfTerms,
            label: 'vaultFactoryV1',
          },
        }),
      );
      trace('got governorTerms', governorTerms);

      // Complete round-trip without upgrade
      trace(`BOOT buildV1 startInstance`);
      // @ts-expect-error
      governorFacets = await E(zoe).startInstance(
        NonNullish(installations.puppetContractGovernor),
        undefined,
        governorTerms,
        {
          governed: {
            ...staticPrivateArgs,
            feeMintAccess,
            initialPoserInvitation,
            // XXX at least it's an invitation
            initialShortfallInvitation: initialPoserInvitation,
          },
        },
      );
      trace('BOOT buildV1 started instance');

      // @ts-expect-error XXX governance types https://github.com/Agoric/agoric-sdk/issues/7178
      vfLimitedFacet = await E(governorFacets.creatorFacet).getCreatorFacet();

      await E(vfLimitedFacet).addVaultType(collateralKit.issuer, 'Moola', {});

      trace('BOOT buildV1 made a Moola manager');

      return true;
    },

    testFunctionality1: async () => {
      const faPublicFacet = await E(
        governorFacets.creatorFacet,
      ).getPublicFacet();

      const publicTopics = await E(faPublicFacet).getPublicTopics();
      assert.equal(publicTopics.metrics.description, 'Vault Factory metrics');
    },

    nullUpgradeV1: async () => {
      trace(`BOOT nullUpgradeV1 start`);

      const bundleId = await E(vatAdmin).getBundleIDByName(vfV1BundleName);

      trace(`BOOT nullUpgradeV1 upgradeContract`);
      const faAdminFacet = await E(governorFacets.creatorFacet).getAdminFacet();
      const upgradeResult = await E(faAdminFacet).upgradeContract(bundleId, {
        ...staticPrivateArgs,
        feeMintAccess,
        initialPoserInvitation,
      });
      assert.equal(upgradeResult.incarnationNumber, 2);
      trace(`BOOT nullUpgradeV1 upgradeContract completed`);

      await timer.tickN(1);
      return true;
    },

    testFunctionality2: async () => {
      const faPublicFacet = await E(
        governorFacets.creatorFacet,
      ).getPublicFacet();
    },

    // this test doesn't upgrade to a new bundle because we have coverage elsewhere that
    // a new bundle will replace the behavior of the prior bundle
  });
};
