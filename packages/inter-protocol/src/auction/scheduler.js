import { E } from '@endo/eventual-send';
import { TimeMath } from '@agoric/time';
import { Far } from '@endo/marshal';
import { natSafeMath } from '@agoric/zoe/src/contractSupport/index.js';
import { makeTracer } from '@agoric/internal';
import { AuctionState } from './util.js';

const { Fail } = assert;
const { subtract, multiply, floorDivide } = natSafeMath;

const trace = makeTracer('SCHED', false);

/**
 * @file The scheduler is presumed to be quiescent between auction rounds. Each
 * Auction round consists of a sequence of steps with decreasing prices. There
 * should always be a next schedule, but between rounds, liveSchedule is null.
 *
 * The lock period that the liquidators use might start before the previous
 * round has finished, so we need to schedule the next round each time an
 * auction starts. This means if the scheduling parameters change, it'll be a
 * full cycle before we switch. Otherwise, the vaults wouldn't know when to
 * start their lock period. If the lock period for the next auction hasn't
 * started when each aucion ends, we recalculate it, in case the parameters have
 * changed.
 *
 * If the clock skips forward (because of a chain halt, for instance), the
 * scheduler will try to cleanly and quickly finish any round already in
 * progress. It would take additional work on the manual timer to test this
 * thoroughly.
 */
const makeCancelToken = () => {
  let tokenCount = 1;
  return Far(`cancelToken${(tokenCount += 1)}`, {});
};

// exported for testability.
export const computeRoundTiming = (params, baseTime) => {
  // currently a TimeValue; hopefully a TimeRecord soon
  /** @type {RelativeTime} */
  const freq = params.getStartFrequency();
  /** @type {RelativeTime} */
  const clockStep = params.getClockStep();
  /** @type {NatValue} */
  const startingRate = params.getStartingRate();
  /** @type {NatValue} */
  const discountStep = params.getDiscountStep();
  /** @type {RelativeTime} */
  const lockPeriod = params.getPriceLockPeriod();
  /** @type {NatValue} */
  const lowestRate = params.getLowestRate();

  /** @type {RelativeTime} */
  const startDelay = params.getAuctionStartDelay();
  TimeMath.compareRel(freq, startDelay) > 0 ||
    Fail`startFrequency must exceed startDelay, ${freq}, ${startDelay}`;
  TimeMath.compareRel(freq, lockPeriod) > 0 ||
    Fail`startFrequency must exceed lock period, ${freq}, ${lockPeriod}`;

  startingRate > lowestRate ||
    Fail`startingRate ${startingRate} must be more than lowest: ${lowestRate}`;
  const rateChange = subtract(startingRate, lowestRate);
  const requestedSteps = floorDivide(rateChange, discountStep);
  requestedSteps > 0n ||
    Fail`discountStep ${discountStep} too large for requested rates`;
  TimeMath.compareRel(freq, clockStep) >= 0 ||
    Fail`clockStep ${TimeMath.relValue(
      clockStep,
    )} must be shorter than startFrequency ${TimeMath.relValue(
      freq,
    )} to allow at least one step down`;

  const requestedDuration = TimeMath.multiplyRelNat(clockStep, requestedSteps);
  const targetDuration =
    TimeMath.compareRel(requestedDuration, freq) < 0
      ? requestedDuration
      : TimeMath.subtractRelRel(freq, TimeMath.toRel(1n));
  const steps = TimeMath.divideRelRel(targetDuration, clockStep);
  const duration = TimeMath.multiplyRelNat(clockStep, steps);

  steps > 0n ||
    Fail`clockStep ${clockStep} too long for auction duration ${duration}`;
  const endRate = subtract(startingRate, multiply(steps, discountStep));

  const actualDuration = TimeMath.multiplyRelNat(clockStep, steps);
  // computed start is baseTime + freq - (now mod freq). if there are hourly
  // starts, we add an hour to the current time, and subtract now mod freq.
  // Then we add the delay
  const startTime = TimeMath.addAbsRel(
    TimeMath.addAbsRel(
      baseTime,
      TimeMath.subtractRelRel(freq, TimeMath.modAbsRel(baseTime, freq)),
    ),
    startDelay,
  );
  const endTime = TimeMath.addAbsRel(startTime, actualDuration);
  const lockTime = TimeMath.subtractAbsRel(startTime, lockPeriod);

  const next = {
    startTime,
    endTime,
    steps,
    endRate,
    startDelay,
    clockStep,
    lockTime,
  };
  return harden(next);
};

