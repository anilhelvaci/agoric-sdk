import '@agoric/zoe/exported.js';
import { test as unknownTest } from '@agoric/zoe/tools/prepare-test-env-ava.js';

import { AmountMath, makeIssuerKit } from '@agoric/ertp';
import { allValues, makeTracer, objectMap } from '@agoric/internal';
import { unsafeMakeBundleCache } from '@agoric/swingset-vat/tools/bundleTool.js';
import {
  ceilMultiplyBy,
  makeRatio,
  makeRatioFromAmounts,
} from '@agoric/zoe/src/contractSupport/index.js';
import { eventLoopIteration } from '@agoric/zoe/tools/eventLoopIteration.js';
import { buildManualTimer } from '@agoric/swingset-vat/tools/manual-timer.js';
import { E } from '@endo/eventual-send';
import { deeplyFulfilled } from '@endo/marshal';
import { TimeMath } from '@agoric/time';
import { assertPayoutAmount } from '@agoric/zoe/test/zoeTestHelpers.js';

import { SECONDS_PER_YEAR } from '../../src/interest.js';
import { startVaultFactory } from '../../src/proposals/econ-behaviors.js';
import '../../src/vaultFactory/types.js';
import {
  reserveInitialState,
  subscriptionTracker,
  vaultManagerMetricsTracker,
} from '../metrics.js';
import { setUpZoeForTest, withAmountUtils } from '../supports.js';
import {
  defaultParamValues,
  getRunFromFaucet,
  legacyOfferResult,
  setupElectorateReserveAndAuction,
} from './vaultFactoryUtils.js';

/** @typedef {Record<string, any> & {
 * aeth: IssuerKit & import('../supports.js').AmountUtils,
 * run: IssuerKit & import('../supports.js').AmountUtils,
 * bundleCache: Awaited<ReturnType<typeof unsafeMakeBundleCache>>,
 * rates: VaultManagerParamValues,
 * loanTiming: LoanTiming,
 * zoe: ZoeService,
 * }} Context */

/** @type {import('ava').TestFn<Context>} */

const test = unknownTest;

const contractRoots = {
  faucet: './test/vaultFactory/faucet.js',
  VaultFactory: './src/vaultFactory/vaultFactory.js',
  reserve: './src/reserve/assetReserve.js',
  auctioneer: './src/auction/auctioneer.js',
};

/** @typedef {import('../../src/vaultFactory/vaultFactory').VaultFactoryContract} VFC */

const trace = makeTracer('TestST', false);

const SECONDS_PER_DAY = SECONDS_PER_YEAR / 365n;
const SECONDS_PER_WEEK = SECONDS_PER_DAY * 7n;

// Define locally to test that vaultFactory uses these values
export const Phase = /** @type {const} */ ({
  ACTIVE: 'active',
  LIQUIDATING: 'liquidating',
  CLOSED: 'closed',
  LIQUIDATED: 'liquidated',
  TRANSFER: 'transfer',
});

test.before(async t => {
  const { zoe, feeMintAccessP } = await setUpZoeForTest();
  const runIssuer = await E(zoe).getFeeIssuer();
  const runBrand = await E(runIssuer).getBrand();
  // @ts-expect-error missing mint
  const run = withAmountUtils({ issuer: runIssuer, brand: runBrand });
  const aeth = withAmountUtils(makeIssuerKit('aEth'));

  const bundleCache = await unsafeMakeBundleCache('./bundles/'); // package-relative
  // note that the liquidation might be a different bundle name
  const bundles = await allValues({
    faucet: bundleCache.load(contractRoots.faucet, 'faucet'),
    VaultFactory: bundleCache.load(contractRoots.VaultFactory, 'VaultFactory'),
    reserve: bundleCache.load(contractRoots.reserve, 'reserve'),
    auctioneer: bundleCache.load(contractRoots.auctioneer, 'auction'),
  });
  const installation = objectMap(bundles, bundle => E(zoe).install(bundle));

  const feeMintAccess = await feeMintAccessP;
  const contextPs = {
    zoe,
    feeMintAccess,
    bundles,
    installation,
    electorateTerms: undefined,
    loanTiming: {
      chargingPeriod: 2n,
      recordingPeriod: 6n,
    },
    minInitialDebt: 50n,
    endorsedUi: undefined,
    rates: defaultParamValues(run.brand),
  };
  const frozenCtx = await deeplyFulfilled(harden(contextPs));
  t.context = {
    ...frozenCtx,
    bundleCache,
    aeth,
    run,
  };
  trace(t, 'CONTEXT');
});

/**
 * NOTE: called separately by each test so zoe/priceAuthority don't interfere
 *
 * @param {import('ava').ExecutionContext<Context>} t
 * @param {Array<NatValue> | Ratio} priceOrList
 * @param {Amount | undefined} unitAmountIn
 * @param {import('@agoric/time/src/types').TimerService} timer
 * @param {RelativeTime} quoteInterval
 * @param {bigint} runInitialLiquidity
 * @param {bigint} [startFrequency]
 */
const setupServices = async (
  t,
  priceOrList,
  unitAmountIn,
  timer = buildManualTimer(),
  quoteInterval = 1n,
  runInitialLiquidity,
  startFrequency = undefined,
) => {
  const { zoe, run, aeth, loanTiming, minInitialDebt, endorsedUi, rates } =
    t.context;
  t.context.timer = timer;

  const { space } = await setupElectorateReserveAndAuction(
    t,
    // @ts-expect-error inconsistent types with withAmountUtils
    run,
    aeth,
    priceOrList,
    quoteInterval,
    unitAmountIn,
    startFrequency,
  );

  const { consume } = space;

  const {
    installation: { produce: iProduce },
  } = space;
  iProduce.VaultFactory.resolve(t.context.installation.VaultFactory);
  iProduce.liquidate.resolve(t.context.installation.liquidate);
  await startVaultFactory(
    space,
    { loanParams: loanTiming, options: { endorsedUi } },
    minInitialDebt,
  );

  const governorCreatorFacet = E.get(
    consume.vaultFactoryKit,
  ).governorCreatorFacet;
  /** @type {Promise<VaultFactoryCreatorFacet & LimitedCreatorFacet<VaultFactoryCreatorFacet>>} */
  const vaultFactoryCreatorFacetP = E.get(consume.vaultFactoryKit).creatorFacet;
  const reserveCreatorFacet = E.get(consume.reserveKit).creatorFacet;
  const reserveKit = { reserveCreatorFacet };

  // Add a vault that will lend on aeth collateral
  /** @type {Promise<VaultManager>} */
  const aethVaultManagerP = E(vaultFactoryCreatorFacetP).addVaultType(
    aeth.issuer,
    'AEth',
    rates,
  );
  /** @typedef {import('../../src/proposals/econ-behaviors.js').AuctioneerKit} AuctioneerKit */
  /** @type {[any, VaultFactoryCreatorFacet, VFC['publicFacet'], VaultManager, AuctioneerKit, PriceAuthority, CollateralManager]} */
  const [
    governorInstance,
    vaultFactory, // creator
    vfPublic,
    aethVaultManager,
    auctioneerKit,
    priceAuthority,
    aethCollateralManager,
  ] = await Promise.all([
    E(consume.agoricNames).lookup('instance', 'VaultFactoryGovernor'),
    vaultFactoryCreatorFacetP,
    E.get(consume.vaultFactoryKit).publicFacet,
    aethVaultManagerP,
    consume.auctioneerKit,
    consume.priceAuthority,
    E(aethVaultManagerP).getPublicFacet(),
  ]);
  trace(t, 'pa', {
    governorInstance,
    vaultFactory,
    vfPublic,
    priceAuthority: !!priceAuthority,
  });

  const { g, v } = {
    g: {
      governorInstance,
      governorPublicFacet: E(zoe).getPublicFacet(governorInstance),
      governorCreatorFacet,
    },
    v: {
      vaultFactory,
      vfPublic,
      aethVaultManager,
      aethCollateralManager,
    },
  };

  // @ts-expect-error auctioneerKit.creatorFacet looks right.
  await E(auctioneerKit.creatorFacet).addBrand(aeth.issuer, 'Aeth');

  return {
    zoe,
    governor: g,
    vaultFactory: v,
    runKit: { issuer: run.issuer, brand: run.brand },
    priceAuthority,
    reserveKit,
    auctioneerKit,
  };
};

