import '@agoric/governance/exported.js';
import '@agoric/zoe/exported.js';
import '@agoric/zoe/src/contracts/exported.js';

import { AmountMath, AmountShape, BrandShape, RatioShape } from '@agoric/ertp';
import {
  CONTRACT_ELECTORATE,
  handleParamGovernance,
  ParamTypes,
  publicMixinAPI,
} from '@agoric/governance';
import { M, prepareExo, provide } from '@agoric/vat-data';
import {
  atomicRearrange,
  ceilMultiplyBy,
  floorDivideBy,
  floorMultiplyBy,
} from '@agoric/zoe/src/contractSupport/index.js';
import { E } from '@endo/eventual-send';

import { StorageNodeShape } from '@agoric/internal';
import {
  AmountKeywordRecordShape,
  InvitationShape,
} from '@agoric/zoe/src/typeGuards.js';
import { makeCollectFeesInvitation } from '../collectFees.js';
import { makeMetricsPublishKit } from '../contractSupport.js';

const { Fail } = assert;

/**
 * @file The Parity Stability Module supports efficiently minting/burning a
 * stable token at a specified fixed ratio to a reference stable token, which
 * thereby acts as an anchor to provide additional stability. For flexible
 * economic policies, the fee percentage for trading into and out of the stable
 * token are specified separately.
 */

/**
 * @typedef {object} MetricsNotification
 * Metrics naming scheme is that nouns are present values and past-participles
 * are accumulative.
 *
 * @property {Amount<'nat'>} anchorPoolBalance  amount of Anchor token
 * available to be swapped
 * @property {Amount<'nat'>} mintedPoolBalance  amount of Minted token
 * outstanding (the amount minted minus the amount burned).
 * @property {Amount<'nat'>} feePoolBalance     amount of Minted token
 * fees available to be collected
 *
 * @property {Amount<'nat'>} totalAnchorProvided  running sum of Anchor
 * ever given by this contract
 * @property {Amount<'nat'>} totalMintedProvided  running sum of Minted
 * ever given by this contract
 */

/** @typedef {import('@agoric/vat-data').Baggage} Baggage */

export const customTermsShape = {
  anchorBrand: BrandShape,
  anchorPerMinted: RatioShape,
  governedParams: {
    [CONTRACT_ELECTORATE]: {
      type: ParamTypes.INVITATION,
      value: AmountShape,
    },
    WantMintedFee: {
      type: ParamTypes.RATIO,
      value: RatioShape,
    },
    GiveMintedFee: {
      type: ParamTypes.RATIO,
      value: RatioShape,
    },
    MintLimit: { type: ParamTypes.AMOUNT, value: AmountShape },
  },
};
harden(customTermsShape);

export const privateArgsShape = {
  feeMintAccess: M.any(),
  initialPoserInvitation: InvitationShape,
  storageNode: StorageNodeShape,
  marshaller: M.any(),
};
harden(privateArgsShape);

/**
 * @param {ZCF<GovernanceTerms<{
 *    GiveMintedFee: 'ratio',
 *    WantMintedFee: 'ratio',
 *    MintLimit: 'amount',
 *   }> & {
 *    anchorBrand: Brand<'nat'>,
 *    anchorPerMinted: Ratio,
 * }>} zcf
 * @param {{feeMintAccess: FeeMintAccess, initialPoserInvitation: Invitation, storageNode: StorageNode, marshaller: Marshaller}} privateArgs
 * @param {Baggage} baggage
 */
