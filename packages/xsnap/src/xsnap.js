/* global process */
/* eslint no-await-in-loop: ["off"] */

/**
 * @typedef {typeof import('child_process').spawn} Spawn
 * @typedef {import('stream').Writable} Writable
 */

/**
 * @template T
 * @typedef {import('./defer').Deferred<T>} Deferred
 */

import { finished } from 'stream/promises';
import { PassThrough, Readable } from 'stream';
import { promisify } from 'util';
import { makeNetstringReader, makeNetstringWriter } from '@endo/netstring';
import { makeNodeReader, makeNodeWriter } from '@endo/stream-node';
import { makePromiseKit, racePromises } from '@endo/promise-kit';
import { forever } from '@agoric/internal';
import { ErrorCode, ErrorSignal, ErrorMessage, METER_TYPE } from '../api.js';
import { defer } from './defer.js';

const { Fail, quote: q } = assert;

// This will need adjustment, but seems to be fine for a start.
export const DEFAULT_CRANK_METERING_LIMIT = 1e8;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const COMMAND_BUF = encoder.encode('?');
const QUERY = '?'.charCodeAt(0);
const QUERY_RESPONSE_BUF = encoder.encode('/');
const OK = '.'.charCodeAt(0);
const ERROR = '!'.charCodeAt(0);

const OK_SEPARATOR = 1;

const SNAPSHOT_SAVE_FD = 7;
const SNAPSHOT_LOAD_FD = 8;

const { freeze } = Object;

const noop = freeze(() => {});

/**
 * @param {Uint8Array} arg
 * @returns {Uint8Array}
 */
function echoCommand(arg) {
  return arg;
}

const safeHintFromDescription = description =>
  description.replaceAll(/[^a-zA-Z0-9_.-]/g, '-');

/**
 * @param {XSnapOptions} options
 *
 * @typedef {object} XSnapOptions
 * @property {string} os
 * @property {Spawn} spawn
 * @property {Pick<typeof import('fs/promises'), 'open' | 'stat' | 'unlink'> & Pick<typeof import('fs'), 'createReadStream'> & Pick<typeof import('tmp'), 'tmpName'>} fs
 * @property {(request:Uint8Array) => Promise<Uint8Array>} [handleCommand]
 * @property {string} [name]
 * @property {boolean} [debug]
 * @property {number} [netstringMaxChunkSize] in bytes (must be an integer)
 * @property {number} [parserBufferSize] in kB (must be an integer)
 * @property {AsyncIterable<Uint8Array>} [snapshotStream]
 * @property {string} [snapshotDescription]
 * @property {boolean} [snapshotUseFs]
 * @property {'ignore' | 'inherit'} [stdout]
 * @property {'ignore' | 'inherit'} [stderr]
 * @property {number} [meteringLimit]
 * @property {Record<string, string>} [env]
 */
