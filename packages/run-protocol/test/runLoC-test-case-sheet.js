import * as CSV from './csvParse.js';

export const TEXT = `
,,,,,,,,,,,,,,,,,,,,
Collateralization Ratio,500%,,,,,,,,,,,,,,,,,,,
BLD Price,$1.25,,,,,,,,,,,,,,,,,,,
RUN limit per BLD,$0.25,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,User State,,,,,
,,,,,,Collateralization Ratio,,RUN Borrowed,,,,Liened BLD,,,RUN Rewards Accumulation,,,RUN Purse,,
,,Test #,Description,User Action Required,RUN per BLD,Before,After,Before,Delta,After,Staked BLD,Before,Delta,After,Before,Delta,After,Before,Delta,After
,,1,Starting LoC,"0,0 -> 100,6000",0.25,500%,,0,100,100,9000,0,6000,6000,,,,50,100,150
,,2,Extending LoC,"100,6000 -> 200,6000",0.25,500%,,100,100,200,9000,6000,0,6000,,,,25,100,125
,,3,Extending LoC - more BLD required,"100,600 -> 1600,10000",0.25,500%,,100,1500,1600,10000,600,9400,10000,,,,200,1500,1700
,,4,Extending LoC - CR increases (FAIL),"1000,8000 -> 1500,8000",0.25,500%,750%,1000,500,1000,80000,8000,0,8000,,,,40,0,40
,,5,Full repayment,"1000,10000 -> 0,0",0.25,500%,,1000,-1000,0,10000,10000,0,0,,,,1200,-1000,200
,,6,Partial repayment - CR remains the same,"1000,10000 -> 950,10000",0.25,500%,,1000,-50,950,10000,10000,0,10000,,,,75,-50,25
,,7,Partial repayment - CR increases*,"100,400 -> 95,400",0.25,500%,750%,100,-5,95,10000,400,0,400,,,,20,-5,15
,,8,Partial repayment from reward stream,,,,,,,,,,,,,,,,,
,,9,Extending LoC - unbonded (FAIL),"100,800 -> 150,800",0.25,500%,,100,50,100,500,800,0,800,,,,10,0,10
,,10,Partial repay - insufficient funds (FAIL),"100,800 -> 50,800",0.25,500%,,100,-50,100,1000,800,0,800,,,,25,-50,25
,,11,Partial repay - unbonded ok,"100,800 -> 50,800",0.25,500%,,100,-50,50,100,800,0,800,,,,75,-50,25
,,12,Add collateral,"100,800 -> 100,2000",0.25,500%,,100,0,100,3000,800,1200,2000,,,,0,0,0
,,13,Add collateral - CR increase ok,"100,400 -> 100,500",0.25,500%,750%,100,0,100,1000,400,100,500,,,,0,0,0
,,14,Add collateral - more BLD required (FAIL),"100,800 -> 100,2000",0.25,500%,,100,0,100,1000,800,1200,800,,,,0,0,0
,,15,Lower collateral,"100,800 -> 100,400",0.25,500%,,100,0,100,1000,800,-400,400,,,,0,0,0
,,16,Lower collateral - CR increase (FAIL),"100,800 -> 100,400",0.25,500%,750%,100,0,100,1000,800,-400,800,,,,0,0,0
,,17,Lower collateral - unbonded ok,"100,800 -> 100,400",0.25,500%,,100,0,100,30,800,-400,400,,,,0,0,0
,,18,Full repayment - CR and unbonded,"100,400 -> 0,0",0.25,500%,750%,100,-100,0,30,400,-400,0,,,,250,-100,150
,,,,,,,,,,,,,,,,,,,,
Dimensions we need to test:,,,,,,,,,,,,,,,,,,,,
RUN request meets the collateralization ratio test,,,,,,,,,,,,,,,,,,,,
User must have enough BLD to bond to meet the request,,,,,,,,,,,,,,,,,,,,
RUN minted does not cross the debt limit threshold,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,
Repayment Examples,,,,,,,,,,,,,,,,,,,,
User repays entire loan with RUN from their own purse,,,,,,,,,,,,,,,,,,,,
User repays partial loan with RUN from their own purse,,,,,,,,,,,,,,,,,,,,
RUN reward stream pays down loan partially,,,,,,,,,,,,,,,,,,,,
`.trim();

export const ROWS = CSV.parse(TEXT);