const setClockAndAdvanceNTimes = async (timer, times, start, incr = 1n) => {
  let currentTime = start;
  // first time through is at START, then n TIMES more plus INCR
  for (let i = 0; i <= times; i += 1) {
    trace('advancing clock to ', currentTime);
    // eslint-disable-next-line no-await-in-loop
    await timer.advanceTo(TimeMath.absValue(currentTime));
    // eslint-disable-next-line no-await-in-loop
    await eventLoopIteration();
    currentTime = TimeMath.addAbsRel(currentTime, TimeMath.relValue(incr));
  }
  return currentTime;
};

const bid = async (t, zoe, auctioneerKit, aeth, bidAmount, desired) => {
  const bidderSeat = await E(zoe).offer(
    E(auctioneerKit.publicFacet).makeBidInvitation(aeth.brand),
    harden({ give: { Currency: bidAmount } }),
    harden({ Currency: getRunFromFaucet(t, bidAmount.value) }),
    { want: desired, offerPrice: makeRatioFromAmounts(bidAmount, desired) },
  );
  return bidderSeat;
};

// Calculate the nominalStart time (when liquidations happen), and the priceLock
// time (when prices are locked). Advance the clock to the priceLock time, then
// to the nominal start time. return the nominal start time and the auction
// start time, so the caller can check on liquidations in process before
// advancing the clock.
const startAuctionClock = async (auctioneerKit, manualTimer) => {
  const schedule = await E(auctioneerKit.creatorFacet).getSchedule();
  const priceDelay = await E(auctioneerKit.publicFacet).getPriceLockPeriod();
  const { startTime, startDelay } = schedule.nextAuctionSchedule;
  const nominalStart = TimeMath.subtractAbsRel(startTime, startDelay);
  const priceLockTime = TimeMath.subtractAbsRel(nominalStart, priceDelay);
  await manualTimer.advanceTo(TimeMath.absValue(priceLockTime));
  await eventLoopIteration();

  await manualTimer.advanceTo(TimeMath.absValue(nominalStart));
  await eventLoopIteration();
  return { startTime, time: nominalStart };
};

const assertBidderPayout = async (t, bidderSeat, run, curr, aeth, coll) => {
  const bidderResult = await E(bidderSeat).getOfferResult();
  t.is(bidderResult, 'Your bid has been accepted');
  const payouts = await E(bidderSeat).getPayouts();
  const { Collateral: bidderCollateral, Currency: bidderCurrency } = payouts;
  await assertPayoutAmount(t, run.issuer, bidderCurrency, run.make(curr));
  await assertPayoutAmount(t, aeth.issuer, bidderCollateral, aeth.make(coll));
};

test('price drop', async t => {
  const { zoe, aeth, run, rates } = t.context;

  const manualTimer = buildManualTimer();
  // The price starts at 5 RUN per Aeth. The loan will start with 400 Aeth
  // collateral and a loan of 1600, which is a CR of 1.25. After the price falls
  // to 4, the loan will get liquidated.
  t.context.loanTiming = {
    chargingPeriod: 2n,
    recordingPeriod: 10n,
  };

  const services = await setupServices(
    t,
    makeRatio(50n, run.brand, 10n, aeth.brand),
    aeth.make(400n),
    manualTimer,
    undefined,
    500n,
  );

  const {
    vaultFactory: { vaultFactory, vfPublic },
    priceAuthority,
    reserveKit: { reserveCreatorFacet },
    auctioneerKit,
  } = services;
  await E(reserveCreatorFacet).addIssuer(aeth.issuer, 'Aeth');

  const collateralAmount = aeth.make(400n);
  const loanAmount = run.make(1600n);
  /** @type {UserSeat<VaultKit>} */

  const vaultSeat = await E(zoe).offer(
    await E(E(vfPublic).getCollateralManager(aeth.brand)).makeVaultInvitation(),
    harden({
      give: { Collateral: collateralAmount },
      want: { Minted: loanAmount },
    }),
    harden({
      Collateral: aeth.mint.mintPayment(collateralAmount),
    }),
  );
  trace(t, 'loan made', loanAmount);

  // A bidder places a bid //////////////////////////
  const bidAmount = run.make(2000n);
  const desired = aeth.make(400n);
  const bidderSeat = await bid(t, zoe, auctioneerKit, aeth, bidAmount, desired);

  const {
    vault,
    publicNotifiers: { vault: vaultNotifier },
  } = await legacyOfferResult(vaultSeat);
  trace(t, 'offer result', vault);
  const debtAmount = await E(vault).getCurrentDebt();
  const fee = ceilMultiplyBy(loanAmount, rates.loanFee);
  t.deepEqual(
    debtAmount,
    AmountMath.add(loanAmount, fee),
    'borrower Minted amount does not match',
  );

  let notification = await E(vaultNotifier).getUpdateSince();
  trace(t, 'got notification', notification);

  t.is(notification.value.vaultState, Phase.ACTIVE);
  t.deepEqual((await notification.value).debtSnapshot, {
    debt: AmountMath.add(loanAmount, fee),
    interest: makeRatio(100n, run.brand),
  });
  const { Minted: lentAmount } = await E(vaultSeat).getFinalAllocation();
  t.truthy(AmountMath.isEqual(lentAmount, loanAmount), 'received 470 Minted');
  t.deepEqual(
    await E(vault).getCollateralAmount(),
    aeth.make(400n),
    'vault holds 11 Collateral',
  );
  trace(t, 'pa2', priceAuthority);

  // @ts-expect-error mock
  await priceAuthority.setPrice(makeRatio(40n, run.brand, 10n, aeth.brand));
  trace(t, 'price dropped a little');
  notification = await E(vaultNotifier).getUpdateSince();
  t.is(notification.value.vaultState, Phase.ACTIVE);

  const { startTime, time } = await startAuctionClock(
    auctioneerKit,
    manualTimer,
  );
  let currentTime = time;

  notification = await E(vaultNotifier).getUpdateSince();
  t.is(notification.value.vaultState, Phase.LIQUIDATING);

  t.deepEqual(
    await E(vault).getCollateralAmount(),
    aeth.makeEmpty(),
    'Collateral consumed while liquidating',
  );
  t.deepEqual(
    await E(vault).getCurrentDebt(),
    AmountMath.add(loanAmount, run.make(80n)),
    'Debt remains while liquidating',
  );

  currentTime = await setClockAndAdvanceNTimes(manualTimer, 2, startTime, 2n);
  trace(`advanced time to `, currentTime);

  notification = await E(vaultNotifier).getUpdateSince();
  t.is(notification.value.vaultState, Phase.LIQUIDATED);

  trace(t, 'debt gone');
  t.truthy(await E(vaultSeat).hasExited());

  const metricsSub = await E(reserveCreatorFacet).getMetrics();
  const m = await subscriptionTracker(t, metricsSub);

  await m.assertInitial(reserveInitialState(run.makeEmpty()));
  const debtAmountAfter = await E(vault).getCurrentDebt();

  const finalNotification = await E(vaultNotifier).getUpdateSince();
  t.is(finalNotification.value.vaultState, Phase.LIQUIDATED);

  t.deepEqual(finalNotification.value.locked, aeth.make(0n));
  t.is(debtAmountAfter.value, 0n);

  t.deepEqual(await E(vaultFactory).getRewardAllocation(), {
    Minted: run.make(80n),
  });

  /** @type {UserSeat<string>} */
  const closeSeat = await E(zoe).offer(E(vault).makeCloseInvitation());
  await E(closeSeat).getOfferResult();

  const closeProceeds = await E(closeSeat).getPayouts();
  const collProceeds = await aeth.issuer.getAmountOf(closeProceeds.Collateral);

  // Vault Holder got nothing
  t.falsy(closeProceeds.Minted);
  t.deepEqual(collProceeds, aeth.make(0n));
  t.deepEqual(await E(vault).getCollateralAmount(), aeth.makeEmpty());

  //  Bidder bought 400 Aeth
  await assertBidderPayout(t, bidderSeat, run, 320n, aeth, 400n);
});

