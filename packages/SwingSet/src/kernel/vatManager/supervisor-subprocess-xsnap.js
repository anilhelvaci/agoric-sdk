/* global globalThis WeakRef FinalizationRegistry */
// @ts-check
import { assert, details as X, q } from '@agoric/assert';
import { importBundle } from '@agoric/import-bundle';
import { makeMarshal } from '@agoric/marshal';
import '../../types';
// grumble... waitUntilQuiescent is exported and closes over ambient authority
import { waitUntilQuiescent } from '../../waitUntilQuiescent';
import { insistVatDeliveryObject, insistVatSyscallResult } from '../../message';

import { makeLiveSlots } from '../liveSlots';
import {
  makeSupervisorDispatch,
  makeSupervisorSyscall,
} from './supervisor-helper';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const marshal = makeMarshal(undefined, undefined, {
  // don't scare the validators with errors they don't know what to do with.
  marshalSaveError: () => {},
});

// eslint-disable-next-line no-unused-vars
function workerLog(first, ...args) {
  // eslint-disable-next-line
  // console.log(`---worker: ${first}`, ...args);
}

workerLog(`supervisor started`);

/**
 * Wrap byte-level protocols with tagged array codec.
 *
 * @param { (cmd: ArrayBuffer) => ArrayBuffer } issueCommand as from xsnap
 * @typedef { [unknown, ...unknown[]] } Tagged tagged array
 */
function managerPort(issueCommand) {
  /** @type { (item: Tagged) => ArrayBuffer } */
  const encode = item => {
    let txt;
    try {
      txt = marshal.serialize(harden(item)).body;
    } catch (nope) {
      workerLog(nope.message, item);
      throw nope;
    }
    return encoder.encode(txt).buffer;
  };

  /** @type { (msg: ArrayBuffer) => any } */
  const decodeData = msg => JSON.parse(decoder.decode(msg) || 'null');

  /** @type { (msg: ArrayBuffer) => Tagged } */
  function decode(msg) {
    /** @type { Tagged } */
    const item = decodeData(msg);
    assert(Array.isArray(item), X`expected array`);
    assert(item.length > 0, X`empty array lacks tag`);
    return item;
  }

  return harden({
    /** @type { (item: Tagged) => void } */
    send: item => {
      issueCommand(encode(item));
    },
    /** @type { (item: Tagged) => unknown } */
    call: item => decodeData(issueCommand(encode(item))),

    /**
     * Wrap an async Tagged handler in the xsnap async reporting idiom.
     *
     * @param { (item: Tagged) => Promise<Tagged> } f async Tagged handler
     * @returns { (msg: ArrayBuffer) => Report<ArrayBuffer> } xsnap style handleCommand
     *
     * @typedef { { result?: T } } Report<T> report T when idle
     * @template T
     */
    handlerFrom(f) {
      const lastResort = encoder.encode(`exception from ${f.name}`).buffer;
      return msg => {
        const report = {};
        f(decode(msg))
          .then(item => {
            workerLog('result', item);
            report.result = encode(item);
          })
          .catch(err => {
            report.result = encode(['err', err]);
          })
          .catch(_err => {
            report.result = lastResort;
          });
        return report;
      };
    },
  });
}

// please excuse copy-and-paste from kernel.js
function abbreviateReplacer(_, arg) {
  if (typeof arg === 'bigint') {
    // since testLog is only for testing, 2^53 is enough.
    // precedent: 32a1dd3
    return Number(arg);
  }
  if (typeof arg === 'string' && arg.length >= 40) {
    // truncate long strings
    return `${arg.slice(0, 15)}...${arg.slice(arg.length - 15)}`;
  }
  return arg;
}

/**
 * @param { ReturnType<typeof managerPort> } port
 */
function makeWorker(port) {
  /** @type { ((delivery: VatDeliveryObject) => Promise<VatDeliveryResult>) | null } */
  let dispatch = null;

  /**
   * TODO: consider other methods per SES VirtualConsole.
   * See https://github.com/Agoric/agoric-sdk/issues/2146
   *
   * @param { string } tag
   */
  function makeConsole(tag) {
    const log = level => (...args) => {
      const jsonSafeArgs = JSON.parse(`${q(args)}`);
      port.send(['console', level, tag, ...jsonSafeArgs]);
    };
    const cons = {
      debug: log('debug'),
      log: log('log'),
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
    };
    return harden(cons);
  }

  /**
   * @param {unknown} vatID
   * @param {unknown} bundle
   * @param {unknown} vatParameters
   * @param {unknown} virtualObjectCacheSize
   * @param {boolean} enableDisavow
   * @returns { Promise<Tagged> }
   */
  async function setBundle(
    vatID,
    bundle,
    vatParameters,
    virtualObjectCacheSize,
    enableDisavow,
  ) {
    /** @type { (vso: VatSyscallObject) => VatSyscallResult } */
    function syscallToManager(vatSyscallObject) {
      workerLog('doSyscall', vatSyscallObject);
      const result = port.call(['syscall', vatSyscallObject]);
      workerLog(' ... syscall result:', result);
      insistVatSyscallResult(result);
      return result;
    }

    const syscall = makeSupervisorSyscall(syscallToManager, true);

    const vatPowers = {
      makeMarshal,
      testLog: (...args) =>
        port.send([
          'testLog',
          ...args.map(arg =>
            typeof arg === 'string'
              ? arg
              : JSON.stringify(arg, abbreviateReplacer),
          ),
        ]),
    };

    const cacheSize =
      typeof virtualObjectCacheSize === 'number'
        ? virtualObjectCacheSize
        : undefined;

    const gcTools = harden({
      WeakRef,
      FinalizationRegistry,
      waitUntilQuiescent,
    });

    const ls = makeLiveSlots(
      syscall,
      vatID,
      vatPowers,
      vatParameters,
      cacheSize,
      enableDisavow,
      gcTools,
    );

    const endowments = {
      ...ls.vatGlobals,
      console: makeConsole(`SwingSet:vatWorker`),
      assert,
      // bootstrap provides HandledPromise
      HandledPromise: globalThis.HandledPromise,
    };
    const vatNS = await importBundle(bundle, { endowments });
    workerLog(`got vatNS:`, Object.keys(vatNS).join(','));
    ls.setBuildRootObject(vatNS.buildRootObject);
    assert(ls.dispatch);
    dispatch = makeSupervisorDispatch(ls.dispatch, waitUntilQuiescent);
    workerLog(`got dispatch`);
    return ['dispatchReady'];
  }

  /** @type { (item: Tagged) => Promise<Tagged> } */
  async function handleItem([tag, ...args]) {
    workerLog('handleItem', tag, args.length);
    switch (tag) {
      case 'setBundle': {
        assert(!dispatch, 'cannot setBundle again');
        const enableDisavow = !!args[4];
        return setBundle(args[0], args[1], args[2], args[3], enableDisavow);
      }
      case 'deliver': {
        assert(dispatch, 'cannot deliver before setBundle');
        const [vatDeliveryObject] = args;
        insistVatDeliveryObject(vatDeliveryObject);
        return dispatch(vatDeliveryObject);
      }
      default:
        workerLog('handleItem: bad tag', tag, args.length);
        return ['bad tag', tag];
    }
  }

  return harden({
    handleItem,
  });
}

// xsnap provides issueCommand global
const port = managerPort(globalThis.issueCommand);
const worker = makeWorker(port);
globalThis.handleCommand = port.handlerFrom(worker.handleItem);
