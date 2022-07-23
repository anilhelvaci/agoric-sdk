// @ts-check

import { Nat } from '@agoric/nat';
import { assert, details as X } from '@agoric/assert';
import { Far, passStyleOf } from '@endo/marshal';
import { makeNotifierFromAsyncIterable } from '@agoric/notifier';
import { makePromiseKit } from '@endo/promise-kit';
import { fit } from '@agoric/store';

import { makeTimedIterable } from './timed-iteration.js';
import { AbsoluteTimeishShape, DurationishShape } from './typeGuards.js';
import { TimeMath } from './timeMath.js';

export function buildRootObject(vatPowers) {
  const { D } = vatPowers;
  const repeaters = new Map();

  async function createTimerService(timerNode) {
    /** @type {TimerService} */
    const timerService = Far('timerService', {
      getCurrentTimestamp() {
        return Nat(D(timerNode).getLastPolled());
      },
      setWakeup(baseTime, handler) {
        fit(baseTime, AbsoluteTimeishShape);
        assert(passStyleOf(handler) === 'remotable', 'bad setWakeup() handler');
        return D(timerNode).setWakeup(baseTime, handler);
      },
      // can be used after setWakeup(h) or schedule(h)
      removeWakeup(handler) {
        assert(
          passStyleOf(handler) === 'remotable',
          'bad removeWakeup() handler',
        );
        return D(timerNode).removeWakeup(handler);
      },
      makeRepeater(delay, interval) {
        fit(delay, DurationishShape);
        fit(interval, DurationishShape);
        assert(
          TimeMath.relativeTimeValue(interval) > 0,
          X`makeRepeater's second parameter must be a positive integer: ${interval}`,
        );

        const index = D(timerNode).makeRepeater(delay, interval);

        const vatRepeater = Far('vatRepeater', {
          schedule(h) {
            return D(timerNode).schedule(index, h);
          },
          disable() {
            repeaters.delete(index);
            return D(timerNode).deleteRepeater(index);
          },
        });
        repeaters.set(index, vatRepeater);
        return vatRepeater;
      },
      makeNotifier(delay, interval) {
        fit(delay, DurationishShape);
        fit(interval, DurationishShape);
        assert(
          TimeMath.relativeTimeValue(interval) > 0,
          X`makeNotifier's second parameter must be a positive integer: ${interval}`,
        );

        // Find when the first notification will fire.
        const baseTime = TimeMath.addAbsRel(
          TimeMath.addAbsRel(timerService.getCurrentTimestamp(), delay),
          interval,
        );

        const iterable = makeTimedIterable(
          timerService.delay,
          timerService.getCurrentTimestamp,
          baseTime,
          interval,
        );

        const notifier = makeNotifierFromAsyncIterable(iterable);

        return notifier;
      },
      delay(delay) {
        fit(delay, DurationishShape);
        const now = timerService.getCurrentTimestamp();
        const baseTime = TimeMath.addAbsRel(now, delay);
        const promiseKit = makePromiseKit();
        const delayHandler = Far('delayHandler', {
          wake: promiseKit.resolve,
        });
        timerService.setWakeup(baseTime, delayHandler);
        return promiseKit.promise;
      },
    });
    return timerService;
  }

  return Far('root', { createTimerService });
}
