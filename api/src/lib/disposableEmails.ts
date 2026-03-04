/**
 * Disposable / temporary email domain blocklist.
 * Covers the most widely abused domains used for free credit farming.
 * Updated: 2025. Add to BLOCKED set as new domains appear.
 */

const BLOCKED = new Set([
  // Mailinator family
  "mailinator.com","mailinater.com","mailinator2.com","mailinator.us",
  "suremail.info","chammy.info","tradermail.info","streetwisemail.com",
  // Guerrilla Mail family
  "guerrillamail.com","guerrillamail.net","guerrillamail.org","guerrillamail.de",
  "guerrillamail.info","guerrillamail.biz","grr.la","guerrillamailblock.com",
  "spam4.me","yopmail.com","yopmail.fr","yopmail.gq","cool.fr.nf",
  // Temp Mail family
  "tempmail.com","temp-mail.org","tempmail.net","tempinbox.com",
  "throwam.com","throwam.net","spamgourmet.com","trashmail.com",
  "trashmail.at","trashmail.io","trashmail.me","trashmail.net",
  "trashmail.org","trashinbox.com",
  // 10 Minute Mail
  "10minutemail.com","10minutemail.net","10minutemail.org","10minutemail.de",
  "10minutemail.co.uk","10minutemail.be","10minutemail.cf","10minutemail.ga",
  "10minutemail.gq","10minutemail.ml","10minutemail.ru","10minemail.com",
  "minuteinbox.com","20minutemail.com","33mail.com",
  // Fake inbox / spam services
  "fakeinbox.com","mailnull.com","spambox.us","spambox.info",
  "spambox.me","spambox.org","spamgaps.net","spamhereplease.com",
  "spammotel.com","spamoff.de","spamslicer.com","spamspot.com",
  "spamthis.co.uk","spamtrap.ro","spam.la","spam.su",
  // Discard / throwaway
  "discard.email","discardmail.com","discardmail.de","discardmail.info",
  "disposableaddress.com","disposableinbox.com","disposablemail.com",
  "dispostable.com","throwam.com","throwaway.email","throwam.net",
  // Sharklasers / Guerrilla variants
  "sharklasers.com","guerrillamailblock.com","spam4.me","grr.la",
  "jourrapide.com","antichef.com","antichef.net","antireg.ru",
  // Mailnesia / Maildrop
  "mailnesia.com","maildrop.cc","mailnull.com","mailscrap.com",
  "mailsiphon.com","mailslite.com","mailslot.com","mailsuck.com",
  "mailtemp.info","mailtemp.net","mailzilla.com","mailzilla.org",
  // Cock.li / disposable
  "cock.li","airmail.cc","waifu.club","horsefucker.org","dicksinhisan.us",
  // Throwam, Nada, others
  "nada.email","nada.ltd","throwam.com","nadlanu.com",
  // Fake domains commonly seen in API abuse
  "tempsky.com","emailondeck.com","emailondeck.net","mytrashmail.com",
  "mt2015.com","mt2014.com","spamgourmet.com","spamgourmet.net",
  "dodgit.com","kasmail.com","spaml.com","spaml.de","nomail.xl.cx",
  "filzmail.com","owlpic.com","spamail.de","maildx.com",
  "rcpt.at","spamfree24.org","spamfree.eu","anonymail.dk",
  "binkmail.com","bobmail.info","boximail.com","clrmail.com",
  "courriel.fr.nf","courrieltemporaire.com","crapmail.org",
  "curryworld.de","dayrep.com","deadaddress.com","deadletter.ga",
  "despam.it","despammed.com","devnullmail.com","dfgh.net",
  "digitalsanctuary.com","discardmail.com","disposemail.com",
  "dispostable.com","dm.w3internet.co.uk","dodgeit.com","dodgit.com",
  "donemail.ru","dontreg.com","dontsendmeemail.com","drdrb.com",
  "drdrb.net","dump-email.info","dumpandfuck.com","dumpmail.de",
  "dumpyemail.com","e4ward.com","email60.com","emailias.com",
  "emailinfive.com","emailisvalid.com","emailmiser.com","emailsensei.com",
  "emailtemporanea.com","emailtemporanea.net","emailtemporanea.org",
  "emailto.de","emailwarden.com","emailx.at.hm","emkei.cz",
  "emz.net","enterto.com","ephemail.net","etranquil.com",
  "etranquil.net","etranquil.org","explodemail.com","fakemailgenerator.com",
  "fakemailz.com","fakedemail.com","fastacura.com","fastchevy.com",
  "fastchrysler.com","fastkawasaki.com","fastmazda.com","fastmitsubishi.com",
  "fastnissan.com","fastsubaru.com","fastsuzuki.com","fasttoyota.com",
  "fastyamaha.com","fightallspam.com","filzmail.com","fizmail.com",
  "fleckens.hu","frapmail.com","front14.org","fuckingduh.com",
  "garliclife.com","gehensiemirnichtaufdensack.de","get1mail.com",
  "get2mail.fr","getairmail.com","getmails.eu","getonemail.com",
  "getonemail.net","ghosttexter.de","girlsundertheinfluence.com",
  "gishpuppy.com","givmail.com","glitch.sx","gmai.com",
  "gmial.com","gotmail.com","gotmail.net","gotmail.org",
  "gowikibooks.com","gowikicampus.com","gowikicars.com","gowikifilms.com",
  "gowikigames.com","gowikimusic.com","gowikinetwork.com","gowikitravel.com",
  "gowikitv.com","grandmasmail.com","greensloth.com","gsrv.co.uk",
  "gudanglowongan.com","gustr.com","haltospam.com","harakirimail.com",
  "hartbot.de","herp.in","hidemail.de","hidzz.com","hmamail.com",
  "hopemail.biz","hulapla.de","ieatspam.eu","ieatspam.info",
  "ihateyoualot.info","iheartspam.org","imails.info","inboxalias.com",
  "inboxclean.com","inboxclean.org","inboxstore.me","incognitomail.com",
  "incognitomail.net","incognitomail.org","inoutmail.de","inoutmail.eu",
  "inoutmail.info","inoutmail.net","insorg.org","instaleap.io",
  "ipoo.org","irish2me.com","iwi.net","jetable.com","jetable.fr.nf",
  "jetable.net","jetable.org","jnxjn.com","jourrapide.com",
  "jsrsolutions.com","junk1.tk","just4fun.li","kasmail.com",
  "klassmaster.com","klassmaster.net","klassmaster.org","klzlk.com",
  "koszmail.pl","kurzepost.de","lhsdv.com","lifebyfood.com",
  "link2mail.net","litedrop.com","llogin.de","lol.ovpn.to",
  "lookugly.com","lortemail.dk","lovemeleaveme.com","lr78.com",
  "lroid.com","lukop.dk","m21.cc","mail-filter.com","mail-temporaire.fr",
  "mail.by","mail2rss.org","mailbidon.com","mailbucket.org",
  "mailcat.biz","mailcatch.com","mailde.de","mailde.info",
  "maildrop.cc","mailexpire.com","mailf5.com","mailfall.com",
  "mailfree.ga","mailfreeonline.com","mailguard.me","mailhazard.com",
  "mailimate.com","mailin8r.com","mailinblack.com","mailincubator.com",
  "mailismagic.com","mailme.ir","mailme.lv","mailme24.com",
  "mailmetrash.com","mailmoat.com","mailms.com","mailnew.com",
]);

/**
 * Returns true if the email is from a known disposable / temp-mail domain.
 */
export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return true;
  return BLOCKED.has(domain);
}

/**
 * Returns true if the domain itself is a known disposable domain.
 * Used when you already have the domain extracted (not the full email).
 */
export function isDisposable(domain: string): boolean {
  const d = (domain || "").toLowerCase().trim();
  if (!d) return true;
  return BLOCKED.has(d);
}
