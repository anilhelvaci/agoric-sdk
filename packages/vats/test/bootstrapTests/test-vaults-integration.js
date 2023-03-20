// @ts-check
/**
 * @file Bootstrap test integration vaults with smart-wallet
 */
import { test as anyTest } from '@agoric/zoe/tools/prepare-test-env-ava.js';

import { Fail } from '@agoric/assert';
import { Offers } from '@agoric/inter-protocol/src/clientSupport.js';
import { E } from '@endo/captp';
import { makeAgoricNamesRemotesFromFakeStorage } from '../../tools/board-utils.js';
import { makeSwingsetTestKit, makeWalletFactoryDriver } from './supports.js';

/**
 * @type {import('ava').TestFn<Awaited<ReturnType<typeof makeDefaultTestContext>>>}
 */
const test = anyTest;

// presently all these tests use one collateral manager
const collateralBrandKey = 'IbcATOM';

const likePayouts = (collateral, minted) => ({
  Collateral: {
    value: {
      digits: String(collateral * 1_000_000),
    },
  },
  Minted: {
    value: {
      digits: String(minted * 1_000_000),
    },
  },
});

/**
 * TODO BUG: Everywhere this is used, we should use `Infinity` instead. However,
 * the fact that this matches the current value shows that something is exposing
 * the marshal-encoded form rather than the number it encodes. Further,
 * it is the marshal-encoded form from the deprecated qclass encoding
 * rather than smallcaps.
 */
const ShouldBeInfinity = harden({
  '@qclass': 'Infinity',
});

const makeDefaultTestContext = async t => {
  console.time('DefaultTestContext');
  const swingsetTestKit = await makeSwingsetTestKit(t);

  const { runUtils, storage } = swingsetTestKit;
  console.timeLog('DefaultTestContext', 'swingsetTestKit');
  const { EV } = runUtils;

  // Wait for IbcATOM to make it into agoricNames
  await EV.vat('bootstrap').consumeItem('vaultFactoryKit');
  console.timeLog('DefaultTestContext', 'vaultFactoryKit');

  // has to be late enough for agoricNames data to have been published
  const agoricNamesRemotes = makeAgoricNamesRemotesFromFakeStorage(
    swingsetTestKit.storage,
  );
  agoricNamesRemotes.brand.IbcATOM || Fail`IbcATOM missing from agoricNames`;
  console.timeLog('DefaultTestContext', 'agoricNamesRemotes');

  const walletFactoryDriver = await makeWalletFactoryDriver(
    runUtils,
    storage,
    agoricNamesRemotes,
  );
  console.timeLog('DefaultTestContext', 'walletFactoryDriver');

  console.timeEnd('DefaultTestContext');

  return { ...swingsetTestKit, agoricNamesRemotes, walletFactoryDriver };
};

test.before(async t => {
  t.context = await makeDefaultTestContext(t);
});
test.after(async t => {
  // not strictly necessary but conveys that we keep the controller around for the whole test file
  await E(t.context.controller).shutdown();
});

test('metrics path', async t => {
  const { EV } = t.context.runUtils;
  // example of awaitVatObject
  const vaultFactoryKit = await EV.vat('bootstrap').consumeItem(
    'vaultFactoryKit',
  );
  const vfTopics = await EV(vaultFactoryKit.publicFacet).getPublicTopics();
  const vfMetricsPath = await EV.get(vfTopics.metrics).storagePath;
  t.is(vfMetricsPath, 'published.vaultFactory.metrics');
});

test('open vault', async t => {
  console.time('open vault');
  const { walletFactoryDriver } = t.context;

  const wd = await walletFactoryDriver.provideSmartWallet('agoric1open');

  await wd.executeOfferMaker(Offers.vaults.OpenVault, {
    offerId: 'open-vault',
    collateralBrandKey,
    wantMinted: 5.0,
    giveCollateral: 9.0,
  });
  console.timeLog('open vault', 'executed offer');

  t.like(wd.getLatestUpdateRecord(), {
    updated: 'offerStatus',
    status: { id: 'open-vault', numWantsSatisfied: 1 },
  });
  console.timeEnd('open vault');
});

