import { Parser } from 'htmlparser2';

export interface SensitivePlacement {
  /** One message per variable found anywhere but a whole `<a href>` */
  problems: string[];
  /** How many times each variable is the entire href of an `<a>` */
  hrefCounts: Record<string, number>;
}

export const misplacedMessage = (name: string) => `"${name}" may only be used as a link address`;

/**
 * A sensitive value (a password-reset link) may appear only as the entire `href`
 * of an `<a>`. Anywhere else — an image URL, another link's query string, a style,
 * text, a comment, the subject — it could be sent to someone else's server.
 * Values are compared after HTML entities are decoded.
 */
export function analyzeSensitivePlacement(html: string, subject: string, values: Record<string, string>): SensitivePlacement {
  const entries = Object.entries(values).filter(([, value]) => value);
  const hrefCounts: Record<string, number> = Object.fromEntries(entries.map(([name]) => [name, 0]));
  if (entries.length === 0) return { problems: [], hrefCounts };

  const misused = new Set<string>();
  const scan = (text: string) => {
    for (const [name, value] of entries) {
      if (text.includes(value)) misused.add(name);
    }
  };

  // The parser delivers one text node or comment in several pieces (it splits
  // around entities), so pieces are joined before scanning.
  let text = '';
  let comment = '';
  const flushText = () => {
    scan(text);
    text = '';
  };

  const parser = new Parser(
    {
      onopentag(tag, attribs) {
        flushText();
        for (const [attr, attrValue] of Object.entries(attribs)) {
          const whole = tag === 'a' && attr === 'href' ? entries.find(([, value]) => attrValue.trim() === value) : undefined;
          if (whole) hrefCounts[whole[0]] += 1;
          else scan(attrValue);
        }
      },
      onclosetag: flushText,
      ontext(piece) {
        text += piece;
      },
      oncomment(piece) {
        comment += piece;
      },
      oncommentend() {
        scan(comment);
        comment = '';
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  flushText();
  scan(subject);

  return { problems: [...misused].map(misplacedMessage), hrefCounts };
}

/** The problems from analyzeSensitivePlacement */
export function sensitivePlacementProblems(html: string, subject: string, values: Record<string, string>): string[] {
  return analyzeSensitivePlacement(html, subject, values).problems;
}
