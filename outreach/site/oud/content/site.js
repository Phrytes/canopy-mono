/* site.js — gedeelde instellingen voor de nieuwe site (outreach/site).
 *
 * Naam staat hier als één waarde. Geen e-mailadres op de site; de
 * contactband toont `contact.stub` (site nog in opbouw). Wil je later
 * mailto terug: zet hier `email: "naam@adres.nl"` (of `emailEnc` met
 * base64). Een formulier: zie README.
 */
window.ONDERLING_SITE = {
  name: "Onderling",
  tagline: "Samen dingen regelen — jij houdt de controle over je eigen gegevens.",

  nav: [
    { key: "home",     label: "Wat & waarom",       href: "index.html" },
    { key: "hoe",      label: "Hoe werkt het",      href: "hoe-het-werkt.html" },
    { key: "thuis",    label: "Thuis & privé",      href: "thuis.html" },
    { key: "buurt",    label: "Buurt & omgeving",   href: "buurt.html" },
    { key: "werk",     label: "Werk & maatschappij",href: "werk.html" },
    { key: "techniek", label: "Techniek",           href: "techniek.html" },
    { key: "stand",    label: "Stand van zaken",    href: "stand-van-zaken.html" },
    { key: "vragen",   label: "Vragen",             href: "vragen.html" },
    { key: "contact",  label: "Contact",            href: "contact.html" }
  ],

  contact: {
    heading: "Contact",
    paragraphs: [
      "Dit is werk in ontwikkeling, geen afgerond product."
    ],
    stub:
      "Een manier om contact op te nemen komt hier later — de site is " +
      "nog in opbouw."
  },

  footer:
    "Onderling is een werknaam en kan veranderen. Deze site is werk in " +
    "uitvoering: ze beschrijft hoe het bedoeld is, niet wat al af is."
};
