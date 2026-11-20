// GSM 03.38 basic + extension characters. Anything else (e.g. Devanagari)
// forces UCS-2 encoding: 70 chars / single segment, 67 per part when split.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';

export interface SegmentInfo {
  encoding: 'GSM-7' | 'UCS-2';
  length: number;
  segments: number;
  perSegment: number;
  remainingInSegment: number;
}

export function smsSegments(text: string): SegmentInfo {
  const chars = [...text];
  const gsm = chars.every((c) => GSM_BASIC.includes(c) || GSM_EXT.includes(c));
  if (gsm) {
    const length = chars.reduce((n, c) => n + (GSM_EXT.includes(c) ? 2 : 1), 0);
    const single = 160;
    const multi = 153;
    const segments = length <= single ? 1 : Math.ceil(length / multi);
    const perSegment = segments === 1 ? single : multi;
    return { encoding: 'GSM-7', length, segments, perSegment, remainingInSegment: segments * perSegment - length };
  }
  // UCS-2 counts UTF-16 code units.
  const length = text.length;
  const segments = length <= 70 ? 1 : Math.ceil(length / 67);
  const perSegment = segments === 1 ? 70 : 67;
  return { encoding: 'UCS-2', length, segments, perSegment, remainingInSegment: segments * perSegment - length };
}
