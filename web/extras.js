/*
 * Haven TV's lines at the top right of the home screen, left of the round buttons:
 *  - the next prayer, with its iqama and a countdown. Home Settings → Prayer times picks how, or turns it off:
 *      off      nothing anywhere (home screen, screensaver, Clock);
 *      city     calculated here for the weather's city, with a calculation method (METHODS) and Asr rule;
 *      mosque   a mosque's own adhan and iqama timetable for the whole year, from its page on themasjidapp.org
 *               (read again every 6 hours, kept in localStorage); calculated for the city until it's read.
 *    The defaults come from haven.properties at build time (CONFIG.haven), and the TV's choice wins;
 *  - the next match of each team in haven.properties' teams (ESPN's public schedule, every competition), in the TV's
 *    time with a countdown, or LIVE with the score while it's on. Home Settings → Match lines turns them off.
 * Plain ES5, like the rest of web/ (Tizen 3's Chromium).
 */
var Extras = (function () {
  'use strict';

  var HAVEN = (window.CONFIG && window.CONFIG.haven) || {};
  var PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  var LABELS = {fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha'};

  /** Calculation methods: [key, name, Fajr angle, Isha angle, or Isha as minutes after Maghrib]. */
  var METHODS = [
    ['MWL', 'Muslim World League', 18, 17],
    ['Makkah', 'Umm al-Qura, Makkah', 18.5, 0, 90],
    ['Egypt', 'Egyptian General Authority', 19.5, 17.5],
    ['Karachi', 'University of Islamic Sciences, Karachi', 18, 18],
    ['ISNA', 'Islamic Society of North America', 15, 15],
    ['Dubai', 'Dubai (UAE)', 18.2, 18.2],
    ['Kuwait', 'Kuwait', 18, 17.5],
    ['Qatar', 'Qatar', 18, 0, 90],
    ['Turkey', 'Diyanet, Turkey', 18, 17],
    ['Singapore', 'Singapore, Malaysia, Indonesia', 20, 18],
    ['Tehran', 'Institute of Geophysics, Tehran', 17.7, 14],
    ['France', 'UOIF, France', 12, 12]
  ];

  function pref(name, fallback) { return window.Prefs && Prefs.get ? Prefs.get(name, fallback) : fallback; }

  /** What Home Settings (or else haven.properties) says. */
  function mode() { var m = pref('prayer', HAVEN.prayer || 'off'); return m === 'city' || m === 'mosque' ? m : 'off'; }
  function mosque() { return String(pref('mosque', HAVEN.mosque || '')).replace(/^.*themasjidapp\.org\//, '').replace(/[^A-Za-z0-9_-]/g, ''); }
  function method() {
    var k = pref('prayerMethod', HAVEN.method || 'MWL');
    for (var i = 0; i < METHODS.length; i++) if (METHODS[i][0] === k) return METHODS[i];
    return METHODS[0];
  }
  function hanafi() { return pref('asr', HAVEN.asr || 'standard') === 'hanafi'; }
  function teams() { return pref('matches', HAVEN.matches !== false) ? (HAVEN.teams || []) : []; }

  function store(key, value) { try { localStorage.setItem('fmtv.x.' + key, JSON.stringify(value)); } catch (e) {} }
  function stored(key) { try { return JSON.parse(localStorage.getItem('fmtv.x.' + key)); } catch (e) { return null; } }

  /** GET as text; done(error, text). */
  function fetchText(url, done) {
    var x = new XMLHttpRequest(), over = false;
    x.open('GET', url, true);
    x.timeout = 20000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(new Error('HTTP ' + x.status)); return; }
      done(null, x.responseText);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(new Error('no connection')); } };
    x.send();
  }

  function fetchJson(url, done) {
    fetchText(url, function (err, text) {
      if (err) { done(err); return; }
      var o;
      try { o = JSON.parse(text); } catch (e) { done(e); return; }
      done(null, o);
    });
  }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  // MARK: - Time helpers

  /** Day of the year on the TV's clock, 1 to 366. */
  function dayOfYear(d) {
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
  }

  /** "5:51 AM" or "17:00" on the day of `day` (a Date at that day) → epoch ms, or 0. */
  function at(day, text) {
    var m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(text || '');
    if (!m) return 0;
    var h = +m[1] % 24, min = +m[2], ap = m[3] ? m[3].toUpperCase() : '';
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min).getTime();
  }

  function clock(ms) { return formatDate('format|h:mm a', ms); }

  /** "in 42 min", "in 3h 05m", "in 2d 4h 12m". */
  function countdown(ms) {
    var mins = Math.max(0, Math.ceil(ms / 60000)), d = Math.floor(mins / 1440), h = Math.floor(mins % 1440 / 60), m = mins % 60;
    function two(n) { return (n < 10 ? '0' : '') + n; }
    if (d > 0) return 'in ' + d + 'd ' + h + 'h ' + two(m) + 'm';
    if (h > 0) return 'in ' + h + 'h ' + two(m) + 'm';
    return 'in ' + m + ' min';
  }

  // MARK: - Prayer times: the mosque's timetable

  var timetable = stored('mosque');   // {adhan: {doy: {...}}, iqama: {doy: {...}}, jumuah: ['12:45 PM', ...], at}
  var mosqueTried = 0, fetchingMosque = false;

  /** The timetable from the page's Next.js data, or null when the page has changed shape. */
  function parseMosque(html) {
    var m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html || '');
    if (!m) return null;
    var masjid;
    try { masjid = JSON.parse(m[1]).props.pageProps.masjid; } catch (e) { return null; }
    var adhan = masjid && masjid.azanParams && masjid.azanParams.imported, iqama = masjid && masjid.iqamas;
    if (!adhan || !adhan['1']) return null;
    var out = {adhan: {}, iqama: {}, jumuah: [], at: Date.now()};
    for (var k in adhan) {
      if (!adhan.hasOwnProperty(k)) continue;
      var a = adhan[k];
      out.adhan[k] = {fajr: a.fajr, sunrise: a.sunrise, dhuhr: a.zuhr || a.dhuhr, asr: a.asr, maghrib: a.maghrib, isha: a.isha};
    }
    for (var j in iqama || {}) {
      if (!iqama.hasOwnProperty(j)) continue;
      var q = iqama[j];
      out.iqama[j] = {fajr: q.fajr, dhuhr: q.dhuhr || q.zuhr, asr: q.asr, maghrib: q.maghrib, isha: q.isha};
    }
    var events = masjid.events || [];
    for (var e = 0; e < events.length; e++) if (events[e].isJuma && events[e].timeDesc) out.jumuah.push(events[e].timeDesc.toUpperCase());
    out.jumuah.sort(function (x, y) { return at(new Date(), x) - at(new Date(), y); });
    return out;
  }

  /** The mosque's timetable, when that's what Home Settings asks for and it's this mosque's. */
  function mosqueTable() {
    return mode() === 'mosque' && timetable && timetable.slug === mosque() ? timetable : null;
  }

  function refreshMosque(force) {
    var now = Date.now(), slug = mosque();
    if (mode() !== 'mosque' || !slug || fetchingMosque) return;
    var fresh = timetable && timetable.slug === slug && now - timetable.at < 6 * 3600000 && now >= timetable.at;
    if (!force && (fresh || (now - mosqueTried < 15 * 60000 && now >= mosqueTried))) return;
    mosqueTried = now;
    fetchingMosque = true;
    fetchText('https://themasjidapp.org/' + slug, function (err, html) {
      fetchingMosque = false;
      var t = err ? null : parseMosque(html);
      if (!t) return;   // kept: yesterday's copy still has the whole year
      t.slug = slug;
      timetable = t;
      store('mosque', t);
      changed();
    });
  }

  /** Whether a mosque's page can be read, before it's saved: done(error, its name). */
  function checkMosque(slug, done) {
    slug = String(slug || '').replace(/^.*themasjidapp\.org\//, '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!slug) { done(new Error('empty')); return; }
    fetchText('https://themasjidapp.org/' + slug, function (err, html) {
      var t = err ? null : parseMosque(html);
      if (!t) { done(err || new Error('no timetable on that page')); return; }
      var m = /"name":"([^"]+)"/.exec(html);
      done(null, m ? m[1] : slug, slug);
    });
  }

  // MARK: - Prayer times: calculated for the weather's city (any country), with the method chosen in Home Settings

  var RAD = Math.PI / 180;
  function sunPosition(jd) {
    var d = jd - 2451545.0, g = (357.529 + 0.98560028 * d) % 360, q = (280.459 + 0.98564736 * d) % 360;
    var L = (q + 1.915 * Math.sin(g * RAD) + 0.020 * Math.sin(2 * g * RAD)) % 360, e = 23.439 - 0.00000036 * d;
    var RA = Math.atan2(Math.cos(e * RAD) * Math.sin(L * RAD), Math.cos(L * RAD)) / RAD / 15;
    RA = (RA + 24) % 24;
    var eqt = q / 15 - RA;
    eqt = eqt - 24 * Math.round(eqt / 24);
    return {decl: Math.asin(Math.sin(e * RAD) * Math.sin(L * RAD)) / RAD, eqt: eqt};
  }

  /**
   * The method's Fajr and Isha angles (or Isha a fixed time after Maghrib), Shafi'i or Hanafi Asr, and the middle-of-
   * the-night rule where the sun doesn't go deep enough (northern summers). The place is the weather's city.
   */
  function calculated(day) {
    var lat = parseFloat(window.Prefs ? Prefs.latitude() : 0) || 0, lon = parseFloat(window.Prefs ? Prefs.longitude() : 0) || 0;
    var m0 = method(), asrFactor = hanafi() ? 2 : 1;
    var y = day.getFullYear(), mo = day.getMonth() + 1, dd = day.getDate();
    if (mo <= 2) { y -= 1; mo += 12; }
    var A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
    var jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (mo + 1)) + dd + B - 1524.5 - lon / 360;
    var zone = -day.getTimezoneOffset() / 60;
    function noon(t) { return 12 - sunPosition(jd + t).eqt; }
    function hourAngle(angle, t, ccw) {
      var p = sunPosition(jd + t), x = (-Math.sin(angle * RAD) - Math.sin(p.decl * RAD) * Math.sin(lat * RAD))
          / (Math.cos(p.decl * RAD) * Math.cos(lat * RAD));
      if (x > 1 || x < -1) return NaN;
      var h = Math.acos(x) / RAD / 15;
      return noon(t) + (ccw ? -h : h);
    }
    function asr(t) {
      var p = sunPosition(jd + t), angle = -Math.atan(1 / (asrFactor + Math.tan(Math.abs(lat - p.decl) * RAD))) / RAD;
      return hourAngle(angle, t, false);
    }
    var sunrise = hourAngle(0.833, 6 / 24, true), sunset = hourAngle(0.833, 18 / 24, false);
    var fajr = hourAngle(m0[2], 5 / 24, true);
    var isha = m0[4] ? sunset + m0[4] / 60 : hourAngle(m0[3], 18 / 24, false);
    var night = 24 - (sunset - sunrise);
    if (isNaN(fajr) || sunrise - fajr > night / 2) fajr = sunrise - night / 2;
    if (isNaN(isha) || isha - sunset > night / 2) isha = sunset + night / 2;
    var times = {fajr: fajr, sunrise: sunrise, dhuhr: noon(12 / 24) + 1 / 60, asr: asr(13 / 24), maghrib: sunset, isha: isha};
    var out = {};
    for (var k in times) {
      if (!times.hasOwnProperty(k)) continue;
      var hours = times[k] + zone - lon / 15, h = Math.floor(hours), m = Math.round((hours - h) * 60);
      out[k] = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
    }
    return out;
  }

  /** The day's prayers, [{key, name, adhan, iqama, juma}], from the mosque's timetable or calculated. */
  function prayersOn(day) {
    var key = String(Math.min(dayOfYear(day), 365)), list = [];
    var friday = day.getDay() === 5, t = mosqueTable();
    var a = t && t.adhan[key], q = t && t.iqama[key];
    var calc = a ? null : calculated(day);
    for (var i = 0; i < PRAYERS.length; i++) {
      var k = PRAYERS[i], p = {key: k, name: LABELS[k], adhan: a ? at(day, a[k]) : calc[k], iqama: q ? at(day, q[k]) : 0};
      if (k === 'dhuhr' && friday && t && t.jumuah.length) {
        p.name = 'Jumuah';
        p.juma = t.jumuah;
        p.adhan = at(day, t.jumuah[0]);
        p.iqama = 0;
      }
      if (p.adhan) list.push(p);
    }
    return list;
  }

  /** The prayer to show now: the first whose iqama (or adhan) is still ahead; after Isha, tomorrow's Fajr. */
  function nextPrayer(now) {
    var today = new Date(now), list = prayersOn(today);
    for (var i = 0; i < list.length; i++) if (Math.max(list[i].adhan, list[i].iqama) > now) return list[i];
    var tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 12);
    return prayersOn(tomorrow)[0] || null;
  }

  /** The line on the home screen: {main, side}, or null. */
  function prayerLine(now) {
    if (mode() === 'off') return null;
    var p = nextPrayer(now);
    if (!p) return null;
    var main;
    if (p.juma) main = 'Jumuah ' + p.juma.join(' · ');
    else main = p.name + ' ' + clock(p.adhan) + (p.iqama && p.iqama !== p.adhan ? ' · Iqama ' + clock(p.iqama) : '');
    var side;
    if (p.adhan > now) side = countdown(p.adhan - now);
    else side = 'Iqama ' + countdown(p.iqama - now);
    var guessed = mode() === 'mosque' && !mosqueTable();   // the mosque's page couldn't be read yet: calculated meanwhile
    if (guessed) side += ' · approx.';
    return {main: main, side: side, estimated: guessed};
  }

  // MARK: - Matches (ESPN)

  var matches = stored('matches') || {};   // team id → {event, at}
  var matchTried = {}, fetchingMatch = {};

  function score(c) {
    var s = c && c.score;
    if (s === null || s === undefined) return '';
    if (typeof s === 'object') return String(s.displayValue !== undefined ? s.displayValue : s.value);
    return String(s);
  }

  /** The first event that isn't over, trimmed to what the line needs. */
  function parseSchedule(o) {
    var events = (o && o.events) || [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i], c = e.competitions && e.competitions[0], st = c && c.status && c.status.type;
      if (!c || (st && (st.state === 'post' || st.completed))) continue;
      var home = null, away = null;
      for (var k = 0; k < (c.competitors || []).length; k++) {
        if (c.competitors[k].homeAway === 'home') home = c.competitors[k]; else away = c.competitors[k];
      }
      if (!home || !away) continue;
      return {
        // "2026-11-08T20:00Z": older engines want the seconds too.
        start: Date.parse(e.date) || Date.parse(e.date.replace(/T(\d\d:\d\d)Z$/, 'T$1:00Z')),
        league: (e.league && (e.league.abbreviation || e.league.name)) || '',
        home: home.team.shortDisplayName || home.team.displayName, away: away.team.shortDisplayName || away.team.displayName,
        homeScore: score(home), awayScore: score(away),
        state: st ? st.state : 'pre', clock: (c.status && c.status.displayClock) || '',
        detail: st ? (st.shortDetail || st.detail || '') : ''
      };
    }
    return null;
  }

  /** Every 30 minutes; every minute from 15 minutes before kick-off until it's over. */
  function refreshMatch(team) {
    var now = Date.now(), m = matches[team.id], ev = m && m.event;
    var hot = ev && (ev.state === 'in' || (ev.start - now < 15 * 60000 && now - ev.start < 3 * 3600000));
    var every = hot ? 60000 : 30 * 60000;
    if (fetchingMatch[team.id] || (m && now - m.at < every && now >= m.at)) return;
    if (matchTried[team.id] && now - matchTried[team.id] < 60000) return;
    matchTried[team.id] = now;
    fetchingMatch[team.id] = true;
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/' + team.id + '/schedule?fixture=true', function (err, o) {
      fetchingMatch[team.id] = false;
      if (err) return;
      matches[team.id] = {event: parseSchedule(o), at: Date.now()};
      store('matches', matches);
      changed();
    });
  }

  /** {main, side, live} for a team's next match, or null. */
  function matchLine(team, now) {
    var m = matches[team.id], e = m && m.event;
    if (!e) return null;
    if (e.state === 'in') {
      return {main: e.home + ' ' + (e.homeScore || '0') + '–' + (e.awayScore || '0') + ' ' + e.away,
        side: (e.clock && e.clock !== "0'" ? e.clock : e.detail) + (e.league ? ' · ' + e.league : ''), live: true};
    }
    // Past kick-off by more than 3 hours with no news: it's over; the next fetch brings the next one.
    if (now - e.start > 3 * 3600000) return null;
    var when = formatDate('format|EEE d MMM', e.start) + ', ' + clock(e.start);
    return {main: e.home + ' vs ' + e.away + (e.league ? ' · ' + e.league : ''),
      side: when + (e.start > now ? ' · ' + countdown(e.start - now) : ''), live: false};
  }

  return {
    onChange: function (fn) { listeners.push(fn); },
    refresh: function () {
      refreshMosque();
      var t = teams();
      for (var i = 0; i < t.length; i++) refreshMatch(t[i]);
    },
    /** The lines for the top right, in order: the prayer, then each team's match. */
    lines: function () {
      var now = Date.now(), out = [], p = prayerLine(now), t = teams();
      if (p) out.push({kind: 'prayer', main: p.main, side: p.side, estimated: p.estimated});
      for (var i = 0; i < t.length; i++) {
        var m = matchLine(t[i], now);
        if (m) out.push({kind: 'match', main: m.main, side: m.side, live: m.live});
      }
      return out;
    },
    // Home Settings.
    METHODS: METHODS,
    mode: mode,
    mosque: mosque,
    method: method,
    hanafi: hanafi,
    hasTeams: function () { return !!(HAVEN.teams && HAVEN.teams.length); },
    checkMosque: checkMosque,
    /** A setting changed on the TV: the line again now (and the new mosque's timetable). */
    settingsChanged: function () { refreshMosque(true); changed(); },
    // For checks in a browser's console.
    _prayersOn: prayersOn,
    _calculated: calculated,
    _parseMosque: parseMosque,
    _parseSchedule: parseSchedule
  };
})();
