/**
 * @file Inter Protocol Liquidation Bidding CLI
 * @see {makeInterCommand} for main function
 */

// @ts-check
import { CommanderError, InvalidArgumentError } from 'commander';
// TODO: should get M from endo https://github.com/Agoric/agoric-sdk/issues/7090
import { makeBidSpecShape } from '@agoric/inter-protocol/src/auction/auctionBook.js';
import { Offers } from '@agoric/inter-protocol/src/clientSupport.js';
import { objectMap } from '@agoric/internal';
import { makeWalletStateCoalescer } from '@agoric/smart-wallet/src/utils.js';
import { M, matches } from '@agoric/store';
import { normalizeAddressWithOptions, pollBlocks } from '../lib/chain.js';
import {
  asBoardRemote,
  bigintReplacer,
  makeAmountFormatter,
} from '../lib/format.js';
import {
  boardSlottingMarshaller,
  getNetworkConfig,
  makeRpcUtils,
} from '../lib/rpc.js';
import {
  getLiveOffers,
  outputActionAndHint,
  sendAction,
} from '../lib/wallet.js';

const { values } = Object;

const bidInvitationShape = harden({
  source: 'agoricContract',
  instancePath: ['auctioneer'],
  callPipe: [['makeBidInvitation', M.any()]],
});

/** @typedef {import('@agoric/vats/tools/board-utils.js').VBankAssetDetail } AssetDescriptor */
/** @typedef {import('@agoric/smart-wallet/src/smartWallet').TryExitOfferAction } TryExitOfferAction */

/**
 * Format amounts, prices etc. based on brand board Ids, displayInfo
 *
 * @param {AssetDescriptor[]} assets
 */
const makeFormatters = assets => {
  const br = asBoardRemote;
  const fmtAmtTuple = makeAmountFormatter(assets);
  /** @param {Amount} amt */
  const amount = amt => (([l, m]) => `${m} ${l}`)(fmtAmtTuple(br(amt)));
  /** @param {Record<string, Amount> | undefined} r */
  const record = r => (r ? objectMap(r, amount) : undefined);
  /** @param {Ratio} r */
  const price = r => {
    const [nl, nm] = fmtAmtTuple(br(r.numerator));
    const [dl, dm] = fmtAmtTuple(br(r.denominator));
    return `${Number(nm) / Number(dm)} ${nl}/${dl}`;
  };
  const discount = r =>
    100 - (Number(r.numerator.value) / Number(r.denominator.value)) * 100;
  return { amount, record, price, discount };
};

/**
 * Format amounts in vaultManager metrics for JSON output.
 *
 * @param {*} metrics manager0.metrics
 * @param {*} quote manager0.quote
 * @param {*} assets agoricNames.vbankAssets
 */
const fmtMetrics = (metrics, quote, assets) => {
  const fmt = makeFormatters(assets);
  const { liquidatingCollateral, liquidatingDebt } = metrics;

  const {
    quoteAmount: {
      value: [{ amountIn, amountOut }],
    },
  } = quote;
  const price = fmt.price({ numerator: amountOut, denominator: amountIn });

  const amounts = objectMap(
    { liquidatingCollateral, liquidatingDebt },
    fmt.amount,
  );
  return { ...amounts, price };
};

/**
 * Dynamic check that an OfferStatus is also a BidSpec.
 *
 * @param {import('@agoric/smart-wallet/src/offers.js').OfferStatus} offerStatus
 * @param {Awaited<ReturnType<import('../lib/rpc').makeAgoricNames>>} agoricNames
 * @param {typeof console.warn} warn
 * returns null if offerStatus is not a BidSpec
 */
