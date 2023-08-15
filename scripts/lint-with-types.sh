#!/bin/sh

# we don't collect type info by default because the EXPERIMENTAL_useProjectService that provides viable perf
# is not yet compatible with running eslint in IDE
export AGORIC_ESLINT_TYPES='keypresent'

# CI and some VMs OOM without this
export NODE_OPTIONS='--max-old-space-size=8192'

# argument used by CI to split this across two jobs
SCOPE=$1

# taking roughly half the time to eslint all packages
PRIMARY_PACKAGES="@agoric/{cosmos,ertp,governance,inter-protocol,swing-store,swingset-vat,vats,wallet,zoe}"

case $SCOPE in
primary)
    yarn lerna run --scope=$PRIMARY_PACKAGES --no-bail lint
    ;;
rest)
    yarn lerna run --ignore=$PRIMARY_PACKAGES --no-bail lint
    ;;
*)
    # all scopes
    yarn lint
    ;;
esac
