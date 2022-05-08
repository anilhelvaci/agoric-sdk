// @ts-check
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

import { deeplyFulfilled, defangAndTrim, stringify } from './code-gen.js';
import {
  makeCoreProposalBehavior,
  makeEnactCoreProposalsFromBundleCap,
} from './coreProposalBehavior.js';

const { details: X } = assert;

const require = createRequire(import.meta.url);

/**
 * @param {(ModuleSpecifier | FilePath)[]} paths
 * @typedef {string} ModuleSpecifier
 * @typedef {string} FilePath
 */
const pathResolve = (...paths) => {
  const fileName = paths.pop();
  assert(fileName, '>=1 paths required');
  try {
    return require.resolve(fileName, {
      paths,
    });
  } catch (e) {
    return path.resolve(...paths, fileName);
  }
};

/**
 * Format core proposals to be run at bootstrap:
 * SwingSet `bundles` configuration
 * and `code` to execute them, interpolating functions
 * such as `makeCoreProposalBehavior`.
 *
 * Core proposals are proposals for use with swingset-core-eval.
 * In production, they are triggered by BLD holder governance decisions,
 * but for sim-chain and such, they can be declared statically in
 * the chain configuration, in which case they are run at bootstrap.
 *
 * @param {(ModuleSpecifier | FilePath)[]} coreProposals - governance
 * proposals to run at chain bootstrap for scenarios such as sim-chain.
 * @param {FilePath} [dirname]
 * @param {typeof makeEnactCoreProposalsFromBundleCap} [makeEnactCoreProposals]
 */
export const extractCoreProposalBundles = async (
  coreProposals,
  dirname = '.',
  makeEnactCoreProposals = makeEnactCoreProposalsFromBundleCap,
) => {
  dirname = pathResolve(dirname);
  dirname = await fs.promises
    .stat(dirname)
    .then(stbuf => (stbuf.isDirectory() ? dirname : path.dirname(dirname)));

  const bundleToSource = new Map();
  const extracted = await Promise.all(
    coreProposals.map(async (initCore, i) => {
      /** @type {Set<{ bundleID?: string }>} */
      const bundleHandles = new Set();
      /** @type {Map<{ bundleID?: string }, string>} */
      const bundleHandleToSource = new Map();

      console.log(`Parsing core proposal:`, initCore);
      const initPath = pathResolve(dirname, initCore);
      const initDir = path.dirname(initPath);
      const ns = await import(initPath);
      const install = (srcPath, bundlePath) => {
        const absSrc = pathResolve(initDir, srcPath);
        const bundleHandle = {};
        bundleHandleToSource.set(bundleHandle, absSrc);
        if (bundlePath) {
          const absBundle = pathResolve(initDir, bundlePath);
          const oldSource = bundleToSource.get(absBundle);
          if (oldSource) {
            assert.equal(
              oldSource,
              absSrc,
              X`${bundlePath} already installed from ${oldSource}, now ${absSrc}`,
            );
          } else {
            bundleToSource.set(absBundle, absSrc);
          }
        }
        // Don't harden since we need to set the bundleID later.
        bundleHandles.add(bundleHandle);
        return bundleHandle;
      };
      const publishRef = async handleP => {
        const handle = await handleP;
        assert(
          bundleHandles.has(handle),
          X`${handle} not in installed bundles`,
        );
        return handle;
      };
      const proposal = await ns.defaultProposalBuilder({ publishRef, install });

      // Add the proposal bundle handles in sorted order.
      const bundleSpecEntries = [...bundleHandleToSource.entries()]
        .sort(([_hnda, sourcea], [_hndb, sourceb]) => {
          if (sourcea < sourceb) {
            return -1;
          }
          if (sourcea > sourceb) {
            return 1;
          }
          return 0;
        })
        .map(([handle, sourceSpec], j) => {
          // Transform the bundle handle identity into just a bundleID reference.
          handle.bundleID = `coreProposal${i}_${j}`;
          harden(handle);

          /** @type {[string, { sourceSpec: string }]} */
          const specEntry = [handle.bundleID, { sourceSpec }];
          return specEntry;
        });

      // Now that we've assigned all the bundleIDs and hardened the handles, we
      // can extract the behavior bundle.
      const { sourceSpec, getManifestCall } = await deeplyFulfilled(
        harden(proposal),
      );
      const absSrc = pathResolve(initDir, sourceSpec);
      const behaviorBundleHandle = harden({
        bundleID: `coreProposal${i}_behaviors`,
      });

      bundleSpecEntries.unshift([
        behaviorBundleHandle.bundleID,
        { sourceSpec: absSrc },
      ]);

      return harden({
        ref: behaviorBundleHandle,
        call: getManifestCall,
        bundleSpecs: bundleSpecEntries,
      });
    }),
  );

  // Extract all the bundle specs in already-sorted order.
  const bundles = Object.fromEntries(
    extracted.flatMap(({ bundleSpecs }) => bundleSpecs),
  );
  harden(bundles);

  // Extract the manifest references and calls.
  const makeCPArgs = extracted.map(({ ref, call }) => ({ ref, call }));
  harden(makeCPArgs);

  const code = `\
// This is generated by @agoric/cosmic-swingset/src/extract-proposal.js - DO NOT EDIT
/* eslint-disable */

const makeCoreProposalArgs = harden(${stringify(makeCPArgs, true)});

const makeCoreProposalBehavior = ${makeCoreProposalBehavior};

(${makeEnactCoreProposals})({ makeCoreProposalArgs, E });
`;

  // console.debug('created bundles from proposals:', coreProposals, bundles);
  return { bundles, code: defangAndTrim(code) };
};
