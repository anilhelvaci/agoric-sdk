// @ts-check
/**
 * @file Bootstrap test integration vaults with smart-wallet
 */
import { test as anyTest } from '@agoric/zoe/tools/prepare-test-env-ava.js';

import { Fail } from '@agoric/assert';
import { Offers } from '@agoric/inter-protocol/src/clientSupport.js';
import { eventLoopIteration } from '@agoric/zoe/tools/eventLoopIteration.js';
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

const makeDefaultTestContext = async t => {
  console.time('DefaultTestContext');
  const swingsetTestKit = await makeSwingsetTestKit(t, 'bundles/vaults');

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
test.after.always(t => t.context.shutdown());

test('metrics path', async t => {
  const { EV } = t.context.runUtils;
  // example of awaitVatObject
  /** @type {Awaited<import('@agoric/inter-protocol/src/proposals/econ-behaviors.js').EconomyBootstrapSpace['consume']['vaultFactoryKit']>} */
  const vaultFactoryKit = await EV.vat('bootstrap').consumeItem(
    'vaultFactoryKit',
  );
  const vfTopics = await EV(vaultFactoryKit.publicFacet).getPublicTopics();
  const vfMetricsPath = await EV.get(vfTopics.metrics).storagePath;
  t.is(vfMetricsPath, 'published.vaultFactory.metrics');
});

test('null upgrade', async t => {
  const { EV } = t.context.runUtils;
  /** @type {Awaited<import('@agoric/inter-protocol/src/proposals/econ-behaviors.js').EconomyBootstrapSpace['consume']['vaultFactoryKit']>} */
  const vaultFactoryKit = await EV.vat('bootstrap').consumeItem(
    'vaultFactoryKit',
  );
  const upgradeResult = await EV(vaultFactoryKit.adminFacet).upgradeContract(
    'vaults',
    {}, // new private args
  );
  t.deepEqual(upgradeResult, { incarnationNumber: 2 });
});

test.skip('open vault', async t => {
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

test.skip('adjust balances', async t => {
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
      numWantsSatisfied: 1,
    },
  });
});

test.skip('propose change to auction governance param', async t => {
  const { walletFactoryDriver, agoricNamesRemotes, storage } = t.context;

  const gov1 = 'agoric1ldmtatp24qlllgxmrsjzcpe20fvlkp448zcuce';
  const wd = await walletFactoryDriver.provideSmartWallet(gov1);

  t.log('accept charter invitation');
  const charter = agoricNamesRemotes.instance.econCommitteeCharter;

  await wd.executeOffer({
    id: 'accept-charter-invitation',
    invitationSpec: {
      source: 'purse',
      instance: charter,
      description: 'charter member invitation',
    },
    proposal: {},
  });

  await eventLoopIteration();
  t.like(wd.getLatestUpdateRecord(), { status: { numWantsSatisfied: 1 } });

  const auctioneer = agoricNamesRemotes.instance.auctioneer;
  const timerBrand = agoricNamesRemotes.brand.timer;
  assert(timerBrand);

  t.log('propose param change');
  /* XXX @type {Partial<AuctionParams>} */
  const params = {
    StartFrequency: { timerBrand, relValue: 5n * 60n },
  };

  /** @type {import('@agoric/inter-protocol/src/econCommitteeCharter.js').ParamChangesOfferArgs} */
  const offerArgs = {
    deadline: 1000n,
    params,
    instance: auctioneer,
    path: { paramPath: { key: 'governedParams' } },
  };

  await wd.executeOffer({
    id: 'propose-param-change',
    invitationSpec: {
      source: 'continuing',
      previousOffer: 'accept-charter-invitation',
      invitationMakerName: 'VoteOnParamChange',
    },
    offerArgs,
    proposal: {},
  });

  await eventLoopIteration();
  t.like(wd.getLatestUpdateRecord(), { status: { numWantsSatisfied: 1 } });

  const key = `published.committees.Economic_Committee.latestQuestion`;
  const capData = JSON.parse(storage.data.get(key)?.at(-1));
  const lastQuestion = JSON.parse(capData.body);
  const changes = lastQuestion?.issue?.spec?.changes;
  t.log('check Economic_Committee.latestQuestion against proposal');
  t.like(changes, { StartFrequency: { relValue: { digits: '300' } } });
});
