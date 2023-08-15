/* global process */
import { makeHelpers } from '@agoric/deploy-script-support';

import { getManifestForAddAssetToVault } from '../src/proposals/addAssetToVault.js';
import { getManifestForPsm } from '../src/proposals/startPSM.js';
import { makeInstallCache } from '../src/proposals/utils.js';

/** @type {import('@agoric/deploy-script-support/src/externalTypes.js').ProposalBuilder} */
export const defaultProposalBuilder = async (
  { publishRef, install: install0, wrapInstall },
  {
    debtLimitValue = undefined,
    interestRateValue = undefined,
    interchainAssetOptions = /** @type {object} */ ({}),
  } = {},
  { env = process.env } = {},
) => {
  /** @type {import('../src/proposals/addAssetToVault.js').InterchainAssetOptions} */
  const {
    issuerBoardId = env.INTERCHAIN_ISSUER_BOARD_ID,
    denom = env.INTERCHAIN_DENOM,
    oracleBrand = 'ATOM',
    decimalPlaces = 6,
    keyword = 'ATOM',
    proposedName = oracleBrand,
    initialPrice = undefined,
  } = interchainAssetOptions;

  if (!denom) {
    assert(issuerBoardId, 'INTERCHAIN_ISSUER_BOARD_ID is required');
  }

  const install = wrapInstall ? wrapInstall(install0) : install0;

  return harden({
    sourceSpec: '../src/proposals/addAssetToVault.js',
    getManifestCall: [
      getManifestForAddAssetToVault.name,
      {
        debtLimitValue: debtLimitValue && BigInt(debtLimitValue),
        interestRateValue: interestRateValue && BigInt(interestRateValue),
        interchainAssetOptions: {
          denom,
          issuerBoardId,
          decimalPlaces,
          initialPrice,
          keyword,
          proposedName,
          oracleBrand,
        },
        scaledPriceAuthorityRef: publishRef(
          install(
            '@agoric/zoe/src/contracts/scaledPriceAuthority.js',
            '../bundles/bundle-scaledPriceAuthority.js',
            { persist: true },
          ),
        ),
      },
    ],
  });
};

/** @type {import('@agoric/deploy-script-support/src/externalTypes.js').ProposalBuilder} */
export const psmProposalBuilder = async (
  { publishRef, install: install0, wrapInstall },
  { anchorOptions = /** @type {object} */ ({}) } = {},
  { env = process.env } = {},
) => {
  const { denom = env.ANCHOR_DENOM, decimalPlaces = 6 } = anchorOptions;

  assert(denom, 'ANCHOR_DENOM is required');

  const install = wrapInstall ? wrapInstall(install0) : install0;

  return harden({
    sourceSpec: '../src/proposals/startPSM.js',
    getManifestCall: [
      getManifestForPsm.name,
      {
        anchorOptions: {
          ...anchorOptions,
          denom,
          decimalPlaces,
        },
        installKeys: {
          psm: publishRef(
            install('../src/psm/psm.js', '../bundles/bundle-psm.js'),
          ),
          mintHolder: publishRef(
            install(
              '@agoric/vats/src/mintHolder.js',
              '../../vats/bundles/bundle-mintHolder.js',
            ),
          ),
        },
      },
    ],
  });
};

export default async (homeP, endowments) => {
  const { writeCoreProposal } = await makeHelpers(homeP, endowments);

  const tool = await makeInstallCache(homeP, {
    loadBundle: spec => import(spec),
  });

  await writeCoreProposal('gov-add-collateral', defaultProposalBuilder);
  await writeCoreProposal('gov-start-psm', opts =>
    psmProposalBuilder({ ...opts, wrapInstall: tool.wrapInstall }),
  );
};