test('price falls precipitously', async t => {
  const { zoe, aeth, run, rates } = t.context;
  t.context.loanTiming = {
    chargingPeriod: 2n,
    recordingPeriod: 10n,
  };

  // The borrower will deposit 4 Aeth, and ask to borrow 500 Minted. The
  // PriceAuthority's initial quote is 180. The max loan on 4 Aeth would be 600
  // (to make the margin 20%).
  // The price falls to 130, so the loan will get liquidated. At that point, 4
  // Aeth is worth 520, with a 5% margin, 546 is required. The auction sells at
  // 85%, so the borrower gets something back

  const manualTimer = buildManualTimer();
  const services = await setupServices(
    t,
    makeRatio(600n, run.brand, 4n, aeth.brand),
    aeth.make(900n),
    manualTimer,
    undefined,
    500n,
  );
  // we start with time=0, price=2200

  const { vaultFactory, vfPublic } = services.vaultFactory;

  const {
    reserveKit: { reserveCreatorFacet },
    auctioneerKit,
    priceAuthority,
  } = services;
  await E(reserveCreatorFacet).addIssuer(aeth.issuer, 'Aeth');

  // Create a loan for 500 Minted with 4 aeth collateral
  const collateralAmount = aeth.make(4n);
  const loanAmount = run.make(500n);
  /** @type {UserSeat<VaultKit>} */
  const userSeat = await E(zoe).offer(
    await E(E(vfPublic).getCollateralManager(aeth.brand)).makeVaultInvitation(),
    harden({
      give: { Collateral: collateralAmount },
      want: { Minted: loanAmount },
    }),
    harden({
      Collateral: aeth.mint.mintPayment(collateralAmount),
    }),
  );

  // A bidder places a bid //////////////////////////
  const bidAmount = run.make(500n);
  const desired = aeth.make(4n);
  const bidderSeat = await bid(t, zoe, auctioneerKit, aeth, bidAmount, desired);

  const {
    vault,
    publicNotifiers: { vault: vaultNotifier },
  } = await legacyOfferResult(userSeat);
  const debtAmount = await E(vault).getCurrentDebt();
  const fee = ceilMultiplyBy(run.make(500n), rates.loanFee);
  t.deepEqual(
    debtAmount,
    AmountMath.add(loanAmount, fee),
    'borrower owes 525 Minted',
  );

  const { Minted: lentAmount } = await E(userSeat).getFinalAllocation();
  t.deepEqual(lentAmount, loanAmount, 'received 470 Minted');
  t.deepEqual(
    await E(vault).getCollateralAmount(),
    aeth.make(4n),
    'vault holds 4 Collateral',
  );

  // @ts-expect-error it's a mock
  priceAuthority.setPrice(makeRatio(130n, run.brand, 1n, aeth.brand));

  const { startTime, time } = await startAuctionClock(
    auctioneerKit,
    manualTimer,
  );
  const currentTime = time;
  trace('time advanced to ', currentTime);

  const assertDebtIs = async value => {
    const debt = await E(vault).getCurrentDebt();
    t.is(
      debt.value,
      BigInt(value),
      `Expected debt ${debt.value} to be ${value}`,
    );
  };

  const metricsSub = await E(reserveCreatorFacet).getMetrics();
  const m = await subscriptionTracker(t, metricsSub);
  await m.assertInitial(reserveInitialState(run.makeEmpty()));
  await assertDebtIs(debtAmount.value);

  await setClockAndAdvanceNTimes(manualTimer, 2, startTime, 2n);

  t.deepEqual(
    await E(vault).getCurrentDebt(),
    run.makeEmpty(),
    `Expected debt after liquidation to be zero`,
  );

  t.deepEqual(await E(vaultFactory).getRewardAllocation(), {
    Minted: run.make(25n),
  });

  t.deepEqual(
    await E(vault).getCollateralAmount(),
    aeth.makeEmpty(),
    'Collateral reduced after liquidation',
  );
  t.deepEqual(
    await E(vault).getCollateralAmount(),
    aeth.makeEmpty(),
    'Excess collateral not returned due to shortfall',
  );

  const finalNotification = await E(vaultNotifier).getUpdateSince();
  t.is(finalNotification.value.vaultState, Phase.LIQUIDATED);
  // vault holds no debt after liquidation
  t.is(finalNotification.value.debtSnapshot.debt.value, 0n);

  /** @type {UserSeat<string>} */
  const closeSeat = await E(zoe).offer(E(vault).makeCloseInvitation());
  // closing with 64n Minted remaining in debt
  await E(closeSeat).getOfferResult();

  const closeProceeds = await E(closeSeat).getPayouts();
  const collProceeds = await aeth.issuer.getAmountOf(closeProceeds.Collateral);

  t.falsy(closeProceeds.Minted);
  t.deepEqual(collProceeds, aeth.make(0n));
  t.deepEqual(await E(vault).getCollateralAmount(), aeth.makeEmpty());

  //  Bidder bought 4 Aeth
  await assertBidderPayout(t, bidderSeat, run, 58n, aeth, 4n);
});

