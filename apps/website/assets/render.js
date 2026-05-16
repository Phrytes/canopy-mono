/* render.js — bouwt elke pagina uit de losse content-data.
 *
 * Waarom zo: de teksten staan volledig los van de HTML, in content/*.js
 * als gewone data-objecten. Die worden via een klassiek <script> in een
 * globale variabele gezet (window.ONDERLING_SITE / window.ONDERLING_PAGE),
 * zodat de site ook werkt door index.html simpelweg te dubbelklikken —
 * geen server, geen build, geen CORS-gedoe met fetch().
 *
 * De site-indeling (header, navigatie, contactband, voet, blok-types)
 * zit hier; de woorden zitten in content/. Die twee blijven gescheiden.
 */
(function () {
  "use strict";

  var SITE = window.ONDERLING_SITE || {};
  var PAGE = window.ONDERLING_PAGE || {};
  var isIntern = PAGE.key === "intern";

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  /* Paragrafen mogen lichte inline-opmaak bevatten: **vet** en [tekst](url).
     Bewust minimaal — de bron blijft leesbare tekst. */
  function inline(s) {
    var safe = String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/\[(.+?)\]\((.+?)\)/g,
      '<a href="$2">$1</a>');
    return safe;
  }
  function paras(arr, into) {
    (arr || []).forEach(function (t) {
      into.appendChild(el("p", { html: inline(t) }));
    });
  }

  var TRACK_LABEL = {
    lokaal:  "Dichtbij & ondersteund",
    betaald: "Als betaalde dienst"
  };
  var STATUS_LABEL = {
    gedaan:   "loopt al",
    bezig:    "mee bezig",
    volgende: "volgende stap",
    later:    "verderop"
  };
  // Status per toepassing (kaarten + detail-hero). Uitleg op de hub.
  var STATUS_BADGE = {
    loopt:      "loopt al",
    gepland:    "gepland",
    verkenning: "in verkenning"
  };
  function statusBadge(st) {
    if (!st || !STATUS_BADGE[st]) return null;
    return el("span", { class: "status-badge " + st },
      [STATUS_BADGE[st]]);
  }

  function trackTag(track) {
    if (!track) return null;
    return el("span", { class: "tag " + track }, [TRACK_LABEL[track] || track]);
  }

  /* ---- Blok-types ---- */
  var blocks = {
    hero: function (b) {
      var s = el("section", { class: "hero" });
      var sb = statusBadge(b.status);
      if (sb) s.appendChild(sb);
      if (b.kicker) s.appendChild(
        el("p", { class: "kicker" }, [b.kicker]));
      var h1kids = [];
      if (b.name) {                       // systeemnaam, zelfde font/size
        h1kids.push(el("span", { class: "hero-name" }, [b.name + ":"]));
        h1kids.push(el("br"));
      }
      h1kids.push(b.heading);
      s.appendChild(el("h1", null, h1kids));
      if (b.lead) s.appendChild(el("p", { class: "lead", html: inline(b.lead) }));
      if (b.sub)  s.appendChild(el("p", { class: "sub", html: inline(b.sub) }));
      return s;
    },

    prose: function (b) {
      var s = el("section", b.wide ? { class: "wide" } : null);
      if (b.track)   s.appendChild(trackTag(b.track));
      if (b.heading) s.appendChild(el("h2", null, [b.heading]));
      paras(b.paragraphs, s);
      if (b.list) {
        var ul = el("ul", { class: "lede-list" });
        b.list.forEach(function (li) {
          ul.appendChild(el("li", { html: inline(li) }));
        });
        s.appendChild(ul);
      }
      return s;
    },

    cards: function (b) {
      var s = el("section");
      if (b.heading) s.appendChild(el("h2", null, [b.heading]));
      if (b.intro) paras([b.intro], s);
      var grid = el("div", { class: "cards" });
      (b.items || []).forEach(function (it) {
        var kids = [];
        var sb = statusBadge(it.status);
        if (sb) kids.push(sb);
        kids.push(el("h3", null, [it.title]));
        kids.push(el("p", { html: inline(it.body) }));
        if (it.href) {
          kids.push(el("span", { class: "card-more" },
            ["Lees verder →"]));
          grid.appendChild(el("a",
            { class: "card card-link", href: it.href }, kids));
        } else {
          grid.appendChild(el("div", { class: "card" }, kids));
        }
      });
      s.appendChild(grid);
      if (b.after) paras([b.after], s);
      return s;
    },

    tracks: function (b) {
      var s = el("section", { class: "wide" });
      if (b.heading) s.appendChild(el("h2", null, [b.heading]));
      if (b.intro) paras([b.intro], s);
      var grid = el("div", { class: "tracks" });
      (b.items || []).forEach(function (it) {
        var col = el("div", { class: "track " + (it.track || "") });
        // Spoor-badges bewust niet getoond; trackTag()/TRACK_LABEL
        // blijven bestaan zodat tags later kunnen terugkomen.
        col.appendChild(el("h3", null, [it.title]));
        paras(it.paragraphs, col);
        grid.appendChild(col);
      });
      s.appendChild(grid);
      if (b.after) paras([b.after], s);
      return s;
    },

    timeline: function (b) {
      var s = el("section", { class: "wide" });
      if (b.heading) s.appendChild(el("h2", null, [b.heading]));
      if (b.intro) paras([b.intro], s);
      var ol = el("ul", { class: "timeline" });
      (b.items || []).forEach(function (it) {
        var meta = el("div", { class: "meta" }, [
          el("span", { class: "pip" }),
          el("span", { class: "period" }, [it.period]),
          el("span", { class: "status" }, [STATUS_LABEL[it.status] || it.status])
        ]);
        if (it.track) meta.appendChild(
          el("span", { class: "mini-tag " + it.track },
             [TRACK_LABEL[it.track] || it.track]));
        ol.appendChild(el("li", { class: it.status }, [
          meta,
          el("h3", null, [it.heading]),
          el("p", { html: inline(it.body) })
        ]));
      });
      s.appendChild(ol);
      if (b.after) paras([b.after], s);
      return s;
    },

    figure: function (b) {
      var s = el("section", { class: "figure" });
      var art = el("div", { class: "figure-art", role: "img",
        "aria-label": b.alt || "" });
      art.innerHTML = b.svg;            // eigen, vertrouwde SVG (geen invoer)
      s.appendChild(art);
      if (b.caption) s.appendChild(
        el("p", { class: "figure-cap" }, [b.caption]));
      return s;
    },

    backlink: function (b) {
      return el("p", { class: "backlink" },
        [el("a", { href: b.href }, ["← " + (b.label || "Terug")])]);
    },

    dialog: function (b) {
      var s = el("section");
      if (b.heading) s.appendChild(el("h2", null, [b.heading]));
      if (b.intro) paras([b.intro], s);
      var box = el("div", { class: "dialog" });
      (b.turns || []).forEach(function (t) {
        var me = t.who === "jij";
        box.appendChild(el("div", { class: "turn " + (me ? "me" : "bot") }, [
          el("span", { class: "who" }, [me ? "jij" : "de chat"]),
          el("p", { html: inline(t.text) })
        ]));
      });
      s.appendChild(box);
      if (b.after) paras([b.after], s);
      s.appendChild(el("p", { class: "dialog-note" }, [
        b.note ||
        "Voorbeeld. Dit laat zien hoe het zou kunnen werken; de chat kan " +
        "dit op dit moment nog niet."
      ]));
      return s;
    },

    steps: function (b) {
      var s = el("section");
      if (b.heading) s.appendChild(el("h2", null, [b.heading]));
      if (b.intro) paras([b.intro], s);
      var ol = el("ol", { class: "steps" });
      (b.items || []).forEach(function (it) {
        ol.appendChild(el("li", null, [
          el("h3", null, [it.title]),
          el("p", { html: inline(it.body) })
        ]));
      });
      s.appendChild(ol);
      if (b.after) paras([b.after], s);
      return s;
    },

    faq: function (b) {
      var s = el("section");
      if (b.heading) s.appendChild(el("h2", null, [b.heading]));
      if (b.intro) paras([b.intro], s);
      var list = el("div", { class: "faq" });
      (b.items || []).forEach(function (it) {
        list.appendChild(el("div", { class: "qa" }, [
          el("h3", null, [it.q]),
          el("p", { html: inline(it.a) })
        ]));
      });
      s.appendChild(list);
      if (b.after) paras([b.after], s);
      return s;
    },

    note: function (b) {
      return el("div", { class: "note " + (b.variant || "info") },
        [el("p", { html: inline(b.text) })]);
    },

    intern: function (b) {
      return el("div", { class: "intern-note" },
        [el("p", { html: inline(b.text) })]);
    },

    divider: function () { return el("hr", { class: "soft" }); }
  };

  /* ---- Pagina opbouwen ---- */
  function header() {
    var nav = el("nav", { class: "nav", "aria-label": "Hoofdmenu" });
    (SITE.nav || []).forEach(function (item) {
      var a = el("a", { href: item.href }, [item.label]);
      if (item.key === PAGE.key) a.setAttribute("aria-current", "page");
      nav.appendChild(a);
    });
    var brand = el("a", { class: "brand", href: "index.html" });
    brand.innerHTML = inline(SITE.name);
    return el("header", { class: "site-header" },
      [el("div", { class: "bar" }, [brand, isIntern ? null : nav])]);
  }

  function contactBand() {
    var c = SITE.contact || {};
    var inner = el("div", { class: "inner" });
    inner.appendChild(el("h2", null, [c.heading || "Contact"]));
    paras(c.paragraphs, inner);
    if (SITE.email) {
      inner.appendChild(el("a", {
        class: "btn",
        href: "mailto:" + SITE.email +
          (c.subject ? "?subject=" + encodeURIComponent(c.subject) : "")
      }, [c.buttonLabel || "Stuur me een mailtje"]));
      inner.appendChild(el("p", { class: "email-plain" }, [
        "Of rechtstreeks: ",
        el("a", { href: "mailto:" + SITE.email }, [SITE.email])
      ]));
    }
    return el("section", { class: "contact-band" }, [inner]);
  }

  function footer() {
    return el("footer", { class: "site-footer" },
      [el("div", { class: "inner" }, [
        el("p", { html: inline(SITE.footer || "") })
      ])]);
  }

  function build() {
    document.title = (PAGE.title ? PAGE.title + " — " : "") +
      (SITE.name || "");
    document.documentElement.lang = "nl";
    if (isIntern) document.body.classList.add("intern");

    var root = document.getElementById("app");
    root.appendChild(el("a", { class: "skip", href: "#main" },
      ["Naar de inhoud"]));

    if (isIntern && PAGE.internBanner) {
      root.appendChild(el("div", { class: "intern-banner" },
        [PAGE.internBanner]));
    }

    root.appendChild(header());

    var main = el("main", { id: "main" });
    (PAGE.blocks || []).forEach(function (b) {
      var fn = blocks[b.type];
      if (fn) main.appendChild(fn(b));
    });
    root.appendChild(main);

    if (!isIntern) root.appendChild(contactBand());
    root.appendChild(footer());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
