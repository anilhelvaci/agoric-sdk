// @ts-check
import '@agoric/zoe/exported.js';

import { E } from '@agoric/eventual-send';
import {
  assertProposalShape,
  getAmountOut,
  makeRatioFromAmounts,
  ceilMultiplyBy,
  floorMultiplyBy,
  floorDivideBy,
} from '@agoric/zoe/src/contractSupport/index.js';
import { observeNotifier } from '@agoric/notifier';
import {
  invertRatio,
  multiplyRatios,
} from '@agoric/zoe/src/contractSupport/ratio.js';
import { AmountMath } from '@agoric/ertp';
import { Far } from '@endo/marshal';
import { defineKind } from './nonvirtualStore.js';
import { makeTracer } from '../makeTracer.js';
import { setupOuter } from './vaultKit.js';

const { details: X, quote: q } = assert;

const trace = makeTracer('Vault');

// a Vault is an individual loan, using some collateralType as the
// collateral, and lending RUN to the borrower

/**
 * Constants for vault phase.
 *
 * ACTIVE       - vault is in use and can be changed
 * LIQUIDATING  - vault is being liquidated by the vault manager, and cannot be changed by the user
 * TRANSFER     - vault is released from the manager and able to be transferred
 * TRANSFER     - vault is able to be transferred (payments and debits frozen until it has a new owner)
 * CLOSED       - vault was closed by the user and all assets have been paid out
 * LIQUIDATED   - vault was closed by the manager, with remaining assets paid to owner
 *
 * @typedef {VaultPhase[keyof typeof VaultPhase]} VAULT_PHASE
 */
export const VaultPhase = /** @type {const} */ ({
  ACTIVE: 'active',
  LIQUIDATING: 'liquidating',
  CLOSED: 'closed',
  LIQUIDATED: 'liquidated',
  TRANSFER: 'transfer',
});

/**
 * @type {{[K in VAULT_PHASE]: Array<VAULT_PHASE>}}
 */
const validTransitions = {
  [VaultPhase.ACTIVE]: [
    VaultPhase.LIQUIDATING,
    VaultPhase.TRANSFER,
    VaultPhase.CLOSED,
  ],
  [VaultPhase.LIQUIDATING]: [VaultPhase.LIQUIDATED],
  [VaultPhase.TRANSFER]: [VaultPhase.ACTIVE, VaultPhase.LIQUIDATING],
  [VaultPhase.LIQUIDATED]: [],
  [VaultPhase.CLOSED]: [],
};

/**
 * @typedef {Object} InnerVaultManagerBase
 * @property {(oldDebt: Amount, newDebt: Amount) => void} applyDebtDelta
 * @property {() => Brand} getCollateralBrand
 * @property {ReallocateReward} reallocateReward
 * @property {() => Ratio} getCompoundedInterest - coefficient on existing debt to calculate new debt
 * @property {(oldDebt: Amount, oldCollateral: Amount, vaultId: VaultId) => void} updateVaultPriority
 */

/**
 * @typedef {{
 * idInManager: VaultId,
 * interestSnapshot: Ratio,
 * liquidationSeat: ERef<UserSeat>,
 * liquidationZcfSeat: ZCFSeat,
 * manager: InnerVaultManagerBase & GetVaultParams,
 * managerNotifier: Notifier<unknown>,
 * priceAuthority: ERef<PriceAuthority>,
 * runMint: ZCFMint,
 * runSnapshot: Amount<NatValue>,
 * vaultPhase: VAULT_PHASE
 * vaultSeat: ZCFSeat,
 * zcf: ContractFacet,
 * }} VaultState
 */

/**
 * @param {ContractFacet} zcf
 * @param {InnerVaultManagerBase & GetVaultParams} manager
 * @param {Notifier<unknown>} managerNotifier
 * @param {VaultId} idInManager
 * @param {ZCFMint} runMint
 * @param {ERef<PriceAuthority>} priceAuthority
 * @returns {VaultState}
 */
