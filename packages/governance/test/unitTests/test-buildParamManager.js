// @ts-check

import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';
import { makeIssuerKit, AmountMath, AssetKind } from '@agoric/ertp';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import { setupZCFTest } from '@agoric/zoe/test/unitTests/zcf/setupZcfTest.js';
import { E } from '@endo/eventual-send';
import { Far } from '@endo/marshal';
import { keyEQ } from '@agoric/store';

import { makeHandle } from '@agoric/zoe/src/makeHandle.js';
import { ParamTypes, makeParamManagerBuilder } from '../../src/index.js';

test('two parameters', t => {
  const drachmaKit = makeIssuerKit('drachma');

  const drachmaBrand = drachmaKit.brand;
  const paramManager = makeParamManagerBuilder()
    .addBrand('Currency', drachmaBrand)
    .addAmount('Amt', AmountMath.make(drachmaBrand, 37n))
    .build();

  t.is(paramManager.getBrand('Currency'), drachmaBrand);
  t.is(paramManager.getCurrency(), drachmaBrand);
  t.deepEqual(
    paramManager.getAmount('Amt'),
    AmountMath.make(drachmaBrand, 37n),
  );
});

test('getParams', t => {
  const drachmaKit = makeIssuerKit('drachma');

  const drachmaBrand = drachmaKit.brand;
  const drachmas = AmountMath.make(drachmaBrand, 37n);
  const paramManager = makeParamManagerBuilder()
    .addBrand('Currency', drachmaBrand)
    .addAmount('Amt', drachmas)
    .build();

  t.deepEqual(
    paramManager.getParams(),
    harden({
      Currency: {
        type: ParamTypes.BRAND,
        value: drachmaBrand,
      },
      Amt: {
        type: ParamTypes.AMOUNT,
        value: drachmas,
      },
    }),
  );
});

test('params duplicate entry', async t => {
  const stuffKey = 'Stuff';
  const { brand: stiltonBrand } = makeIssuerKit('stilton', AssetKind.SET);
  t.throws(
    () =>
      makeParamManagerBuilder()
        .addNat(stuffKey, 37n)
        .addUnknown(stuffKey, stiltonBrand)
        .build(),
    {
      message: `"Parameter Name" already registered: "Stuff"`,
    },
  );
});

test('Amount', async t => {
  const { brand: floorBrand } = makeIssuerKit('floor wax');
  const { brand: dessertBrand } = makeIssuerKit('dessertTopping');
  const paramManager = makeParamManagerBuilder()
    .addAmount('Shimmer', AmountMath.make(floorBrand, 2n))
    .build();
  t.deepEqual(
    paramManager.getAmount('Shimmer'),
    AmountMath.make(floorBrand, 2n),
  );

  await paramManager.updateParams({ Shimmer: AmountMath.make(floorBrand, 5n) });
  t.deepEqual(
    paramManager.getAmount('Shimmer'),
    AmountMath.make(floorBrand, 5n),
  );

  await t.throwsAsync(
    () =>
      paramManager.updateParams({
        Shimmer: AmountMath.make(dessertBrand, 20n),
      }),
    {
      message:
        'The brand in the allegedAmount {"brand":"[Alleged: dessertTopping brand]","value":"[20n]"} in \'coerce\' didn\'t match the specified brand "[Alleged: floor wax brand]".',
    },
  );

  await t.throwsAsync(
    () => paramManager.updateParams({ Shimmer: 'fear,loathing' }),
    {
      message: 'Expected an Amount for Shimmer, got "fear,loathing"',
    },
  );

  t.throws(() => paramManager.getString('Shimmer'), {
    message: '"Shimmer" is not "string"',
  });
});