// We'll make two loans, and trigger liquidation of one via price changes, and
// the other via interest charges. The interest rate is 40%. The liquidation
// margin is 105%. The priceAuthority will initially quote 10:1 Run:Aeth, and
// drop to 7:1. Both loans will initially be over collateralized 100%. Alice
// will withdraw enough of the overage that she'll get caught when prices drop.
// Bob will be charged interest, which will trigger liquidation.
test('mutable liquidity triggers and interest', async t => {
  const { zoe, aeth, run, rates: defaultRates } = t.context;

  // Add a vaultManager with 10000 aeth collateral at a 200 aeth/Minted rate
  const rates = harden({
    ...defaultRates,
    // charge 40% interest / year
    interestRate: run.makeRatio(40n),
    liquidationMargin: run.makeRatio(130n),
  });
  t.context.rates = rates;

  // Interest is charged daily, and auctions are every week, so we'll charge
  // interest a few times before the second auction.
  t.context.loanTiming = {
    chargingPeriod: SECONDS_PER_DAY,
    recordingPeriod: SECONDS_PER_DAY,
  };

  const manualTimer = buildManualTimer();
  const services = await setupServices(
    t,
    makeRatio(100n, run.brand, 10n, aeth.brand),
    aeth.make(1n),
    manualTimer,
    SECONDS_PER_WEEK,
    500n,
  );

  const {
    vaultFactory: { aethVaultManager, vfPublic },
    priceAuthority,
    reserveKit: { reserveCreatorFacet },
    auctioneerKit,
  } = services;
  await E(reserveCreatorFacet).addIssuer(aeth.issuer, 'Aeth');

  const metricsSub = await E(reserveCreatorFacet).getMetrics();
  const m = await subscriptionTracker(t, metricsSub);
  await m.assertInitial(reserveInitialState(run.makeEmpty()));
  let shortfallBalance = 0n;

  const cm = await E(aethVaultManager).getPublicFacet();
  const aethVaultMetrics = await vaultManagerMetricsTracker(t, cm);
  await aethVaultMetrics.assertInitial({
    // present
    numActiveVaults: 0,
    numLiquidatingVaults: 0,
    totalCollateral: aeth.make(0n),
    totalDebt: run.make(0n),
    retainedCollateral: aeth.make(0n),

    // running
    numLiquidationsCompleted: 0,
    numLiquidationsAborted: 0,
    totalOverageReceived: run.make(0n),
    totalProceedsReceived: run.make(0n),
    totalCollateralSold: aeth.make(0n),
    liquidatingCollateral: aeth.make(0n),
    liquidatingDebt: run.make(0n),
    totalShortfallReceived: run.make(0n),
  });

  // initial loans /////////////////////////////////////

  // ALICE ////////////////////////////////////////////

  // Create a loan for Alice for 5000 Minted with 1000 aeth collateral
  // ratio is 4:1
  const aliceCollateralAmount = aeth.make(1000n);
  const aliceLoanAmount = run.make(5000n);
  /** @type {UserSeat<VaultKit>} */
  const aliceLoanSeat = await E(zoe).offer(
    await E(E(vfPublic).getCollateralManager(aeth.brand)).makeVaultInvitation(),
    harden({
      give: { Collateral: aliceCollateralAmount },
      want: { Minted: aliceLoanAmount },
    }),
    harden({
      Collateral: aeth.mint.mintPayment(aliceCollateralAmount),
    }),
  );
  const {
    vault: aliceVault,
    publicNotifiers: { vault: aliceNotifier },
  } = await legacyOfferResult(aliceLoanSeat);

  const aliceDebtAmount = await E(aliceVault).getCurrentDebt();
  const fee = ceilMultiplyBy(aliceLoanAmount, rates.loanFee);
  const aliceRunDebtLevel = AmountMath.add(aliceLoanAmount, fee);

  t.deepEqual(
    aliceDebtAmount,
    aliceRunDebtLevel,
    'vault lent 5000 Minted + fees',
  );
  const { Minted: aliceLentAmount } = await E(
    aliceLoanSeat,
  ).getFinalAllocation();
  const aliceLoanProceeds = await E(aliceLoanSeat).getPayouts();
  t.deepEqual(aliceLentAmount, aliceLoanAmount, 'received 5000 Minted');
  trace(t, 'alice vault');

  const aliceRunLent = await aliceLoanProceeds.Minted;
  t.truthy(
    AmountMath.isEqual(
      await E(run.issuer).getAmountOf(aliceRunLent),
      aliceLoanAmount,
    ),
  );

  let aliceUpdate = await E(aliceNotifier).getUpdateSince();
  t.deepEqual(aliceUpdate.value.debtSnapshot.debt, aliceRunDebtLevel);

  let totalDebt = 5250n;
  await aethVaultMetrics.assertChange({
    numActiveVaults: 1,
    totalCollateral: { value: 1000n },
    totalDebt: { value: totalDebt },
  });

  // BOB //////////////////////////////////////////////

  // Create a loan for Bob for 655 Minted with 100 Aeth collateral
  const bobCollateralAmount = aeth.make(100n);
  const bobLoanAmount = run.make(655n);
  /** @type {UserSeat<VaultKit>} */
  const bobLoanSeat = await E(zoe).offer(
    await E(E(vfPublic).getCollateralManager(aeth.brand)).makeVaultInvitation(),
    harden({
      give: { Collateral: bobCollateralAmount },
      want: { Minted: bobLoanAmount },
    }),
    harden({
      Collateral: aeth.mint.mintPayment(bobCollateralAmount),
    }),
  );
  const {
    vault: bobVault,
    publicNotifiers: { vault: bobNotifier },
  } = await legacyOfferResult(bobLoanSeat);

  const bobDebtAmount = await E(bobVault).getCurrentDebt();
  const bobFee = ceilMultiplyBy(bobLoanAmount, rates.loanFee);
  const bobRunDebtLevel = AmountMath.add(bobLoanAmount, bobFee);

  t.deepEqual(bobDebtAmount, bobRunDebtLevel, 'vault lent 5000 Minted + fees');
  const { Minted: bobLentAmount } = await E(bobLoanSeat).getFinalAllocation();
  const bobLoanProceeds = await E(bobLoanSeat).getPayouts();
  t.deepEqual(bobLentAmount, bobLoanAmount, 'received 5000 Minted');
  trace(t, 'bob vault');

  const bobRunLent = await bobLoanProceeds.Minted;
  t.truthy(
    AmountMath.isEqual(
      await E(run.issuer).getAmountOf(bobRunLent),
      bobLoanAmount,
    ),
  );

  let bobUpdate = await E(bobNotifier).getUpdateSince();
  t.deepEqual(bobUpdate.value.debtSnapshot.debt, bobRunDebtLevel);
  totalDebt += 655n + 33n;
  await aethVaultMetrics.assertChange({
    numActiveVaults: 2,
    totalCollateral: { value: 1100n },
    totalDebt: { value: totalDebt },
  });

  // reduce collateral  /////////////////////////////////////

  // Alice reduce collateral by 300. That leaves her at 700 * 10 > 1.05 * 5000.
  // Prices will drop from 10 to 7, she'll be liquidated: 700 * 7 < 1.05 * 5000.
  const collateralDecrement = aeth.make(300n);
  const aliceReduceCollateralSeat = await E(zoe).offer(
    E(aliceVault).makeAdjustBalancesInvitation(),
    harden({
      want: { Collateral: collateralDecrement },
    }),
  );
  await E(aliceReduceCollateralSeat).getOfferResult();

  const { Collateral: aliceWithdrawnAeth } = await E(
    aliceReduceCollateralSeat,
  ).getFinalAllocation();
  const loanProceeds4 = await E(aliceReduceCollateralSeat).getPayouts();
  t.deepEqual(aliceWithdrawnAeth, aeth.make(300n));

  const collateralWithdrawn = await loanProceeds4.Collateral;
  t.truthy(
    AmountMath.isEqual(
      await E(aeth.issuer).getAmountOf(collateralWithdrawn),
      collateralDecrement,
    ),
  );

  aliceUpdate = await E(aliceNotifier).getUpdateSince(aliceUpdate.updateCount);
  t.deepEqual(aliceUpdate.value.debtSnapshot.debt, aliceRunDebtLevel);
  trace(t, 'alice reduce collateral');
  await aethVaultMetrics.assertChange({
    totalCollateral: { value: 800n },
  });

  // @ts-expect-error mock
  await E(priceAuthority).setPrice(makeRatio(70n, run.brand, 10n, aeth.brand));
  trace(t, 'changed price to 7 RUN/Aeth');

  // A BIDDER places a BID //////////////////////////
  const bidAmount = run.make(10000n);
  const desired = aeth.make(800n);
  const bidderSeat = await bid(t, zoe, auctioneerKit, aeth, bidAmount, desired);

  const { startTime: start1, time: now1 } = await startAuctionClock(
    auctioneerKit,
    manualTimer,
  );
  let currentTime = now1;

  // expect Alice to be liquidated because her collateral is too low.
  aliceUpdate = await E(aliceNotifier).getUpdateSince(aliceUpdate.updateCount);
  trace(t, 'alice liquidating?', aliceUpdate.value.vaultState);
  t.is(aliceUpdate.value.vaultState, Phase.LIQUIDATING);

  currentTime = await setClockAndAdvanceNTimes(manualTimer, 2, start1, 2n);

  aliceUpdate = await E(aliceNotifier).getUpdateSince(aliceUpdate.updateCount);
  t.is(aliceUpdate.value.vaultState, Phase.LIQUIDATED);
  trace(t, 'alice liquidated');
  totalDebt += 36n;
  await aethVaultMetrics.assertChange({
    numActiveVaults: 1,
    numLiquidatingVaults: 1,
    totalDebt: { value: totalDebt },
    liquidatingCollateral: { value: 700n },
    liquidatingDebt: { value: 5282n },
  });

  shortfallBalance += 137n;
  await m.assertChange({
    shortfallBalance: { value: shortfallBalance },
  });

  bobUpdate = await E(bobNotifier).getUpdateSince();
  t.is(bobUpdate.value.vaultState, Phase.ACTIVE);

  const { startTime: start2, time: now2 } = await startAuctionClock(
    auctioneerKit,
    manualTimer,
  );

  totalDebt -= 5145n + shortfallBalance - 1n;
  await aethVaultMetrics.assertChange({
    liquidatingDebt: { value: 0n },
    liquidatingCollateral: { value: 0n },
    totalCollateral: { value: 100n },
    totalDebt: { value: totalDebt },
    numLiquidatingVaults: 0,
    numLiquidationsCompleted: 1,
    totalCollateralSold: { value: 700n },
    totalProceedsReceived: { value: 5145n },
    totalShortfallReceived: { value: shortfallBalance },
  });

  bobUpdate = await E(bobNotifier).getUpdateSince();
  t.is(bobUpdate.value.vaultState, Phase.ACTIVE);

  currentTime = now2;
  currentTime = await setClockAndAdvanceNTimes(manualTimer, 2, start2, 2n);

  // Bob's loan is now 777 Minted (including interest) on 100 Aeth, with the price
  // at 7. 100 * 7 > 1.05 * 777. When interest is charged again, Bob should get
  // liquidated.

  const { startTime: start3, time: now3 } = await startAuctionClock(
    auctioneerKit,
    manualTimer,
  );

  totalDebt += 13n;
  await aethVaultMetrics.assertChange({
    liquidatingDebt: { value: 706n },
    liquidatingCollateral: { value: 100n },
    totalDebt: { value: totalDebt },
    numActiveVaults: 0,
    numLiquidatingVaults: 1,
  });

  currentTime = now3;
  currentTime = await setClockAndAdvanceNTimes(
    manualTimer,
    2,
    start3,
    SECONDS_PER_DAY,
  );
  trace(t, 'finished auctions', currentTime);

  bobUpdate = await E(bobNotifier).getUpdateSince();
  t.is(bobUpdate.value.vaultState, Phase.LIQUIDATED);

  totalDebt = 0n;
  await aethVaultMetrics.assertChange({
    liquidatingDebt: { value: 0n },
    liquidatingCollateral: { value: 0n },
    totalCollateral: { value: 0n },
    totalDebt: { value: totalDebt },
    numLiquidatingVaults: 0,
    numLiquidationsCompleted: 2,
    totalOverageReceived: { value: 29n },
    totalCollateralSold: { value: 800n },
    totalProceedsReceived: { value: 5880n },
  });

  //  Bidder bought 800 Aeth
  await assertBidderPayout(t, bidderSeat, run, 4120n, aeth, 800n);
});

