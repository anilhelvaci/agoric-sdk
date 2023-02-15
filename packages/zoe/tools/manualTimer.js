import { Far } from '@endo/marshal';
import { bindAllMethods } from '@agoric/internal';
import { buildManualTimer as build } from '@agoric/swingset-vat/tools/manual-timer.js';
import { TimeMath } from '@agoric/time';

import './types-ambient.js';
import './internal-types.js';

// we wrap SwingSet's buildManualTimer to accomodate the needs of
// zoe's tests

/**
 * @typedef {{
 *  timeStep?: import('@agoric/time/src/types').RelativeTime | bigint,
 *  eventLoopIteration?: () => Promise<unknown>,
 * }} ZoeManualTimerOptions
 */

const nolog = (..._args) => {};

/**
 *
 * A fake TimerService, for unit tests that do not use a real
 * kernel. You can make time pass by calling `advanceTo(when)`, or one
 * `timeStep` at a time by calling `tick()`.
 *
 * `advanceTo()` merely schedules a wakeup: the actual
 * handlers (in the code under test) are invoked several turns
 * later. Some zoe/etc tests want to poll for the consequences of
 * those invocations. The best approach is to get an appropriate
 * Promise from your code-under-test, wait for it to fire, and then
 * poll. But some libraries do not offer this convenience, especially
 * when they use internal "fire and forget" actions.
 *
 * To support those tests, the manual timer accepts a
 * `eventLoopIteration` option. If provided, each call to `tick()`
 * will wait for all triggered activity to complete before
 * returning. That doesn't mean the `wake()` handler's result promise
 * has fired; it just means there are no settled Promises still trying
 * to execute their callbacks.
 *
 * The following will wait for all such Promise activity to finish
 * before returning from `tick()`:
 *
 *  eventLoopIteration = () => new Promise(setImmediate);
 *  mt = buildManualTimer(log, startTime, { eventLoopIteration })
 *
 * `tickN(count)` calls `tick()` multiple times, awaiting each one
 *
 * The first argument is called to log 'tick' events, which might help
 * with "golden transcript" -style tests to distinguish tick
 * boundaries
 *
 * @param {(...args: any[]) => void} [log]
 * @param {import('@agoric/time/src/types').Timestamp | bigint} [startValue=0n]
 * @param {ZoeManualTimerOptions} [options]
 * @returns {ManualTimer}
 */

const buildManualTimer = (log = nolog, startValue = 0n, options = {}) => {
  const {
    timeStep = 1n,
    eventLoopIteration = () => 0,
    ...buildOptions
  } = options;

  // neither of these could possibly be a record, because the caller
  // doesn't have our brand yet, but this makes the types maximally
  // tolerant
  startValue = TimeMath.absValue(startValue);
  const timeStepValue = TimeMath.relValue(timeStep);
  assert.typeof(startValue, 'bigint');
  assert.typeof(timeStepValue, 'bigint');

  const timerService = build({ startTime: startValue, ...buildOptions });
  const toRT = rt => TimeMath.coerceRelativeTimeRecord(rt, timerService.getTimerBrand());

  const tick = msg => {
    const oldTime = timerService.getCurrentTimestamp();
    const newTime = TimeMath.addAbsRel(oldTime, toRT(timeStepValue));
    log(`@@ tick:${TimeMath.absValue(newTime)}${msg ? `: ${msg}` : ''} @@`);
    timerService.advanceTo(TimeMath.absValue(newTime));
    // that schedules wakeups, but they don't fire until a later turn
    return eventLoopIteration();
  };

  const tickN = async (nTimes, msg) => {
    assert(nTimes >= 1, 'invariant nTimes >= 1');
    for (let i = 0; i < nTimes; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await tick(msg);
    }
  };

  const setWakeup = (when, handler, cancelToken) => {
    const now = timerService.getCurrentTimestamp();
    log(`@@ schedule task for:${TimeMath.absValue(when)}, currently: ${TimeMath.absValue(now)} @@`);
    return timerService.setWakeup(when, handler, cancelToken);
  };

  return Far('ManualTimer', {
    ...bindAllMethods(timerService),
    tick,
    tickN,
    setWakeup,
  });
};
harden(buildManualTimer);

export default buildManualTimer;
