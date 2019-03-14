import harden from '@agoric/harden';

console.log(`loading bootstrap`);

export default function setup(syscall, helpers) {
  function log(what) {
    helpers.log(what);
    console.log(what);
  }
  log(`bootstrap called`);
  const { E, dispatch, registerRoot } = helpers.makeLiveSlots(
    syscall,
    helpers.vatID,
  );
  const obj0 = {
    bootstrap(argv, vats) {
      const mode = argv[0];
      if (mode === 'flush') {
        Promise.resolve().then(log('then1'));
        Promise.resolve().then(log('then2'));
      } else if (mode === 'e-then') {
        E(vats.left)
          .callRight(1, vats.right)
          .then(r => log(`b.resolved ${r}`), err => log(`b.rejected ${err}`));
      } else if (mode === 'chain1') {
        const p1 = E(vats.left).call2(1);
        const p2 = E(p1).call3(2);
        p2.then(x => log(`b.resolved ${x}`));
        log(`b.call2`);
      } else if (mode === 'chain2') {
        const p1 = E(Promise.resolve(vats.left)).call2(1);
        const p2 = E(p1).call3(2);
        p2.then(x => log(`b.resolved ${x}`));
        log(`b.call2`);
      } else if (mode === 'local1') {
        const t1 = harden({
          foo(arg) {
            log(`local.foo ${arg}`);
            return 2;
          },
        });
        const p1 = E(t1).foo(1);
        p1.then(x => log(`b.resolved ${x}`));
        log(`b.local1.finish`);
      } else {
        throw Error(`unknown mode ${mode}`);
      }
    },
  };

  registerRoot(harden(obj0));
  return dispatch;
}
