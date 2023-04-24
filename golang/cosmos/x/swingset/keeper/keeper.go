package keeper

import (
	"encoding/json"
	"errors"
	"fmt"
	stdlog "log"
	"math"
	"math/big"

	"github.com/tendermint/tendermint/libs/log"

	"github.com/cosmos/cosmos-sdk/baseapp"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	bankkeeper "github.com/cosmos/cosmos-sdk/x/bank/keeper"
	paramtypes "github.com/cosmos/cosmos-sdk/x/params/types"

	"github.com/Agoric/agoric-sdk/golang/cosmos/vm"
	"github.com/Agoric/agoric-sdk/golang/cosmos/x/swingset/types"
	vstoragekeeper "github.com/Agoric/agoric-sdk/golang/cosmos/x/vstorage/keeper"
	vstoragetypes "github.com/Agoric/agoric-sdk/golang/cosmos/x/vstorage/types"
)

// Top-level paths for chain storage should remain synchronized with
// packages/internal/src/chain-storage-paths.js
const (
	StoragePathActionQueue = "actionQueue"
	StoragePathBeansOwing  = "beansOwing"
	StoragePathEgress      = "egress"
	StoragePathMailbox     = "mailbox"
	StoragePathCustom      = "published"
	StoragePathBundles     = "bundles"
	StoragePathSwingStore  = "swingStore"
)

// 2 ** 256 - 1
var MaxSDKInt = sdk.NewIntFromBigInt(new(big.Int).Sub(new(big.Int).Exp(big.NewInt(2), big.NewInt(256), nil), big.NewInt(1)))

const stateKey string = "state"

// Contextual information about the message source of an action on an inbound queue.
// This context should be unique per inboundQueueRecord.
type actionContext struct {
	// The block height in which the corresponding action was enqueued
	BlockHeight int64 `json:"blockHeight"`
	// The hash of the cosmos transaction that included the message
	// If the action didn't result from a transaction message, a substitute value
	// may be used. For example the VBANK_BALANCE_UPDATE actions use `x/vbank`.
	TxHash string `json:"txHash"`
	// The index of the message within the transaction. If the action didn't
	// result from a cosmos transaction, a number should be chosen to make the
	// actionContext unique. (for example a counter per block and source module).
	MsgIdx int `json:"msgIdx"`
}
type inboundQueueRecord struct {
	Action  vm.Jsonable   `json:"action"`
	Context actionContext `json:"context"`
}

// Keeper maintains the link to data vstorage and exposes getter/setter methods for the various parts of the state machine
type Keeper struct {
	storeKey   sdk.StoreKey
	cdc        codec.Codec
	paramSpace paramtypes.Subspace

	accountKeeper    types.AccountKeeper
	bankKeeper       bankkeeper.Keeper
	vstorageKeeper   vstoragekeeper.Keeper
	feeCollectorName string

	// CallToController dispatches a message to the controlling process
	callToController func(ctx sdk.Context, str string) (string, error)
}

var _ types.SwingSetKeeper = &Keeper{}

// NewKeeper creates a new IBC transfer Keeper instance
func NewKeeper(
	cdc codec.Codec, key sdk.StoreKey, paramSpace paramtypes.Subspace,
	accountKeeper types.AccountKeeper, bankKeeper bankkeeper.Keeper,
	vstorageKeeper vstoragekeeper.Keeper, feeCollectorName string,
	callToController func(ctx sdk.Context, str string) (string, error),
) Keeper {

	// set KeyTable if it has not already been set
	if !paramSpace.HasKeyTable() {
		paramSpace = paramSpace.WithKeyTable(types.ParamKeyTable())
	}

	return Keeper{
		storeKey:         key,
		cdc:              cdc,
		paramSpace:       paramSpace,
		accountKeeper:    accountKeeper,
		bankKeeper:       bankKeeper,
		vstorageKeeper:   vstorageKeeper,
		feeCollectorName: feeCollectorName,
		callToController: callToController,
	}
}

