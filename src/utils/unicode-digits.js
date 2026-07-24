const DECIMAL_DIGIT = /^\p{Decimal_Number}$/u;

function decimalDigitValue(character) {
  if (!DECIMAL_DIGIT.test(character)) return null;
  const codePoint = character.codePointAt(0);
  let firstCodePoint = codePoint;

  // Unicode decimal-number sets are contiguous runs whose individual digit
  // sets are ten code points long. Some styled mathematical sets touch each
  // other, so the offset is intentionally reduced modulo ten.
  while (firstCodePoint > 0) {
    const previous = String.fromCodePoint(firstCodePoint - 1);
    if (!DECIMAL_DIGIT.test(previous)) break;
    firstCodePoint -= 1;
  }
  return (codePoint - firstCodePoint) % 10;
}

/**
 * Converts every Unicode decimal digit to its canonical ASCII representation
 * while preserving non-digit characters. This keeps localized keyboards usable
 * at protocol boundaries that intentionally store OTPs, phone numbers, and
 * durations as ASCII.
 */
export function normalizeDecimalDigits(value) {
  return [...String(value ?? '')].map((character) => {
    const digit = decimalDigitValue(character);
    return digit === null ? character : String(digit);
  }).join('');
}
