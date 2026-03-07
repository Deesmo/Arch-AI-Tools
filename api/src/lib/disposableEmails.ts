/**
 * Disposable email domain detection.
 * Checks against a list of well-known throwaway email providers.
 */

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "tempmail.com", "throwam.com",
  "trashmail.com", "yopmail.com", "sharklasers.com", "guerrillamailblock.com",
  "grr.la", "guerrillamail.info", "guerrillamail.biz", "guerrillamail.de",
  "guerrillamail.net", "guerrillamail.org", "spam4.me", "10minutemail.com",
  "10minutemail.net", "dispostable.com", "mailnull.com", "spamgourmet.com",
  "trashmail.at", "trashmail.io", "trashmail.me", "trashmail.net",
  "fakeinbox.com", "getairmail.com", "filzmail.com", "discard.email",
  "maildrop.cc", "spamfree24.org", "tempinbox.com", "mintemail.com",
  "mt2014.com", "mt2015.com", "mytrashmail.com", "no-spam.ws",
  "nobulk.com", "noclickemail.com", "nomail.xl.cx", "nomail2me.com",
  "nomorespamemails.com", "nospam.ze.tc", "nospamfor.us", "nospammail.net",
  "nowmymail.com", "objectmail.com", "obobbo.com", "odnorazovoe.ru",
  "oneoffmail.com", "onewaymail.com", "online.ms", "onqin.com",
  "mailtemp.info", "dispostable.email", "temp-mail.org", "temp-mail.io",
]);

export function isDisposable(domain: string): boolean {
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.has(domain.toLowerCase());
}
