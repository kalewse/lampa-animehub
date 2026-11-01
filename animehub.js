(function () {
  'use strict';

  /* =======================================================
   * AnimeHub for Lampa V0.2.0
   * -------------------------------------------------------
   * Shikimori catalogue + AnimeVost episode playback.
   * Designed for TV/LG WebOS remote navigation.
   *
   * V0.2.0 adds:
   * - Native Lampa playback (no AnimeVost webpage/iframe).
   * - Episode picker + player playlist / next / previous.
   * - Local watched episode / resume position tracking.
   * - Safer provider matching with manual candidate fallback.
   * - Lighter TV rendering, lazy images and short client cache.
   * ===================================================== */

  var VERSION = '0.2.0';
  var NS = 'animehub_v020';
  var FLAG = NS + '_ready';
  var HOME = NS + '_home';
  var CATALOG = NS + '_catalog';
  var DETAIL = NS + '_detail';

  /* Keep V0.1 storage keys so existing favourites/recent items survive upgrade. */
  var FAVORITES_KEY = 'animehub_v010_favorites';
  var RECENT_KEY = 'animehub_v010_recent';
  var WATCH_KEY = 'animehub_v020_watch';

  /* Cloudflare Worker URL. Keep the final slash. */
  var WORKER = 'https://animehub-lampa.kalewse69.workers.dev/';

  var genresCache = null;
  var memoryCache = {};

  /* =======================================================
   * Basics
   * ===================================================== */

  function notify(text) {
    try {
      Lampa.Noty.show(text);
    } catch (e) {}
  }

  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clip(text, limit) {
    text = clean(text);

    if (!limit || text.length <= limit) {
      return text;
    }

    return text
      .substring(0, limit)
      .replace(/\s+\S*$/, '') + '…';
  }

  function toInt(value, fallback) {
    var number = parseInt(value, 10);
    return isNaN(number) ? fallback : number;
  }

  function toNumber(value, fallback) {
    var number = parseFloat(value);
    return isNaN(number) ? fallback : number;
  }

  function workerConfigured() {
    return (
      /^https:\/\//i.test(WORKER) &&
      WORKER.indexOf('YOUR-WORKER') < 0
    );
  }

  function workerUrl(path, params) {
    var base = WORKER;

    if (base.charAt(base.length - 1) !== '/') {
      base += '/';
    }

    path = String(path || '').replace(/^\//, '');

    var url = base + path;
    var pairs = [];
    var key;

    params = params || {};

    for (key in params) {
      if (
        Object.prototype.hasOwnProperty.call(params, key) &&
        params[key] !== null &&
        typeof params[key] !== 'undefined' &&
        String(params[key]) !== ''
      ) {
        pairs.push(
          encodeURIComponent(key) +
          '=' +
          encodeURIComponent(String(params[key]))
        );
      }
    }

    if (pairs.length) {
      url += '?' + pairs.join('&');
    }

    return url;
  }

  function parseJson(value) {
    if (value && typeof value === 'object') {
      return value;
    }

    try {
      return JSON.parse(String(value || ''));
    } catch (e) {
      return null;
    }
  }

  function requestJson(network, url, success, failure) {
    network.silent(
      url,

      function (response) {
        var data = parseJson(response);

        if (!data) {
          if (typeof failure === 'function') {
            failure({
              status: 0,
              message: 'Некорректный ответ AnimeHub Worker'
            });
          }

          return;
        }

        if (data.ok === false) {
          if (typeof failure === 'function') {
            failure({
              status: data.upstreamStatus || 0,
              message: data.error || 'Ошибка AnimeHub Worker',
              data: data
            });
          }

          return;
        }

        if (typeof success === 'function') {
          success(data);
        }
      },

      function (error) {
        if (typeof failure === 'function') {
          failure(error || {});
        }
      },

      false,

      {
        dataType: 'text'
      }
    );
  }

  function cacheGet(key, maxAge) {
    var item = memoryCache[key];

    if (
      !item ||
      !item.time ||
      (Date.now() - item.time) > maxAge
    ) {
      return null;
    }

    return item.data;
  }

  function cacheSet(key, data) {
    memoryCache[key] = {
      time: Date.now(),
      data: data
    };
  }

  function requestCachedJson(
    network,
    cacheKey,
    maxAge,
    url,
    success,
    failure
  ) {
    var cached =
      cacheGet(
        cacheKey,
        maxAge
      );

    if (cached) {
      setTimeout(
        function () {
          if (typeof success === 'function') {
            success(cached);
          }
        },
        0
      );

      return;
    }

    requestJson(
      network,
      url,

      function (data) {
        cacheSet(
          cacheKey,
          data
        );

        if (typeof success === 'function') {
          success(data);
        }
      },

      failure
    );
  }

  function currentYear() {
    return new Date().getFullYear();
  }

  function formatScore(score) {
    score = toNumber(score, 0);

    return score > 0
      ? score.toFixed(2).replace(/0$/, '')
      : '—';
  }

  function kindLabel(kind) {
    var map = {
      tv: 'TV-сериал',
      movie: 'Фильм',
      ova: 'OVA',
      ona: 'ONA',
      special: 'Спецвыпуск',
      tv_special: 'TV-спецвыпуск',
      music: 'Клип',
      pv: 'Проморолик',
      cm: 'Реклама',
      tv_13: 'TV • 12–13 серий',
      tv_24: 'TV • 24–26 серий',
      tv_48: 'TV • 48+ серий'
    };

    return (
      map[kind] ||
      clean(kind) ||
      'Аниме'
    );
  }

  function statusLabel(status) {
    var map = {
      ongoing: 'Онгоинг',
      released: 'Вышло',
      anons: 'Анонс'
    };

    return (
      map[status] ||
      clean(status) ||
      ''
    );
  }

  function ratingLabel(rating) {
    var map = {
      g: 'G',
      pg: 'PG',
      pg_13: 'PG-13',
      r: 'R-17',
      r_plus: 'R+',
      rx: '18+'
    };

    return (
      map[rating] ||
      clean(rating) ||
      ''
    );
  }

  function seasonLabel(key) {
    var match =
      String(key || '')
        .match(
          /^(winter|spring|summer|fall)_(\d{4})$/
        );

    var names = {
      winter: 'Зима',
      spring: 'Весна',
      summer: 'Лето',
      fall: 'Осень'
    };

    if (!match) {
      return clean(key);
    }

    return (
      names[match[1]] +
      ' ' +
      match[2]
    );
  }

  function formatDate(value) {
    if (!value) {
      return '';
    }

    var source = String(value);

    var match =
      source.match(
        /^(\d{4})-(\d{2})-(\d{2})/
      );

    if (!match) {
      return source;
    }

    var months = [
      'янв',
      'фев',
      'мар',
      'апр',
      'мая',
      'июн',
      'июл',
      'авг',
      'сен',
      'окт',
      'ноя',
      'дек'
    ];

    var month =
      toInt(
        match[2],
        1
      ) - 1;

    return (
      toInt(
        match[3],
        1
      ) +
      ' ' +
      (months[month] || '') +
      ' ' +
      match[1]
    );
  }

  function episodeText(item) {
    var total =
      toInt(
        item && item.episodes,
        0
      );

    var aired =
      toInt(
        item && item.episodesAired,
        0
      );

    if (
      total > 0 &&
      aired > 0 &&
      aired < total
    ) {
      return aired + ' / ' + total;
    }

    if (total > 0) {
      return total + ' сер.';
    }

    if (aired > 0) {
      return aired + ' сер.';
    }

    return '';
  }

  /* =======================================================
   * Branding: Torii + sun + Fuji
   * ===================================================== */

  function toriiSvg(className) {
    return (
      '<svg class="' +
      escapeHtml(className || '') +
      '" viewBox="0 0 96 96" ' +
      'xmlns="http://www.w3.org/2000/svg" ' +
      'aria-hidden="true">' +

        '<circle ' +
          'cx="48" cy="30" r="22" ' +
          'fill="#e95aa8" opacity=".95"/>' +

        '<path ' +
          'd="M18 76 L39 51 L50 63 L59 55 L79 76 Z" ' +
          'fill="#a78bfa" opacity=".9"/>' +

        '<path ' +
          'd="M31 69 L39 51 L47 62 L42 60 Z" ' +
          'fill="#f5f3ff" opacity=".95"/>' +

        '<path ' +
          'd="M19 35 Q48 40 77 35 L74 43 Q48 47 22 43 Z" ' +
          'fill="#df5be8"/>' +

        '<rect ' +
          'x="24" y="45" width="48" height="6" rx="2" ' +
          'fill="#df5be8"/>' +

        '<rect ' +
          'x="29" y="48" width="7" height="27" rx="2" ' +
          'fill="#df5be8"/>' +

        '<rect ' +
          'x="60" y="48" width="7" height="27" rx="2" ' +
          'fill="#df5be8"/>' +

        '<rect ' +
          'x="38" y="50" width="20" height="4" rx="1" ' +
          'fill="#f0abfc"/>' +

        '<path ' +
          'd="M13 29 C17 24 21 25 22 30 C18 34 15 34 13 29 Z" ' +
          'fill="#f9a8d4"/>' +

        '<path ' +
          'd="M76 19 C81 16 84 19 83 23 C79 25 76 24 76 19 Z" ' +
          'fill="#f9a8d4"/>' +

        '<path ' +
          'd="M80 55 C85 52 88 55 87 59 C83 61 80 60 80 55 Z" ' +
          'fill="#f9a8d4"/>' +

      '</svg>'
    );
  }

  function loaderHtml(text) {
    return (
      '<div class="ah-loader">' +

        '<div class="ah-loader-icon">' +
          '<div class="ah-loader-ring"></div>' +
          toriiSvg('ah-loader-torii') +
          '<span class="ah-petal ah-petal-a">◆</span>' +
          '<span class="ah-petal ah-petal-b">◆</span>' +
          '<span class="ah-petal ah-petal-c">◆</span>' +
        '</div>' +

        '<div class="ah-loader-text">' +
          escapeHtml(
            text ||
            'Загрузка…'
          ) +
        '</div>' +

      '</div>'
    );
  }

  /* =======================================================
   * Local favourites / recently opened
   * ===================================================== */

  function storedList(key) {
    try {
      var value =
        Lampa.Storage.get(
          key,
          []
        );

      return (
        value &&
        value.length
          ? value
          : []
      );
    } catch (e) {
      return [];
    }
  }

  function compactItem(item) {
    return {
      id:
        String(
          item && item.id
            ? item.id
            : ''
        ),

      title:
        item && item.title
          ? item.title
          : 'Anime',

      name:
        item && item.name
          ? item.name
          : '',

      russian:
        item && item.russian
          ? item.russian
          : '',

      english:
        item && item.english
          ? item.english
          : '',

      poster:
        item && item.poster
          ? item.poster
          : '',

      score:
        item && item.score
          ? item.score
          : 0,

      kind:
        item && item.kind
          ? item.kind
          : '',

      status:
        item && item.status
          ? item.status
          : '',

      episodes:
        item && item.episodes
          ? item.episodes
          : 0,

      episodesAired:
        item && item.episodesAired
          ? item.episodesAired
          : 0,

      year:
        item && item.year
          ? item.year
          : null,

      season:
        item && item.season
          ? item.season
          : ''
    };
  }

  function saveRecent(item) {
    if (
      !item ||
      !item.id
    ) {
      return;
    }

    var old =
      storedList(
        RECENT_KEY
      );

    var next = [
      compactItem(item)
    ];

    var i;

    for (
      i = 0;
      i < old.length &&
      next.length < 18;
      i++
    ) {
      if (
        String(old[i].id) !==
        String(item.id)
      ) {
        next.push(old[i]);
      }
    }

    try {
      Lampa.Storage.set(
        RECENT_KEY,
        next
      );
    } catch (e) {}
  }

  function isFavorite(id) {
    var list =
      storedList(
        FAVORITES_KEY
      );

    var i;

    for (
      i = 0;
      i < list.length;
      i++
    ) {
      if (
        String(list[i].id) ===
        String(id)
      ) {
        return true;
      }
    }

    return false;
  }

  function toggleFavorite(item) {
    if (
      !item ||
      !item.id
    ) {
      return false;
    }

    var list =
      storedList(
        FAVORITES_KEY
      );

    var next = [];
    var found = false;
    var i;

    for (
      i = 0;
      i < list.length;
      i++
    ) {
      if (
        String(list[i].id) ===
        String(item.id)
      ) {
        found = true;
      } else if (
        next.length < 39
      ) {
        next.push(list[i]);
      }
    }

    if (!found) {
      next.unshift(
        compactItem(item)
      );
    }

    try {
      Lampa.Storage.set(
        FAVORITES_KEY,
        next
      );
    } catch (e) {}

    return !found;
  }

  function watchStore() {
    try {
      var value =
        Lampa.Storage.get(
          WATCH_KEY,
          {}
        );

      return (
        value &&
        typeof value === 'object'
          ? value
          : {}
      );
    } catch (e) {
      return {};
    }
  }

  function watchState(id) {
    var store =
      watchStore();

    return (
      store[
        String(id || '')
      ] ||
      {}
    );
  }

  function saveWatchState(id, patch) {
    id =
      String(
        id ||
        ''
      );

    if (!id) {
      return;
    }

    var store =
      watchStore();

    var previous =
      store[id] ||
      {};

    var next = {};
    var key;

    for (key in previous) {
      if (
        Object.prototype.hasOwnProperty.call(
          previous,
          key
        )
      ) {
        next[key] =
          previous[key];
      }
    }

    patch =
      patch ||
      {};

    for (key in patch) {
      if (
        Object.prototype.hasOwnProperty.call(
          patch,
          key
        )
      ) {
        next[key] =
          patch[key];
      }
    }

    next.updatedAt =
      Date.now();

    store[id] =
      next;

    try {
      Lampa.Storage.set(
        WATCH_KEY,
        store
      );
    } catch (e) {}
  }

  /* =======================================================
   * Styling
   * ===================================================== */

  function injectStyle() {
    if (
      $('#animehub-v020-style')
        .length
    ) {
      return;
    }

    $('head').append(
      '<style id="animehub-v020-style">' +

      ':root{' +
        '--ah-bg:#070914;' +
        '--ah-panel:#101326;' +
        '--ah-soft:#171a31;' +
        '--ah-text:#f8f7ff;' +
        '--ah-muted:#a8a7bf;' +
        '--ah-purple:#8b5cf6;' +
        '--ah-violet:#6d4aff;' +
        '--ah-pink:#f062c0;' +
        '--ah-hot:#ff7aa2;' +
      '}' +

      '.ah-view{' +
        'height:calc(100vh - 6.1em);' +
        'overflow-y:auto;' +
        'overflow-x:hidden;' +
        'background:' +
          'radial-gradient(circle at 76% -10%,rgba(126,80,255,.15),transparent 34%),' +
          'linear-gradient(180deg,#090b19,#060812 72%);' +
        'color:var(--ah-text);' +
        'box-sizing:border-box;' +
        '-webkit-overflow-scrolling:touch;' +
      '}' +

      '.ah-view::-webkit-scrollbar,' +
      '.ah-track::-webkit-scrollbar,' +
      '.ah-screens::-webkit-scrollbar{' +
        'width:0;' +
        'height:0;' +
      '}' +

      '.ah-page{' +
        'padding:0 2.15em 5em;' +
        'box-sizing:border-box;' +
        'min-height:100%;' +
      '}' +

      '.ah-topbar{' +
        'height:4.8em;' +
        'display:flex;' +
        'align-items:center;' +
        'gap:1.1em;' +
        'position:relative;' +
        'z-index:20;' +
      '}' +

      '.ah-brand{' +
        'display:flex;' +
        'align-items:center;' +
        'gap:.55em;' +
        'font-size:1.55em;' +
        'font-weight:850;' +
        'letter-spacing:-.02em;' +
        'white-space:nowrap;' +
        'padding-right:1.15em;' +
        'border-right:1px solid rgba(255,255,255,.18);' +
      '}' +

      '.ah-brand-logo{' +
        'width:2.05em;' +
        'height:2.05em;' +
        'filter:drop-shadow(0 0 10px rgba(218,80,255,.32));' +
      '}' +

      '.ah-brand b{' +
        'font-weight:850;' +
        'background:linear-gradient(90deg,#fff 0%,#fff 55%,#d96fff 100%);' +
        '-webkit-background-clip:text;' +
        'background-clip:text;' +
        'color:transparent;' +
      '}' +

      '.ah-nav{' +
        'display:flex;' +
        'align-items:center;' +
        'gap:.32em;' +
        'overflow:hidden;' +
        'flex:1;' +
      '}' +

      '.ah-navbtn{' +
        'padding:.63em .88em;' +
        'border-radius:.72em;' +
        'font-size:.92em;' +
        'color:#d4d2e2;' +
        'white-space:nowrap;' +
        'border:1px solid transparent;' +
        'transition:' +
          'transform .14s ease,' +
          'background .14s ease,' +
          'border-color .14s ease;' +
      '}' +

      '.ah-navbtn.focus{' +
        'background:' +
          'linear-gradient(180deg,rgba(139,92,246,.42),rgba(91,64,180,.42));' +
        'border-color:rgba(208,174,255,.55);' +
        'box-shadow:0 0 22px rgba(139,92,246,.28);' +
        'transform:scale(1.035);' +
        'color:#fff;' +
      '}' +

      '.ah-hero{' +
        'position:relative;' +
        'height:45vh;' +
        'min-height:24em;' +
        'max-height:33em;' +
        'border-radius:1.05em;' +
        'overflow:hidden;' +
        'margin-bottom:1.65em;' +
        'background:#111426;' +
        'isolation:isolate;' +
        'box-shadow:0 25px 70px rgba(0,0,0,.35);' +
      '}' +

      '.ah-hero-bg{' +
        'position:absolute;' +
        'inset:0;' +
        'width:100%;' +
        'height:100%;' +
        'object-fit:cover;' +
        'z-index:-4;' +
      '}' +

      '.ah-hero-bg.poster-bg{' +
        'filter:blur(18px) brightness(.58) saturate(1.15);' +
        'transform:scale(1.08);' +
      '}' +

      '.ah-hero-shade{' +
        'position:absolute;' +
        'inset:0;' +
        'z-index:-3;' +
        'background:' +
          'linear-gradient(' +
            '90deg,' +
            'rgba(7,8,19,.98) 0%,' +
            'rgba(7,8,19,.88) 35%,' +
            'rgba(7,8,19,.38) 66%,' +
            'rgba(7,8,19,.12) 100%' +
          '),' +
          'linear-gradient(0deg,rgba(7,8,19,.78),transparent 50%);' +
      '}' +

      '.ah-hero-content{' +
        'position:absolute;' +
        'left:3.8%;' +
        'top:9%;' +
        'bottom:9%;' +
        'width:52%;' +
        'display:flex;' +
        'flex-direction:column;' +
        'justify-content:center;' +
        'z-index:2;' +
      '}' +

      '.ah-kicker{' +
        'font-size:.77em;' +
        'font-weight:850;' +
        'letter-spacing:.13em;' +
        'text-transform:uppercase;' +
        'color:#e59cff;' +
        'margin-bottom:.6em;' +
      '}' +

      '.ah-hero-title{' +
        'font-size:3.05em;' +
        'font-weight:900;' +
        'line-height:1.02;' +
        'letter-spacing:-.035em;' +
        'margin-bottom:.35em;' +
        'text-shadow:0 8px 30px rgba(0,0,0,.6);' +
      '}' +

      '.ah-original-title{' +
        'font-size:.92em;' +
        'color:#bbb8cd;' +
        'margin:-.15em 0 .65em;' +
      '}' +

      '.ah-meta{' +
        'display:flex;' +
        'flex-wrap:wrap;' +
        'align-items:center;' +
        'gap:.45em;' +
        'margin-bottom:.85em;' +
      '}' +

      '.ah-chip{' +
        'padding:.3em .62em;' +
        'border-radius:999px;' +
        'font-size:.82em;' +
        'background:rgba(255,255,255,.085);' +
        'border:1px solid rgba(255,255,255,.13);' +
        'color:#e7e4f0;' +
        'white-space:nowrap;' +
      '}' +

      '.ah-chip.score{' +
        'background:rgba(255,196,61,.11);' +
        'border-color:rgba(255,196,61,.35);' +
        'color:#ffd76a;' +
        'font-weight:800;' +
      '}' +

      '.ah-chip.hot{' +
        'background:rgba(240,98,192,.13);' +
        'border-color:rgba(240,98,192,.4);' +
        'color:#ff9cda;' +
      '}' +

      '.ah-hero-desc{' +
        'font-size:1em;' +
        'line-height:1.5;' +
        'color:#d0cedb;' +
        'max-width:48em;' +
        'margin-bottom:1.2em;' +
        'text-shadow:0 2px 15px rgba(0,0,0,.55);' +
      '}' +

      '.ah-actions{' +
        'display:flex;' +
        'gap:.65em;' +
        'align-items:center;' +
      '}' +

      '.ah-action{' +
        'padding:.72em 1.15em;' +
        'border-radius:.6em;' +
        'font-weight:750;' +
        'background:rgba(255,255,255,.11);' +
        'border:1px solid rgba(255,255,255,.14);' +
        'color:#fff;' +
        'transition:' +
          'transform .14s ease,' +
          'background .14s ease;' +
      '}' +

      '.ah-action.primary{' +
        'background:' +
          'linear-gradient(135deg,#9865ff,#6f46ff 58%,#d94ee8);' +
        'border-color:rgba(255,255,255,.18);' +
        'box-shadow:0 10px 30px rgba(112,70,255,.25);' +
      '}' +

      '.ah-action.focus{' +
        'transform:scale(1.05);' +
        'background:#fff;' +
        'color:#0a0b15;' +
        'box-shadow:' +
          '0 0 0 3px rgba(164,119,255,.35),' +
          '0 14px 38px rgba(0,0,0,.32);' +
      '}' +

      '.ah-shelf{' +
        'margin:0 0 1.5em;' +
      '}' +

      '.ah-shelf-title{' +
        'font-size:1.36em;' +
        'font-weight:820;' +
        'margin:0 0 .65em;' +
        'letter-spacing:-.01em;' +
      '}' +

      '.ah-track{' +
        'display:flex;' +
        'gap:.82em;' +
        'overflow-x:auto;' +
        'overflow-y:hidden;' +
        'padding:.35em .25em .8em;' +
      '}' +

      '.ah-wide-card{' +
        'position:relative;' +
        'flex:0 0 15.6em;' +
        'height:7.25em;' +
        'border-radius:.72em;' +
        'overflow:hidden;' +
        'background:#13162a;' +
        'border:1px solid rgba(255,255,255,.08);' +
        'transition:' +
          'transform .14s ease,' +
          'border-color .14s ease,' +
          'box-shadow .14s ease;' +
      '}' +

      '.ah-wide-card img{' +
        'position:absolute;' +
        'inset:0;' +
        'width:100%;' +
        'height:100%;' +
        'object-fit:cover;' +
        'opacity:.88;' +
      '}' +

      '.ah-wide-shade{' +
        'position:absolute;' +
        'inset:0;' +
        'background:' +
          'linear-gradient(0deg,rgba(7,8,18,.98),rgba(7,8,18,.12) 82%);' +
      '}' +

      '.ah-wide-copy{' +
        'position:absolute;' +
        'left:.72em;' +
        'right:.72em;' +
        'bottom:.58em;' +
        'z-index:2;' +
      '}' +

      '.ah-wide-title{' +
        'font-size:.94em;' +
        'font-weight:760;' +
        'white-space:nowrap;' +
        'overflow:hidden;' +
        'text-overflow:ellipsis;' +
        'margin-bottom:.22em;' +
      '}' +

      '.ah-wide-meta{' +
        'font-size:.72em;' +
        'color:#d0ccdc;' +
        'display:flex;' +
        'gap:.55em;' +
        'white-space:nowrap;' +
      '}' +

      '.ah-wide-badge{' +
        'position:absolute;' +
        'left:.55em;' +
        'top:.5em;' +
        'z-index:2;' +
        'padding:.26em .48em;' +
        'border-radius:.42em;' +
        'background:rgba(117,70,255,.86);' +
        'font-size:.66em;' +
        'font-weight:800;' +
      '}' +

      '.ah-wide-card.focus{' +
        'transform:scale(1.055);' +
        'border-color:rgba(207,176,255,.9);' +
        'box-shadow:' +
          '0 0 0 3px rgba(143,94,255,.22),' +
          '0 16px 38px rgba(0,0,0,.42);' +
        'z-index:4;' +
      '}' +

      '.ah-section-head{' +
        'padding:.65em 0 1.05em;' +
      '}' +

      '.ah-page-title{' +
        'font-size:2.15em;' +
        'font-weight:900;' +
        'letter-spacing:-.025em;' +
      '}' +

      '.ah-page-sub{' +
        'font-size:.91em;' +
        'color:#9796ad;' +
        'margin-top:.25em;' +
      '}' +

      '.ah-grid{' +
        'display:flex;' +
        'flex-wrap:wrap;' +
        'gap:1em;' +
        'padding:.35em 0;' +
      '}' +

      '.ah-poster-card{' +
        'position:relative;' +
        'flex:0 0 10.65em;' +
        'width:10.65em;' +
        'padding:.32em;' +
        'border-radius:.8em;' +
        'box-sizing:border-box;' +
        'transition:' +
          'transform .14s ease,' +
          'background .14s ease,' +
          'box-shadow .14s ease;' +
      '}' +

      '.ah-poster-media{' +
        'position:relative;' +
        'height:15.2em;' +
        'border-radius:.65em;' +
        'overflow:hidden;' +
        'background:#14172a;' +
        'box-shadow:0 10px 28px rgba(0,0,0,.28);' +
      '}' +

      '.ah-poster-media img{' +
        'width:100%;' +
        'height:100%;' +
        'object-fit:cover;' +
      '}' +

      '.ah-poster-score{' +
        'position:absolute;' +
        'right:.48em;' +
        'bottom:.48em;' +
        'padding:.28em .48em;' +
        'border-radius:.4em;' +
        'background:rgba(7,8,18,.88);' +
        'color:#ffd76a;' +
        'font-size:.72em;' +
        'font-weight:800;' +
      '}' +

      '.ah-poster-title{' +
        'font-size:.88em;' +
        'font-weight:720;' +
        'line-height:1.2;' +
        'height:2.35em;' +
        'overflow:hidden;' +
        'margin:.58em .08em .18em;' +
      '}' +

      '.ah-poster-meta{' +
        'font-size:.7em;' +
        'color:#8f8ea5;' +
        'white-space:nowrap;' +
        'overflow:hidden;' +
        'text-overflow:ellipsis;' +
        'margin:0 .08em;' +
      '}' +

      '.ah-poster-card.focus{' +
        'transform:scale(1.055);' +
        'background:rgba(255,255,255,.075);' +
        'box-shadow:0 16px 38px rgba(0,0,0,.4);' +
        'z-index:4;' +
      '}' +

      '.ah-pages{' +
        'display:flex;' +
        'gap:.7em;' +
        'align-items:center;' +
        'margin:1.25em 0;' +
      '}' +

      '.ah-pagebtn{' +
        'padding:.68em 1em;' +
        'border-radius:.58em;' +
        'background:#14172b;' +
        'border:1px solid rgba(255,255,255,.09);' +
        'color:#ddd9ea;' +
      '}' +

      '.ah-pagebtn.focus{' +
        'background:#fff;' +
        'color:#0a0b14;' +
      '}' +

      '.ah-detail-hero{' +
        'position:relative;' +
        'min-height:32em;' +
        'border-radius:1.05em;' +
        'overflow:hidden;' +
        'margin-bottom:1.45em;' +
        'isolation:isolate;' +
        'background:#111426;' +
      '}' +

      '.ah-detail-bg{' +
        'position:absolute;' +
        'inset:0;' +
        'width:100%;' +
        'height:100%;' +
        'object-fit:cover;' +
        'z-index:-4;' +
      '}' +

      '.ah-detail-bg.poster-bg{' +
        'filter:blur(20px) brightness(.42) saturate(1.1);' +
        'transform:scale(1.08);' +
      '}' +

      '.ah-detail-shade{' +
        'position:absolute;' +
        'inset:0;' +
        'z-index:-3;' +
        'background:' +
          'linear-gradient(' +
            '90deg,' +
            'rgba(7,8,18,.99) 0%,' +
            'rgba(7,8,18,.89) 54%,' +
            'rgba(7,8,18,.42) 100%' +
          '),' +
          'linear-gradient(0deg,rgba(7,8,18,.97),rgba(7,8,18,.05) 72%);' +
      '}' +

      '.ah-detail-content{' +
        'display:flex;' +
        'gap:2em;' +
        'padding:2.15em;' +
        'align-items:center;' +
        'box-sizing:border-box;' +
        'min-height:30em;' +
      '}' +

      '.ah-detail-poster{' +
        'width:15.2em;' +
        'min-width:15.2em;' +
        'height:22em;' +
        'border-radius:.88em;' +
        'overflow:hidden;' +
        'background:#16182b;' +
        'box-shadow:0 24px 66px rgba(0,0,0,.58);' +
      '}' +

      '.ah-detail-poster img{' +
        'width:100%;' +
        'height:100%;' +
        'object-fit:cover;' +
      '}' +

      '.ah-detail-copy{' +
        'flex:1;' +
        'max-width:58em;' +
      '}' +

      '.ah-detail-title{' +
        'font-size:3em;' +
        'font-weight:900;' +
        'line-height:1.03;' +
        'letter-spacing:-.035em;' +
        'margin-bottom:.3em;' +
      '}' +

      '.ah-detail-desc{' +
        'font-size:1em;' +
        'line-height:1.58;' +
        'color:#ceccda;' +
        'max-width:54em;' +
        'margin:1em 0 1.2em;' +
      '}' +

      '.ah-studio{' +
        'font-size:.84em;' +
        'color:#b6b3c6;' +
        'margin:.25em 0 .55em;' +
      '}' +

      '.ah-progress-panel{' +
        'padding:1.15em 1.2em;' +
        'border-radius:.85em;' +
        'background:' +
          'linear-gradient(135deg,rgba(139,92,246,.13),rgba(240,98,192,.07));' +
        'border:1px solid rgba(177,139,255,.19);' +
        'margin-bottom:1.5em;' +
      '}' +

      '.ah-progress-head{' +
        'display:flex;' +
        'justify-content:space-between;' +
        'gap:1em;' +
        'align-items:center;' +
        'font-weight:800;' +
        'margin-bottom:.72em;' +
      '}' +

      '.ah-progress-track{' +
        'height:.38em;' +
        'border-radius:999px;' +
        'background:rgba(255,255,255,.12);' +
        'overflow:hidden;' +
      '}' +

      '.ah-progress-fill{' +
        'height:100%;' +
        'background:linear-gradient(90deg,#8b5cf6,#f062c0);' +
        'border-radius:999px;' +
      '}' +

      '.ah-progress-note{' +
        'font-size:.8em;' +
        'color:#a9a6ba;' +
        'margin-top:.62em;' +
      '}' +

      '.ah-block-title{' +
        'font-size:1.4em;' +
        'font-weight:820;' +
        'margin:.2em 0 .72em;' +
      '}' +

      '.ah-screens{' +
        'display:flex;' +
        'gap:.82em;' +
        'overflow-x:auto;' +
        'overflow-y:hidden;' +
        'padding:.25em .2em .9em;' +
        'margin-bottom:1.3em;' +
      '}' +

      '.ah-screen{' +
        'flex:0 0 18em;' +
        'height:10.2em;' +
        'border-radius:.7em;' +
        'overflow:hidden;' +
        'background:#15182b;' +
        'border:1px solid rgba(255,255,255,.08);' +
      '}' +

      '.ah-screen img{' +
        'width:100%;' +
        'height:100%;' +
        'object-fit:cover;' +
      '}' +

      '.ah-empty{' +
        'padding:2em 0;' +
        'color:#a6a3b7;' +
        'font-size:1em;' +
      '}' +

      '.ah-fallback{' +
        'display:flex;' +
        'align-items:center;' +
        'justify-content:center;' +
        'width:100%;' +
        'height:100%;' +
        'background:linear-gradient(145deg,#1a1d34,#0e1020);' +
        'color:#87859b;' +
        'text-align:center;' +
        'padding:1em;' +
        'box-sizing:border-box;' +
      '}' +

      '.ah-loader{' +
        'min-height:24em;' +
        'display:flex;' +
        'flex-direction:column;' +
        'align-items:center;' +
        'justify-content:center;' +
        'gap:1em;' +
        'color:#d8d4e7;' +
      '}' +

      '.ah-loader-icon{' +
        'position:relative;' +
        'width:8.4em;' +
        'height:8.4em;' +
        'display:flex;' +
        'align-items:center;' +
        'justify-content:center;' +
      '}' +

      '.ah-loader-torii{' +
        'width:6.5em;' +
        'height:6.5em;' +
        'filter:drop-shadow(0 0 16px rgba(225,86,255,.34));' +
      '}' +

      '.ah-loader-ring{' +
        'position:absolute;' +
        'inset:.25em;' +
        'border-radius:50%;' +
        'border:3px solid rgba(173,114,255,.12);' +
        'border-top-color:#dd6dff;' +
        'border-right-color:#8b5cf6;' +
        'animation:ah-spin 1.35s linear infinite;' +
        'box-shadow:0 0 22px rgba(142,85,255,.14);' +
      '}' +

      '.ah-loader-text{' +
        'font-size:1em;' +
        'letter-spacing:.02em;' +
      '}' +

      '.ah-petal{' +
        'position:absolute;' +
        'font-size:.62em;' +
        'color:#ff91d0;' +
        'opacity:.9;' +
        'animation:ah-petal 1.8s ease-in-out infinite;' +
      '}' +

      '.ah-petal-a{' +
        'left:.4em;' +
        'top:2.4em;' +
        'animation-delay:0s' +
      '}' +

      '.ah-petal-b{' +
        'right:.45em;' +
        'top:3.5em;' +
        'animation-delay:.55s' +
      '}' +

      '.ah-petal-c{' +
        'right:1.5em;' +
        'bottom:.7em;' +
        'animation-delay:1.05s' +
      '}' +

      '@keyframes ah-spin{' +
        'from{transform:rotate(0deg)}' +
        'to{transform:rotate(360deg)}' +
      '}' +

      '@keyframes ah-petal{' +
        '0%,100%{' +
          'transform:translateY(-4px) rotate(0deg);' +
          'opacity:.35' +
        '}' +

        '50%{' +
          'transform:translateY(7px) rotate(95deg);' +
          'opacity:1' +
        '}' +
      '}' +

      '</style>'
    );
  }

  /* =======================================================
   * Image helpers
   * ===================================================== */

  function putImage(
    container,
    url,
    fallbackText,
    extraClass
  ) {
    if (!url) {
      container.append(
        '<div class="ah-fallback">' +
          escapeHtml(
            fallbackText ||
            'AnimeHub'
          ) +
        '</div>'
      );

      return;
    }

    var image =
      $('<img alt="">');

    if (extraClass) {
      image.addClass(
        extraClass
      );
    }

    image.attr(
      {
        src: url,
        loading: 'lazy',
        decoding: 'async'
      }
    );

    image.on(
      'error',

      function () {
        container
          .empty()
          .append(
            '<div class="ah-fallback">' +
              escapeHtml(
                fallbackText ||
                'AnimeHub'
              ) +
            '</div>'
          );
      }
    );

    container.append(image);
  }

  /* =======================================================
   * AnimeVost playback / native Lampa player
   * ===================================================== */

  function playerCard(anime) {
    return {
      id:
        anime.id ||
        '',

      title:
        anime.title ||
        anime.russian ||
        anime.name ||
        'AnimeHub',

      name:
        anime.title ||
        anime.russian ||
        anime.name ||
        'AnimeHub',

      original_title:
        anime.name ||
        anime.english ||
        anime.title ||
        '',

      original_name:
        anime.name ||
        anime.english ||
        '',

      release_date:
        anime.year
          ? String(anime.year) + '-01-01'
          : '',

      first_air_date:
        anime.year
          ? String(anime.year) + '-01-01'
          : '',

      poster_path:
        anime.poster ||
        '',

      source:
        'animehub',

      animehub_id:
        String(
          anime.id ||
          ''
        )
    };
  }

  function episodeLabel(episode) {
    var number =
      toInt(
        episode &&
        episode.number,
        0
      );

    var name =
      clean(
        episode &&
        episode.name
          ? episode.name
          : ''
      );

    if (name) {
      return name;
    }

    return number > 0
      ? 'Серия ' + number
      : 'Серия';
  }

  function playableQuality(episode) {
    var quality = {};

    if (
      episode &&
      episode.quality &&
      typeof episode.quality === 'object'
    ) {
      var key;

      for (key in episode.quality) {
        if (
          Object.prototype.hasOwnProperty.call(
            episode.quality,
            key
          ) &&
          episode.quality[key]
        ) {
          quality[key] =
            episode.quality[key];
        }
      }
    }

    if (
      !quality.HD &&
      episode &&
      episode.url
    ) {
      quality.HD =
        episode.url;
    }

    return quality;
  }

  function buildPlaylist(anime, watchData) {
    var source =
      watchData.episodes ||
      [];

    var list = [];

    var card =
      playerCard(anime);

    var i;

    for (
      i = 0;
      i < source.length;
      i++
    ) {
      if (!source[i].url) {
        continue;
      }

      list.push(
        {
          url:
            source[i].url,

          quality:
            playableQuality(
              source[i]
            ),

          title:
            (
              anime.title ||
              anime.russian ||
              anime.name ||
              'AnimeHub'
            ) +
            ' • ' +
            episodeLabel(
              source[i]
            ),

          season:
            1,

          episode:
            toInt(
              source[i].number,
              i + 1
            ),

          movie:
            card,

          card:
            card,

          source:
            'AnimeVost',

          animehub_id:
            String(
              anime.id ||
              ''
            ),

          animehub_episode:
            toInt(
              source[i].number,
              i + 1
            ),

          animehub_provider_id:
            watchData.match &&
            watchData.match.id
              ? String(
                  watchData.match.id
                )
              : '',

          animehub_provider:
            'AnimeVost'
        }
      );
    }

    return list;
  }

  function startEpisode(
    anime,
    watchData,
    index
  ) {
    var playlist =
      buildPlaylist(
        anime,
        watchData
      );

    if (!playlist.length) {
      notify(
        'AnimeHub: нет доступных потоков'
      );

      return;
    }

    index =
      Math.max(
        0,

        Math.min(
          playlist.length - 1,

          toInt(
            index,
            0
          )
        )
      );

    var first =
      playlist[index];

    saveWatchState(
      anime.id,

      {
        episode:
          first.animehub_episode,

        providerId:
          first.animehub_provider_id,

        position:
          0,

        duration:
          0,

        completed:
          false
      }
    );

    try {
      Lampa.Player.play(
        first
      );

      Lampa.Player.playlist(
        playlist
      );
    } catch (error) {
      console.log(
        'AnimeHub player error',
        error
      );

      notify(
        'Не удалось запустить плеер Lampa'
      );
    }
  }

  function showEpisodePicker(
    anime,
    watchData
  ) {
    var episodes =
      watchData.episodes ||
      [];

    if (!episodes.length) {
      notify(
        'AnimeVost: серии не найдены'
      );

      return;
    }

    var state =
      watchState(
        anime.id
      );

    var items = [];
    var i;

    for (
      i = 0;
      i < episodes.length;
      i++
    ) {
      var epNumber =
        toInt(
          episodes[i].number,
          i + 1
        );

      var suffix = '';

      if (
        toInt(
          state.episode,
          0
        ) ===
        epNumber
      ) {
        if (state.completed) {
          suffix =
            ' • просмотрено';
        } else if (
          toNumber(
            state.position,
            0
          ) > 20
        ) {
          suffix =
            ' • продолжить';
        } else {
          suffix =
            ' • последняя';
        }
      }

      items.push(
        {
          title:
            episodeLabel(
              episodes[i]
            ) +
            suffix,

          episodeIndex:
            i,

          episodeNumber:
            epNumber
        }
      );
    }

    showSelect(
      (
        watchData.match &&
        watchData.match.title
          ? watchData.match.title
          : (
              anime.title ||
              'AnimeHub'
            )
      ) +
      ' • серии',

      items,

      function (selected) {
        startEpisode(
          anime,
          watchData,
          selected.episodeIndex
        );
      }
    );
  }

  function watchRequestUrl(
    anime,
    providerId
  ) {
    var params = {
      id:
        anime.id ||
        '',

      russian:
        anime.russian ||
        anime.title ||
        '',

      name:
        anime.name ||
        '',

      english:
        anime.english ||
        '',

      title:
        anime.title ||
        '',

      year:
        anime.year ||
        ''
    };

    if (providerId) {
      params.animevost_id =
        providerId;
    }

    return workerUrl(
      'watch',
      params
    );
  }

  function loadWatchData(
    anime,
    providerId,
    success
  ) {
    var network =
      new Lampa.Reguest();

    network.timeout(
      25000
    );

    try {
      if (
        Lampa.Loading &&
        typeof Lampa.Loading.start ===
          'function'
      ) {
        Lampa.Loading.start();
      }
    } catch (e) {}

    var cacheKey =
      'watch:' +
      String(
        anime.id ||
        ''
      ) +
      ':' +
      String(
        providerId ||
        'auto'
      );

    requestCachedJson(
      network,
      cacheKey,
      5 * 60 * 1000,

      watchRequestUrl(
        anime,
        providerId
      ),

      function (data) {
        try {
          if (
            Lampa.Loading &&
            typeof Lampa.Loading.stop ===
              'function'
          ) {
            Lampa.Loading.stop();
          }
        } catch (e2) {}

        try {
          network.clear();
        } catch (e3) {}

        success(
          data ||
          {}
        );
      },

      function (error) {
        try {
          if (
            Lampa.Loading &&
            typeof Lampa.Loading.stop ===
              'function'
          ) {
            Lampa.Loading.stop();
          }
        } catch (e4) {}

        try {
          network.clear();
        } catch (e5) {}

        notify(
          'Не удалось загрузить серии' +
          (
            error &&
            error.status
              ? ' • ' +
                error.status
              : ''
          )
        );
      }
    );
  }

  function showProviderCandidates(
    anime,
    data
  ) {
    var source =
      data.alternatives ||
      [];

    if (!source.length) {
      notify(
        'AnimeVost: подходящий тайтл не найден'
      );

      return;
    }

    var items = [];
    var i;

    for (
      i = 0;
      i < source.length &&
      i < 8;
      i++
    ) {
      items.push(
        {
          title:
            source[i].title +
            (
              source[i].year
                ? ' • ' +
                  source[i].year
                : ''
            ),

          providerId:
            source[i].id
        }
      );
    }

    showSelect(
      'Выберите совпадение AnimeVost',
      items,

      function (selected) {
        loadWatchData(
          anime,
          selected.providerId,

          function (resolved) {
            if (
              resolved.found &&
              resolved.episodes &&
              resolved.episodes.length
            ) {
              showEpisodePicker(
                anime,
                resolved
              );
            } else {
              notify(
                'Для выбранного тайтла серии не найдены'
              );
            }
          }
        );
      }
    );
  }

  function openWatch(anime) {
    if (
      !anime ||
      !anime.id
    ) {
      return;
    }

    var state =
      watchState(
        anime.id
      );

    loadWatchData(
      anime,
      state.providerId ||
      '',

      function (data) {
        if (
          data.found &&
          data.episodes &&
          data.episodes.length
        ) {
          showEpisodePicker(
            anime,
            data
          );

          return;
        }

        showProviderCandidates(
          anime,
          data
        );
      }
    );
  }

  function installPlaybackTracker() {
    var trackerFlag =
      NS +
      '_playback_tracker';

    if (
      window[trackerFlag]
    ) {
      return;
    }

    window[trackerFlag] =
      true;

    if (
      !Lampa.Player ||
      !Lampa.Player.listener ||
      !Lampa.PlayerVideo ||
      !Lampa.PlayerVideo.listener
    ) {
      return;
    }

    Lampa.Player.listener.follow(
      'start',

      function (data) {
        if (
          !data ||
          !data.animehub_id
        ) {
          return;
        }

        var active =
          true;

        var animeId =
          String(
            data.animehub_id
          );

        var episode =
          toInt(
            data.animehub_episode,
            0
          );

        var lastWrite =
          0;

        function onCanPlay() {
          if (!active) {
            return;
          }

          try {
            Lampa.PlayerVideo.listener.remove(
              'canplay',
              onCanPlay
            );
          } catch (e0) {}

          var state =
            watchState(
              animeId
            );

          if (
            toInt(
              state.episode,
              0
            ) !==
              episode ||
            state.completed ||
            toNumber(
              state.position,
              0
            ) < 20
          ) {
            return;
          }

          try {
            var video =
              Lampa.PlayerVideo.video();

            var resume =
              toNumber(
                state.position,
                0
              );

            var duration =
              toNumber(
                video &&
                video.duration,
                0
              );

            if (
              video &&
              resume > 20 &&
              (
                !duration ||
                resume <
                  duration -
                  45
              )
            ) {
              video.currentTime =
                resume;
            }
          } catch (e) {}
        }

        function onTimeUpdate(event) {
          if (!active) {
            return;
          }

          var now =
            Date.now();

          if (
            now -
            lastWrite <
            10000
          ) {
            return;
          }

          lastWrite =
            now;

          var current =
            toNumber(
              event &&
              event.current,
              0
            );

          var duration =
            toNumber(
              event &&
              event.duration,
              0
            );

          if (
            current <= 0
          ) {
            return;
          }

          saveWatchState(
            animeId,

            {
              episode:
                episode,

              providerId:
                data.animehub_provider_id ||
                '',

              position:
                current,

              duration:
                duration,

              completed:
                duration > 0 &&
                current >=
                  duration - 30
            }
          );
        }

        function onEnded() {
          if (!active) {
            return;
          }

          saveWatchState(
            animeId,

            {
              episode:
                episode,

              providerId:
                data.animehub_provider_id ||
                '',

              position:
                0,

              completed:
                true
            }
          );
        }

        function cleanup() {
          if (!active) {
            return;
          }

          active =
            false;

          try {
            Lampa.PlayerVideo.listener.remove(
              'canplay',
              onCanPlay
            );

            Lampa.PlayerVideo.listener.remove(
              'timeupdate',
              onTimeUpdate
            );

            Lampa.PlayerVideo.listener.remove(
              'ended',
              onEnded
            );

            Lampa.Player.listener.remove(
              'destroy',
              cleanup
            );
          } catch (e) {}
        }

        Lampa.PlayerVideo.listener.follow(
          'canplay',
          onCanPlay
        );

        Lampa.PlayerVideo.listener.follow(
          'timeupdate',
          onTimeUpdate
        );

        Lampa.PlayerVideo.listener.follow(
          'ended',
          onEnded
        );

        Lampa.Player.listener.follow(
          'destroy',
          cleanup
        );
      }
    );
  }

  /* =======================================================
   * TV navigation
   * ===================================================== */

  function ensureVisible(
    viewport,
    element
  ) {
    if (
      !viewport ||
      !viewport[0] ||
      !element
    ) {
      return;
    }

    var container =
      viewport[0];

    var er =
      element
        .getBoundingClientRect();

    var vr =
      container
        .getBoundingClientRect();

    if (
      er.bottom >
      vr.bottom - 38
    ) {
      container.scrollTop +=
        er.bottom -
        (
          vr.bottom -
          38
        );
    } else if (
      er.top <
      vr.top + 18
    ) {
      container.scrollTop -=
        (
          vr.top +
          18
        ) -
        er.top;
    }

    var scroller =
      element.parentElement;

    while (
      scroller &&
      scroller !== container
    ) {
      try {
        var style =
          window.getComputedStyle
            ? window.getComputedStyle(
                scroller
              )
            : null;

        var overflowX =
          style
            ? style.overflowX
            : '';

        if (
          overflowX === 'auto' ||
          overflowX === 'scroll'
        ) {
          var sr =
            scroller
              .getBoundingClientRect();

          var rr =
            element
              .getBoundingClientRect();

          if (
            rr.right >
            sr.right - 24
          ) {
            scroller.scrollLeft +=
              rr.right -
              (
                sr.right -
                24
              );
          } else if (
            rr.left <
            sr.left + 24
          ) {
            scroller.scrollLeft -=
              (
                sr.left +
                24
              ) -
              rr.left;
          }

          break;
        }
      } catch (e) {}

      scroller =
        scroller.parentElement;
    }
  }

  function visibleSelectors(root) {
    var result = [];

    root
      .find('.selector')
      .each(
        function () {
          if (
            this &&
            this.offsetParent !== null
          ) {
            result.push(this);
          }
        }
      );

    return result;
  }

  function groupRows(elements) {
    var rows = [];
    var tolerance = 12;
    var i;
    var j;

    for (
      i = 0;
      i < elements.length;
      i++
    ) {
      var rect =
        elements[i]
          .getBoundingClientRect();

      var centerY =
        rect.top +
        rect.height / 2;

      var row = null;

      for (
        j = 0;
        j < rows.length;
        j++
      ) {
        if (
          Math.abs(
            rows[j].centerY -
            centerY
          ) <=
          tolerance +
          rect.height *
          0.12
        ) {
          row = rows[j];
          break;
        }
      }

      if (!row) {
        row = {
          centerY: centerY,
          items: []
        };

        rows.push(row);
      }

      row.items.push(
        elements[i]
      );
    }

    rows.sort(
      function (a, b) {
        return (
          a.centerY -
          b.centerY
        );
      }
    );

    for (
      i = 0;
      i < rows.length;
      i++
    ) {
      rows[i]
        .items
        .sort(
          function (a, b) {
            return (
              a
                .getBoundingClientRect()
                .left -
              b
                .getBoundingClientRect()
                .left
            );
          }
        );
    }

    return rows;
  }

  function nearest(
    items,
    current
  ) {
    if (
      !items ||
      !items.length
    ) {
      return null;
    }

    if (!current) {
      return items[0];
    }

    var cr =
      current
        .getBoundingClientRect();

    var cx =
      cr.left +
      cr.width / 2;

    var best =
      items[0];

    var bestDistance =
      Infinity;

    var i;

    for (
      i = 0;
      i < items.length;
      i++
    ) {
      var r =
        items[i]
          .getBoundingClientRect();

      var distance =
        Math.abs(
          (
            r.left +
            r.width / 2
          ) -
          cx
        );

      if (
        distance <
        bestDistance
      ) {
        bestDistance =
          distance;

        best =
          items[i];
      }
    }

    return best;
  }

  function makeNavigation(
    root,
    viewport,
    edgeLeft,
    edgeUp
  ) {
    var last = null;

    function current() {
      if (
        last &&
        document.documentElement
          .contains(last) &&
        last.offsetParent !== null
      ) {
        return last;
      }

      var focused =
        root.find(
          '.selector.focus'
        )[0];

      if (focused) {
        return focused;
      }

      var list =
        visibleSelectors(
          root
        );

      return list.length
        ? list[0]
        : null;
    }

    function focus(element) {
      if (!element) {
        return false;
      }

      last = element;

      try {
        Lampa.Controller.collectionFocus(
          element,
          viewport
        );
      } catch (e) {
        try {
          Lampa.Controller.focus(
            element
          );
        } catch (e2) {}
      }

      ensureVisible(
        viewport,
        element
      );

      $(element)
        .trigger(
          'ah:focus'
        );

      return true;
    }

    function move(direction) {
      var list =
        visibleSelectors(
          root
        );

      var cur =
        current();

      if (
        !list.length ||
        !cur
      ) {
        return false;
      }

      var rows =
        groupRows(
          list
        );

      var rowIndex = -1;
      var columnIndex = -1;
      var r;
      var c;

      for (
        r = 0;
        r < rows.length;
        r++
      ) {
        for (
          c = 0;
          c < rows[r].items.length;
          c++
        ) {
          if (
            rows[r].items[c] ===
            cur
          ) {
            rowIndex = r;
            columnIndex = c;
            break;
          }
        }

        if (
          rowIndex >= 0
        ) {
          break;
        }
      }

      if (
        rowIndex < 0
      ) {
        return focus(
          list[0]
        );
      }

      if (
        direction === 'left'
      ) {
        if (
          columnIndex > 0
        ) {
          return focus(
            rows[rowIndex]
              .items[
                columnIndex - 1
              ]
          );
        }

        if (
          typeof edgeLeft ===
          'function'
        ) {
          edgeLeft();
        }

        return false;
      }

      if (
        direction === 'right'
      ) {
        if (
          columnIndex <
          rows[rowIndex]
            .items.length - 1
        ) {
          return focus(
            rows[rowIndex]
              .items[
                columnIndex + 1
              ]
          );
        }

        return false;
      }

      if (
        direction === 'up'
      ) {
        if (
          rowIndex > 0
        ) {
          return focus(
            nearest(
              rows[
                rowIndex - 1
              ].items,
              cur
            )
          );
        }

        if (
          typeof edgeUp ===
          'function'
        ) {
          edgeUp();
        }

        return false;
      }

      if (
        direction === 'down'
      ) {
        if (
          rowIndex <
          rows.length - 1
        ) {
          return focus(
            nearest(
              rows[
                rowIndex + 1
              ].items,
              cur
            )
          );
        }

        return false;
      }

      return false;
    }

    function bind() {
      root
        .find('.selector')
        .off(
          'hover:focus.' +
          NS
        )
        .on(
          'hover:focus.' +
          NS,

          function () {
            last = this;

            ensureVisible(
              viewport,
              this
            );

            $(this)
              .trigger(
                'ah:focus'
              );
          }
        );
    }

    return {
      focus: focus,
      move: move,
      bind: bind,

      getLast:
        function () {
          return last;
        }
    };
  }

  function triggerFocused(
    root,
    navigation
  ) {
    var focused =
      root.find(
        '.selector.focus'
      )[0] ||
      navigation.getLast();

    if (focused) {
      $(focused)
        .trigger(
          'hover:enter'
        );
    }
  }

  function installContentController(
    viewport,
    root,
    navigation,
    backHandler
  ) {
    Lampa.Controller.add(
      'content',

      {
        toggle:
          function () {
            Lampa.Controller.collectionSet(
              viewport
            );

            Lampa.Controller.collectionFocus(
              navigation.getLast() ||
              false,
              viewport
            );

            if (
              navigation.getLast()
            ) {
              ensureVisible(
                viewport,
                navigation.getLast()
              );
            }
          },

        left:
          function () {
            navigation.move('left');
          },

        right:
          function () {
            navigation.move('right');
          },

        up:
          function () {
            navigation.move('up');
          },

        down:
          function () {
            navigation.move('down');
          },

        enter:
          function () {
            triggerFocused(
              root,
              navigation
            );
          },

        back:
          function () {
            if (
              typeof backHandler ===
              'function'
            ) {
              backHandler();
            } else {
              Lampa.Activity.backward();
            }
          }
      }
    );

    Lampa.Controller.toggle(
      'content'
    );
  }

  /* =======================================================
   * Navigation actions / filters
   * ===================================================== */

  function openHome() {
    if (
      !workerConfigured()
    ) {
      notify(
        'AnimeHub: сначала укажите WORKER URL в animehub.js'
      );

      return;
    }

    Lampa.Activity.push(
      {
        url: '',
        title: 'AnimeHub',
        component: HOME,
        page: 1
      }
    );
  }

  function openCatalog(
    mode,
    value,
    title,
    page
  ) {
    Lampa.Activity.push(
      {
        url: '',

        title:
          title ||
          'AnimeHub',

        component:
          CATALOG,

        ah_mode:
          mode ||
          'popular',

        ah_value:
          value ||
          '',

        ah_title:
          title ||
          'AnimeHub',

        ah_page:
          page ||
          1,

        page:
          1
      }
    );
  }

  function openDetail(item) {
    if (
      !item ||
      !item.id
    ) {
      return;
    }

    Lampa.Activity.push(
      {
        url: '',

        title:
          item.title ||
          'AnimeHub',

        component:
          DETAIL,

        ah_item:
          compactItem(item),

        page: 1
      }
    );
  }

  function openSearchInput() {
    if (
      !Lampa.Input ||
      typeof Lampa.Input.edit !==
        'function'
    ) {
      notify(
        'Поиск недоступен в этой сборке Lampa'
      );

      return;
    }

    try {
      Lampa.Input.edit(
        {
          title:
            'Поиск AnimeHub',

          value: '',
          free: true,
          nosave: true
        },

        function (result) {
          try {
            Lampa.Controller.toggle(
              'content'
            );
          } catch (e) {}

          var value = result;

          if (
            result &&
            typeof result ===
              'object' &&
            typeof result.value !==
              'undefined'
          ) {
            value = result.value;
          }

          var query =
            clean(
              value ||
              ''
            );

          if (!query) {
            return;
          }

          openCatalog(
            'search',
            query,
            'Поиск: ' +
            query,
            1
          );
        }
      );
    } catch (e2) {
      notify(
        'Не удалось открыть поиск'
      );
    }
  }

  function showSelect(
    title,
    items,
    onSelect
  ) {
    if (
      !items ||
      !items.length
    ) {
      notify(
        'AnimeHub: список пуст'
      );

      return;
    }

    Lampa.Select.show(
      {
        title: title,
        items: items,

        onSelect:
          function (item) {
            if (
              typeof onSelect ===
              'function'
            ) {
              onSelect(item);
            }
          },

        onBack:
          function () {
            Lampa.Controller.toggle(
              'content'
            );
          }
      }
    );
  }

  function loadGenres(callback) {
    if (genresCache) {
      callback(genresCache);
      return;
    }

    var network =
      new Lampa.Reguest();

    network.timeout(
      15000
    );

    requestCachedJson(
      network,
      'genres',
      24 * 60 * 60 * 1000,

      workerUrl(
        'genres'
      ),

      function (data) {
        genresCache =
          data;

        try {
          network.clear();
        } catch (e) {}

        callback(data);
      },

      function (error) {
        try {
          network.clear();
        } catch (e2) {}

        notify(
          'Не удалось загрузить жанры' +
          (
            error &&
            error.status
              ? ' • ' +
                error.status
              : ''
          )
        );
      }
    );
  }

  function showGenres() {
    loadGenres(
      function (data) {
        var source =
          data.genres ||
          [];

        var items = [];
        var i;

        for (
          i = 0;
          i < source.length;
          i++
        ) {
          items.push(
            {
              title:
                source[i].russian ||
                source[i].name,

              ah_id:
                source[i].id
            }
          );
        }

        showSelect(
          'Жанры',
          items,

          function (item) {
            openCatalog(
              'genre',
              item.ah_id,
              item.title,
              1
            );
          }
        );
      }
    );
  }

  function showKinds() {
    var items = [
      {
        title: 'TV-сериалы',
        value: 'tv'
      },

      {
        title: 'Фильмы',
        value: 'movie'
      },

      {
        title: 'OVA',
        value: 'ova'
      },

      {
        title: 'ONA',
        value: 'ona'
      },

      {
        title: 'Спецвыпуски',
        value: 'special'
      },

      {
        title: 'TV-спецвыпуски',
        value: 'tv_special'
      },

      {
        title: 'Музыкальные клипы',
        value: 'music'
      }
    ];

    showSelect(
      'Категории',
      items,

      function (item) {
        openCatalog(
          'kind',
          item.value,
          item.title,
          1
        );
      }
    );
  }

  function showYears() {
    var items = [];

    var year =
      currentYear() +
      1;

    var min =
      currentYear() -
      30;

    for (
      ;
      year >= min;
      year--
    ) {
      items.push(
        {
          title:
            String(year),

          value:
            String(year)
        }
      );
    }

    items.push(
      {
        title: '2010-е',
        value: '201x'
      }
    );

    items.push(
      {
        title: '2000-е',
        value: '200x'
      }
    );

    items.push(
      {
        title: '1990-е',
        value: '199x'
      }
    );

    items.push(
      {
        title: '1980-е',
        value: '198x'
      }
    );

    showSelect(
      'Год',
      items,

      function (item) {
        openCatalog(
          'year',
          item.value,
          item.title,
          1
        );
      }
    );
  }

  function makeTopBar(onHome) {
    var top =
      $('<div class="ah-topbar"></div>');

    var brand =
      $('<div class="ah-brand"></div>');

    var nav =
      $('<div class="ah-nav"></div>');

    brand.append(
      toriiSvg(
        'ah-brand-logo'
      )
    );

    brand.append(
      '<b>AnimeHub</b>'
    );

    function add(
      label,
      handler
    ) {
      var button =
        $(
          '<div class="ah-navbtn selector"></div>'
        )
          .text(label);

      button.on(
        'hover:enter',
        handler
      );

      nav.append(button);
    }

    add(
      'Главная',

      function () {
        if (
          typeof onHome ===
          'function'
        ) {
          onHome();
        } else {
          openHome();
        }
      }
    );

    add(
      'Поиск',
      openSearchInput
    );

    add(
      'Жанр',
      showGenres
    );

    add(
      'Категории',
      showKinds
    );

    add(
      'Год',
      showYears
    );

    add(
      'Онгоинги',

      function () {
        openCatalog(
          'ongoing',
          '',
          'Онгоинги',
          1
        );
      }
    );

    add(
      'Анонсы',

      function () {
        openCatalog(
          'anons',
          '',
          'Анонсы',
          1
        );
      }
    );

    top
      .append(brand)
      .append(nav);

    return top;
  }

  /* =======================================================
   * Cards
   * ===================================================== */

  function makeWideCard(item) {
    var card =
      $('<div class="ah-wide-card selector"></div>');

    if (item.poster) {
      var image =
        $('<img alt="">')
          .attr(
            {
              src: item.poster,
              loading: 'lazy',
              decoding: 'async'
            }
          );

      image.on(
        'error',

        function () {
          $(this).hide();
        }
      );

      card.append(image);
    }

    card.append(
      '<div class="ah-wide-shade"></div>'
    );

    if (
      item.status ===
      'ongoing'
    ) {
      card.append(
        '<div class="ah-wide-badge">ОНГОИНГ</div>'
      );
    } else if (
      item.status ===
      'anons'
    ) {
      card.append(
        '<div class="ah-wide-badge">АНОНС</div>'
      );
    }

    var copy =
      $('<div class="ah-wide-copy"></div>');

    copy.append(
      $('<div class="ah-wide-title"></div>')
        .text(
          item.title ||
          'Anime'
        )
    );

    var meta =
      $('<div class="ah-wide-meta"></div>');

    if (item.year) {
      meta.append(
        '<span>' +
          escapeHtml(
            item.year
          ) +
        '</span>'
      );
    }

    meta.append(
      '<span>' +
        escapeHtml(
          kindLabel(
            item.kind
          )
        ) +
      '</span>'
    );

    if (
      toNumber(
        item.score,
        0
      ) > 0
    ) {
      meta.append(
        '<span style="color:#ffd76a">' +
          '★ ' +
          escapeHtml(
            formatScore(
              item.score
            )
          ) +
        '</span>'
      );
    }

    if (
      episodeText(item)
    ) {
      meta.append(
        '<span>' +
          escapeHtml(
            episodeText(
              item
            )
          ) +
        '</span>'
      );
    }

    copy.append(meta);
    card.append(copy);

    card.on(
      'hover:enter',

      function () {
        openDetail(item);
      }
    );

    return card;
  }

  function makePosterCard(item) {
    var card =
      $('<div class="ah-poster-card selector"></div>');

    var media =
      $('<div class="ah-poster-media"></div>');

    putImage(
      media,
      item.poster,
      item.title
    );

    if (
      toNumber(
        item.score,
        0
      ) > 0
    ) {
      media.append(
        '<div class="ah-poster-score">' +
          '★ ' +
          escapeHtml(
            formatScore(
              item.score
            )
          ) +
        '</div>'
      );
    }

    card.append(media);

    card.append(
      $('<div class="ah-poster-title"></div>')
        .text(
          item.title ||
          'Anime'
        )
    );

    var meta = [];

    if (item.year) {
      meta.push(item.year);
    }

    if (item.kind) {
      meta.push(
        kindLabel(
          item.kind
        )
      );
    }

    if (
      episodeText(item)
    ) {
      meta.push(
        episodeText(item)
      );
    }

    card.append(
      $('<div class="ah-poster-meta"></div>')
        .text(
          meta.join(
            ' • '
          )
        )
    );

    card.on(
      'hover:enter',

      function () {
        openDetail(item);
      }
    );

    return card;
  }

  function addShelf(
    root,
    title,
    items
  ) {
    if (
      !items ||
      !items.length
    ) {
      return;
    }

    var shelf =
      $('<div class="ah-shelf"></div>');

    shelf.append(
      $('<div class="ah-shelf-title"></div>')
        .text(title)
    );

    var track =
      $('<div class="ah-track"></div>');

    var i;

    for (
      i = 0;
      i < items.length &&
      i < 18;
      i++
    ) {
      track.append(
        makeWideCard(
          items[i]
        )
      );
    }

    shelf.append(track);
    root.append(shelf);
  }

  /* =======================================================
   * Home
   * ===================================================== */

  function HomeComponent(object) {
    var network =
      new Lampa.Reguest();

    var alive = false;

    var viewport =
      $('<div class="ah-view"></div>');

    var root =
      $('<div class="ah-page"></div>');

    var navigation;

    function buildHero(item) {
      if (!item) {
        return $('<div></div>');
      }

      var hero =
        $('<div class="ah-hero"></div>');

      var background =
        item.background ||
        item.poster ||
        '';

      if (background) {
        hero.append(
          $('<img class="ah-hero-bg" alt="">')
            .attr(
              {
                src: background,
                decoding: 'async'
              }
            )
            .addClass(
              item.background
                ? ''
                : 'poster-bg'
            )
        );
      }

      hero.append(
        '<div class="ah-hero-shade"></div>'
      );

      var content =
        $('<div class="ah-hero-content"></div>');

      content.append(
        '<div class="ah-kicker">' +
          'Сейчас в центре внимания' +
        '</div>'
      );

      content.append(
        $('<div class="ah-hero-title"></div>')
          .text(
            item.title ||
            'AnimeHub'
          )
      );

      if (
        item.name &&
        item.name !==
        item.title
      ) {
        content.append(
          $('<div class="ah-original-title"></div>')
            .text(item.name)
        );
      }

      var meta =
        $('<div class="ah-meta"></div>');

      if (
        toNumber(
          item.score,
          0
        ) > 0
      ) {
        meta.append(
          '<span class="ah-chip score">' +
            '★ ' +
            escapeHtml(
              formatScore(
                item.score
              )
            ) +
          '</span>'
        );
      }

      if (item.year) {
        meta.append(
          '<span class="ah-chip">' +
            escapeHtml(
              item.year
            ) +
          '</span>'
        );
      }

      meta.append(
        '<span class="ah-chip">' +
          escapeHtml(
            kindLabel(
              item.kind
            )
          ) +
        '</span>'
      );

      if (
        statusLabel(
          item.status
        )
      ) {
        meta.append(
          '<span class="ah-chip hot">' +
            escapeHtml(
              statusLabel(
                item.status
              )
            ) +
          '</span>'
        );
      }

      if (
        episodeText(item)
      ) {
        meta.append(
          '<span class="ah-chip">' +
            escapeHtml(
              episodeText(item)
            ) +
          '</span>'
        );
      }

      content.append(meta);

      content.append(
        $('<div class="ah-hero-desc"></div>')
          .text(
            clip(
              item.description ||
              'Откройте карточку аниме, чтобы увидеть описание, рейтинг, студию, жанры, скриншоты и связанные тайтлы.',
              340
            )
          )
      );

      var actions =
        $('<div class="ah-actions"></div>');

      var details =
        $(
          '<div class="ah-action primary selector">' +
            'Подробнее' +
          '</div>'
        );

      var favorite =
        $('<div class="ah-action selector"></div>');

      function refreshFavorite() {
        favorite.text(
          isFavorite(
            item.id
          )
            ? '★ В избранном'
            : '☆ В избранное'
        );
      }

      refreshFavorite();

      details.on(
        'hover:enter',

        function () {
          openDetail(item);
        }
      );

      favorite.on(
        'hover:enter',

        function () {
          var added =
            toggleFavorite(item);

          refreshFavorite();

          notify(
            added
              ? 'Добавлено в избранное'
              : 'Удалено из избранного'
          );
        }
      );

      actions
        .append(details)
        .append(favorite);

      content.append(actions);
      hero.append(content);

      return hero;
    }

    function render(data) {
      if (!alive) {
        return;
      }

      root.empty();

      viewport[0].scrollTop =
        0;

      root.append(
        makeTopBar(
          function () {}
        )
      );

      root.append(
        buildHero(
          data.featured
        )
      );

      addShelf(
        root,
        'Избранное',
        storedList(
          FAVORITES_KEY
        )
      );

      addShelf(
        root,
        'Недавно открывали',
        storedList(
          RECENT_KEY
        )
      );

      addShelf(
        root,
        'Сейчас выходит',
        data.ongoing ||
        []
      );

      addShelf(
        root,

        (
          data.meta &&
          data.meta.seasonLabel
        )
          ? data.meta.seasonLabel
          : 'Текущий сезон',

        data.season ||
        []
      );

      addShelf(
        root,
        'Недавно вышло',
        data.latest ||
        []
      );

      addShelf(
        root,
        'Высокий рейтинг',
        data.top ||
        []
      );

      navigation.bind();

      setTimeout(
        function () {
          if (!alive) {
            return;
          }

          var first =
            root.find(
              '.ah-action.selector'
            )[0] ||
            root.find(
              '.selector'
            )[0];

          if (first) {
            navigation.focus(
              first
            );
          }
        },
        90
      );
    }

    function fail(error) {
      if (!alive) {
        return;
      }

      root.empty();

      root.append(
        makeTopBar(
          function () {}
        )
      );

      root.append(
        '<div class="ah-empty">' +
          'Не удалось загрузить AnimeHub' +
          (
            error &&
            error.status
              ? ' • код ' +
                escapeHtml(
                  error.status
                )
              : ''
          ) +
          '<br><br>' +
          'Проверьте Cloudflare Worker и интернет-соединение.' +
        '</div>'
      );
    }

    this.create =
      function () {
        alive = true;

        viewport.append(root);

        root.append(
          makeTopBar(
            function () {}
          )
        );

        root.append(
          loaderHtml(
            'Загрузка AnimeHub…'
          )
        );

        navigation =
          makeNavigation(
            root,
            viewport,

            function () {
              Lampa.Controller.toggle(
                'menu'
              );
            },

            function () {
              Lampa.Controller.toggle(
                'head'
              );
            }
          );

        network.timeout(
          20000
        );

        requestCachedJson(
          network,
          'home',
          3 * 60 * 1000,

          workerUrl(
            'home'
          ),

          render,
          fail
        );

        return this.render();
      };

    this.start =
      function () {
        if (
          Lampa.Activity.active().activity !==
          this.activity
        ) {
          return;
        }

        installContentController(
          viewport,
          root,
          navigation,

          function () {
            Lampa.Activity.backward();
          }
        );
      };

    this.pause =
      function () {};

    this.stop =
      function () {};

    this.render =
      function () {
        return viewport;
      };

    this.destroy =
      function () {
        alive = false;

        network.clear();
        viewport.remove();
        root.remove();
      };
  }

  /* =======================================================
   * Catalogue / Search
   * ===================================================== */

  function CatalogComponent(object) {
    var network =
      new Lampa.Reguest();

    var alive = false;

    var viewport =
      $('<div class="ah-view"></div>');

    var root =
      $('<div class="ah-page"></div>');

    var navigation;

    var mode =
      object.ah_mode ||
      'popular';

    var value =
      object.ah_value ||
      '';

    var title =
      object.ah_title ||
      'AnimeHub';

    var page =
      toInt(
        object.ah_page,
        1
      );

    var limit = 24;

    function render(data) {
      if (!alive) {
        return;
      }

      root.empty();

      viewport[0].scrollTop =
        0;

      root.append(
        makeTopBar()
      );

      var head =
        $('<div class="ah-section-head"></div>');

      head.append(
        $('<div class="ah-page-title"></div>')
          .text(title)
      );

      head.append(
        $('<div class="ah-page-sub"></div>')
          .text(
            data.items &&
            data.items.length
              ? (
                  'Страница ' +
                  page +
                  ' • ' +
                  data.items.length +
                  ' тайтлов'
                )
              : (
                  'Страница ' +
                  page
                )
          )
      );

      root.append(head);

      if (
        !data.items ||
        !data.items.length
      ) {
        root.append(
          '<div class="ah-empty">' +
            'Ничего не найдено.' +
          '</div>'
        );
      } else {
        var grid =
          $('<div class="ah-grid"></div>');

        var i;

        for (
          i = 0;
          i < data.items.length;
          i++
        ) {
          grid.append(
            makePosterCard(
              data.items[i]
            )
          );
        }

        root.append(grid);
      }

      if (
        page > 1 ||
        data.hasNext
      ) {
        var pages =
          $('<div class="ah-pages"></div>');

        if (page > 1) {
          var prev =
            $(
              '<div class="ah-pagebtn selector">' +
                '← Страница ' +
                (page - 1) +
              '</div>'
            );

          prev.on(
            'hover:enter',

            function () {
              openCatalog(
                mode,
                value,
                title,
                page - 1
              );
            }
          );

          pages.append(prev);
        }

        pages.append(
          '<div class="ah-pagebtn">' +
            'Страница ' +
            page +
          '</div>'
        );

        if (data.hasNext) {
          var next =
            $(
              '<div class="ah-pagebtn selector">' +
                'Страница ' +
                (page + 1) +
                ' →' +
              '</div>'
            );

          next.on(
            'hover:enter',

            function () {
              openCatalog(
                mode,
                value,
                title,
                page + 1
              );
            }
          );

          pages.append(next);
        }

        root.append(pages);
      }

      navigation.bind();

      setTimeout(
        function () {
          if (!alive) {
            return;
          }

          var first =
            root.find(
              '.ah-poster-card.selector'
            )[0] ||
            root.find(
              '.selector'
            )[0];

          if (first) {
            navigation.focus(
              first
            );
          }
        },
        80
      );
    }

    function fail(error) {
      if (!alive) {
        return;
      }

      root.empty();

      root.append(
        makeTopBar()
      );

      root.append(
        $('<div class="ah-page-title"></div>')
          .text(title)
      );

      root.append(
        '<div class="ah-empty">' +
          'Не удалось загрузить каталог' +
          (
            error &&
            error.status
              ? ' • код ' +
                escapeHtml(
                  error.status
                )
              : ''
          ) +
        '</div>'
      );
    }

    this.create =
      function () {
        alive = true;

        viewport.append(root);

        root.append(
          makeTopBar()
        );

        root.append(
          loaderHtml(
            'Загрузка каталога…'
          )
        );

        navigation =
          makeNavigation(
            root,
            viewport,

            function () {
              Lampa.Controller.toggle(
                'menu'
              );
            },

            function () {
              Lampa.Controller.toggle(
                'head'
              );
            }
          );

        network.timeout(
          20000
        );

        requestCachedJson(
          network,

          'catalog:' +
          mode +
          ':' +
          value +
          ':' +
          page,

          2 * 60 * 1000,

          workerUrl(
            'catalog',

            {
              mode: mode,
              value: value,
              page: page,
              limit: limit
            }
          ),

          render,
          fail
        );

        return this.render();
      };

    this.start =
      function () {
        if (
          Lampa.Activity.active().activity !==
          this.activity
        ) {
          return;
        }

        installContentController(
          viewport,
          root,
          navigation,

          function () {
            Lampa.Activity.backward();
          }
        );
      };

    this.pause =
      function () {};

    this.stop =
      function () {};

    this.render =
      function () {
        return viewport;
      };

    this.destroy =
      function () {
        alive = false;

        network.clear();
        viewport.remove();
        root.remove();
      };
  }

  /* =======================================================
   * Detail page
   * ===================================================== */

  function DetailComponent(object) {
    var network =
      new Lampa.Reguest();

    var alive = false;

    var viewport =
      $('<div class="ah-view"></div>');

    var root =
      $('<div class="ah-page"></div>');

    var navigation;

    var initial =
      object.ah_item ||
      {};

    function progressBlock(data) {
      var total =
        toInt(
          data.episodes,
          0
        );

      var aired =
        toInt(
          data.episodesAired,
          0
        );

      var percent = 0;
      var title = '';
      var note = '';

      if (total > 0) {
        percent =
          Math.max(
            0,

            Math.min(
              100,

              Math.round(
                (
                  Math.min(
                    aired ||
                    total,
                    total
                  ) /
                  total
                ) *
                100
              )
            )
          );
      }

      if (
        data.status ===
        'ongoing'
      ) {
        title =
          total > 0
            ? (
                'Вышло ' +
                aired +
                ' из ' +
                total +
                ' серий'
              )
            : (
                'Вышло серий: ' +
                aired
              );
      } else if (
        data.status ===
        'released'
      ) {
        title =
          total > 0
            ? (
                'Серий: ' +
                total
              )
            : 'Релиз завершён';

        percent = 100;
      } else {
        title =
          total > 0
            ? (
                'Заявлено серий: ' +
                total
              )
            : 'Количество серий пока не объявлено';
      }

      if (
        data.nextEpisodeAt &&
        data.status ===
          'ongoing'
      ) {
        note =
          'Следующая серия: ' +
          formatDate(
            data.nextEpisodeAt
          );
      } else if (
        data.duration
      ) {
        note =
          'Средняя длительность серии: ' +
          data.duration +
          ' мин.';
      }

      var block =
        $('<div class="ah-progress-panel"></div>');

      block.append(
        '<div class="ah-progress-head">' +
          '<span>Серии</span>' +
          '<span>' +
            escapeHtml(
              title
            ) +
          '</span>' +
        '</div>'
      );

      block.append(
        '<div class="ah-progress-track">' +
          '<div class="ah-progress-fill" style="width:' +
            percent +
            '%">' +
          '</div>' +
        '</div>'
      );

      if (note) {
        block.append(
          '<div class="ah-progress-note">' +
            escapeHtml(
              note
            ) +
          '</div>'
        );
      }

      return block;
    }

    function render(data) {
      if (!alive) {
        return;
      }

      saveRecent(data);

      root.empty();

      viewport[0].scrollTop =
        0;

      root.append(
        makeTopBar()
      );

      var hero =
        $('<div class="ah-detail-hero"></div>');

      var bg =
        data.background ||
        data.poster ||
        '';

      if (bg) {
        hero.append(
          $('<img class="ah-detail-bg" alt="">')
            .attr(
              {
                src: bg,
                decoding: 'async'
              }
            )
            .addClass(
              data.background
                ? ''
                : 'poster-bg'
            )
        );
      }

      hero.append(
        '<div class="ah-detail-shade"></div>'
      );

      var content =
        $('<div class="ah-detail-content"></div>');

      var poster =
        $('<div class="ah-detail-poster"></div>');

      putImage(
        poster,
        data.poster,
        data.title
      );

      var copy =
        $('<div class="ah-detail-copy"></div>');

      copy.append(
        '<div class="ah-kicker">' +
          'AnimeHub • Shikimori' +
        '</div>'
      );

      copy.append(
        $('<div class="ah-detail-title"></div>')
          .text(
            data.title ||
            'Anime'
          )
      );

      var original =
        data.name ||
        data.english ||
        data.japanese ||
        '';

      if (
        original &&
        original !==
        data.title
      ) {
        copy.append(
          $('<div class="ah-original-title"></div>')
            .text(original)
        );
      }

      var meta =
        $('<div class="ah-meta"></div>');

      if (
        toNumber(
          data.score,
          0
        ) > 0
      ) {
        meta.append(
          '<span class="ah-chip score">' +
            '★ ' +
            escapeHtml(
              formatScore(
                data.score
              )
            ) +
          '</span>'
        );
      }

      if (data.year) {
        meta.append(
          '<span class="ah-chip">' +
            escapeHtml(
              data.year
            ) +
          '</span>'
        );
      }

      if (data.kind) {
        meta.append(
          '<span class="ah-chip">' +
            escapeHtml(
              kindLabel(
                data.kind
              )
            ) +
          '</span>'
        );
      }

      if (data.status) {
        meta.append(
          '<span class="ah-chip hot">' +
            escapeHtml(
              statusLabel(
                data.status
              )
            ) +
          '</span>'
        );
      }

      if (data.rating) {
        meta.append(
          '<span class="ah-chip">' +
            escapeHtml(
              ratingLabel(
                data.rating
              )
            ) +
          '</span>'
        );
      }

      if (data.season) {
        meta.append(
          '<span class="ah-chip">' +
            escapeHtml(
              seasonLabel(
                data.season
              )
            ) +
          '</span>'
        );
      }

      copy.append(meta);

      if (
        data.studios &&
        data.studios.length
      ) {
        var studios = [];
        var si;

        for (
          si = 0;
          si < data.studios.length;
          si++
        ) {
          studios.push(
            data.studios[si].name
          );
        }

        copy.append(
          $('<div class="ah-studio"></div>')
            .text(
              'Студия: ' +
              studios.join(', ')
            )
        );
      }

      if (
        data.genres &&
        data.genres.length
      ) {
        var genreMeta =
          $('<div class="ah-meta"></div>');

        var gi;

        for (
          gi = 0;
          gi < data.genres.length &&
          gi < 8;
          gi++
        ) {
          genreMeta.append(
            '<span class="ah-chip">' +
              escapeHtml(
                data.genres[gi].russian ||
                data.genres[gi].name
              ) +
            '</span>'
          );
        }

        copy.append(
          genreMeta
        );
      }

      copy.append(
        $('<div class="ah-detail-desc"></div>')
          .text(
            data.description ||
            'Описание пока отсутствует.'
          )
      );

      var actions =
        $('<div class="ah-actions"></div>');

      var watch =
        $('<div class="ah-action primary selector"></div>');

      var favorite =
        $('<div class="ah-action selector"></div>');

      function refreshWatch() {
        var state =
          watchState(
            data.id
          );

        var episode =
          toInt(
            state.episode,
            0
          );

        watch.text(
          episode > 0
            ? (
                '▶ Продолжить • серия ' +
                episode
              )
            : '▶ Смотреть'
        );
      }

      function refreshFavorite() {
        favorite.text(
          isFavorite(
            data.id
          )
            ? '★ В избранном'
            : '☆ В избранное'
        );
      }

      refreshWatch();
      refreshFavorite();

      watch.on(
        'hover:enter',

        function () {
          openWatch(data);
        }
      );

      favorite.on(
        'hover:enter',

        function () {
          var added =
            toggleFavorite(data);

          refreshFavorite();

          notify(
            added
              ? 'Добавлено в избранное'
              : 'Удалено из избранного'
          );
        }
      );

      actions
        .append(watch)
        .append(favorite);

      copy.append(actions);

      content
        .append(poster)
        .append(copy);

      hero.append(content);
      root.append(hero);

      root.append(
        progressBlock(data)
      );

      if (
        data.screenshots &&
        data.screenshots.length
      ) {
        root.append(
          '<div class="ah-block-title">' +
            'Скриншоты' +
          '</div>'
        );

        var screens =
          $('<div class="ah-screens"></div>');

        var i;

        for (
          i = 0;
          i < data.screenshots.length &&
          i < 12;
          i++
        ) {
          var shot =
            $('<div class="ah-screen"></div>');

          putImage(
            shot,

            data.screenshots[i].x332Url ||
            data.screenshots[i].originalUrl,

            'Скриншот'
          );

          screens.append(shot);
        }

        root.append(screens);
      }

      if (
        data.related &&
        data.related.length
      ) {
        addShelf(
          root,
          'Связанные аниме',
          data.related
        );
      }

      if (
        data.themes &&
        data.themes.length
      ) {
        var themeText = [];
        var ti;

        for (
          ti = 0;
          ti < data.themes.length &&
          ti < 12;
          ti++
        ) {
          themeText.push(
            data.themes[ti].russian ||
            data.themes[ti].name
          );
        }

        root.append(
          '<div class="ah-block-title">' +
            'Темы' +
          '</div>'
        );

        root.append(
          $('<div class="ah-progress-panel"></div>')
            .text(
              themeText.join(
                ' • '
              )
            )
        );
      }

      navigation.bind();

      setTimeout(
        function () {
          if (!alive) {
            return;
          }

          var first =
            root.find(
              '.ah-action.selector'
            )[0] ||
            root.find(
              '.selector'
            )[0];

          if (first) {
            navigation.focus(
              first
            );
          }
        },
        90
      );
    }

    function fail(error) {
      if (!alive) {
        return;
      }

      root.empty();

      root.append(
        makeTopBar()
      );

      root.append(
        $('<div class="ah-page-title"></div>')
          .text(
            initial.title ||
            'AnimeHub'
          )
      );

      root.append(
        '<div class="ah-empty">' +
          'Не удалось загрузить карточку аниме' +
          (
            error &&
            error.status
              ? ' • код ' +
                escapeHtml(
                  error.status
                )
              : ''
          ) +
        '</div>'
      );
    }

    this.create =
      function () {
        alive = true;

        viewport.append(root);

        root.append(
          makeTopBar()
        );

        root.append(
          loaderHtml(
            'Загрузка информации об аниме…'
          )
        );

        navigation =
          makeNavigation(
            root,
            viewport,

            function () {
              Lampa.Activity.backward();
            },

            function () {
              Lampa.Controller.toggle(
                'head'
              );
            }
          );

        network.timeout(
          20000
        );

        requestCachedJson(
          network,

          'detail:' +
          String(
            initial.id ||
            ''
          ),

          10 * 60 * 1000,

          workerUrl(
            'anime',

            {
              id:
                initial.id
            }
          ),

          function (response) {
            render(
              response.anime
            );
          },

          fail
        );

        return this.render();
      };

    this.start =
      function () {
        if (
          Lampa.Activity.active().activity !==
          this.activity
        ) {
          return;
        }

        installContentController(
          viewport,
          root,
          navigation,

          function () {
            Lampa.Activity.backward();
          }
        );
      };

    this.pause =
      function () {};

    this.stop =
      function () {};

    this.render =
      function () {
        return viewport;
      };

    this.destroy =
      function () {
        alive = false;

        network.clear();
        viewport.remove();
        root.remove();
      };
  }

  /* =======================================================
   * Menu + boot
   * ===================================================== */

  function addMenuButton() {
    if (
      $(
        '.menu .menu__list [data-action="' +
        NS +
        '"]'
      ).length
    ) {
      return;
    }

    var button =
      $(
        '<li class="menu__item selector" data-action="' +
        NS +
        '">' +

        '<div class="menu__ico">' +
          toriiSvg('') +
        '</div>' +

        '<div class="menu__text">' +
          'AnimeHub' +
        '</div>' +

        '</li>'
      );

    button.on(
      'hover:enter',
      openHome
    );

    $('.menu .menu__list')
      .eq(0)
      .append(button);
  }

  function init() {
    if (
      window[FLAG]
    ) {
      return;
    }

    window[FLAG] =
      true;

    try {
      injectStyle();
      installPlaybackTracker();

      Lampa.Component.add(
        HOME,
        HomeComponent
      );

      Lampa.Component.add(
        CATALOG,
        CatalogComponent
      );

      Lampa.Component.add(
        DETAIL,
        DetailComponent
      );

      addMenuButton();

      if (
        workerConfigured()
      ) {
        notify(
          'AnimeHub V' +
          VERSION +
          ' загружен'
        );
      } else {
        notify(
          'AnimeHub установлен • укажите WORKER URL'
        );
      }
    } catch (error) {
      console.log(
        'AnimeHub V' +
        VERSION +
        ' init error',
        error
      );

      notify(
        'Ошибка запуска AnimeHub V' +
        VERSION
      );
    }
  }

  if (
    window.appready
  ) {
    init();
  } else {
    Lampa.Listener.follow(
      'app',

      function (event) {
        if (
          event &&
          event.type ===
            'ready'
        ) {
          init();
        }
      }
    );
  }
})();
