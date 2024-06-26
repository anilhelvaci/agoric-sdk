import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';

import { AmountMath } from '@agoric/ertp';
import { setUpZoeForTest } from '@agoric/zoe/tools/setup-zoe.js';
import { E } from '@endo/far';
import path from 'path';
import { commonSetup } from '../supports.js';

const { keys } = Object;
const dirname = path.dirname(new URL(import.meta.url).pathname);

const contractFile = `${dirname}/../../src/examples/stakeBld.contract.js`;
type StartFn =
  typeof import('@agoric/orchestration/src/examples/stakeBld.contract.js').start;

const coreEval = async (t, { timer, localchain, marshaller, storage, bld }) => {
  t.log('install stakeBld contract');
  const { zoe, bundleAndInstall } = await setUpZoeForTest();
  const installation: Installation<StartFn> =
    await bundleAndInstall(contractFile);

  const { publicFacet } = await E(zoe).startInstance(
    installation,
    { In: bld.issuer },
    {},
    {
      localchain,
      marshaller,
      storageNode: storage.rootNode,
      timerService: timer,
      timerBrand: timer.getTimerBrand(),
    },
  );
  return { publicFacet, zoe };
};

test('stakeBld contract - makeAccount, deposit, withdraw', async t => {
  const {
    bootstrap,
    brands: { bld },
    utils,
  } = await commonSetup(t);
  const { publicFacet } = await coreEval(t, { ...bootstrap, bld });

  t.log('make a LocalChainAccount');
  const account = await E(publicFacet).makeAccount();
  t.truthy(account, 'account is returned');
  t.regex(await E(account).getAddress(), /agoric1/);

  // XXX not observed by vat-bank
  const oneHundredStakePmt = bld.issuerKit.mint.mintPayment(bld.units(100));

  t.log('deposit 100 bld to account');
  const depositResp = await E(account).deposit(oneHundredStakePmt);
  t.true(AmountMath.isEqual(depositResp, bld.units(100)), 'deposit');

  // TODO validate balance, .getBalance()

  t.log('withdraw bld from account');
  const withdrawResp = await E(account).withdraw(bld.units(100));
  const withdrawAmt = await bld.issuer.getAmountOf(withdrawResp);
  t.true(AmountMath.isEqual(withdrawAmt, bld.units(100)), 'withdraw');

  await t.throwsAsync(
    () => E(account).withdraw(bld.units(100)),
    undefined, // fake bank error messages don't match production
    'cannot withdraw more than balance',
  );
});

test('stakeBld contract - makeStakeBldInvitation', async t => {
  const {
    bootstrap,
    brands: { bld },
  } = await commonSetup(t);
  const { publicFacet, zoe } = await coreEval(t, { ...bootstrap, bld });

  t.log('call makeStakeBldInvitation');
  const inv = await E(publicFacet).makeStakeBldInvitation();

  const hundred = bld.make(1_000_000_000n);

  t.log('make an offer for an account');
  // Want empty until (at least) #9087
  const userSeat = await E(zoe).offer(
    inv,
    { give: { In: hundred } },
    { In: bld.mint.mintPayment(hundred) },
  );
  const { invitationMakers } = await E(userSeat).getOfferResult();
  t.truthy(invitationMakers, 'received continuing invitation');

  t.log('make Delegate offer using invitationMakers');
  const delegateInv = await E(invitationMakers).Delegate('agoric1validator1', {
    brand: bld.brand,
    value: 1_000_000_000n,
  });
  const delegateOffer = await E(zoe).offer(
    delegateInv,
    { give: { In: hundred } },
    { In: bld.mint.mintPayment(hundred) },
  );
  const res = await E(delegateOffer).getOfferResult();
  t.deepEqual(res, {});
  t.log('Successfully delegated');

  await t.throwsAsync(() => E(invitationMakers).TransferAccount(), {
    message: 'not yet implemented',
  });
  await t.throwsAsync(() => E(invitationMakers).CloseAccount(), {
    message: 'not yet implemented',
  });
});

test('stakeBld contract - makeAccountInvitationMaker', async t => {
  const {
    bootstrap,
    brands: { bld },
  } = await commonSetup(t);
  const { publicFacet, zoe } = await coreEval(t, { ...bootstrap, bld });

  const inv = await E(publicFacet).makeAcountInvitationMaker();

  const userSeat = await E(zoe).offer(inv);
  const offerResult = await E(userSeat).getOfferResult();
  t.true('account' in offerResult, 'received account');
  t.truthy('invitationMakers' in offerResult, 'received continuing invitation');
});