export const prepare = async (zcf, privateArgs, baggage) => {
  const { anchorBrand, anchorPerMinted } = zcf.getTerms();
  console.log('PSM Starting', anchorBrand, anchorPerMinted);

  const stableMint = await zcf.registerFeeMint(
    'Minted',
    privateArgs.feeMintAccess,
  );
  const { brand: stableBrand } = stableMint.getIssuerRecord();
  (anchorPerMinted.numerator.brand === anchorBrand &&
    anchorPerMinted.denominator.brand === stableBrand) ||
    Fail`Ratio ${anchorPerMinted} is not consistent with brands ${anchorBrand} and ${stableBrand}`;

  zcf.setTestJig(() => ({
    stableIssuerRecord: stableMint.getIssuerRecord(),
  }));
  const emptyStable = AmountMath.makeEmpty(stableBrand);
  const emptyAnchor = AmountMath.makeEmpty(anchorBrand);

  const { publicMixin, makeDurableGovernorFacet, params } =
    await handleParamGovernance(
      zcf,
      privateArgs.initialPoserInvitation,
      {
        GiveMintedFee: ParamTypes.RATIO,
        MintLimit: ParamTypes.AMOUNT,
        WantMintedFee: ParamTypes.RATIO,
      },
      privateArgs.storageNode,
      privateArgs.marshaller,
    );

  const provideEmptyZcfSeat = name => {
    return provide(baggage, name, () => zcf.makeEmptySeatKit().zcfSeat);
  };

  const anchorPool = provideEmptyZcfSeat('anchorPoolSeat');
  const feePool = provideEmptyZcfSeat('feePoolSeat');
  const stage = provideEmptyZcfSeat('stageSeat');

  let mintedPoolBalance = provide(baggage, 'mintedPoolBalance', () =>
    AmountMath.makeEmpty(stableBrand),
  );

  let totalAnchorProvided = provide(baggage, 'totalAnchorProvided', () =>
    AmountMath.makeEmpty(anchorBrand),
  );
  let totalMintedProvided = provide(baggage, 'totalMintedProvided', () =>
    AmountMath.makeEmpty(stableBrand),
  );

  /** @type {import('../contractSupport.js').MetricsPublishKit<MetricsNotification>} */
  const { metricsPublisher, metricsSubscriber } = makeMetricsPublishKit(
    privateArgs.storageNode,
    privateArgs.marshaller,
  );
  const updateMetrics = () => {
    metricsPublisher.publish(
      harden({
        anchorPoolBalance: anchorPool.getAmountAllocated('Anchor', anchorBrand),
        feePoolBalance: feePool.getAmountAllocated('Minted', stableBrand),
        mintedPoolBalance,
        totalAnchorProvided,
        totalMintedProvided,
      }),
    );
  };
  updateMetrics();

  /**
   * @param {Amount<'nat'>} toMint
   */
  const assertUnderLimit = toMint => {
    const mintedAfter = AmountMath.add(mintedPoolBalance, toMint);
    AmountMath.isGTE(params.getMintLimit(), mintedAfter) ||
      Fail`Request would exceed mint limit`;
  };

  const burnMinted = toBurn => {
    stableMint.burnLosses({ Minted: toBurn }, stage);
    mintedPoolBalance = AmountMath.subtract(mintedPoolBalance, toBurn);
  };

  const mintMinted = toMint => {
    stableMint.mintGains({ Minted: toMint }, stage);
    mintedPoolBalance = AmountMath.add(mintedPoolBalance, toMint);
  };

  /**
   * @param {ZCFSeat} seat
   * @param {Amount<'nat'>} given
   * @param {Amount<'nat'>} [wanted] defaults to maximum anchor (given exchange rate minus fees)
   */
  const giveMinted = (seat, given, wanted = emptyAnchor) => {
    const fee = ceilMultiplyBy(given, params.getGiveMintedFee());
    const afterFee = AmountMath.subtract(given, fee);
    const maxAnchor = floorMultiplyBy(afterFee, anchorPerMinted);
    AmountMath.isGTE(maxAnchor, wanted) ||
      Fail`wanted ${wanted} is more than ${given} minus fees ${fee}`;
    atomicRearrange(
      zcf,
      harden([
        [seat, stage, { In: afterFee }, { Minted: afterFee }],
        [seat, feePool, { In: fee }, { Minted: fee }],
        [anchorPool, seat, { Anchor: maxAnchor }, { Out: maxAnchor }],
      ]),
    );
    // The treatment of `burnMinted` here is different than the
    // one immediately below. This `burnMinted`
    // happen only if the `atomicRearrange` does *not* throw.
    burnMinted(afterFee);
    totalAnchorProvided = AmountMath.add(totalAnchorProvided, maxAnchor);
  };

  /**
   * @param {ZCFSeat} seat
   * @param {Amount<'nat'>} given
   * @param {Amount<'nat'>} [wanted]
   */
  const wantMinted = (seat, given, wanted = emptyStable) => {
    const asStable = floorDivideBy(given, anchorPerMinted);
    assertUnderLimit(asStable);
    const fee = ceilMultiplyBy(asStable, params.getWantMintedFee());
    const afterFee = AmountMath.subtract(asStable, fee);
    AmountMath.isGTE(afterFee, wanted) ||
      Fail`wanted ${wanted} is more than ${given} minus fees ${fee}`;
    mintMinted(asStable);
    try {
      atomicRearrange(
        zcf,
        harden([
          [seat, anchorPool, { In: given }, { Anchor: given }],
          [stage, seat, { Minted: afterFee }, { Out: afterFee }],
          [stage, feePool, { Minted: fee }],
        ]),
      );
    } catch (e) {
      // The treatment of `burnMinted` here is different than the
      // one immediately above. This `burnMinted`
      // happens only if the `atomicRearrange` *does* throw.
      burnMinted(asStable);
      throw e;
    }
    totalMintedProvided = AmountMath.add(totalMintedProvided, asStable);
  };

  /** @param {ZCFSeat} seat */
  const giveMintedHook = seat => {
    const {
      give: { In: given },
      want: { Out: wanted } = { Out: undefined },
    } = seat.getProposal();
    giveMinted(seat, given, wanted);
    seat.exit();
    updateMetrics();
  };

  /** @param {ZCFSeat} seat */
  const wantMintedHook = seat => {
    const {
      give: { In: given },
      want: { Out: wanted } = { Out: undefined },
    } = seat.getProposal();
    wantMinted(seat, given, wanted);
    seat.exit();
    updateMetrics();
  };

  const [anchorAmountShape, stableAmountShape] = await Promise.all([
    E(anchorBrand).getAmountShape(),
    E(stableBrand).getAmountShape(),
  ]);

  const publicFacet = prepareExo(
    baggage,
    'Parity Stability Module',
    M.interface('PSM', {
      getMetrics: M.call().returns(M.remotable('MetricsSubscriber')),
      getPoolBalance: M.call().returns(anchorAmountShape),
      makeWantMintedInvitation: M.call().returns(M.promise()),
      makeGiveMintedInvitation: M.call().returns(M.promise()),
      ...publicMixinAPI,
    }),
    {
      getMetrics() {
        return metricsSubscriber;
      },
      getPoolBalance() {
        return anchorPool.getAmountAllocated('Anchor', anchorBrand);
      },
      makeWantMintedInvitation() {
        return zcf.makeInvitation(
          wantMintedHook,
          'wantMinted',
          undefined,
          M.splitRecord({
            give: { In: anchorAmountShape },
            want: M.or({ Out: stableAmountShape }, {}),
          }),
        );
      },
      makeGiveMintedInvitation() {
        return zcf.makeInvitation(
          giveMintedHook,
          'giveMinted',
          undefined,
          M.splitRecord({
            give: { In: stableAmountShape },
            want: M.or({ Out: anchorAmountShape }, {}),
          }),
        );
      },
      ...publicMixin,
    },
  );

  const limitedCreatorFacet = prepareExo(
    baggage,
    'PSM machine',
    M.interface('PSM machine', {
      getRewardAllocation: M.call().returns(AmountKeywordRecordShape),
      makeCollectFeesInvitation: M.call().returns(InvitationShape),
    }),
    {
      getRewardAllocation() {
        return feePool.getCurrentAllocation();
      },
      makeCollectFeesInvitation() {
        return makeCollectFeesInvitation(zcf, feePool, stableBrand, 'Minted');
      },
    },
  );

  const { governorFacet } = makeDurableGovernorFacet(
    baggage,
    limitedCreatorFacet,
  );
  return harden({
    creatorFacet: governorFacet,
    publicFacet,
  });
};

/** @typedef {Awaited<ReturnType<typeof prepare>>['publicFacet']} PsmPublicFacet */