// pushAction appends an action to the controller's specified inbound queue.
// The queue is kept in the kvstore so that changes are properly reverted if the
// kvstore is rolled back.  By the time the block manager runs, it can commit
// its SwingSet transactions without fear of side-effecting the world with
// intermediate transaction state.
//
// The inbound queue's format is documented by `makeChainQueue` in
// `packages/cosmic-swingset/src/helpers/make-queue.js`.
func (k Keeper) pushAction(ctx sdk.Context, inboundQueuePath string, action vm.Jsonable) error {
	txHash, txHashOk := ctx.Context().Value(baseapp.TxHashContextKey).(string)
	if !txHashOk {
		txHash = "unknown"
	}
	msgIdx, msgIdxOk := ctx.Context().Value(baseapp.TxMsgIdxContextKey).(int)
	if !txHashOk || !msgIdxOk {
		stdlog.Printf("error while extracting context for action %q\n", action)
	}
	record := inboundQueueRecord{Action: action, Context: actionContext{BlockHeight: ctx.BlockHeight(), TxHash: txHash, MsgIdx: msgIdx}}
	bz, err := json.Marshal(record)
	if err != nil {
		return err
	}

	// Get the current queue tail, defaulting to zero if its vstorage doesn't exist.
	// The `tail` is the value of the next index to be inserted
	tail, err := k.queueIndex(ctx, inboundQueuePath, "tail")
	if err != nil {
		return err
	}

	if tail.Equal(MaxSDKInt) {
		return errors.New(inboundQueuePath + " overflow")
	}
	nextTail := tail.Add(sdk.NewInt(1))

	// Set the vstorage corresponding to the queue entry for the current tail.
	path := inboundQueuePath + "." + tail.String()
	k.vstorageKeeper.SetStorage(ctx, vstoragetypes.NewStorageEntry(path, string(bz)))

	// Update the tail to point to the next available entry.
	path = inboundQueuePath + ".tail"
	k.vstorageKeeper.SetStorage(ctx, vstoragetypes.NewStorageEntry(path, nextTail.String()))
	return nil
}

// PushAction appends an action to the controller's actionQueue.
func (k Keeper) PushAction(ctx sdk.Context, action vm.Jsonable) error {
	return k.pushAction(ctx, StoragePathActionQueue, action)
}

func (k Keeper) queueIndex(ctx sdk.Context, queuePath string, position string) (sdk.Int, error) {
	// Position should be either "head" or "tail"
	path := queuePath + "." + position
	indexEntry := k.vstorageKeeper.GetEntry(ctx, path)
	if !indexEntry.HasData() {
		return sdk.NewInt(0), nil
	}

	index, ok := sdk.NewIntFromString(indexEntry.StringValue())
	if !ok {
		return index, fmt.Errorf("couldn't parse %s as Int: %s", path, indexEntry.StringValue())
	}
	return index, nil
}

func (k Keeper) queueLength(ctx sdk.Context, queuePath string) (sdk.Int, error) {
	head, err := k.queueIndex(ctx, queuePath, "head")
	if err != nil {
		return sdk.NewInt(0), err
	}
	tail, err := k.queueIndex(ctx, queuePath, "tail")
	if err != nil {
		return sdk.NewInt(0), err
	}
	// The tail index is exclusive
	return tail.Sub(head), nil
}

func (k Keeper) InboundQueueLength(ctx sdk.Context) (int32, error) {
	size := sdk.NewInt(0)
	actionQueueLength, err := k.queueLength(ctx, StoragePathActionQueue)
	if err != nil {
		return 0, err
	}
	size = size.Add(actionQueueLength)

	if !size.IsInt64() {
		return 0, fmt.Errorf("inbound queue size too big: %s", size)
	}

	int64Size := size.Int64()
	if int64Size > math.MaxInt32 {
		return math.MaxInt32, nil
	}
	return int32(int64Size), nil
}

func (k Keeper) UpdateQueueAllowed(ctx sdk.Context) error {
	params := k.GetParams(ctx)
	inboundQueueMax, found := types.QueueSizeEntry(params.QueueMax, types.QueueInbound)
	if !found {
		return errors.New("could not find max inboundQueue size in params")
	}
	inboundMempoolQueueMax := inboundQueueMax / 2

	inboundQueueSize, err := k.InboundQueueLength(ctx)
	if err != nil {
		return err
	}

	var inboundQueueAllowed int32
	if inboundQueueMax > inboundQueueSize {
		inboundQueueAllowed = inboundQueueMax - inboundQueueSize
	}

	var inboundMempoolQueueAllowed int32
	if inboundMempoolQueueMax > inboundQueueSize {
		inboundMempoolQueueAllowed = inboundMempoolQueueMax - inboundQueueSize
	}

	state := k.GetState(ctx)
	state.QueueAllowed = []types.QueueSize{
		{Key: types.QueueInbound, Size_: inboundQueueAllowed},
		{Key: types.QueueInboundMempool, Size_: inboundMempoolQueueAllowed},
	}
	k.SetState(ctx, state)

	return nil
}

// BlockingSend sends a message to the controller and blocks the Golang process
// until the response.  It is orthogonal to PushAction, and should only be used
// by SwingSet to perform block lifecycle events (BEGIN_BLOCK, END_BLOCK,
// COMMIT_BLOCK).
func (k Keeper) BlockingSend(ctx sdk.Context, action vm.Jsonable) (string, error) {
	bz, err := json.Marshal(action)
	if err != nil {
		return "", err
	}
	return k.callToController(ctx, string(bz))
}

