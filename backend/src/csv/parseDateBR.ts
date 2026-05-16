const FALLBACK = "1970-01-01 00:00:00";

export function parseDateBR(date: string, time: string): string {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((date ?? "").trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec((time ?? "").trim());
  if (!d || !t) return FALLBACK;
  const [, dd, mm, yyyy] = d;
  const hh = t[1].padStart(2, "0");
  const min = t[2];
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:00`;
}
