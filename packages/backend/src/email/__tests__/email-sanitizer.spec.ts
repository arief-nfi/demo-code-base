import { sanitizeEmailHtml } from '../email-sanitizer';

describe('sanitizeEmailHtml', () => {
  it('removes script, iframe, form, style tags and on* attributes', () => {
    const out = sanitizeEmailHtml(
      '<p onclick="steal()">Hi</p><script>alert(1)</script><iframe src="https://x.test"></iframe>' +
        '<form action="https://x.test"><input name="a"></form><style>p{}</style><img src="https://x.test/a.png" onerror="steal()">',
    );

    expect(out).toBe('<p>Hi</p><img src="https://x.test/a.png" />');
  });

  it('removes ping and other unlisted attributes', () => {
    const out = sanitizeEmailHtml('<a href="https://ok.test" ping="https://evil.test" data-x="1" id="a">Go</a>');

    expect(out).toBe('<a href="https://ok.test">Go</a>');
  });

  it('keeps inline style, tables, links and images', () => {
    const html =
      '<table width="600" cellpadding="0" cellspacing="0"><tr><td style="padding:8px" align="center">' +
      '<a href="https://ok.test/x" target="_blank">Open</a><img src="https://cdn.test/logo.png" alt="Logo" width="120" />' +
      '</td></tr></table>';

    expect(sanitizeEmailHtml(html)).toBe(html);
  });

  it('drops javascript: links', () => {
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
  });

  it('drops images that are not http(s)', () => {
    expect(sanitizeEmailHtml('<img src="data:image/png;base64,AAAA" />')).toBe('<img />');
  });

  it('drops comments', () => {
    expect(sanitizeEmailHtml('<p>a<!-- {{resetUrl}} -->b</p>')).toBe('<p>ab</p>');
  });

  it('leaves Handlebars expressions intact', () => {
    const html = '<p>Hi {{name}}</p>{{#if url}}<a href="{{url}}">Open</a>{{/if}}{{button resetUrl "Reset"}}';

    expect(sanitizeEmailHtml(html)).toBe(html);
  });
});
