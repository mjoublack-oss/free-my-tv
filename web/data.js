/*
 * What the home screen shows, kept in localStorage so it opens with numbers:
 *  - the picks: what's trending this week and recent releases, only from the streaming apps on this TV (TMDB, with
 *    the person's own free key from config.properties), 3 per hour (up to 6 in Home Settings);
 *  - weather, sunrise and sunset (Open-Meteo, every 30 min) and optional crypto prices (Binance, every 5 min).
 * Settings changed on the TV (Prefs) win over config.properties, as on Android. Built without a city (--generic), the
 * TV's time zone gives the city, and its country the currency and the region (zones.js).
 */
var CONFIG = window.CONFIG || {};

/**
 * Weekday and month names for formatDate on TVs without Intl (strings.js), here where translate.py finds them.
 * "months" is the form next to a day ("28 октября"), as the catalogues' patterns use it.
 */
I18N.dateNames = function (kind) {
  if (kind === 'months') {
    return [tr('monthday|January'), tr('monthday|February'), tr('monthday|March'), tr('monthday|April'),
      tr('monthday|May'), tr('monthday|June'), tr('monthday|July'), tr('monthday|August'), tr('monthday|September'),
      tr('monthday|October'), tr('monthday|November'), tr('monthday|December')];
  }
  if (kind === 'shortMonths') {
    return [tr('month|Jan'), tr('month|Feb'), tr('month|Mar'), tr('month|Apr'), tr('month|May'), tr('month|Jun'),
      tr('month|Jul'), tr('month|Aug'), tr('month|Sep'), tr('month|Oct'), tr('month|Nov'), tr('month|Dec')];
  }
  if (kind === 'weekdays') {
    return [tr('weekday|Sunday'), tr('weekday|Monday'), tr('weekday|Tuesday'), tr('weekday|Wednesday'),
      tr('weekday|Thursday'), tr('weekday|Friday'), tr('weekday|Saturday')];
  }
  return [tr('weekday|Sun'), tr('weekday|Mon'), tr('weekday|Tue'), tr('weekday|Wed'), tr('weekday|Thu'),
    tr('weekday|Fri'), tr('weekday|Sat')];
};

var Place = (function () {
  'use strict';
  var EURO = /^(AT|BE|BG|CY|DE|EE|ES|FI|FR|GR|HR|IE|IT|LT|LU|LV|MT|NL|PT|SI|SK)$/;

  /** A time zone's main city: {country, lat, lon, name}, or null. */
  function zone(name) {
    var all = window.ZONES || {}, v = all[name], hops = 0;
    while (v && v.charAt(0) === '=' && hops++ < 3) { name = v.slice(1); v = all[name]; }
    if (!v) return null;
    var p = v.split(',');
    return {country: p[0], lat: p[1], lon: p[2], name: p[3] || name.slice(name.lastIndexOf('/') + 1).replace(/_/g, ' ')};
  }

  var tz = zone(TV.zone()), set = CONFIG.latitude !== '' && CONFIG.latitude !== undefined;
  var country = (CONFIG.tmdbRegion || (tz ? tz.country : '') || 'US').toUpperCase();
  return {
    lat: set ? CONFIG.latitude : tz ? tz.lat : '40.7128',
    lon: set ? CONFIG.longitude : tz ? tz.lon : '-74.0060',
    city: CONFIG.city || (!set && tz ? tz.name : ''),
    country: country,
    currency: (CONFIG.currency || (country === 'BR' ? 'BRL' : EURO.test(country) ? 'EUR' : 'USD')).toUpperCase(),
    /** Fahrenheit for TVs in the US (by their time zone, or their language when it doesn't tell). */
    fahrenheit: tz ? tz.country === 'US' : /-US$/i.test(navigator.language || '')
  };
})();

