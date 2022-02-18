import { Far } from '@endo/marshal';
import { makePriceAuthorityRegistry } from '@agoric/zoe/tools/priceAuthorityRegistry';
import { makeScriptedPriceAuthority } from '@agoric/zoe/tools/scriptedPriceAuthority';

/** @type {BuildRootObjectForTestVat} */
export const buildRootObject = () =>
  Far('root', {
    makePriceAuthority: makePriceAuthorityRegistry,
    makeFakePriceAuthority: async options =>
      makeScriptedPriceAuthority(options),
  });
