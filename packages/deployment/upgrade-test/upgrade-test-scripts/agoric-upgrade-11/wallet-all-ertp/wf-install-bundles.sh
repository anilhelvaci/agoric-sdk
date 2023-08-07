#!/bin/bash

# Install bundles for walletFactory upgrade

# Defaults are suitable for docker upgrade test context
UP11=${UP11:-./upgrade-test-scripts/agoric-upgrade-11}
# For dev, use something like:
# $ cd agoric-sdk/packages/deployment/upgrade-test/upgrade-test-scripts/agoric-upgrade-11
# $ UP11=.. ./wf-install-bundles.sh

# If ,wf-run.log already exists, presume the bundles were already built;
# for example, outside the container.
[ -f /tmp/,wf-run.log ] || (HOME=/tmp/ agoric run $SDK/packages/smart-wallet/scripts/wfup.js >/tmp/,wf-run.log)
$UP11/tools/parseProposals.mjs </tmp/,wf-run.log >/tmp/,wf-run.json
bundles=$(jq -r '.bundles[]' /tmp/,wf-run.json | sort -u)

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
