// @ts-check

import { Far } from '@endo/marshal';
import { buildOwner } from '../setup.js';

// VaultFactory owner

/** @type {BuildRootObjectForTestVat} */
export const buildRootObject = vatPowers =>
  Far('root', {
    // @ts-expect-error spread not typed
    build: (...args) => buildOwner(vatPowers.testLog, ...args),
  });