/**
 * @typedef {object} AuctionDriver
 * @property {() => void} reducePriceAndTrade
 * @property {() => void} finalize
 * @property {() => void} startRound
 */

/**
 * @param {AuctionDriver} auctionDriver
 * @param {import('@agoric/time/src/types').TimerService} timer
 * @param {Awaited<import('./params.js').AuctionParamManaager>} params
 * @param {import('@agoric/time/src/types').TimerBrand} timerBrand
 */
export const makeScheduler = async (
  auctionDriver,
  timer,
  params,
  timerBrand,
) => {
  // live version is non-null when an auction is active.
  let liveSchedule;
  // Next should always be defined after initialization unless it's paused
  let nextSchedule;
  const stepCancelToken = makeCancelToken();

  /** @type {typeof AuctionState[keyof typeof AuctionState]} */
  let auctionState = AuctionState.WAITING;

  /**
   * @param {import("@agoric/time/src/types").Timestamp} time
   * @param {Schedule | undefined} schedule
   */
  const clockTick = (time, schedule) => {
    trace('clockTick', schedule?.startTime, time);
    if (schedule && TimeMath.compareAbs(time, schedule.startTime) >= 0) {
      if (auctionState !== AuctionState.ACTIVE) {
        auctionState = AuctionState.ACTIVE;
        auctionDriver.startRound();
      } else {
        auctionDriver.reducePriceAndTrade();
      }
    }

    if (schedule && TimeMath.compareAbs(time, schedule.endTime) >= 0) {
      trace('LastStep', time);
      auctionState = AuctionState.WAITING;

      auctionDriver.finalize();

      // only recalculate the next schedule at this point if the lock time has
      // not been reached.
      const nextLock = nextSchedule.lockTime;
      if (nextLock && TimeMath.compareAbs(time, nextLock) < 0) {
        const afterNow = TimeMath.addAbsRel(
          time,
          TimeMath.toRel(1n, timerBrand),
        );
        nextSchedule = computeRoundTiming(params, afterNow);
      }
      liveSchedule = undefined;

      void E(timer).cancel(stepCancelToken);
    }
  };

  const scheduleRound = time => {
    trace('nextRound', time);
    if (!liveSchedule) throw Fail`liveSchedule not defined`;
    assert(liveSchedule);

    const { startTime } = liveSchedule;
    trace('START ', startTime);

    const startDelay =
      TimeMath.compareAbs(startTime, time) > 0
        ? TimeMath.subtractAbsAbs(startTime, time)
        : TimeMath.subtractAbsAbs(startTime, startTime);

    void E(timer).repeatAfter(
      startDelay,
      liveSchedule.clockStep,
      Far('SchedulerWaker', {
        wake(t) {
          clockTick(t, liveSchedule);
        },
      }),
      stepCancelToken,
    );
  };

  const scheduleNextRound = start => {
    trace(`SCHED   nextRound`, start);
    void E(timer).setWakeup(
      start,
      Far('SchedulerWaker', {
        wake(time) {
          // eslint-disable-next-line no-use-before-define
          void startAuction(time);
        },
      }),
    );
  };

  const startAuction = async time => {
    !liveSchedule || Fail`can't start an auction round while one is active`;

    liveSchedule = nextSchedule;
    const after = TimeMath.addAbsRel(
      // @ts-expect-error guarded three lines up.
      liveSchedule.startTime,
      TimeMath.toRel(1n, timerBrand),
    );
    nextSchedule = computeRoundTiming(params, after);
    scheduleRound(time);
    scheduleNextRound(nextSchedule.startTime);
  };

  const baseNow = await E(timer).getCurrentTimestamp();
  // XXX manualTimer returns a bigint, not a timeRecord.
  const now = TimeMath.toAbs(baseNow, timerBrand);
  nextSchedule = computeRoundTiming(params, now);
  scheduleNextRound(nextSchedule.startTime);

  return Far('scheduler', {
    getSchedule: () =>
      harden({
        liveAuctionSchedule: liveSchedule,
        nextAuctionSchedule: nextSchedule,
      }),
    getAuctionState: () => auctionState,
  });
};

/**
 * @typedef {object} Schedule
 * @property {Timestamp} startTime
 * @property {Timestamp} endTime
 * @property {bigint} steps
 * @property {Ratio} endRate
 * @property {RelativeTime} startDelay
 * @property {RelativeTime} clockStep
 */

/**
 * @typedef {object} FullSchedule
 * @property {Schedule | undefined} nextAuctionSchedule
 * @property {Schedule | undefined} liveAuctionSchedule
 */
