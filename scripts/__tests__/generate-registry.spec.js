const { execSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');

describe('generate-registry.js', () => {
  const scriptPath = path.join(__dirname, '../generate-registry.js');

  it('should pass --check mode with current plugins', () => {
    expect(() => {
      execSync(`node ${scriptPath} --check`, { cwd: rootDir, stdio: 'pipe' });
    }).not.toThrow();
  });

  it('should output valid registry files', () => {
    const output = execSync(`node ${scriptPath} --check`, { cwd: rootDir, encoding: 'utf-8' });
    expect(output).toContain('up to date');
  });
});

describe('merge-prisma-schemas.js', () => {
  const scriptPath = path.join(__dirname, '../merge-prisma-schemas.js');

  it('should pass --check mode with current fragments', () => {
    expect(() => {
      execSync(`node ${scriptPath} --check`, { cwd: rootDir, stdio: 'pipe' });
    }).not.toThrow();
  });

  it('should report valid fragments', () => {
    const output = execSync(`node ${scriptPath} --check`, { cwd: rootDir, encoding: 'utf-8' });
    expect(output).toContain('valid');
  });
});
