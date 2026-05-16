/* site.js — gedeelde site-instellingen.
 *
 * DE WERKNAAM staat hier als één waarde. Wil je 'Onderling' later
 * vervangen? Pas alleen `name` (en eventueel `tagline`) hieronder aan;
 * de hele site neemt het over.
 */
window.ONDERLING_SITE = {
  name: "Onderling",
  tagline: "Samen dingen regelen — wat je inbrengt blijft van jou.",

  email: "fritsderoos@gmail.com",

  nav: [
    { key: "home",    label: "Wat & waarom",        href: "index.html" },
    { key: "gebruik", label: "Wat los je ermee op", href: "wat-los-je-ermee-op.html" },
    { key: "aanpak",  label: "De aanpak",           href: "de-aanpak.html" },
    { key: "techniek",label: "Hoe het werkt",       href: "hoe-het-werkt.html" },
    { key: "roadmap", label: "Stand van zaken",     href: "roadmap.html" },
    { key: "vragen",  label: "Vragen",              href: "vragen.html" },
    { key: "contact", label: "Contact",             href: "contact.html" }
  ],

  contact: {
    heading: "Contact",
    paragraphs: [
      "Dit is werk in ontwikkeling, geen afgerond product. Reageren of " +
      "meedenken kan ook als je alleen nieuwsgierig bent of iets herkent.",
      "Wil je iets kwijt — een vraag, een idee, een buurt of organisatie " +
      "die past, of een mening — dan kan dat hieronder."
    ],
    buttonLabel: "Stuur een bericht",
    subject: "Naar aanleiding van de site"
  },

  footer:
    "Onderling is een werknaam en kan veranderen. Deze site is werk in " +
    "uitvoering."
};