func (k Keeper) GetParams(ctx sdk.Context) (params types.Params) {
	k.paramSpace.GetParamSet(ctx, &params)
	return params
}

func (k Keeper) SetParams(ctx sdk.Context, params types.Params) {
	k.paramSpace.SetParamSet(ctx, &params)
}

func (k Keeper) GetState(ctx sdk.Context) types.State {
	store := ctx.KVStore(k.storeKey)
	bz := store.Get([]byte(stateKey))
	state := types.State{}
	k.cdc.MustUnmarshal(bz, &state)
	return state
}

func (k Keeper) SetState(ctx sdk.Context, state types.State) {
	store := ctx.KVStore(k.storeKey)
	bz := k.cdc.MustMarshal(&state)
	store.Set([]byte(stateKey), bz)
}

// GetBeansPerUnit returns a map taken from the current SwingSet parameters from
// a unit (key) string to an unsigned integer amount of beans.
func (k Keeper) GetBeansPerUnit(ctx sdk.Context) map[string]sdk.Uint {
	params := k.GetParams(ctx)
	beansPerUnit := make(map[string]sdk.Uint, len(params.BeansPerUnit))
	for _, bpu := range params.BeansPerUnit {
		beansPerUnit[bpu.Key] = bpu.Beans
	}
	return beansPerUnit
}

func getBeansOwingPathForAddress(addr sdk.AccAddress) string {
	return StoragePathBeansOwing + "." + addr.String()
}

// GetBeansOwing returns the number of beans that the given address owes to
// the FeeAccount but has not yet paid.
func (k Keeper) GetBeansOwing(ctx sdk.Context, addr sdk.AccAddress) sdk.Uint {
	path := getBeansOwingPathForAddress(addr)
	entry := k.vstorageKeeper.GetEntry(ctx, path)
	if !entry.HasData() {
		return sdk.ZeroUint()
	}
	return sdk.NewUintFromString(entry.StringValue())
}

// SetBeansOwing sets the number of beans that the given address owes to the
// feeCollector but has not yet paid.
func (k Keeper) SetBeansOwing(ctx sdk.Context, addr sdk.AccAddress, beans sdk.Uint) {
	path := getBeansOwingPathForAddress(addr)
	k.vstorageKeeper.SetStorage(ctx, vstoragetypes.NewStorageEntry(path, beans.String()))
}

// ChargeBeans charges the given address the given number of beans.  It divides
// the beans into the number to debit immediately vs. the number to store in the
// beansOwing.
func (k Keeper) ChargeBeans(ctx sdk.Context, addr sdk.AccAddress, beans sdk.Uint) error {
	beansPerUnit := k.GetBeansPerUnit(ctx)

	wasOwing := k.GetBeansOwing(ctx, addr)
	nowOwing := wasOwing.Add(beans)

	// Actually debit immediately in integer multiples of the minimum debit, since
	// nowOwing must be less than the minimum debit.
	beansPerMinFeeDebit := beansPerUnit[types.BeansPerMinFeeDebit]
	remainderOwing := nowOwing.Mod(beansPerMinFeeDebit)
	beansToDebit := nowOwing.Sub(remainderOwing)

	// Convert the debit to coins.
	beansPerFeeUnitDec := sdk.NewDecFromBigInt(beansPerUnit[types.BeansPerFeeUnit].BigInt())
	beansToDebitDec := sdk.NewDecFromBigInt(beansToDebit.BigInt())
	feeUnitPrice := k.GetParams(ctx).FeeUnitPrice
	feeDecCoins := sdk.NewDecCoinsFromCoins(feeUnitPrice...).MulDec(beansToDebitDec).QuoDec(beansPerFeeUnitDec)

	// Charge the account immediately if they owe more than BeansPerMinFeeDebit.
	// NOTE: We assume that BeansPerMinFeeDebit is a multiple of BeansPerFeeUnit.
	feeCoins, _ := feeDecCoins.TruncateDecimal()
	if !feeCoins.IsZero() {
		err := k.bankKeeper.SendCoinsFromAccountToModule(ctx, addr, k.feeCollectorName, feeCoins)
		if err != nil {
			return err
		}
	}

	// Record the new owing value, whether we have debited immediately or not
	// (i.e. there is more owing than before, but not enough to debit).
	k.SetBeansOwing(ctx, addr, remainderOwing)
	return nil
}

// makeFeeMenu returns a map from power flag to its fee.  In the case of duplicates, the
// first one wins.
func makeFeeMenu(powerFlagFees []types.PowerFlagFee) map[string]sdk.Coins {
	feeMenu := make(map[string]sdk.Coins, len(powerFlagFees))
	for _, pff := range powerFlagFees {
		if _, ok := feeMenu[pff.PowerFlag]; !ok {
			feeMenu[pff.PowerFlag] = pff.Fee
		}
	}
	return feeMenu
}

