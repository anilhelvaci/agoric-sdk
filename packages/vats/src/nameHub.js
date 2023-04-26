// @ts-check

import { assert } from '@agoric/assert';
import { E } from '@endo/far';
import { makePromiseKit } from '@endo/promise-kit';
import { mapIterable } from '@endo/marshal';
import { heapZone } from '@agoric/zone/heap.js';
import { makeLegacyMap, M } from '@agoric/store';

import './types.js';

const { Fail } = assert;

const KeyShape = M.string();
const PathShape = M.arrayOf(KeyShape);

const NameHubIKit = harden({
  nameHub: M.interface('NameHub', {
    lookup: M.call().rest(PathShape).returns(M.promise()),
    entries: M.call().returns(M.arrayOf(M.array())),
    values: M.call().returns(M.array()),
    keys: M.call().returns(M.arrayOf(KeyShape)),
  }),
  nameAdmin: M.interface('NameAdmin', {
    reserve: M.call(KeyShape).returns(M.promise()),
    default: M.call(KeyShape).optional(M.any(), M.remotable()).returns(M.any()),
    set: M.call(KeyShape, M.any())
      .optional(M.remotable())
      .returns(M.undefined()),
    onUpdate: M.call(M.remotable()).returns(M.undefined()),
    update: M.call(KeyShape).returns(M.undefined()),
    lookupAdmin: M.call(KeyShape).returns(M.promise()),
    delete: M.call(KeyShape).returns(M.promise()),
    readonly: M.call().returns(M.remotable()),
  }),
});

/**
 * Make two facets of a node in a name hierarchy: the nameHub
 * is read access and the nameAdmin is write access.
 *
 * @param {import('@agoric/zone').Zone} [zone]
 */
