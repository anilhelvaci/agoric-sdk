import '@agoric/install-metering-and-ses';
// eslint-disable-next-line import/no-extraneous-dependencies
import test from 'ava';
// eslint-disable-next-line import/no-extraneous-dependencies
import { loadBasedir, buildVatController } from '@agoric/swingset-vat';
// eslint-disable-next-line import/no-extraneous-dependencies
import bundleSource from '@agoric/bundle-source';

import fs from 'fs';

const CONTRACT_FILES = ['crashingAutoRefund'];
const generateBundlesP = Promise.all(
  CONTRACT_FILES.map(async contract => {
    const bundle = await bundleSource(`${__dirname}/${contract}`);
    const obj = { bundle, contract };
    fs.writeFileSync(
      `${__dirname}/bundle-${contract}.js`,
      `export default ${JSON.stringify(obj)};`,
    );
  }),
);

async function main(argv) {
  const config = await loadBasedir(__dirname);
  await generateBundlesP;
  const controller = await buildVatController(config, argv);
  await controller.run();
  return controller.dump();
}

const meterExceededInOfferLog = [
  '=> alice is set up',
  '=> alice.doMeterExceptionInHook called',
  'outcome correctly resolves to broken: RangeError: Allocate meter exceeded',
  'aliceMoolaPurse: balance {"brand":{},"value":3}',
  'aliceSimoleanPurse: balance {"brand":{},"value":0}',
  'contract no longer responds: RangeError: Allocate meter exceeded',
  'counter: 2',
];

test('ZCF metering crash on invite exercise', async t => {
  t.plan(1);
  try {
    const dump = await main(['meterInOfferHook', [3, 0, 0]]);
    t.deepEqual(dump.log, meterExceededInOfferLog);
  } catch (e) {
   t.not(e, e, 'unexpected metering exception in crashing contract test');
  }
});

const meterExceededInSecondOfferLog = [
  '=> alice is set up',
  '=> alice.doMeterExceptionInHook called',
  'Swap outcome resolves to an invite: [Presence o-74]',
  'aliceMoolaPurse: balance {"brand":{},"value":0}',
  'aliceSimoleanPurse: balance {"brand":{},"value":0}',
  'outcome correctly resolves to broken: RangeError: Allocate meter exceeded',
  'aliceMoolaPurse: balance {"brand":{},"value":5}',
  'aliceSimoleanPurse: balance {"brand":{},"value":0}',
  'swap value, 5',
  'contract no longer responds: RangeError: Allocate meter exceeded',
  'aliceMoolaPurse: balance {"brand":{},"value":8}',
  'aliceSimoleanPurse: balance {"brand":{},"value":0}',
  'refund value, 8',
  'counter: 2',
];

test('ZCF metering crash on invite exercise', async t => {
  t.plan(1);
  try {
    const dump = await main(['meterInSecondInvite', [8, 0, 0]]);
    t.deepEqual(dump.log, meterExceededInSecondOfferLog);
  } catch (e) {
   t.not(e, e, 'unexpected metering exception in crashing contract test');
  }
});

const throwInOfferLog = [
  '=> alice is set up',
  '=> alice.doThrowInHook called',
  'counter: 2',
  'outcome correctly resolves to broken: Error: someException',
  'counter: 4',
  'aliceMoolaPurse: balance {"brand":{},"value":3}',
  'aliceSimoleanPurse: balance {"brand":{},"value":0}',
  'counter: 5',
  'newCounter: 2',
  'Successful refund: The offer was accepted',
  'new Purse: balance {"brand":{},"value":3}',
  'aliceSimoleanPurse: balance {"brand":{},"value":0}',
  'counter: 7',
];

test('ZCF throwing on invite exercise', async t => {
  t.plan(1);
  try {
    const dump = await main(['throwInOfferHook', [3, 0, 0]]);
    t.deepEqual(dump.log, throwInOfferLog);
  } catch (e) {
   t.not(e, e, 'unexpected throw in crashing contract test');
  }
});

const throwInAPILog = [
  '=> alice is set up',
  '=> alice.doThrowInApiCall called',
  'counter: 3',
  'throwingAPI should throw Error: someException',
  'counter: 5',
  'counter: 6',
  'Swap outcome is an invite (true).',
  'newCounter: 2',
  'outcome correctly resolves: "The offer has been accepted. Once the contract has been completed, please check your payout"',
  'counter: 7',
  'aliceMoolaPurse: balance {"brand":{},"value":3}',
  'second moolaPurse: balance {"brand":{},"value":2}',
  'aliceSimoleanPurse: balance {"brand":{},"value":8}',
  'second simoleanPurse: balance {"brand":{},"value":4}',
];

test('ZCF throwing in API call', async t => {
  t.plan(1);
  try {
    const dump = await main(['throwInApiCall', [5, 12, 0]]);
    t.deepEqual(dump.log, throwInAPILog);
  } catch (e) {
   t.not(e, e, 'unexpected API throw in crashing contract test');
  }
});

const meteringExceededInAPILog = [
  '=> alice is set up',
  '=> alice.doMeterInApiCall called',
  'counter: 2',
  'counter: 3',
  'outcome correctly resolves to "The offer was accepted"',
  'counter: 5',
  'Vat correctly died for RangeError: Allocate meter exceeded',
  'aliceMoolaPurse: balance {"brand":{},"value":3}',
  'aliceSimoleanPurse: balance {"brand":{},"value":0}',
  'contract no longer responds: RangeError: Allocate meter exceeded',
  'newCounter: 2',
];

test('ZCF metering crash in API call', async t => {
  t.plan(1);
  try {
    const dump = await main(['meterInApiCall', [3, 0, 0]]);
    t.deepEqual(dump.log, meteringExceededInAPILog);
  } catch (e) {
   t.not(
      e,
      e,
      'unexpected API metering exception in crashing contract test',
    );
  }
});

const meteringExceptionInMakeContractILog = [
  '=> alice is set up',
  '=> alice.doMeterExceptionInMakeContract called',
  'contract creation failed: RangeError: Allocate meter exceeded',
  'newCounter: 2',
];

test('ZCF metering crash in makeContract call', async t => {
  t.plan(1);
  try {
    const dump = await main(['meterInMakeContract', [3, 0, 0]]);
    t.deepEqual(dump.log, meteringExceptionInMakeContractILog);
  } catch (e) {
   t.not(
      e,
      e,
      'unexpected API metering exception in crashing contract test',
    );
  }
});

const thrownExceptionInMakeContractILog = [
  '=> alice is set up',
  '=> alice.doThrowInMakeContract called',
  'contract creation failed: Error: blowup in makeContract',
  'newCounter: 2',
];

test('ZCF metering crash in makeContract call', async t => {
  t.plan(1);
  try {
    const dump = await main(['throwInMakeContract', [3, 0, 0]]);
    t.deepEqual(dump.log, thrownExceptionInMakeContractILog);
  } catch (e) {
   t.not(
      e,
      e,
      'unexpected API metering exception in crashing contract test',
    );
  }
});