var privilegedProvisioningCoins sdk.Coins = sdk.NewCoins(sdk.NewInt64Coin("provisionpass", 1))

func calculateFees(balances sdk.Coins, submitter, addr sdk.AccAddress, powerFlags []string, powerFlagFees []types.PowerFlagFee) (sdk.Coins, error) {
	fees := sdk.NewCoins()

	// See if we have the balance needed for privileged provisioning.
	if balances.IsAllGTE(privilegedProvisioningCoins) {
		// We do, and notably we don't deduct anything from the submitter.
		return fees, nil
	}

	if !submitter.Equals(addr) {
		return nil, fmt.Errorf("submitter is not the same as target address for fee-based provisioning")
	}

	if len(powerFlags) == 0 {
		return nil, fmt.Errorf("must specify powerFlags for fee-based provisioning")
	}

	// Collate the power flags into a map of power flags to the fee coins.
	feeMenu := makeFeeMenu(powerFlagFees)

	// Calculate the total fee according to that map.
	for _, powerFlag := range powerFlags {
		if fee, ok := feeMenu[powerFlag]; ok {
			fees = fees.Add(fee...)
		} else {
			return nil, fmt.Errorf("unrecognized powerFlag: %s", powerFlag)
		}
	}

	return fees, nil
}

func (k Keeper) ChargeForProvisioning(ctx sdk.Context, submitter, addr sdk.AccAddress, powerFlags []string) error {
	balances := k.bankKeeper.GetAllBalances(ctx, submitter)
	fees, err := calculateFees(balances, submitter, addr, powerFlags, k.GetParams(ctx).PowerFlagFees)
	if err != nil {
		return err
	}

	// Deduct the fee from the submitter.
	if fees.IsZero() {
		return nil
	}
	return k.bankKeeper.SendCoinsFromAccountToModule(ctx, submitter, k.feeCollectorName, fees)
}

// GetEgress gets the entire egress struct for a peer
func (k Keeper) GetEgress(ctx sdk.Context, addr sdk.AccAddress) types.Egress {
	path := StoragePathEgress + "." + addr.String()
	entry := k.vstorageKeeper.GetEntry(ctx, path)
	if !entry.HasData() {
		return types.Egress{}
	}

	var egress types.Egress
	err := json.Unmarshal([]byte(entry.StringValue()), &egress)
	if err != nil {
		panic(err)
	}

	return egress
}

// SetEgress sets the egress struct for a peer, and ensures its account exists
func (k Keeper) SetEgress(ctx sdk.Context, egress *types.Egress) error {
	path := StoragePathEgress + "." + egress.Peer.String()

	bz, err := json.Marshal(egress)
	if err != nil {
		return err
	}

	// FIXME: We should use just SetStorageAndNotify here, but solo needs legacy for now.
	k.vstorageKeeper.LegacySetStorageAndNotify(ctx, vstoragetypes.NewStorageEntry(path, string(bz)))

	// Now make sure the corresponding account has been initialised.
	if acc := k.accountKeeper.GetAccount(ctx, egress.Peer); acc != nil {
		// Account already exists.
		return nil
	}

	// Create an account object with the specified address.
	acc := k.accountKeeper.NewAccountWithAddress(ctx, egress.Peer)

	// Store it in the keeper (panics on error).
	k.accountKeeper.SetAccount(ctx, acc)

	// Tell we were successful.
	return nil
}

// Logger returns a module-specific logger.
func (k Keeper) Logger(ctx sdk.Context) log.Logger {
	return ctx.Logger().With("module", fmt.Sprintf("x/%s", types.ModuleName))
}

// GetMailbox gets the entire mailbox struct for a peer
func (k Keeper) GetMailbox(ctx sdk.Context, peer string) string {
	path := StoragePathMailbox + "." + peer
	return k.vstorageKeeper.GetEntry(ctx, path).StringValue()
}

// SetMailbox sets the entire mailbox struct for a peer
func (k Keeper) SetMailbox(ctx sdk.Context, peer string, mailbox string) {
	path := StoragePathMailbox + "." + peer
	// FIXME: We should use just SetStorageAndNotify here, but solo needs legacy for now.
	k.vstorageKeeper.LegacySetStorageAndNotify(ctx, vstoragetypes.NewStorageEntry(path, mailbox))
}

func (k Keeper) ExportSwingStore(ctx sdk.Context) []*vstoragetypes.DataEntry {
	return k.vstorageKeeper.ExportStorageFromPrefix(ctx, StoragePathSwingStore)
}

func (k Keeper) PathToEncodedKey(path string) []byte {
	return k.vstorageKeeper.PathToEncodedKey(path)
}

func (k Keeper) GetStoreName() string {
	return k.vstorageKeeper.GetStoreName()
}
