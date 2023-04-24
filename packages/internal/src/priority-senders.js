import { E, Far } from '@endo/far';

const { Fail, quote: q } = assert;

const PRIORITY_SENDERS_NAMESPACE_RE = /^[a-zA-Z0-9_-]{1,50}$/;

const assertNormalizedNamespace = namespace => {
  if (!namespace.match(PRIORITY_SENDERS_NAMESPACE_RE)) {
    throw Fail`invalid namespace ${q(namespace)}`;
  }
};

/** @type {(namespace: string) => string} */
export const normalizeSenderNamespace = namespace => {
  const candidate = namespace.replace(/[ ,()]/g, '_');
  assertNormalizedNamespace(candidate);
  return candidate;
};
harden(normalizeSenderNamespace);

/**
 * XXX lets holder manage sender list for all namespaces
 *
 * @param {ERef<import('./lib-chainStorage.js').StorageNode>} sendersNode
 */
export const makePrioritySendersManager = sendersNode => {
  /**
   * address to tuple with storage node and set of namespaces that requested priority
   *
   * @type {Map<string, readonly [node: StorageNode, namespaces: Set<string>]>}
   */
  const addressRecords = new Map();

  const refreshVstorage = (
    /** @type {import('./lib-chainStorage.js').StorageNode} */ node,
    /** @type {Set<string>} */ namespaces,
  ) => {
    return E(node).setValue(
      // if the list set is empty, the string will be '' and thus deleted from IAVL
      [...namespaces.keys()].sort().join(','),
    );
  };

  return Far('prioritySenders manager', {
    /**
     * @param {string} rawNamespace
     * @param {string} address
     * @returns {Promise<void>}
     */
    add: async (rawNamespace, address) => {
      const namespace = normalizeSenderNamespace(rawNamespace);
      // get or make record
      const record = await (async () => {
        const extant = addressRecords.get(address);
        if (extant) {
          return extant;
        }
        const node = await E(sendersNode).makeChildNode(address, {
          sequence: false,
        });
        /** @type {readonly [ node: StorageNode, namespaces: Set<string> ]} */
        const r = [node, new Set()];
        addressRecords.set(address, r);
        return r;
      })();

      const [node, namespaces] = record;
      if (namespaces.has(namespace)) {
        throw Fail`namespace ${q(namespace)} already has address ${q(address)}`;
      }
      namespaces.add(namespace);

      return refreshVstorage(node, namespaces);
    },
    /**
     * @param {string} rawNamespace
     * @param {string} address
     * @returns {Promise<void>}
     */
    remove: (rawNamespace, address) => {
      const namespace = normalizeSenderNamespace(rawNamespace);
      const record = addressRecords.get(address);
      if (!record) {
        throw Fail`address not registered: ${q(address)}`;
      }
      const [node, namespaces] = record;
      if (!namespaces.has(namespace)) {
        throw Fail`namespace ${q(namespace)} not enabled for address ${q(
          address,
        )}`;
      }

      namespaces.delete(namespace);
      if (namespaces.size === 0) {
        addressRecords.delete(address);
      }

      return refreshVstorage(node, namespaces);
    },
  });
};
harden(makePrioritySendersManager);

/** @typedef {ReturnType<typeof makePrioritySendersManager>} PrioritySendersManager */