const init = (
  zcf,
  manager,
  managerNotifier,
  idInManager,
  runMint,
  priceAuthority,
) => {
  const { zcfSeat: liquidationZcfSeat, userSeat: liquidationSeat } =
    zcf.makeEmptySeatKit(undefined);
  return harden({
    // construction params
    zcf,
    manager,
    managerNotifier,
    idInManager,
    runMint,
    priceAuthority,
    // calculated
    interestSnapshot: manager.getCompoundedInterest(),
    liquidationSeat,
    liquidationZcfSeat,
    runSnapshot: AmountMath.makeEmpty(runMint.getIssuerRecord().brand, 'nat'),
    vaultPhase: VaultPhase.ACTIVE,
    // vaultSeat will hold the collateral until the loan is retired. The
    // payout from it will be handed to the user: if the vault dies early
    // (because the vaultFactory vat died), they'll get all their
    // collateral back. If that happens, the issuer for the RUN will be dead,
    // so their loan will be worthless.
    vaultSeat: zcf.makeEmptySeatKit().zcfSeat,
  });
};

/**
 * @param {VaultState} state
 */
const actualize = state => {
  console.log('DEBUG actualize', { state }, state.vaultPhase);

  // #region Phase state
  /** @type {VAULT_PHASE} */
  let phase = VaultPhase.ACTIVE;

  /**
   * @param {VAULT_PHASE} newPhase
   */
  const assignPhase = newPhase => {
    const validNewPhases = validTransitions[phase];
    if (!validNewPhases.includes(newPhase))
      throw new Error(`Vault cannot transition from ${phase} to ${newPhase}`);
    phase = newPhase;
  };

  const assertPhase = allegedPhase => {
    assert(
      phase === allegedPhase,
      X`vault must be ${allegedPhase}, not ${phase}`,
    );
  };

  const assertVaultIsOpen = () => {
    assertPhase(VaultPhase.ACTIVE);
  };

  // #endregion

  // CONSTANTS

  const collateralBrand = state.manager.getCollateralBrand();
  const { brand: runBrand } = state.runMint.getIssuerRecord();

  let outerUpdater;

  /**
   * Called whenever the debt is paid or created through a transaction,
   * but not for interest accrual.
   *
   * @param {Amount<NatValue>} newDebt - principal and all accrued interest
   */
  const updateDebtSnapshot = newDebt => {
    // update local state
    state.runSnapshot = newDebt;
    state.interestSnapshot = state.manager.getCompoundedInterest();
    trace(`${state.idInManager} updateDebtSnapshot`, newDebt.value);
  };

  /**
   * @param {Amount<NatValue>} oldDebt - prior principal and all accrued interest
   * @param {Amount<NatValue>} oldCollateral - actual collateral
   * @param {Amount<NatValue>} newDebt - actual principal and all accrued interest
   */
  const refreshLoanTracking = (oldDebt, oldCollateral, newDebt) => {
    updateDebtSnapshot(newDebt);
    // update vault manager which tracks total debt
    state.manager.applyDebtDelta(oldDebt, newDebt);
    // update position of this vault in liquidation priority queue
    state.manager.updateVaultPriority(
      oldDebt,
      oldCollateral,
      state.idInManager,
    );
  };

  /**
   * The actual current debt, including accrued interest.
   *
   * This looks like a simple getter but it does a lot of the heavy lifting for
   * interest accrual. Rather than updating all records when interest accrues,
   * the vault manager updates just its rolling compounded interest. Here we
   * calculate what the current debt is given what's recorded in this vault and
   * what interest has compounded since this vault record was written.
   *
   * @see getNormalizedDebt
   * @returns {Amount<NatValue>}
   */
  // TODO rename to getActualDebtAmount throughout codebase https://github.com/Agoric/agoric-sdk/issues/4540
  const getDebtAmount = () => {
    // divide compounded interest by the snapshot
    const interestSinceSnapshot = multiplyRatios(
      state.manager.getCompoundedInterest(),
      invertRatio(state.interestSnapshot),
    );

    return floorMultiplyBy(state.runSnapshot, interestSinceSnapshot);
  };

  /**
   * The normalization puts all debts on a common time-independent scale since
   * the launch of this vault manager. This allows the manager to order vaults
   * by their debt-to-collateral ratios without having to mutate the debts as
   * the interest accrues.
   *
   * @see getActualDebAmount
   * @returns {Amount<NatValue>} as if the vault was open at the launch of this manager, before any interest accrued
   */
  // Not in use until https://github.com/Agoric/agoric-sdk/issues/4540
  const getNormalizedDebt = () => {
    return floorMultiplyBy(
      state.runSnapshot,
      invertRatio(state.interestSnapshot),
    );
  };

  const getCollateralAllocated = seat =>
    seat.getAmountAllocated('Collateral', collateralBrand);
  /**
   * @param {ZCFSeat} seat
   * @returns {Amount<NatValue>}
   */
  // @ts-expect-error getAmountAllocated is not yet generic (RUN implies NatValue)
  const getRunAllocated = seat => seat.getAmountAllocated('RUN', runBrand);

  const assertVaultHoldsNoRun = () => {
    const { vaultSeat } = state;
    assert(
      AmountMath.isEmpty(getRunAllocated(vaultSeat)),
      X`Vault should be empty of RUN`,
    );
  };

  const maxDebtFor = async collateralAmount => {
    const { manager, priceAuthority } = state;
    const quoteAmount = await E(priceAuthority).quoteGiven(
      collateralAmount,
      runBrand,
    );
    // floorDivide because we want the debt ceiling lower
    return floorDivideBy(
      getAmountOut(quoteAmount),
      manager.getLiquidationMargin(),
    );
  };

  const assertSufficientCollateral = async (
    collateralAmount,
    proposedRunDebt,
  ) => {
    const maxRun = await maxDebtFor(collateralAmount);
    assert(
      AmountMath.isGTE(maxRun, proposedRunDebt, runBrand),
      X`Requested ${q(proposedRunDebt)} exceeds max ${q(maxRun)}`,
    );
  };

  /**
   *
   * @returns {Amount<NatValue>}
   */
  const getCollateralAmount = () => {
    const { vaultSeat } = state;
    // getCollateralAllocated would return final allocations
    return vaultSeat.hasExited()
      ? AmountMath.makeEmpty(collateralBrand)
      : getCollateralAllocated(vaultSeat);
  };

  const snapshotState = newPhase => {
    const { manager } = state;
    /** @type {VaultUIState} */
    return harden({
      // TODO move manager state to a separate notifer https://github.com/Agoric/agoric-sdk/issues/4540
      interestRate: manager.getInterestRate(),
      liquidationRatio: manager.getLiquidationMargin(),
      debtSnapshot: {
        interest: state.interestSnapshot,
        run: state.runSnapshot,
      },
      locked: getCollateralAmount(),
      debt: getDebtAmount(),
      // newPhase param is so that makeTransferInvitation can finish without setting the vault's phase
      // TODO refactor https://github.com/Agoric/agoric-sdk/issues/4415
      vaultState: newPhase,
    });
  };

  // call this whenever anything changes!
  const updateUiState = () => {
    if (!outerUpdater) {
      console.warn('updateUiState called after outerUpdater removed');
      return;
    }
    /** @type {VaultUIState} */
    const uiState = snapshotState(phase);
    trace('updateUiState', uiState);

    switch (phase) {
      case VaultPhase.ACTIVE:
      case VaultPhase.LIQUIDATING:
        outerUpdater.updateState(uiState);
        break;
      case VaultPhase.CLOSED:
      case VaultPhase.LIQUIDATED:
        outerUpdater.finish(uiState);
        outerUpdater = null;
        break;
      case VaultPhase.TRANSFER:
        // Transfer handles finish()/null itself
        throw Error('no UI updates from transfer state');
      default:
        throw Error(`unreachable vault phase: ${phase}`);
    }
  };
  // XXX Echo notifications from the manager through all vaults
  // TODO move manager state to a separate notifer https://github.com/Agoric/agoric-sdk/issues/4540
  observeNotifier(state.managerNotifier, {
    updateState: () => {
      if (state.vaultPhase !== VaultPhase.CLOSED) {
        updateUiState();
      }
    },
  });

  /**
   * Call must check for and remember shortfall
   *
   * @param {Amount<NatValue>} newDebt
   */
  const liquidated = newDebt => {
    updateDebtSnapshot(newDebt);

    assignPhase(VaultPhase.LIQUIDATED);
    updateUiState();
  };

  const liquidating = () => {
    assignPhase(VaultPhase.LIQUIDATING);
    updateUiState();
  };

  /** @type {OfferHandler} */
  const closeHook = async seat => {
    assertVaultIsOpen();
    assertProposalShape(seat, {
      give: { RUN: null },
      want: { Collateral: null },
    });
    const {
      give: { RUN: runReturned },
      want: { Collateral: _collateralWanted },
    } = seat.getProposal();

    // you're paying off the debt, you get everything back. If you were
    // underwater, we should have liquidated some collateral earlier: we
    // missed our chance.

    // you must pay off the entire remainder but if you offer too much, we won't
    // take more than you owe
    const currentDebt = getDebtAmount();
    assert(
      AmountMath.isGTE(runReturned, currentDebt),
      X`You must pay off the entire debt ${runReturned} > ${currentDebt}`,
    );

    // Return any overpayment
    const { liquidationZcfSeat, runMint, vaultSeat, zcf } = state;
    const { zcfSeat: burnSeat } = zcf.makeEmptySeatKit();
    burnSeat.incrementBy(seat.decrementBy(harden({ RUN: currentDebt })));
    seat.incrementBy(
      vaultSeat.decrementBy(
        harden({ Collateral: getCollateralAllocated(vaultSeat) }),
      ),
    );
    zcf.reallocate(seat, vaultSeat, burnSeat);
    runMint.burnLosses(harden({ RUN: currentDebt }), burnSeat);
    seat.exit();
    burnSeat.exit();
    assignPhase(VaultPhase.CLOSED);
    updateDebtSnapshot(AmountMath.makeEmpty(runBrand, 'nat'));
    updateUiState();

    assertVaultHoldsNoRun();
    vaultSeat.exit();
    liquidationZcfSeat.exit();

    return 'your loan is closed, thank you for your business';
  };

  const makeCloseInvitation = () => {
    assertVaultIsOpen();
    return state.zcf.makeInvitation(closeHook, 'CloseVault');
  };

  // XXX this doesn't need to be in kind's scope
  // The proposal is not allowed to include any keys other than these,
  // usually 'Collateral' and 'RUN'.
  const assertOnlyKeys = (proposal, keys) => {
    const onlyKeys = clause =>
      Object.getOwnPropertyNames(clause).every(c => keys.includes(c));

    assert(
      onlyKeys(proposal.give),
      X`extraneous terms in give: ${proposal.give}`,
    );
    assert(
      onlyKeys(proposal.want),
      X`extraneous terms in want: ${proposal.want}`,
    );
  };

  // Calculate the target level for Collateral for the vaultSeat and
  // clientSeat implied by the proposal. If the proposal wants Collateral,
  // transfer that amount from vault to client. If the proposal gives
  // Collateral, transfer the opposite direction. Otherwise, return the current level.
  const targetCollateralLevels = seat => {
    const { vaultSeat } = state;
    const proposal = seat.getProposal();
    const startVaultAmount = getCollateralAllocated(vaultSeat);
    const startClientAmount = getCollateralAllocated(seat);
    if (proposal.want.Collateral) {
      return {
        vault: AmountMath.subtract(startVaultAmount, proposal.want.Collateral),
        client: AmountMath.add(startClientAmount, proposal.want.Collateral),
      };
    } else if (proposal.give.Collateral) {
      return {
        vault: AmountMath.add(startVaultAmount, proposal.give.Collateral),
        client: AmountMath.subtract(
          startClientAmount,
          proposal.give.Collateral,
        ),
      };
    } else {
      return {
        vault: startVaultAmount,
        client: startClientAmount,
      };
    }
  };

  const transferCollateral = seat => {
    const { vaultSeat } = state;
    const proposal = seat.getProposal();
    if (proposal.want.Collateral) {
      seat.incrementBy(
        vaultSeat.decrementBy(harden({ Collateral: proposal.want.Collateral })),
      );
    } else if (proposal.give.Collateral) {
      vaultSeat.incrementBy(
        seat.decrementBy(harden({ Collateral: proposal.give.Collateral })),
      );
    }
  };

  /**
   * Calculate the target RUN level for the vaultSeat and clientSeat implied
   * by the proposal. If the proposal wants collateral, transfer that amount
   * from vault to client. If the proposal gives collateral, transfer the
   * opposite direction. Otherwise, return the current level.
   *
   * Since we don't allow the debt to go negative, we will reduce the amount we
   * accept when the proposal says to give more RUN than are owed.
   *
   * @param {ZCFSeat} seat
   * @returns {{vault: Amount<NatValue>, client: Amount<NatValue>}}
   */
  const targetRunLevels = seat => {
    const clientAllocation = getRunAllocated(seat);
    const proposal = seat.getProposal();
    if (proposal.want.RUN) {
      return {
        vault: AmountMath.makeEmpty(runBrand, 'nat'),
        // @ts-expect-error proposals not generic (RUN implies NatValue)
        client: AmountMath.add(clientAllocation, proposal.want.RUN),
      };
    } else if (proposal.give.RUN) {
      // We don't allow runDebt to be negative, so we'll refund overpayments
      // TODO this is the same as in `transferRun`
      const currentDebt = getDebtAmount();
      /** @type {Amount<NatValue>} */
      // @ts-expect-error proposals not generic (RUN implies NatValue)
      const acceptedRun = AmountMath.isGTE(proposal.give.RUN, currentDebt)
        ? currentDebt
        : proposal.give.RUN;

      return {
        vault: acceptedRun,
        client: AmountMath.subtract(clientAllocation, acceptedRun),
      };
    } else {
      return {
        vault: AmountMath.makeEmpty(runBrand, 'nat'),
        client: clientAllocation,
      };
    }
  };

  const transferRun = seat => {
    const { vaultSeat } = state;
    const proposal = seat.getProposal();
    if (proposal.want.RUN) {
      seat.incrementBy(
        vaultSeat.decrementBy(harden({ RUN: proposal.want.RUN })),
      );
    } else if (proposal.give.RUN) {
      // We don't allow runDebt to be negative, so we'll refund overpayments
      const currentDebt = getDebtAmount();
      const acceptedRun = AmountMath.isGTE(proposal.give.RUN, currentDebt)
        ? currentDebt
        : proposal.give.RUN;

      vaultSeat.incrementBy(seat.decrementBy(harden({ RUN: acceptedRun })));
    }
  };

  /**
   * Calculate the fee, the amount to mint and the resulting debt
   *
   * @param {ProposalRecord} proposal
   * @param {{vault: Amount<NatValue>, client: Amount<NatValue>}} runAfter
   */
  const loanFee = (proposal, runAfter) => {
    const { manager } = state;
    let newDebt;
    const currentDebt = getDebtAmount();
    let toMint = AmountMath.makeEmpty(runBrand, 'nat');
    let fee = AmountMath.makeEmpty(runBrand, 'nat');
    if (proposal.want.RUN) {
      fee = ceilMultiplyBy(proposal.want.RUN, manager.getLoanFee());
      // @ts-expect-error proposals not generic (RUN implies NatValue)
      toMint = AmountMath.add(proposal.want.RUN, fee);
      newDebt = AmountMath.add(currentDebt, toMint);
    } else if (proposal.give.RUN) {
      newDebt = AmountMath.subtract(currentDebt, runAfter.vault);
    } else {
      newDebt = currentDebt;
    }
    return { newDebt, toMint, fee };
  };

  /**
   * Adjust principal and collateral (atomically for offer safety)
   *
   * @param {ZCFSeat} clientSeat
   */
  const adjustBalancesHook = async clientSeat => {
    const { manager, runMint, vaultSeat } = state;
    assertVaultIsOpen();
    // the updater will change if we start a transfer
    const oldUpdater = outerUpdater;
    const proposal = clientSeat.getProposal();
    const oldDebt = getDebtAmount();
    const oldCollateral = getCollateralAmount();

    assertOnlyKeys(proposal, ['Collateral', 'RUN']);

    const targetCollateralAmount = targetCollateralLevels(clientSeat).vault;
    // max debt supported by current Collateral as modified by proposal
    const maxDebtForOriginalTarget = await maxDebtFor(targetCollateralAmount);
    assert(oldUpdater === outerUpdater, X`Transfer during vault adjustment`);
    assertVaultIsOpen();

    const priceOfCollateralInRun = makeRatioFromAmounts(
      maxDebtForOriginalTarget,
      targetCollateralAmount,
    );

    // After the AWAIT, we retrieve the vault's allocations again.
    const collateralAfter = targetCollateralLevels(clientSeat);
    const runAfter = targetRunLevels(clientSeat);

    // Calculate the fee, the amount to mint and the resulting debt. We'll
    // verify that the target debt doesn't violate the collateralization ratio,
    // then mint, reallocate, and burn.
    const { fee, toMint, newDebt } = loanFee(proposal, runAfter);

    // Get new balances after calling the priceAuthority, so we can compare
    // to the debt limit based on the new values.
    const vaultCollateral =
      collateralAfter.vault || AmountMath.makeEmpty(collateralBrand);

    trace('adjustBalancesHook', {
      targetCollateralAmount,
      vaultCollateral,
      fee,
      toMint,
      newDebt,
    });

    // If the collateral decreased, we pro-rate maxDebt
    if (AmountMath.isGTE(targetCollateralAmount, vaultCollateral)) {
      // We can pro-rate maxDebt because the quote is either linear (price is
      // unchanging) or super-linear (meaning it's an AMM. When the volume sold
      // falls, the proceeds fall less than linearly, so this is a conservative
      // choice.) floorMultiply because the debt ceiling should constrain more.
      const maxDebtAfter = floorMultiplyBy(
        vaultCollateral,
        priceOfCollateralInRun,
      );
      assert(
        AmountMath.isGTE(maxDebtAfter, newDebt),
        X`The requested debt ${q(
          newDebt,
        )} is more than the collateralization ratio allows: ${q(maxDebtAfter)}`,
      );

      // When the re-checked collateral was larger than the original amount, we
      // should restart, unless the new debt is less than the original target
      // (in which case, we're fine to proceed with the reallocate)
    } else if (!AmountMath.isGTE(maxDebtForOriginalTarget, newDebt)) {
      return adjustBalancesHook(clientSeat);
    }

    // mint to vaultSeat, then reallocate to reward and client, then burn from
    // vaultSeat. Would using a separate seat clarify the accounting?
    runMint.mintGains(harden({ RUN: toMint }), vaultSeat);
    transferCollateral(clientSeat);
    transferRun(clientSeat);
    manager.reallocateReward(fee, vaultSeat, clientSeat);

    // parent needs to know about the change in debt
    refreshLoanTracking(oldDebt, oldCollateral, newDebt);

    runMint.burnLosses(harden({ RUN: runAfter.vault }), vaultSeat);

    assertVaultHoldsNoRun();

    updateUiState();
    clientSeat.exit();

    return 'We have adjusted your balances, thank you for your business';
  };

  const makeAdjustBalancesInvitation = () => {
    const { zcf } = state;
    assertVaultIsOpen();
    return zcf.makeInvitation(adjustBalancesHook, 'AdjustBalances');
  };
  // const { idInManager, manager, runMint, vaultSeat } = state;

  /** @type {((seat: ZCFSeat, innerVault: InnerVault) => Promise<import('./vaultKit.js').TransferInvitationHook>)} */
  const initVaultKit = async (seat, innerVault) => {
    const { idInManager, manager, runMint, vaultSeat } = state;
    assert(
      AmountMath.isEmpty(state.runSnapshot),
      X`vault must be empty initially`,
    );
    const oldDebt = getDebtAmount();
    const oldCollateral = getCollateralAmount();
    trace('initVaultKit start: collateral', { oldDebt, oldCollateral });

    // get the payout to provide access to the collateral if the
    // contract abandons
    const {
      give: { Collateral: collateralAmount },
      want: { RUN: wantedRun },
    } = seat.getProposal();

    // todo trigger process() check right away, in case the price dropped while we ran

    const fee = ceilMultiplyBy(wantedRun, manager.getLoanFee());
    if (AmountMath.isEmpty(fee)) {
      throw seat.fail(
        Error('loan requested is too small; cannot accrue interest'),
      );
    }
    trace(idInManager, 'initVault', { wantedRun, fee }, getCollateralAmount());

    const stagedDebt = AmountMath.add(wantedRun, fee);
    await assertSufficientCollateral(collateralAmount, stagedDebt);

    runMint.mintGains(harden({ RUN: stagedDebt }), vaultSeat);

    seat.incrementBy(vaultSeat.decrementBy(harden({ RUN: wantedRun })));
    vaultSeat.incrementBy(
      seat.decrementBy(harden({ Collateral: collateralAmount })),
    );
    manager.reallocateReward(fee, vaultSeat, seat);

    // @ts-expect-error proposals not generic (RUN implies NatValue)
    refreshLoanTracking(oldDebt, oldCollateral, stagedDebt);

    const { transferInvitationHook, updater } = setupOuter(innerVault);
    outerUpdater = updater;
    updateUiState();

    return transferInvitationHook;
  };

  /**
   *
   * @param {ZCFSeat} seat
   * @returns {import('./vaultKit.js').TransferInvitationHook}
   */
  const makeTransferInvitationHook = seat => {
    assertVaultIsOpen();
    seat.exit();

    // eslint-disable-next-line no-use-before-define
    const { transferInvitationHook, updater } = setupOuter(innerVault);
    outerUpdater = updater;
    updateUiState();

    return transferInvitationHook;
  };

  const { liquidationSeat, liquidationZcfSeat, vaultSeat, zcf } = state;
  // bind innerVault for repeated access in this closure
  const innerVault = Far('innerVault', {
    getInnerLiquidationSeat: () => liquidationZcfSeat,
    getVaultSeat: () => vaultSeat,

    initVaultKit: seat => initVaultKit(seat, innerVault),
    liquidating,
    liquidated,

    makeAdjustBalancesInvitation,
    makeCloseInvitation,
    makeTransferInvitation: () => {
      if (outerUpdater) {
        outerUpdater.finish(snapshotState(VaultPhase.TRANSFER));
        outerUpdater = null;
      }
      return zcf.makeInvitation(makeTransferInvitationHook, 'TransferVault');
    },

    // for status/debugging
    getCollateralAmount,
    getDebtAmount,
    getNormalizedDebt,
    getLiquidationSeat: () => liquidationSeat,
  });

  return innerVault;
};

export const makeInnerVault = defineKind('innerVault', init, actualize);

// FIXME type defineKind so this can be typeof makeInnerVault
/** @typedef {ReturnType<typeof actualize>} InnerVault */
