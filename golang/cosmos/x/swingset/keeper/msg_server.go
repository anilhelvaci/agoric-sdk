package keeper

import (
	"context"

	"github.com/Agoric/agoric-sdk/golang/cosmos/vm"
	"github.com/Agoric/agoric-sdk/golang/cosmos/x/swingset/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

type msgServer struct {
	Keeper
}

// NewMsgServerImpl returns an implementation of the bank MsgServer interface
// for the provided Keeper.
func NewMsgServerImpl(keeper Keeper) types.MsgServer {
	return &msgServer{Keeper: keeper}
}

var _ types.MsgServer = msgServer{}

type deliverInboundAction struct {
	Type        string          `json:"type"`
	Peer        string          `json:"peer"`
	Messages    [][]interface{} `json:"messages"`
	Ack         uint64          `json:"ack"`
	StoragePort int             `json:"storagePort"`
	BlockHeight int64           `json:"blockHeight"`
	BlockTime   int64           `json:"blockTime"`
}

func (keeper msgServer) routeAction(ctx sdk.Context, msg vm.ControllerAdmissionMsg, action vm.Jsonable) error {
	isHighPriority, err := msg.IsHighPriority(ctx, keeper)
	if err != nil {
		return err
	}

	if isHighPriority {
		return keeper.PushHighPriorityAction(ctx, action)
	} else {
		return keeper.PushAction(ctx, action)
	}
}

func (keeper msgServer) DeliverInbound(goCtx context.Context, msg *types.MsgDeliverInbound) (*types.MsgDeliverInboundResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	messages := make([][]interface{}, len(msg.Messages))
	for i, message := range msg.Messages {
		messages[i] = make([]interface{}, 2)
		messages[i][0] = msg.Nums[i]
		messages[i][1] = message
	}

	action := &deliverInboundAction{
		Type:        "DELIVER_INBOUND",
		Peer:        msg.Submitter.String(),
		Messages:    messages,
		Ack:         msg.Ack,
		StoragePort: vm.GetPort("vstorage"),
		BlockHeight: ctx.BlockHeight(),
		BlockTime:   ctx.BlockTime().Unix(),
	}

	err := keeper.routeAction(ctx, msg, action)
	// fmt.Fprintln(os.Stderr, "Returned from SwingSet", out, err)
	if err != nil {
		return nil, err
	}
	return &types.MsgDeliverInboundResponse{}, nil
}

type walletAction struct {
	Type        string `json:"type"` // WALLET_ACTION
	Owner       string `json:"owner"`
	Action      string `json:"action"`
	BlockHeight int64  `json:"blockHeight"`
	BlockTime   int64  `json:"blockTime"`
}

func (keeper msgServer) WalletAction(goCtx context.Context, msg *types.MsgWalletAction) (*types.MsgWalletActionResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	action := &walletAction{
		Type:        "WALLET_ACTION",
		Owner:       msg.Owner.String(),
		Action:      msg.Action,
		BlockHeight: ctx.BlockHeight(),
		BlockTime:   ctx.BlockTime().Unix(),
	}
	// fmt.Fprintf(os.Stderr, "Context is %+v\n", ctx)

	err := keeper.routeAction(ctx, msg, action)
	// fmt.Fprintln(os.Stderr, "Returned from SwingSet", out, err)
	if err != nil {
		return nil, err
	}
	return &types.MsgWalletActionResponse{}, nil
}

type walletSpendAction struct {
	Type        string `json:"type"` // WALLET_SPEND_ACTION
	Owner       string `json:"owner"`
	SpendAction string `json:"spendAction"`
	BlockHeight int64  `json:"blockHeight"`
	BlockTime   int64  `json:"blockTime"`
}

func (keeper msgServer) WalletSpendAction(goCtx context.Context, msg *types.MsgWalletSpendAction) (*types.MsgWalletSpendActionResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	action := &walletSpendAction{
		Type:        "WALLET_SPEND_ACTION",
		Owner:       msg.Owner.String(),
		SpendAction: msg.SpendAction,
		BlockHeight: ctx.BlockHeight(),
		BlockTime:   ctx.BlockTime().Unix(),
	}
	// fmt.Fprintf(os.Stderr, "Context is %+v\n", ctx)
	err := keeper.routeAction(ctx, msg, action)
	if err != nil {
		return nil, err
	}
	return &types.MsgWalletSpendActionResponse{}, nil
}

type provisionAction struct {
	*types.MsgProvision
	Type        string `json:"type"` // PLEASE_PROVISION
	BlockHeight int64  `json:"blockHeight"`
	BlockTime   int64  `json:"blockTime"`
}

func (keeper msgServer) Provision(goCtx context.Context, msg *types.MsgProvision) (*types.MsgProvisionResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	err := keeper.ChargeForProvisioning(ctx, msg.Submitter, msg.Address, msg.PowerFlags)
	if err != nil {
		return nil, err
	}

	action := &provisionAction{
		MsgProvision: msg,
		Type:         "PLEASE_PROVISION",
		BlockHeight:  ctx.BlockHeight(),
		BlockTime:    ctx.BlockTime().Unix(),
	}

	// Create the account, if it doesn't already exist.
	egress := types.NewEgress(msg.Nickname, msg.Address, msg.PowerFlags)
	err = keeper.SetEgress(ctx, egress)
	if err != nil {
		return nil, err
	}

	err = keeper.routeAction(ctx, msg, action)
	// fmt.Fprintln(os.Stderr, "Returned from SwingSet", out, err)
	if err != nil {
		return nil, err
	}

	return &types.MsgProvisionResponse{}, nil
}

type installBundleAction struct {
	*types.MsgInstallBundle
	Type        string `json:"type"` // INSTALL_BUNDLE
	BlockHeight int64  `json:"blockHeight"`
	BlockTime   int64  `json:"blockTime"`
}

func (keeper msgServer) InstallBundle(goCtx context.Context, msg *types.MsgInstallBundle) (*types.MsgInstallBundleResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	action := &installBundleAction{
		MsgInstallBundle: msg,
		Type:             "INSTALL_BUNDLE",
		BlockHeight:      ctx.BlockHeight(),
		BlockTime:        ctx.BlockTime().Unix(),
	}

	err := keeper.routeAction(ctx, msg, action)
	// fmt.Fprintln(os.Stderr, "Returned from SwingSet", out, err)
	if err != nil {
		return nil, err
	}

	return &types.MsgInstallBundleResponse{}, nil
}
