export type Clock = () => Date;

export type IdFactory = (prefix: string) => string;

export interface FactoryDependencies {
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
}

export const systemClock: Clock = () => new Date();

export const randomIdFactory: IdFactory = (prefix) => `${prefix}_${randomUUID()}`;

import { randomUUID } from 'node:crypto';

export function resolveClock(dependencies?: FactoryDependencies): Clock {
  return dependencies?.clock ?? systemClock;
}

export function resolveIdFactory(dependencies?: FactoryDependencies): IdFactory {
  return dependencies?.idFactory ?? randomIdFactory;
}
