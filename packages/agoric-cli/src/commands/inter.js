// @ts-check
import { CommanderError, InvalidArgumentError } from 'commander';
// TODO: should get M from endo https://github.com/Agoric/agoric-sdk/issues/7090
import { makeBidSpecShape } from '@agoric/inter-protocol/src/auction/auctionBook.js';
import { Offers } from '@agoric/inter-protocol/src/clientSupport.js';
import { objectMap } from '@agoric/internal';
import { makeWalletStateCoalescer } from '@agoric/smart-wallet/src/utils.js';
import { M, matches } from '@agoric/store';
import { normalizeAddressWithOptions } from '../lib/chain.js';
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
import { doAction, outputActionAndHint } from '../lib/wallet.js';

const { values } = Object;

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
 * Format amounts etc. in a bid OfferStatus
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
  const resultProp = result && result !== 'UNPUBLISHED' ? { result } : {};
  const props = {
    ...(give ? { give: fmt.record(give) } : {}),
    ...(want ? { want: fmt.amount(want) } : {}),
    ...(payouts ? { payouts: fmt.record(payouts) } : resultProp),
    ...(error ? { error } : {}),
  };
  return harden({ id, ...spec, ...props });
};

/**
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
  { env, stdout, stderr, now, setTimeout, execFileSync, createCommand },
  { fetch },
) => {
  const interCmd = createCommand('inter')
    .description('Inter Protocol tool')
    .option('--home [dir]', 'agd CosmosSDK application home directory')
    .option(
      '--keyring-backend [os|file|test]',
      `keyring's backend (os|file|test) (default "${
        env.AGORIC_KEYRING_BACKEND || 'os'
      }")`,
      env.AGORIC_KEYRING_BACKEND,
    );

  const rpcTools = async () => {
    const networkConfig = await getNetworkConfig(env);
    const { agoricNames, fromBoard, readLatestHead, vstorage } =
      await makeRpcUtils({ fetch }, networkConfig).catch(err => {
        throw new CommanderError(1, 'RPC_FAIL', err.message);
      });

    const storedWalletState = async from => {
      const m = boardSlottingMarshaller(fromBoard.convertSlotToVal);

      const history = await vstorage.readFully(`published.wallet.${from}`);

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
      return coalesced;
    };

    return {
      networkConfig,
      agoricNames,
      fromBoard,
      vstorage,
      readLatestHead,
      storedWalletState,
    };
  };

  const liquidationCmd = interCmd
    .command('liquidation')
    .description('liquidation commands');
  liquidationCmd
    .command('status')
    .description(
      `show amount liquidating, oracle price

For example:

{
  "liquidatingCollateral": "10 IbcATOM",
  "liquidatingDebt": "120 IST",
  "price": "12.00 IST/IbcATOM"
}
`,
    )
    .option('--manager [number]', 'Vault Manager', Number, 0)
    .action(async opts => {
      const { agoricNames, readLatestHead } = await rpcTools();

      const [metrics, quote] = await Promise.all([
        readLatestHead(`published.vaultFactory.manager${opts.manager}.metrics`),
        readLatestHead(`published.vaultFactory.manager${opts.manager}.quotes`),
      ]);
      const info = fmtMetrics(metrics, quote, values(agoricNames.vbankAsset));
      stdout.write(JSON.stringify(info, bigintReplacer, 2));
      stdout.write('\n');
    });

  const normalizeAddress = literalOrName =>
    normalizeAddressWithOptions(literalOrName, interCmd.opts(), {
      // @ts-expect-error execFileSync is overloaded
      execFileSync: (file, args) => {
        try {
          return execFileSync(file, args);
        } catch (err) {
          throw new InvalidArgumentError(
            `${err.message}: is ${file} in your $PATH?`,
          );
        }
      },
    });

  const bidCmd = interCmd
    .command('bid')
    .description('auction bidding commands');

  bidCmd
    .command('by-price')
    .description('Print an offer to bid collateral by price.')
    .requiredOption('--price [number]', 'bid price (IST/Collateral)', Number)
    .requiredOption('--give [number]', 'IST to bid', Number)
    .option('--want [number]', 'Collateral required for the bid', Number)
    .option('--collateralBrand [string]', 'Collateral brand key', 'IbcATOM')
    .option('--offerId [number]', 'Offer id', String, `bid-${now()}`)
    .action(
      /**
       * @param {{
       *   price: number,
       *   give: number, want?: number,
       *   collateralBrand: string,
       *   offerId: string,
       * }} opts
       */
      async ({ collateralBrand, ...opts }) => {
        const { agoricNames } = await rpcTools();
        const offer = Offers.auction.Bid(agoricNames.brand, {
          collateralBrandKey: collateralBrand,
          ...opts,
        });
        outputActionAndHint(
          { method: 'executeOffer', offer },
          { stdout, stderr },
        );
      },
    );

  const parsePercent = v => {
    const p = Number(v);
    if (!(p >= -100 && p <= 100)) {
      throw new InvalidArgumentError('must be between -100 and 100');
    }
    return p / 100;
  };

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  bidCmd
    .command('by-discount')
    .description(
      `Print an offer to bid on collateral based on discount from oracle price.`,
    )
    .requiredOption(
      '--discount [percent]',
      'bid discount (0 to 100) or markup (0 to -100) %',
      parsePercent,
    )
    .requiredOption('--give [number]', 'IST to bid', Number)
    .option('--want [number]', 'Collateral required for the bid', Number)
    .option('--collateralBrand [string]', 'Collateral brand key', 'IbcATOM')
    .option('--offerId [number]', 'Offer id', String, `bid-${now()}`)
    .action(
      /**
       * @param {{
       *   discount: number,
       *   give: number,  want?: number,
       *   collateralBrand: string,
       *   offerId: string,
       * }} opts
       */
      async ({ collateralBrand, ...opts }) => {
        const { agoricNames } = await rpcTools();
        const offer = Offers.auction.Bid(agoricNames.brand, {
          collateralBrandKey: collateralBrand,
          ...opts,
        });
        outputActionAndHint(
          { method: 'executeOffer', offer },
          { stdout, stderr },
        );
      },
    );

  bidCmd
    .command('cancel')
    .description('Exit a bid offer')
    .argument('id', 'offer id (as from bid list)')
    .requiredOption(
      '--from <address>',
      'wallet address literal or name',
      normalizeAddress,
    )
    .option('--dry-run', 'show agd commands only')
    .action(
      /**
       * @param {string} id
       * @param {{
       *   from: string,
       *   dryRun: boolean,
       * }} opts
       */
      async (id, { from, dryRun }) => {
        /** @type {TryExitOfferAction} */
        const action = {
          method: 'tryExitOffer',
          offerId: id,
        };
        const networkConfig = await getNetworkConfig(env);

        const result = await doAction(action, {
          dryRun,
          verbose: false,
          ...networkConfig,
          execFileSync,
          delay,
          stdout,
          from,
        });
        if (result) {
          const { timestamp, txhash, height } = result;
          stdout.write(
            `${JSON.stringify({
              timestamp,
              height,
              offerId: id,
              txhash,
            })}\n`,
          );
        }
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
    .action(async opts => {
      const { agoricNames, storedWalletState } = await rpcTools();
      const coalesced = await storedWalletState(opts.from);
      const bidInvitationShape = harden({
        source: 'agoricContract',
        instancePath: ['auctioneer'],
        callPipe: [['makeBidInvitation', M.any()]],
      });

      /**
       * @param {import('@agoric/smart-wallet/src/offers.js').OfferStatus} offerStatus
       * @param {typeof console.warn} warn
       */
      const coerceBid = (offerStatus, warn) => {
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

      for (const offerStatus of coalesced.offerStatuses.values()) {
        harden(offerStatus); // coalesceWalletState should do this
        // console.debug(offerStatus.invitationSpec);
        if (!matches(offerStatus.invitationSpec, bidInvitationShape)) continue;

        const bid = coerceBid(offerStatus, console.warn);
        if (!bid) continue;

        const info = fmtBid(bid, values(agoricNames.vbankAsset));
        stdout.write(JSON.stringify(info));
        stdout.write('\n');
      }
    });

  const reserveCmd = interCmd
    .command('reserve')
    .description('reserve commands');
  reserveCmd
    .command('add')
    .description('add collateral to the reserve')
    .requiredOption('--give <number>', 'Collateral to give', Number)
    .option('--collateralBrand [string]', 'Collateral brand key', 'IbcATOM')
    .option('--offerId [number]', 'Offer id', String, `bid-${now()}`)
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
  return interCmd;
};
