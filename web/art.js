/*
 * Art: the round button between Live TV and Settings shows paintings the way a Frame TV's Art Mode does: over the whole
 * screen (landscape-format works only, so the crop stays small), a little softer and warmer than a screen would draw
 * it, with a faint canvas grain and a soft falloff at the edges, and dimmer as the evening comes (the TV's light sensor isn't open to apps: the city's sunrise and
 * sunset stand in for the room's light). A new painting every 3 minutes; its title and painter for the first 45 seconds.
 * Any button goes back to the home screen.
 *
 * The paintings: public-domain Impressionism and landscapes from The Metropolitan Museum of Art's Open Access collection
 * (European Paintings), no key. The list of works is read once a week and kept; each painting's record when it's shown.
 * Plain ES5, like the rest of web/.
 */
var Art = (function () {
  'use strict';

  var SEARCH = 'https://collectionapi.metmuseum.org/public/collection/v1.1/search?departmentId=11&hasImages=true&isPublicDomain=true&limit=100&offset=0&q=';
  var OBJECT = 'https://collectionapi.metmuseum.org/public/collection/v1/objects/';
  var PAINTERS = ['Monet', 'Renoir', 'Pissarro', 'Sisley', 'van Gogh', 'Cezanne', 'Corot', 'Seurat', 'Morisot', 'Cassatt', 'Caillebotte'];
  var EVERY = 3 * 60000, CAPTION = 45000, WEEK = 7 * 864e5;

  function store(key, value) { try { localStorage.setItem('fmtv.art.' + key, JSON.stringify(value)); } catch (e) {} }
  function stored(key) { try { return JSON.parse(localStorage.getItem('fmtv.art.' + key)); } catch (e) { return null; } }

  function getJson(url, done) {
    var x = new XMLHttpRequest(), over = false;
    x.open('GET', url, true);
    x.timeout = 15000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(new Error('HTTP ' + x.status)); return; }
      var o;
      try { o = JSON.parse(x.responseText); } catch (e) { done(e); return; }
      done(null, o);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(new Error('no connection')); } };
    x.send();
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // MARK: - The list of paintings

  var pool = stored('pool');   // {ids: [...], at}
  var fetchingPool = false;

  /** The painters' works, then landscapes, one search after the other; the ones already kept stay meanwhile. */
  function loadPool(done) {
    if (pool && pool.ids.length && Date.now() - pool.at < WEEK) { done(); return; }
    if (fetchingPool) { done(); return; }
    fetchingPool = true;
    var queries = PAINTERS.concat(['landscape']), ids = [], seen = {}, i = 0;
    (function next() {
      if (i >= queries.length) {
        fetchingPool = false;
        if (ids.length) { pool = {ids: shuffle(ids), at: Date.now()}; store('pool', pool); }
        done();
        return;
      }
      getJson(SEARCH + encodeURIComponent(queries[i++]), function (err, o) {
        var list = (!err && o && o.objectIDs) || [];
        for (var k = 0; k < list.length; k++) if (!seen[list[k]]) { seen[list[k]] = true; ids.push(list[k]); }
        next();
      });
    })();
  }

  // MARK: - Showing them

  var on = false, timer = 0, captionTimer = 0, index = stored('index') || 0, layer = null;
  var narrow = stored('narrow') || {};   // works found to be portrait-format, left out from then on

  /**
   * Landscapes and scenery only, by The Met's subject tags: at least one place-or-nature tag, and none of nudes, religious
   * scenes or portraits (a living room, not a gallery's every room).
   */
  var SCENERY = /landscape|seascape|cityscape|river|pond|lake|sea\b|ocean|coast|beach|mountain|forest|tree|garden|water lil|bridge|field|harbor|harbour|village|snow|sunset|sunrise|cliff|valley|meadow|haystack|boat/i;
  var NOT_HERE = /nude|bacchant|venus|nymph|christ|saint|virgin|madonna|crucifi|religio|biblical|angel|portrait|death|battle/i;
  function scenery(o) {
    var tags = (o.tags || []).map(function (t) { return t.term || ''; }).join(', ') + ', ' + (o.title || '');
    return SCENERY.test(tags) && !NOT_HERE.test(tags);
  }

  function wide(id, yes) {
    if (yes || narrow[id]) return;
    narrow[id] = 1;
    store('narrow', narrow);
  }

  /** How bright the painting looks: as the room's light goes, from 0.95 at midday to 0.62 late at night. */
  function brightness() {
    var now = new Date(), w = window.Data && Data.weather, mins = now.getHours() * 60 + now.getMinutes();
    function hm(t, fallback) { if (!t) return fallback; var x = new Date(t); return x.getHours() * 60 + x.getMinutes(); }
    var rise = hm(w && w.sunrise, 7 * 60), set = hm(w && w.sunset, 17 * 60), noon = (rise + set) / 2;
    if (mins >= rise && mins <= set) {
      // Day: brightest around noon, a little lower toward sunrise and sunset.
      var half = (set - rise) / 2, f = 1 - Math.abs(mins - noon) / half;
      return 0.84 + 0.11 * f;
    }
    // Evening and night: down over the two hours after sunset to the night level, and back up before sunrise.
    var after = mins > set ? mins - set : mins + 1440 - set, before = mins < rise ? rise - mins : rise + 1440 - mins;
    var t = Math.min(1, Math.min(after, before) / 120);
    return 0.84 - 0.22 * t;
  }

  function applyLight() {
    if (!layer) return;
    var b = brightness().toFixed(3);
    var f = 'brightness(' + b + ') contrast(0.94) saturate(0.92) sepia(0.06)';
    layer.style.webkitFilter = layer.style.filter = f;
  }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /** The next painting: its record, then its image; one that can't be read is skipped. */
  function showNext(tries) {
    if (!on) return;
    clearTimeout(timer);
    if (!pool || !pool.ids.length) { loadPool(function () { if (pool && pool.ids.length) showNext(0); else caption('The paintings couldn\'t be loaded. Check the internet and try again.'); }); return; }
    if (tries > 25) { timer = setTimeout(function () { showNext(0); }, 60000); return; }
    var id = pool.ids[index++ % pool.ids.length];
    store('index', index);
    if (narrow[id]) { showNext(tries); return; }   // a portrait-format work seen before: skipped without a request
    getJson(OBJECT + id, function (err, o) {
      if (!on) return;
      var src = !err && o && o.isPublicDomain && (o.primaryImageSmall || o.primaryImage);
      if (!src) { showNext(tries + 1); return; }
      if (!scenery(o)) { wide(id, false); showNext(tries + 1); return; }   // not a landscape: left out from then on
      var img = new Image();
      img.onload = function () {
        if (!on) return;
        // The painting fills the screen: only landscape-format works, so the crop to 16:9 stays small.
        if (img.width / img.height < 1.2) { wide(id, false); showNext(tries + 1); return; }
        wide(id, true);
        place(img, o);
        timer = setTimeout(function () { showNext(0); }, EVERY);
      };
      img.onerror = function () { showNext(tries + 1); };
      img.src = src;
    });
  }

  /** The painting over the whole screen (cropped a little to 16:9), with the canvas grain over it, fading in. */
  function place(img, o) {
    var stage = layer.querySelector('.stage');
    var old = stage.querySelector('.piece');
    var piece = el('div', 'piece', stage);
    var canvas = el('div', 'canvas', piece);
    canvas.style.backgroundImage = 'url(' + img.src + ')';
    el('div', 'grain', piece);
    el('div', 'edge', piece);
    setTimeout(function () {
      piece.className = 'piece on';
      if (old) { old.className = 'piece'; setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 2500); }
    }, 50);
    var who = o.artistDisplayName || '';
    caption((o.title || '') + (who ? ' — ' + who : '') + (o.objectDate ? ', ' + o.objectDate : ''));
    applyLight();
  }

  function caption(text) {
    var c = layer.querySelector('.caption');
    c.textContent = text;
    c.className = 'caption on';
    clearTimeout(captionTimer);
    captionTimer = setTimeout(function () { c.className = 'caption'; }, CAPTION);
  }

  var lightTimer = 0;

  return {
    isOn: function () { return on; },
    show: function () {
      if (on) return;
      layer = document.getElementById('art');
      layer.innerHTML = '';
      el('div', 'stage', layer);
      el('div', 'caption', layer);
      on = true;
      layer.className = 'layer on';
      applyLight();
      lightTimer = setInterval(applyLight, 60000);
      showNext(0);
    },
    hide: function () {
      if (!on) return;
      on = false;
      clearTimeout(timer);
      clearTimeout(captionTimer);
      clearInterval(lightTimer);
      if (layer) layer.className = 'layer';
    }
  };
})();