test('params one installation', async t => {
  // this is sufficient for the current type check. When we add
  // isInstallation() (#3344), we'll need to make a mockZoe.
  /** @type {Installation} */
  // @ts-expect-error cast
  const installationHandle = Far('fake Installation', {
    getBundle: () => ({ obfuscated: 42 }),
  });

  const paramManager = makeParamManagerBuilder()
    .addInstallation('PName', installationHandle)
    .build();

  t.deepEqual(paramManager.getInstallation('PName'), installationHandle);
  await t.throwsAsync(
    () => paramManager.updateParams({ PName: 18.1 }),
    {
      message: 'value for "PName" must be an Installation, was 18.1',
    },
    'value should be an installation',
  );
  /** @type {Installation} */
  // @ts-expect-error cast
  const handle2 = Far('another fake Installation', {
    getBundle: () => ({ condensed: '() => {})' }),
  });
  await paramManager.updateParams({ PName: handle2 });
  t.deepEqual(paramManager.getInstallation('PName'), handle2);

  t.throws(() => paramManager.getNat('PName'), {
    message: '"PName" is not "nat"',
  });

  t.deepEqual(
    paramManager.getParams(),
    harden({
      PName: {
        type: ParamTypes.INSTALLATION,
        value: handle2,
      },
    }),
  );
});

test('params one instance', async t => {
  const handleType = 'Instance';
  // this is sufficient for the current type check. When we add
  // isInstallation() (#3344), we'll need to make a mockZoe.
  const instanceHandle = makeHandle(handleType);

  const paramManager = makeParamManagerBuilder()
    .addInstance('PName', instanceHandle)
    .build();

  t.deepEqual(paramManager.getInstance('PName'), instanceHandle);
  await t.throwsAsync(
    () => paramManager.updateParams({ PName: 18.1 }),
    {
      message: 'value for "PName" must be an Instance, was 18.1',
    },
    'value should be an instance',
  );
  const handle2 = makeHandle(handleType);
  await paramManager.updateParams({ PName: handle2 });
  t.deepEqual(paramManager.getInstance('PName'), handle2);

  t.deepEqual(
    paramManager.getParams(),
    harden({
      PName: {
        type: ParamTypes.INSTANCE,
        value: handle2,
      },
    }),
  );
});

test('Invitation', async t => {
  const drachmaKit = makeIssuerKit('drachma');
  const terms = harden({
    mmr: makeRatio(150n, drachmaKit.brand),
  });

  const issuerKeywordRecord = harden({
    Ignore: drachmaKit.issuer,
  });

  const { instance, zoe } = await setupZCFTest(issuerKeywordRecord, terms);

  const invitation = await E(E(zoe).getPublicFacet(instance)).makeInvitation();

  const invitationAmount = await E(E(zoe).getInvitationIssuer()).getAmountOf(
    invitation,
  );

  const drachmaBrand = drachmaKit.brand;
  const drachmaAmount = AmountMath.make(drachmaBrand, 37n);
  const paramManagerBuilder = makeParamManagerBuilder(zoe)
    .addBrand('Currency', drachmaBrand)
    .addAmount('Amt', drachmaAmount);
  // addInvitation is async, so it can't be part of the cascade.
  await paramManagerBuilder.addInvitation('Invite', invitation);
  const paramManager = paramManagerBuilder.build();

  t.is(paramManager.getBrand('Currency'), drachmaBrand);
  t.is(paramManager.getAmount('Amt'), drachmaAmount);
  const invitationActualAmount =
    paramManager.getInvitationAmount('Invite').value;
  t.deepEqual(invitationActualAmount, invitationAmount.value);
  t.assert(keyEQ(invitationActualAmount, invitationAmount.value));
  t.is(invitationActualAmount[0].description, 'simple');

  t.is(await paramManager.getInternalParamValue('Invite'), invitation);

  t.deepEqual(
    paramManager.getParams(),
    harden({
      Amt: {
        type: ParamTypes.AMOUNT,
        value: drachmaAmount,
      },
      Currency: {
        type: ParamTypes.BRAND,
        value: drachmaBrand,
      },
      Invite: {
        type: ParamTypes.INVITATION,
        value: invitationAmount,
      },
    }),
  );
});

