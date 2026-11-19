import { DetectRecurringSuggestionsService } from './detect-recurring-suggestions.service';
import { RecurringSuggestionDetectionDispatcher } from './recurring-suggestion-detection.dispatcher';

const deferred = () => {
  let complete!: () => void;
  const promise = new Promise<
    Awaited<ReturnType<DetectRecurringSuggestionsService['execute']>>
  >((resolve) => {
    complete = () => resolve('not-due');
  });
  return { promise, resolve: complete };
};

const settle = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const inFlightSize = (dispatcher: RecurringSuggestionDetectionDispatcher) =>
  (dispatcher as unknown as { inFlight: Map<string, Promise<void>> }).inFlight
    .size;

describe('RecurringSuggestionDetectionDispatcher', () => {
  let detection: jest.Mocked<DetectRecurringSuggestionsService>;
  let dispatcher: RecurringSuggestionDetectionDispatcher;

  beforeEach(() => {
    detection = {
      execute: jest.fn().mockResolvedValue('not-due'),
    } as unknown as jest.Mocked<DetectRecurringSuggestionsService>;
    dispatcher = new RecurringSuggestionDetectionDispatcher(detection);
  });

  afterEach(() => jest.clearAllMocks());

  it('coalesces concurrent notifications for the same workspace', async () => {
    const pending = deferred();
    detection.execute.mockReturnValue(pending.promise);

    dispatcher.notify('ws-1');
    dispatcher.notify('ws-1');

    expect(detection.execute).toHaveBeenCalledTimes(1);
    expect(detection.execute).toHaveBeenCalledWith('ws-1');

    pending.resolve();
    await settle();
  });

  it('runs again after a notification that arrived mid-flight', async () => {
    const pending = deferred();
    detection.execute
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue('not-due');

    dispatcher.notify('ws-1');
    dispatcher.notify('ws-1');
    pending.resolve();
    await settle();
    await settle();

    expect(detection.execute).toHaveBeenCalledTimes(2);
    expect(inFlightSize(dispatcher)).toBe(0);
  });

  it('runs exactly twice for a burst of notifications during one flight', async () => {
    const pending = deferred();
    detection.execute
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue('not-due');

    dispatcher.notify('ws-1');
    dispatcher.notify('ws-1');
    dispatcher.notify('ws-1');

    expect(detection.execute).toHaveBeenCalledTimes(1);

    pending.resolve();
    await settle();
    await settle();

    expect(detection.execute).toHaveBeenCalledTimes(2);
  });

  it('starts a new detection once the previous one settled', async () => {
    dispatcher.notify('ws-1');
    await settle();

    dispatcher.notify('ws-1');
    await settle();

    expect(detection.execute).toHaveBeenCalledTimes(2);
  });
});
