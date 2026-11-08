/*
 * Photos: the round button between Live TV and Settings shows 4K photographs over the whole screen, Frame-TV style:
 * a new one every 30 seconds, its caption for the first 10, dimmer as the evening comes (the TV's light sensor
 * isn't open to apps: the city's sunrise and sunset stand in for the room's light). Any button goes back.
 *
 * Two sources, taken in turn:
 *  - Bing's photo of the day, in true 3840 × 2160 (no key). Bing offers the last 8 days; every one seen is kept here, so
 *    the collection grows by one a day. Shown as wallpaper on this screen, as Microsoft allows.
 *  - Unsplash (unsplash.com): landscape-format photos on the themes in THEMES, sized by Unsplash to 3840 × 2160, with
 *    the photographer credited in the caption, as Unsplash asks. Needs a free access key (CONFIG.unsplash.accessKey,
 *    packed in from unsplash.local.json, which git leaves out); without one, Bing alone.
 * Plain ES5, like the rest of web/.
 */
var Art = (function () {
  'use strict';

  // haven.properties: photo_seconds (30 by default) and photo_themes (Unsplash searches).
  var HAVEN = (window.CONFIG && window.CONFIG.haven) || {};
  var EVERY = Math.max(10, HAVEN.photoSeconds || 30) * 1000, CAPTION = Math.min(10000, EVERY / 3);
  var UNSPLASH_KEY = (window.CONFIG && window.CONFIG.unsplash && window.CONFIG.unsplash.accessKey) || '';
  var THEMES = HAVEN.photoThemes && HAVEN.photoThemes.length ? HAVEN.photoThemes
    : ['landscape', 'nature', 'mountains', 'ocean', 'forest', 'lake', 'aerial landscape', 'night sky'];

  function store(key, value) { try { localStorage.setItem('fmtv.photos.' + key, JSON.stringify(value)); } catch (e) {} }
  function stored(key) { try { return JSON.parse(localStorage.getItem('fmtv.photos.' + key)); } catch (e) { return null; } }

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

  // MARK: - Bing: the photo of the day, every one kept

  var bing = stored('bing') || {photos: [], at: 0};   // photos: [{id, src, caption}]

  function refreshBing(done) {
    if (Date.now() - bing.at < 6 * 3600000 && bing.photos.length) { done(); return; }
    getJson('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=en-GB', function (err, o) {
      var have = {}, list = bing.photos.slice();
      for (var i = 0; i < list.length; i++) have[list[i].id] = true;
      for (var k = 0; !err && o && o.images && k < o.images.length; k++) {
        var im = o.images[k];
        if (!im.urlbase || have[im.urlbase] || im.wp === false) continue;
        // "Lake Braies, Dolomites, Italy (© leonid_tit/Getty Images)" → "Lake Braies, Dolomites, Italy  ·  © leonid_tit/Getty Images"
        list.push({id: im.urlbase, src: 'https://www.bing.com' + im.urlbase + '_UHD.jpg',
          caption: (im.copyright || '').replace(/\s*\((©[^)]*)\)\s*$/, '  ·  $1')});
      }
      if (!err) { bing = {photos: list.slice(-400), at: Date.now()}; store('bing', bing); }
      done();
    });
  }

  // MARK: - Unsplash: landscape-format photos on the themes, 30 at a time

  var unsplash = stored('unsplash') || {photos: [], at: 0}, theme = stored('theme') || 0;

  function refreshUnsplash(done) {
    // A new batch of 30 every 15 minutes: at one photo every 30 seconds, about when the last one has been shown
    // (4 requests an hour, inside Unsplash's 50).
    if (!UNSPLASH_KEY || (unsplash.photos.length > 5 && Date.now() - unsplash.at < 15 * 60000)) { done(); return; }
    var q = THEMES[theme++ % THEMES.length];
    store('theme', theme);
    getJson('https://api.unsplash.com/photos/random?count=30&orientation=landscape&content_filter=high&query='
        + encodeURIComponent(q) + '&client_id=' + encodeURIComponent(UNSPLASH_KEY), function (err, list) {
      var out = [];
      for (var i = 0; !err && list && i < list.length; i++) {
        var p = list[i];
        // Only photos taken big enough for a 4K screen, and wide (the crop to 16:9 stays small).
        if (!p.urls || !p.urls.raw || p.width < 3840 || p.width / p.height < 1.3) continue;
        var where = p.location && (p.location.title || p.location.name);
        var what = p.alt_description ? p.alt_description.charAt(0).toUpperCase() + p.alt_description.slice(1) : '';
        out.push({id: p.id, src: p.urls.raw + '&w=3840&h=2160&fit=crop&crop=entropy&q=85&fm=jpg',
          caption: (where || what) + '  ·  Photo by ' + ((p.user && p.user.name) || 'Unsplash') + ' on Unsplash'});
      }
      if (!err && out.length) { unsplash = {photos: out, at: Date.now()}; queue.unsplash = []; store('unsplash', unsplash); }
      done();
    });
  }

  // MARK: - Showing them

  var on = false, timer = 0, captionTimer = 0, lightTimer = 0, layer = null, turn = stored('turn') || 0;
  var queue = {bing: [], unsplash: []};

  /** The next photo: Bing and Unsplash in turn (two Unsplash for each Bing: Bing's set grows slowly), never the same twice in a row. */
  function nextPhoto() {
    function from(name, all) {
      if (!queue[name].length) queue[name] = shuffle(all.slice());
      return queue[name].shift() || null;
    }
    turn++;
    store('turn', turn);
    var useBing = !UNSPLASH_KEY || !unsplash.photos.length || turn % 3 === 0;
    return (useBing ? from('bing', bing.photos) : from('unsplash', unsplash.photos)) || from('bing', bing.photos) || from('unsplash', unsplash.photos);
  }

  /** How bright the photo looks: as the room's light goes, from full at midday to 0.6 late at night. */
  function brightness() {
    var now = new Date(), w = window.Data && Data.weather, mins = now.getHours() * 60 + now.getMinutes();
    function hm(t, fallback) { if (!t) return fallback; var x = new Date(t); return x.getHours() * 60 + x.getMinutes(); }
    var rise = hm(w && w.sunrise, 7 * 60), set = hm(w && w.sunset, 17 * 60), noon = (rise + set) / 2;
    if (mins >= rise && mins <= set) return 0.88 + 0.12 * (1 - Math.abs(mins - noon) / ((set - rise) / 2));
    var after = mins > set ? mins - set : mins + 1440 - set, before = mins < rise ? rise - mins : rise + 1440 - mins;
    return 0.88 - 0.28 * Math.min(1, Math.min(after, before) / 120);
  }

  function applyLight() {
    if (!layer) return;
    var f = 'brightness(' + brightness().toFixed(3) + ')';
    layer.style.webkitFilter = layer.style.filter = f;
  }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function showNext(tries) {
    if (!on) return;
    clearTimeout(timer);
    var p = nextPhoto();
    if (!p) {
      refreshBing(function () { refreshUnsplash(function () {
        if (!on) return;
        if (bing.photos.length || unsplash.photos.length) showNext(0);
        else caption('The photos couldn\'t be loaded. Check the internet and try again.');
      }); });
      return;
    }
    var img = new Image();
    img.onload = function () {
      if (!on) return;
      place(img, p);
      timer = setTimeout(function () { refreshBing(function () { refreshUnsplash(function () { showNext(0); }); }); }, EVERY);
    };
    img.onerror = function () { if (tries < 5) showNext(tries + 1); else timer = setTimeout(function () { showNext(0); }, 60000); };
    img.src = p.src;
  }

  function place(img, p) {
    var stage = layer.querySelector('.stage');
    var old = stage.querySelector('.piece');
    var piece = el('div', 'piece', stage);
    el('div', 'canvas', piece).style.backgroundImage = 'url(' + img.src + ')';
    setTimeout(function () {
      piece.className = 'piece on';
      if (old) { old.className = 'piece'; setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 2500); }
    }, 50);
    caption(p.caption);
    applyLight();
  }

  function caption(text) {
    var c = layer.querySelector('.caption');
    c.textContent = text;
    c.className = 'caption on';
    clearTimeout(captionTimer);
    captionTimer = setTimeout(function () { c.className = 'caption'; }, CAPTION);
  }

  // MARK: - Clock: one quiet line at the top (time · date · next prayer and how long until it), no box

  var clockTimer = 0;

  /** "Isha in 1h 03m", or "Isha · Iqama in 12 min" between the adhan and the iqama (extras.js). */
  function prayerText() {
    var lines = window.Extras ? Extras.lines() : [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].kind !== 'prayer') continue;
      var name = lines[i].main.split(' ')[0], side = lines[i].side.replace(/\s*·\s*approx\.$/, '');
      return /^Iqama/.test(side) ? name + ' · ' + side : name + ' ' + side;
    }
    return '';
  }

  function tickClock() {
    var line = layer && layer.querySelector('.clockline');
    if (!line) return;
    var now = Date.now(), p = prayerText();
    line.innerHTML = '';
    el('span', 't', line, formatDate('format|h:mm', now));
    el('span', 'dot', line);
    el('span', 's', line, formatDate('format|EEEE d MMMM', now));
    if (p) {
      el('span', 'dot', line);
      var s = el('span', 's p', line);
      var cut = p.indexOf(' ');
      el('b', '', s, cut > 0 ? p.slice(0, cut) : p);
      if (cut > 0) s.appendChild(document.createTextNode(p.slice(cut)));
    }
  }

  return {
    isOn: function () { return on; },
    /** The photos; with `clock`, the time line over them too. */
    show: function (clock) {
      if (on) return;
      layer = document.getElementById('art');
      layer.innerHTML = '';
      el('div', 'stage', layer);
      el('div', 'caption', layer);
      if (clock) {
        el('div', 'clockline', layer);
        tickClock();
        clockTimer = setInterval(tickClock, 10000);
      }
      on = true;
      layer.className = 'layer on';
      applyLight();
      lightTimer = setInterval(applyLight, 60000);
      refreshBing(function () { refreshUnsplash(function () { showNext(0); }); });
    },
    hide: function () {
      if (!on) return;
      on = false;
      clearTimeout(timer);
      clearTimeout(captionTimer);
      clearInterval(lightTimer);
      clearInterval(clockTimer);
      if (layer) layer.className = 'layer';
    }
  };
})();
