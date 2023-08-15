// @ts-check
// @jessie-check

import { Far } from '@endo/far';
import {
  canBeDurable,
  makeScalarMapStore,
  prepareExo,
  prepareExoClass,
  prepareExoClassKit,
  provideDurableMapStore,
  provideDurableSetStore,
  provideDurableWeakMapStore,
  provideDurableWeakSetStore,
} from '@agoric/vat-data';

import {
  agoricVatDataKeys as keys,
  isPassable,
  makeOnceKit,
} from '@agoric/base-zone';

const { Fail } = assert;

/**
 * A variant of `canBeDurable` that returns `false` instead of ever throwing.
 *
 * @param {unknown} specimen
 * @returns {boolean}
 */
const isStorable = specimen => isPassable(specimen) && canBeDurable(specimen);
harden(isStorable);

/**
 * @param {() => import('@agoric/vat-data').Baggage} getBaggage
 */
const attachDurableStores = getBaggage => {
  /** @type {import('.').Zone['mapStore']} */
  const mapStore = (label, options) => {
    const baggage = getBaggage();
    const ret = provideDurableMapStore(baggage, label, options);
    return ret;
  };
  /** @type {import('.').Zone['setStore']} */
  const setStore = (label, options) =>
    provideDurableSetStore(getBaggage(), label, options);
  /** @type {import('.').Zone['weakSetStore']} */
  const weakSetStore = (label, options) =>
    provideDurableWeakSetStore(getBaggage(), label, options);
  /** @type {import('.').Zone['weakMapStore']} */
  const weakMapStore = (label, options) =>
    provideDurableWeakMapStore(getBaggage(), label, options);

  /** @type {import('.').Stores} */
  return Far('durableStores', {
    // eslint-disable-next-line no-use-before-define
    detached: () => detachedDurableStores,
    isStorable,
    mapStore,
    setStore,
    weakMapStore,
    weakSetStore,
  });
};

/** @type {import('.').Stores} */
const detachedDurableStores = attachDurableStores(() =>
  makeScalarMapStore('detached'),
);

/**
 * Create a zone whose objects persist between Agoric vat upgrades.
 *
 * @param {import('@agoric/vat-data').Baggage} baggage
 * @param {string} [baseLabel]
 * @returns {import('.').Zone}
 */
export const makeDurableZone = (baggage, baseLabel = 'durableZone') => {
  baggage || Fail`baggage required`;

  const attachedStores = attachDurableStores(() => baggage);

  const { makeOnce, wrapProvider } = makeOnceKit(
    baseLabel,
    attachedStores,
    baggage,
  );

  /** @type {import('.').Zone['exoClass']} */
  const exoClass = (...args) => prepareExoClass(baggage, ...args);
  /** @type {import('.').Zone['exoClassKit']} */
  const exoClassKit = (...args) => prepareExoClassKit(baggage, ...args);
  /** @type {import('.').Zone['exo']} */
  const exo = (...args) => prepareExo(baggage, ...args);

  const subZoneStore = wrapProvider(attachedStores.mapStore, keys.zone);

  /** @type {import('.').Zone['subZone']} */
  const subZone = (label, options = {}) => {
    const subBaggage = subZoneStore(label, options);
    return makeDurableZone(subBaggage, `${baseLabel}.${label}`);
  };

  return Far('durableZone', {
    exo: wrapProvider(exo, keys.exo),
    exoClass: wrapProvider(exoClass, keys.exoClass),
    exoClassKit: wrapProvider(exoClassKit, keys.exoClassKit),
    subZone,

    makeOnce,
    detached: attachedStores.detached,
    isStorable: attachedStores.isStorable,

    mapStore: wrapProvider(attachedStores.mapStore, keys.store),
    setStore: wrapProvider(attachedStores.setStore, keys.store),
    weakMapStore: wrapProvider(attachedStores.weakMapStore, keys.store),
    weakSetStore: wrapProvider(attachedStores.weakSetStore, keys.store),
  });
};
harden(makeDurableZone);
