#!/bin/bash

# Propose and carry out Wallet Factory upgrade

. ../env_setup.sh

TITLE="Add NFT/non-vbank support in WalletFactory"

DESC="Upgrade WalletFactory to support arbitrary ERTP assets such as NFTs"

[ -f ./upgrade-walletFactory-permit.json ] || (echo run wf-install-bundle.sh first ; exit 1)

agd tx gov submit-proposal \
  swingset-core-eval ./upgrade-walletFactory-permit.json ./upgrade-walletFactory.js \
    --title="$TITLE" --description="$DESC" \
    --from=validator --keyring-backend=test \
    --deposit=10000000ubld \
    --gas=auto --gas-adjustment=1.2 \
    --chain-id=agoriclocal --yes -b block -o json

agd --chain-id=agoriclocal query gov proposals --output json | \
  jq -c '.proposals[] | [.proposal_id,.voting_end_time,.status]';

voteLatestProposalAndWait

