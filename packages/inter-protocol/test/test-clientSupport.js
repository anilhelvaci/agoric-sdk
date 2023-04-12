import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';

import { makeIssuerKit } from '@agoric/ertp';
import { makeRatio } from '@agoric/contracts';
import { makeParseAmount } from 'agoric/src/lib/wallet.js';
import { withAmountUtils } from './supports.js';
import { Offers } from '../src/clientSupport.js';

const ist = withAmountUtils(makeIssuerKit('IST'));
const atom = withAmountUtils(makeIssuerKit('ATOM'));

const brands = {
  IST: ist.brand,
  ATOM: atom.brand,
};

const agoricNames = /** @type {const} */ ({
  brand: brands,
  vbankAsset: {
    uist: {
      denom: 'uist',
      brand: ist.brand,
      displayInfo: { assetKind: 'nat', decimalPlaces: 6 },
      issuer: /** @type {any} */ ({}),
      issuerName: 'IST',
      proposedName: 'Agoric stable token',
    },
    'ibc/toyatom': {
      denom: 'ibc/toyatom',
      brand: atom.brand,
      displayInfo: { assetKind: 'nat', decimalPlaces: 6 },
      issuer: /** @type {any} */ ({}),
      issuerName: 'ATOM',
      proposedName: 'ATOM',
    },
  },
});

test('Offers.auction.Bid', async t => {
  const discounts = [
    { cliArg: 0.05, offerBidScaling: makeRatio(95n, ist.brand, 100n) },
    { cliArg: 0.95, offerBidScaling: makeRatio(5n, ist.brand, 100n) },
    { cliArg: -0.05, offerBidScaling: makeRatio(105n, ist.brand, 100n) },
    { cliArg: -0.1, offerBidScaling: makeRatio(110n, ist.brand, 100n) },
  ];

  const parseAmount = makeParseAmount(agoricNames);
  discounts.forEach(({ cliArg, offerBidScaling }) => {
    t.log('discount', cliArg * 100, '%');
    t.deepEqual(
      Offers.auction.Bid(brands, {
        offerId: 'foo1',
        give: '4.56IST',
        discount: cliArg,
        desiredBuy: '10_000ATOM',
        parseAmount,
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
      give: '4.56IST',
      price,
      desiredBuy: '10_000ATOM',
      parseAmount,
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
      desiredBuy: '10_000ATOM',
      wantMinimum: '1.23ATOM',
      give: '4.56IST',
      price,
      parseAmount,
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
        want: { Collateral: atom.make(1_230_000n) },
      },
      offerArgs: {
        offerPrice,
        want: atom.make(10_000_000_000n),
      },
    },
    'optional want',
  );

  t.throws(
    () =>
      // @ts-expect-error error checking test
      Offers.auction.Bid(brands, {
        offerId: 'by-price2',
        wantMinimum: '1.23ATOM',
        give: '4.56IST',
        price,
        parseAmount,
      }),
    { message: 'missing ["desiredBuy"]' },
  );
});
