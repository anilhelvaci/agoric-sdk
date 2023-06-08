import process from 'process';

export function makeStartSubprocessWorkerNode(startSubprocessWorker) {
  // launch a worker in a subprocess (which runs Node.js)
  function startSubprocessWorkerNode(argName, nodeOptions) {
    const supercode = new URL(
      '../supervisors/subprocess-node/supervisor-subprocess-node.js',
      import.meta.url,
    ).pathname;
    const args = nodeOptions ? [...nodeOptions] : [];
    args.push(supercode);
    args.push(argName);
    return startSubprocessWorker(process.execPath, args);
  }

  return startSubprocessWorkerNode;
}
