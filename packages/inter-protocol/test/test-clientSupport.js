import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';

import { makeIssuerKit } from '@agoric/ertp';
import { makeRatio } from '@agoric/zoe/src/contractSupport/ratio.js';
import { withAmountUtils } from './supports.js';
import { Offers } from '../src/clientSupport.js';

const ist = withAmountUtils(makeIssuerKit('IST'));
const atom = withAmountUtils(makeIssuerKit('ATOM'));

const brands = {
  IST: ist.brand,
  ATOM: atom.brand,
};

test('Offers.auction.Bid', async t => {
  const discounts = [
    { cliArg: 0.05, offerBidScaling: makeRatio(95n, ist.brand, 100n) },
    { cliArg: 0.95, offerBidScaling: makeRatio(5n, ist.brand, 100n) },
    { cliArg: -0.05, offerBidScaling: makeRatio(105n, ist.brand, 100n) },
    { cliArg: -0.1, offerBidScaling: makeRatio(110n, ist.brand, 100n) },
  ];

  discounts.forEach(({ cliArg, offerBidScaling }) => {
    t.log('discount', cliArg * 100, '%');
    t.deepEqual(
      Offers.auction.Bid(brands, {
        offerId: 'foo1',
        give: 4.56,
        collateralBrandKey: 'ATOM',
        discount: cliArg,
        want: 10_000,
      }),
      {
        id: 'foo1',
        invitationSpec: {
          source: 'agoricContract',
          instancePath: ['auctioneer'],
          callPipe: [['makeBidInvitation', [atom.brand]]],
        },
        proposal: {
          give: { Currency: ist.make(4_560_000n) },
        },
        offerArgs: {
          offerBidScaling,
          want: { brand: atom.brand, value: 10_000_000_000n },
        },
      },
    );
  });

  const price = 7;
  const offerPrice = makeRatio(7n, ist.brand, 1n, atom.brand);
  t.deepEqual(
    Offers.auction.Bid(brands, {
      offerId: 'by-price2',
      give: 4.56,
      collateralBrandKey: 'ATOM',
      price,
      want: 10_000,
    }),
    {
      id: 'by-price2',
      invitationSpec: {
        source: 'agoricContract',
        instancePath: ['auctioneer'],
        callPipe: [['makeBidInvitation', [atom.brand]]],
      },
      proposal: { give: { Currency: ist.make(4_560_000n) } },
      offerArgs: {
        offerPrice,
        want: { brand: atom.brand, value: 10_000_000_000n },
      },
    },
  );

  t.deepEqual(
    Offers.auction.Bid(brands, {
      offerId: 'by-price2',
      want: 1.23,
      give: 4.56,
      collateralBrandKey: 'ATOM',
      price,
    }),
    {
      id: 'by-price2',
      invitationSpec: {
        source: 'agoricContract',
        instancePath: ['auctioneer'],
        callPipe: [['makeBidInvitation', [atom.brand]]],
      },
      proposal: {
        give: { Currency: ist.make(4_560_000n) },
      },
      offerArgs: {
        offerPrice,
        want: atom.make(1_230_000n),
      },
    },
    'optional want',
  );
});