test('two Nats', async t => {
  const paramManager = makeParamManagerBuilder()
    .addNat('Acres', 50n)
    .addNat('SpeedLimit', 299_792_458n)
    .build();

  t.is(paramManager.getNat('Acres'), 50n);
  t.is(paramManager.getNat('SpeedLimit'), 299_792_458n);

  await t.throwsAsync(
    () => paramManager.updateParams({ SpeedLimit: 300000000 }),
    {
      message: '300000000 must be a bigint',
    },
  );

  await t.throwsAsync(() => paramManager.updateParams({ SpeedLimit: -37n }), {
    message: '-37 is negative',
  });
});

test('Ratio', async t => {
  const unitlessBrand = makeIssuerKit('unitless').brand;

  const ratio = makeRatio(16180n, unitlessBrand, 10_000n);
  const paramManager = makeParamManagerBuilder()
    .addRatio('GoldenRatio', ratio)
    .build();
  t.is(paramManager.getRatio('GoldenRatio'), ratio);

  const morePrecise = makeRatio(1618033n, unitlessBrand, 1_000_000n);
  await paramManager.updateParams({ GoldenRatio: morePrecise });
  t.is(paramManager.getRatio('GoldenRatio'), morePrecise);

  const anotherBrand = makeIssuerKit('arbitrary').brand;

  await t.throwsAsync(
    () => paramManager.updateParams({ GoldenRatio: 300000000 }),
    {
      message: '"ratio" 300000000 must be a pass-by-copy record, not "number"',
    },
  );

  await t.throwsAsync(
    () =>
      paramManager.updateParams({
        GoldenRatio: makeRatio(16180n, anotherBrand, 10_000n),
      }),
    {
      message:
        'Numerator brand for "GoldenRatio" must be "[Alleged: unitless brand]"',
    },
  );
});

test('Strings', async t => {
  const paramManager = makeParamManagerBuilder()
    .addNat('Acres', 50n)
    .addString('OurWeapons', 'fear')
    .build();
  t.is(paramManager.getString('OurWeapons'), 'fear');

  await paramManager.updateParams({ OurWeapons: 'fear,surprise' });
  t.is(paramManager.getString('OurWeapons'), 'fear,surprise');
  await t.throwsAsync(
    () =>
      paramManager.updateParams({
        OurWeapons: 300000000,
      }),
    {
      message: '300000000 must be a string',
    },
  );

  t.throws(() => paramManager.getNat('OurWeapons'), {
    message: '"OurWeapons" is not "nat"',
  });
});

test('JSON blobs', async t => {
  const paramManager = makeParamManagerBuilder()
    .addNat('Acres', 50n)
    .addJson('Blob', '{ "author": "Crockford" }')
    .build();
  t.is(paramManager.getJson('Blob'), '{ "author": "Crockford" }');

  await paramManager.updateParams({
    Blob: '{ "authors": "Crockford,Morningstar" }',
  });
  t.is(paramManager.getBlob(), '{ "authors": "Crockford,Morningstar" }');
  await t.throwsAsync(
    () =>
      paramManager.updateParams({
        Blob: 300000000,
      }),
    {
      message: 'Expected a json string. "300000000" is not valid json.',
    },
  );
  await t.throwsAsync(
    () =>
      paramManager.updateParams({
        Blob: 'author: bob',
      }),
    {
      message: 'Expected a json string. "author: bob" is not valid json.',
    },
  );

  t.throws(() => paramManager.getNat('Blob'), {
    message: '"Blob" is not "nat"',
  });
});

test('Unknown', async t => {
  const paramManager = makeParamManagerBuilder()
    .addString('Label', 'birthday')
    .addUnknown('Surprise', 'party')
    .build();
  t.is(paramManager.getUnknown('Surprise'), 'party');

  await paramManager.updateParams({ Surprise: 'gift' });
  t.is(paramManager.getUnknown('Surprise'), 'gift');
  await paramManager.updateParams({ Surprise: ['gift', 'party'] });
  t.deepEqual(paramManager.getUnknown('Surprise'), ['gift', 'party']);
});
