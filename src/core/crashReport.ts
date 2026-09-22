export interface UiCrash {
  at: number;
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
}

const limited = (value: string | null | undefined, size: number) =>
  value ? value.slice(0, size) : undefined;

export function uiCrash(error: unknown, componentStack?: string | null): UiCrash {
  const value = error instanceof Error ? error : undefined;
  return {
    at: Date.now(),
    name: limited(value?.name, 120) ?? 'UnknownError',
    message: limited(value?.message ?? String(error), 4000) ?? 'Unknown display error',
    stack: limited(value?.stack, 32000),
    componentStack: limited(componentStack, 32000),
  };
}
