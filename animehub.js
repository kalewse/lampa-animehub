(function () {
'use strict';

var VERSION='0.3.0';
var NS='animehub_v030';
var HOME=NS+'_home',CATALOG=NS+'_catalog',DETAIL=NS+'_detail';

var FAVORITES_KEY='animehub_v010_favorites';
var RECENT_KEY='animehub_v010_recent';
var WATCH_KEY='animehub_v020_watch';

var WORKER='https://animehub-lampa.kalewse69.workers.dev/';

var genresCache=null;
var memoryCache={};

function notify(t){
    try{
        Lampa.Noty.show(t);
    }
    catch(e){}
}

function clean(v){
    return String(v==null?'':v)
        .replace(/\u00a0/g,' ')
        .replace(/\s+/g,' ')
        .trim();
}

function cleanDescription(v){
    return clean(
        String(v==null?'':v)
            .replace(/<[^>]*>/g,' ')
            .replace(/&nbsp;|&#160;/gi,' ')
            .replace(/&amp;/gi,'&')
            .replace(/&quot;/gi,'"')
            .replace(/&#39;|&apos;/gi,"'")
            .replace(/&lt;/gi,'<')
            .replace(/&gt;/gi,'>')
            .replace(/\[br\s*\/?\]/gi,' ')
            .replace(/\[\/?[a-z][a-z0-9_-]*(?:=[^\]]*)?\]/gi,' ')
    );
}

function esc(v){
    return String(v==null?'':v)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
}

function clip(v,n){
    v=clean(v);

    return !n||v.length<=n
        ?v
        :v.slice(0,n).replace(/\s+\S*$/,'')+'…';
}

function num(v,d){
    v=parseFloat(v);
    return isNaN(v)?d:v;
}

function intv(v,d){
    v=parseInt(v,10);
    return isNaN(v)?d:v;
}

function workerUrl(path,params){
    var base=WORKER.replace(/\/?$/,'/');
    var q=[];

    params=params||{};

    Object.keys(params).forEach(function(k){
        if(
            params[k]!==null &&
            params[k]!==undefined &&
            String(params[k])!==''
        ){
            q.push(
                encodeURIComponent(k)+'='+
                encodeURIComponent(String(params[k]))
            );
        }
    });

    return (
        base+
        String(path||'').replace(/^\//,'')+
        (q.length?'?'+q.join('&'):'')
    );
}

function parseJson(v){
    if(v&&typeof v==='object') return v;

    try{
        return JSON.parse(String(v||''));
    }
    catch(e){
        return null;
    }
}

function requestJson(net,url,ok,fail){
    net.silent(
        url,

        function(r){
            var d=parseJson(r);

            if(!d||d.ok===false){
                if(fail){
                    fail({
                        status:d&&d.upstreamStatus||0,
                        message:d&&d.error||'Ошибка AnimeHub Worker',
                        data:d
                    });
                }

                return;
            }

            if(ok) ok(d);
        },

        function(e){
            if(fail) fail(e||{});
        },

        false,

        {
            dataType:'text'
        }
    );
}

function requestCached(net,key,age,url,ok,fail){
    var c=memoryCache[key];

    if(c&&Date.now()-c.time<age){
        setTimeout(function(){
            ok(c.data);
        },0);

        return;
    }

    requestJson(
        net,
        url,

        function(d){
            memoryCache[key]={
                time:Date.now(),
                data:d
            };

            ok(d);
        },

        fail
    );
}

function formatScore(v){
    v=num(v,0);

    return v>0
        ?v.toFixed(2).replace(/0$/,'')
        :'—';
}

function kindLabel(v){
    return ({
        tv:'TV-сериал',
        movie:'Фильм',
        ova:'OVA',
        ona:'ONA',
        special:'Спецвыпуск',
        tv_special:'TV-спецвыпуск',
        music:'Клип',
        pv:'Проморолик',
        cm:'Реклама',
        tv_13:'TV • 12–13 серий',
        tv_24:'TV • 24–26 серий',
        tv_48:'TV • 48+ серий'
    })[v]||clean(v)||'Аниме';
}

function statusLabel(v){
    return ({
        ongoing:'Онгоинг',
        released:'Вышло',
        anons:'Анонс'
    })[v]||clean(v)||'';
}

function ratingLabel(v){
    return ({
        g:'G',
        pg:'PG',
        pg_13:'PG-13',
        r:'R-17',
        r_plus:'R+',
        rx:'18+'
    })[v]||clean(v)||'';
}

function seasonLabel(v){
    var m=String(v||'').match(
        /^(winter|spring|summer|fall)_(\d{4})$/
    );

    var n={
        winter:'Зима',
        spring:'Весна',
        summer:'Лето',
        fall:'Осень'
    };

    return m
        ?n[m[1]]+' '+m[2]
        :clean(v);
}

function formatDate(v){
    var m=String(v||'').match(
        /^(\d{4})-(\d{2})-(\d{2})/
    );

    var mo=[
        'янв','фев','мар','апр',
        'мая','июн','июл','авг',
        'сен','окт','ноя','дек'
    ];

    return m
        ?intv(m[3],1)+' '+mo[intv(m[2],1)-1]+' '+m[1]
        :String(v||'');
}

function episodeText(a){
    var t=intv(a&&a.episodes,0);
    var r=intv(a&&a.episodesAired,0);

    if(t&&r&&r<t) return r+' / '+t;
    if(t) return t+' сер.';
    if(r) return r+' сер.';

    return '';
}

function toriiSvg(cls){
    return (
        '<svg class="'+esc(cls||'')+'" viewBox="0 0 96 96" '+
        'xmlns="http://www.w3.org/2000/svg">'+

        '<circle cx="48" cy="30" r="22" fill="#e95aa8"/>'+
        '<path d="M18 76 L39 51 L50 63 L59 55 L79 76 Z" fill="#a78bfa"/>'+
        '<path d="M19 35 Q48 40 77 35 L74 43 Q48 47 22 43 Z" fill="#df5be8"/>'+
        '<rect x="24" y="45" width="48" height="6" rx="2" fill="#df5be8"/>'+
        '<rect x="29" y="48" width="7" height="27" rx="2" fill="#df5be8"/>'+
        '<rect x="60" y="48" width="7" height="27" rx="2" fill="#df5be8"/>'+
        '</svg>'
    );
}

function loaderHtml(t){
    return (
        '<div class="ah-loader">'+
            '<div class="ah-loader-ring"></div>'+
            toriiSvg('ah-loader-torii')+
            '<div>'+esc(t||'Загрузка…')+'</div>'+
        '</div>'
    );
}

/* ======================================================
 * STORAGE
 * ====================================================== */

function storedList(key){
    try{
        return Lampa.Storage.get(key,[])||[];
    }
    catch(e){
        return [];
    }
}

function compactItem(a){
    return {
        id:String(a&&a.id||''),
        title:a&&a.title||'Anime',
        name:a&&a.name||'',
        russian:a&&a.russian||'',
        english:a&&a.english||'',
        poster:a&&a.poster||'',
        score:a&&a.score||0,
        kind:a&&a.kind||'',
        status:a&&a.status||'',
        episodes:a&&a.episodes||0,
        episodesAired:a&&a.episodesAired||0,
        year:a&&a.year||null,
        season:a&&a.season||''
    };
}

function saveRecent(a){
    if(!a||!a.id) return;

    var old=storedList(RECENT_KEY);
    var out=[compactItem(a)];

    old.forEach(function(x){
        if(
            out.length<18 &&
            String(x.id)!==String(a.id)
        ){
            out.push(x);
        }
    });

    try{
        Lampa.Storage.set(
            RECENT_KEY,
            out
        );
    }
    catch(e){}
}

function isFavorite(id){
    return storedList(FAVORITES_KEY).some(
        function(x){
            return String(x.id)===String(id);
        }
    );
}

function toggleFavorite(a){
    var list=storedList(FAVORITES_KEY);
    var found=false;
    var out=[];

    if(!a||!a.id) return false;

    list.forEach(function(x){
        if(String(x.id)===String(a.id)){
            found=true;
        }
        else if(out.length<39){
            out.push(x);
        }
    });

    if(!found){
        out.unshift(
            compactItem(a)
        );
    }

    try{
        Lampa.Storage.set(
            FAVORITES_KEY,
            out
        );
    }
    catch(e){}

    return !found;
}

function watchStore(){
    try{
        var v=Lampa.Storage.get(
            WATCH_KEY,
            {}
        );

        return (
            v&&typeof v==='object'
                ?v
                :{}
        );
    }
    catch(e){
        return {};
    }
}

function watchState(id){
    return (
        watchStore()[
            String(id||'')
        ]||
        {}
    );
}

function saveWatchState(id,patch){
    id=String(id||'');

    if(!id) return;

    var s=watchStore();
    var x=s[id]||{};
    var k;

    for(k in patch){
        if(
            Object.prototype.hasOwnProperty.call(
                patch,
                k
            )
        ){
            x[k]=patch[k];
        }
    }

    x.updatedAt=Date.now();

    s[id]=x;

    try{
        Lampa.Storage.set(
            WATCH_KEY,
            s
        );
    }
    catch(e){}
}

/* ======================================================
 * CSS
 * ====================================================== */

function injectStyle(){
    if(
        $('#animehub-v030-style')
            .length
    ){
        return;
    }

    $('head').append(`
<style id="animehub-v030-style">

:root{
    --ah-bg:#070914;
    --ah-panel:#101326;
    --ah-text:#f8f7ff;
    --ah-purple:#8b5cf6;
    --ah-pink:#f062c0;
}

.ah-view{
    height:calc(100vh - 6.1em);
    overflow-y:auto;
    overflow-x:hidden;
    background:
        radial-gradient(
            circle at 76% -10%,
            rgba(126,80,255,.15),
            transparent 34%
        ),
        linear-gradient(
            180deg,
            #090b19,
            #060812 72%
        );
    color:var(--ah-text);
    box-sizing:border-box;
}

.ah-view::-webkit-scrollbar,
.ah-track::-webkit-scrollbar,
.ah-screens::-webkit-scrollbar,
.ah-episode-track::-webkit-scrollbar{
    width:0;
    height:0;
}

.ah-page{
    padding:0 2.15em 5em;
    box-sizing:border-box;
    min-height:100%;
}

.ah-topbar{
    height:4.8em;
    display:flex;
    align-items:center;
    gap:1.1em;
    position:relative;
    z-index:20;
}

.ah-brand{
    display:flex;
    align-items:center;
    gap:.55em;
    font-size:1.55em;
    font-weight:850;
    padding-right:1.15em;
    border-right:1px solid rgba(255,255,255,.18);
    white-space:nowrap;
}

.ah-brand-logo{
    width:2.05em;
    height:2.05em;
}

.ah-brand b{
    background:
        linear-gradient(
            90deg,
            #fff,
            #d96fff
        );
    -webkit-background-clip:text;
    color:transparent;
}

.ah-nav{
    display:flex;
    align-items:center;
    gap:.32em;
    overflow:hidden;
}

.ah-navbtn{
    padding:.63em .88em;
    border-radius:.72em;
    color:#d4d2e2;
    white-space:nowrap;
    border:1px solid transparent;
}

.ah-navbtn.focus{
    background:rgba(139,92,246,.42);
    border-color:rgba(208,174,255,.55);
    box-shadow:0 0 22px rgba(139,92,246,.28);
    color:#fff;
}

/* HOME HERO */

.ah-hero{
    position:relative;
    height:45vh;
    min-height:24em;
    max-height:33em;
    border-radius:1.05em;
    overflow:hidden;
    margin-bottom:1.65em;
    background:#111426;
    isolation:isolate;
}

.ah-hero-bg,
.ah-detail-bg{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    z-index:-4;
}

.poster-bg{
    filter:
        blur(18px)
        brightness(.5);
    transform:scale(1.08);
}

.ah-hero-shade{
    position:absolute;
    inset:0;
    z-index:-3;
    background:
        linear-gradient(
            90deg,
            rgba(5,7,18,.995) 0%,
            rgba(5,7,18,.95) 34%,
            rgba(5,7,18,.68) 56%,
            rgba(5,7,18,.30) 78%,
            rgba(5,7,18,.12) 100%
        ),
        linear-gradient(
            0deg,
            rgba(5,7,18,.88),
            rgba(5,7,18,.10) 60%
        );
}

.ah-hero-content{
    position:absolute;
    left:3.8%;
    top:9%;
    bottom:9%;
    width:52%;
    display:flex;
    flex-direction:column;
    justify-content:center;
}

.ah-kicker{
    font-size:.77em;
    font-weight:850;
    letter-spacing:.13em;
    text-transform:uppercase;
    color:#e59cff;
    margin-bottom:.6em;
}

.ah-hero-title,
.ah-detail-title{
    font-size:3em;
    font-weight:900;
    line-height:1.03;
    letter-spacing:-.035em;
    text-shadow:
        0 3px 8px rgba(0,0,0,.95),
        0 12px 28px rgba(0,0,0,.74);
}

.ah-original-title{
    color:#bbb8cd;
    margin:.2em 0 .65em;
}

.ah-meta{
    display:flex;
    flex-wrap:wrap;
    align-items:center;
    gap:.45em;
    margin-bottom:.75em;
}

.ah-chip{
    padding:.3em .62em;
    border-radius:999px;
    font-size:.82em;
    background:rgba(255,255,255,.085);
    border:1px solid rgba(255,255,255,.13);
    white-space:nowrap;
}

.ah-chip.score{
    color:#ffd76a;
}

.ah-chip.hot{
    color:#ff9cda;
}

.ah-hero-desc,
.ah-detail-desc{
    font-size:.97em;
    line-height:1.55;
    color:#f0eef7;
    text-shadow:
        0 2px 5px rgba(0,0,0,.98),
        0 8px 24px rgba(0,0,0,.82);
    margin:.7em 0 1.1em;
}

.ah-actions{
    display:flex;
    gap:.65em;
}

.ah-action,
.ah-pagebtn,
.ah-all-episodes{
    padding:.72em 1.05em;
    border-radius:.6em;
    background:rgba(255,255,255,.11);
    border:1px solid rgba(255,255,255,.14);
    font-weight:750;
}

.ah-action.primary{
    background:
        linear-gradient(
            135deg,
            #9865ff,
            #6f46ff 58%,
            #d94ee8
        );
}

.ah-action.focus,
.ah-pagebtn.focus,
.ah-all-episodes.focus{
    transform:scale(1.04);
    background:#fff;
    color:#0a0b15;
    box-shadow:
        0 0 0 3px rgba(164,119,255,.35);
}

/* SHELVES */

.ah-shelf{
    margin:0 0 1.5em;
}

.ah-shelf-title,
.ah-block-title,
.ah-episodes-title{
    font-size:1.36em;
    font-weight:820;
    margin:0 0 .65em;
}

.ah-track,
.ah-screens,
.ah-episode-track{
    display:flex;
    gap:.82em;
    overflow-x:auto;
    overflow-y:hidden;
    padding:.35em .25em .8em;
}

.ah-wide-card{
    position:relative;
    flex:0 0 15.6em;
    height:7.25em;
    border-radius:.72em;
    overflow:hidden;
    background:#13162a;
    border:1px solid rgba(255,255,255,.08);
}

.ah-wide-card img{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    opacity:.88;
}

.ah-wide-shade{
    position:absolute;
    inset:0;
    background:
        linear-gradient(
            0deg,
            rgba(7,8,18,.98),
            rgba(7,8,18,.10) 82%
        );
}

.ah-wide-copy{
    position:absolute;
    left:.72em;
    right:.72em;
    bottom:.58em;
}

.ah-wide-title{
    font-weight:760;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
}

.ah-wide-meta{
    font-size:.72em;
    color:#d0ccdc;
    display:flex;
    gap:.55em;
}

.ah-wide-badge{
    position:absolute;
    left:.55em;
    top:.5em;
    padding:.26em .48em;
    border-radius:.42em;
    background:rgba(117,70,255,.86);
    font-size:.66em;
    font-weight:800;
}

.ah-wide-card.focus,
.ah-poster-card.focus,
.ah-episode-card.focus{
    transform:scale(1.055);
    border-color:#dcb7ff;
    box-shadow:
        0 0 0 3px rgba(143,94,255,.22),
        0 16px 38px rgba(0,0,0,.42);
    z-index:4;
}

/* CATALOG */

.ah-section-head{
    padding:.65em 0 1.05em;
}

.ah-page-title{
    font-size:2.15em;
    font-weight:900;
}

.ah-page-sub{
    color:#9796ad;
    margin-top:.25em;
}

.ah-grid{
    display:flex;
    flex-wrap:wrap;
    gap:1em;
}

.ah-poster-card{
    flex:0 0 10.65em;
    width:10.65em;
    padding:.32em;
    border-radius:.8em;
    box-sizing:border-box;
}

.ah-poster-media{
    position:relative;
    height:15.2em;
    border-radius:.65em;
    overflow:hidden;
    background:#14172a;
}

.ah-poster-media img,
.ah-detail-poster img,
.ah-screen img{
    width:100%;
    height:100%;
    object-fit:cover;
}

.ah-poster-score{
    position:absolute;
    right:.48em;
    bottom:.48em;
    padding:.28em .48em;
    border-radius:.4em;
    background:rgba(7,8,18,.88);
    color:#ffd76a;
}

.ah-poster-title{
    font-size:.88em;
    font-weight:720;
    height:2.35em;
    overflow:hidden;
    margin:.58em .08em .18em;
}

.ah-poster-meta{
    font-size:.7em;
    color:#8f8ea5;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
}

/* DETAIL */

.ah-detail-hero{
    position:relative;
    min-height:31.5em;
    border-radius:1.05em;
    overflow:hidden;
    margin-bottom:1.15em;
    isolation:isolate;
    background:#0b0e1d;
}

.ah-detail-bg{
    filter:
        brightness(.82)
        saturate(1.05);
}

.ah-detail-shade{
    position:absolute;
    inset:0;
    z-index:-3;
    background:
        linear-gradient(
            90deg,
            rgba(4,6,16,.995),
            rgba(4,6,16,.94) 34%,
            rgba(4,6,16,.75) 58%,
            rgba(4,6,16,.36) 82%,
            rgba(4,6,16,.20)
        ),
        linear-gradient(
            0deg,
            rgba(4,6,16,.94),
            rgba(4,6,16,.15) 67%
        );
}

.ah-detail-content{
    display:flex;
    gap:1.35em;
    padding:1.7em;
    align-items:center;
    min-height:30em;
    box-sizing:border-box;
}

.ah-detail-poster{
    width:13.3em;
    min-width:13.3em;
    height:19.6em;
    border-radius:.88em;
    overflow:hidden;
    background:#16182b;
    border:1px solid rgba(220,200,255,.28);
}

.ah-detail-copy{
    flex:1;
    min-width:0;
    padding:1.15em 1.2em;
    border-radius:.9em;
    background:
        linear-gradient(
            90deg,
            rgba(5,7,18,.80),
            rgba(5,7,18,.50) 72%,
            rgba(5,7,18,.22)
        );
    border:1px solid rgba(255,255,255,.08);
}

.ah-detail-aside{
    width:18em;
    min-width:18em;
    padding:1em;
    border-radius:.9em;
    background:rgba(12,16,34,.88);
    border:1px solid rgba(185,158,255,.24);
}

.ah-detail-aside-title{
    font-weight:850;
    font-size:1.05em;
    margin-bottom:.4em;
}

.ah-info-row{
    display:flex;
    justify-content:space-between;
    gap:.8em;
    padding:.67em 0;
    border-bottom:1px solid rgba(255,255,255,.085);
    font-size:.86em;
}

.ah-info-label{
    color:#aaa8bb;
}

.ah-info-value{
    font-weight:760;
    text-align:right;
}

.ah-studio{
    color:#d0cddd;
    font-size:.84em;
    margin:.25em 0 .55em;
}

/* EPISODES */

.ah-episodes-section{
    margin-bottom:1.45em;
}

.ah-episodes-head{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:1em;
    margin-bottom:.62em;
}

.ah-episodes-title-wrap{
    display:flex;
    align-items:center;
    gap:.7em;
}

.ah-episodes-count{
    padding:.28em .62em;
    border-radius:999px;
    font-size:.76em;
    color:#d7d3e5;
    background:rgba(255,255,255,.075);
}

.ah-all-episodes{
    font-size:.82em;
}

.ah-episode-card{
    position:relative;
    flex:0 0 10.8em;
    height:6.35em;
    border-radius:.72em;
    overflow:hidden;
    background:#13162a;
    border:1px solid rgba(255,255,255,.10);
}

.ah-episode-card img{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    opacity:.76;
}

.ah-episode-shade{
    position:absolute;
    inset:0;
    background:
        linear-gradient(
            0deg,
            rgba(6,8,18,.98),
            rgba(6,8,18,.20) 78%
        );
}

.ah-episode-number{
    position:absolute;
    left:.48em;
    top:.45em;
    padding:.28em .48em;
    border-radius:.45em;
    background:rgba(9,11,25,.86);
    font-weight:850;
}

.ah-episode-copy{
    position:absolute;
    left:.55em;
    right:.55em;
    bottom:.48em;
}

.ah-episode-name{
    font-size:.76em;
    font-weight:760;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
}

.ah-episode-meta{
    font-size:.66em;
    color:#c2bfd0;
}

.ah-episode-progress{
    position:absolute;
    left:0;
    right:0;
    bottom:0;
    height:.22em;
    background:rgba(255,255,255,.10);
}

.ah-episode-progress span{
    display:block;
    height:100%;
    background:
        linear-gradient(
            90deg,
            #8b5cf6,
            #f062c0
        );
}

.ah-episode-card.current{
    border-color:rgba(216,181,255,.88);
}

.ah-episodes-placeholder,
.ah-description-panel{
    padding:1em;
    border-radius:.8em;
    background:rgba(16,19,38,.75);
    border:1px solid rgba(255,255,255,.07);
    color:#c9c6d7;
}

.ah-episodes-placeholder{
    display:flex;
    gap:.8em;
    align-items:center;
    min-height:5em;
}

.ah-mini-spinner{
    width:1.5em;
    height:1.5em;
    border-radius:50%;
    border:2px solid rgba(185,145,255,.16);
    border-top-color:#c278ff;
    animation:ah-spin 1s linear infinite;
}

.ah-screen{
    flex:0 0 18em;
    height:10.2em;
    border-radius:.7em;
    overflow:hidden;
}

.ah-empty{
    padding:2em 0;
    color:#aaa8ba;
}

.ah-fallback{
    display:flex;
    align-items:center;
    justify-content:center;
    width:100%;
    height:100%;
    background:#14172a;
    color:#87859b;
    text-align:center;
}

.ah-loader{
    min-height:24em;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    gap:1em;
}

.ah-loader-torii{
    width:6em;
    height:6em;
}

.ah-loader-ring{
    position:absolute;
    width:7em;
    height:7em;
    border-radius:50%;
    border:3px solid rgba(173,114,255,.12);
    border-top-color:#dd6dff;
    animation:ah-spin 1.2s linear infinite;
}

@keyframes ah-spin{
    to{
        transform:rotate(360deg);
    }
}

@media(max-width:1250px){
    .ah-detail-aside{
        display:none;
    }
}

</style>
`);
}

/* ======================================================
 * IMAGE
 * ====================================================== */

function putImage(box,url,text){
    if(!url){
        box.append(
            '<div class="ah-fallback">'+
                esc(text||'AnimeHub')+
            '</div>'
        );

        return;
    }

    var img=
        $('<img alt="">')
        .attr({
            src:url,
            loading:'lazy',
            decoding:'async'
        });

    img.on(
        'error',
        function(){
            box
                .empty()
                .append(
                    '<div class="ah-fallback">'+
                        esc(text||'AnimeHub')+
                    '</div>'
                );
        }
    );

    box.append(img);
}

/* ======================================================
 * PLAYER
 * ====================================================== */

function playerCard(a){
    return {
        id:a.id||'',

        title:
            a.title||
            a.russian||
            a.name||
            'AnimeHub',

        name:
            a.title||
            a.russian||
            a.name||
            'AnimeHub',

        original_title:
            a.name||
            a.english||
            a.title||
            '',

        original_name:
            a.name||
            a.english||
            '',

        release_date:
            a.year
                ?String(a.year)+'-01-01'
                :'',

        first_air_date:
            a.year
                ?String(a.year)+'-01-01'
                :'',

        poster_path:
            a.poster||
            '',

        source:'animehub',

        animehub_id:
            String(a.id||'')
    };
}

function episodeLabel(e){
    return (
        clean(e&&e.name)||
        (
            'Серия '+
            intv(
                e&&e.number,
                1
            )
        )
    );
}

function buildPlaylist(a,w){
    var card=playerCard(a);

    return (
        w.episodes||
        []
    )
    .filter(
        function(e){
            return !!e.url;
        }
    )
    .map(
        function(e,i){
            var q=
                e.quality&&
                typeof e.quality==='object'
                    ?e.quality
                    :{};

            if(!q.HD){
                q.HD=e.url;
            }

            return {
                url:e.url,

                quality:q,

                title:
                    (
                        a.title||
                        a.russian||
                        a.name||
                        'AnimeHub'
                    )+
                    ' • '+
                    episodeLabel(e),

                season:1,

                episode:
                    intv(
                        e.number,
                        i+1
                    ),

                movie:card,
                card:card,

                source:'AnimeVost',

                animehub_id:
                    String(
                        a.id||
                        ''
                    ),

                animehub_episode:
                    intv(
                        e.number,
                        i+1
                    ),

                animehub_provider_id:
                    w.match&&
                    w.match.id
                        ?String(w.match.id)
                        :'',

                animehub_provider:
                    'AnimeVost'
            };
        }
    );
}

function startEpisode(a,w,index){
    var list=
        buildPlaylist(
            a,
            w
        );

    if(!list.length){
        notify(
            'AnimeHub: нет доступных потоков'
        );

        return;
    }

    index=
        Math.max(
            0,
            Math.min(
                list.length-1,
                intv(index,0)
            )
        );

    var first=list[index];

    var old=
        watchState(
            a.id
        );

    var same=
        intv(
            old.episode,
            0
        )===
        intv(
            first.animehub_episode,
            0
        );

    saveWatchState(
        a.id,

        {
            episode:
                first.animehub_episode,

            providerId:
                first.animehub_provider_id,

            position:
                same&&!old.completed
                    ?num(old.position,0)
                    :0,

            duration:
                same
                    ?num(old.duration,0)
                    :0,

            completed:
                same
                    ?!!old.completed
                    :false
        }
    );

    try{
        Lampa.Player.play(
            first
        );

        Lampa.Player.playlist(
            list
        );
    }
    catch(e){
        console.log(
            'AnimeHub player error',
            e
        );

        notify(
            'Не удалось запустить плеер Lampa'
        );
    }
}

function showSelect(title,items,onSelect){
    if(!items||!items.length){
        notify(
            'AnimeHub: список пуст'
        );

        return;
    }

    Lampa.Select.show({
        title:title,
        items:items,
        onSelect:onSelect,

        onBack:function(){
            Lampa.Controller.toggle(
                'content'
            );
        }
    });
}

function showEpisodePicker(a,w){
    var state=
        watchState(
            a.id
        );

    var eps=
        w.episodes||
        [];

    showSelect(
        (
            w.match&&
            w.match.title||
            a.title||
            'AnimeHub'
        )+
        ' • серии',

        eps.map(
            function(e,i){
                var n=
                    intv(
                        e.number,
                        i+1
                    );

                var s='';

                if(
                    intv(
                        state.episode,
                        0
                    )===n
                ){
                    s=
                        state.completed
                            ?' • просмотрено'
                            :num(
                                state.position,
                                0
                            )>20
                                ?' • продолжить'
                                :' • последняя';
                }

                return {
                    title:
                        episodeLabel(e)+
                        s,

                    episodeIndex:i
                };
            }
        ),

        function(x){
            startEpisode(
                a,
                w,
                x.episodeIndex
            );
        }
    );
}

function watchUrl(a,pid){
    return workerUrl(
        'watch',

        {
            id:a.id||'',
            russian:a.russian||a.title||'',
            name:a.name||'',
            english:a.english||'',
            title:a.title||'',
            year:a.year||'',
            animevost_id:pid||''
        }
    );
}

function loadWatch(a,pid,ok,fail,opt){
    opt=opt||{};

    var n=
        new Lampa.Reguest();

    var show=
        opt.loading!==false;

    n.timeout(
        25000
    );

    if(show){
        try{
            Lampa.Loading.start();
        }
        catch(e){}
    }

    requestCached(
        n,

        'watch:'+
        String(a.id)+
        ':'+
        String(pid||'auto'),

        300000,

        watchUrl(
            a,
            pid
        ),

        function(d){
            if(show){
                try{
                    Lampa.Loading.stop();
                }
                catch(e){}
            }

            try{
                n.clear();
            }
            catch(e){}

            ok(d||{});
        },

        function(e){
            if(show){
                try{
                    Lampa.Loading.stop();
                }
                catch(x){}
            }

            try{
                n.clear();
            }
            catch(x){}

            if(
                opt.notify!==false
            ){
                notify(
                    'Не удалось загрузить серии'+
                    (
                        e&&e.status
                            ?' • '+e.status
                            :''
                    )
                );
            }

            if(fail){
                fail(e||{});
            }
        }
    );
}

function providerChoice(a,d,done){
    var src=
        d.alternatives||
        [];

    if(!src.length){
        notify(
            'AnimeVost: подходящий тайтл не найден'
        );

        return;
    }

    showSelect(
        'Выберите совпадение AnimeVost',

        src
            .slice(0,8)
            .map(
                function(x){
                    return {
                        title:
                            x.title+
                            (
                                x.year
                                    ?' • '+x.year
                                    :''
                            ),

                        providerId:
                            x.id
                    };
                }
            ),

        function(x){
            loadWatch(
                a,
                x.providerId,

                function(r){
                    if(
                        r.found&&
                        r.episodes&&
                        r.episodes.length
                    ){
                        saveWatchState(
                            a.id,

                            {
                                providerId:
                                    x.providerId
                            }
                        );

                        if(done){
                            done(r);
                        }
                        else{
                            showEpisodePicker(
                                a,
                                r
                            );
                        }
                    }
                    else{
                        notify(
                            'Для выбранного тайтла серии не найдены'
                        );
                    }
                }
            );
        }
    );
}

function openWatch(a){
    var s=
        watchState(
            a.id
        );

    loadWatch(
        a,
        s.providerId||'',

        function(d){
            if(
                d.found&&
                d.episodes&&
                d.episodes.length
            ){
                showEpisodePicker(
                    a,
                    d
                );
            }
            else{
                providerChoice(
                    a,
                    d
                );
            }
        }
    );
}

function installPlaybackTracker(){
    var key=
        NS+
        '_tracker';

    if(
        window[key]||
        !Lampa.Player||
        !Lampa.Player.listener||
        !Lampa.PlayerVideo||
        !Lampa.PlayerVideo.listener
    ){
        return;
    }

    window[key]=true;

    Lampa.Player.listener.follow(
        'start',

        function(d){
            if(
                !d||
                !d.animehub_id
            ){
                return;
            }

            var active=true;

            var id=
                String(
                    d.animehub_id
                );

            var ep=
                intv(
                    d.animehub_episode,
                    0
                );

            var last=0;

            function can(){
                try{
                    Lampa.PlayerVideo.listener.remove(
                        'canplay',
                        can
                    );
                }
                catch(e){}

                var s=
                    watchState(id);

                if(
                    !active||
                    intv(s.episode,0)!==ep||
                    s.completed||
                    num(s.position,0)<20
                ){
                    return;
                }

                try{
                    var v=
                        Lampa.PlayerVideo.video();

                    var p=
                        num(
                            s.position,
                            0
                        );

                    if(
                        v&&
                        p>20&&
                        (
                            !v.duration||
                            p<v.duration-45
                        )
                    ){
                        v.currentTime=p;
                    }
                }
                catch(e){}
            }

            function time(e){
                if(
                    !active||
                    Date.now()-last<10000
                ){
                    return;
                }

                last=Date.now();

                var c=
                    num(
                        e&&e.current,
                        0
                    );

                var du=
                    num(
                        e&&e.duration,
                        0
                    );

                if(c>0){
                    saveWatchState(
                        id,

                        {
                            episode:ep,

                            providerId:
                                d.animehub_provider_id||
                                '',

                            position:c,
                            duration:du,

                            completed:
                                du>0&&
                                c>=du-30
                        }
                    );
                }
            }

            function ended(){
                if(active){
                    saveWatchState(
                        id,

                        {
                            episode:ep,

                            providerId:
                                d.animehub_provider_id||
                                '',

                            position:0,

                            completed:true
                        }
                    );
                }
            }

            function destroy(){
                active=false;

                try{
                    Lampa.PlayerVideo.listener.remove(
                        'canplay',
                        can
                    );

                    Lampa.PlayerVideo.listener.remove(
                        'timeupdate',
                        time
                    );

                    Lampa.PlayerVideo.listener.remove(
                        'ended',
                        ended
                    );

                    Lampa.Player.listener.remove(
                        'destroy',
                        destroy
                    );
                }
                catch(e){}
            }

            Lampa.PlayerVideo.listener.follow(
                'canplay',
                can
            );

            Lampa.PlayerVideo.listener.follow(
                'timeupdate',
                time
            );

            Lampa.PlayerVideo.listener.follow(
                'ended',
                ended
            );

            Lampa.Player.listener.follow(
                'destroy',
                destroy
            );
        }
    );
}

/* ======================================================
 * NAVIGATION
 * ====================================================== */

function visible(root){
    return root
        .find('.selector')
        .toArray()
        .filter(
            function(x){
                return (
                    x&&
                    x.offsetParent!==null
                );
            }
        );
}

function ensureVisible(view,el){
    if(
        !view||
        !view[0]||
        !el
    ){
        return;
    }

    var c=view[0];

    var er=
        el.getBoundingClientRect();

    var vr=
        c.getBoundingClientRect();

    if(
        er.bottom>
        vr.bottom-35
    ){
        c.scrollTop+=
            er.bottom-
            (
                vr.bottom-35
            );
    }
    else if(
        er.top<
        vr.top+18
    ){
        c.scrollTop-=
            vr.top+
            18-
            er.top;
    }

    var p=
        el.parentElement;

    while(
        p&&
        p!==c
    ){
        var st=
            window.getComputedStyle
                ?window.getComputedStyle(p)
                :null;

        if(
            st&&
            (
                st.overflowX==='auto'||
                st.overflowX==='scroll'
            )
        ){
            var pr=
                p.getBoundingClientRect();

            if(
                er.right>
                pr.right-20
            ){
                p.scrollLeft+=
                    er.right-
                    (
                        pr.right-20
                    );
            }
            else if(
                er.left<
                pr.left+20
            ){
                p.scrollLeft-=
                    pr.left+
                    20-
                    er.left;
            }

            break;
        }

        p=p.parentElement;
    }
}

function makeNav(
    root,
    view,
    leftEdge,
    upEdge
){
    var last=null;

    function focus(x){
        if(!x) return;

        last=x;

        try{
            Lampa.Controller.collectionFocus(
                x,
                view
            );
        }
        catch(e){
            try{
                Lampa.Controller.focus(x);
            }
            catch(z){}
        }

        ensureVisible(
            view,
            x
        );
    }

    function move(dir){
        var a=
            visible(root);

        var cur=
            last||
            root.find('.selector.focus')[0]||
            a[0];

        if(!cur) return;

        var cr=
            cur.getBoundingClientRect();

        var cx=
            cr.left+
            cr.width/2;

        var cy=
            cr.top+
            cr.height/2;

        var best=null;
        var score=1e9;

        a.forEach(
            function(x){
                if(x===cur) return;

                var r=
                    x.getBoundingClientRect();

                var xv=
                    r.left+
                    r.width/2;

                var yv=
                    r.top+
                    r.height/2;

                var dx=xv-cx;
                var dy=yv-cy;

                if(
                    dir==='left'&&
                    dx>=-5
                ) return;

                if(
                    dir==='right'&&
                    dx<=5
                ) return;

                if(
                    dir==='up'&&
                    dy>=-5
                ) return;

                if(
                    dir==='down'&&
                    dy<=5
                ) return;

                var main=
                    (
                        dir==='left'||
                        dir==='right'
                    )
                        ?Math.abs(dx)
                        :Math.abs(dy);

                var cross=
                    (
                        dir==='left'||
                        dir==='right'
                    )
                        ?Math.abs(dy)
                        :Math.abs(dx);

                var s=
                    main+
                    cross*2.3;

                if(s<score){
                    score=s;
                    best=x;
                }
            }
        );

        if(best){
            focus(best);
        }
        else if(
            dir==='left'&&
            leftEdge
        ){
            leftEdge();
        }
        else if(
            dir==='up'&&
            upEdge
        ){
            upEdge();
        }
    }

    function bind(){
        root
            .find('.selector')
            .off(
                'hover:focus.'+
                NS
            )
            .on(
                'hover:focus.'+
                NS,

                function(){
                    last=this;

                    ensureVisible(
                        view,
                        this
                    );
                }
            );
    }

    return {
        focus:focus,
        move:move,
        bind:bind,

        last:function(){
            return last;
        }
    };
}

function installController(
    view,
    root,
    nav,
    back
){
    Lampa.Controller.add(
        'content',

        {
            toggle:function(){
                Lampa.Controller.collectionSet(
                    view
                );

                Lampa.Controller.collectionFocus(
                    nav.last()||
                    false,
                    view
                );
            },

            left:function(){
                nav.move('left');
            },

            right:function(){
                nav.move('right');
            },

            up:function(){
                nav.move('up');
            },

            down:function(){
                nav.move('down');
            },

            enter:function(){
                var x=
                    root.find(
                        '.selector.focus'
                    )[0]||
                    nav.last();

                if(x){
                    $(x).trigger(
                        'hover:enter'
                    );
                }
            },

            back:function(){
                back
                    ?back()
                    :Lampa.Activity.backward();
            }
        }
    );

    Lampa.Controller.toggle(
        'content'
    );
}

/* ======================================================
 * NAV ACTIONS
 * ====================================================== */

function openHome(){
    Lampa.Activity.push({
        url:'',
        title:'AnimeHub',
        component:HOME,
        page:1
    });
}

function openCatalog(
    mode,
    value,
    title,
    page
){
    Lampa.Activity.push({
        url:'',
        title:title||'AnimeHub',
        component:CATALOG,
        ah_mode:mode||'popular',
        ah_value:value||'',
        ah_title:title||'AnimeHub',
        ah_page:page||1,
        page:1
    });
}

function openDetail(a){
    if(
        a&&
        a.id
    ){
        Lampa.Activity.push({
            url:'',
            title:a.title||'AnimeHub',
            component:DETAIL,
            ah_item:compactItem(a),
            page:1
        });
    }
}

function openSearch(){
    if(
        !Lampa.Input||
        !Lampa.Input.edit
    ){
        notify(
            'Поиск недоступен'
        );

        return;
    }

    Lampa.Input.edit(
        {
            title:'Поиск AnimeHub',
            value:'',
            free:true,
            nosave:true
        },

        function(r){
            try{
                Lampa.Controller.toggle(
                    'content'
                );
            }
            catch(e){}

            var q=
                clean(
                    r&&typeof r==='object'
                        ?r.value
                        :r
                );

            if(q){
                openCatalog(
                    'search',
                    q,
                    'Поиск: '+q,
                    1
                );
            }
        }
    );
}

function loadGenres(cb){
    if(genresCache){
        cb(genresCache);
        return;
    }

    var n=
        new Lampa.Reguest();

    requestCached(
        n,
        'genres',
        86400000,
        workerUrl('genres'),

        function(d){
            genresCache=d;
            cb(d);
        },

        function(){
            notify(
                'Не удалось загрузить жанры'
            );
        }
    );
}

function showGenres(){
    loadGenres(
        function(d){
            showSelect(
                'Жанры',

                (
                    d.genres||
                    []
                ).map(
                    function(x){
                        return {
                            title:
                                x.russian||
                                x.name,

                            id:x.id
                        };
                    }
                ),

                function(x){
                    openCatalog(
                        'genre',
                        x.id,
                        x.title,
                        1
                    );
                }
            );
        }
    );
}

function showKinds(){
    var a=[
        ['TV-сериалы','tv'],
        ['Фильмы','movie'],
        ['OVA','ova'],
        ['ONA','ona'],
        ['Спецвыпуски','special'],
        ['TV-спецвыпуски','tv_special'],
        ['Музыкальные клипы','music']
    ];

    showSelect(
        'Категории',

        a.map(
            function(x){
                return {
                    title:x[0],
                    value:x[1]
                };
            }
        ),

        function(x){
            openCatalog(
                'kind',
                x.value,
                x.title,
                1
            );
        }
    );
}

function showYears(){
    var a=[];
    var y=
        new Date()
            .getFullYear()+
        1;

    for(
        ;
        y>=
        new Date()
            .getFullYear()-
        30;
        y--
    ){
        a.push({
            title:String(y),
            value:String(y)
        });
    }

    [
        ['2010-е','201x'],
        ['2000-е','200x'],
        ['1990-е','199x'],
        ['1980-е','198x']
    ]
    .forEach(
        function(x){
            a.push({
                title:x[0],
                value:x[1]
            });
        }
    );

    showSelect(
        'Год',
        a,

        function(x){
            openCatalog(
                'year',
                x.value,
                x.title,
                1
            );
        }
    );
}

function topbar(homeFn){
    var t=
        $('<div class="ah-topbar"></div>');

    var brand=
        $(
            '<div class="ah-brand">'+
                toriiSvg(
                    'ah-brand-logo'
                )+
                '<b>AnimeHub</b>'+
            '</div>'
        );

    var nav=
        $('<div class="ah-nav"></div>');

    function add(t,f){
        $(
            '<div class="ah-navbtn selector"></div>'
        )
        .text(t)
        .on(
            'hover:enter',
            f
        )
        .appendTo(nav);
    }

    add(
        'Главная',
        homeFn||
        openHome
    );

    add(
        'Поиск',
        openSearch
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

        function(){
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

        function(){
            openCatalog(
                'anons',
                '',
                'Анонсы',
                1
            );
        }
    );

    return t.append(
        brand,
        nav
    );
}

/* ======================================================
 * CARDS
 * ====================================================== */

function wideCard(a){
    var c=
        $('<div class="ah-wide-card selector"></div>');

    if(a.poster){
        $('<img alt="">')
            .attr({
                src:a.poster,
                loading:'lazy'
            })
            .appendTo(c);
    }

    c.append(
        '<div class="ah-wide-shade"></div>'
    );

    if(
        a.status===
        'ongoing'
    ){
        c.append(
            '<div class="ah-wide-badge">ОНГОИНГ</div>'
        );
    }

    if(
        a.status===
        'anons'
    ){
        c.append(
            '<div class="ah-wide-badge">АНОНС</div>'
        );
    }

    var m=[];

    if(a.year) m.push(a.year);

    m.push(
        kindLabel(
            a.kind
        )
    );

    if(
        num(
            a.score,
            0
        )>0
    ){
        m.push(
            '★ '+
            formatScore(
                a.score
            )
        );
    }

    if(
        episodeText(a)
    ){
        m.push(
            episodeText(a)
        );
    }

    c.append(
        '<div class="ah-wide-copy">'+
            '<div class="ah-wide-title">'+
                esc(
                    a.title||
                    'Anime'
                )+
            '</div>'+
            '<div class="ah-wide-meta">'+
                m.map(
                    function(x){
                        return (
                            '<span>'+
                                esc(x)+
                            '</span>'
                        );
                    }
                )
                .join('')+
            '</div>'+
        '</div>'
    );

    c.on(
        'hover:enter',

        function(){
            openDetail(a);
        }
    );

    return c;
}

function posterCard(a){
    var c=
        $('<div class="ah-poster-card selector"></div>');

    var m=
        $('<div class="ah-poster-media"></div>');

    putImage(
        m,
        a.poster,
        a.title
    );

    if(
        num(
            a.score,
            0
        )>0
    ){
        m.append(
            '<div class="ah-poster-score">'+
                '★ '+
                esc(
                    formatScore(
                        a.score
                    )
                )+
            '</div>'
        );
    }

    c.append(
        m,

        '<div class="ah-poster-title">'+
            esc(
                a.title||
                'Anime'
            )+
        '</div>'+
        '<div class="ah-poster-meta">'+
            esc(
                [
                    a.year||'',
                    kindLabel(
                        a.kind
                    ),
                    episodeText(a)
                ]
                .filter(Boolean)
                .join(' • ')
            )+
        '</div>'
    );

    c.on(
        'hover:enter',

        function(){
            openDetail(a);
        }
    );

    return c;
}

function shelf(root,title,items){
    if(
        !items||
        !items.length
    ){
        return;
    }

    var s=
        $(
            '<div class="ah-shelf">'+
                '<div class="ah-shelf-title">'+
                    esc(title)+
                '</div>'+
            '</div>'
        );

    var tr=
        $('<div class="ah-track"></div>');

    items
        .slice(0,18)
        .forEach(
            function(a){
                tr.append(
                    wideCard(a)
                );
            }
        );

    root.append(
        s.append(tr)
    );
}

/* ======================================================
 * HOME COMPONENT
 * ====================================================== */

function HomeComponent(){
    var net=
        new Lampa.Reguest();

    var alive=false;

    var view=
        $('<div class="ah-view"></div>');

    var root=
        $('<div class="ah-page"></div>');

    var nav;

    function render(d){
        if(!alive) return;

        root
            .empty()
            .append(
                topbar(
                    function(){}
                )
            );

        var a=d.featured;

        if(a){
            var h=
                $('<div class="ah-hero"></div>');

            var bg=
                a.background||
                a.poster||
                '';

            if(bg){
                $('<img class="ah-hero-bg" alt="">')
                    .attr(
                        'src',
                        bg
                    )
                    .addClass(
                        a.background
                            ?''
                            :'poster-bg'
                    )
                    .appendTo(h);
            }

            h.append(
                '<div class="ah-hero-shade"></div>'
            );

            var c=
                $('<div class="ah-hero-content"></div>');

            c.append(
                '<div class="ah-kicker">'+
                    'Сейчас в центре внимания'+
                '</div>'+
                '<div class="ah-hero-title">'+
                    esc(
                        a.title||
                        'AnimeHub'
                    )+
                '</div>'
            );

            if(
                a.name&&
                a.name!==a.title
            ){
                c.append(
                    '<div class="ah-original-title">'+
                        esc(a.name)+
                    '</div>'
                );
            }

            var meta=
                $('<div class="ah-meta"></div>');

            if(
                num(
                    a.score,
                    0
                )>0
            ){
                meta.append(
                    '<span class="ah-chip score">'+
                        '★ '+
                        esc(
                            formatScore(
                                a.score
                            )
                        )+
                    '</span>'
                );
            }

            if(a.year){
                meta.append(
                    '<span class="ah-chip">'+
                        esc(a.year)+
                    '</span>'
                );
            }

            meta.append(
                '<span class="ah-chip">'+
                    esc(
                        kindLabel(
                            a.kind
                        )
                    )+
                '</span>'
            );

            if(a.status){
                meta.append(
                    '<span class="ah-chip hot">'+
                        esc(
                            statusLabel(
                                a.status
                            )
                        )+
                    '</span>'
                );
            }

            c.append(
                meta,

                '<div class="ah-hero-desc">'+
                    esc(
                        clip(
                            cleanDescription(
                                a.description
                            ),
                            300
                        )
                    )+
                '</div>'
            );

            var acts=
                $('<div class="ah-actions"></div>');

            var more=
                $('<div class="ah-action primary selector">Подробнее</div>');

            var fav=
                $('<div class="ah-action selector"></div>');

            function rf(){
                fav.text(
                    isFavorite(
                        a.id
                    )
                        ?'★ В избранном'
                        :'☆ В избранное'
                );
            }

            rf();

            more.on(
                'hover:enter',

                function(){
                    openDetail(a);
                }
            );

            fav.on(
                'hover:enter',

                function(){
                    notify(
                        toggleFavorite(a)
                            ?'Добавлено в избранное'
                            :'Удалено из избранного'
                    );

                    rf();
                }
            );

            c.append(
                acts.append(
                    more,
                    fav
                )
            );

            h.append(c);

            root.append(h);
        }

        shelf(
            root,
            'Избранное',
            storedList(
                FAVORITES_KEY
            )
        );

        shelf(
            root,
            'Недавно открывали',
            storedList(
                RECENT_KEY
            )
        );

        shelf(
            root,
            'Сейчас выходит',
            d.ongoing||
            []
        );

        shelf(
            root,

            d.meta&&
            d.meta.seasonLabel||
            'Текущий сезон',

            d.season||
            []
        );

        shelf(
            root,
            'Недавно вышло',
            d.latest||
            []
        );

        shelf(
            root,
            'Высокий рейтинг',
            d.top||
            []
        );

        nav.bind();

        setTimeout(
            function(){
                var x=
                    root.find(
                        '.ah-action.selector'
                    )[0]||
                    root.find(
                        '.selector'
                    )[0];

                if(x){
                    nav.focus(x);
                }
            },
            60
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

        root.append(
            topbar(
                function(){}
            ),

            loaderHtml(
                'Загрузка AnimeHub…'
            )
        );

        nav=
            makeNav(
                root,
                view,

                function(){
                    Lampa.Controller.toggle(
                        'menu'
                    );
                },

                function(){
                    Lampa.Controller.toggle(
                        'head'
                    );
                }
            );

        net.timeout(
            20000
        );

        requestCached(
            net,
            'home',
            180000,
            workerUrl('home'),
            render,

            function(){
                root.html(
                    '<div class="ah-empty">'+
                        'Не удалось загрузить AnimeHub'+
                    '</div>'
                );
            }
        );

        return view;
    };

    this.start=function(){
        if(
            Lampa.Activity.active().activity===
            this.activity
        ){
            installController(
                view,
                root,
                nav,

                function(){
                    Lampa.Activity.backward();
                }
            );
        }
    };

    this.pause=function(){};
    this.stop=function(){};

    this.render=function(){
        return view;
    };

    this.destroy=function(){
        alive=false;

        net.clear();

        view.remove();
    };
}

/* ======================================================
 * CATALOG COMPONENT
 * ====================================================== */

function CatalogComponent(o){
    var net=
        new Lampa.Reguest();

    var alive=false;

    var view=
        $('<div class="ah-view"></div>');

    var root=
        $('<div class="ah-page"></div>');

    var nav;

    var mode=
        o.ah_mode||
        'popular';

    var value=
        o.ah_value||
        '';

    var title=
        o.ah_title||
        'AnimeHub';

    var page=
        intv(
            o.ah_page,
            1
        );

    function render(d){
        if(!alive) return;

        root
            .empty()
            .append(
                topbar()
            );

        root.append(
            '<div class="ah-section-head">'+
                '<div class="ah-page-title">'+
                    esc(title)+
                '</div>'+
                '<div class="ah-page-sub">'+
                    'Страница '+
                    page+
                    ' • '+
                    (
                        d.items||
                        []
                    ).length+
                    ' тайтлов'+
                '</div>'+
            '</div>'
        );

        var g=
            $('<div class="ah-grid"></div>');

        (
            d.items||
            []
        )
        .forEach(
            function(a){
                g.append(
                    posterCard(a)
                );
            }
        );

        root.append(g);

        var p=
            $('<div class="ah-pages"></div>');

        if(page>1){
            $(
                '<div class="ah-pagebtn selector">'+
                    '← Страница '+
                    (page-1)+
                '</div>'
            )
            .on(
                'hover:enter',

                function(){
                    openCatalog(
                        mode,
                        value,
                        title,
                        page-1
                    );
                }
            )
            .appendTo(p);
        }

        if(d.hasNext){
            $(
                '<div class="ah-pagebtn selector">'+
                    'Страница '+
                    (page+1)+
                    ' →'+
                '</div>'
            )
            .on(
                'hover:enter',

                function(){
                    openCatalog(
                        mode,
                        value,
                        title,
                        page+1
                    );
                }
            )
            .appendTo(p);
        }

        root.append(p);

        nav.bind();

        setTimeout(
            function(){
                var x=
                    root.find(
                        '.ah-poster-card'
                    )[0]||
                    root.find(
                        '.selector'
                    )[0];

                if(x){
                    nav.focus(x);
                }
            },
            50
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

        root.append(
            topbar(),

            loaderHtml(
                'Загрузка каталога…'
            )
        );

        nav=
            makeNav(
                root,
                view,

                function(){
                    Lampa.Controller.toggle(
                        'menu'
                    );
                },

                function(){
                    Lampa.Controller.toggle(
                        'head'
                    );
                }
            );

        requestCached(
            net,

            'catalog:'+
            mode+
            ':'+
            value+
            ':'+
            page,

            120000,

            workerUrl(
                'catalog',

                {
                    mode:mode,
                    value:value,
                    page:page,
                    limit:24
                }
            ),

            render,

            function(){
                root.html(
                    '<div class="ah-empty">'+
                        'Не удалось загрузить каталог'+
                    '</div>'
                );
            }
        );

        return view;
    };

    this.start=function(){
        if(
            Lampa.Activity.active().activity===
            this.activity
        ){
            installController(
                view,
                root,
                nav,

                function(){
                    Lampa.Activity.backward();
                }
            );
        }
    };

    this.pause=function(){};
    this.stop=function(){};

    this.render=function(){
        return view;
    };

    this.destroy=function(){
        alive=false;

        net.clear();

        view.remove();
    };
}

/* ======================================================
 * DETAIL COMPONENT
 * ====================================================== */

function DetailComponent(o){
    var net=
        new Lampa.Reguest();

    var alive=false;

    var view=
        $('<div class="ah-view"></div>');

    var root=
        $('<div class="ah-page"></div>');

    var nav;

    var initial=
        o.ah_item||
        {};

    var anime=null;
    var watchData=null;
    var epBox=null;
    var watchBtn=null;

    function epStatus(a){
        var t=
            intv(
                a.episodes,
                0
            );

        var r=
            intv(
                a.episodesAired,
                0
            );

        return (
            t&&r&&r<t
                ?r+' из '+t
                :String(
                    t||
                    r||
                    '—'
                )
        );
    }

    function infoPanel(a){
        var p=
            $(
                '<div class="ah-detail-aside">'+
                    '<div class="ah-detail-aside-title">'+
                        'Информация'+
                    '</div>'+
                '</div>'
            );

        function row(k,v){
            if(
                v!==''&&
                v!==null&&
                v!==undefined
            ){
                p.append(
                    '<div class="ah-info-row">'+
                        '<span class="ah-info-label">'+
                            esc(k)+
                        '</span>'+
                        '<span class="ah-info-value">'+
                            esc(v)+
                        '</span>'+
                    '</div>'
                );
            }
        }

        row(
            'Рейтинг',

            num(
                a.score,
                0
            )>0
                ?'★ '+
                    formatScore(
                        a.score
                    )
                :'—'
        );

        if(
            intv(
                a.usersCount,
                0
            )>0
        ){
            row(
                'Пользователей',
                intv(
                    a.usersCount,
                    0
                )
            );
        }

        row(
            'Сезон',

            a.season
                ?seasonLabel(
                    a.season
                )
                :(
                    a.year||
                    ''
                )
        );

        row(
            'Серии',
            epStatus(a)
        );

        if(
            a.nextEpisodeAt&&
            a.status===
            'ongoing'
        ){
            row(
                'Следующая серия',
                formatDate(
                    a.nextEpisodeAt
                )
            );
        }
        else if(a.duration){
            row(
                'Длительность',
                a.duration+
                ' мин.'
            );
        }

        return p;
    }

    function refreshWatch(){
        if(
            !watchBtn||
            !anime
        ){
            return;
        }

        var s=
            watchState(
                anime.id
            );

        var e=
            intv(
                s.episode,
                0
            );

        watchBtn.text(
            e&&!s.completed
                ?'▶ Продолжить • серия '+e
                :e&&s.completed
                    ?'▶ Смотреть дальше'
                    :'▶ Смотреть'
        );
    }

    function findIndex(eps,n){
        for(
            var i=0;
            i<eps.length;
            i++
        ){
            if(
                intv(
                    eps[i].number,
                    i+1
                )===
                intv(
                    n,
                    0
                )
            ){
                return i;
            }
        }

        return -1;
    }

    function continueIndex(){
        var eps=
            watchData&&
            watchData.episodes||
            [];

        var s=
            watchState(
                anime.id
            );

        var i=
            findIndex(
                eps,
                s.episode
            );

        if(i<0){
            return 0;
        }

        return (
            s.completed&&
            i<eps.length-1
                ?i+1
                :i
        );
    }

    function thumb(a,e,i){
        if(e.preview){
            return e.preview;
        }

        var s=
            a.screenshots||
            [];

        if(s.length){
            var x=
                s[
                    i%
                    s.length
                ];

            return (
                x.x332Url||
                x.originalUrl||
                x.x166Url||
                ''
            );
        }

        return (
            a.poster||
            ''
        );
    }

    function progress(s,n){
        if(
            intv(
                s.episode,
                0
            )!==n
        ){
            return 0;
        }

        if(s.completed){
            return 100;
        }

        return (
            s.duration&&
            s.position
                ?Math.max(
                    0,
                    Math.min(
                        100,
                        Math.round(
                            s.position/
                            s.duration*
                            100
                        )
                    )
                )
                :0
        );
    }

    function epCard(
        a,
        w,
        e,
        i,
        s
    ){
        var n=
            intv(
                e.number,
                i+1
            );

        var c=
            $('<div class="ah-episode-card selector"></div>');

        if(
            intv(
                s.episode,
                0
            )===n
        ){
            c.addClass(
                'current'
            );
        }

        var im=
            thumb(
                a,
                e,
                i
            );

        if(im){
            $('<img alt="">')
                .attr({
                    src:im,
                    loading:'lazy'
                })
                .appendTo(c);
        }

        c.append(
            '<div class="ah-episode-shade"></div>'+
            '<div class="ah-episode-number">'+
                n+
            '</div>'+
            '<div class="ah-episode-copy">'+
                '<div class="ah-episode-name">'+
                    esc(
                        episodeLabel(e)
                    )+
                '</div>'+
                '<div class="ah-episode-meta">'+
                    esc(
                        a.duration
                            ?a.duration+' мин'
                            :'AnimeVost'
                    )+
                '</div>'+
            '</div>'
        );

        var pr=
            progress(
                s,
                n
            );

        if(pr){
            c.append(
                '<div class="ah-episode-progress">'+
                    '<span style="width:'+
                        pr+
                        '%">'+
                    '</span>'+
                '</div>'
            );
        }

        c.on(
            'hover:enter',

            function(){
                startEpisode(
                    a,
                    w,
                    i
                );
            }
        );

        return c;
    }

    function epHead(label){
        return $(
            '<div class="ah-episodes-head">'+
                '<div class="ah-episodes-title-wrap">'+
                    '<div class="ah-episodes-title">'+
                        'Эпизоды'+
                    '</div>'+
                    '<div class="ah-episodes-count">'+
                        esc(label)+
                    '</div>'+
                '</div>'+
            '</div>'
        );
    }

    function epLoading(){
        epBox
            .empty()
            .append(
                epHead(
                    epStatus(anime)
                ),

                '<div class="ah-episodes-placeholder">'+
                    '<div class="ah-mini-spinner"></div>'+
                    '<span>'+
                        'Загружаем серии AnimeVost…'+
                    '</span>'+
                '</div>'
            );
    }

    function renderEpisodes(w){
        watchData=w;

        var eps=
            w.episodes||
            [];

        if(!eps.length){
            epBox.html(
                '<div class="ah-episodes-placeholder">'+
                    'Серии пока недоступны.'+
                '</div>'
            );

            return;
        }

        var s=
            watchState(
                anime.id
            );

        var cur=
            findIndex(
                eps,
                s.episode
            );

        var start=0;
        var max=18;

        if(
            eps.length>max&&
            cur>=0
        ){
            start=
                Math.max(
                    0,
                    Math.min(
                        eps.length-max,
                        cur-6
                    )
                );
        }

        var end=
            Math.min(
                eps.length,
                start+max
            );

        var h=
            epHead(
                eps.length>max
                    ?(
                        start+1
                    )+
                    '–'+
                    end+
                    ' из '+
                    eps.length
                    :String(
                        eps.length
                    )
            );

        var all=
            $('<div class="ah-all-episodes selector">Все серии ›</div>');

        all.on(
            'hover:enter',

            function(){
                showEpisodePicker(
                    anime,
                    w
                );
            }
        );

        var tr=
            $('<div class="ah-episode-track"></div>');

        h.append(all);

        for(
            var i=start;
            i<end;
            i++
        ){
            tr.append(
                epCard(
                    anime,
                    w,
                    eps[i],
                    i,
                    s
                )
            );
        }

        epBox
            .empty()
            .append(
                h,
                tr
            );

        nav.bind();

        refreshWatch();
    }

    function loadInline(){
        epLoading();

        var s=
            watchState(
                anime.id
            );

        loadWatch(
            anime,
            s.providerId||'',

            function(w){
                if(!alive){
                    return;
                }

                if(
                    w.found&&
                    w.episodes&&
                    w.episodes.length
                ){
                    if(
                        w.match&&
                        w.match.id
                    ){
                        saveWatchState(
                            anime.id,

                            {
                                providerId:
                                    String(
                                        w.match.id
                                    )
                            }
                        );
                    }

                    renderEpisodes(w);
                }
                else if(
                    w.alternatives&&
                    w.alternatives.length
                ){
                    var h=
                        epHead(
                            'нужно уточнить источник'
                        );

                    var b=
                        $(
                            '<div class="ah-episodes-placeholder">'+
                                'AnimeVost нашёл несколько похожих тайтлов.'+
                            '</div>'
                        );

                    var btn=
                        $('<div class="ah-pagebtn selector">Выбрать совпадение</div>');

                    btn.on(
                        'hover:enter',

                        function(){
                            providerChoice(
                                anime,
                                w,
                                renderEpisodes
                            );
                        }
                    );

                    b.append(btn);

                    epBox
                        .empty()
                        .append(
                            h,
                            b
                        );

                    nav.bind();
                }
                else{
                    epBox.html(
                        '<div class="ah-episodes-placeholder">'+
                            'AnimeVost не нашёл подходящий источник.'+
                        '</div>'
                    );
                }
            },

            function(){
                epBox.html(
                    '<div class="ah-episodes-placeholder">'+
                        'Не удалось загрузить серии.'+
                    '</div>'
                );
            },

            {
                loading:false,
                notify:false
            }
        );
    }

    function playContinue(){
        if(
            watchData&&
            watchData.found&&
            watchData.episodes&&
            watchData.episodes.length
        ){
            startEpisode(
                anime,
                watchData,
                continueIndex()
            );
        }
        else{
            openWatch(anime);
        }
    }

    function render(a){
        if(!alive) return;

        anime=a;
        watchData=null;

        saveRecent(a);

        root
            .empty()
            .append(
                topbar()
            );

        var hero=
            $('<div class="ah-detail-hero"></div>');

        var bg=
            a.background||
            a.poster||
            '';

        if(bg){
            $('<img class="ah-detail-bg" alt="">')
                .attr(
                    'src',
                    bg
                )
                .addClass(
                    a.background
                        ?''
                        :'poster-bg'
                )
                .appendTo(hero);
        }

        hero.append(
            '<div class="ah-detail-shade"></div>'
        );

        var cont=
            $('<div class="ah-detail-content"></div>');

        var poster=
            $('<div class="ah-detail-poster"></div>');

        var copy=
            $('<div class="ah-detail-copy"></div>');

        putImage(
            poster,
            a.poster,
            a.title
        );

        copy.append(
            '<div class="ah-kicker">'+
                'AnimeHub • Shikimori'+
            '</div>'+
            '<div class="ah-detail-title">'+
                esc(
                    a.title||
                    'Anime'
                )+
            '</div>'
        );

        var original=
            a.name||
            a.english||
            a.japanese||
            '';

        if(
            original&&
            original!==a.title
        ){
            copy.append(
                '<div class="ah-original-title">'+
                    esc(original)+
                '</div>'
            );
        }

        var meta=
            $('<div class="ah-meta"></div>');

        if(
            num(
                a.score,
                0
            )>0
        ){
            meta.append(
                '<span class="ah-chip score">'+
                    '★ '+
                    esc(
                        formatScore(
                            a.score
                        )
                    )+
                '</span>'
            );
        }

        if(a.year){
            meta.append(
                '<span class="ah-chip">'+
                    esc(a.year)+
                '</span>'
            );
        }

        if(a.kind){
            meta.append(
                '<span class="ah-chip">'+
                    esc(
                        kindLabel(
                            a.kind
                        )
                    )+
                '</span>'
            );
        }

        if(a.status){
            meta.append(
                '<span class="ah-chip hot">'+
                    esc(
                        statusLabel(
                            a.status
                        )
                    )+
                '</span>'
            );
        }

        if(a.rating){
            meta.append(
                '<span class="ah-chip">'+
                    esc(
                        ratingLabel(
                            a.rating
                        )
                    )+
                '</span>'
            );
        }

        copy.append(meta);

        if(
            a.studios&&
            a.studios.length
        ){
            copy.append(
                '<div class="ah-studio">'+
                    'Студия: '+
                    esc(
                        a.studios
                            .map(
                                function(x){
                                    return x.name;
                                }
                            )
                            .join(', ')
                    )+
                '</div>'
            );
        }

        var gm=
            $('<div class="ah-meta"></div>');

        (
            a.genres||
            []
        )
        .slice(0,6)
        .forEach(
            function(x){
                gm.append(
                    '<span class="ah-chip">'+
                        esc(
                            x.russian||
                            x.name
                        )+
                    '</span>'
                );
            }
        );

        copy.append(gm);

        var desc=
            cleanDescription(
                a.description||
                ''
            );

        copy.append(
            '<div class="ah-detail-desc">'+
                esc(
                    desc
                        ?clip(
                            desc,
                            620
                        )
                        :'Описание пока отсутствует.'
                )+
            '</div>'
        );

        var acts=
            $('<div class="ah-actions"></div>');

        var fav=
            $('<div class="ah-action selector"></div>');

        watchBtn=
            $('<div class="ah-action primary selector"></div>');

        watchBtn.on(
            'hover:enter',
            playContinue
        );

        function rf(){
            fav.text(
                isFavorite(
                    a.id
                )
                    ?'★ В избранном'
                    :'☆ В избранное'
            );
        }

        rf();

        fav.on(
            'hover:enter',

            function(){
                notify(
                    toggleFavorite(a)
                        ?'Добавлено в избранное'
                        :'Удалено из избранного'
                );

                rf();
            }
        );

        acts.append(
            watchBtn,
            fav
        );

        copy.append(acts);

        refreshWatch();

        cont.append(
            poster,
            copy,
            infoPanel(a)
        );

        hero.append(cont);

        root.append(hero);

        epBox=
            $('<div class="ah-episodes-section"></div>');

        root.append(epBox);

        epLoading();

        if(
            a.screenshots&&
            a.screenshots.length
        ){
            root.append(
                '<div class="ah-block-title">'+
                    'Скриншоты'+
                '</div>'
            );

            var sc=
                $('<div class="ah-screens"></div>');

            a.screenshots
                .slice(0,8)
                .forEach(
                    function(x){
                        var b=
                            $('<div class="ah-screen"></div>');

                        putImage(
                            b,
                            x.x332Url||
                            x.originalUrl,
                            'Скриншот'
                        );

                        sc.append(b);
                    }
                );

            root.append(sc);
        }

        if(
            desc.length>
            620
        ){
            root.append(
                '<div class="ah-block-title">'+
                    'Описание'+
                '</div>'+
                '<div class="ah-description-panel">'+
                    esc(desc)+
                '</div>'
            );
        }

        shelf(
            root,
            'Связанные аниме',
            a.related||
            []
        );

        if(
            a.themes&&
            a.themes.length
        ){
            root.append(
                '<div class="ah-block-title">'+
                    'Темы'+
                '</div>'+
                '<div class="ah-description-panel">'+
                    esc(
                        a.themes
                            .slice(0,12)
                            .map(
                                function(x){
                                    return (
                                        x.russian||
                                        x.name
                                    );
                                }
                            )
                            .join(' • ')
                    )+
                '</div>'
            );
        }

        nav.bind();

        setTimeout(
            function(){
                var x=
                    root.find(
                        '.ah-action.selector'
                    )[0]||
                    root.find(
                        '.selector'
                    )[0];

                if(x){
                    nav.focus(x);
                }

                loadInline();
            },
            60
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

        root.append(
            topbar(),

            loaderHtml(
                'Загрузка информации об аниме…'
            )
        );

        nav=
            makeNav(
                root,
                view,

                function(){
                    Lampa.Activity.backward();
                },

                function(){
                    Lampa.Controller.toggle(
                        'head'
                    );
                }
            );

        requestCached(
            net,

            'detail:'+
            String(
                initial.id||
                ''
            ),

            600000,

            workerUrl(
                'anime',

                {
                    id:initial.id
                }
            ),

            function(d){
                render(
                    d.anime
                );
            },

            function(){
                root.html(
                    '<div class="ah-empty">'+
                        'Не удалось загрузить карточку аниме'+
                    '</div>'
                );
            }
        );

        return view;
    };

    this.start=function(){
        if(
            Lampa.Activity.active().activity!==
            this.activity
        ){
            return;
        }

        installController(
            view,
            root,
            nav,

            function(){
                Lampa.Activity.backward();
            }
        );

        if(anime){
            refreshWatch();

            if(watchData){
                renderEpisodes(
                    watchData
                );
            }
        }
    };

    this.pause=function(){};
    this.stop=function(){};

    this.render=function(){
        return view;
    };

    this.destroy=function(){
        alive=false;

        net.clear();

        view.remove();
    };
}

/* ======================================================
 * BOOT
 * ====================================================== */

function addMenuButton(){
    if(
        $(
            '.menu .menu__list [data-action="'+
            NS+
            '"]'
        ).length
    ){
        return;
    }

    var b=
        $(
            '<li class="menu__item selector" data-action="'+
            NS+
            '">'+
                '<div class="menu__ico">'+
                    toriiSvg('')+
                '</div>'+
                '<div class="menu__text">'+
                    'AnimeHub'+
                '</div>'+
            '</li>'
        );

    b.on(
        'hover:enter',
        openHome
    );

    $('.menu .menu__list')
        .eq(0)
        .append(b);
}

function init(){
    if(
        window[
            NS+
            '_ready'
        ]
    ){
        return;
    }

    window[
        NS+
        '_ready'
    ]=true;

    try{
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

        notify(
            'AnimeHub V'+
            VERSION+
            ' загружен'
        );
    }
    catch(e){
        console.log(
            'AnimeHub init error',
            e
        );

        notify(
            'Ошибка запуска AnimeHub V'+
            VERSION
        );
    }
}

if(window.appready){
    init();
}
else{
    Lampa.Listener.follow(
        'app',

        function(e){
            if(
                e&&
                e.type==='ready'
            ){
                init();
            }
        }
    );
}

})();
