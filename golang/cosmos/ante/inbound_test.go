package ante

import (
	"fmt"
	"reflect"
	"testing"

	swingtypes "github.com/Agoric/agoric-sdk/golang/cosmos/x/swingset/types"
	"github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/types/tx"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	"github.com/gogo/protobuf/proto"
)

func TestInboundAnteHandle(t *testing.T) {
	for _, tt := range []struct {
		name                  string
		checkTx               bool
		tx                    sdk.Tx
		simulate              bool
		inboundQueueLength    int32
		inboundQueueLengthErr error
		inboundLimit          int32
		mempoolLimit          int32
		errMsg                string
	}{
		{
			name: "empty-empty",
			tx:   makeTestTx(),
		},
		{
			name:   "reject-on-zero-allowed",
			tx:     makeTestTx(&swingtypes.MsgDeliverInbound{}),
			errMsg: ErrInboundQueueFull.Error(),
		},
		{
			name:               "has-room",
			tx:                 makeTestTx(&swingtypes.MsgInstallBundle{}),
			inboundLimit:       10,
			inboundQueueLength: 8,
		},
		{
			name:               "at-limit",
			tx:                 makeTestTx(&swingtypes.MsgInstallBundle{}),
			inboundLimit:       10,
			inboundQueueLength: 9,
		},
		{
			name:               "no-room",
			tx:                 makeTestTx(&swingtypes.MsgProvision{}),
			inboundLimit:       10,
			inboundQueueLength: 10,
			errMsg:             ErrInboundQueueFull.Error(),
		},
		{
			name:                  "state-lookup-error",
			tx:                    makeTestTx(&swingtypes.MsgWalletAction{}, &swingtypes.MsgWalletSpendAction{}),
			inboundLimit:          10,
			inboundQueueLengthErr: fmt.Errorf("sunspots"),
			errMsg:                "sunspots",
		},
		{
			name:         "allow-non-swingset-msgs",
			tx:           makeTestTx(&banktypes.MsgSend{}, &banktypes.MsgSend{}),
			inboundLimit: 1,
		},
		{
			name:                  "lazy-queue-length-lookup",
			tx:                    makeTestTx(&banktypes.MsgSend{}, &banktypes.MsgSend{}),
			inboundLimit:          1,
			inboundQueueLengthErr: fmt.Errorf("sunspots"),
		},
		{
			name:               "checktx",
			checkTx:            true,
			tx:                 makeTestTx(&swingtypes.MsgDeliverInbound{}),
			inboundLimit:       10,
			mempoolLimit:       5,
			inboundQueueLength: 7,
			errMsg:             ErrInboundQueueFull.Error(),
		},
		{
			name:         "empty-queue-allowed",
			tx:           makeTestTx(&swingtypes.MsgInstallBundle{}),
			inboundLimit: -1,
			errMsg:       ErrInboundQueueFull.Error(),
		},
		{
			name:               "already-full",
			tx:                 makeTestTx(&swingtypes.MsgProvision{}),
			inboundLimit:       10,
			inboundQueueLength: 10,
			errMsg:             ErrInboundQueueFull.Error(),
		},
		{
			name:               "max-per-tx",
			tx:                 makeTestTx(&swingtypes.MsgWalletAction{}, &swingtypes.MsgWalletSpendAction{}),
			inboundLimit:       10,
			inboundQueueLength: 5,
			errMsg:             ErrInboundQueueFull.Error(),
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ctx := sdk.Context{}.WithIsCheckTx(tt.checkTx)
			emptyQueueAllowed := false
			if tt.inboundLimit == -1 {
				emptyQueueAllowed = true
			}
			mock := mockSwingsetKeeper{
				inboundQueueLength:    tt.inboundQueueLength,
				inboundQueueLengthErr: tt.inboundQueueLengthErr,
				inboundLimit:          tt.inboundLimit,
				mempoolLimit:          tt.mempoolLimit,
				emptyQueueAllowed:     emptyQueueAllowed,
			}
			decorator := NewInboundDecorator(mock)
			newCtx, err := decorator.AnteHandle(ctx, tt.tx, tt.simulate, nilAnteHandler)
			if !reflect.DeepEqual(newCtx, ctx) {
				t.Errorf("want ctx %v, got %v", ctx, newCtx)
			}
			if err != nil {
				if tt.errMsg == "" {
					t.Errorf("want no error, got %s", err.Error())
				} else if err.Error() != tt.errMsg {
					t.Errorf("want error %s, got %s", tt.errMsg, err.Error())
				}
			} else if tt.errMsg != "" {
				t.Errorf("want error %s, got none", tt.errMsg)
			}
		})
	}
}

func makeTestTx(msgs ...proto.Message) sdk.Tx {
	wrappedMsgs := make([]*types.Any, len(msgs))
	for i, m := range msgs {
		any, err := types.NewAnyWithValue(m)
		if err != nil {
			panic(err)
		}
		wrappedMsgs[i] = any
	}
	return &tx.Tx{
		Body: &tx.TxBody{
			Messages: wrappedMsgs,
		},
	}
}

func nilAnteHandler(ctx sdk.Context, tx sdk.Tx, simulate bool) (newCtx sdk.Context, err error) {
	return ctx, nil
}

type mockSwingsetKeeper struct {
	inboundQueueLength    int32
	inboundQueueLengthErr error
	inboundLimit          int32
	mempoolLimit          int32
	emptyQueueAllowed     bool
}

var _ SwingsetKeeper = mockSwingsetKeeper{}

func (msk mockSwingsetKeeper) InboundQueueLength(ctx sdk.Context) (int32, error) {
	return msk.inboundQueueLength, msk.inboundQueueLengthErr
}

func (msk mockSwingsetKeeper) GetState(ctx sdk.Context) swingtypes.State {
	if msk.emptyQueueAllowed {
		return swingtypes.State{}
	}
	return swingtypes.State{
		QueueAllowed: []swingtypes.QueueSize{
			swingtypes.NewQueueSize(swingtypes.QueueInbound, msk.inboundLimit),
			swingtypes.NewQueueSize(swingtypes.QueueInboundMempool, msk.mempoolLimit),
		},
	}
}
