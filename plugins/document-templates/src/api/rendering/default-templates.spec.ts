import * as fs from 'fs';
import * as path from 'path';
import { RenderingService } from './rendering.service';

const templatesDir = path.join(__dirname, '..', 'defaults', 'templates');
const templateFiles = fs.readdirSync(templatesDir).filter((file) => file.endsWith('.html'));

describe('default document templates', () => {
  const service = new RenderingService({} as never);

  const render = (file: string, logo: string) =>
    service.compileTemplate(fs.readFileSync(path.join(templatesDir, file), 'utf-8'), null, null, null, {
      company: { name: 'Acme', logo },
      items: [],
      currency: 'USD',
    });

  it('has templates to check', () => {
    expect(templateFiles.length).toBeGreaterThan(0);
  });

  it.each(templateFiles)('%s does not use raw {{{ }}} output for admin-controlled data', (file) => {
    expect(fs.readFileSync(path.join(templatesDir, file), 'utf-8')).not.toMatch(/\{\{\{/);
  });

  it.each(templateFiles)('%s escapes the company logo inside the src attribute', (file) => {
    const html = render(file, 'x" onerror="alert(1)');

    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain('src="x&quot; onerror&#x3D;&quot;alert(1)"');
  });

  it.each(templateFiles)('%s still renders a normal uploaded logo path unchanged', (file) => {
    expect(render(file, '/uploads/tenant_acme/config/logo.png')).toContain(
      'src="/uploads/tenant_acme/config/logo.png"',
    );
  });
});
