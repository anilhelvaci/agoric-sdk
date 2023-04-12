import { atomicTransfer } from '@agoric/contracts';

/**
 * Provide shared support for providing access to fees from a service contract.
 *
 * @param {ZCF} zcf
 * @param {ZCFSeat} feeSeat
 * @param {Brand} feeBrand
 * @param {string} keyword
 */
export const makeMakeCollectFeesInvitation = (
  zcf,
  feeSeat,
  feeBrand,
  keyword,
) => {
  const collectFees = seat => {
    const amount = feeSeat.getAmountAllocated(keyword, feeBrand);
    atomicTransfer(zcf, feeSeat, seat, { [keyword]: amount }, { Fee: amount });

    seat.exit();
    return `paid out ${amount.value}`;
  };

  const makeCollectFeesInvitation = () =>
    zcf.makeInvitation(collectFees, 'collect fees');

  return { makeCollectFeesInvitation };
};
