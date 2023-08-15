// @ts-check
/* global process */
import { normalizeBech32 } from '@cosmjs/encoding';
import { execFileSync as execFileSyncAmbient } from 'child_process';

const agdBinary = 'agd';

/**
 * @param {string} literalOrName
 * @param {{ keyringBackend?: string }} opts
 * @param {{ execFileSync: typeof execFileSyncAmbient }} [io]
 */
export const normalizeAddressWithOptions = (
  literalOrName,
  { keyringBackend = undefined } = {},
  io = { execFileSync: execFileSyncAmbient },
) => {
  try {
    return normalizeBech32(literalOrName);
  } catch (_) {
    // not an address so try as a key
    const backendOpt = keyringBackend
      ? [`--keyring-backend=${keyringBackend}`]
      : [];
    const buff = io.execFileSync(agdBinary, [
      `keys`,
      ...backendOpt,
      `show`,
      `--address`,
      literalOrName,
    ]);
    return normalizeBech32(buff.toString().trim());
  }
};
harden(normalizeAddressWithOptions);

/**
 * @param {ReadonlyArray<string>} swingsetArgs
 * @param {import('./rpc').MinimalNetworkConfig & {
 *   from: string,
 *   dryRun?: boolean,
 *   verbose?: boolean,
 *   keyring?: {home?: string, backend: string}
 *   stdout?: Pick<import('stream').Writable, 'write'>
 *   execFileSync?: typeof import('child_process').execFileSync
 * }} opts
 */
export const execSwingsetTransaction = (swingsetArgs, opts) => {
  const {
    from,
    dryRun = false,
    verbose = true,
    keyring = undefined,
    chainName,
    rpcAddrs,
    stdout = process.stdout,
    execFileSync = execFileSyncAmbient,
  } = opts;
  const homeOpt = keyring?.home ? [`--home=${keyring.home}`] : [];
  const backendOpt = keyring?.backend
    ? [`--keyring-backend=${keyring.backend}`]
    : [];
  const cmd = [`--node=${rpcAddrs[0]}`, `--chain-id=${chainName}`].concat(
    homeOpt,
    backendOpt,
    [`--from=${from}`, 'tx', 'swingset'],
    swingsetArgs,
  );

  if (dryRun) {
    stdout.write(`Run this interactive command in shell:\n\n`);
    stdout.write(`${agdBinary} `);
    stdout.write(cmd.join(' '));
    stdout.write('\n');
  } else {
    const yesCmd = cmd.concat(['--yes']);
    if (verbose) console.log('Executing ', yesCmd);
    return execFileSync(agdBinary, yesCmd, { encoding: 'utf-8' });
  }
};
harden(execSwingsetTransaction);

// xxx rpc should be able to query this by HTTP without shelling out
export const fetchSwingsetParams = net => {
  const { chainName, rpcAddrs, execFileSync = execFileSyncAmbient } = net;
  const cmd = [
    `--node=${rpcAddrs[0]}`,
    `--chain-id=${chainName}`,
    'query',
    'swingset',
    'params',
    '--output',
    '--json',
  ];
  const buffer = execFileSync(agdBinary, cmd);
  return JSON.parse(buffer.toString());
};
harden(fetchSwingsetParams);

/**
 * @param {import('./rpc').MinimalNetworkConfig & {
 *   execFileSync: typeof import('child_process').execFileSync,
 *   delay: (ms: number) => Promise<void>,
 *   period?: number,
 *   retryMessage?: string,
 * }} opts
 * @returns {<T>(l: (b: { time: string, height: string }) => Promise<T>) => Promise<T>}
 */
export const pollBlocks = opts => async lookup => {
  const { execFileSync, delay, rpcAddrs, period = 3 * 1000 } = opts;
  const { retryMessage } = opts;

  const nodeArgs = [`--node=${rpcAddrs[0]}`];

  await null; // separate sync prologue

  for (;;) {
    const sTxt = execFileSync(agdBinary, ['status', ...nodeArgs]);
    const status = JSON.parse(sTxt.toString());
    const {
      SyncInfo: { latest_block_time: time, latest_block_height: height },
    } = status;
    try {
      // see await null above
      const result = await lookup({ time, height });
      return result;
    } catch (_err) {
      console.error(
        time,
        retryMessage || 'not in block',
        height,
        'retrying...',
      );
      await delay(period);
    }
  }
};

/**
 * @param {string} txhash
 * @param {import('./rpc').MinimalNetworkConfig & {
 *   execFileSync: typeof import('child_process').execFileSync,
 *   delay: (ms: number) => Promise<void>,
 *   period?: number,
 * }} opts
 */
export const pollTx = async (txhash, opts) => {
  const { execFileSync, rpcAddrs, chainName } = opts;

  const nodeArgs = [`--node=${rpcAddrs[0]}`];
  const outJson = ['--output', 'json'];

  const lookup = async () => {
    const out = execFileSync(
      agdBinary,
      [
        'query',
        'tx',
        txhash,
        `--chain-id=${chainName}`,
        ...nodeArgs,
        ...outJson,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    // XXX this type is defined in a .proto file somewhere
    /** @type {{ height: string, txhash: string, code: number, timestamp: string }} */
    const info = JSON.parse(out.toString());
    return info;
  };
  return pollBlocks({ ...opts, retryMessage: 'tx not in block' })(lookup);
};
