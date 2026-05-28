/* site.js — gedeelde site-instellingen.
 *
 * DE WERKNAAM staat hier als één waarde. Wil je 'Onderling' later
 * vervangen? Pas alleen `name` (en eventueel `tagline`) hieronder aan;
 * de hele site neemt het over.
 */
window.ONDERLING_SITE = {
  name: "Onderling",
  tagline: "Samen dingen regelen — wat je inbrengt blijft van jou.",

  // Geen e-mailadres op de site (nog in opbouw). Later weer aanzetten?
  //  - mailto terug: zet hier   email: "naam@adres.nl"   (of emailEnc
  //    met base64:  printf '%s' 'naam@adres.nl' | base64 )
  //  - of een formulier: zie README.
  // Zolang er geen email/form is, toont de contactband `contact.stub`.

  nav: [
    { key: "home",    label: "Wat & waarom",        href: "index.html" },
    { key: "techniek",label: "Hoe het werkt",       href: "hoe-het-werkt.html" },
    { key: "gebruik", label: "Wat los je ermee op", href: "wat-los-je-ermee-op.html" },
    { key: "aanpak",  label: "De aanpak",           href: "de-aanpak.html" },
    { key: "roadmap", label: "Stand van zaken",     href: "roadmap.html" },
    { key: "vragen",  label: "Vragen",              href: "vragen.html" },
    { key: "contact", label: "Contact",             href: "contact.html" }
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
    "uitvoering."
};