test('adjust balances', async t => {
  const { walletFactoryDriver } = t.context;

  const wd = await walletFactoryDriver.provideSmartWallet('agoric1adjust');

  await wd.executeOfferMaker(Offers.vaults.OpenVault, {
    offerId: 'adjust-open',
    collateralBrandKey,
    wantMinted: 5.0,
    giveCollateral: 9.0,
  });
  console.log('adjust-open status', wd.getLatestUpdateRecord());
  t.like(wd.getLatestUpdateRecord(), {
    updated: 'offerStatus',
    status: { id: 'adjust-open', numWantsSatisfied: 1 },
  });

  t.log('adjust');
  await wd.executeOfferMaker(
    Offers.vaults.AdjustBalances,
    {
      offerId: 'adjust',
      collateralBrandKey,
      giveMinted: 0.0005,
    },
    'adjust-open',
  );
  t.like(wd.getLatestUpdateRecord(), {
    updated: 'offerStatus',
    status: {
      id: 'adjust',
      numWantsSatisfied: ShouldBeInfinity,
    },
  });
});

test('close vault', async t => {
  const { walletFactoryDriver } = t.context;

  const wd = await walletFactoryDriver.provideSmartWallet('agoric1toclose');

  const giveCollateral = 9.0;

  await wd.executeOfferMaker(Offers.vaults.OpenVault, {
    offerId: 'open-vault',
    collateralBrandKey,
    wantMinted: 5.0,
    giveCollateral,
  });
  t.like(wd.getLatestUpdateRecord(), {
    updated: 'offerStatus',
    status: { id: 'open-vault', numWantsSatisfied: 1 },
  });
  t.log('try giving more than is available in the purse/vbank');
  await t.throwsAsync(
    wd.executeOfferMaker(
      Offers.vaults.CloseVault,
      {
        offerId: 'close-extreme',
        collateralBrandKey,
        giveMinted: 99_999_999.999_999,
      },
      'open-vault',
    ),
    {
      message: /^Withdrawal .* failed because the purse only contained .*/,
    },
  );

  const message =
    'Offer {"brand":"[Alleged: IST brand]","value":"[1n]"} is not sufficient to pay off debt {"brand":"[Alleged: IST brand]","value":"[5025000n]"}';
  await t.throwsAsync(
    wd.executeOfferMaker(
      Offers.vaults.CloseVault,
      {
        offerId: 'close-insufficient',
        collateralBrandKey,
        giveMinted: 0.000_001,
      },
      'open-vault',
    ),
    {
      message,
    },
  );
  t.like(wd.getLatestUpdateRecord(), {
    updated: 'offerStatus',
    status: {
      id: 'close-insufficient',
      // XXX there were no wants. Zoe treats as Infinitely satisfied
      numWantsSatisfied: ShouldBeInfinity,
      error: `Error: ${message}`,
    },
  });

  t.log('close correctly');
  await wd.executeOfferMaker(
    Offers.vaults.CloseVault,
    {
      offerId: 'close-well',
      collateralBrandKey,
      giveMinted: 5.025,
    },
    'open-vault',
  );
  t.like(wd.getLatestUpdateRecord(), {
    updated: 'offerStatus',
    status: {
      id: 'close-well',
      result: 'your loan is closed, thank you for your business',
      // funds are returned
      payouts: likePayouts(giveCollateral, 0),
      numWantsSatisfied: ShouldBeInfinity,
    },
  });
});

test('open vault with insufficient funds gives helpful error', async t => {
  const { walletFactoryDriver } = t.context;

  const wd = await walletFactoryDriver.provideSmartWallet(
    'agoric1insufficient',
  );

  const giveCollateral = 9.0;
  const wantMinted = giveCollateral * 100;
  const message =
    'Proposed debt {"brand":"[Alleged: IST brand]","value":"[904500000n]"} exceeds max {"brand":"[Alleged: IST brand]","value":"[63462857n]"} for {"brand":"[Alleged: IbcATOM brand]","value":"[9000000n]"} collateral';
  await t.throwsAsync(
    wd.executeOfferMaker(Offers.vaults.OpenVault, {
      offerId: 'open-vault',
      collateralBrandKey,
      giveCollateral,
      wantMinted,
    }),
    { message },
  );

  t.like(wd.getLatestUpdateRecord(), {
    updated: 'offerStatus',
    status: {
      id: 'open-vault',
      numWantsSatisfied: 0,
      error: `Error: ${message}`,
      // funds are returned
      payouts: likePayouts(giveCollateral, 0),
    },
  });
});
