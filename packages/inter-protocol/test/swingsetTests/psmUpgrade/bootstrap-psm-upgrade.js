// @ts-check

import { Fail, NonNullish } from '@agoric/assert';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';
import { CONTRACT_ELECTORATE, ParamTypes } from '@agoric/governance';
import { deeplyFulfilledObject, makeTracer } from '@agoric/internal';
import { makeFakeStorageKit } from '@agoric/internal/src/storage-test-utils.js';
import { makeBoard } from '@agoric/vats/src/lib-board.js';
import { makeRatio } from '@agoric/zoe/src/contractSupport/ratio.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { E } from '@endo/eventual-send';
import { Far } from '@endo/marshal';
import { makePromiseKit } from '@endo/promise-kit';
import { withAmountUtils } from '../../supports.js';

const trace = makeTracer('BootPSMUpg');

export const faV1BundleName = 'psmV1';

const anchor = withAmountUtils(makeIssuerKit('bucks'));

/** @typedef {import('../../../src/psm/psm.js').prepare} PsmSF */

export const buildRootObject = async () => {
  const storageKit = makeFakeStorageKit('psmUpgradeTest');
  const timer = buildManualTimer();
  const marshaller = makeBoard().getReadonlyMarshaller();

  const { promise: committeeCreator, ...ccPK } = makePromiseKit();

  /** @type {ZoeService} */
  let zoeService;

  /** @type {FeeMintAccess} */
  let feeMintAccess;

  let minted;

  /** @type {VatAdminSvc} */
  let vatAdmin;

  let initialPoserInvitation;
  let poserInvitationAmount;

  // for startInstance
  /**
   * @type {{
   * committee?: Installation<import('@agoric/governance/src/committee').start>,
   * psmV1?: Installation<PsmSF>,
   * puppetContractGovernor?: Installation<import('@agoric/governance/tools/puppetContractGovernor').start>,
   * }}
   */
  const installations = {};

  /** @type {import('@agoric/governance/tools/puppetContractGovernor').PuppetContractGovernorKit<PsmSF>} */
  let governorFacets;

  /** @type {Omit<import('@agoric/zoe/src/zoeService/utils.js').StartParams<PsmSF>['terms'], 'issuers' | 'brands'>} */
  const psmTerms = {
    anchorBrand: anchor.brand,

    governedParams: {
      // @ts-expect-error missing value, to be filled in
      [CONTRACT_ELECTORATE]: {
        type: ParamTypes.INVITATION,
      },
    },
  };
  const staticPrivateArgs = {
    storageNode: storageKit.rootNode,
    marshaller,
  };

  return Far('root', {
    /**
     *
     * @param {{
     * vatAdmin: ReturnType<import('@agoric/swingset-vat/src/vats/vat-admin/vat-vat-admin')['buildRootObject']>,
     * zoe: ReturnType<import('@agoric/vats/src/vat-zoe')['buildRootObject']>,
     * }} vats
     * @param {*} devices
     */
    bootstrap: async (vats, devices) => {
      vatAdmin = await E(vats.vatAdmin).createVatAdminService(devices.vatAdmin);
      ({ feeMintAccess, zoeService } = await E(vats.zoe).buildZoe(
        vatAdmin,
        undefined,
        'zcf',
      ));

      minted = { brand: await E(E(zoeService).getFeeIssuer()).getBrand() };
      psmTerms.anchorPerMinted = makeRatio(1n, anchor.brand, 1n, minted.brand);
      psmTerms.governedParams.WantMintedFee = {
        type: ParamTypes.RATIO,
        value: makeRatio(1n, minted.brand, 1n),
      };
      psmTerms.governedParams.GiveMintedFee = {
        type: ParamTypes.RATIO,
        value: makeRatio(1n, minted.brand, 1n),
      };
      psmTerms.governedParams.MintLimit = {
        type: ParamTypes.AMOUNT,
        value: AmountMath.make(minted.brand, 1_000_000n),
      };

      const v1BundleId = await E(vatAdmin).getBundleIDByName(faV1BundleName);
      v1BundleId || Fail`bundleId must not be empty`;
      installations.psmV1 = await E(zoeService).installBundleID(v1BundleId);

      installations.puppetContractGovernor = await E(
        zoeService,
      ).installBundleID(
        await E(vatAdmin).getBundleIDByName('puppetContractGovernor'),
      );

      installations.committee = await E(zoeService).installBundleID(
        await E(vatAdmin).getBundleIDByName('committee'),
      );
      const ccStartResult = await E(zoeService).startInstance(
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
        E(E(zoeService).getInvitationIssuer()).getAmountOf(poserInvitationP),
      ]);
      // fill in missing value
      psmTerms.governedParams[CONTRACT_ELECTORATE].value =
        poserInvitationAmount;
    },

    buildV1: async () => {
      trace(`BOOT buildV1 start`);
      // build the contract vat from ZCF and the contract bundlecap

      const governorTerms = await deeplyFulfilledObject(
        harden({
          timer,
          governedContractInstallation: NonNullish(installations.psmV1),
          governed: {
            terms: psmTerms,
            issuerKeywordRecord: { AUSD: anchor.issuer },
            label: 'psmV1',
          },
        }),
      );
      trace('got governorTerms', governorTerms);

      // Complete round-trip without upgrade
      trace(`BOOT buildV1 startInstance`);
      // @ts-expect-error
      governorFacets = await E(zoeService).startInstance(
        NonNullish(installations.puppetContractGovernor),
        undefined,
        governorTerms,
        {
          governed: {
            ...staticPrivateArgs,
            feeMintAccess,
            initialPoserInvitation,
          },
        },
      );
      trace('BOOT buildV1 started instance');

      return true;
    },

    testFunctionality1: async () => {
      trace('testFunctionality1');
    },

    nullUpgradeV1: async () => {
      trace(`BOOT nullUpgradeV1 start`);

      const bundleId = await E(vatAdmin).getBundleIDByName(faV1BundleName);

      trace(`BOOT nullUpgradeV1 upgradeContract`);
      const faAdminFacet = await E(governorFacets.creatorFacet).getAdminFacet();
      const upgradeResult = await E(faAdminFacet).upgradeContract(bundleId, {
        ...staticPrivateArgs,
        initialPoserInvitation,
      });
      assert.equal(upgradeResult.incarnationNumber, 2);
      trace(`BOOT nullUpgradeV1 upgradeContract completed`);

      await timer.tickN(1);
      return true;
    },

    testFunctionality2: async () => {
      trace('testFunctionality2');
    },

    // this test doesn't upgrade to a new bundle because we have coverage elsewhere that
    // a new bundle will replace the behavior of the prior bundle
  });
};
