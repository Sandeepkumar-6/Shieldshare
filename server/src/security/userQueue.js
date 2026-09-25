// Per-key serialization. Evaluations for one user run strictly one after another, so two
// parallel write requests cannot both be scored against a window that lacks the other and
// slip past a threshold together. Different users never wait for each other.

const tails = new Map();

export function runExclusive(key, task) {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(() => undefined, () => undefined);
  tails.set(key, tail);
  tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