const coerceBid = (offerStatus, agoricNames, warn) => {
  const { offerArgs } = offerStatus;
  /** @type {unknown} */
  const collateralBrand = /** @type {any} */ (offerArgs)?.want?.brand;
  if (!collateralBrand) {
    warn('mal-formed bid offerArgs', offerStatus.id, offerArgs);
    return null;
  }
  const bidSpecShape = makeBidSpecShape(
    // @ts-expect-error XXX AssetKind narrowing?
    agoricNames.brand.IST,
    collateralBrand,
  );
  if (!matches(offerStatus.offerArgs, bidSpecShape)) {
    warn('mal-formed bid offerArgs', offerArgs);
    return null;
  }

  /**
   * @type {import('@agoric/smart-wallet/src/offers.js').OfferStatus &
   *        { offerArgs: import('@agoric/inter-protocol/src/auction/auctionBook.js').BidSpec}}
   */
  // @ts-expect-error dynamic cast
  const bid = offerStatus;
  return bid;
};

/**
 * Format amounts etc. in a BidSpec OfferStatus
 *
 * @param {import('@agoric/smart-wallet/src/offers.js').OfferStatus &
 *         { offerArgs: import('@agoric/inter-protocol/src/auction/auctionBook.js').BidSpec}} bid
 * @param {import('agoric/src/lib/format.js').AssetDescriptor[]} assets
 */
export const fmtBid = (bid, assets) => {
  const fmt = makeFormatters(assets);

  const { offerArgs } = bid;
  /** @type {{ price: string } | { discount: number }} */
  const spec =
    'offerPrice' in offerArgs
      ? { price: fmt.price(offerArgs.offerPrice) }
      : { discount: fmt.discount(offerArgs.offerBidScaling) };

  const {
    id,
    proposal: { give },
    offerArgs: { want },
    payouts,
    result,
    error,
  } = bid;
  const resultProp =
    !error && result && result !== 'UNPUBLISHED' ? { result } : {};
  const props = {
    ...(give ? { give: fmt.record(give) } : {}),
    ...(want ? { want: fmt.amount(want) } : {}),
    ...(payouts ? { payouts: fmt.record(payouts) } : resultProp),
    ...(error ? { error } : {}),
  };
  return harden({ id, ...spec, ...props });
};

/**
 * Make Inter Protocol liquidation bidding commands.
 *
 * @param {{
 *   env: Partial<Record<string, string>>,
 *   stdout: Pick<import('stream').Writable,'write'>,
 *   stderr: Pick<import('stream').Writable,'write'>,
 *   now: () => number,
 *   createCommand: // Note: includes access to process.stdout, .stderr, .exit
 *     typeof import('commander').createCommand,
 *   execFileSync: typeof import('child_process').execFileSync,
 *   setTimeout: typeof setTimeout,
 * }} process
 * @param {{ fetch: typeof window.fetch }} net
 */
