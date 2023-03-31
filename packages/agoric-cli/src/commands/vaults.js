/* eslint-disable no-await-in-loop */
/* eslint-disable @jessie.js/no-nested-await */
// @ts-check
/* eslint-disable func-names */
/* global fetch, process */
import { Command } from 'commander';
import {
  lookupOfferIdForVault,
  Offers,
} from '@agoric/inter-protocol/src/clientSupport.js';
import { normalizeAddressWithOptions } from '../lib/chain.js';
import { makeRpcUtils } from '../lib/rpc.js';
import { getCurrent, outputExecuteOfferAction } from '../lib/wallet.js';

/**
 *
 * @param {import('anylogger').Logger} logger
 */
export const makeVaultsCommand = async logger => {
  const vaults = new Command('vaults')
    .description('Vault Factory commands')
    .option('--home [dir]', 'agd application home directory')
    .option(
      '--keyring-backend [os|file|test]',
      'keyring\'s backend (os|file|test) (default "os")',
    );

  const normalizeAddress = literalOrName =>
    normalizeAddressWithOptions(literalOrName, vaults.opts());

  const rpcTools = async () => {
    const { vstorage, fromBoard, agoricNames, readLatestHead } =
      await makeRpcUtils({ fetch });

    return { vstorage, fromBoard, agoricNames, readLatestHead };
  };

  vaults
    .command('list')
    .description(
      'list vaults ever owned by the address (as path that can be followed)',
    )
    .requiredOption(
      '--from <address>',
      'wallet address literal or name',
      normalizeAddress,
    )
    .action(async function (opts) {
      const { readLatestHead } = await rpcTools();

      const current = await getCurrent(opts.from, {
        readLatestHead,
      });

      const vaultStoragePaths = current.offerToPublicSubscriberPaths.map(
        ([_offerId, pathmap]) => pathmap.vault,
      );

      for (const path of vaultStoragePaths) {
        process.stdout.write(path);
        process.stdout.write('\n');
      }
    });

  vaults
    .command('open')
    .description('open a new vault')
    .requiredOption('--giveCollateral [number]', 'Collateral to give', Number)
    .requiredOption('--wantMinted [number]', 'Minted wants', Number)
    .option('--offerId [number]', 'Offer id', Number, Date.now())
    .option('--collateralBrand [string]', 'Collateral brand key', 'IbcATOM')
    .action(async function (opts) {
      logger.warn('running with options', opts);
      const { agoricNames } = await rpcTools();

      const offer = Offers.vaults.OpenVault(agoricNames.brand, {
        giveCollateral: opts.giveCollateral,
        wantMinted: opts.wantMinted,
        offerId: opts.offerId,
        // rename to allow CLI to be more concise
        collateralBrandKey: opts.collateralBrand,
      });

      outputExecuteOfferAction(offer);
    });

  vaults
    .command('adjust')
    .description('adjust an existing vault')
    .requiredOption(
      '--from <address>',
      'wallet address literal or name',
      normalizeAddress,
    )
    .option('--giveCollateral [number]', 'More collateral to lend', Number)
    .option('--wantCollateral [number]', 'Collateral to get back', Number)
    .option('--giveMinted [number]', 'Minted to give back', Number)
    .option('--wantMinted [number]', 'More minted to borrow', Number)
    .option('--offerId [number]', 'Offer id', Number, Date.now())
    .option('--collateralBrand [string]', 'Collateral brand key', 'IbcATOM')
    .requiredOption('--vaultId [string]', 'Key of vault (e.g. vault1)')
    .action(async function (opts) {
      logger.warn('running with options', opts);
      const { agoricNames, fromBoard, vstorage } = await rpcTools();

      const previousOfferId = await lookupOfferIdForVault(
        opts.vaultId,
        getCurrent(opts.from, { readLatestHead }),
      );

      const offer = Offers.vaults.AdjustBalances(
        agoricNames.brand,
        {
          giveCollateral: opts.giveCollateral,
          wantCollateral: opts.wantCollateral,
          giveMinted: opts.giveMinted,
          wantMinted: opts.wantMinted,
          offerId: opts.offerId,
          // rename to allow CLI to be more concise
          collateralBrandKey: opts.collateralBrand,
        },
        previousOfferId,
      );
      outputExecuteOfferAction(offer);
    });

  vaults
    .command('close')
    .description('close an existing vault')
    .requiredOption(
      '--from <address>',
      'wallet address literal or name',
      normalizeAddress,
    )
    .requiredOption('--giveMinted [number]', 'Minted to give back', Number)
    .option('--offerId [number]', 'Offer id', Number, Date.now())
    .requiredOption('--vaultId [string]', 'Key of vault (e.g. vault1)')
    .action(async function (opts) {
      logger.warn('running with options', opts);
      const { agoricNames, fromBoard, vstorage } = await rpcTools();

      const previousOfferId = await lookupOfferIdForVault(
        opts.vaultId,
        getCurrent(opts.from, { readLatestHead }),
      );

      const offer = Offers.vaults.CloseVault(
        agoricNames.brand,
        {
          giveMinted: opts.giveMinted,
          offerId: opts.offerId,
        },
        previousOfferId,
      );
      outputExecuteOfferAction(offer);
    });

  return vaults;
};
