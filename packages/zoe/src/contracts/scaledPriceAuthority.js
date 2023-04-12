import { AssetKind, makeIssuerKit } from '@agoric/ertp';
import { Far } from '@endo/marshal';

import {
  ceilDivideBy,
  ceilMultiplyBy,
  floorDivideBy,
  floorMultiplyBy,
} from '@agoric/contracts';
import { makePriceAuthorityTransform } from './priceAuthorityTransform.js';
import { makeInitialTransform } from './priceAuthorityInitial.js';

/**
 * @typedef {object} ScaledPriceAuthorityOpts
 * @property {ERef<PriceAuthority>} sourcePriceAuthority
 * @property {Ratio} scaleIn - sourceAmountIn:targetAmountIn
 * @property {Ratio} scaleOut - sourceAmountOut:targetAmountOut
 * @property {Ratio} [initialPrice] - targetAmountIn:targetAmountOut
 */

/**
 * A contract that scales a source price authority to a target price authority
 * via ratios.
 *
 * @param {ZCF<ScaledPriceAuthorityOpts>} zcf
 * @param {object} [root0]
 * @param {ERef<Mint<'set'>>} [root0.quoteMint]
 */
export const start = async (
  zcf,
  { quoteMint = makeIssuerKit('quote', AssetKind.SET).mint } = {},
) => {
  const { sourcePriceAuthority, scaleIn, scaleOut, initialPrice } =
    zcf.getTerms();

  const {
    numerator: { brand: sourceBrandIn },
    denominator: { brand: actualBrandIn },
  } = scaleIn;
  const {
    numerator: { brand: sourceBrandOut },
    denominator: { brand: actualBrandOut },
  } = scaleOut;

  const priceAuthority = makePriceAuthorityTransform({
    quoteMint,
    sourcePriceAuthority,
    sourceBrandIn,
    sourceBrandOut,
    actualBrandIn,
    actualBrandOut,
    // It's hard to make a good guess as to the best rounding strategy for this
    // transformation, but we make sure that the amount in is generous and the
    // amount out is conservative.
    makeSourceAmountIn: amountIn => ceilMultiplyBy(amountIn, scaleIn),
    makeSourceAmountOut: amountOut => floorMultiplyBy(amountOut, scaleOut),
    transformSourceAmountIn: amountIn => ceilDivideBy(amountIn, scaleIn),
    transformSourceAmountOut: amountOut => floorDivideBy(amountOut, scaleOut),
  });

  const withInitial = initialPrice
    ? priceAuthority.then(pa =>
        makeInitialTransform(
          initialPrice,
          pa,
          quoteMint,
          actualBrandIn,
          actualBrandOut,
        ),
      )
    : priceAuthority;

  const publicFacet = Far('publicFacet', {
    getPriceAuthority: () => withInitial,
  });
  return harden({ publicFacet });
};