var Prefs = (function () {
  'use strict';
  var KEY = 'fmtv.prefs';
  var v = {};
  try { v = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function pick(name, fallback) { return v[name] === undefined ? fallback : v[name]; }
  return {
    version: 0,
    language: function () { return pick('language', CONFIG.language || 'auto'); },
    temperature: function () { return pick('temperature', CONFIG.temperature || 'auto'); },
    theme: function () { return pick('theme', CONFIG.theme || 'auto'); },
    weather: function () { return pick('weather', true); },
    /** OK on the screensaver opens the title it shows, in its app; any other key only closes it (off by default). */
    saverWatch: function () { return pick('saverWatch', false) === true; },
    /** What the screensaver shows: 'photos' (the picks' photos, as it always has) or 'clock' (a clock and the weather). */
    saver: function () { return pick('saver', 'photos') === 'clock' ? 'clock' : 'photos'; },
    /** Dimming over the picture, for a dark room: 'off', 'low', 'medium', 'high' or 'auto' (medium at night). */
    dim: function () { return pick('dim', 'off'); },
    /** The weather card's forecast: 'hours' (the next 6 hours) or 'days' (the next 5 days). */
    forecast: function () { return pick('forecast', 'hours') === 'days' ? 'days' : 'hours'; },
    quotes: function () { return pick('quotes', CONFIG.showCrypto !== false); },
    coin: function (i) { var c = pick('coins', null); return c ? c[i] !== false : true; },
    /** Picks per tab: 3 (as it was) up to 6. */
    cards: function () { var n = pick('cards', 3); return n < 3 ? 3 : n > 6 ? 6 : n; },
    /** Cartoons and anime out of the picks (Home Settings), or config.properties' hide_animation. */
    hideAnimation: function () { return pick('hideAnimation', CONFIG.hideAnimation === true) === true; },
    shelf: function () { return pick('shelf', null); },
    /** The shelf_apps of the build that last set the shelf, so a new one wins once over the TV's choice. */
    shelfConfig: function () { return pick('shelfConfig', ''); },
    /** The weather's city, picked on the TV (Home Settings → City), or config.properties' (or the time zone's). */
    city: function () { return pick('city', Place.city); },
    latitude: function () { return pick('latitude', Place.lat); },
    longitude: function () { return pick('longitude', Place.lon); },
    /** The MDBList key typed on the TV (Home Settings → MDBList key); this build's picks come from MDBList. The names
     * stay "tmdbKey" so the rest of the app keeps its calls; the setting itself is a new one, "mdbKey". */
    tmdbKey: function () { return String(pick('mdbKey', '')).trim(); },
    /** True when a key was typed on the TV. */
    tmdbKeyOnTV: function () { return v.mdbKey !== undefined; },
    setCity: function (name, lat, lon) { v.city = name; v.latitude = lat; v.longitude = lon; save(); this.version++; },
    /** Streaming services (keys like "netflix") whose titles are left out of the picks. */
    serviceOff: function (key) { return pick('servicesOff', []).indexOf(key) >= 0; },
    setServiceOff: function (key, off) {
      var list = pick('servicesOff', []).filter(function (k) { return k !== key; });
      if (off) list.push(key);
      this.set('servicesOff', list);
    },
    openPicks: function () { return pick('openPicks', CONFIG.openPicksIn === 'nuvio' ? 'nuvio' : 'apps'); },
    /** The input the first top button opens, picked on the TV (Home Settings > Live TV button): 'live' (Live TV)
     * or 'hdmi1'..'hdmi4'. */
    boxInput: function () {
      var k = String(pick('boxInput', 'live')).toLowerCase();
      return /^hdmi[1-4]$/.test(k) ? k : 'live';
    },
    set: function (name, value) { v[name] = value; save(); this.version++; },
    setCoin: function (i, on) {
      var c = (pick('coins', null) || [true, true, true, true]).slice();
      c[i] = on;
      this.set('coins', c);
    }
  };
})();

var Data = (function () {
  'use strict';

  function store(key, value) { try { localStorage.setItem('fmtv.' + key, JSON.stringify(value)); } catch (e) {} }
  function stored(key) { try { return JSON.parse(localStorage.getItem('fmtv.' + key)); } catch (e) { return null; } }

  /** GET a JSON document; done(error, json). */
  function get(url, headers, done) {
    var x = new XMLHttpRequest();
    var over = false;
    x.open('GET', url, true);
    x.timeout = 10000;
    for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(new Error(x.status === 401 ? 'TMDB rejected the key' : 'HTTP ' + x.status)); return; }
      var json;
      try { json = JSON.parse(x.responseText); } catch (e) { done(e); return; }
      done(null, json);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(new Error('no connection')); } };
    x.send();
  }

  /**
   * Open-Meteo, over plain http where https fails: its certificate chains to Let's Encrypt's ISRG root, which 2015 and
   * 2016 TVs (Tizen 2.3 and 2.4) don't trust. Only the city's coordinates and the forecast go in the clear. Each call
   * tries https first, so a newer TV whose request once timed out doesn't stay on http.
   */
  function getMeteo(path, done) {
    get('https://' + path, {}, function (err, body) {
      // A certificate the TV doesn't trust ends as a network error: status 0, or onerror.
      if (err && /^(no connection|HTTP 0)$/.test(err.message)) {
        get('http://' + path, {}, done);
        return;
      }
      done(err, body);
    });
  }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  // MARK: - Weather

  function place() { return Prefs.latitude() + ',' + Prefs.longitude(); }
  // Both forecasts in one answer, the next 48 hours and today plus 5 days: Home Settings → Forecast switches without
  // asking again, and offline too. 14 steps of 15 minutes tell the card whether rain comes in the next two hours, even
  // from a forecast 30 minutes old (where the time zone is off by half an hour, they start up to 45 minutes back).
  var QUERY = '&current=temperature_2m,weather_code,is_day'
      + '&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,weather_code,uv_index_max'
      + '&minutely_15=precipitation,precipitation_probability&forecast_minutely_15=14'
      + '&hourly=temperature_2m,weather_code,is_day&timezone=auto&forecast_days=6&forecast_hours=48';
  var weather = null, weatherAt = 0, fetchingWeather = false;
  (function () {
    var w = stored('weather');
    // Fetched with another query (an older version): shown, and fetched again now.
    if (w && w.place === place()) { weather = parseWeather(w.body); weatherAt = w.query === QUERY ? w.at : 0; }
  })();

  /** "2026-10-20T18:31" at the location (Open-Meteo's local time) → epoch ms. */
  function localTime(iso, offsetSeconds) {
    var m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(iso || '');
    if (!m) return 0;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) - offsetSeconds * 1000;
  }

  function parseWeather(o) {
    if (!o || !o.current) return null;
    var off = o.utc_offset_seconds || 0, dl = o.daily, now = Date.now();
    var w = {
      temp: o.current.temperature_2m, code: o.current.weather_code, isDay: o.current.is_day !== 0,
      max: dl.temperature_2m_max[0], min: dl.temperature_2m_min[0],
      uv: dl.uv_index_max ? dl.uv_index_max[0] : null,
      sunrise: localTime(dl.sunrise[0], off), sunset: localTime(dl.sunset[0], off), hours: [], days: []
    };
    // The 15-minute steps, [start, rain]: a step counts as rain from a 50% chance or 0.2 mm of it. rainIn reads them at
    // the moment the card is drawn, not when the forecast came.
    var mr = o.minutely_15;
    if (mr && mr.time) {
      w.steps = [];
      for (var k = 0; k < mr.time.length; k++) {
        var pr = mr.precipitation_probability ? mr.precipitation_probability[k] || 0 : 0;
        var mm = mr.precipitation ? mr.precipitation[k] || 0 : 0;
        w.steps.push([localTime(mr.time[k], off), pr >= 50 || mm >= 0.2]);
      }
    }
    var hr = o.hourly;
    for (var i = 0; hr && i < hr.time.length && w.hours.length < 6; i++) {
      var at = localTime(hr.time[i], off);
      if (at <= now) continue;
      w.hours.push({at: at, temp: hr.temperature_2m[i], code: hr.weather_code[i], day: !hr.is_day || hr.is_day[i] !== 0});
    }
    // The next 5 days, from tomorrow (none in a forecast cached before the days). Only days that haven't started at
    // the city: today, and past days in a forecast cached offline, are left out.
    for (var j = 0; dl.weather_code && j < dl.time.length && w.days.length < 5; j++) {
      if (localTime(dl.time[j] + 'T12:00', off) - 12 * 3600000 <= now) continue;
      var p = dl.time[j].split('-');   // named by its noon on the TV's clock, right even with the city far away
      w.days.push({at: new Date(+p[0], p[1] - 1, +p[2], 12).getTime(), max: dl.temperature_2m_max[j],
        min: dl.temperature_2m_min[j], code: dl.weather_code[j]});
    }
    return w;
  }

  /**
   * Rain in the next two hours at `now`: the minutes until it starts, 0 while the step we're in has it, -1 if no step up
   * to two hours from now has any, null when the steps don't reach that far (an older forecast, offline).
   */
  function rainIn(now) {
    var s = weather && weather.steps, STEP = 15 * 60000, end = now + 2 * 3600000;
    if (!s || !s.length) return null;
    for (var i = 0; i < s.length && s[i][0] < end; i++) {
      if (s[i][0] + STEP <= now) continue;   // already over
      if (s[i][1]) return Math.max(0, Math.round((s[i][0] - now) / 60000));
    }
    return s[s.length - 1][0] + STEP >= end ? -1 : null;
  }

  function refreshWeather() {
    var now = Date.now();
    if (fetchingWeather || (now - weatherAt < 30 * 60000 && now >= weatherAt)) return;
    fetchingWeather = true;
    var at = place();
    getMeteo('api.open-meteo.com/v1/forecast?latitude=' + Prefs.latitude() + '&longitude=' + Prefs.longitude() + QUERY, function (err, body) {
      fetchingWeather = false;
      if (at !== place()) { refreshWeather(); return; }   // another city was picked meanwhile
      if (err) return;
      weather = parseWeather(body);
      weatherAt = Date.now();
      store('weather', {place: at, body: body, at: weatherAt, query: QUERY});
      changed();
    });
  }

  // MARK: - Air quality

  /**
   * Open-Meteo's air-quality endpoint, apart from the forecast: its numbers change slowly, so it has its own half-hour
   * cache and its own key, and a TV that can't reach it still shows the weather.
   */
  var AIR_QUERY = 'current=us_aqi,pm2_5&timezone=auto';
  var air = null, airAt = 0, airTried = 0, fetchingAir = false;
  (function () {
    var a = stored('air');
    if (a && a.place === place() && a.query === AIR_QUERY) { air = a.body; airAt = a.at; }
  })();

  function refreshAir() {
    var now = Date.now();
    // Only for the weather card; a host that didn't answer is asked again 5 minutes later, not at every 30-second tick.
    if (!Prefs.weather() || fetchingAir || (now - airAt < 30 * 60000 && now >= airAt) || (now - airTried < 5 * 60000 && now >= airTried)) return;
    airTried = now;
    fetchingAir = true;
    var at = place();
    getMeteo('air-quality-api.open-meteo.com/v1/air-quality?latitude=' + Prefs.latitude() + '&longitude='
        + Prefs.longitude() + '&' + AIR_QUERY, function (err, body) {
      fetchingAir = false;
      if (at !== place()) { refreshAir(); return; }   // another city was picked meanwhile
      if (err || !body || !body.current) return;
      air = {aqi: body.current.us_aqi, pm25: body.current.pm2_5, at: Date.now()};
      airAt = air.at;
      store('air', {place: at, body: air, at: airAt, query: AIR_QUERY});
      changed();
    });
  }

  /** Places with this name (Open-Meteo, in the app's language): done(error, [{label, city, lat, lon}]). */
  function findCity(name, done) {
    var lang = I18N.lang.replace(/-.*/, '');   // Open-Meteo takes the language without the country
    getMeteo('geocoding-api.open-meteo.com/v1/search?count=10&format=json&language=' + lang + '&name='
        + encodeURIComponent(name.trim()), function (err, body) {
      if (err) { done(err); return; }
      var results = (body && body.results) || [], out = [], seen = {};
      for (var i = 0; i < results.length; i++) {
        var r = results[i], city = r.name || '';
        if (!city || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue;
        var label = city, parts = [r.admin1, r.country];
        for (var j = 0; j < parts.length; j++) if (parts[j] && parts[j] !== city) label += ', ' + parts[j];
        if (seen['#' + label]) continue;   // places with the same name, state and country read the same
        seen['#' + label] = true;
        out.push({label: label, city: city, lat: r.latitude.toFixed(4), lon: r.longitude.toFixed(4)});
      }
      done(null, out);
    });
  }

  // MARK: - Prices

  // This build's price row: BTC, ETH and XRP from Binance, and Apple's stock (AAPL) from Yahoo Finance, all in dollars.
  var COINS = ['BTC', 'ETH', 'XRP', 'AAPL'];
  var NAMES = ['Bitcoin', 'Ethereum', 'XRP', 'Apple (AAPL)'];
  var CRYPTO = 3;   // COINS[0..2] are Binance pairs; COINS[3] is the stock
  var CURRENCY = 'USD', QUOTE = 'USDT';
  var prices = [NaN, NaN, NaN, NaN], changes = [NaN, NaN, NaN, NaN], pricesAt = 0, fetchingPrices = false;
  var stockAt = 0, stockTried = 0, fetchingStock = false;

  /** Indexes in COINS of the ones switched on in Home Settings. */
  function activeCoins() {
    var out = [];
    if (!Prefs.quotes()) return out;
    for (var i = 0; i < COINS.length; i++) if (Prefs.coin(i)) out.push(i);
    return out;
  }

  function parsePrices(list) {
    var found = 0;
    for (var i = 0; list && i < list.length; i++) {
      for (var k = 0; k < CRYPTO; k++) {
        if (list[i].symbol !== COINS[k] + QUOTE) continue;
        var last = parseFloat(list[i].lastPrice), open = parseFloat(list[i].openPrice);
        prices[k] = last;
        changes[k] = open > 0 ? (last - open) / open * 100 : NaN;
        found++;
      }
    }
    return found;
  }

  /** Yahoo's chart answer: the last price and the change since the previous close. */
  function parseStock(o) {
    var r = o && o.chart && o.chart.result && o.chart.result[0], m = r && r.meta;
    if (!m || !(m.regularMarketPrice > 0)) return false;
    prices[CRYPTO] = m.regularMarketPrice;
    var prev = m.chartPreviousClose || m.previousClose;
    changes[CRYPTO] = prev > 0 ? (m.regularMarketPrice - prev) / prev * 100 : NaN;
    return true;
  }

  (function () {
    var p = stored('prices');
    if (p && p.quote === 'crypto-v2' && parsePrices(p.body)) pricesAt = p.at;
    var s = stored('stock');
    if (s && parseStock(s.body)) stockAt = s.at;
  })();

  function refreshPrices() {
    var coins = activeCoins(), now = Date.now(), symbols = [];
    for (var i = 0; i < coins.length; i++) if (coins[i] < CRYPTO) symbols.push('%22' + COINS[coins[i]] + QUOTE + '%22');
    if (coins.indexOf(CRYPTO) >= 0) refreshStock(now);
    if (!symbols.length || fetchingPrices || (now - pricesAt < 5 * 60000 && now >= pricesAt)) return;
    fetchingPrices = true;
    var path = '/api/v3/ticker/24hr?type=MINI&symbols=%5B' + symbols.join(',') + '%5D';
    // data-api.binance.vision answers where a network blocks api.binance.com (#375); Binance.US where .com refuses.
    var hosts = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api.binance.us'];
    (function next(h) {
      get(hosts[h] + path, {}, function (err, body) {
        if (err || !parsePrices(body)) {
          if (h + 1 < hosts.length) next(h + 1);
          else fetchingPrices = false;
          return;
        }
        fetchingPrices = false;
        pricesAt = Date.now();
        store('prices', {quote: 'crypto-v2', body: body, at: pricesAt});
        changed();
      });
    })(0);
  }

  /** AAPL every 5 minutes (Yahoo's public chart data, no key); a failed try waits 5 minutes too. */
  function refreshStock(now) {
    if (fetchingStock || (now - stockAt < 5 * 60000 && now >= stockAt) || (now - stockTried < 5 * 60000 && now >= stockTried)) return;
    fetchingStock = true;
    stockTried = now;
    var hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
    (function next(h) {
      get(hosts[h] + '/v8/finance/chart/AAPL?range=1d&interval=1d', {}, function (err, body) {
        if (err || !parseStock(body)) {
          if (h + 1 < hosts.length) next(h + 1);
          else fetchingStock = false;
          return;
        }
        fetchingStock = false;
        stockAt = Date.now();
        store('stock', {body: body, at: stockAt});
        changed();
      });
    })(0);
  }

  // MARK: - Picks (TMDB)

  var KEY = Prefs.tmdbKey();
  var REGION = Place.country;

  /** Service name on TMDB (part of it, lowercase) → our key, how to find its app on the TV (id, name), its name. */
  var SERVICES = [
    ['netflix', 'netflix', /^netflix$/, /netflix/i, 'Netflix'],
    ['prime video', 'prime', /^amazon$/, /prime video|amazon/i, 'Prime Video'],
    ['disney', 'disney', /disney/, /disney/i, 'Disney+'],
    ['hulu', 'hulu', /^hulu/, /hulu/i, 'Hulu'],
    ['paramount', 'paramount', /paramount|cbs/, /paramount/i, 'Paramount+'],
    ['peacock', 'peacock', /peacock/, /peacock/i, 'Peacock'],
    ['globoplay', 'globoplay', /globoplay/, /globoplay/i, 'Globoplay'],
    ['max', 'max', /hbo|wbd|\.max/, /^(hbo )?max$|hbo max/i, 'Max'],
    ['apple tv', 'appletv', /appletv|apple\.tv/, /apple tv/i, 'Apple TV'],
    ['hotstar', 'hotstar', /hotstar/, /hotstar/i, 'JioHotstar'],
    ['crunchyroll', 'crunchyroll', /crunchyroll/, /crunchyroll/i, 'Crunchyroll'],
    ['now tv', 'now', /nowtv|now\.tv/, /^now( tv)?$/i, 'NOW']
  ];

  var installed = [];   // the TV's apps, from TV.apps()

  /** A service whose app is on the TV and that the person hasn't switched off in Home Settings (Picks from). */
  function usable(key) { return !!appFor(key) && !Prefs.serviceOff(key); }

  /** The streaming services whose app is on this TV, as {key, name}, for Home Settings. */
  function services() {
    var out = [];
    for (var s = 0; s < SERVICES.length; s++) if (appFor(SERVICES[s][1])) out.push({key: SERVICES[s][1], name: SERVICES[s][4]});
    return out;
  }

  /** The installed app for a service key, or null. */
  function appFor(key) {
    for (var s = 0; s < SERVICES.length; s++) {
      if (SERVICES[s][1] !== key) continue;
      for (var i = 0; i < installed.length; i++) {
        if (SERVICES[s][2].test(installed[i].id) || SERVICES[s][3].test(installed[i].title)) return installed[i];
      }
    }
    return null;
  }

  /** "… Amazon Channel" is sold inside another app; Apple TV is only the streaming service (350; 2 is the store). */
  function service(providerName, providerId) {
    var n = (providerName || '').toLowerCase();
    if (n.indexOf(' channel') >= 0) return null;
    for (var i = 0; i < SERVICES.length; i++) {
      var s = SERVICES[i];
      if (s[1] === 'appletv' && providerId !== 350) continue;
      if (s[0] === 'max' ? /\bmax\b/.test(n) : n.indexOf(s[0]) >= 0) return s;
    }
    return null;
  }

  // This build's picks come from the person's own MDBList lists (mdblist.com), not TMDB's trending: their rules (services,
  // language, IMDb and Rotten Tomatoes audience scores) decide what shows. The key is theirs, typed on the TV.
  var MDB = 'https://api.mdblist.com';

  function mdb(path, done, key) {
    key = key || KEY;
    get(MDB + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'apikey=' + encodeURIComponent(key), {Accept: 'application/json'}, done);
  }

  /** Asks MDBList whether a key works before it's saved: done(error), with error.rejected when MDBList said no. */
  function checkKey(key, done) {
    mdb('/user', function (err, o) {
      if (err && /401|403|rejected/.test(err.message)) err.rejected = true;
      if (!err && !(o && o.user_id)) { err = new Error('MDBList didn\'t accept the key'); err.rejected = true; }
      done(err || null);
    }, key);
  }

  var cache = stored('recs-mdb') || {};
  var picks = cache.picks || [], listAt = cache.listAt || 0, period = cache.period, listLang = cache.lang || '', stamp = cache.stamp || '';
  var fetchingRecs = false, failedAt = 0, recsError = '';
  var SLOT = 30 * 60000;          // the picks change every 30 minutes
  var RELOAD = 3 * 3600000;       // the lists are read again every 3 hours, a new random part of the big ones each time
  var shift = 0;                  // the refresh button moves on to the next set at once

  /** MDBList's free plan allows 1,000 requests a day: the per-title details stop at 700, the rest show their poster. */
  var BUDGET = 700;
  function spend() {
    var day = new Date().toDateString(), b = stored('mdb-budget') || {};
    if (b.day !== day) b = {day: day, used: 0};
    if (b.used >= BUDGET) return false;
    b.used++;
    store('mdb-budget', b);
    return true;
  }

  function saveRecs() { store('recs-mdb', {picks: picks, listAt: listAt, period: period, lang: listLang, stamp: stamp}); }

  function hourPeriod(d) {
    var h = d.getHours();
    return h >= 5 && h < 12 ? 0 : h >= 12 && h < 18 ? 1 : 2;
  }

  function sourceStamp() {
    var s = KEY.length + ':' + KEY.slice(-6) + ':' + REGION + (Prefs.hideAnimation() ? ':no-animation' : '');
    for (var i = 0; i < SERVICES.length; i++) s += usable(SERVICES[i][1]) ? '1' : '0';
    return s;
  }

  function franchise(title) {
    var t = (title || '').toLowerCase(), cut = t.indexOf(':');
    if (cut < 0) cut = t.indexOf(' - ');
    return (cut > 0 ? t.slice(0, cut) : t).replace(/^\s+|\s+$/g, '');
  }

  /** This hour's picks (Prefs.cards()): movies ("movie"), shows ("tv") or both (null). */
  function now(kind) {
    var list = [];
    if (!KEY) return list;
    for (var i = 0; i < picks.length; i++) {
      var p = picks[i];
      // A service switched off in Home Settings (Picks from) leaves its titles out; one with no app here still shows.
      if ((kind === null || kind === p.kind) && !(p.app && Prefs.serviceOff(p.app))) list.push(p);
    }
    if (!list.length) return list;
    // A new set every 30 minutes (SLOT), walking through the whole pool before any title comes back.
    var slot = Math.floor(Date.now() / SLOT) + shift, out = [], seen = {}, n = Prefs.cards();
    for (var j = 0; j < list.length && out.length < n; j++) {
      var q = list[(slot * n + j) % list.length], f = franchise(q.title);
      if (!seen[f]) { seen[f] = true; out.push(q); }
    }
    return out;
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  /** A rating from MDBList's list: 'imdb' (7.3) or 'popcorn' (Rotten Tomatoes' audience, 93), or NaN. */
  function rating(o, source) {
    for (var i = 0; o.ratings && i < o.ratings.length; i++) {
      var r = o.ratings[i];
      if (r.source === source && r.value !== null && r.value !== undefined) return +r.value;
    }
    return NaN;
  }

  /** The line under the wide card: IMDb, the audience score, the genre, the length, the service. */
  function metaOf(p) {
    var parts = [];
    if (!isNaN(p.imdb)) parts.push('IMDb ' + p.imdb.toFixed(1));
    if (!isNaN(p.popcorn)) parts.push('Audience ' + Math.round(p.popcorn) + '%');
    if (p.genre) parts.push(p.genre);
    if (p.kind === 'movie' && p.runtime > 0) {
      var h = Math.floor(p.runtime / 60), m = p.runtime % 60;
      parts.push(h ? trf('{h}h {m}m', {h: h, m: m}) : trf('{m}m', {m: m}));
    } else if (p.kind === 'tv') {
      parts.push(tr('Series'));
    }
    if (p.service) parts.push(p.service);
    return parts.join(' · ');
  }

  /** The wide photo and the services it streams on (MDBList's media info, one request per title, kept with the list). */
  function details(p, done) {
    if (!spend()) {   // over today's budget: the poster stands in for the wide photo
      p.backdrop = p.poster;
      p.detailed = true;
      done(null);
      return;
    }
    mdb('/tmdb/' + (p.kind === 'tv' ? 'show' : 'movie') + '/' + p.id + '/', function (err, o) {
      if (err) { done(err); return; }
      if (o.backdrop) p.backdrop = o.backdrop;
      if (o.poster) p.poster = o.poster;
      p.app = null;
      p.service = '';
      // watch_providers: the subscription services (TMDB's ids, 337 Disney Plus); streams is sometimes empty.
      var streams = (o.watch_providers || []).concat(o.streams || []);
      // The person's own services first (what their MDBList lists filter on), then any other one we know.
      var MINE = ['netflix', 'prime', 'appletv', 'max', 'disney', 'paramount'], best = null, rank = 99;
      for (var i = 0; i < streams.length; i++) {
        var s = service(streams[i].name, streams[i].id === 350 || /apple tv/i.test(streams[i].name) ? 350 : streams[i].id);
        var r = s ? (MINE.indexOf(s[1]) >= 0 ? MINE.indexOf(s[1]) : 50) : 99;
        if (r < rank) { rank = r; best = s; }
      }
      if (best) { p.service = best[4]; p.app = best[1]; }
      if (!p.service && streams.length) p.service = streams[0].name;
      p.meta = metaOf(p);
      p.detailed = true;
      done(null);
    });
  }

  /** A title from a list, when it has a picture; cartoons and anime only with Cartoons and anime on. */
  function addPick(list, o, kind) {
    var tmdbId = (o.ids && o.ids.tmdb) || o.id;
    if (!tmdbId || !o.poster) return;
    var genres = o.genres || [];
    if (Prefs.hideAnimation() && genres.indexOf('animation') >= 0) return;
    var p = {id: tmdbId, kind: kind, title: o.title, poster: o.poster, backdrop: '', imdb: rating(o, 'imdb'),
      popcorn: rating(o, 'popcorn'), genre: cap(genres[0] || ''), runtime: o.runtime || 0, service: '', app: null, detailed: false};
    p.meta = metaOf(p);
    list.push(p);
  }

  function keyOf(p) { return p.kind + ':' + p.id; }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function alternate(out, seen, a, b, max) {
    for (var i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) {
      if (i < a.length && !seen[keyOf(a[i])]) { seen[keyOf(a[i])] = true; out.push(a[i]); }
      if (i < b.length && out.length < max && !seen[keyOf(b[i])]) { seen[keyOf(b[i])] = true; out.push(b[i]); }
    }
  }

  /** Runs fn on each item one after the other (the TV's network is shared with what's playing). */
  function each(items, fn, done) {
    var i = 0;
    (function next() {
      if (i >= items.length) { done(); return; }
      fn(items[i++], next);
    })();
  }

  /**
   * Every list on the person's MDBList account (their dynamic lists: Movies, Shows), movies and shows alternating. The
   * details already fetched for a title are kept, so a new list costs requests only for what's new on it.
   */
  function fetchList(done) {
    mdb('/lists/user', function (err, lists) {
      if (err) { done(err); return; }
      if (!lists || !lists.length) { done(new Error('no lists on this MDBList account yet (or they are still filling)')); return; }
      var found = {movie: [], tv: []}, old = {};
      for (var i = 0; i < picks.length; i++) old[keyOf(picks[i])] = picks[i];
      each(lists.slice(0, 4), function (l, next) {
        // Up to 100 titles a list; from a bigger one, a different random hundred at each reload.
        var offset = l.items > 100 ? Math.floor(Math.random() * (l.items - 100)) : 0;
        mdb('/lists/' + l.id + '/items?limit=100&offset=' + offset + '&append_to_response=poster,ratings_all,genres', function (e, r) {
          if (e || !r) { next(); return; }
          var movies = r.movies || [], shows = r.shows || [];
          for (var j = 0; j < movies.length; j++) addPick(found.movie, movies[j], 'movie');
          for (var k = 0; k < shows.length; k++) addPick(found.tv, shows[k], 'tv');
          next();
        });
      }, function () {
        var list = [], seen = {};
        shuffle(found.movie);
        shuffle(found.tv);
        alternate(list, seen, found.movie, found.tv, 200);
        if (!list.length) { done(new Error('the MDBList lists are empty')); return; }
        for (var n = 0; n < list.length; n++) {
          var was = old[keyOf(list[n])];
          if (was && was.detailed) {
            list[n].backdrop = was.backdrop;
            list[n].service = was.service;
            list[n].app = was.app;
            list[n].detailed = true;
            list[n].meta = metaOf(list[n]);
          }
        }
        picks = list;
        done(null);
      });
    });
  }

  /** Fetches the list when stale (6 h, a new period of the day, language, key or apps), then this hour's details. */
  function refreshRecs() {
    if (!KEY || fetchingRecs || !installed.length) return;
    var t = Date.now(), p = hourPeriod(new Date()), st = sourceStamp();
    if (st === stamp && failedAt && t - failedAt < 10 * 60000 && t >= failedAt) return;
    var stale = st !== stamp || p !== period || t - listAt > RELOAD || t < listAt || !picks.length || listLang !== I18N.lang;
    var wanted = all(), missing = false;
    for (var i = 0; i < wanted.length; i++) missing = missing || !wanted[i].detailed;
    if (!stale && !missing) return;
    fetchingRecs = true;
    stamp = st;
    function finish(err) {
      fetchingRecs = false;
      if (err) { recsError = err.message; failedAt = Date.now(); } else { recsError = ''; failedAt = 0; }
      saveRecs();
      changed();
    }
    function detailWanted() {
      var todo = all().filter(function (x) { return !x.detailed; });
      each(todo, function (x, next) { details(x, function () { next(); }); }, function () { finish(null); });
    }
    if (stale) {
      fetchList(function (err) {
        if (err) { finish(err); return; }
        listAt = Date.now();
        period = p;
        listLang = I18N.lang;
        detailWanted();
      });
    } else {
      detailWanted();
    }
  }

  /** This hour's picks for the three tabs, without repeats (the screensaver shows them too). */
  function all() {
    var out = [], seen = {}, kinds = [null, 'movie', 'tv'];
    for (var k = 0; k < kinds.length; k++) {
      var list = now(kinds[k]);
      for (var i = 0; i < list.length; i++) if (!seen[keyOf(list[i])]) { seen[keyOf(list[i])] = true; out.push(list[i]); }
    }
    return out;
  }

  // MARK: - Formatting

  function fmt(v, digits) {
    // Old WebKit (Tizen 2) has no Intl: toLocaleString ignores its options and prints every digit, without failing.
    // English separators there; a per-language table if someone asks.
    if (typeof Intl === 'undefined') return v.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    try { return v.toLocaleString(I18N.locale(), {minimumFractionDigits: digits, maximumFractionDigits: digits}); } catch (e) { return v.toFixed(digits); }
  }

  var SYMBOLS = {USD: '$', BRL: 'R$ ', EUR: '€', GBP: '£', JPY: '¥'};

  return {
    COINS: COINS,
    get city() { return Prefs.city(); },
    currency: CURRENCY,
    onChange: function (fn) { listeners.push(fn); },
    setApps: function (apps) { installed = apps; },
    appFor: appFor,
    usable: usable,
    services: services,
    refresh: function () { refreshWeather(); refreshAir(); refreshPrices(); refreshRecs(); },
    settingsChanged: function () { pricesAt = 0; refreshPrices(); changed(); },
    findCity: findCity,
    /** Another city picked: its weather now (none shown until it comes). */
    cityChanged: function () { weather = null; weatherAt = 0; air = null; airAt = 0; airTried = 0; refreshWeather(); refreshAir(); changed(); },
    get weather() { return weather; },
    get air() { return air; },
    rainIn: rainIn,
    get weatherAt() { return weatherAt; },
    prices: prices,
    changes: changes,
    get pricesAt() { return pricesAt; },
    activeCoins: activeCoins,
    hasKey: function () { return !!KEY; },
    checkKey: checkKey,
    /** A key typed (or removed) on the TV: the picks come again with it, or go. */
    keyChanged: function () { KEY = Prefs.tmdbKey(); recsError = ''; failedAt = 0; refreshRecs(); changed(); },
    recsError: function () { return recsError; },
    picks: now,
    showcase: all,
    /** Every title already shown with its photo: the screensaver goes through all of them, not only this half hour's. */
    pool: function () { return picks.filter(function (p) { return p.detailed && p.backdrop; }); },
    /** The refresh button: a new random part of the lists now, and the next set on screen at once. */
    reloadPicks: function () {
      shift++;
      listAt = 0;
      failedAt = 0;
      refreshRecs();
      changed();
    },
    /** MDBList gives whole TMDB image addresses: the size in them is swapped for the one wanted here. */
    image: function (path, size) {
      if (!path) return '';
      if (/^https?:/.test(path)) return path.replace(/\/t\/p\/[^\/]+\//, '/t/p/' + (size || 'w1280') + '/');
      return 'https://image.tmdb.org/t/p/' + (size || 'w1280') + path;
    },

    /** Night at the location: from sunset to sunrise (the last forecast; without one, 6:00 and 18:00). */
    isNight: function (at) {
      var theme = Prefs.theme();
      if (theme === 'dark') return true;
      if (theme === 'light') return false;
      var d = new Date(at), mins = d.getHours() * 60 + d.getMinutes();
      function hm(t, fallback) { if (!t) return fallback; var x = new Date(t); return x.getHours() * 60 + x.getMinutes(); }
      var rise = hm(weather && weather.sunrise, 360), set = hm(weather && weather.sunset, 1080);
      return mins < rise || mins >= set;
    },

    compact: function (v) {
      if (isNaN(v)) return '—';
      if (v >= 1000000) return fmt(v / 1000000, 2) + 'M';
      if (v >= 10000) return fmt(v / 1000, 1) + 'k';
      if (v >= 1000) return fmt(v / 1000, 2) + 'k';
      if (v >= 100) return fmt(v, 0);
      return fmt(v, 2);
    },
    money: function (v) {
      var s = SYMBOLS[CURRENCY] || CURRENCY + ' ';
      if (isNaN(v)) return s + '—';
      return s + (v >= 1000 ? fmt(v, 0) : fmt(v, 2));
    },
    change: function (v) { return isNaN(v) ? '' : (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 1) + '%'; },
    degrees: function (v) {
      if (v === undefined || v === null || isNaN(v)) return '—';
      var unit = Prefs.temperature();
      var f = unit === 'F' || (unit === 'auto' && Place.fahrenheit);
      return Math.round(f ? v * 9 / 5 + 32 : v) + '°';
    },
    /** "3 PM", "15:00", "15 Uhr": the hourly forecast. */
    hour: function (at) { return formatDate('format|h a', at); },
    /** "Seg", "Mon", "Lun", "Mo", "Пн": the short day of the week, capitalized and without the abbreviation's dot. */
    weekday: function (at) {
      var s = formatDate('format|EEE', at).replace(/\.$/, '');
      return s.charAt(0).toUpperCase() + s.substring(1);
    },
    /** "5:21 AM", "05:21": the clock, sunrise and sunset. */
    time: function (at) { return formatDate('format|h:mm a', at); },
    /** "12 min ago" when the data is old (no internet), or empty. */
    staleness: function (at, every) {
      if (!at) return '';
      var age = Date.now() - at;
      if (age < every * 2) return '';
      var m = Math.floor(age / 60000), h = Math.floor(m / 60);
      return m < 60 ? trf('{n} min ago', {n: m}) : trf('{n} h ago', {n: h});
    },
    condition: function (code, day) {
      if (code === undefined || code === null || code < 0) return '';
      if (code === 0) return day ? tr('Clear') : tr('night|Clear');
      if (code === 1) return day ? tr('Mostly Sunny') : tr('Mostly Clear');
      if (code === 2) return tr('Partly Cloudy');
      if (code === 3) return tr('Cloudy');
      if (code === 45 || code === 48) return tr('Fog');
      if (code >= 51 && code <= 57) return tr('Drizzle');
      if (code === 65 || code === 67 || code === 82) return tr('Heavy Rain');
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return tr('Snow');
      if (code >= 95) return tr('Thunderstorms');
      return tr('Rain');
    },
    symbol: function (code, day) {
      if (code <= 1) return day ? 'sunny' : 'clear_night';
      if (code === 2) return day ? 'partly_cloudy_day' : 'partly_cloudy_night';
      if (code === 3) return 'cloud';
      if (code === 45 || code === 48) return 'foggy';
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowflake';
      if (code >= 95) return 'thunderstorm';
      return 'rainy';
    },
    coinName: function (i) { return NAMES[i]; },
    get stockAt() { return stockAt; }
  };
})();
