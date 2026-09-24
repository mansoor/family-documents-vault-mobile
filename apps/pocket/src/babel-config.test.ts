import { transformSync } from '@babel/core';
import path from 'path';

const SOURCE = "console.log('a'); console.warn('b'); console.info('c'); console.error('d');";

function compiled(variant: string | undefined): string {
  const before = process.env.APP_VARIANT;
  if (variant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = variant;
  try {
    return (
      transformSync(SOURCE, {
        filename: path.join(__dirname, 'example.ts'),
        configFile: path.join(__dirname, '..', 'babel.config.js'),
        babelrc: false,
        caller: { name: 'metro', bundler: 'metro', platform: 'android' } as never,
      })?.code ?? ''
    );
  } finally {
    if (before === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = before;
  }
}

describe('console output in builds', () => {
  it.each(['preview', 'release'])('%s keeps only console.error', (variant) => {
    const code = compiled(variant);
    expect(code).not.toMatch(/console\.(log|warn|info)/);
    expect(code).toMatch(/console\.error/);
  });

  it.each([undefined, 'dev', 'e2e'])('%s keeps everything', (variant) => {
    const code = compiled(variant);
    for (const level of ['log', 'warn', 'info', 'error']) expect(code).toContain(`console.${level}`);
  });
});
