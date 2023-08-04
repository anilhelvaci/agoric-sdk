/**
 * @file Proposal Builder: Upgrade walletFactory
 *
 * Usage:
 *   agoric run wfup.js
 */

import { makeHelpers } from '@agoric/deploy-script-support';
import { getManifestForUpgrade } from '../src/proposals/upgrade-walletFactory-proposal.js';

/** @type {import('@agoric/deploy-script-support/src/externalTypes.js').ProposalBuilder} */
export const defaultProposalBuilder = async ({ publishRef, install }) => {
  return harden({
    sourceSpec: '../src/proposals/upgrade-walletFactory-proposal.js',
    getManifestCall: [
      getManifestForUpgrade.name,
      {
        walletFactoryRef: publishRef(
          install(
            '../src/walletFactory.js',
            '../bundles/bundle-walletFactory.js',
            { persist: true },
          ),
        ),
      },
    ],
  });
};

/** @type {DeployScriptFunction} */
export default async (homeP, endowments) => {
  const { writeCoreProposal } = await makeHelpers(homeP, endowments);
  await writeCoreProposal('upgrade-walletFactory', defaultProposalBuilder);
};
