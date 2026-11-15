import { SingleFlight } from './single-flight';

const deferred = <T>() => {
  let settle!: (value: T) => void;
  let fail!: (reason: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, resolve: settle, reject: fail };
};

describe('SingleFlight', () => {
  let singleFlight: SingleFlight;

  beforeEach(() => {
    singleFlight = new SingleFlight();
  });

  it('shares one load between concurrent callers of the same key', async () => {
    const gate = deferred<string>();
    const load = jest.fn().mockReturnValue(gate.promise);

    const first = singleFlight.run('k', load);
    const second = singleFlight.run('k', load);
    gate.resolve('value');

    expect(await Promise.all([first, second])).toEqual(['value', 'value']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('runs separate loads for different keys', async () => {
    const load = jest.fn().mockResolvedValue('value');

    await Promise.all([
      singleFlight.run('a', load),
      singleFlight.run('b', load),
    ]);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('loads again after the previous flight settled', async () => {
    const load = jest.fn().mockResolvedValue('value');

    await singleFlight.run('k', load);
    await singleFlight.run('k', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never shares a null key', async () => {
    const load = jest.fn().mockResolvedValue('value');

    await Promise.all([
      singleFlight.run(null, load),
      singleFlight.run(null, load),
    ]);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('rejects every waiter and clears the flight when the load fails', async () => {
    const gate = deferred<string>();
    const failing = jest.fn().mockReturnValue(gate.promise);
    const recovered = jest.fn().mockResolvedValue('value');

    const first = singleFlight.run('k', failing);
    const second = singleFlight.run('k', failing);
    gate.reject(new Error('boom'));

    await expect(first).rejects.toThrow('boom');
    await expect(second).rejects.toThrow('boom');
    expect(await singleFlight.run('k', recovered)).toBe('value');
  });

  it('does not share state between instances', async () => {
    const gate = deferred<string>();
    const load = jest.fn().mockReturnValue(gate.promise);

    const first = singleFlight.run('k', load);
    const second = new SingleFlight().run('k', load);
    gate.resolve('value');
    await Promise.all([first, second]);

    expect(load).toHaveBeenCalledTimes(2);
  });
});
