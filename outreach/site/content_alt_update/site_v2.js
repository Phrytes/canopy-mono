/* site.js — gedeelde instellingen voor de site.
 *
 * Nieuwe navigatie (2026-05): zeven hoofditems, met techniek/
 * waarborgen/waarom/contact als verborgen pagina's via de footer-
 * nav. Vragen-pagina is geschrapt; vragen staan nu onderaan de
 * drie ring-pagina's en op stand-van-zaken (algemeen). Contact is
 * een aparte pagina met stub-mail, alleen bereikbaar via footer.
 *
 * Geen e-mailadres op de site; de contactband toont `contact.stub`.
 * Wil je later mailto terug: zet hier `email: "naam@adres.nl"`
 * (of `emailEnc` met base64). Een formulier: zie README.
 */
window.ONDERLING_SITE = {
  name: "Onderling",
  tagline:
    "Samen iets regelen, zonder je gegevens uit handen te geven.",

  nav: [
    { key: "home",     label: "Wat & waarom",        href: "index.html" },
    { key: "hoe",      label: "Hoe werkt het",       href: "hoe-het-werkt.html" },
    { key: "thuis",    label: "Thuis",               href: "thuis.html" },
    { key: "buurt",    label: "Buurt",               href: "buurt.html" },
    { key: "werk",     label: "Werk & maatschappij", href: "werk.html" },
    { key: "stand",    label: "Stand van zaken",     href: "stand-van-zaken.html" },
    { key: "over",     label: "Over ons",            href: "over.html" }
  ],

  footerNav: [
    { key: "techniek",   label: "Techniek",            href: "techniek.html" },
    { key: "waarborgen", label: "De waarborgen",       href: "waarborgen.html" },
    { key: "waarom",     label: "Waarom dit project",  href: "waarom.html" },
    { key: "contact",    label: "Contact",             href: "contact.html" }
  ],

  contact: {
    heading: "Contact",
    paragraphs: [
      "Dit is werk in ontwikkeling, geen afgerond product."
    ],
    stub:
      "Een manier om contact op te nemen komt hier later — de site " +
      "is nog in opbouw."
  },

  footer:
    "Onderling is een project in opbouw. Deze site beschrijft hoe " +
    "het bedoeld is en hoe ver het is — niet wat al af is."
};
