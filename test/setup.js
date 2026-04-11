import { afterEach } from 'vitest';

if (typeof window !== 'undefined') {
  const [{ cleanup }] = await Promise.all([
    import('@testing-library/react'),
    import('@testing-library/jest-dom/vitest'),
  ]);

  afterEach(() => {
    cleanup();
  });
}
