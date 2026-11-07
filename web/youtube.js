/*
 * The YouTube tab: the newest videos from the channels the person subscribes to, as cards like the picks.
 *  - Sign-in is Google's flow for TVs: the tab shows a code, the person enters it at google.com/device on their phone and
 *    allows read-only access (youtube.readonly). The refresh token stays in this TV's localStorage.
 *  - The client (CONFIG.youtube: id and secret, a "TVs and Limited Input devices" client in the person's own Google
 *    Cloud project) is packed in at build time from youtube.local.json, which git leaves out.
 *  - Every hour: the subscriptions, then each channel's newest uploads without Shorts (its "UULF" playlist), the last
 *    7 days, newest first. About 1 + channels/50 + channels requests an hour, well inside YouTube's 10,000 a day.
 * Plain ES5, like the rest of web/.
 */
var YouTube = (function () {
  'use strict';

  var CLIENT = (window.CONFIG && window.CONFIG.youtube) || {};
  var SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
  var API = 'https://www.googleapis.com/youtube/v3';
  var EVERY = 60 * 60000, DAYS = 7, MAX = 18;

  function store(key, value) { try { localStorage.setItem('fmtv.yt.' + key, JSON.stringify(value)); } catch (e) {} }
  function stored(key) { try { return JSON.parse(localStorage.getItem('fmtv.yt.' + key)); } catch (e) { return null; } }
  function forget(key) { try { localStorage.removeItem('fmtv.yt.' + key); } catch (e) {} }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  function request(method, url, form, headers, done) {
    var x = new XMLHttpRequest(), over = false;
    x.open(method, url, true);
    x.timeout = 15000;
    for (var h in headers || {}) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      var body = null;
      try { body = JSON.parse(x.responseText); } catch (e) {}
      if (x.status >= 200 && x.status < 300) done(null, body);
      else { var err = new Error((body && (body.error_description || body.error && (body.error.message || body.error))) || 'HTTP ' + x.status); err.status = x.status; err.body = body; done(err); }
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(new Error('no connection')); } };
    if (form) {
      var parts = [];
      for (var k in form) if (form.hasOwnProperty(k)) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(form[k]));
      x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      x.send(parts.join('&'));
    } else {
      x.send();
    }
  }

  // MARK: - Sign-in (OAuth 2.0 for TVs)

  var token = stored('token');      // {access, expires, refresh}
  var device = null;                // {code, userCode, url, interval, expires} while the code is on screen
  var pollTimer = 0, status = '';

  function configured() { return !!(CLIENT.clientId && CLIENT.clientSecret); }
  function signedIn() { return !!(token && token.refresh); }

  /** Asks Google for a code to show; the TV then waits for the person to enter it on their phone. */
  var asking = false, askedAt = 0;
  function startSignIn() {
    if (!configured() || signedIn() || asking || (device && Date.now() < device.expires)) return;
    if (askedAt && Date.now() - askedAt < 30000) return;   // after a failure, not again at once
    asking = true;
    askedAt = Date.now();
    status = 'Getting a code…';
    request('POST', 'https://oauth2.googleapis.com/device/code', {client_id: CLIENT.clientId, scope: SCOPE}, null, function (err, o) {
      asking = false;
      if (err || !o || !o.device_code) { status = "Couldn't reach Google: " + (err ? err.message : 'no code'); changed(); return; }
      device = {code: o.device_code, userCode: o.user_code, url: o.verification_url || 'google.com/device',
        interval: (o.interval || 5) * 1000, expires: Date.now() + (o.expires_in || 1800) * 1000};
      status = '';
      changed();
      poll();
    });
  }

  function poll() {
    clearTimeout(pollTimer);
    if (!device) return;
    if (Date.now() > device.expires) { device = null; status = 'The code expired. Open the YouTube tab again for a new one.'; changed(); return; }
    pollTimer = setTimeout(function () {
      request('POST', 'https://oauth2.googleapis.com/token', {client_id: CLIENT.clientId, client_secret: CLIENT.clientSecret,
        device_code: device.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code'}, null, function (err, o) {
        if (!err && o && o.access_token) {
          token = {access: o.access_token, expires: Date.now() + (o.expires_in - 60) * 1000, refresh: o.refresh_token};
          store('token', token);
          device = null;
          status = '';
          videosAt = 0;
          refresh();
          changed();
          return;
        }
        var why = err && err.body && err.body.error;
        if (why === 'slow_down') device.interval += 5000;
        if (why === 'access_denied') { device = null; status = 'Access was declined on the phone.'; changed(); return; }
        poll();   // authorization_pending: keep waiting
      });
    }, device.interval);
  }

  /** A fresh access token: done(error, token). */
  function access(done) {
    if (!signedIn()) { done(new Error('not signed in')); return; }
    if (token.access && Date.now() < token.expires) { done(null, token.access); return; }
    request('POST', 'https://oauth2.googleapis.com/token', {client_id: CLIENT.clientId, client_secret: CLIENT.clientSecret,
      refresh_token: token.refresh, grant_type: 'refresh_token'}, null, function (err, o) {
      if (err) {
        if (err.body && err.body.error === 'invalid_grant') { token = null; forget('token'); changed(); }   // revoked: sign in again
        done(err);
        return;
      }
      token.access = o.access_token;
      token.expires = Date.now() + (o.expires_in - 60) * 1000;
      store('token', token);
      done(null, token.access);
    });
  }

  function api(path, done) {
    access(function (err, t) {
      if (err) { done(err); return; }
      request('GET', API + path, null, {Authorization: 'Bearer ' + t}, done);
    });
  }

  // MARK: - Videos

  var cache = stored('videos') || {};
  var videos = cache.list || [], videosAt = cache.at || 0, fetching = false, failedAt = 0;

  function subscriptions(done) {
    var ids = [];
    (function page(tokenPage, n) {
      api('/subscriptions?part=snippet&mine=true&maxResults=50&order=relevance' + (tokenPage ? '&pageToken=' + tokenPage : ''), function (err, o) {
        if (err) { done(err); return; }
        var items = (o && o.items) || [];
        for (var i = 0; i < items.length; i++) {
          var c = items[i].snippet && items[i].snippet.resourceId && items[i].snippet.resourceId.channelId;
          if (c) ids.push(c);
        }
        if (o.nextPageToken && n < 4) page(o.nextPageToken, n + 1); else done(null, ids);
      });
    })('', 0);
  }

  function thumb(t) {
    t = t || {};
    var best = t.maxres || t.standard || t.high || t.medium || t['default'];
    return best ? best.url : '';
  }

  /** The newest long uploads of one channel ("UULF" + the channel id without its "UC"); [] when it has none. */
  function uploads(channel, since, done) {
    api('/playlistItems?part=snippet,contentDetails&maxResults=3&playlistId=UULF' + channel.slice(2), function (err, o) {
      var out = [];
      for (var i = 0; !err && o && o.items && i < o.items.length; i++) {
        var s = o.items[i].snippet, id = o.items[i].contentDetails && o.items[i].contentDetails.videoId;
        var at = Date.parse((o.items[i].contentDetails && o.items[i].contentDetails.videoPublishedAt) || s.publishedAt);
        if (!id || !(at >= since) || s.title === 'Private video' || s.title === 'Deleted video') continue;
        out.push({id: id, kind: 'youtube', video: id, title: s.title, channel: s.videoOwnerChannelTitle || s.channelTitle,
          at: at, poster: thumb(s.thumbnails), backdrop: thumb(s.thumbnails), app: 'youtube', detailed: true});
      }
      done(out);
    });
  }

  function refresh(force) {
    var now = Date.now();
    if (!signedIn() || fetching) return;
    if (!force && now - videosAt < EVERY && now >= videosAt) return;
    if (!force && failedAt && now - failedAt < 10 * 60000) return;
    fetching = true;
    subscriptions(function (err, channels) {
      if (err) { fetching = false; failedAt = Date.now(); status = "Couldn't read your subscriptions: " + err.message; changed(); return; }
      var since = Date.now() - DAYS * 864e5, found = [], next = 0, running = 0;
      function more() {
        // Six channels at a time.
        while (running < 6 && next < channels.length) {
          running++;
          uploads(channels[next++], since, function (list) {
            found = found.concat(list);
            running--;
            if (next >= channels.length && running === 0) finish();
            else more();
          });
        }
        if (!channels.length) finish();
      }
      function finish() {
        found.sort(function (a, b) { return b.at - a.at; });
        videos = found.slice(0, MAX);
        videosAt = Date.now();
        fetching = false;
        failedAt = 0;
        status = videos.length ? '' : 'No new videos from your subscriptions in the last ' + DAYS + ' days.';
        store('videos', {list: videos, at: videosAt});
        changed();
      }
      more();
    });
  }

  function ago(at) {
    var m = Math.max(1, Math.round((Date.now() - at) / 60000));
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    var d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }

  return {
    onChange: function (fn) { listeners.push(fn); },
    configured: configured,
    signedIn: signedIn,
    startSignIn: startSignIn,
    /** What the tab shows when there are no videos: the code to enter, or why not. */
    prompt: function () {
      if (!configured()) return {text: 'YouTube isn\'t set up in this build.'};
      if (device) return {code: device.userCode, url: device.url.replace(/^https?:\/\//, '')};
      if (!signedIn()) return {text: status || 'Getting a code…'};
      return {text: status || (fetching ? 'Loading your subscriptions…' : '')};
    },
    refresh: function () { refresh(false); },
    reload: function () { refresh(true); },
    /** The cards: the newest videos first, with the channel and how long ago. */
    cards: function () {
      var out = [];
      for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        out.push({id: v.id, kind: 'youtube', video: v.video, title: v.title, poster: v.poster, backdrop: v.backdrop,
          meta: v.channel + ' · ' + ago(v.at), app: 'youtube', detailed: true});
      }
      return out;
    },
    signOut: function () { token = null; forget('token'); videos = []; forget('videos'); changed(); }
  };
})();
