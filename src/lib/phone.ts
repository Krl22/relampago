/** Normalize call links; local mobiles default to Peru without changing stored/display values. */
export function telephoneHref(phone: string | null | undefined): string | undefined {
  const number = phone?.replace(/[\s().-]/g, "");
  if (!number || !/^\+?\d+$/.test(number)) return undefined;
  if (/^9\d{8}$/.test(number)) return `tel:+51${number}`;
  if (/^519\d{8}$/.test(number)) return `tel:+${number}`;
  if (/^00519\d{8}$/.test(number)) return `tel:+${number.slice(2)}`;
  return `tel:${number}`;
}

/** WhatsApp click-to-chat requires an international number with digits only. */
export function whatsappHref(phone: string | null | undefined): string | undefined {
  const number = telephoneHref(phone)?.slice(4);
  if (!number?.startsWith("+")) return undefined;
  const digits = number.slice(1);
  return /^[1-9]\d{5,14}$/.test(digits) ? `https://wa.me/${digits}` : undefined;
}
