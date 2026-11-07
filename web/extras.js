/*
 * This build's extra lines at the top right of the home screen, left of the round buttons:
 *  - the next prayer at the Cork Islamic Cultural Centre, with its iqama and a countdown. The mosque's own timetable
 *    (adhan and iqama for every day of the year) comes from its page on themasjidapp.org, read again every 6 hours and
 *    kept in localStorage; without it, the times are calculated here for Cork (adhan only);
 *  - the next match of Barcelona and of Trabzonspor (ESPN's public schedule, every competition), in the TV's time with
 *    a countdown, or LIVE with the score while it's on.
 * Plain ES5, like the rest of web/ (Tizen 3's Chromium).
 */
var Extras = (function () {
  'use strict';

  var MOSQUE_URL = 'https://themasjidapp.org/cicc';
  var CORK = {lat: 51.8775, lon: -8.4913};
  var TEAMS = [{id: 83, name: 'Barcelona'}, {id: 997, name: 'Trabzonspor'}];
  var PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  var LABELS = {fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha'};

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

  function refreshMosque() {
    var now = Date.now();
    if (fetchingMosque || (timetable && now - timetable.at < 6 * 3600000 && now >= timetable.at)) return;
    if (now - mosqueTried < 15 * 60000 && now >= mosqueTried) return;
    mosqueTried = now;
    fetchingMosque = true;
    fetchText(MOSQUE_URL, function (err, html) {
      fetchingMosque = false;
      var t = err ? null : parseMosque(html);
      if (!t) return;   // kept: yesterday's copy still has the whole year
      timetable = t;
      store('mosque', t);
      changed();
    });
  }

  // MARK: - Prayer times: calculated for Cork when the mosque's page can't be read

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

  /** Muslim World League angles (Fajr 18°, Isha 17°), Shafi'i Asr, middle-of-the-night rule for Cork's summer nights. */
  function calculated(day) {
    var y = day.getFullYear(), mo = day.getMonth() + 1, dd = day.getDate();
    if (mo <= 2) { y -= 1; mo += 12; }
    var A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
    var jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (mo + 1)) + dd + B - 1524.5 - CORK.lon / 360;
    var zone = -day.getTimezoneOffset() / 60;
    function noon(t) { return 12 - sunPosition(jd + t).eqt; }
    function hourAngle(angle, t, ccw) {
      var p = sunPosition(jd + t), x = (-Math.sin(angle * RAD) - Math.sin(p.decl * RAD) * Math.sin(CORK.lat * RAD))
          / (Math.cos(p.decl * RAD) * Math.cos(CORK.lat * RAD));
      if (x > 1 || x < -1) return NaN;
      var h = Math.acos(x) / RAD / 15;
      return noon(t) + (ccw ? -h : h);
    }
    function asr(t) {
      var p = sunPosition(jd + t), angle = -Math.atan(1 / (1 + Math.tan(Math.abs(CORK.lat - p.decl) * RAD))) / RAD;
      return hourAngle(angle, t, false);
    }
    var sunrise = hourAngle(0.833, 6 / 24, true), sunset = hourAngle(0.833, 18 / 24, false);
    var fajr = hourAngle(18, 5 / 24, true), isha = hourAngle(17, 18 / 24, false);
    var night = 24 - (sunset - sunrise);
    if (isNaN(fajr) || sunrise - fajr > night / 2) fajr = sunrise - night / 2;
    if (isNaN(isha) || isha - sunset > night / 2) isha = sunset + night / 2;
    var times = {fajr: fajr, sunrise: sunrise, dhuhr: noon(12 / 24) + 1 / 60, asr: asr(13 / 24), maghrib: sunset, isha: isha};
    var out = {};
    for (var k in times) {
      if (!times.hasOwnProperty(k)) continue;
      var hours = times[k] + zone - CORK.lon / 15, h = Math.floor(hours), m = Math.round((hours - h) * 60);
      out[k] = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
    }
    return out;
  }

  /** The day's prayers, [{key, name, adhan, iqama, juma}], from the mosque's timetable or calculated. */
  function prayersOn(day) {
    var key = String(Math.min(dayOfYear(day), 365)), list = [];
    var friday = day.getDay() === 5;
    var a = timetable && timetable.adhan[key], q = timetable && timetable.iqama[key];
    var calc = a ? null : calculated(day);
    for (var i = 0; i < PRAYERS.length; i++) {
      var k = PRAYERS[i], p = {key: k, name: LABELS[k], adhan: a ? at(day, a[k]) : calc[k], iqama: q ? at(day, q[k]) : 0};
      if (k === 'dhuhr' && friday && timetable && timetable.jumuah.length) {
        p.name = 'Jumuah';
        p.juma = timetable.jumuah;
        p.adhan = at(day, timetable.jumuah[0]);
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
    var p = nextPrayer(now);
    if (!p) return null;
    var main;
    if (p.juma) main = 'Jumuah ' + p.juma.join(' · ');
    else main = p.name + ' ' + clock(p.adhan) + (p.iqama && p.iqama !== p.adhan ? ' · Iqama ' + clock(p.iqama) : '');
    var side;
    if (p.adhan > now) side = countdown(p.adhan - now);
    else side = 'Iqama ' + countdown(p.iqama - now);
    if (!timetable) side += ' · approx.';   // calculated here: the mosque's page couldn't be read yet
    return {main: main, side: side, estimated: !timetable};
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
      for (var i = 0; i < TEAMS.length; i++) refreshMatch(TEAMS[i]);
    },
    /** The lines for the top right, in order: the prayer, then each team's match. */
    lines: function () {
      var now = Date.now(), out = [], p = prayerLine(now);
      if (p) out.push({kind: 'prayer', main: p.main, side: p.side, estimated: p.estimated});
      for (var i = 0; i < TEAMS.length; i++) {
        var m = matchLine(TEAMS[i], now);
        if (m) out.push({kind: 'match', main: m.main, side: m.side, live: m.live});
      }
      return out;
    },
    // For checks in a browser's console.
    _prayersOn: prayersOn,
    _calculated: calculated,
    _parseMosque: parseMosque,
    _parseSchedule: parseSchedule
  };
})();