export const makeInterCommand = async (
  {
    env,
    stdout,
    stderr,
    now,
    setTimeout,
    execFileSync: rawExec,
    createCommand,
  },
  { fetch },
) => {
  const interCmd = createCommand('inter')
    .description('Inter Protocol commands for liquidation bidding etc.')
    .option('--home <dir>', 'agd CosmosSDK application home directory')
    .option(
      '--keyring-backend [os|file|test]',
      `keyring's backend (os|file|test) (default "${
        env.AGORIC_KEYRING_BACKEND || 'os'
      }")`,
      env.AGORIC_KEYRING_BACKEND,
    );

  /** @type {typeof import('child_process').execFileSync} */
  // @ts-expect-error execFileSync is overloaded
  const execFileSync = (file, args, ...opts) => {
    try {
      return rawExec(file, args, ...opts);
    } catch (err) {
      throw new InvalidArgumentError(
        `${err.message}: is ${file} in your $PATH?`,
      );
    }
  };

  /** @param {number} ms */
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const show = (info, indent = false) =>
    stdout.write(
      `${JSON.stringify(info, bigintReplacer, indent ? 2 : undefined)}\n`,
    );

  const rpcTools = async () => {
    // XXX pass fetch to getNetworkConfig() explicitly
    const networkConfig = await getNetworkConfig(env);
    const { agoricNames, fromBoard, readLatestHead, vstorage } =
      await makeRpcUtils({ fetch }, networkConfig).catch(err => {
        throw new CommanderError(1, 'RPC_FAIL', err.message);
      });

    /**
     * @param {string} from
     * @param {number|string} [minHeight]
     */
    const storedWalletState = async (from, minHeight = undefined) => {
      const m = boardSlottingMarshaller(fromBoard.convertSlotToVal);

      const history = await vstorage.readFully(
        `published.wallet.${from}`,
        minHeight,
      );

      /** @type {{ Invitation: Brand<'set'> }} */
      // @ts-expect-error XXX how to narrow AssetKind to set?
      const { Invitation } = agoricNames.brand;
      const coalescer = makeWalletStateCoalescer(Invitation);
      // update with oldest first
      for (const txt of history.reverse()) {
        const { body, slots } = JSON.parse(txt);
        const record = m.unserialize({ body, slots });
        coalescer.update(record);
      }
      const coalesced = coalescer.state;
      harden(coalesced);
      return coalesced;
    };

    /**
     * Get OfferStatus by id, polling until available.
     *
     * @param {string} from
     * @param {string|number} id
     * @param {number|string} minHeight
     */
    const pollOffer = async (from, id, minHeight) => {
      const lookup = async () => {
        // eslint-disable-next-line @jessie.js/no-nested-await, no-await-in-loop
        const { offerStatuses } = await storedWalletState(from, minHeight);
        const offerStatus = [...offerStatuses.values()].find(s => s.id === id);
        if (!offerStatus) throw Error('retry');
        harden(offerStatus);
        return offerStatus;
      };
      const retryMessage = 'offer not in wallet at block';
      const opts = { ...networkConfig, execFileSync, delay, retryMessage };
      return pollBlocks(opts)(lookup);
    };

    return {
      networkConfig,
      agoricNames,
      fromBoard,
      vstorage,
      readLatestHead,
      storedWalletState,
      pollOffer,
    };
  };

  const liquidationCmd = interCmd
    .command('liquidation')
    .description('liquidation commands');
  liquidationCmd
    .command('status')
    .description(
      `show amount liquidating, vault manager price

For example:

{
  "liquidatingCollateral": "10 IbcATOM",
  "liquidatingDebt": "120 IST",
  "price": "12.00 IST/IbcATOM"
}
`,
    )
    .option('--manager <number>', 'Vault Manager', Number, 0)
    .action(async opts => {
      const { agoricNames, readLatestHead } = await rpcTools();

      const [metrics, quote] = await Promise.all([
        readLatestHead(`published.vaultFactory.manager${opts.manager}.metrics`),
        readLatestHead(`published.vaultFactory.manager${opts.manager}.quotes`),
      ]);
      const info = fmtMetrics(metrics, quote, values(agoricNames.vbankAsset));
      show(info, true);
    });

  const bidCmd = interCmd
    .command('bid')
    .description('auction bidding commands');

  /**
   * @param {string} from
   * @param {import('@agoric/smart-wallet/src/offers.js').OfferSpec} offer
   * @param {Awaited<ReturnType<rpcTools>>} tools
   */
  const placeBid = async (from, offer, tools) => {
    const { networkConfig, agoricNames, pollOffer } = tools;
    const io = { ...networkConfig, execFileSync, delay, stdout };

    const { home, keyringBackend: backend } = interCmd.opts();
    const result = await sendAction(
      { method: 'executeOffer', offer },
      { keyring: { home, backend }, from, verbose: false, ...io },
    );
    const { timestamp, txhash, height } = result;
    console.error('bid is broadcast:');
    show({ timestamp, height, offerId: offer.id, txhash });
    const found = await pollOffer(from, offer.id, height);
    // TODO: command to wait 'till bid exits?
    const bid = coerceBid(found, agoricNames, console.warn);
    if (!bid) {
      console.warn('malformed bid', found);
      return;
    }
    const info = fmtBid(bid, values(agoricNames.vbankAsset));
    show(info);
  };

  /** @param {string} literalOrName */
  const normalizeAddress = literalOrName =>
    normalizeAddressWithOptions(literalOrName, interCmd.opts(), {
      execFileSync,
    });

  /**
   * @typedef {{
   *   give: number,
   *   collateralBrand: string,
   *   want: number,
   *   offerId: string,
   *   from: string,
   *   generateOnly?: boolean,
   * }} SharedBidOpts
   */

  /** @param {ReturnType<createCommand>} cmd */
  const withSharedBidOptions = cmd =>
    cmd
      .requiredOption(
        '--from <address>',
        'wallet address literal or name',
        normalizeAddress,
      )
      .requiredOption('--give <number>', 'IST to bid', Number)
      .option('--want <number>', 'max Collateral wanted', Number, 1_000_000)
      .option('--collateral-brand <string>', 'Collateral brand name', 'IbcATOM')
      .option('--offer-id <string>', 'Offer id', String, `bid-${now()}`)
      .option('--generate-only', 'print wallet action only');

  withSharedBidOptions(bidCmd.command('by-price'))
    .description('Place a bid on collateral by price.')
    .requiredOption('--price <number>', 'bid price (IST/Collateral)', Number)
    .action(
      /**
       * @param {SharedBidOpts & {
       *   price: number,
       * }} opts
       */
      async ({ collateralBrand, generateOnly, ...opts }) => {
        const tools = await rpcTools();

        const offer = Offers.auction.Bid(tools.agoricNames.brand, {
          collateralBrandKey: collateralBrand,
          ...opts,
        });

        if (generateOnly) {
          outputActionAndHint(
            { method: 'executeOffer', offer },
            { stdout, stderr },
          );
          return;
        }
        await placeBid(opts.from, offer, tools);
      },
    );

  /** @param {string} v */
  const parsePercent = v => {
    const p = Number(v);
    if (!(p >= -100 && p <= 100)) {
      throw new InvalidArgumentError('must be between -100 and 100');
    }
    return p / 100;
  };

  withSharedBidOptions(bidCmd.command('by-discount'))
    .description(
      `Place a bid on collateral based on discount from oracle price.`,
    )
    .requiredOption(
      '--discount <percent>',
      'bid discount (0 to 100) or markup (0 to -100) %',
      parsePercent,
    )
    .action(
      /**
       * @param {SharedBidOpts & {
       *   discount: number,
       * }} opts
       */
      async ({ collateralBrand, generateOnly, ...opts }) => {
        const tools = await rpcTools();

        const offer = Offers.auction.Bid(tools.agoricNames.brand, {
          collateralBrandKey: collateralBrand,
          ...opts,
        });
        if (generateOnly) {
          outputActionAndHint(
            { method: 'executeOffer', offer },
            { stdout, stderr },
          );
          return;
        }
        await placeBid(opts.from, offer, tools);
      },
    );

  bidCmd
    .command('cancel')
    .description('Try to exit a bid offer')
    .argument('id', 'offer id (as from bid list)')
    .requiredOption(
      '--from <address>',
      'wallet address literal or name',
      normalizeAddress,
    )
    .option('--generate-only', 'print wallet action only')
    .action(
      /**
       * @param {string} id
       * @param {{
       *   from: string,
       *   generateOnly?: boolean,
       * }} opts
       */
      async (id, { from, generateOnly }) => {
        /** @type {TryExitOfferAction} */
        const action = { method: 'tryExitOffer', offerId: id };

        if (generateOnly) {
          outputActionAndHint(action, { stdout, stderr });
          return;
        }

        const { networkConfig, vstorage, fromBoard } = await rpcTools();

        const liveOffers = await getLiveOffers(from, vstorage, fromBoard);
        const liveIds = liveOffers.map(([i, _s]) => i);
        if (!liveIds.includes(id)) {
          throw new InvalidArgumentError(
            `${id} not in live offer ids: ${liveIds}`,
          );
        }

        const io = { ...networkConfig, execFileSync, delay, stdout };

        const { home, keyringBackend: backend } = interCmd.opts();
        const result = await sendAction(action, {
          keyring: { home, backend },
          from,
          verbose: false,
          ...io,
        });
        const { timestamp, txhash, height } = result;
        console.error('cancel action is broadcast:');
        show({ timestamp, height, offerId: id, txhash });

        const checkGone = async blockInfo => {
          const liveNow = await getLiveOffers(from, vstorage, fromBoard);
          const found = liveNow.find(([i, _]) => i === id);
          if (found) throw Error('retry');
          return blockInfo;
        };
        const blockInfo = await pollBlocks({
          retryMessage: 'offer still live in block',
          ...networkConfig,
          execFileSync,
          delay,
        })(checkGone);
        console.error('bid', id, 'is no longer live');
        show(blockInfo);
      },
    );

  bidCmd
    .command('list')
    .description(
      `Show status of bid offers.

For example:

$ inter bid list --from my-acct
{"id":"bid-1679677228803","price":"9 IST/IbcATOM","give":{"Currency":"50IST"},"want":"5IbcATOM"}
{"id":"bid-1679677312341","discount":10,"give":{"Currency":"200IST"},"want":"1IbcATOM"}
`,
    )
    .requiredOption(
      '--from <address>',
      'wallet address literal or name',
      normalizeAddress,
    )
    .option('--all', 'show exited bids as well')
    .action(
      /**
       * @param {{
       *   from: string,
       *   all?: boolean,
       * }} opts
       */
      async opts => {
        const { agoricNames, vstorage, fromBoard, storedWalletState } =
          await rpcTools();

        const [liveOffers, state] = await Promise.all([
          getLiveOffers(opts.from, vstorage, fromBoard),
          storedWalletState(opts.from),
        ]);
        const entries = opts.all ? state.offerStatuses.entries() : liveOffers;
        for (const [id, spec] of entries) {
          const offerStatus = state.offerStatuses.get(id) || spec;
          harden(offerStatus); // coalesceWalletState should do this
          // console.debug(offerStatus.invitationSpec);
          if (!matches(offerStatus.invitationSpec, bidInvitationShape))
            continue;

          const bid = coerceBid(offerStatus, agoricNames, console.warn);
          if (!bid) continue;

          const info = fmtBid(bid, values(agoricNames.vbankAsset));
          show(info);
        }
      },
    );

  const reserveCmd = interCmd
    .command('reserve')
    .description('reserve commands');
  reserveCmd
    .command('add')
    .description('add collateral to the reserve')
    .requiredOption('--give <number>', 'Collateral to give', Number)
    .option('--collateral-brand <string>', 'Collateral brand key', 'IbcATOM')
    .option('--offer-id <string>', 'Offer id', String, `addCollateral-${now()}`)
    .action(
      /**
       * @param {{
       *   give: number,
       *   collateralBrand: string,
       *   offerId: string,
       * }} opts
       */
      async ({ collateralBrand, ...opts }) => {
        const { agoricNames } = await rpcTools();
        const offer = Offers.reserve.AddCollateral(agoricNames.brand, {
          collateralBrandKey: collateralBrand,
          ...opts,
        });
        outputActionAndHint(
          { method: 'executeOffer', offer },
          { stdout, stderr },
        );
      },
    );

  const assetCmd = interCmd
    .command('vbank')
    .description('vbank asset commands');
  assetCmd
    .command('list')
    .description('list registered assets with decimalPlaces, boardId, etc.')
    .action(async () => {
      const { agoricNames } = await rpcTools();
      const assets = Object.values(agoricNames.vbankAsset).map(a => {
        return {
          issuerName: a.issuerName,
          denom: a.denom,
          brand: { boardId: a.brand.getBoardId() },
          displayInfo: { decimalPlaces: a.displayInfo.decimalPlaces },
        };
      });
      show(assets, true);
    });

  return interCmd;
};
