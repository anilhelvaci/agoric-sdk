# agoric: run: Deploy script will run with Node.js ESM
# bundle-source --to /home/connolly/projects/agoric-sdk/packages/smart-wallet/bundles /home/connolly/projects/agoric-sdk/packages/smart-wallet/src/walletFactory.js walletFactory
# creating upgrade-walletFactory-permit.json
# creating upgrade-walletFactory.js
# You can now run a governance submission command like:

# . ./upgrade-test-scripts/env_setup.sh
. ../env_setup.sh

TITLE="Add NFT/non-vbank support in WalletFactory"

DESC="Upgrade WalletFactory to support non-vbank assets such as NFTs"

agd tx gov submit-proposal \
  swingset-core-eval /tmp/upgrade-walletFactory-permit.json /tmp/upgrade-walletFactory.js \
    --title="$TITLE" --description="$DESC" \
    --from=validator --keyring-backend=test \
    --deposit=10000000ubld \
    --gas=auto --gas-adjustment=1.2 \
    --chain-id=agoriclocal --yes -b block -o json

agd --chain-id=agoriclocal query gov proposals --output json | \
  jq -c '.proposals[] | [.proposal_id,.voting_end_time,.status]';

voteLatestProposalAndWait

# Remember to install bundles before submitting the proposal:
# see wg-install-bundles.sh

