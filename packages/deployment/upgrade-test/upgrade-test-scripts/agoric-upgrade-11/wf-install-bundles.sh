# agoric: run: Deploy script will run with Node.js ESM
# ...
# Remember to install bundles before submitting the proposal:

echo +++++ install bundles +++++

install_bundle() {
  agd tx swingset install-bundle "@$1" \
    --from gov1 --keyring-backend=test --gas=auto \
    --chain-id=agoriclocal -bblock --yes
}

# @@@TODO: get these bundle hashes from `agoric run` somehow
wf=/tmp/b1-7c302e9318ea1d11ddadef057d9b6c3d6181eca886af583da7d93c9475c18da064680996523d6c1d1af3f4a7901f6bdb61fc584c5ae76d8c47cba0d9302258ef.json
script=/tmp/b1-9a2840e5d2b3e7a4504ff01baff88da8a3285a11cc16ceacb7069a4ccdbafd8daba8c50aae75ad75a71b587b8f3d32d1b93c10c57788395592fe9cefbf055287.json
install_bundle $wf
install_bundle $script