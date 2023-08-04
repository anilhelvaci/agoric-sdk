# agoric: run: Deploy script will run with Node.js ESM
# ...
# Remember to install bundles before submitting the proposal:

echo +++++ install bundles +++++

install_bundle() {
  agd tx swingset install-bundle "@$1" \
    --from gov1 --keyring-backend=test --gas=auto \
    --chain-id=agoriclocal -bblock --yes
}


wf=/tmp/b1-c3005df01654266067b7779d6267037d60f5b995c65a5f8c62b89c4ab42495dfe4ce0914d271399321f6f5575453e56c5e4e8faf791336b9c5177e1d7853c361.json
script=/tmp/b1-5fad04f7560ba9593321df66f4605cba796a2f03643d98044a0d3e8c3b611deb133d7eea003d06fcbb5b5f898bc0ef82b038a18baa740af64f08925e90ff7bb8.json
install_bundle $wf
# install_bundle $script