import { E } from '@endo/eventual-send';
import { Far } from '@endo/marshal';
import { TimeMath } from '@agoric/time';
import { M } from '@agoric/store';
import { AmountShape } from '@agoric/ertp';

// Eventually will be importable from '@agoric/zoe-contract-support'
import {
  defaultAcceptanceMsg,
  assertIssuerKeywords,
} from '../../contractSupport/index.js';
import * as secondPriceLogic from './secondPriceLogic.js';
import * as firstPriceLogic from './firstPriceLogic.js';
import { assertBidSeat } from './assertBidSeat.js';

const { Fail } = assert;

const FIRST_PRICE = 'first-price';
const SECOND_PRICE = 'second-price';

/**
 * NOT TO BE USED IN PRODUCTION CODE. BIDS ARE PUBLIC. An auction
 * contract in which the seller offers an Asset for sale, and states a
 * minimum price. The auction closes at the deadline specified by the
 * timeAuthority, bidDuration, winnerPriceOption parameters in the terms provided by
 * the creator of the contract instance.
 * Winner price option can be `first-price` or `second-price`, default to `second-price`.
 *
 * startInstance() specifies the issuers and the terms. An invitation
 * for the seller is returned as the creatorInvitation. The seller's
 * offer should look like { give: { Asset: asset }, want: { Ask:
 * minimumBidAmount}} The asset can be non-fungible, but the Ask
 * amount should be of a fungible brand. The bidder invitations can be
 * made by calling makeBidInvitation on the object returned from the
 * seller's offer. Each bidder can submit an offer: { give: { Bid:
 * null } want: { Asset: null } }.
 *
 * @param {ZCF<{
 * timeAuthority: import('@agoric/time/src/types').TimerService,
 * winnerPriceOption?: FIRST_PRICE | SECOND_PRICE,
 * bidDuration: bigint,
 * }>} zcf
 */
const start = zcf => {
  const {
    timeAuthority,
    winnerPriceOption = SECOND_PRICE,
    bidDuration,
  } = zcf.getTerms();

  assert.typeof(bidDuration, 'bigint');
  winnerPriceOption === FIRST_PRICE ||
    winnerPriceOption === SECOND_PRICE ||
    Fail`Only first and second price auctions are supported`;

  let sellSeat;
  let isTimerStarted = false;
  let isClosed = false;
  let closesAfter = null;

  const bidSeats = [];
  const priceLogic =
    winnerPriceOption === FIRST_PRICE ? firstPriceLogic : secondPriceLogic;

  // seller will use 'Asset' and 'Ask'. buyer will use 'Asset' and 'Bid'
  assertIssuerKeywords(zcf, harden(['Asset', 'Ask']));

  const startWakeupTimerIfNeeded = async () => {
    if (isTimerStarted) {
      return;
    }

    // XXX toggle flag before `await` to avoid race-condition of 2 consecutive bids
    isTimerStarted = true;
    const currentTs = await E(timeAuthority).getCurrentTimestamp();
    closesAfter = TimeMath.addAbsRel(currentTs, bidDuration);

    E(timeAuthority)
      .setWakeup(
        closesAfter,
        Far('wakeObj', {
          wake: () => {
            isClosed = true;
            priceLogic.calcWinnerAndClose(zcf, sellSeat, bidSeats);
          },
        }),
      )
      .catch(err => {
        console.error(
          `Could not schedule the close of the auction at the 'closesAfter' deadline ${closesAfter} using this timer ${timeAuthority}`,
        );
        console.error(err);
        throw err;
      });
  };

  const getCurrentBids = () => {
    if (winnerPriceOption !== FIRST_PRICE) {
      return 'Bids are hidden for "second price" auctions';
    }
    const bidBrand = sellSeat.getProposal().want.Ask.brand;
    return bidSeats.map(seat => seat.getAmountAllocated('Bid', bidBrand));
  };

  const getSessionDetails = () => {
    const sellerProposal = sellSeat.getProposal();
    return harden({
      auctionedAssets: sellerProposal.give.Asset,
      minimumBid: sellerProposal.want.Ask,
      winnerPriceOption,
      closesAfter,
      bidDuration,
      timeAuthority,
      bids: getCurrentBids(),
    });
  };

  const BidProposalShape = M.splitRecord({
    give: {
      Bid: AmountShape, // TODO get amount shape from brand
    },
    want: {
      Asset: AmountShape, // TODO get amount shape from brand
    },
  });

  const SellProposalShape = M.splitRecord({
    give: {
      Asset: AmountShape, // TODO get amount shape from brand
    },
    want: {
      Ask: AmountShape, // TODO get amount shape from brand
    },
    exit: {
      // The auction is not over until the deadline according to the
      // provided timer. The seller cannot exit beforehand.
      waived: null,
    },
  });

  const makeBidInvitation = () => {
    /** @type {OfferHandler} */
    const performBid = seat => {
      assert(!isClosed, 'Auction session is closed, no more bidding');
      assertBidSeat(zcf, sellSeat, seat);

      // XXX await make function hanging
      startWakeupTimerIfNeeded();

      bidSeats.push(seat);
      return defaultAcceptanceMsg;
    };

    const customDetails = getSessionDetails();
    return zcf.makeInvitation(
      performBid,
      'bid',
      customDetails,
      BidProposalShape,
    );
  };

  const sell = seat => {
    // Save the seat for when the auction closes.
    sellSeat = seat;

    // The bid invitations can only be sent out after the assets to be
    // auctioned are escrowed.
    return Far('offerResult', { makeBidInvitation, getSessionDetails });
  };

  const publicFacet = Far('auctioneerPublicFacet', {
    getCurrentBids,
    getSessionDetails,
  });

  const creatorInvitation = zcf.makeInvitation(
    sell,
    'sellAssets',
    undefined,
    SellProposalShape,
  );

  return harden({ creatorInvitation, publicFacet });
};

harden(start);
export { start, FIRST_PRICE, SECOND_PRICE };
