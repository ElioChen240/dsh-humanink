export function cloneDeep<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneDeep(item)) as T;
  }

  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      clone[key] = cloneDeep(nestedValue);
    }
    return clone as T;
  }

  return value;
}

export function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) {
      freezeDeep(nestedValue);
    }
    Object.freeze(value);
  }
  return value;
}

export function cloneAndFreeze<T>(value: T): T {
  return freezeDeep(cloneDeep(value));
}
