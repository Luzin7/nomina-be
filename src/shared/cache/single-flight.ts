import { Injectable } from '@nestjs/common';

@Injectable()
export class SingleFlight {
  private readonly flights = new Map<string, Promise<unknown>>();

  run<T>(key: string | null, load: () => Promise<T>): Promise<T> {
    if (key === null) return load();

    const inFlight = this.flights.get(key);
    if (inFlight) return inFlight as Promise<T>;

    const flight = load().finally(() => this.flights.delete(key));
    this.flights.set(key, flight);
    return flight;
  }
}
