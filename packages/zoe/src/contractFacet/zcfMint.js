import { AmountMath } from '@agoric/ertp';
import { M, prepareExo, prepareExoClass } from '@agoric/vat-data';
import { E } from '@endo/eventual-send';

import { coerceAmountKeywordRecord } from '../cleanProposal.js';
import { makeIssuerRecord } from '../issuerRecord.js';
import { addToAllocation, subtractFromAllocation } from './allocationMath.js';

import '../internal-types.js';
import {
  AmountKeywordRecordShape,
  IssuerRecordShape,
  SeatShape,
} from '../typeGuards.js';
import './internal-types.js';
import './types.js';

const { Fail } = assert;

export const prepareDurableZcfMint = (
  /** @type {import('@agoric/vat-data').Baggage}*/ zcfBaggage,
  /** @type {{ (keyword: string, issuerRecord: IssuerRecord): void }} */ recordIssuer,
  /** @type {GetAssetKindByBrand} */ getAssetKindByBrand,
  /** @type { (exit?: undefined) => { zcfSeat: any; userSeat: Promise<UserSeat> }} */ makeEmptySeatKit,
  /** @type {ZcfMintReallocator} */ reallocator,
) => {
  return prepareExoClass(
    zcfBaggage,
    'zcfMint',
    M.interface('ZCFMint', {
      getIssuerRecord: M.call().returns(IssuerRecordShape),
      mintGains: M.call(AmountKeywordRecordShape, M.any()).returns(SeatShape),
      burnLosses: M.call(AmountKeywordRecordShape, M.any()).returns(SeatShape),
    }),
    (
      /** @type {string} */ keyword,
      /** @type {ZoeMint} */ zoeMint,
      /** @type {IssuerRecord} */ issuerRecord,
    ) => {
      const {
        brand: mintyBrand,
        issuer: mintyIssuer,
        displayInfo: mintyDisplayInfo,
      } = issuerRecord;
      if (!mintyDisplayInfo) {
        throw Fail`DurableZcfMint requires display info`;
      }
      const mintyIssuerRecord = makeIssuerRecord(
        mintyBrand,
        mintyIssuer,
        mintyDisplayInfo,
      );
      recordIssuer(keyword, mintyIssuerRecord);

      const empty = AmountMath.makeEmpty(
        mintyBrand,
        mintyDisplayInfo.assetKind,
      );

      return { empty, keyword, zoeMint, mintyIssuerRecord };
    },
    {
      getIssuerRecord: () => {
        return this.state.mintyIssuerRecord;
      },
      /** @type {(gains: Record<string, Amount>, zcfSeat?: ZCFSeat) => ZCFSeat} */
      mintGains: (gains, zcfSeat = makeEmptySeatKit().zcfSeat) => {
        const { empty, mintyBrand, zoeMint } = this.state;
        gains = coerceAmountKeywordRecord(gains, getAssetKindByBrand);
        const add = (
          /** @type {Amount<AssetKind>} */ total,
          /** @type {Amount<AssetKind>} */ amountToAdd,
        ) => AmountMath.add(total, amountToAdd, mintyBrand);
        const totalToMint = Object.values(gains).reduce(add, empty);
        !zcfSeat.hasExited() ||
          Fail`zcfSeat must be active to mint gains for the zcfSeat`;
        const allocationPlusGains = addToAllocation(
          zcfSeat.getCurrentAllocation(),
          gains,
        );

        // Increment the stagedAllocation if it exists so that the
        // stagedAllocation is kept up to the currentAllocation
        if (zcfSeat.hasStagedAllocation()) {
          zcfSeat.incrementBy(gains);
        }

        // Offer safety should never be able to be violated here, as
        // we are adding assets. However, we keep this check so that
        // all reallocations are covered by offer safety checks, and
        // that any bug within Zoe that may affect this is caught.
        zcfSeat.isOfferSafe(allocationPlusGains) ||
          Fail`The allocation after minting gains ${allocationPlusGains} for the zcfSeat was not offer safe`;
        // No effects above, apart from incrementBy. Note COMMIT POINT within
        // reallocator.reallocate(). The following two steps *should* be
        // committed atomically, but it is not a disaster if they are
        // not. If we minted only, no one would ever get those
        // invisibly-minted assets.
        E(zoeMint).mintAndEscrow(totalToMint);
        reallocator.reallocate(zcfSeat, allocationPlusGains);
        return zcfSeat;
      },
      burnLosses: (
        /** @type {AmountKeywordRecord} */ losses,
        /** @type {ZCFSeat} */ zcfSeat,
      ) => {
        const { empty, mintyBrand, zoeMint } = this.state;
        losses = coerceAmountKeywordRecord(losses, getAssetKindByBrand);
        const add = (
          /** @type {Amount<AssetKind>} */ total,
          /** @type {Amount<AssetKind>} */ amountToAdd,
        ) => AmountMath.add(total, amountToAdd, mintyBrand);
        const totalToBurn = Object.values(losses).reduce(add, empty);
        !zcfSeat.hasExited() ||
          Fail`zcfSeat must be active to burn losses from the zcfSeat`;
        const allocationMinusLosses = subtractFromAllocation(
          zcfSeat.getCurrentAllocation(),
          losses,
        );

        // verifies offer safety
        zcfSeat.isOfferSafe(allocationMinusLosses) ||
          Fail`The allocation after burning losses ${allocationMinusLosses} for the zcfSeat was not offer safe`;

        // Decrement the stagedAllocation if it exists so that the
        // stagedAllocation is kept up to the currentAllocation
        if (zcfSeat.hasStagedAllocation()) {
          zcfSeat.decrementBy(losses);
        }

        // No effects above, apart from decrementBy. Note COMMIT POINT within
        // reallocator.reallocate(). The following two steps *should* be
        // committed atomically, but it is not a disaster if they are
        // not. If we only commit the allocationMinusLosses no one would
        // ever get the unburned assets.
        reallocator.reallocate(zcfSeat, allocationMinusLosses);
        E(zoeMint).withdrawAndBurn(totalToBurn);
      },
    },
  );
};