// We'll make two loans, and trigger one via interest charges, and not trigger
// liquidation of the other. The interest rate is 200% per annum. The liquidation margin is
// 105%. Alice's loan will initially be over collateralized 100%. Alice will
// withdraw enough of the overage that she's on the cusp of getting caught when
// prices drop. Bob won't be so overcollateralized. When he is charged interest
// it will trigger liquidation. Alice's withdrawal is precisely gauged so the
// difference between a floorDivideBy and a ceilingDivideBy will leave her
// unliquidated.
test('sell goods at auction', async t => {
  const { zoe, aeth, run, rates: defaultRates } = t.context;

  // Interest is charged daily, and auctions are every week, so we'll charge
  // interest a few times before the second auction.
  t.context.loanTiming = {
    chargingPeriod: SECONDS_PER_DAY,
    recordingPeriod: SECONDS_PER_DAY,
  };

  // Add a vaultManager with 10000 aeth collateral at a 200 aeth/Minted rate
  const rates = harden({
    ...defaultRates,
    // charge 200% interest
    interestRate: run.makeRatio(200n),
  });
  t.context.rates = rates;

  // charge interest on every tick
  const manualTimer = buildManualTimer();
  const services = await setupServices(
    t,
    makeRatio(100n, run.brand, 10n, aeth.brand),
    aeth.make(1n),
    manualTimer,
    SECONDS_PER_WEEK,
    500n,
  );

  const {
    auctioneerKit,
    priceAuthority,
    reserveKit: { reserveCreatorFacet },
  } = services;
  await E(reserveCreatorFacet).addIssuer(aeth.issuer, 'Aeth');

  // initial loans /////////////////////////////////////
  const { vfPublic } = services.vaultFactory;

  // Create a loan for Alice for 5000 Minted with 1000 aeth collateral
  const aliceCollateralAmount = aeth.make(1000n);
  const aliceLoanAmount = run.make(5000n);
  /** @type {UserSeat<VaultKit>} */
  const aliceLoanSeat = await E(zoe).offer(
    await E(E(vfPublic).getCollateralManager(aeth.brand)).makeVaultInvitation(),
    harden({
      give: { Collateral: aliceCollateralAmount },
      want: { Minted: aliceLoanAmount },
    }),
    harden({
      Collateral: aeth.mint.mintPayment(aliceCollateralAmount),
    }),
  );
  const {
    vault: aliceVault,
    publicNotifiers: { vault: aliceNotifier },
  } = await legacyOfferResult(aliceLoanSeat);

  const aliceDebtAmount = await E(aliceVault).getCurrentDebt();
  const fee = ceilMultiplyBy(aliceLoanAmount, rates.loanFee);
  const aliceRunDebtLevel = AmountMath.add(aliceLoanAmount, fee);

  t.deepEqual(
    aliceDebtAmount,
    aliceRunDebtLevel,
    'vault lent 5000 Minted + fees',
  );
  const { Minted: aliceLentAmount } = await E(
    aliceLoanSeat,
  ).getFinalAllocation();
  const aliceLoanProceeds = await E(aliceLoanSeat).getPayouts();
  t.deepEqual(aliceLentAmount, aliceLoanAmount, 'received 5000 Minted');

  const aliceRunLent = await aliceLoanProceeds.Minted;
  t.truthy(
    AmountMath.isEqual(
      await E(run.issuer).getAmountOf(aliceRunLent),
      run.make(5000n),
    ),
  );

  let aliceUpdate = await E(aliceNotifier).getUpdateSince();
  t.deepEqual(aliceUpdate.value.debtSnapshot.debt, aliceRunDebtLevel);

  // Create a loan for Bob for 740 Minted with 100 Aeth collateral
  const bobCollateralAmount = aeth.make(100n);
  const bobLoanAmount = run.make(740n);
  /** @type {UserSeat<VaultKit>} */
  const bobLoanSeat = await E(zoe).offer(
    await E(E(vfPublic).getCollateralManager(aeth.brand)).makeVaultInvitation(),
    harden({
      give: { Collateral: bobCollateralAmount },
      want: { Minted: bobLoanAmount },
    }),
    harden({
      Collateral: aeth.mint.mintPayment(bobCollateralAmount),
    }),
  );
  const {
    vault: bobVault,
    publicNotifiers: { vault: bobNotifier },
  } = await legacyOfferResult(bobLoanSeat);

  const bobDebtAmount = await E(bobVault).getCurrentDebt();
  const bobFee = ceilMultiplyBy(bobLoanAmount, rates.loanFee);
  const bobRunDebtLevel = AmountMath.add(bobLoanAmount, bobFee);

  t.deepEqual(bobDebtAmount, bobRunDebtLevel, 'vault lent 5000 Minted + fees');
  const { Minted: bobLentAmount } = await E(bobLoanSeat).getFinalAllocation();
  const bobLoanProceeds = await E(bobLoanSeat).getPayouts();
  t.deepEqual(bobLentAmount, bobLoanAmount, 'received 5000 Minted');

  const bobRunLent = await bobLoanProceeds.Minted;
  t.truthy(
    AmountMath.isEqual(
      await E(run.issuer).getAmountOf(bobRunLent),
      run.make(740n),
    ),
  );

  let bobUpdate = await E(bobNotifier).getUpdateSince();
  t.deepEqual(bobUpdate.value.debtSnapshot.debt, bobRunDebtLevel);

  // A BIDDER places a BID //////////////////////////
  const bidAmount = run.make(800n);
  const desired = aeth.make(100n);
  const bidderSeat = await bid(t, zoe, auctioneerKit, aeth, bidAmount, desired);

  // reduce collateral  /////////////////////////////////////

  // Alice reduce collateral by 300. That leaves her at 700 * 10 > 1.05 * 5000.
  // Prices will drop from 10 to 7, she'll be liquidated: 700 * 7 < 1.05 * 5000.
  const collateralDecrement = aeth.make(211n);
  const aliceReduceCollateralSeat = await E(zoe).offer(
    E(aliceVault).makeAdjustBalancesInvitation(),
    harden({
      want: { Collateral: collateralDecrement },
    }),
  );

  await E(aliceReduceCollateralSeat).getOfferResult();

  await E(aliceReduceCollateralSeat).getFinalAllocation();
  const loanProceeds4 = await E(aliceReduceCollateralSeat).getPayouts();

  const collateralWithdrawn = await loanProceeds4.Collateral;
  t.truthy(
    AmountMath.isEqual(
      await E(aeth.issuer).getAmountOf(collateralWithdrawn),
      collateralDecrement,
    ),
  );

  aliceUpdate = await E(aliceNotifier).getUpdateSince(aliceUpdate.updateCount);
  t.deepEqual(aliceUpdate.value.debtSnapshot.debt, aliceRunDebtLevel);
  t.is(aliceUpdate.value.vaultState, Phase.ACTIVE);

  // price falls
  // @ts-expect-error setupServices() should return the right type
  await priceAuthority.setPrice(makeRatio(70n, run.brand, 10n, aeth.brand));

  // Bob's loan is now 777 Minted (including interest) on 100 Aeth, with the price
  // at 7. 100 * 7 > 1.05 * 777. When interest is charged again, Bob should get
  // liquidated.
  // Advance time to trigger interest collection.

  const { startTime } = await startAuctionClock(auctioneerKit, manualTimer);

  await setClockAndAdvanceNTimes(manualTimer, 2n, startTime, 2n);

  // price levels changed and interest was charged.

  bobUpdate = await E(bobNotifier).getUpdateSince(bobUpdate.updateCount);
  t.is(bobUpdate.value.vaultState, Phase.LIQUIDATED);

  // No change for Alice
  aliceUpdate = await E(aliceNotifier).getUpdateSince(); // can't use updateCount because there's no newer update
  t.is(aliceUpdate.value.vaultState, Phase.ACTIVE);

  //  Bidder bought 100 Aeth
  await assertBidderPayout(t, bidderSeat, run, 65n, aeth, 100n);
});