export async function xsnap(options) {
  const {
    os,
    spawn,
    fs,
    name = '<unnamed xsnap worker>',
    handleCommand = echoCommand,
    debug = false,
    netstringMaxChunkSize = undefined,
    parserBufferSize = undefined,
    snapshotStream,
    snapshotDescription = snapshotStream && 'unknown',
    snapshotUseFs = false,
    stdout = 'ignore',
    stderr = 'ignore',
    meteringLimit = DEFAULT_CRANK_METERING_LIMIT,
    env = process.env,
  } = options;

  const platform = {
    Linux: 'lin',
    Darwin: 'mac',
    Windows_NT: 'win',
  }[os];

  if (platform === undefined) {
    throw Error(`xsnap does not support platform ${os}`);
  }

  /** @type {(opts: import('tmp').TmpNameOptions) => Promise<string>} */
  const ptmpName = fs.tmpName && promisify(fs.tmpName);

  const makeLoadSnapshotHandlerWithFS = async () => {
    assert(snapshotStream);
    const snapPath = await ptmpName({
      template: `load-snapshot-${safeHintFromDescription(
        snapshotDescription,
      )}-XXXXXX.xss`,
    });

    const afterSpawn = async () => {};
    const cleanup = async () => fs.unlink(snapPath);

    try {
      const tmpSnap = await fs.open(snapPath, 'w');
      await tmpSnap.writeFile(
        // @ts-expect-error incorrect typings, does support AsyncIterable
        snapshotStream,
      );
      await tmpSnap.close();
    } catch (e) {
      await cleanup();
      throw e;
    }

    return harden({
      snapPath,
      afterSpawn,
      cleanup,
    });
  };

  const makeLoadSnapshotHandlerWithPipe = async () => {
    let done = Promise.resolve();

    const cleanup = async () => done;

    /** @param {Writable} loadSnapshotsStream */
    const afterSpawn = async loadSnapshotsStream => {
      assert(snapshotStream);
      const destStream = loadSnapshotsStream;

      const sourceStream = Readable.from(snapshotStream);
      sourceStream.pipe(destStream, { end: false });

      done = finished(sourceStream);
      done.catch(noop).then(() => sourceStream.unpipe(destStream));
    };

    return harden({
      snapPath: `@${SNAPSHOT_LOAD_FD}:${safeHintFromDescription(
        snapshotDescription,
      )}`,
      afterSpawn,
      cleanup,
    });
  };

  let bin = new URL(
    `../xsnap-native/xsnap/build/bin/${platform}/${
      debug ? 'debug' : 'release'
    }/xsnap-worker`,
    import.meta.url,
  ).pathname;

  /** @type {Deferred<void>} */
  const vatExit = defer();

  assert(!/^-/.test(name), `name '${name}' cannot start with hyphen`);

  let loadSnapshotHandler = await (snapshotStream &&
    (snapshotUseFs
      ? makeLoadSnapshotHandlerWithFS
      : makeLoadSnapshotHandlerWithPipe)());

  let args = [name];

  if (loadSnapshotHandler) {
    args.push('-r', loadSnapshotHandler.snapPath);
  }

  if (meteringLimit) {
    args.push('-l', `${meteringLimit}`);
  }
  if (parserBufferSize) {
    args.push('-s', `${parserBufferSize}`);
  }

  if (env.XSNAP_DEBUG_RR) {
    args = [bin, ...args];
    bin = 'rr';
    console.log('XSNAP_DEBUG_RR', { bin, args });
  }
  const xsnapProcess = spawn(bin, args, {
    stdio: [
      'ignore', // 0: stdin
      stdout, // 1: stdout
      stderr, // 2: stderr
      'pipe', // 3: messagesToXsnap
      'pipe', // 4: messagesFromXsnap
      'ignore', // 5: XSBug
      'ignore', // 6: XSProfiler
      snapshotUseFs ? 'ignore' : 'pipe', // 7: snapshotSaveStream
      snapshotUseFs || !snapshotStream ? 'ignore' : 'pipe', // 8: snapshotLoadStream
    ],
  });

  xsnapProcess.once('exit', (code, signal) => {
    if (code === 0) {
      vatExit.resolve();
    } else if (signal !== null) {
      const reason = new ErrorSignal(
        signal,
        `${name} exited due to signal ${signal}`,
      );
      vatExit.reject(reason);
    } else if (code === null) {
      throw TypeError('null code???');
    } else {
      const reason = new ErrorCode(
        code,
        `${name} exited: ${ErrorMessage[code] || 'unknown error'}`,
      );
      vatExit.reject(reason);
    }
  });

  const vatCancelled = vatExit.promise.then(() => {
    throw Error(`${name} exited`);
  });

  const xsnapProcessStdio =
    /** @type {[undefined, Readable, Readable, Writable, Readable, undefined, undefined, Readable, Writable]} */ (
      /** @type {(Readable | Writable | undefined | null)[]} */ (
        xsnapProcess.stdio
      )
    );

  const messagesToXsnap = makeNetstringWriter(
    makeNodeWriter(xsnapProcessStdio[3]),
  );
  const messagesFromXsnap = makeNetstringReader(
    makeNodeReader(xsnapProcessStdio[4]),
    { maxMessageLength: netstringMaxChunkSize },
  );

  const snapshotSaveStream = xsnapProcessStdio[SNAPSHOT_SAVE_FD];
  const snapshotLoadStream = xsnapProcessStdio[SNAPSHOT_LOAD_FD];

  await loadSnapshotHandler?.afterSpawn(snapshotLoadStream);

  if (loadSnapshotHandler) {
    vatExit.promise.catch(noop).then(() => {
      if (loadSnapshotHandler) {
        const { cleanup } = loadSnapshotHandler;
        loadSnapshotHandler = undefined;
        return cleanup();
      }
    });
  }

  /** @type {Promise<void>} */
  let baton = Promise.resolve();

  /**
   * @template T
   * @typedef {object} RunResult
   * @property {T} reply
   * @property {{ meterType: string, allocate: number|null, compute: number|null, timestamps: number[]|null }} meterUsage
   */

  /**
   * @returns {Promise<RunResult<Uint8Array>>}
   */
  async function runToIdle() {
    for await (const _ of forever) {
      const iteration = await messagesFromXsnap.next(undefined);
      if (loadSnapshotHandler) {
        const { cleanup } = loadSnapshotHandler;
        loadSnapshotHandler = undefined;
        await cleanup();
      }
      if (iteration.done) {
        xsnapProcess.kill();
        return vatCancelled;
      }
      const { value: message } = iteration;
      if (message.byteLength === 0) {
        // A protocol error kills the xsnap child process and breaks the baton
        // chain with a terminal error.
        xsnapProcess.kill();
        throw Error('xsnap protocol error: received empty message');
      } else if (message[0] === OK) {
        let meterInfo = { compute: null, allocate: null, timestamps: [] };
        const meterSeparator = message.indexOf(OK_SEPARATOR, 1);
        if (meterSeparator >= 0) {
          // The message is `.meterdata\1reply`.
          const meterData = message.subarray(1, meterSeparator);
          // We parse the meter data as JSON
          meterInfo = JSON.parse(decoder.decode(meterData));
          // assert(typeof meterInfo === 'object');
        }
        const meterUsage = {
          meterType: METER_TYPE,
          ...meterInfo,
        };
        // console.log('have meterUsage', meterUsage);
        return {
          reply: message.subarray(meterSeparator < 0 ? 1 : meterSeparator + 1),
          meterUsage,
        };
      } else if (message[0] === ERROR) {
        throw Error(
          `Uncaught exception in ${name}: ${decoder.decode(
            message.subarray(1),
          )}`,
        );
      } else if (message[0] === QUERY) {
        const commandResult = await handleCommand(message.subarray(1));
        await messagesToXsnap.next([QUERY_RESPONSE_BUF, commandResult]);
      } else {
        // unrecognized responses also kill the process
        xsnapProcess.kill();
        const m = decoder.decode(message);
        throw Error(`xsnap protocol error: received unknown message <<${m}>>`);
      }
    }
    throw Error(`unreachable, but tools don't know that`);
  }

  /**
   * @param {string} code
   * @returns {Promise<RunResult<Uint8Array>>}
   */
  async function evaluate(code) {
    const result = baton.then(async () => {
      await messagesToXsnap.next(encoder.encode(`e${code}`));
      return runToIdle();
    });
    baton = result.then(noop, noop);
    return racePromises([vatCancelled, result]);
  }

  /**
   * @param {string} fileName
   * @returns {Promise<void>}
   */
  async function execute(fileName) {
    const result = baton.then(async () => {
      await messagesToXsnap.next(encoder.encode(`s${fileName}`));
      await runToIdle();
    });
    baton = result.then(noop, noop);
    return racePromises([vatCancelled, result]);
  }

  /**
   * @param {string} fileName
   * @returns {Promise<void>}
   */
  async function importModule(fileName) {
    const result = baton.then(async () => {
      await messagesToXsnap.next(encoder.encode(`m${fileName}`));
      await runToIdle();
    });
    baton = result.then(noop, noop);
    return racePromises([vatCancelled, result]);
  }

  /**
   * @returns {Promise<void>}
   */
  async function isReady() {
    const result = baton.then(async () => {
      await messagesToXsnap.next(encoder.encode(`R`));
      await runToIdle();
    });
    baton = result.then(noop, noop);
    return racePromises([vatCancelled, result]);
  }

  /**
   * @param {Uint8Array} message
   * @returns {Promise<RunResult<Uint8Array>>}
   */
  async function issueCommand(message) {
    const result = baton.then(async () => {
      await messagesToXsnap.next([COMMAND_BUF, message]);
      return runToIdle();
    });
    baton = result.then(noop, noop);
    return racePromises([vatCancelled, result]);
  }

  /**
   * @param {string} message
   * @returns {Promise<RunResult<string>>}
   */
  async function issueStringCommand(message) {
    const result = await issueCommand(encoder.encode(message));
    return { ...result, reply: decoder.decode(result.reply) };
  }

  /**
   * @param {string} description
   * @param {import('@endo/promise-kit').PromiseKit<void>} batonKit
   * @returns {AsyncGenerator<Uint8Array, void, undefined>}
   */
  async function* makeSnapshotInternal(description, batonKit) {
    const output = new PassThrough({ highWaterMark: 1024 * 1024 });
    let piped = false;
    let cleaned = false;
    let done = Promise.resolve();

    let snapshotReadSize = 0;
    /** @type {number | undefined} */
    let snapshotSize;
    try {
      /** @type {string} */
      let snapPath;
      /** @type {Readable} */
      let sourceStream;

      const maybePipe = () => {
        if (!piped && !cleaned) {
          sourceStream.pipe(output);
          piped = true;
        }
      };

      if (snapshotUseFs) {
        // TODO: Refactor to use tmpFile rather than tmpName.
        snapPath = await ptmpName({
          template: `make-snapshot-${safeHintFromDescription(
            description,
          )}-XXXXXX.xss`,
        });

        // For similarity with the pipe mode, we want to have a `sourceStream`
        // available right away. However in FS mode, the temporary file will
        // only be populated and ready to read after the command to xsnap
        // returns.
        // To work around this we create a file in `w+` mode first, create a
        // readable stream immediately, then instruct xsnap to write into the
        // same file (which it does with wb mode, re-truncating the file), and
        // then wait for the command response to pipe the file stream into the
        // output, causing the file read to begin.

        const handle = await fs.open(snapPath, 'w+');
        // @ts-expect-error 'close' event added in Node 15.4
        handle.on('close', () => {
          fs.unlink(snapPath);
        });
        sourceStream = handle.createReadStream();
        finished(output).finally(() => sourceStream.destroy());
      } else {
        sourceStream = snapshotSaveStream;
        snapPath = `@${SNAPSHOT_SAVE_FD}`;

        // It's only safe to hook the shared save stream once we get the baton,
        // ensuring that any previous save stream usage has ended. However we
        // must start the flow before receiving the command's response or the
        // xsnap process would block on a full pipe, causing an IPC deadlock.
        batonKit.promise.then(maybePipe);
      }

      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        sourceStream.unpipe(output);
        // eslint-disable-next-line no-use-before-define
        output.off('data', onData);
        output.end();
      };
      const checkDone = () => {
        if (snapshotSize !== undefined && snapshotReadSize >= snapshotSize) {
          cleanup();
        }
      };
      const onData = chunk => {
        snapshotReadSize += chunk.length;
        checkDone();
      };
      output.on('data', onData);

      const result = batonKit.promise.then(async () => {
        // Tell xsnap to write the snapshot to the FS or the pipe
        await messagesToXsnap.next(encoder.encode(`w${snapPath}`));
        const { reply } = await runToIdle();
        const lengthStr = decoder.decode(reply);
        if (lengthStr.length) {
          snapshotSize = Number(lengthStr);
          // The snapshot was written successfully, start piping to the
          // output in FS mode
          maybePipe();
        } else {
          // This will cause the `finally` clause to throw, and inform any
          // stream consumer any data seen so far is invalid
          snapshotSize = -1;
        }
        checkDone();
      });
      batonKit.resolve(result);
      done = racePromises([vatCancelled, result]);
      done.catch(() => cleanup());

      yield* output;
    } finally {
      await done;
      (piped && snapshotReadSize === snapshotSize) ||
        Fail`Snapshot size does not match. saved=${q(snapshotSize)}, read=${q(
          snapshotReadSize,
        )}`;
    }
  }

  /**
   * @param {string} [description]
   * @returns {AsyncGenerator<Uint8Array, void, undefined>}
   */
  function makeSnapshotStream(description = 'unknown') {
    const { promise: internalResult, ...batonKitResolvers } = makePromiseKit();
    const batonKit = { promise: baton, ...batonKitResolvers };
    baton = internalResult.then(noop, noop);

    return makeSnapshotInternal(description, batonKit);
  }

  /**
   * @returns {Promise<void>}
   */
  async function close() {
    baton = baton.then(async () => {
      const running = await racePromises([
        vatExit.promise.then(() => false),
        Promise.resolve(true),
      ]);
      await (running && messagesToXsnap.next(encoder.encode(`q`)));
      await messagesToXsnap.return(undefined);
      throw Error(`${name} closed`);
    });
    baton.catch(noop); // Suppress Node.js unhandled exception warning.
    return vatExit.promise;
  }

  /**
   * @returns {Promise<void>}
   */
  async function terminate() {
    xsnapProcess.kill();
    baton = Promise.reject(Error(`${name} terminated`));
    baton.catch(noop); // Suppress Node.js unhandled exception warning.
    // Mute the vatExit exception: it is expected.
    return vatExit.promise.catch(noop);
  }

  return freeze({
    name,
    issueCommand,
    issueStringCommand,
    isReady,
    close,
    terminate,
    evaluate,
    execute,
    import: importModule,
    makeSnapshotStream,
  });
}
