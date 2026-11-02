(function(){
'use strict';

var VERSION='1.0.1';
var NS='animehub_v101';

var HOME=NS+'_home';
var CATALOG=NS+'_catalog';
var DETAIL=NS+'_detail';
var SCHEDULE=NS+'_schedule';
var FAVORITES=NS+'_favorites';

var FAVORITES_KEY='animehub_v010_favorites';
var RECENT_KEY='animehub_v010_recent';
var WATCH_KEY='animehub_v020_watch';

var WORKER='https://animehub-lampa.kalewse69.workers.dev/';

var memoryCache={};
var videoCache={};
var genresCache=null;

/* ============================================================
 * HELPERS
 * ============================================================ */

function notify(t){
    try{
        Lampa.Noty.show(t);
    }
    catch(e){}
}

function clean(v){
    return String(
        v==null
            ?''
            :v
    )
    .replace(/\u00a0/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function cleanDescription(v){
    return clean(
        String(
            v==null
                ?''
                :v
        )
        .replace(/<br\s*\/?\s*>/gi,' ')
        .replace(/<[^>]*>/g,' ')
        .replace(/&nbsp;|&#160;/gi,' ')
        .replace(/&amp;/gi,'&')
        .replace(/&quot;/gi,'"')
        .replace(/&#39;|&apos;/gi,"'")
        .replace(/&lt;/gi,'<')
        .replace(/&gt;/gi,'>')
    );
}

function esc(v){
    return String(
        v==null
            ?''
            :v
    )
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
        :v
            .slice(0,n)
            .replace(
                /\s+\S*$/,
                ''
            )+
            '…';
}

function num(v,d){
    v=parseFloat(v);

    return isNaN(v)
        ?(d||0)
        :v;
}

function intv(v,d){
    v=parseInt(v,10);

    return isNaN(v)
        ?(d||0)
        :v;
}

function formatScore(v){
    v=num(v,0);

    return v
        ?v
            .toFixed(2)
            .replace(/0$/,'')
            .replace(/\.0$/,'')
        :'—';
}

function statusLabel(v){
    return ({
        ongoing:'Онгоинг',
        released:'Вышло',
        announcement:'Анонс',
        announce:'Анонс'
    })[v]||
    clean(v)||
    '';
}

function typeLabel(a){
    var t=
        a&&
        a.type||
        {};

    return clean(
        t.shortname||
        t.name||
        t.alias
    )||
    'Аниме';
}

function formatDate(
    ts,
    withTime
){
    ts=num(ts,0);

    if(!ts){
        return '';
    }

    try{
        var d=
            new Date(
                ts*
                1000
            );

        var options={
            day:'numeric',
            month:'short'
        };

        if(withTime){
            options.hour='2-digit';
            options.minute='2-digit';
        }

        return d.toLocaleString(
            'ru-RU',
            options
        );
    }
    catch(e){
        return '';
    }
}

function episodeCount(a){
    var e=
        a&&
        a.episodes||
        {};

    var aired=
        intv(
            e.aired,
            0
        );

    var count=
        intv(
            e.count,
            0
        );

    if(
        count&&
        aired&&
        aired<count
    ){
        return (
            aired+
            ' / '+
            count
        );
    }

    if(count){
        return String(count);
    }

    if(aired){
        return String(aired);
    }

    return '—';
}

function workerUrl(
    path,
    params
){
    var base=
        WORKER.replace(
            /\/?$/,
            '/'
        );

    var q=[];

    params=params||{};

    Object.keys(params)
        .forEach(function(k){

            var v=
                params[k];

            if(
                v===undefined||
                v===null||
                String(v)===''
            ){
                return;
            }

            q.push(
                encodeURIComponent(k)+
                '='+
                encodeURIComponent(
                    String(v)
                )
            );
        });

    return (
        base+
        String(
            path||
            ''
        )
        .replace(
            /^\//,
            ''
        )+
        (
            q.length
                ?'?'+q.join('&')
                :''
        )
    );
}

function parseJson(v){
    if(
        v&&
        typeof v==='object'
    ){
        return v;
    }

    try{
        return JSON.parse(
            String(
                v||
                ''
            )
        );
    }
    catch(e){
        return null;
    }
}

function requestJson(
    net,
    url,
    ok,
    fail
){
    net.silent(
        url,

        function(response){

            var data=
                parseJson(
                    response
                );

            if(
                !data||
                data.ok===false
            ){
                if(fail){
                    fail({
                        status:
                            data&&
                            data.upstreamStatus||
                            0,

                        message:
                            data&&
                            data.error||
                            'Ошибка AnimeHub Worker',

                        data:data
                    });
                }

                return;
            }

            if(ok){
                ok(data);
            }
        },

        function(e){
            if(fail){
                fail(e||{});
            }
        },

        false,

        {
            dataType:'text'
        }
    );
}

function requestCached(
    net,
    key,
    age,
    url,
    ok,
    fail
){
    var cached=
        memoryCache[key];

    if(
        cached&&
        Date.now()-
        cached.time<
        age
    ){
        setTimeout(
            function(){
                ok(
                    cached.data
                );
            },
            0
        );

        return;
    }

    requestJson(
        net,
        url,

        function(data){

            memoryCache[key]={
                time:Date.now(),
                data:data
            };

            ok(data);
        },

        fail
    );
}

/* ============================================================
 * TORII
 * ============================================================ */

function toriiSvg(cls){
    return (
        '<svg class="'+
        esc(cls||'')+
        '" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">'+

        '<defs>'+
            '<linearGradient id="ahg" x1="0" y1="0" x2="1" y2="1">'+
                '<stop offset="0" stop-color="#a970ff"/>'+
                '<stop offset="1" stop-color="#ed5fd4"/>'+
            '</linearGradient>'+
        '</defs>'+

        '<path fill="url(#ahg)" d="'+
            'M13 20h70l-3.4 10.5c-20.9 4.1-42.3 4.1-63.2 0L13 20z '+
            'M21 37h54v8H21z '+
            'M29 48h9v29h-9z '+
            'M58 48h9v29h-9z '+
            'M24 77h19v7H24z '+
            'M53 77h19v7H53z'+
        '"/>'+
        '</svg>'
    );
}

function loaderHtml(t){
    return (
        '<div class="ah-loader">'+
            '<div class="ah-loader-orbit"></div>'+
            toriiSvg(
                'ah-loader-torii'
            )+
            '<div class="ah-loader-text">'+
                esc(
                    t||
                    'Загрузка…'
                )+
            '</div>'+
        '</div>'
    );
}

/* ============================================================
 * STORAGE
 * ============================================================ */

function storedList(key){
    try{
        var v=
            Lampa.Storage.get(
                key,
                []
            )||
            [];

        return Array.isArray(v)
            ?v
            :[];
    }
    catch(e){
        return [];
    }
}

function setStoredList(
    key,
    value
){
    try{
        Lampa.Storage.set(
            key,
            value
        );
    }
    catch(e){}
}

function animeStorageKey(a){
    return (
        'y:'+
        String(
            a&&a.id||
            ''
        )
    );
}

function compactItem(a){
    return {
        source:'yummy',

        id:String(
            a&&a.id||
            ''
        ),

        title:
            a&&a.title||
            'Anime',

        original:
            a&&a.original||
            '',

        poster:
            a&&a.poster||
            '',

        posterHero:
            a&&a.posterHero||
            '',

        background:
            a&&a.background||
            '',

        score:
            a&&a.score||
            0,

        year:
            a&&a.year||
            null,

        type:
            a&&a.type||
            {},

        status:
            a&&a.status||
            {},

        episodes:
            a&&a.episodes||
            {},

        duration:
            a&&a.duration||
            0
    };
}

function itemSame(a,b){
    if(!a||!b){
        return false;
    }

    if(
        a.source==='yummy'&&
        b.source==='yummy'
    ){
        return (
            String(a.id)===
            String(b.id)
        );
    }

    return (
        String(
            a.id||
            ''
        )===
        String(
            b.id||
            ''
        )&&
        clean(a.title)===
        clean(b.title)
    );
}

function isFavorite(a){
    return storedList(
        FAVORITES_KEY
    )
    .some(function(x){
        return itemSame(
            x,
            a
        );
    });
}

function toggleFavorite(a){
    if(!a||!a.id){
        return false;
    }

    var list=
        storedList(
            FAVORITES_KEY
        );

    var found=false;
    var out=[];

    list.forEach(function(x){

        if(itemSame(x,a)){
            found=true;
        }
        else if(out.length<49){
            out.push(x);
        }
    });

    if(!found){
        out.unshift(
            compactItem(a)
        );
    }

    setStoredList(
        FAVORITES_KEY,
        out
    );

    return !found;
}

function saveRecent(a){
    if(!a||!a.id){
        return;
    }

    var list=
        storedList(
            RECENT_KEY
        );

    var out=[
        compactItem(a)
    ];

    list.forEach(function(x){

        if(
            out.length<24&&
            !itemSame(x,a)
        ){
            out.push(x);
        }
    });

    setStoredList(
        RECENT_KEY,
        out
    );
}

function watchStore(){
    try{
        var value=
            Lampa.Storage.get(
                WATCH_KEY,
                {}
            )||
            {};

        return (
            value&&
            typeof value==='object'&&
            !Array.isArray(value)
        )
            ?value
            :{};
    }
    catch(e){
        return {};
    }
}

function watchState(a){
    return (
        watchStore()[
            animeStorageKey(a)
        ]||
        {}
    );
}

function saveWatchState(
    a,
    patch
){
    if(!a||!a.id){
        return;
    }

    var store=
        watchStore();

    var key=
        animeStorageKey(a);

    var state=
        store[key]||
        {};

    Object.keys(
        patch||
        {}
    )
    .forEach(function(k){
        state[k]=patch[k];
    });

    state.source='yummy';
    state.anime=compactItem(a);
    state.updatedAt=Date.now();

    store[key]=state;

    try{
        Lampa.Storage.set(
            WATCH_KEY,
            store
        );
    }
    catch(e){}
}

function continueItems(){
    var store=
        watchStore();

    return Object.keys(store)
        .map(function(k){
            return store[k];
        })
        .filter(function(x){
            return (
                x&&
                x.source==='yummy'&&
                x.anime&&
                x.anime.id&&
                num(
                    x.episode,
                    0
                )>0
            );
        })
        .sort(function(a,b){
            return (
                num(
                    b.updatedAt,
                    0
                )-
                num(
                    a.updatedAt,
                    0
                )
            );
        })
        .slice(
            0,
            18
        );
}

/* ============================================================
 * CSS
 * ============================================================ */

function injectStyle(){
    if(
        $('#animehub-v101-style')
            .length
    ){
        return;
    }

    $('head').append(`
<style id="animehub-v101-style">
:root{
    --ah-bg:#070913;
    --ah-panel:#111426;
    --ah-text:#f8f7ff;
    --ah-muted:#aaa8bc;
    --ah-purple:#8d56ff;
    --ah-pink:#e95ecf
}

.ah-view{
    height:calc(100vh - 6.1em);
    overflow-y:auto;
    overflow-x:hidden;
    box-sizing:border-box;
    color:var(--ah-text);
    background:
        radial-gradient(circle at 76% -10%,rgba(132,78,255,.17),transparent 34%),
        linear-gradient(180deg,#090b18,#060711 72%)
}

.ah-view::-webkit-scrollbar,
.ah-track::-webkit-scrollbar,
.ah-episode-track::-webkit-scrollbar,
.ah-screens::-webkit-scrollbar{
    width:0;
    height:0
}

.ah-page{
    padding:0 2.05em 5em;
    box-sizing:border-box;
    min-height:100%
}

.ah-topbar{
    height:4.7em;
    display:flex;
    align-items:center;
    gap:1.05em;
    position:relative;
    z-index:30
}

.ah-brand{
    display:flex;
    align-items:center;
    gap:.55em;
    padding-right:1.15em;
    border-right:1px solid rgba(255,255,255,.15);
    white-space:nowrap;
    font-size:1.5em;
    font-weight:900
}

.ah-brand-logo{
    width:2em;
    height:2em;
    filter:drop-shadow(0 0 10px rgba(170,91,255,.35))
}

.ah-brand-name{
    background:linear-gradient(90deg,#fff,#e389ff);
    -webkit-background-clip:text;
    color:transparent
}

.ah-nav{
    display:flex;
    align-items:center;
    gap:.25em;
    min-width:0;
    overflow:hidden
}

.ah-navbtn{
    padding:.62em .84em;
    border-radius:.68em;
    color:#d5d2e1;
    border:1px solid transparent;
    white-space:nowrap
}

.ah-navbtn.active{
    color:#fff;
    background:rgba(129,75,238,.20)
}

.ah-navbtn.focus{
    background:linear-gradient(135deg,#9864ff,#7648ec);
    border-color:rgba(226,201,255,.55);
    box-shadow:0 0 22px rgba(137,82,255,.28);
    color:#fff
}

.ah-hero{
    position:relative;
    height:44vh;
    min-height:24em;
    max-height:33em;
    overflow:hidden;
    border-radius:1.05em;
    margin-bottom:1.55em;
    background:#111425;
    isolation:isolate
}

.ah-hero-bg,
.ah-detail-bg{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    z-index:-5
}

.ah-poster-bg{
    filter:blur(17px) brightness(.62);
    transform:scale(1.08)
}

.ah-hero-shade{
    position:absolute;
    inset:0;
    z-index:-4;
    background:
        linear-gradient(
            90deg,
            rgba(5,6,16,.995) 0%,
            rgba(5,6,16,.96) 28%,
            rgba(5,6,16,.77) 48%,
            rgba(5,6,16,.32) 74%,
            rgba(5,6,16,.09) 100%
        ),
        linear-gradient(
            0deg,
            rgba(5,6,16,.90),
            rgba(5,6,16,.04) 58%
        )
}

.ah-hero-content{
    position:absolute;
    left:3.4%;
    top:7%;
    bottom:7%;
    width:53%;
    display:flex;
    flex-direction:column;
    justify-content:center
}

.ah-kicker{
    font-size:.74em;
    font-weight:850;
    letter-spacing:.12em;
    text-transform:uppercase;
    color:#e497ff;
    margin-bottom:.55em
}

.ah-hero-title{
    font-size:3.05em;
    font-weight:920;
    line-height:1.02;
    letter-spacing:-.035em;
    text-shadow:
        0 3px 8px rgba(0,0,0,.98),
        0 14px 32px rgba(0,0,0,.75)
}

.ah-original-title{
    color:#bdb9cb;
    margin:.23em 0 .62em
}

.ah-meta{
    display:flex;
    flex-wrap:wrap;
    align-items:center;
    gap:.42em;
    margin-bottom:.58em
}

.ah-chip{
    padding:.29em .60em;
    border-radius:999px;
    font-size:.80em;
    background:rgba(255,255,255,.09);
    border:1px solid rgba(255,255,255,.13);
    white-space:nowrap
}

.ah-chip.score{
    color:#ffd768
}

.ah-chip.hot{
    color:#ff9fdc
}

.ah-hero-desc{
    font-size:.97em;
    line-height:1.53;
    color:#f4f2fa;
    max-width:46em;
    margin:.65em 0 1.02em;
    text-shadow:
        0 2px 5px #000,
        0 8px 24px rgba(0,0,0,.92)
}

.ah-actions{
    display:flex;
    gap:.62em;
    align-items:center
}

.ah-action,
.ah-pagebtn,
.ah-filter,
.ah-all-episodes{
    padding:.70em 1.02em;
    border-radius:.60em;
    background:rgba(255,255,255,.105);
    border:1px solid rgba(255,255,255,.14);
    font-weight:760;
    box-sizing:border-box
}

.ah-action.primary{
    background:linear-gradient(135deg,#995fff,#7443e8 62%,#d54fd9)
}

.ah-action.focus,
.ah-pagebtn.focus,
.ah-filter.focus,
.ah-all-episodes.focus{
    transform:scale(1.035);
    background:#fff;
    color:#090b14;
    box-shadow:0 0 0 3px rgba(158,105,255,.34)
}

.ah-shelf{
    margin:0 0 1.45em
}

.ah-shelf-title,
.ah-block-title,
.ah-episodes-title{
    font-size:1.34em;
    font-weight:850;
    margin:0 0 .62em
}

.ah-track,
.ah-screens,
.ah-episode-track{
    display:flex;
    gap:.78em;
    overflow-x:auto;
    overflow-y:hidden;
    padding:.35em .24em .78em
}

.ah-wide-card{
    position:relative;
    flex:0 0 15.7em;
    height:7.25em;
    border-radius:.72em;
    overflow:hidden;
    background:#111426;
    border:1px solid rgba(255,255,255,.08)
}

.ah-wide-card img{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    opacity:.86
}

.ah-wide-shade{
    position:absolute;
    inset:0;
    background:
        linear-gradient(
            0deg,
            rgba(5,7,17,.99),
            rgba(5,7,17,.18) 78%
        ),
        linear-gradient(
            90deg,
            rgba(5,7,17,.38),
            transparent
        )
}

.ah-wide-copy{
    position:absolute;
    left:.68em;
    right:.68em;
    bottom:.55em
}

.ah-wide-title{
    font-weight:780;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-wide-meta{
    font-size:.69em;
    color:#d1cedc;
    display:flex;
    gap:.48em;
    white-space:nowrap;
    overflow:hidden
}

.ah-wide-badge{
    position:absolute;
    left:.5em;
    top:.48em;
    padding:.24em .44em;
    border-radius:.40em;
    background:rgba(121,70,240,.91);
    font-size:.64em;
    font-weight:850
}

.ah-wide-progress{
    position:absolute;
    left:.62em;
    right:.62em;
    bottom:.18em;
    height:.18em;
    background:rgba(255,255,255,.13);
    border-radius:99px;
    overflow:hidden
}

.ah-wide-progress span{
    display:block;
    height:100%;
    background:linear-gradient(90deg,#9560ff,#ed60cf)
}

.ah-wide-card.focus,
.ah-poster-card.focus,
.ah-episode-card.focus,
.ah-schedule-card.focus{
    transform:scale(1.052);
    border-color:#dcb8ff;
    box-shadow:
        0 0 0 3px rgba(146,87,255,.23),
        0 16px 38px rgba(0,0,0,.44);
    z-index:5
}

.ah-section-head{
    padding:.62em 0 1em
}

.ah-page-title{
    font-size:2.05em;
    font-weight:920
}

.ah-page-sub{
    color:#9795aa;
    margin-top:.22em
}

.ah-catalog-layout{
    display:flex;
    align-items:flex-start;
    gap:1.25em
}

.ah-filter-sidebar{
    width:12.2em;
    min-width:12.2em;
    position:sticky;
    top:.4em;
    padding:.65em;
    border-radius:.85em;
    background:rgba(12,15,30,.68);
    border:1px solid rgba(255,255,255,.07)
}

.ah-filter{
    margin:.22em 0;
    width:100%;
    font-size:.85em
}

.ah-filter.selected{
    background:rgba(133,79,245,.34);
    border-color:rgba(192,156,255,.32)
}

.ah-catalog-main{
    flex:1;
    min-width:0
}

.ah-grid{
    display:flex;
    flex-wrap:wrap;
    gap:.85em
}

.ah-poster-card{
    flex:0 0 9.95em;
    width:9.95em;
    padding:.27em;
    border-radius:.76em;
    box-sizing:border-box
}

.ah-poster-media{
    position:relative;
    height:14.15em;
    border-radius:.62em;
    overflow:hidden;
    background:#13162a
}

.ah-poster-media img,
.ah-detail-poster img,
.ah-screen img{
    width:100%;
    height:100%;
    object-fit:cover
}

.ah-poster-score{
    position:absolute;
    right:.45em;
    bottom:.45em;
    padding:.25em .43em;
    border-radius:.4em;
    background:rgba(7,8,18,.9);
    color:#ffd76a;
    font-size:.72em
}

.ah-poster-status{
    position:absolute;
    left:.45em;
    top:.45em;
    padding:.24em .42em;
    border-radius:.4em;
    background:rgba(111,65,226,.90);
    font-size:.63em;
    font-weight:800
}

.ah-poster-title{
    font-size:.84em;
    font-weight:740;
    height:2.28em;
    overflow:hidden;
    margin:.50em .06em .15em
}

.ah-poster-meta{
    font-size:.66em;
    color:#8f8ca2;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-pages{
    display:flex;
    gap:.65em;
    margin-top:1.25em
}

.ah-detail-hero{
    position:relative;
    min-height:31em;
    border-radius:1.05em;
    overflow:hidden;
    margin-bottom:1.12em;
    isolation:isolate;
    background:#0a0d1b
}

.ah-detail-bg{
    filter:brightness(.80) saturate(1.06)
}

.ah-detail-shade{
    position:absolute;
    inset:0;
    z-index:-4;
    background:
        linear-gradient(
            90deg,
            rgba(4,6,16,.995) 0%,
            rgba(4,6,16,.96) 29%,
            rgba(4,6,16,.79) 52%,
            rgba(4,6,16,.40) 78%,
            rgba(4,6,16,.20) 100%
        ),
        linear-gradient(
            0deg,
            rgba(4,6,16,.96),
            rgba(4,6,16,.10) 68%
        )
}

.ah-detail-content{
    display:flex;
    gap:1.25em;
    padding:1.55em;
    align-items:center;
    min-height:30em;
    box-sizing:border-box
}

.ah-detail-poster{
    width:12.8em;
    min-width:12.8em;
    height:18.9em;
    border-radius:.82em;
    overflow:hidden;
    background:#15182a;
    border:1px solid rgba(225,202,255,.26);
    box-shadow:0 18px 42px rgba(0,0,0,.38)
}

.ah-detail-copy{
    flex:1;
    min-width:0;
    padding:.9em 1.05em;
    border-radius:.8em;
    background:
        linear-gradient(
            90deg,
            rgba(4,6,16,.70),
            rgba(4,6,16,.34) 72%,
            rgba(4,6,16,.08)
        );
    border-left:1px solid rgba(255,255,255,.055)
}

.ah-detail-title{
    font-size:2.65em;
    font-weight:920;
    line-height:1.04;
    letter-spacing:-.03em;
    text-shadow:
        0 3px 8px rgba(0,0,0,.98),
        0 12px 28px rgba(0,0,0,.78)
}

.ah-detail-desc{
    font-size:.95em;
    line-height:1.55;
    color:#f4f2fa;
    max-width:50em;
    margin:.72em 0 1em;
    text-shadow:
        0 2px 5px #000,
        0 8px 22px rgba(0,0,0,.96)
}

.ah-detail-aside{
    width:17.2em;
    min-width:17.2em;
    padding:.9em 1em;
    border-radius:.84em;
    background:rgba(10,14,30,.86);
    border:1px solid rgba(187,154,255,.22)
}

.ah-detail-aside-title{
    font-weight:850;
    font-size:1.03em;
    margin-bottom:.32em
}

.ah-info-row{
    display:flex;
    justify-content:space-between;
    gap:.7em;
    padding:.58em 0;
    border-bottom:1px solid rgba(255,255,255,.075);
    font-size:.80em
}

.ah-info-label{
    color:#aaa7b8
}

.ah-info-value{
    font-weight:740;
    text-align:right;
    max-width:62%
}

.ah-studio{
    color:#cfccda;
    font-size:.82em;
    margin:.24em 0 .5em
}

.ah-description-panel{
    padding:1em;
    border-radius:.78em;
    background:rgba(16,19,37,.70);
    border:1px solid rgba(255,255,255,.065);
    color:#d5d2df;
    line-height:1.55;
    margin-bottom:1.3em
}

.ah-episodes-section{
    margin-bottom:1.42em
}

.ah-episodes-head{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:1em;
    margin-bottom:.6em
}

.ah-episodes-title-wrap{
    display:flex;
    align-items:center;
    gap:.65em
}

.ah-episodes-count{
    padding:.26em .57em;
    border-radius:999px;
    font-size:.73em;
    color:#d8d4e3;
    background:rgba(255,255,255,.07)
}

.ah-all-episodes{
    font-size:.80em
}

.ah-episode-card{
    position:relative;
    flex:0 0 11em;
    height:6.45em;
    border-radius:.7em;
    overflow:hidden;
    background:#121529;
    border:1px solid rgba(255,255,255,.09)
}

.ah-episode-card img{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    opacity:.76
}

.ah-episode-shade{
    position:absolute;
    inset:0;
    background:
        linear-gradient(
            0deg,
            rgba(5,7,17,.99),
            rgba(5,7,17,.16) 75%
        )
}

.ah-episode-number{
    position:absolute;
    left:.45em;
    top:.42em;
    padding:.25em .43em;
    border-radius:.42em;
    background:rgba(8,10,23,.88);
    font-weight:850;
    font-size:.78em
}

.ah-episode-copy{
    position:absolute;
    left:.52em;
    right:.52em;
    bottom:.45em
}

.ah-episode-name{
    font-size:.75em;
    font-weight:760;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-episode-meta{
    font-size:.63em;
    color:#c4c0d0;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-episode-progress{
    position:absolute;
    left:0;
    right:0;
    bottom:0;
    height:.20em;
    background:rgba(255,255,255,.10)
}

.ah-episode-progress span{
    display:block;
    height:100%;
    background:linear-gradient(90deg,#8d56ff,#ed60cf)
}

.ah-episode-card.current{
    border-color:rgba(218,183,255,.86)
}

.ah-placeholder{
    display:flex;
    align-items:center;
    gap:.75em;
    min-height:4.6em;
    padding:.9em;
    border-radius:.75em;
    background:rgba(15,18,35,.68);
    border:1px solid rgba(255,255,255,.065);
    color:#c4c1d1
}

.ah-mini-spinner{
    width:1.35em;
    height:1.35em;
    border-radius:50%;
    border:2px solid rgba(190,145,255,.14);
    border-top-color:#c87aff;
    animation:ah-spin 1s linear infinite
}

.ah-screen{
    flex:0 0 17.6em;
    height:9.9em;
    border-radius:.68em;
    overflow:hidden;
    background:#121529
}

.ah-schedule-day{
    margin-bottom:1.4em
}

.ah-schedule-day-title{
    font-size:1.15em;
    font-weight:850;
    margin-bottom:.58em;
    color:#eeeaf7
}

.ah-schedule-grid{
    display:flex;
    flex-wrap:wrap;
    gap:.75em
}

.ah-schedule-card{
    position:relative;
    width:14.7em;
    height:6.8em;
    border-radius:.68em;
    overflow:hidden;
    background:#121529;
    border:1px solid rgba(255,255,255,.08)
}

.ah-schedule-card img{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    opacity:.64
}

.ah-schedule-card:after{
    content:'';
    position:absolute;
    inset:0;
    background:
        linear-gradient(
            0deg,
            rgba(5,7,16,.98),
            rgba(5,7,16,.28)
        )
}

.ah-schedule-copy{
    position:absolute;
    z-index:2;
    left:.62em;
    right:.62em;
    bottom:.5em
}

.ah-schedule-title{
    font-size:.83em;
    font-weight:780;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-schedule-meta{
    font-size:.66em;
    color:#c9c5d5;
    margin-top:.15em
}

.ah-empty{
    padding:2em 0;
    color:#aaa7ba
}

.ah-fallback{
    display:flex;
    align-items:center;
    justify-content:center;
    width:100%;
    height:100%;
    background:#14172a;
    color:#858397;
    text-align:center;
    padding:.5em;
    box-sizing:border-box
}

.ah-loader{
    min-height:24em;
    position:relative;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    gap:.9em
}

.ah-loader-torii{
    width:5.3em;
    height:5.3em;
    filter:drop-shadow(0 0 18px rgba(174,92,255,.34))
}

.ah-loader-orbit{
    position:absolute;
    width:7em;
    height:7em;
    border-radius:50%;
    border:3px solid rgba(174,103,255,.10);
    border-top-color:#d36dff;
    animation:ah-spin 1.15s linear infinite
}

.ah-loader-text{
    color:#bdb8ca
}

@keyframes ah-spin{
    to{
        transform:rotate(360deg)
    }
}

@media(max-width:1250px){
    .ah-detail-aside{
        display:none
    }

    .ah-detail-poster{
        width:11.6em;
        min-width:11.6em;
        height:17.2em
    }

    .ah-detail-title{
        font-size:2.35em
    }

    .ah-filter-sidebar{
        width:10.8em;
        min-width:10.8em
    }
}
</style>
    `);
}

/* ============================================================
 * IMAGE
 * ============================================================ */

function putImage(
    box,
    url,
    text
){
    if(!url){
        box.append(
            '<div class="ah-fallback">'+
                esc(
                    text||
                    'AnimeHub'
                )+
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
                        esc(
                            text||
                            'AnimeHub'
                        )+
                    '</div>'
                );
        }
    );

    box.append(img);
}

/* ============================================================
 * NAVIGATION
 * ============================================================ */

function visibleSelectors(root){
    return root
        .find('.selector')
        .toArray()
        .filter(function(x){
            return (
                x&&
                x.offsetParent!==null
            );
        });
}

function ensureVisible(
    view,
    element
){
    if(
        !view||
        !view[0]||
        !element
    ){
        return;
    }

    var container=
        view[0];

    var er=
        element.getBoundingClientRect();

    var vr=
        container.getBoundingClientRect();

    if(
        er.bottom>
        vr.bottom-
        30
    ){
        container.scrollTop+=
            er.bottom-
            (
                vr.bottom-
                30
            );
    }
    else if(
        er.top<
        vr.top+
        15
    ){
        container.scrollTop-=
            vr.top+
            15-
            er.top;
    }

    var p=
        element.parentElement;

    while(
        p&&
        p!==container
    ){
        var style=
            window.getComputedStyle
                ?window.getComputedStyle(p)
                :null;

        if(
            style&&
            (
                style.overflowX==='auto'||
                style.overflowX==='scroll'
            )
        ){
            var pr=
                p.getBoundingClientRect();

            if(
                er.right>
                pr.right-
                18
            ){
                p.scrollLeft+=
                    er.right-
                    (
                        pr.right-
                        18
                    );
            }
            else if(
                er.left<
                pr.left+
                18
            ){
                p.scrollLeft-=
                    pr.left+
                    18-
                    er.left;
            }

            break;
        }

        p=
            p.parentElement;
    }
}

function makeNav(
    root,
    view,
    leftEdge,
    upEdge
){
    var last=null;

    function focus(el){
        if(!el){
            return;
        }

        last=el;

        try{
            Lampa.Controller.collectionFocus(
                el,
                view
            );
        }
        catch(e){
            try{
                Lampa.Controller.focus(
                    el
                );
            }
            catch(x){}
        }

        ensureVisible(
            view,
            el
        );
    }

    function move(direction){
        var all=
            visibleSelectors(root);

        var current=
            last||
            root.find(
                '.selector.focus'
            )[0]||
            all[0];

        if(!current){
            return;
        }

        var cr=
            current.getBoundingClientRect();

        var cx=
            cr.left+
            cr.width/
            2;

        var cy=
            cr.top+
            cr.height/
            2;

        var best=null;
        var bestScore=1e9;

        all.forEach(function(x){

            if(x===current){
                return;
            }

            var r=
                x.getBoundingClientRect();

            var xx=
                r.left+
                r.width/
                2;

            var yy=
                r.top+
                r.height/
                2;

            var dx=
                xx-
                cx;

            var dy=
                yy-
                cy;

            if(
                direction==='left'&&
                dx>=-4
            ){
                return;
            }

            if(
                direction==='right'&&
                dx<=4
            ){
                return;
            }

            if(
                direction==='up'&&
                dy>=-4
            ){
                return;
            }

            if(
                direction==='down'&&
                dy<=4
            ){
                return;
            }

            var main=
                (
                    direction==='left'||
                    direction==='right'
                )
                    ?Math.abs(dx)
                    :Math.abs(dy);

            var cross=
                (
                    direction==='left'||
                    direction==='right'
                )
                    ?Math.abs(dy)
                    :Math.abs(dx);

            var score=
                main+
                cross*
                2.25;

            if(score<bestScore){
                bestScore=score;
                best=x;
            }
        });

        if(best){
            focus(best);
        }
        else if(
            direction==='left'&&
            leftEdge
        ){
            leftEdge();
        }
        else if(
            direction==='up'&&
            upEdge
        ){
            upEdge();
        }
    }

    function bind(){
        root.find(
            '.selector'
        )
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
                    $(x)
                        .trigger(
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

/* ============================================================
 * APP ROUTES
 * ============================================================ */

function openHome(){
    Lampa.Activity.push({
        url:'animehub',
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
        url:'animehub/catalog',
        title:title||'Каталог',
        component:CATALOG,
        page:1,
        ah_mode:mode||'all',
        ah_value:value||'',
        ah_title:title||'Каталог',
        ah_page:page||1
    });
}

function openSchedule(){
    Lampa.Activity.push({
        url:'animehub/schedule',
        title:'Расписание',
        component:SCHEDULE,
        page:1
    });
}

function openFavorites(){
    Lampa.Activity.push({
        url:'animehub/favorites',
        title:'Избранное',
        component:FAVORITES,
        page:1
    });
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
            title:
                'Поиск AnimeHub',

            value:'',
            free:true,
            nosave:true
        },

        function(result){
            try{
                Lampa.Controller.toggle(
                    'content'
                );
            }
            catch(e){}

            var query=
                clean(
                    result&&
                    typeof result==='object'
                        ?result.value
                        :result
                );

            if(query){
                openCatalog(
                    'search',
                    query,
                    'Поиск: '+
                    query,
                    1
                );
            }
        }
    );
}

function showSelect(
    title,
    items,
    onSelect
){
    if(
        !items||
        !items.length
    ){
        notify(
            'Список пуст'
        );

        return false;
    }

    Lampa.Select.show({
        title:title,
        items:items,

        onSelect:
            onSelect,

        onBack:function(){
            try{
                Lampa.Controller.toggle(
                    'content'
                );
            }
            catch(e){}
        }
    });

    return true;
}

/* Reliable nested Select chain.
   Some Lampa builds call onBack after a selection. */

function showPlaybackSelect(params){
    if(
        !Lampa.Select||
        !Lampa.Select.show
    ){
        notify(
            'Выбор источника недоступен'
        );

        try{
            Lampa.Controller.toggle(
                'content'
            );
        }
        catch(e){}

        return false;
    }

    params=
        $.extend(
            {},
            params||
            {}
        );

    var settled=false;

    var originalSelect=
        params.onSelect;

    var originalBack=
        params.onBack;

    params.onSelect=
        function(item){
            settled=true;

            if(originalSelect){
                originalSelect(item);
            }
        };

    params.onBack=
        function(){
            if(settled){
                return;
            }

            if(originalBack){
                originalBack();
            }
            else{
                try{
                    Lampa.Controller.toggle(
                        'content'
                    );
                }
                catch(e){}
            }
        };

    Lampa.Select.show(params);

    return true;
}

function chainSelect(fn){
    setTimeout(
        fn,
        0
    );
}

function loadGenres(callback){
    if(genresCache){
        callback(
            genresCache
        );

        return;
    }

    var net=
        new Lampa.Reguest();

    requestCached(
        net,
        'genres',
        86400000,
        workerUrl(
            'genres'
        ),

        function(data){
            genresCache=
                data.genres||
                [];

            callback(
                genresCache
            );

            try{
                net.clear();
            }
            catch(e){}
        },

        function(){
            notify(
                'Не удалось загрузить жанры'
            );
        }
    );
}

function chooseGenre(){
    loadGenres(
        function(genres){

            showSelect(
                'Жанры',

                genres.map(
                    function(g){
                        return {
                            title:g.title,
                            id:g.id
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

function chooseYear(){
    var now=
        new Date()
            .getFullYear();

    var items=[];

    for(
        var y=now+1;
        y>=1970;
        y--
    ){
        items.push({
            title:String(y),
            value:String(y)
        });
    }

    showSelect(
        'Год',
        items,

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

function chooseType(){
    var types=[
        ['TV-сериалы','tv'],
        ['Фильмы','movie'],
        ['OVA','ova'],
        ['ONA','ona'],
        ['Спецвыпуски','special'],
        ['Короткие TV','shorttv'],
        ['Короткометражки','shortfilm']
    ];

    showSelect(
        'Тип',

        types.map(
            function(x){
                return {
                    title:x[0],
                    value:x[1]
                };
            }
        ),

        function(x){
            openCatalog(
                'type',
                x.value,
                x.title,
                1
            );
        }
    );
}

function topbar(
    active,
    homeNoop
){
    var bar=
        $('<div class="ah-topbar"></div>');

    var brand=
        $('<div class="ah-brand"></div>')
        .append(
            toriiSvg(
                'ah-brand-logo'
            ),

            '<span class="ah-brand-name">'+
                'AnimeHub'+
            '</span>'
        );

    var nav=
        $('<div class="ah-nav"></div>');

    function add(
        key,
        title,
        action
    ){
        var item=
            $('<div class="ah-navbtn selector"></div>')
            .text(title);

        if(active===key){
            item.addClass(
                'active'
            );
        }

        item.on(
            'hover:enter',
            action
        );

        nav.append(item);
    }

    add(
        'home',
        'Главная',
        homeNoop||
        openHome
    );

    add(
        'catalog',
        'Каталог',

        function(){
            openCatalog(
                'all',
                '',
                'Каталог',
                1
            );
        }
    );

    add(
        'search',
        'Поиск',
        openSearch
    );

    add(
        'schedule',
        'Расписание',
        openSchedule
    );

    add(
        'favorites',
        'Избранное',
        openFavorites
    );

    return bar.append(
        brand,
        nav
    );
}

/* ============================================================
 * DETAIL OPEN
 * ============================================================ */

function openDetail(a){
    if(!a){
        return;
    }

    if(
        a.source==='yummy'&&
        a.id
    ){
        Lampa.Activity.push({
            url:
                'animehub/anime/'+
                a.id,

            title:
                a.title||
                'AnimeHub',

            component:
                DETAIL,

            page:1,

            ah_item:
                compactItem(a)
        });

        return;
    }

    /* Resolve old V0.3 Shikimori favourites by title. */

    if(a.title){
        var net=
            new Lampa.Reguest();

        try{
            Lampa.Loading.start();
        }
        catch(e){}

        requestJson(
            net,

            workerUrl(
                'catalog',

                {
                    mode:'search',
                    value:a.title,
                    page:1,
                    limit:8
                }
            ),

            function(data){
                try{
                    Lampa.Loading.stop();
                    net.clear();
                }
                catch(e){}

                var items=
                    data.items||
                    [];

                if(!items.length){
                    notify(
                        'Не удалось сопоставить старую запись'
                    );

                    return;
                }

                var best=
                    items[0];

                if(a.year){
                    items.some(
                        function(x){

                            if(
                                intv(
                                    x.year,
                                    0
                                )===
                                intv(
                                    a.year,
                                    0
                                )
                            ){
                                best=x;
                                return true;
                            }

                            return false;
                        }
                    );
                }

                openDetail(best);
            },

            function(){
                try{
                    Lampa.Loading.stop();
                    net.clear();
                }
                catch(e){}

                notify(
                    'Не удалось открыть старую запись'
                );
            }
        );
    }
}

/* ============================================================
 * CARDS
 * ============================================================ */

function wideCard(
    a,
    watch
){
    var card=
        $('<div class="ah-wide-card selector"></div>');

    var bg=
        a.background||
        a.posterHero||
        a.poster||
        '';

    if(bg){
        $('<img alt="">')
            .attr({
                src:bg,
                loading:'lazy'
            })
            .appendTo(card);
    }

    card.append(
        '<div class="ah-wide-shade"></div>'
    );

    if(
        a.status&&
        a.status.alias==='ongoing'
    ){
        card.append(
            '<div class="ah-wide-badge">'+
                'ОНГОИНГ'+
            '</div>'
        );
    }
    else if(
        a.status&&
        a.status.alias==='announcement'
    ){
        card.append(
            '<div class="ah-wide-badge">'+
                'АНОНС'+
            '</div>'
        );
    }

    var meta=[];

    if(a.year){
        meta.push(
            a.year
        );
    }

    meta.push(
        typeLabel(a)
    );

    if(
        num(
            a.score,
            0
        )>0
    ){
        meta.push(
            '★ '+
            formatScore(
                a.score
            )
        );
    }

    if(
        a.episodes&&
        a.episodes.aired
    ){
        meta.push(
            intv(
                a.episodes.aired,
                0
            )+
            ' сер.'
        );
    }

    if(
        watch&&
        num(
            watch.episode,
            0
        )>0
    ){
        meta.unshift(
            'Серия '+
            watch.episode
        );
    }

    card.append(
        '<div class="ah-wide-copy">'+
            '<div class="ah-wide-title">'+
                esc(
                    a.title||
                    'Anime'
                )+
            '</div>'+
            '<div class="ah-wide-meta">'+
                meta.map(
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

    if(
        watch&&
        num(
            watch.duration,
            0
        )>0&&
        num(
            watch.position,
            0
        )>0&&
        !watch.completed
    ){
        var progress=
            Math.max(
                0,
                Math.min(
                    100,
                    Math.round(
                        num(
                            watch.position,
                            0
                        )/
                        num(
                            watch.duration,
                            1
                        )*
                        100
                    )
                )
            );

        card.append(
            '<div class="ah-wide-progress">'+
                '<span style="width:'+
                    progress+
                    '%"></span>'+
            '</div>'
        );
    }

    card.on(
        'hover:enter',

        function(){
            openDetail(a);
        }
    );

    return card;
}

function posterCard(a){
    var card=
        $('<div class="ah-poster-card selector"></div>');

    var media=
        $('<div class="ah-poster-media"></div>');

    putImage(
        media,
        a.poster,
        a.title
    );

    if(
        num(
            a.score,
            0
        )>0
    ){
        media.append(
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

    if(
        a.status&&
        a.status.alias==='ongoing'
    ){
        media.append(
            '<div class="ah-poster-status">'+
                'ОНГОИНГ'+
            '</div>'
        );
    }

    card.append(
        media,

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
                    typeLabel(a),

                    a.episodes&&
                    a.episodes.aired
                        ?intv(
                            a.episodes.aired,
                            0
                        )+
                        ' сер.'
                        :''
                ]
                .filter(Boolean)
                .join(' • ')
            )+
        '</div>'
    );

    card.on(
        'hover:enter',

        function(){
            openDetail(a);
        }
    );

    return card;
}

function shelf(
    root,
    title,
    items,
    watchMap
){
    if(
        !items||
        !items.length
    ){
        return;
    }

    var section=
        $(
            '<div class="ah-shelf">'+
                '<div class="ah-shelf-title">'+
                    esc(title)+
                '</div>'+
            '</div>'
        );

    var track=
        $('<div class="ah-track"></div>');

    items
        .slice(
            0,
            18
        )
        .forEach(function(a){

            track.append(
                wideCard(
                    a,

                    watchMap&&
                    watchMap[
                        String(a.id)
                    ]
                )
            );
        });

    root.append(
        section.append(
            track
        )
    );
}

function continueShelf(root){
    var states=
        continueItems();

    if(!states.length){
        return;
    }

    var map={};

    var items=
        states.map(
            function(state){

                map[
                    String(
                        state.anime.id
                    )
                ]=
                    state;

                return state.anime;
            }
        );

    shelf(
        root,
        'Продолжаем смотреть',
        items,
        map
    );
}

/* ============================================================
 * VIDEOS
 * ============================================================ */

function loadVideos(
    a,
    ok,
    fail,
    loading
){
    if(!a||!a.id){
        if(fail){
            fail();
        }

        return;
    }

    var key=
        String(a.id);

    var cached=
        videoCache[key];

    if(
        cached&&
        Date.now()-
        cached.time<
        120000
    ){
        setTimeout(
            function(){
                ok(
                    cached.data
                );
            },
            0
        );

        return;
    }

    var net=
        new Lampa.Reguest();

    net.timeout(
        22000
    );

    if(loading!==false){
        try{
            Lampa.Loading.start();
        }
        catch(e){}
    }

    requestJson(
        net,

        workerUrl(
            'videos',
            {
                id:a.id
            }
        ),

        function(data){

            if(loading!==false){
                try{
                    Lampa.Loading.stop();
                }
                catch(e){}
            }

            videoCache[key]={
                time:Date.now(),
                data:
                    data.videos||
                    []
            };

            try{
                net.clear();
            }
            catch(e){}

            ok(
                data.videos||
                []
            );
        },

        function(e){

            if(loading!==false){
                try{
                    Lampa.Loading.stop();
                }
                catch(x){}
            }

            try{
                net.clear();
            }
            catch(x){}

            if(fail){
                fail(e);
            }
            else{
                notify(
                    'Не удалось загрузить видео'
                );
            }
        }
    );
}

function sourcePriority(source){
    var map={
        direct:0,
        cvh:1,
        vk:2,
        kodik:3,
        aksor:4,
        rutube:5,
        sibnet:6
    };

    return map[source]!==undefined
        ?map[source]
        :99;
}

function normalizeVoice(value){
    return clean(
        value||
        'Без названия'
    )
    .replace(
        /^\ufeff/,
        ''
    );
}

function groupKey(video){
    return (
        normalizeVoice(
            video.dubbing
        )
        .toLowerCase()+
        '|'+
        clean(
            video.provider||
            video.player||
            video.source
        )
        .toLowerCase()
    );
}

function groupVideos(videos){
    var groups={};

    (
        videos||
        []
    )
    .filter(function(v){
        return (
            v&&
            v.supported&&
            v.iframe
        );
    })
    .forEach(function(v){

        var key=
            groupKey(v);

        if(!groups[key]){
            groups[key]={
                key:key,

                dubbing:
                    v.dubbing||
                    'Без названия',

                player:
                    v.player||
                    v.provider||
                    v.source,

                provider:
                    v.provider||
                    '',

                source:
                    v.source,

                videos:[]
            };
        }

        groups[key]
            .videos
            .push(v);
    });

    return Object.keys(groups)
        .map(function(k){

            groups[k]
                .videos
                .sort(
                    function(a,b){
                        return (
                            num(
                                a.number,
                                0
                            )-
                            num(
                                b.number,
                                0
                            )||
                            intv(
                                a.index,
                                0
                            )-
                            intv(
                                b.index,
                                0
                            )
                        );
                    }
                );

            return groups[k];
        })
        .sort(function(a,b){

            return (
                sourcePriority(
                    a.source
                )-
                sourcePriority(
                    b.source
                )||
                clean(
                    a.dubbing
                )
                .localeCompare(
                    clean(
                        b.dubbing
                    ),
                    'ru'
                )
            );
        });
}

function uniqueEpisodes(group){
    var seen={};
    var out=[];

    (
        group&&
        group.videos||
        []
    )
    .forEach(function(v){

        var key=
            String(
                num(
                    v.number,
                    0
                )
            );

        if(
            !key||
            seen[key]
        ){
            return;
        }

        seen[key]=1;

        out.push(v);
    });

    return out.sort(
        function(a,b){
            return (
                num(
                    a.number,
                    0
                )-
                num(
                    b.number,
                    0
                )
            );
        }
    );
}

function availableEpisodes(videos){
    var seen={};
    var out=[];

    (
        videos||
        []
    )
    .filter(function(v){
        return (
            v&&
            v.supported&&
            v.iframe
        );
    })
    .forEach(function(v){

        var n=
            num(
                v.number,
                0
            );

        var key=
            String(n);

        if(
            !n||
            seen[key]
        ){
            return;
        }

        seen[key]=1;
        out.push(n);
    });

    return out.sort(
        function(a,b){
            return a-b;
        }
    );
}

function findVideo(
    group,
    episode
){
    var best=null;

    (
        group&&
        group.videos||
        []
    )
    .some(function(v){

        if(
            Math.abs(
                num(
                    v.number,
                    0
                )-
                num(
                    episode,
                    0
                )
            )<
            .0001
        ){
            best=v;
            return true;
        }

        return false;
    });

    return best;
}

function qualityKeys(qualities){
    return Object.keys(
        qualities||
        {}
    )
    .sort(function(a,b){

        var na=
            intv(
                String(a)
                    .replace(
                        /\D/g,
                        ''
                    ),
                0
            );

        var nb=
            intv(
                String(b)
                    .replace(
                        /\D/g,
                        ''
                    ),
                0
            );

        if(na&&nb){
            return nb-na;
        }

        if(a==='auto'){
            return 1;
        }

        if(b==='auto'){
            return -1;
        }

        return String(b)
            .localeCompare(
                String(a)
            );
    });
}

function resolveVideo(
    video,
    ok,
    fail
){
    if(
        !video||
        !video.iframe
    ){
        if(fail){
            fail({
                message:
                    'Нет адреса плеера'
            });
        }

        return;
    }

    var net=
        new Lampa.Reguest();

    net.timeout(
        30000
    );

    requestJson(
        net,

        workerUrl(
            'resolve',

            {
                url:
                    video.iframe,

                player:
                    video.source||
                    video.player||
                    video.provider||
                    '',

                ua:
                    (
                        window.navigator&&
                        window.navigator.userAgent
                    )||
                    ''
            }
        ),

        function(data){

            try{
                net.clear();
            }
            catch(e){}

            ok(
                data.stream||
                {}
            );
        },

        function(e){

            try{
                net.clear();
            }
            catch(x){}

            if(fail){
                fail(e||{});
            }
        }
    );
}

/* ============================================================
 * NATIVE PLAYER
 * ============================================================ */

function playerCard(a){
    return {
        id:a.id||'',

        title:
            a.title||
            'AnimeHub',

        name:
            a.title||
            'AnimeHub',

        original_title:
            a.original||
            a.title||
            '',

        original_name:
            a.original||
            '',

        release_date:
            a.year
                ?String(
                    a.year
                )+
                '-01-01'
                :'',

        first_air_date:
            a.year
                ?String(
                    a.year
                )+
                '-01-01'
                :'',

        poster_path:
            a.poster||
            '',

        source:
            'animehub',

        animehub_id:
            String(
                a.id||
                ''
            )
    };
}

function startResolvedPlayback(
    anime,
    video,
    group,
    resolved,
    quality,
    url
){
    var old=
        watchState(anime);

    var same=
        Math.abs(
            num(
                old.episode,
                0
            )-
            num(
                video.number,
                0
            )
        )<
        .0001;

    saveWatchState(
        anime,

        {
            episode:
                video.number,

            videoId:
                video.id,

            providerKey:
                group.key,

            provider:
                group.source,

            dubbing:
                group.dubbing,

            player:
                group.player,

            quality:
                quality,

            position:
                same&&
                !old.completed
                    ?num(
                        old.position,
                        0
                    )
                    :0,

            duration:
                same
                    ?num(
                        old.duration,
                        0
                    )
                    :0,

            completed:
                same
                    ?!!old.completed
                    :false
        }
    );

    var card=
        playerCard(anime);

    var item={
        url:url,

        quality:
            resolved.qualities||
            {},

        headers:
            resolved.headers||
            {},

        title:
            (
                anime.title||
                'AnimeHub'
            )+
            ' • Серия '+
            video.number+
            ' • '+
            (
                group.dubbing||
                group.player||
                ''
            ),

        season:1,

        episode:
            video.number,

        movie:
            card,

        card:
            card,

        source:
            'AnimeHub • '+
            String(
                group.source||
                group.player||
                ''
            )
            .toUpperCase(),

        animehub_id:
            String(
                anime.id
            ),

        animehub_episode:
            video.number,

        animehub_video_id:
            video.id,

        animehub_provider_key:
            group.key,

        animehub_provider:
            group.source,

        animehub_dubbing:
            group.dubbing,

        animehub_quality:
            quality,

        animehub_anime:
            compactItem(anime)
    };

    try{
        if(Lampa.Player.runas){
            Lampa.Player.runas(
                'lampa'
            );
        }

        Lampa.Player.play(
            item
        );

        if(Lampa.Player.playlist){
            Lampa.Player.playlist(
                [item]
            );
        }
    }
    catch(e){
        console.log(
            'AnimeHub player error',
            e
        );

        notify(
            'Не удалось запустить плеер Lampa'
        );

        try{
            Lampa.Controller.toggle(
                'content'
            );
        }
        catch(x){}
    }
}

function launchVideo(
    anime,
    group,
    video
){
    try{
        Lampa.Loading.start();
    }
    catch(e){}

    resolveVideo(
        video,

        function(stream){

            try{
                Lampa.Loading.stop();
            }
            catch(e){}

            var keys=
                qualityKeys(
                    stream.qualities||
                    {}
                );

            if(
                !keys.length&&
                stream.url
            ){
                stream.qualities={
                    auto:
                        stream.url
                };

                keys=[
                    'auto'
                ];
            }

            if(!keys.length){
                notify(
                    'Прямой поток не найден'
                );

                try{
                    Lampa.Controller.toggle(
                        'content'
                    );
                }
                catch(e){}

                return;
            }

            if(keys.length===1){
                startResolvedPlayback(
                    anime,
                    video,
                    group,
                    stream,
                    keys[0],

                    stream.qualities[
                        keys[0]
                    ]||
                    stream.url
                );

                return;
            }

            showPlaybackSelect({
                title:
                    'Качество • Серия '+
                    video.number,

                items:
                    keys.map(
                        function(key){
                            return {
                                title:
                                    key==='auto'
                                        ?'Авто'
                                        :key,

                                quality:
                                    key
                            };
                        }
                    ),

                onSelect:
                    function(item){

                        var playUrl=
                            stream.qualities[
                                item.quality
                            ]||
                            stream.url;

                        chainSelect(
                            function(){

                                startResolvedPlayback(
                                    anime,
                                    video,
                                    group,
                                    stream,
                                    item.quality,
                                    playUrl
                                );
                            }
                        );
                    }
            });
        },

        function(error){

            try{
                Lampa.Loading.stop();
            }
            catch(x){}

            notify(
                'Источник не открылся: '+
                clean(
                    error&&
                    error.message||
                    'ошибка'
                )
            );

            try{
                Lampa.Controller.toggle(
                    'content'
                );
            }
            catch(x){}
        }
    );
}

function chooseEpisode(
    anime,
    group,
    forcedEpisode
){
    var episodes=
        uniqueEpisodes(group);

    if(forcedEpisode!=null){
        var exact=
            findVideo(
                group,
                forcedEpisode
            );

        if(!exact){
            notify(
                'В этой озвучке серия недоступна'
            );

            try{
                Lampa.Controller.toggle(
                    'content'
                );
            }
            catch(e){}

            return;
        }

        launchVideo(
            anime,
            group,
            exact
        );

        return;
    }

    var state=
        watchState(anime);

    var selected=0;

    if(
        num(
            state.episode,
            0
        )>0
    ){
        episodes.some(
            function(video,index){

                if(
                    Math.abs(
                        num(
                            video.number,
                            0
                        )-
                        num(
                            state.episode,
                            0
                        )
                    )<
                    .0001
                ){
                    selected=index;
                    return true;
                }

                return false;
            }
        );
    }

    if(episodes.length===1){
        launchVideo(
            anime,
            group,
            episodes[0]
        );

        return;
    }

    showPlaybackSelect({
        title:
            'Выберите серию • '+
            group.dubbing,

        items:
            episodes.map(
                function(video){

                    var suffix=
                        Math.abs(
                            num(
                                video.number,
                                0
                            )-
                            num(
                                state.episode,
                                0
                            )
                        )<
                        .0001
                            ?(
                                state.completed
                                    ?' • просмотрено'
                                    :' • продолжить'
                            )
                            :'';

                    return {
                        title:
                            'Серия '+
                            video.number+
                            suffix,

                        video:
                            video
                    };
                }
            ),

        selected:
            selected,

        onSelect:
            function(item){

                chainSelect(
                    function(){

                        launchVideo(
                            anime,
                            group,
                            item.video
                        );
                    }
                );
            }
    });
}

function chooseVoice(
    anime,
    videos,
    forcedEpisode
){
    var groups=
        groupVideos(videos);

    if(forcedEpisode!=null){
        groups=
            groups.filter(
                function(group){

                    return !!findVideo(
                        group,
                        forcedEpisode
                    );
                }
            );
    }

    if(!groups.length){
        notify(
            'Для этой серии нет поддерживаемого источника'
        );

        try{
            Lampa.Controller.toggle(
                'content'
            );
        }
        catch(e){}

        return;
    }

    var state=
        watchState(anime);

    var selected=0;

    if(state.providerKey){
        groups.some(
            function(group,index){

                if(
                    group.key===
                    state.providerKey
                ){
                    selected=index;
                    return true;
                }

                return false;
            }
        );
    }

    if(groups.length===1){
        chooseEpisode(
            anime,
            groups[0],
            forcedEpisode
        );

        return;
    }

    showPlaybackSelect({
        title:
            forcedEpisode!=null
                ?(
                    'Озвучка • Серия '+
                    forcedEpisode
                )
                :'Выберите озвучку',

        items:
            groups.map(
                function(group){

                    return {
                        title:
                            group.dubbing,

                        subtitle:
                            String(
                                group.player||
                                group.source||
                                ''
                            )
                            .toUpperCase()+
                            ' • '+
                            uniqueEpisodes(
                                group
                            ).length+
                            ' сер.',

                        group:
                            group
                    };
                }
            ),

        selected:
            selected,

        onSelect:
            function(item){

                chainSelect(
                    function(){

                        chooseEpisode(
                            anime,
                            item.group,
                            forcedEpisode
                        );
                    }
                );
            }
    });
}

function watchAnime(
    anime,
    videos,
    forcedEpisode
){
    function go(list){
        chooseVoice(
            anime,
            list,
            forcedEpisode
        );
    }

    if(videos){
        go(videos);
    }
    else{
        loadVideos(
            anime,
            go,
            null,
            true
        );
    }
}

/* ============================================================
 * WATCH PROGRESS
 * ============================================================ */

function installPlaybackTracker(){
    var marker=
        NS+
        '_tracker';

    if(
        window[marker]||
        !Lampa.Player||
        !Lampa.Player.listener||
        !Lampa.PlayerVideo||
        !Lampa.PlayerVideo.listener
    ){
        return;
    }

    window[marker]=true;

    Lampa.Player.listener.follow(
        'start',

        function(data){

            if(
                !data||
                !data.animehub_id||
                !data.animehub_anime
            ){
                return;
            }

            var active=true;

            var anime=
                data.animehub_anime;

            var episode=
                num(
                    data.animehub_episode,
                    0
                );

            var lastSave=0;

            function canplay(){

                try{
                    Lampa.PlayerVideo.listener.remove(
                        'canplay',
                        canplay
                    );
                }
                catch(e){}

                var state=
                    watchState(anime);

                if(
                    !active||
                    Math.abs(
                        num(
                            state.episode,
                            0
                        )-
                        episode
                    )>
                    .0001||
                    state.completed||
                    num(
                        state.position,
                        0
                    )<
                    20
                ){
                    return;
                }

                try{
                    var player=
                        Lampa.PlayerVideo.video();

                    var position=
                        num(
                            state.position,
                            0
                        );

                    if(
                        player&&
                        position>20&&
                        (
                            !player.duration||
                            position<
                            player.duration-
                            35
                        )
                    ){
                        player.currentTime=
                            position;
                    }
                }
                catch(e){}
            }

            function timeupdate(e){

                if(
                    !active||
                    Date.now()-
                    lastSave<
                    10000
                ){
                    return;
                }

                lastSave=
                    Date.now();

                var current=
                    num(
                        e&&e.current,
                        0
                    );

                var duration=
                    num(
                        e&&e.duration,
                        0
                    );

                if(current<=0){
                    return;
                }

                saveWatchState(
                    anime,

                    {
                        episode:
                            episode,

                        videoId:
                            data.animehub_video_id||
                            '',

                        providerKey:
                            data.animehub_provider_key||
                            '',

                        provider:
                            data.animehub_provider||
                            '',

                        dubbing:
                            data.animehub_dubbing||
                            '',

                        quality:
                            data.animehub_quality||
                            '',

                        position:
                            current,

                        duration:
                            duration,

                        completed:
                            duration>0&&
                            current>=
                            duration-
                            25
                    }
                );
            }

            function ended(){
                if(!active){
                    return;
                }

                saveWatchState(
                    anime,

                    {
                        episode:
                            episode,

                        videoId:
                            data.animehub_video_id||
                            '',

                        providerKey:
                            data.animehub_provider_key||
                            '',

                        provider:
                            data.animehub_provider||
                            '',

                        dubbing:
                            data.animehub_dubbing||
                            '',

                        quality:
                            data.animehub_quality||
                            '',

                        position:0,
                        duration:0,
                        completed:true
                    }
                );
            }

            function destroy(){
                active=false;

                try{
                    Lampa.PlayerVideo.listener.remove(
                        'canplay',
                        canplay
                    );

                    Lampa.PlayerVideo.listener.remove(
                        'timeupdate',
                        timeupdate
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
                canplay
            );

            Lampa.PlayerVideo.listener.follow(
                'timeupdate',
                timeupdate
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

/* ============================================================
 * HOME
 * ============================================================ */

function HomeComponent(){
    var net=
        new Lampa.Reguest();

    var alive=false;

    var view=
        $('<div class="ah-view"></div>');

    var root=
        $('<div class="ah-page"></div>');

    var nav;

    function render(data){
        if(!alive){
            return;
        }

        root
            .empty()
            .append(
                topbar(
                    'home',
                    function(){}
                )
            );

        var anime=
            data.hero;

        if(anime){
            var hero=
                $('<div class="ah-hero"></div>');

            var bg=
                anime.background||
                anime.posterHero||
                anime.poster||
                '';

            if(bg){
                $('<img class="ah-hero-bg" alt="">')
                    .attr(
                        'src',
                        bg
                    )
                    .addClass(
                        anime.background
                            ?''
                            :'ah-poster-bg'
                    )
                    .appendTo(hero);
            }

            hero.append(
                '<div class="ah-hero-shade"></div>'
            );

            var content=
                $('<div class="ah-hero-content"></div>');

            content.append(
                '<div class="ah-kicker">'+
                    'Сейчас в центре внимания'+
                '</div>'+
                '<div class="ah-hero-title">'+
                    esc(
                        anime.title||
                        'AnimeHub'
                    )+
                '</div>'
            );

            if(
                anime.original&&
                anime.original!==
                anime.title
            ){
                content.append(
                    '<div class="ah-original-title">'+
                        esc(
                            anime.original
                        )+
                    '</div>'
                );
            }

            var meta=
                $('<div class="ah-meta"></div>');

            if(
                num(
                    anime.score,
                    0
                )>0
            ){
                meta.append(
                    '<span class="ah-chip score">'+
                        '★ '+
                        esc(
                            formatScore(
                                anime.score
                            )
                        )+
                    '</span>'
                );
            }

            if(anime.year){
                meta.append(
                    '<span class="ah-chip">'+
                        esc(
                            anime.year
                        )+
                    '</span>'
                );
            }

            meta.append(
                '<span class="ah-chip">'+
                    esc(
                        typeLabel(anime)
                    )+
                '</span>'
            );

            if(
                anime.episodes&&
                anime.episodes.aired
            ){
                meta.append(
                    '<span class="ah-chip">'+
                        esc(
                            episodeCount(
                                anime
                            )
                        )+
                        ' сер.'+
                    '</span>'
                );
            }

            if(
                anime.status&&
                anime.status.alias
            ){
                meta.append(
                    '<span class="ah-chip hot">'+
                        esc(
                            statusLabel(
                                anime.status.alias
                            )
                        )+
                    '</span>'
                );
            }

            content.append(
                meta,

                '<div class="ah-hero-desc">'+
                    esc(
                        clip(
                            cleanDescription(
                                anime.description
                            ),
                            330
                        )||
                        'Описание появится после открытия карточки.'
                    )+
                '</div>'
            );

            var actions=
                $('<div class="ah-actions"></div>');

            $(
                '<div class="ah-action primary selector">'+
                    '▶ Смотреть'+
                '</div>'
            )
            .on(
                'hover:enter',

                function(){
                    watchAnime(
                        anime
                    );
                }
            )
            .appendTo(actions);

            $(
                '<div class="ah-action selector">'+
                    'ⓘ Подробнее'+
                '</div>'
            )
            .on(
                'hover:enter',

                function(){
                    openDetail(
                        anime
                    );
                }
            )
            .appendTo(actions);

            content.append(actions);
            hero.append(content);
            root.append(hero);
        }

        continueShelf(root);

        shelf(
            root,
            'Сейчас выходит',
            data.ongoing||
            []
        );

        shelf(
            root,
            'Текущий сезон',
            data.season||
            []
        );

        shelf(
            root,
            'Новинки',
            data.latest||
            []
        );

        shelf(
            root,
            'Лучшее',
            data.top||
            []
        );

        shelf(
            root,
            'Анонсы',
            data.announcements||
            []
        );

        nav.bind();

        setTimeout(
            function(){

                var first=
                    root.find(
                        '.ah-action.selector'
                    )[0]||
                    root.find(
                        '.selector'
                    )[0];

                if(first){
                    nav.focus(first);
                }
            },

            50
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

        root.append(
            topbar(
                'home',
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

/* ============================================================
 * CATALOG
 * ============================================================ */

function CatalogComponent(object){
    var net=
        new Lampa.Reguest();

    var alive=false;

    var view=
        $('<div class="ah-view"></div>');

    var root=
        $('<div class="ah-page"></div>');

    var nav;

    var mode=
        object.ah_mode||
        'all';

    var value=
        object.ah_value||
        '';

    var title=
        object.ah_title||
        'Каталог';

    var page=
        intv(
            object.ah_page,
            1
        );

    function filterButton(
        side,
        key,
        label,
        action
    ){
        var button=
            $('<div class="ah-filter selector"></div>')
            .text(label);

        if(mode===key){
            button.addClass(
                'selected'
            );
        }

        button.on(
            'hover:enter',
            action
        );

        side.append(button);
    }

    function render(data){
        if(!alive){
            return;
        }

        root
            .empty()
            .append(
                topbar(
                    mode==='search'
                        ?'search'
                        :'catalog'
                )
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
                        data.items||
                        []
                    ).length+
                    ' тайтлов'+
                '</div>'+
            '</div>'
        );

        var layout=
            $('<div class="ah-catalog-layout"></div>');

        var side=
            $('<div class="ah-filter-sidebar"></div>');

        filterButton(
            side,
            'all',
            'Все аниме',

            function(){
                openCatalog(
                    'all',
                    '',
                    'Каталог',
                    1
                );
            }
        );

        filterButton(
            side,
            'ongoing',
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

        filterButton(
            side,
            'popular',
            'Популярные',

            function(){
                openCatalog(
                    'popular',
                    '',
                    'Популярные',
                    1
                );
            }
        );

        filterButton(
            side,
            'top',
            'Топ-100',

            function(){
                openCatalog(
                    'top',
                    '',
                    'Топ-100',
                    1
                );
            }
        );

        filterButton(
            side,
            'latest',
            'Новинки',

            function(){
                openCatalog(
                    'latest',
                    '',
                    'Новинки',
                    1
                );
            }
        );

        filterButton(
            side,
            'announcements',
            'Анонсы',

            function(){
                openCatalog(
                    'announcements',
                    '',
                    'Анонсы',
                    1
                );
            }
        );

        filterButton(
            side,
            'genre',
            'Жанры',
            chooseGenre
        );

        filterButton(
            side,
            'year',
            'Годы',
            chooseYear
        );

        filterButton(
            side,
            'type',
            'Тип',
            chooseType
        );

        var main=
            $('<div class="ah-catalog-main"></div>');

        var grid=
            $('<div class="ah-grid"></div>');

        (
            data.items||
            []
        )
        .forEach(function(anime){
            grid.append(
                posterCard(anime)
            );
        });

        main.append(grid);

        var pages=
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
            .appendTo(pages);
        }

        if(data.hasNext){
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
            .appendTo(pages);
        }

        main.append(pages);

        layout.append(
            side,
            main
        );

        root.append(layout);

        nav.bind();

        setTimeout(
            function(){

                var first=
                    grid.find(
                        '.selector'
                    )[0]||
                    side.find(
                        '.selector'
                    )[0]||
                    root.find(
                        '.selector'
                    )[0];

                if(first){
                    nav.focus(first);
                }
            },

            40
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

        root.append(
            topbar(
                mode==='search'
                    ?'search'
                    :'catalog'
            ),

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

/* ============================================================
 * DETAIL
 * ============================================================ */

function DetailComponent(object){
    var net=
        new Lampa.Reguest();

    var alive=false;

    var view=
        $('<div class="ah-view"></div>');

    var root=
        $('<div class="ah-page"></div>');

    var nav;

    var initial=
        object.ah_item||
        {};

    var anime=null;
    var videos=null;
    var episodeBox=null;
    var watchButton=null;
    var recBox=null;

    function infoPanel(a){
        var panel=
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
                panel.append(
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
            a.studios&&
            a.studios.length
        ){
            row(
                'Студия',

                a.studios
                    .slice(0,2)
                    .map(
                        function(x){
                            return x.title;
                        }
                    )
                    .join(', ')
            );
        }

        if(
            a.creators&&
            a.creators.length
        ){
            row(
                'Режиссёр',

                a.creators
                    .slice(0,2)
                    .map(
                        function(x){
                            return x.title;
                        }
                    )
                    .join(', ')
            );
        }

        row(
            'Тип',
            typeLabel(a)
        );

        row(
            'Статус',

            statusLabel(
                a.status&&
                a.status.alias
            )
        );

        row(
            'Эпизоды',
            episodeCount(a)
        );

        if(a.duration){
            row(
                'Длительность',
                a.duration+
                ' мин.'
            );
        }

        if(
            a.age&&
            a.age.title
        ){
            row(
                'Возраст',
                a.age.title
            );
        }

        if(
            a.episodes&&
            a.episodes.nextDate
        ){
            row(
                'Следующая',

                formatDate(
                    a.episodes.nextDate,
                    true
                )
            );
        }

        return panel;
    }

    function refreshWatch(){
        if(
            !watchButton||
            !anime
        ){
            return;
        }

        var state=
            watchState(anime);

        var episode=
            num(
                state.episode,
                0
            );

        watchButton.text(
            episode&&
            !state.completed
                ?(
                    '▶ Продолжить • серия '+
                    episode
                )
                :episode&&
                state.completed
                    ?'▶ Смотреть дальше'
                    :'▶ Смотреть'
        );
    }

    function screenshotForEpisode(
        a,
        episode,
        index
    ){
        var screenshots=
            a.screenshots||
            [];

        var exact=null;

        screenshots.some(
            function(s){

                if(
                    Math.abs(
                        num(
                            s.episode,
                            0
                        )-
                        num(
                            episode,
                            0
                        )
                    )<
                    .0001
                ){
                    exact=s;
                    return true;
                }

                return false;
            }
        );

        var pick=
            exact||
            (
                screenshots.length
                    ?screenshots[
                        index%
                        screenshots.length
                    ]
                    :null
            );

        return pick
            ?(
                pick.small||
                pick.full
            )
            :(
                a.background||
                a.posterHero||
                a.poster||
                ''
            );
    }

    function renderEpisodes(list){
        videos=
            list||
            [];

        var episodes=
            availableEpisodes(
                videos
            );

        if(!episodes.length){
            episodeBox.html(
                '<div class="ah-placeholder">'+
                    'Нет поддерживаемых прямых источников для этого тайтла.'+
                '</div>'
            );

            return;
        }

        var state=
            watchState(anime);

        var current=
            num(
                state.episode,
                0
            );

        var currentIndex=
            episodes.indexOf(
                current
            );

        var start=0;
        var max=18;

        if(
            episodes.length>max&&
            currentIndex>=0
        ){
            start=
                Math.max(
                    0,
                    Math.min(
                        episodes.length-
                        max,
                        currentIndex-
                        6
                    )
                );
        }

        var subset=
            episodes.slice(
                start,
                start+
                max
            );

        var label=
            episodes.length>max
                ?(
                    start+
                    1
                )+
                '–'+
                (
                    start+
                    subset.length
                )+
                ' из '+
                episodes.length
                :String(
                    episodes.length
                );

        var head=
            $(
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

        var all=
            $(
                '<div class="ah-all-episodes selector">'+
                    'Все серии ›'+
                '</div>'
            );

        all.on(
            'hover:enter',

            function(){

                showSelect(
                    'Эпизоды',

                    episodes.map(
                        function(ep){

                            var suffix=
                                Math.abs(
                                    num(
                                        state.episode,
                                        0
                                    )-
                                    ep
                                )<
                                .0001
                                    ?(
                                        state.completed
                                            ?' • просмотрено'
                                            :' • продолжить'
                                    )
                                    :'';

                            return {
                                title:
                                    'Серия '+
                                    ep+
                                    suffix,

                                episode:
                                    ep
                            };
                        }
                    ),

                    function(item){

                        watchAnime(
                            anime,
                            videos,
                            item.episode
                        );
                    }
                );
            }
        );

        head.append(all);

        var track=
            $('<div class="ah-episode-track"></div>');

        subset.forEach(
            function(ep,index){

                var groups=
                    groupVideos(
                        videos
                    )
                    .filter(
                        function(group){
                            return !!findVideo(
                                group,
                                ep
                            );
                        }
                    );

                var card=
                    $('<div class="ah-episode-card selector"></div>');

                if(
                    Math.abs(
                        current-
                        ep
                    )<
                    .0001
                ){
                    card.addClass(
                        'current'
                    );
                }

                var image=
                    screenshotForEpisode(
                        anime,
                        ep,
                        start+
                        index
                    );

                if(image){
                    $('<img alt="">')
                        .attr({
                            src:image,
                            loading:'lazy'
                        })
                        .appendTo(card);
                }

                card.append(
                    '<div class="ah-episode-shade"></div>'+
                    '<div class="ah-episode-number">'+
                        esc(ep)+
                    '</div>'+
                    '<div class="ah-episode-copy">'+
                        '<div class="ah-episode-name">'+
                            'Серия '+
                            esc(ep)+
                        '</div>'+
                        '<div class="ah-episode-meta">'+
                            esc(
                                groups.length+
                                ' источн.'+
                                (
                                    groups[0]
                                        ?' • '+
                                        groups[0].dubbing
                                        :''
                                )
                            )+
                        '</div>'+
                    '</div>'
                );

                if(
                    Math.abs(
                        current-
                        ep
                    )<
                    .0001&&
                    state.completed
                ){
                    card.append(
                        '<div class="ah-episode-progress">'+
                            '<span style="width:100%"></span>'+
                        '</div>'
                    );
                }
                else if(
                    Math.abs(
                        current-
                        ep
                    )<
                    .0001&&
                    num(
                        state.duration,
                        0
                    )>0&&
                    num(
                        state.position,
                        0
                    )>0
                ){
                    var progress=
                        Math.max(
                            0,
                            Math.min(
                                100,
                                Math.round(
                                    num(
                                        state.position,
                                        0
                                    )/
                                    num(
                                        state.duration,
                                        1
                                    )*
                                    100
                                )
                            )
                        );

                    card.append(
                        '<div class="ah-episode-progress">'+
                            '<span style="width:'+
                                progress+
                                '%"></span>'+
                        '</div>'
                    );
                }

                card.on(
                    'hover:enter',

                    function(){

                        watchAnime(
                            anime,
                            videos,
                            ep
                        );
                    }
                );

                track.append(card);
            }
        );

        episodeBox
            .empty()
            .append(
                head,
                track
            );

        nav.bind();

        refreshWatch();
    }

    function loadInline(){
        episodeBox.html(
            '<div class="ah-episodes-head">'+
                '<div class="ah-episodes-title">'+
                    'Эпизоды'+
                '</div>'+
            '</div>'+
            '<div class="ah-placeholder">'+
                '<div class="ah-mini-spinner"></div>'+
                'Загружаем серии и озвучки…'+
            '</div>'
        );

        loadVideos(
            anime,

            function(list){
                if(alive){
                    renderEpisodes(
                        list
                    );
                }
            },

            function(){
                if(alive){
                    episodeBox.html(
                        '<div class="ah-placeholder">'+
                            'Не удалось загрузить серии.'+
                        '</div>'
                    );
                }
            },

            false
        );
    }

    function loadRecommendations(){
        var request=
            new Lampa.Reguest();

        requestCached(
            request,

            'rec:'+
            anime.id,

            600000,

            workerUrl(
                'recommendations',
                {
                    id:
                        anime.id
                }
            ),

            function(data){

                if(!alive){
                    return;
                }

                var items=
                    data.items||
                    [];

                if(items.length){
                    recBox.empty();

                    shelf(
                        recBox,
                        'Похожие аниме',
                        items
                    );

                    nav.bind();
                }

                try{
                    request.clear();
                }
                catch(e){}
            },

            function(){
                try{
                    request.clear();
                }
                catch(e){}
            }
        );
    }

    function render(a){
        if(!alive){
            return;
        }

        anime=a;
        videos=null;

        saveRecent(a);

        root
            .empty()
            .append(
                topbar('')
            );

        var hero=
            $('<div class="ah-detail-hero"></div>');

        var background=
            a.background||
            a.posterHero||
            a.poster||
            '';

        if(background){
            $('<img class="ah-detail-bg" alt="">')
                .attr(
                    'src',
                    background
                )
                .addClass(
                    a.background
                        ?''
                        :'ah-poster-bg'
                )
                .appendTo(hero);
        }

        hero.append(
            '<div class="ah-detail-shade"></div>'
        );

        var content=
            $('<div class="ah-detail-content"></div>');

        var poster=
            $('<div class="ah-detail-poster"></div>');

        putImage(
            poster,
            a.posterDetail||
            a.poster,
            a.title
        );

        var copy=
            $('<div class="ah-detail-copy"></div>');

        copy.append(
            '<div class="ah-kicker">'+
                'AnimeHub • YummyAnime'+
            '</div>'+
            '<div class="ah-detail-title">'+
                esc(
                    a.title||
                    'Anime'
                )+
            '</div>'
        );

        if(
            a.original&&
            a.original!==
            a.title
        ){
            copy.append(
                '<div class="ah-original-title">'+
                    esc(
                        a.original
                    )+
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
                    esc(
                        a.year
                    )+
                '</span>'
            );
        }

        meta.append(
            '<span class="ah-chip">'+
                esc(
                    typeLabel(a)
                )+
            '</span>'
        );

        if(
            a.status&&
            a.status.alias
        ){
            meta.append(
                '<span class="ah-chip hot">'+
                    esc(
                        statusLabel(
                            a.status.alias
                        )
                    )+
                '</span>'
            );
        }

        if(
            a.age&&
            a.age.title
        ){
            meta.append(
                '<span class="ah-chip">'+
                    esc(
                        a.age.title
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
                                    return x.title;
                                }
                            )
                            .join(', ')
                    )+
                '</div>'
            );
        }

        var genres=
            $('<div class="ah-meta"></div>');

        (
            a.genres||
            []
        )
        .slice(
            0,
            7
        )
        .forEach(function(g){

            genres.append(
                '<span class="ah-chip">'+
                    esc(
                        g.title
                    )+
                '</span>'
            );
        });

        copy.append(genres);

        var description=
            cleanDescription(
                a.description||
                ''
            );

        copy.append(
            '<div class="ah-detail-desc">'+
                esc(
                    description
                        ?clip(
                            description,
                            650
                        )
                        :'Описание пока отсутствует.'
                )+
            '</div>'
        );

        var actions=
            $('<div class="ah-actions"></div>');

        watchButton=
            $('<div class="ah-action primary selector"></div>')
            .on(
                'hover:enter',

                function(){
                    watchAnime(
                        anime,
                        videos
                    );
                }
            );

        var favourite=
            $('<div class="ah-action selector"></div>');

        function refreshFavourite(){
            favourite.text(
                isFavorite(anime)
                    ?'★ В избранном'
                    :'☆ В избранное'
            );
        }

        refreshFavourite();

        favourite.on(
            'hover:enter',

            function(){

                notify(
                    toggleFavorite(
                        anime
                    )
                        ?'Добавлено в избранное'
                        :'Удалено из избранного'
                );

                refreshFavourite();
            }
        );

        actions.append(
            watchButton,
            favourite
        );

        copy.append(actions);

        refreshWatch();

        content.append(
            poster,
            copy,
            infoPanel(a)
        );

        hero.append(content);

        root.append(hero);

        episodeBox=
            $('<div class="ah-episodes-section"></div>');

        root.append(episodeBox);

        if(
            a.screenshots&&
            a.screenshots.length
        ){
            root.append(
                '<div class="ah-block-title">'+
                    'Кадры'+
                '</div>'
            );

            var screenshots=
                $('<div class="ah-screens"></div>');

            a.screenshots
                .slice(
                    0,
                    8
                )
                .forEach(
                    function(s){

                        var box=
                            $('<div class="ah-screen"></div>');

                        putImage(
                            box,
                            s.full||
                            s.small,
                            'Кадр'
                        );

                        screenshots.append(box);
                    }
                );

            root.append(
                screenshots
            );
        }

        if(
            description.length>
            650
        ){
            root.append(
                '<div class="ah-block-title">'+
                    'Описание'+
                '</div>'+
                '<div class="ah-description-panel">'+
                    esc(description)+
                '</div>'
            );
        }

        if(
            a.viewingOrder&&
            a.viewingOrder.length
        ){
            shelf(
                root,
                'Франшиза / порядок просмотра',
                a.viewingOrder
            );
        }

        recBox=
            $('<div></div>');

        root.append(recBox);

        nav.bind();

        setTimeout(
            function(){

                var first=
                    root.find(
                        '.ah-action.selector'
                    )[0]||
                    root.find(
                        '.selector'
                    )[0];

                if(first){
                    nav.focus(first);
                }

                loadInline();
                loadRecommendations();
            },

            55
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

        root.append(
            topbar(''),

            loaderHtml(
                'Загрузка карточки…'
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
                    id:
                        initial.id
                }
            ),

            function(data){
                render(
                    data.anime
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

            if(videos){
                renderEpisodes(
                    videos
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

/* ============================================================
 * SCHEDULE
 * ============================================================ */

function ScheduleComponent(){
    var net=
        new Lampa.Reguest();

    var alive=false;

    var view=
        $('<div class="ah-view"></div>');

    var root=
        $('<div class="ah-page"></div>');

    var nav;

    function dayKey(ts){
        if(!ts){
            return 'Без даты';
        }

        try{
            return new Date(
                ts*
                1000
            )
            .toLocaleDateString(
                'ru-RU',

                {
                    weekday:'long',
                    day:'numeric',
                    month:'long'
                }
            );
        }
        catch(e){
            return 'Без даты';
        }
    }

    function render(data){
        if(!alive){
            return;
        }

        root
            .empty()
            .append(
                topbar(
                    'schedule'
                )
            );

        root.append(
            '<div class="ah-section-head">'+
                '<div class="ah-page-title">'+
                    'Расписание'+
                '</div>'+
                '<div class="ah-page-sub">'+
                    'Ближайшие выходы серий'+
                '</div>'+
            '</div>'
        );

        var groups={};

        (
            data.items||
            []
        )
        .forEach(
            function(a){

                var key=
                    dayKey(
                        a.episodes&&
                        a.episodes.nextDate
                    );

                if(!groups[key]){
                    groups[key]=[];
                }

                groups[key]
                    .push(a);
            }
        );

        Object.keys(groups)
            .forEach(
                function(day){

                    var section=
                        $(
                            '<div class="ah-schedule-day">'+
                                '<div class="ah-schedule-day-title">'+
                                    esc(day)+
                                '</div>'+
                            '</div>'
                        );

                    var grid=
                        $('<div class="ah-schedule-grid"></div>');

                    groups[day]
                        .forEach(
                            function(a){

                                var card=
                                    $('<div class="ah-schedule-card selector"></div>');

                                var bg=
                                    a.background||
                                    a.posterHero||
                                    a.poster||
                                    '';

                                if(bg){
                                    $('<img alt="">')
                                        .attr({
                                            src:bg,
                                            loading:'lazy'
                                        })
                                        .appendTo(card);
                                }

                                card.append(
                                    '<div class="ah-schedule-copy">'+
                                        '<div class="ah-schedule-title">'+
                                            esc(
                                                a.title
                                            )+
                                        '</div>'+
                                        '<div class="ah-schedule-meta">'+
                                            esc(
                                                formatDate(
                                                    a.episodes&&
                                                    a.episodes.nextDate,
                                                    true
                                                )
                                            )+
                                            ' • серия '+
                                            esc(
                                                (
                                                    a.episodes&&
                                                    a.episodes.aired
                                                )
                                                    ?intv(
                                                        a.episodes.aired,
                                                        0
                                                    )+
                                                    1
                                                    :'—'
                                            )+
                                        '</div>'+
                                    '</div>'
                                );

                                card.on(
                                    'hover:enter',

                                    function(){
                                        openDetail(a);
                                    }
                                );

                                grid.append(card);
                            }
                        );

                    root.append(
                        section.append(
                            grid
                        )
                    );
                }
            );

        if(
            !Object.keys(groups).length
        ){
            root.append(
                '<div class="ah-empty">'+
                    'Расписание пока пусто.'+
                '</div>'
            );
        }

        nav.bind();

        setTimeout(
            function(){

                var first=
                    root.find(
                        '.ah-schedule-card'
                    )[0]||
                    root.find(
                        '.selector'
                    )[0];

                if(first){
                    nav.focus(first);
                }
            },

            40
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

        root.append(
            topbar(
                'schedule'
            ),

            loaderHtml(
                'Загрузка расписания…'
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
            'schedule',
            900000,
            workerUrl(
                'schedule'
            ),
            render,

            function(){
                root.html(
                    '<div class="ah-empty">'+
                        'Не удалось загрузить расписание'+
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

/* ============================================================
 * FAVORITES
 * ============================================================ */

function FavoritesComponent(){
    var alive=false;

    var view=
        $('<div class="ah-view"></div>');

    var root=
        $('<div class="ah-page"></div>');

    var nav;

    function render(){
        if(!alive){
            return;
        }

        root
            .empty()
            .append(
                topbar(
                    'favorites'
                )
            );

        var items=
            storedList(
                FAVORITES_KEY
            );

        root.append(
            '<div class="ah-section-head">'+
                '<div class="ah-page-title">'+
                    'Избранное'+
                '</div>'+
                '<div class="ah-page-sub">'+
                    'Локально на этом устройстве • '+
                    items.length+
                '</div>'+
            '</div>'
        );

        if(!items.length){
            root.append(
                '<div class="ah-empty">'+
                    'Добавьте аниме в избранное из карточки.'+
                '</div>'
            );
        }
        else{
            var grid=
                $('<div class="ah-grid"></div>');

            items.forEach(
                function(a){
                    grid.append(
                        posterCard(a)
                    );
                }
            );

            root.append(grid);
        }

        nav.bind();

        setTimeout(
            function(){

                var first=
                    root.find(
                        '.selector'
                    )[0];

                if(first){
                    nav.focus(first);
                }
            },

            35
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

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

        render();

        return view;
    };

    this.start=function(){
        if(
            Lampa.Activity.active().activity===
            this.activity
        ){
            render();

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
        view.remove();
    };
}

/* ============================================================
 * MENU + INIT
 * ============================================================ */

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

    var button=
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

    button.on(
        'hover:enter',
        openHome
    );

    $('.menu .menu__list')
        .eq(0)
        .append(button);
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

        Lampa.Component.add(
            SCHEDULE,
            ScheduleComponent
        );

        Lampa.Component.add(
            FAVORITES,
            FavoritesComponent
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
