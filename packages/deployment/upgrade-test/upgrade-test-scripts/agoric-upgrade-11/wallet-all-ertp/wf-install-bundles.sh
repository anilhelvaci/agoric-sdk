#!/bin/bash

# Install bundles for walletFactory upgrade

set -e

SDK=${SDK:-/usr/src/agoric-sdk}
UP11=${UP11:-$SDK/upgrade-test-scripts/agoric-upgrade-11}

cd $UP11/wallet-all-ertp

echo +++ run walletFactory upgrade proposal builder +++
agoric run $SDK/packages/smart-wallet/scripts/wfup.js >/tmp/,run.log
bundles=$($UP11/tools/parseProposals.mjs </tmp/,run.log | jq -r '.bundles[]' | sort -u )

echo +++ proposal evals for later +++
/bin/pwd
ls ./upgrade-walletFactory* ./start-game1*

echo +++++ install bundles +++++

install_bundle() {
  agd tx swingset install-bundle "@$1" \
    --from gov1 --keyring-backend=test --gas=auto \
    --chain-id=agoriclocal -bblock --yes -o json
}

for b in $bundles; do 
  echo installing $b
  install_bundle $b
done
