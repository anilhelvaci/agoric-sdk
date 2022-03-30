/**
 * @typedef {[string, unknown] | [string, unknown, false]} Step
 *
 * @typedef {[string, string, Step[]]} TestCase
 * @type {TestCase[]}
 */
export const CASES = [
  [
    '0',
    'Borrow, pay off',
    [
      ['buyBLD', 80000n],
      ['stakeBLD', 80000n],
      ['lienBLD', 8000n],
      ['borrowRUN', 1000n],
      ['checkRUNBalance', 1000n],
      ['earnRUNReward', 25n],
      ['payoffRUN', 1020n],
      ['checkRUNDebt', 0n],
      ['checkBLDLiened', 0n],
      ['checkRUNBalance', 5n],
    ],
  ],
  [
    '1',
    'Starting LoC',
    [
      ['buyBLD', 9000n],
      ['stakeBLD', 9000n],
      ['checkBLDLiened', 0n],
      ['checkRUNBalance', 0n],
      ['lienBLD', 6000n],
      ['borrowRUN', 100n],
      ['checkRUNDebt', 102n],
      ['checkBLDLiened', 6000n],
      ['checkRUNBalance', 100n],
      ['borrowMoreRUN', 100n],
      ['checkRUNBalance', 200n],
      ['checkRUNDebt', 204n],
      ['checkBLDLiened', 6000n],
      ['stakeBLD', 5000n],
      ['lienBLD', 8000n],
      ['checkBLDLiened', 8000n],
      ['borrowMoreRUN', 1400n],
      ['checkRUNDebt', 1632n],
    ],
  ],
  [
    '4',
    'Extending LoC - CR increases (FAIL)',
    [
      ['buyBLD', 80000n],
      ['stakeBLD', 80000n],
      ['lienBLD', 8000n],
      ['borrowRUN', 1000n],
      ['setMintingRatio', [16n, 100n]],
      ['borrowMoreRUN', 500n, false],
      ['checkRUNBalance', 1000n],
      ['checkBLDLiened', 8000n],
      ['earnRUNReward', 25n],
      ['payoffRUN', 1021n],
      ['checkRUNDebt', 0n],
      ['checkBLDLiened', 0n],
    ],
  ],
  [
    '6',
    'Partial repayment - CR remains the same',
    [
      ['buyBLD', 10000n],
      ['stakeBLD', 10000n],
      ['lienBLD', 10000n],
      ['borrowRUN', 1000n],
      ['payDownRUN', 50n],
      ['checkRUNBalance', 950n],
      ['checkRUNDebt', 970n],
    ],
  ],
  [
    '7',
    'Partial repayment - CR increases*',
    [
      ['buyBLD', 10000n],
      ['stakeBLD', 10000n],
      ['lienBLD', 400n],
      ['borrowRUN', 100n],
      ['setMintingRatio', [16n, 100n]],
      ['payDownRUN', 5n],
      ['checkRUNBalance', 95n],
      ['checkBLDLiened', 400n],
    ],
  ],
  [
    '11',
    'Partial repay - unbonded ok',
    [
      ['buyBLD', 1000n],
      ['stakeBLD', 800n],
      ['lienBLD', 800n],
      ['borrowRUN', 100n],
      ['slash', 700n],
      ['checkBLDLiened', 800n],
      ['checkRUNBalance', 100n],
      ['payDownRUN', 50n],
      ['checkRUNBalance', 50n],
      ['checkBLDLiened', 800n],
      ['checkBLDStaked', 100n],
    ],
  ],
  [
    '14',
    'Add collateral - more BLD required (FAIL)',
    [
      ['buyBLD', 1000n],
      ['stakeBLD', 1000n],
      ['lienBLD', 800n],
      ['borrowRUN', 100n],
      ['borrowMoreRUN', 200n, false],
      ['checkRUNBalance', 100n],
      ['checkBLDLiened', 800n],
    ],
  ],
  [
    '15',
    'Lower collateral',
    [
      ['buyBLD', 1000n],
      ['stakeBLD', 1000n],
      ['lienBLD', 800n],
      ['borrowRUN', 100n],
      ['unlienBLD', 350n],
      ['checkRUNBalance', 100n],
      ['checkBLDLiened', 450n],
    ],
  ],
  [
    '16',
    'Lower collateral - CR increase (FAIL)',
    [
      ['buyBLD', 1000n],
      ['stakeBLD', 1000n],
      ['lienBLD', 800n],
      ['borrowRUN', 100n],
      ['setMintingRatio', [16n, 100n]],
      ['unlienBLD', 400n, false],
      ['checkBLDLiened', 800n],
    ],
  ],
  [
    '17',
    'Lower collateral - unbonded ok',
    [
      ['buyBLD', 1000n],
      ['stakeBLD', 1000n],
      ['earnRUNReward', 5n],
      ['lienBLD', 800n],
      ['borrowRUN', 100n],
      ['slash', 770n],
      ['checkBLDLiened', 800n],
      ['unlienBLD', 375n],
      ['checkRUNBalance', 105n],
      ['checkBLDLiened', 425n],
      ['setMintingRatio', [16n, 100n]],
      ['payoffRUN', 103n],
      ['checkRUNBalance', 3n],
      ['checkBLDLiened', 0n],
    ],
  ],
  [
    '18',
    'Lower collateral by paying off DEBT',
    [
      ['buyBLD', 1000n],
      ['stakeBLD', 1000n],
      ['lienBLD', 800n],
      ['borrowRUN', 190n],
      ['payToUnlien', [100n, 300n]],
      ['checkBLDLiened', 500n],
    ],
  ],
  [
    '19',
    'Watch interest accrue',
    [
      ['buyBLD', 1000n],
      ['stakeBLD', 1000n],
      ['lienBLD', 800n],
      ['borrowRUN', 190n],
      ['checkRUNDebt', 194n],
      ['waitDays', 90n],
      ['checkRUNDebt', 195n],
    ],
  ],
  [
    '20',
    'payoff more than you owe',
    [
      ['buyBLD', 1000n],
      ['stakeBLD', 1000n],
      ['lienBLD', 800n],
      ['borrowRUN', 190n],
      ['checkRUNDebt', 194n],
      ['earnRUNReward', 20n],
      ['payoffRUN', 200n],
      ['checkRUNDebt', 0n],
      ['checkBLDLiened', 0n],
      ['checkRUNBalance', 16n],
    ],
  ],
];