test('collect fees from loan', async t => {
  const { zoe, aeth, run, rates } = t.context;
  const manualTimer = buildManualTimer();

  t.context.loanTiming = {
    chargingPeriod: 2n,
    recordingPeriod: 10n,
  };

  const services = await setupServices(
    t,
    makeRatio(10n, run.brand, 1n, aeth.brand),
    aeth.make(1n),
    manualTimer,
    undefined,
    500n,
  );

  const {
    vaultFactory: { aethVaultManager, vfPublic },
    priceAuthority,
    reserveKit: { reserveCreatorFacet },
    auctioneerKit,
  } = services;
  await E(reserveCreatorFacet).addIssuer(aeth.issuer, 'Aeth');

  const metricsSub = await E(reserveCreatorFacet).getMetrics();
  const reserveMetrics = await subscriptionTracker(t, metricsSub);
  await reserveMetrics.assertInitial(reserveInitialState(run.makeEmpty()));

  const cm = await E(aethVaultManager).getPublicFacet();
  const aethVaultMetrics = await vaultManagerMetricsTracker(t, cm);
  await aethVaultMetrics.assertInitial({
    // present
    numActiveVaults: 0,
    numLiquidatingVaults: 0,
    totalCollateral: aeth.make(0n),
    totalDebt: run.make(0n),
    retainedCollateral: aeth.make(0n),

    // running
    numLiquidationsCompleted: 0,
    numLiquidationsAborted: 0,
    totalOverageReceived: run.make(0n),
    totalProceedsReceived: run.make(0n),
    totalCollateralSold: aeth.make(0n),
    liquidatingCollateral: aeth.make(0n),
    liquidatingDebt: run.make(0n),
    totalShortfallReceived: run.make(0n),
  });

  // initial loans /////////////////////////////////////

  // ALICE ////////////////////////////////////////////

  // Create a loan for Alice for 5000 Minted with 1000 aeth collateral
  // ratio is 4:1
  const aliceCollateralAmount = aeth.make(1000n);
  const aliceLoanAmount = run.make(5000n);
  /** @type {UserSeat<VaultKit>} */
  const aliceLoanSeat = await E(zoe).offer(
    await E(E(vfPublic).getCollateralManager(aeth.brand)).makeVaultInvitation(),
    harden({
      give: { Collateral: aliceCollateralAmount },
      want: { Minted: aliceLoanAmount },
    }),
    harden({
      Collateral: aeth.mint.mintPayment(aliceCollateralAmount),
    }),
  );
  const {
    vault: aliceVault,
    publicNotifiers: { vault: aliceNotifier },
  } = await legacyOfferResult(aliceLoanSeat);
  let notification = await E(aliceNotifier).getUpdateSince();
  t.is(notification.value.vaultState, Phase.ACTIVE);

  let totalCollateral = 1000n;
  const totalDebt = 5250n;
  await aethVaultMetrics.assertChange({
    numActiveVaults: 1,
    totalCollateral: { value: totalCollateral },
    totalDebt: { value: totalDebt },
  });

  const aliceDebtAmount = await E(aliceVault).getCurrentDebt();
  const fee = ceilMultiplyBy(aliceLoanAmount, rates.loanFee);
  const aliceRunDebtLevel = AmountMath.add(aliceLoanAmount, fee);

  t.deepEqual(
    aliceDebtAmount,
    aliceRunDebtLevel,
    'vault lent 5000 Minted + fees',
  );
  const { Minted: aliceLentAmount } = await E(
    aliceLoanSeat,
  ).getFinalAllocation();
  const aliceLoanProceeds = await E(aliceLoanSeat).getPayouts();
  t.deepEqual(aliceLentAmount, aliceLoanAmount, 'received 5000 Minted');
  trace(t, 'alice vault');

  const aliceRunLent = await aliceLoanProceeds.Minted;
  t.truthy(
    AmountMath.isEqual(
      await E(run.issuer).getAmountOf(aliceRunLent),
      aliceLoanAmount,
    ),
  );

  let aliceUpdate = await E(aliceNotifier).getUpdateSince();
  t.deepEqual(aliceUpdate.value.debtSnapshot.debt, aliceRunDebtLevel);

  // A bidder places a bid //////////////////////////
  const bidAmount = run.make(3_000n);
  const desired = aeth.make(700n);
  const bidderSeat = await bid(t, zoe, auctioneerKit, aeth, bidAmount, desired);

  // reduce collateral  /////////////////////////////////////

  // Alice reduce collateral by 300. That leaves her at 700 * 10 > 1.05 * 5000.
  // Prices will drop from 10 to 7, she'll be liquidated: 700 * 7 < 1.05 * 5000.
  const collateralDecrement = aeth.make(300n);
  const aliceReduceCollateralSeat = await E(zoe).offer(
    E(aliceVault).makeAdjustBalancesInvitation(),
    harden({
      want: { Collateral: collateralDecrement },
    }),
  );
  await E(aliceReduceCollateralSeat).getOfferResult();

  const { Collateral: aliceWithdrawnAeth } = await E(
    aliceReduceCollateralSeat,
  ).getFinalAllocation();
  const loanProceeds4 = await E(aliceReduceCollateralSeat).getPayouts();
  t.deepEqual(aliceWithdrawnAeth, aeth.make(300n));

  totalCollateral -= 300n;
  await aethVaultMetrics.assertChange({
    totalCollateral: { value: totalCollateral },
  });

  const collateralWithdrawn = await loanProceeds4.Collateral;
  t.truthy(
    AmountMath.isEqual(
      await E(aeth.issuer).getAmountOf(collateralWithdrawn),
      collateralDecrement,
    ),
  );

  aliceUpdate = await E(aliceNotifier).getUpdateSince(aliceUpdate.updateCount);
  t.deepEqual(aliceUpdate.value.debtSnapshot.debt, aliceRunDebtLevel);
  trace(t, 'alice reduce collateral');

  // @ts-expect-error mock
  await E(priceAuthority).setPrice(makeRatio(7n, run.brand, 1n, aeth.brand));
  trace(t, 'changed price to 7');

  // @ts-expect-error mock
  await priceAuthority.setPrice(makeRatio(40n, run.brand, 10n, aeth.brand));
  trace(t, 'price dropped a little');
  notification = await E(aliceNotifier).getUpdateSince();
  t.is(notification.value.vaultState, Phase.ACTIVE);

  const { startTime, time } = await startAuctionClock(
    auctioneerKit,
    manualTimer,
  );
  let currentTime = time;

  notification = await E(aliceNotifier).getUpdateSince();
  t.is(notification.value.vaultState, Phase.LIQUIDATING);

  t.deepEqual(
    await E(aliceVault).getCollateralAmount(),
    aeth.makeEmpty(),
    'Collateral consumed while liquidating',
  );

  t.deepEqual(
    await E(aliceVault).getCurrentDebt(),
    AmountMath.add(aliceLoanAmount, run.make(250n)),
    'Debt remains while liquidating',
  );

  currentTime = await setClockAndAdvanceNTimes(manualTimer, 2, startTime, 2n);
  trace(`advanced time to `, currentTime);

  notification = await E(aliceNotifier).getUpdateSince();
  t.is(notification.value.vaultState, Phase.LIQUIDATED);

  // expect Alice to be liquidated because her collateral is too low.

  aliceUpdate = await E(aliceNotifier).getUpdateSince(aliceUpdate.updateCount);
  t.is(aliceUpdate.value.vaultState, Phase.LIQUIDATED);
  trace(t, 'alice liquidated');

  await reserveMetrics.assertChange({
    shortfallBalance: { value: 2310n },
  });

  await aethVaultMetrics.assertChange({
    numActiveVaults: 0,
    numLiquidatingVaults: 1,

    // running
    liquidatingCollateral: { value: 700n },
    liquidatingDebt: { value: 5250n },
  });

  await aethVaultMetrics.assertChange({
    numLiquidatingVaults: 0,
    totalCollateralSold: { value: 700n },
    totalDebt: { value: 0n },
    totalCollateral: { value: 0n },

    // running
    numLiquidationsCompleted: 1,
    totalProceedsReceived: { value: 2940n },
    totalShortfallReceived: { value: 2310n },
    liquidatingCollateral: { value: 0n },
    liquidatingDebt: { value: 0n },
  });

  //  Bidder bought 400 Aeth
  await assertBidderPayout(t, bidderSeat, run, 60n, aeth, 700n);
});