export const prepareNameHubKit = (zone = heapZone) => {
  const updated = (updateCallback, keyToRecord) => {
    if (!updateCallback) {
      return;
    }
    // XXX use nameToValue.entries() instead?
    void E(updateCallback).entries(
      harden(
        [
          ...mapIterable(keyToRecord.entries(), ([name, record]) =>
            record.promise
              ? []
              : [/** @type {[string, unknown]} */ ([name, record.value])],
          ),
        ].flat(),
      ),
    );
  };

  const init1 = () => ({
    // TODO@@@@ never mind .value here; use the durable store
    /** @typedef {Partial<PromiseRecord<unknown> & { value: unknown }>} NameRecord */
    /** @type {LegacyMap<string, NameRecord>} */
    // Legacy because a promiseKit is not a passable
    keyToRecord: makeLegacyMap('nameKey'),
    /** @type {LegacyMap<string, NameRecord>} */
    // Legacy because a promiseKit is not a passable
    keyToAdminRecord: makeLegacyMap('nameKey'),
  });
  /** @type {WeakMap<any, ReturnType<init1>>} */
  const ephemera = new WeakMap();
  const my = me => {
    if (ephemera.has(me)) {
      return ephemera.get(me) || assert.fail();
    }

    const it = init1();
    ephemera.set(me, it);
    return it;
  };

  const makeNameHub = zone.exoClassKit(
    'NameHub',
    NameHubIKit,
    () => ({
      /** @type {MapStore<string, unknown>} */
      keyToValue: zone.detached().mapStore('nameKey'),

      /** @type {undefined | { entries: (entries: [string, unknown][]) => void }} */
      updateCallback: undefined,
    }),
    {
      /** @type {NameHub} */
      nameHub: {
        async lookup(...path) {
          const { nameHub } = this.facets;
          const { keyToRecord } = my(this);
          if (path.length === 0) {
            return nameHub;
          }
          const [first, ...remaining] = path;
          const record = keyToRecord.get(first);
          /** @type {any} */
          const firstValue = record.promise || record.value;
          if (remaining.length === 0) {
            return firstValue;
          }
          return E(firstValue).lookup(...remaining);
        },
        entries() {
          const { keyToRecord } = my(this);
          return harden([
            ...mapIterable(
              keyToRecord.entries(),
              ([key, record]) =>
                /** @type {[string, ERef<unknown>]} */ ([
                  key,
                  record.promise || record.value,
                ]),
            ),
          ]);
        },
        values() {
          const { keyToRecord } = my(this);
          return [
            ...mapIterable(
              keyToRecord.values(),
              record => record.promise || record.value,
            ),
          ];
        },
        keys() {
          const { keyToRecord } = my(this);
          return harden([...keyToRecord.keys()]);
        },
      },
      /** @type {import('./types').NameAdmin} */
      nameAdmin: {
        async reserve(key) {
          const { keyToRecord, keyToAdminRecord } = my(this);
          const { keyToValue } = this.state;
          assert.typeof(key, 'string');
          if (!keyToAdminRecord.has(key)) {
            keyToAdminRecord.init(key, makePromiseKit());
          }
          if (!keyToRecord.has(key)) {
            const pk = makePromiseKit();
            keyToRecord.init(key, pk);
            pk.promise.then(
              v => keyToValue.set(key, v),
              () => {}, // ignore rejections
            );
          }
        },
        default(key, newValue, adminValue) {
          const { nameAdmin } = this.facets;
          const { keyToRecord } = my(this);
          if (keyToRecord.has(key)) {
            const record = keyToRecord.get(key);
            if (!record.promise) {
              // Already initalized.
              return /** @type {any} */ (record.value);
            }
          }
          nameAdmin.update(key, newValue, adminValue);
          return newValue;
        },
        set(key, newValue, adminValue) {
          const { nameAdmin } = this.facets;
          const { keyToRecord } = my(this);
          assert.typeof(key, 'string');
          let record;
          if (keyToRecord.has(key)) {
            record = keyToRecord.get(key);
          }
          (record && !record.promise) ||
            Fail`key ${key} is not already initialized`;
          nameAdmin.update(key, newValue, adminValue);
        },
        onUpdate(fn) {
          const { state } = this;
          if (state.updateCallback) {
            assert(!fn, 'updateCallback accidentally reassigned?');
          }
          state.updateCallback = fn;
        },
        update(key, newValue, adminValue) {
          const { keyToRecord, keyToAdminRecord } = my(this);
          const { keyToValue } = this.state;
          const { updateCallback } = this.state;

          assert.typeof(key, 'string');
          /** @type {[LegacyMap<string, NameRecord>, unknown][]} */
          const valueMapEntries = [
            [keyToAdminRecord, adminValue], // The optional admin goes in the admin record.
            [keyToRecord, newValue], // The value goes in the normal record.
          ];
          for (const [map, value] of valueMapEntries) {
            const record = harden({ value });
            if (map.has(key)) {
              const old = map.get(key);
              if (old.resolve) {
                old.resolve(value);
              }
              map.set(key, record);
            } else {
              map.init(key, record);
            }
          }
          if (keyToValue.has(key)) {
            keyToValue.set(key, newValue);
          } else {
            keyToValue.init(key, newValue);
          }
          updated(updateCallback, keyToRecord);
        },
        async lookupAdmin(...path) {
          const { nameAdmin } = this.facets;
          const { keyToAdminRecord } = my(this);

          if (path.length === 0) {
            return nameAdmin;
          }
          const [first, ...remaining] = path;
          const record = keyToAdminRecord.get(first);
          /** @type {any} */
          const firstValue = record.promise || record.value;
          if (remaining.length === 0) {
            return firstValue;
          }
          return E(firstValue).lookupAdmin(...remaining);
        },
        async delete(key) {
          const { keyToRecord, keyToAdminRecord } = my(this);
          const { keyToValue, updateCallback } = this.state;
          for (const map of [keyToAdminRecord, keyToRecord]) {
            if (map.has(key)) {
              // Reject only if already exists.
              const old = map.get(key);
              if (old.reject) {
                old.reject(Error(`Value has been deleted`));
                // Silence unhandled rejections.
                if (old.promise) {
                  void old.promise.catch(_ => {});
                }
              }
            }
          }
          if (keyToValue.has(key)) {
            keyToValue.delete(key);
          }
          try {
            // This delete may throw.  Reflect it to callers.
            keyToRecord.delete(key);
          } finally {
            keyToAdminRecord.delete(key);
            updated(updateCallback, keyToRecord);
          }
        },
        readonly() {
          const { nameHub } = this.facets;
          return nameHub;
        },
      },
    },
  );

  return makeNameHub;
};

/**
 * Make two facets of a node in a name hierarchy: the nameHub
 * is read access and the nameAdmin is write access.
 *
 * @param {import('@agoric/zone').Zone} [zone]
 * @returns {import('./types.js').NameHubKit}
 */
export const makeNameHubKit = prepareNameHubKit();