// We'll make a loan, and trigger liquidation via price changes. The interest
// rate is 40%. The liquidation margin is 105%. The priceAuthority will
// initially quote 10:1 Run:Aeth, and drop to 7:1. The loan will initially be
// overcollateralized 100%. Alice will withdraw enough of the overage that
// she'll get caught when prices drop.
// A bidder will buy at the 65% level, so there will be a shortfall.
test('Auction sells all collateral w/shortfall', async t => {
  const { zoe, aeth, run, rates: defaultRates } = t.context;

  // Add a vaultManager with 10000 aeth collateral at a 200 aeth/Minted rate
  const rates = harden({
    ...defaultRates,
    // charge 40% interest / year
    interestRate: run.makeRatio(40n),
    liquidationMargin: run.makeRatio(130n),
  });
  t.context.rates = rates;

  // Interest is charged daily, and auctions are every week
  t.context.loanTiming = {
    chargingPeriod: SECONDS_PER_DAY,
    recordingPeriod: SECONDS_PER_DAY,
  };

  const manualTimer = buildManualTimer();
  const services = await setupServices(
    t,
    makeRatio(100n, run.brand, 10n, aeth.brand),
    aeth.make(1n),
    manualTimer,
    SECONDS_PER_WEEK,
    500n,
  );

  const {
    vaultFactory: { aethVaultManager, vfPublic },
    priceAuthority,
    reserveKit: { reserveCreatorFacet },
    auctioneerKit,
  } = services;
  await E(reserveCreatorFacet).addIssuer(aeth.issuer, 'Aeth');

  const metricsSub = await E(reserveCreatorFacet).getMetrics();
  const m = await subscriptionTracker(t, metricsSub);
  await m.assertInitial(reserveInitialState(run.makeEmpty()));
  let shortfallBalance = 0n;

  const cm = await E(aethVaultManager).getPublicFacet();
  const aethVaultMetrics = await vaultManagerMetricsTracker(t, cm);
  await aethVaultMetrics.assertInitial({
    // present
    numActiveVaults: 0,
    numLiquidatingVaults: 0,
    totalCollateral: aeth.make(0n),
    totalDebt: run.make(0n),
    retainedCollateral: aeth.make(0n),

    // running
    numLiquidationsCompleted: 0,
    numLiquidationsAborted: 0,
    totalOverageReceived: run.make(0n),
    totalProceedsReceived: run.make(0n),
    totalCollateralSold: aeth.make(0n),
    liquidatingCollateral: aeth.make(0n),
    liquidatingDebt: run.make(0n),
    totalShortfallReceived: run.make(0n),
  });

  // ALICE's loan ////////////////////////////////////////////

  // Create a loan for Alice for 5000 Minted with 1000 aeth collateral
  // ratio is 4:1
  const aliceCollateralAmount = aeth.make(1000n);
  const aliceLoanAmount = run.make(5000n);
  /** @type {UserSeat<VaultKit>} */
  const aliceLoanSeat = await E(zoe).offer(
    await E(E(vfPublic).getCollateralManager(aeth.brand)).makeVaultInvitation(),
    harden({
      give: { Collateral: aliceCollateralAmount },
      want: { Minted: aliceLoanAmount },
    }),
    harden({
      Collateral: aeth.mint.mintPayment(aliceCollateralAmount),
    }),
  );
  const {
    vault: aliceVault,
    publicNotifiers: { vault: aliceNotifier },
  } = await legacyOfferResult(aliceLoanSeat);

  const aliceDebtAmount = await E(aliceVault).getCurrentDebt();
  const fee = ceilMultiplyBy(aliceLoanAmount, rates.loanFee);
  const aliceRunDebtLevel = AmountMath.add(aliceLoanAmount, fee);

  t.deepEqual(
    aliceDebtAmount,
    aliceRunDebtLevel,
    'vault lent 5000 Minted + fees',
  );
  const { Minted: aliceLentAmount } = await E(
    aliceLoanSeat,
  ).getFinalAllocation();
  const aliceLoanProceeds = await E(aliceLoanSeat).getPayouts();
  t.deepEqual(aliceLentAmount, aliceLoanAmount, 'received 5000 Minted');
  trace(t, 'alice vault');

  const aliceRunLent = await aliceLoanProceeds.Minted;
  t.truthy(
    AmountMath.isEqual(
      await E(run.issuer).getAmountOf(aliceRunLent),
      aliceLoanAmount,
    ),
  );

  let aliceUpdate = await E(aliceNotifier).getUpdateSince();
  t.deepEqual(aliceUpdate.value.debtSnapshot.debt, aliceRunDebtLevel);

  let totalDebt = 5250n;
  await aethVaultMetrics.assertChange({
    numActiveVaults: 1,
    totalCollateral: { value: 1000n },
    totalDebt: { value: totalDebt },
  });

  // reduce collateral  /////////////////////////////////////

  trace(t, 'alice reduce collateral');

  // Alice reduce collateral by 300. That leaves her at 700 * 10 > 1.05 * 5000.
  // Prices will drop from 10 to 7, she'll be liquidated: 700 * 7 < 1.05 * 5000.
  const collateralDecrement = aeth.make(300n);
  const aliceReduceCollateralSeat = await E(zoe).offer(
    E(aliceVault).makeAdjustBalancesInvitation(),
    harden({
      want: { Collateral: collateralDecrement },
    }),
  );
  await E(aliceReduceCollateralSeat).getOfferResult();

  trace('alice ');
  const { Collateral: aliceWithdrawnAeth } = await E(
    aliceReduceCollateralSeat,
  ).getFinalAllocation();
  const loanProceeds4 = await E(aliceReduceCollateralSeat).getPayouts();
  t.deepEqual(aliceWithdrawnAeth, aeth.make(300n));

  const collateralWithdrawn = await loanProceeds4.Collateral;
  t.truthy(
    AmountMath.isEqual(
      await E(aeth.issuer).getAmountOf(collateralWithdrawn),
      collateralDecrement,
    ),
  );

  aliceUpdate = await E(aliceNotifier).getUpdateSince(aliceUpdate.updateCount);
  t.deepEqual(aliceUpdate.value.debtSnapshot.debt, aliceRunDebtLevel);
  trace(t, 'alice reduce collateral');
  await aethVaultMetrics.assertChange({
    totalCollateral: { value: 700n },
  });

  // @ts-expect-error mock
  await E(priceAuthority).setPrice(makeRatio(70n, run.brand, 10n, aeth.brand));
  trace(t, 'changed price to 7 RUN/Aeth');

  // A BIDDER places a BID //////////////////////////
  const bidAmount = run.make(3300n);
  const desired = aeth.make(700n);
  const bidderSeat = await bid(t, zoe, auctioneerKit, aeth, bidAmount, desired);

  const { startTime: start1, time: now1 } = await startAuctionClock(
    auctioneerKit,
    manualTimer,
  );
  let currentTime = now1;

  // expect Alice to be liquidated because her collateral is too low.
  aliceUpdate = await E(aliceNotifier).getUpdateSince(aliceUpdate.updateCount);
  trace(t, 'alice liquidating?', aliceUpdate.value.vaultState);
  t.is(aliceUpdate.value.vaultState, Phase.LIQUIDATING);

  currentTime = await setClockAndAdvanceNTimes(manualTimer, 2, start1, 2n);

  aliceUpdate = await E(aliceNotifier).getUpdateSince(aliceUpdate.updateCount);
  t.is(aliceUpdate.value.vaultState, Phase.LIQUIDATED);
  trace(t, 'alice liquidated', currentTime);
  totalDebt += 30n;
  await aethVaultMetrics.assertChange({
    numActiveVaults: 0,
    numLiquidatingVaults: 1,
    totalDebt: { value: totalDebt },
    liquidatingCollateral: { value: 700n },
    liquidatingDebt: { value: 5280n },
  });

  shortfallBalance += 2095n;
  await m.assertChange({
    shortfallBalance: { value: shortfallBalance },
  });

  await aethVaultMetrics.assertChange({
    liquidatingDebt: { value: 0n },
    liquidatingCollateral: { value: 0n },
    totalCollateral: { value: 0n },
    totalDebt: { value: 0n },
    numLiquidatingVaults: 0,
    numLiquidationsCompleted: 1,
    totalCollateralSold: { value: 700n },
    totalProceedsReceived: { value: 3185n },
    totalShortfallReceived: { value: shortfallBalance },
  });

  //  Bidder bought 800 Aeth
  await assertBidderPayout(t, bidderSeat, run, 115n, aeth, 700n);
});