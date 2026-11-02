(function(){
'use strict';

/*
 * AnimeHub V1.2.0 TV Fast
 * YummyAnime catalogue + native Lampa playback.
 *
 * TV performance changes:
 * - 6 cards per home rail
 * - 10 cards per catalogue page
 * - shelf cards use portrait poster only (never large screenshot/backdrop)
 * - /videos loads only after Watch / Source / Load Episodes
 * - recommendations load only after explicit user action
 * - native Lampa Navigator instead of geometry-scanning every arrow press
 * - bounded memory caches
 *
 * Playback UX:
 * - Continue resumes last used voice/source directly
 * - first Watch asks for voice/source when multiple are available
 * - "Озвучка / источник" always opens the source list
 * - episode cards ask for source when multiple are available
 */

var VERSION='1.2.0';
var NS='animehub_v120';

var HOME=NS+'_home';
var CATALOG=NS+'_catalog';
var DETAIL=NS+'_detail';
var SCHEDULE=NS+'_schedule';
var FAVORITES=NS+'_favorites';

var FAVORITES_KEY='animehub_v010_favorites';
var RECENT_KEY='animehub_v010_recent';
var WATCH_KEY='animehub_v020_watch';

var WORKER='https://animehub-lampa.kalewse69.workers.dev/';

var CACHE_MAX=28;
var VIDEO_CACHE_MAX=5;

var cache={};
var cacheOrder=[];

var videoCache={};
var videoOrder=[];
var videoInflight={};

var genresCache=null;

/* ============================================================
 * BASICS
 * ============================================================ */

function notify(text){
    try{
        Lampa.Noty.show(text);
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

    if(
        !n||
        v.length<=n
    ){
        return v;
    }

    return v
        .slice(
            0,
            n
        )
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

function score(v){
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

        var o={
            day:'numeric',
            month:'short'
        };

        if(withTime){
            o.hour='2-digit';
            o.minute='2-digit';
        }

        return d.toLocaleString(
            'ru-RU',
            o
        );
    }
    catch(e){
        return '';
    }
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

    params=
        params||
        {};

    Object.keys(
        params
    )
    .forEach(
        function(k){
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
        }
    );

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
                ?'?'+
                q.join('&')
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

function remember(
    key,
    data
){
    if(cache[key]){
        cacheOrder=
            cacheOrder.filter(
                function(x){
                    return x!==key;
                }
            );
    }

    cache[key]={
        at:Date.now(),
        data:data
    };

    cacheOrder.push(key);

    while(
        cacheOrder.length>
        CACHE_MAX
    ){
        delete cache[
            cacheOrder.shift()
        ];
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
                fail(
                    e||
                    {}
                );
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
    var hit=
        cache[key];

    if(
        hit&&
        Date.now()-
        hit.at<
        age
    ){
        setTimeout(
            function(){
                ok(
                    hit.data
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
            remember(
                key,
                data
            );

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
        esc(
            cls||
            ''
        )+
        '" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">'+

        '<defs>'+
            '<linearGradient id="ah120g" x1="0" y1="0" x2="1" y2="1">'+
                '<stop offset="0" stop-color="#a970ff"/>'+
                '<stop offset="1" stop-color="#ed5fd4"/>'+
            '</linearGradient>'+
        '</defs>'+

        '<path fill="url(#ah120g)" d="'+
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

function loaderHtml(text){
    return (
        '<div class="ah-loader">'+
            '<div class="ah-loader-ring"></div>'+
            toriiSvg(
                'ah-loader-logo'
            )+
            '<div>'+
                esc(
                    text||
                    'Загрузка…'
                )+
            '</div>'+
        '</div>'
    );
}

/* ============================================================
 * STORAGE
 * ============================================================ */

function stored(
    key,
    def
){
    try{
        return Lampa.Storage.get(
            key,
            def
        );
    }
    catch(e){
        return def;
    }
}

function storedList(key){
    var v=
        stored(
            key,
            []
        );

    return Array.isArray(v)
        ?v
        :[];
}

function setStored(
    key,
    v
){
    try{
        Lampa.Storage.set(
            key,
            v
        );
    }
    catch(e){}
}

function compactAnime(a){
    return {
        source:'yummy',

        id:
            String(
                a&&
                a.id||
                ''
            ),

        title:
            a&&
            a.title||
            'Anime',

        original:
            a&&
            a.original||
            '',

        poster:
            a&&
            a.poster||
            '',

        posterHero:
            a&&
            a.posterHero||
            '',

        background:
            a&&
            a.background||
            '',

        score:
            a&&
            a.score||
            0,

        year:
            a&&
            a.year||
            null,

        type:
            a&&
            a.type||
            {},

        status:
            a&&
            a.status||
            {},

        episodes:
            a&&
            a.episodes||
            {},

        duration:
            a&&
            a.duration||
            0
    };
}

function sameAnime(a,b){
    if(
        !a||
        !b
    ){
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
    .some(
        function(x){
            return sameAnime(
                x,
                a
            );
        }
    );
}

function toggleFavorite(a){
    var list=
        storedList(
            FAVORITES_KEY
        );

    var found=false;
    var out=[];

    list.forEach(
        function(x){
            if(
                sameAnime(
                    x,
                    a
                )
            ){
                found=true;
            }
            else if(
                out.length<
                39
            ){
                out.push(x);
            }
        }
    );

    if(!found){
        out.unshift(
            compactAnime(a)
        );
    }

    setStored(
        FAVORITES_KEY,
        out
    );

    return !found;
}

function saveRecent(a){
    if(
        !a||
        !a.id
    ){
        return;
    }

    var out=[
        compactAnime(a)
    ];

    storedList(
        RECENT_KEY
    )
    .forEach(
        function(x){
            if(
                out.length<
                18&&
                !sameAnime(
                    x,
                    a
                )
            ){
                out.push(x);
            }
        }
    );

    setStored(
        RECENT_KEY,
        out
    );
}

function watchStore(){
    var v=
        stored(
            WATCH_KEY,
            {}
        );

    return (
        v&&
        typeof v==='object'&&
        !Array.isArray(v)
    )
        ?v
        :{};
}

function watchKey(a){
    return (
        'y:'+
        String(
            a&&
            a.id||
            ''
        )
    );
}

function watchState(a){
    return (
        watchStore()[
            watchKey(a)
        ]||
        {}
    );
}

function saveWatchState(
    a,
    patch
){
    if(
        !a||
        !a.id
    ){
        return;
    }

    var store=
        watchStore();

    var key=
        watchKey(a);

    var state=
        store[key]||
        {};

    Object.keys(
        patch||
        {}
    )
    .forEach(
        function(k){
            state[k]=
                patch[k];
        }
    );

    state.source=
        'yummy';

    state.anime=
        compactAnime(a);

    state.updatedAt=
        Date.now();

    store[key]=
        state;

    setStored(
        WATCH_KEY,
        store
    );
}

function continueStates(){
    var store=
        watchStore();

    return Object.keys(store)
        .map(
            function(k){
                return store[k];
            }
        )
        .filter(
            function(x){
                return (
                    x&&
                    x.source===
                    'yummy'&&
                    x.anime&&
                    x.anime.id&&
                    num(
                        x.episode,
                        0
                    )>
                    0
                );
            }
        )
        .sort(
            function(a,b){
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
            }
        )
        .slice(
            0,
            6
        );
}

/* ============================================================
 * STYLE
 * ============================================================ */

function injectStyle(){
    if(
        $('#animehub-v120-style')
            .length
    ){
        return;
    }

    $('head').append(`
<style id="animehub-v120-style">
:root{
    --ah-bg:#070914;
    --ah-panel:#111527;
    --ah-text:#faf8ff;
    --ah-muted:#aaa7bb;
    --ah-purple:#8c58f8;
    --ah-pink:#e65ed1
}

.ah-view{
    height:calc(100vh - 6.1em);
    overflow-y:auto;
    overflow-x:hidden;
    color:var(--ah-text);
    background:linear-gradient(180deg,#090c19,#060812 72%);
    box-sizing:border-box
}

.ah-view::-webkit-scrollbar,
.ah-row::-webkit-scrollbar,
.ah-eprow::-webkit-scrollbar,
.ah-shots::-webkit-scrollbar{
    width:0;
    height:0
}

.ah-page{
    padding:0 1.7em 4em;
    box-sizing:border-box;
    min-height:100%
}

.ah-top{
    height:4.15em;
    display:flex;
    align-items:center;
    gap:.85em
}

.ah-brand{
    display:flex;
    align-items:center;
    gap:.42em;
    font-size:1.42em;
    font-weight:900;
    padding-right:.9em;
    border-right:1px solid rgba(255,255,255,.13);
    white-space:nowrap
}

.ah-logo{
    width:1.85em;
    height:1.85em
}

.ah-name{
    background:linear-gradient(90deg,#fff,#dc8cff);
    -webkit-background-clip:text;
    color:transparent
}

.ah-nav{
    display:flex;
    gap:.15em;
    overflow:hidden
}

.ah-navbtn{
    padding:.53em .67em;
    border-radius:.52em;
    white-space:nowrap
}

.ah-navbtn.active{
    background:rgba(131,75,235,.22)
}

.ah-navbtn.focus{
    background:#8754e9;
    color:#fff
}

.ah-hero{
    height:38vh;
    min-height:20.5em;
    max-height:27em;
    position:relative;
    overflow:hidden;
    border-radius:.82em;
    margin-bottom:1.15em;
    isolation:isolate;
    background:#111629
}

.ah-bg{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    z-index:-5
}

.ah-shade{
    position:absolute;
    inset:0;
    z-index:-4;
    background:
        linear-gradient(
            90deg,
            rgba(4,6,15,.99) 0%,
            rgba(4,6,15,.95) 29%,
            rgba(4,6,15,.69) 53%,
            rgba(4,6,15,.19) 78%,
            rgba(4,6,15,.05) 100%
        ),
        linear-gradient(
            0deg,
            rgba(4,6,15,.86),
            transparent 60%
        )
}

.ah-hero-copy{
    position:absolute;
    left:3.1%;
    top:7%;
    bottom:7%;
    width:54%;
    display:flex;
    flex-direction:column;
    justify-content:center
}

.ah-kicker{
    color:#df8cff;
    font-size:.7em;
    font-weight:800;
    letter-spacing:.09em;
    text-transform:uppercase;
    margin-bottom:.45em
}

.ah-title{
    font-size:2.65em;
    font-weight:900;
    line-height:1.02;
    text-shadow:0 2px 6px #000
}

.ah-original{
    color:#b9b5c6;
    margin:.2em 0 .5em
}

.ah-meta{
    display:flex;
    flex-wrap:wrap;
    gap:.35em;
    margin:.32em 0
}

.ah-chip{
    font-size:.74em;
    padding:.24em .49em;
    border-radius:999px;
    background:rgba(255,255,255,.09);
    border:1px solid rgba(255,255,255,.11)
}

.ah-score{
    color:#ffd76a
}

.ah-description{
    font-size:.92em;
    line-height:1.46;
    color:#f5f3fa;
    max-width:46em;
    margin:.5em 0 .8em;
    text-shadow:0 2px 4px #000
}

.ah-actions{
    display:flex;
    gap:.5em;
    flex-wrap:wrap
}

.ah-button,
.ah-filter,
.ah-pagebtn,
.ah-all,
.ah-lazybtn{
    padding:.62em .84em;
    border-radius:.53em;
    background:rgba(255,255,255,.10);
    border:1px solid rgba(255,255,255,.12);
    font-weight:750
}

.ah-button.primary{
    background:linear-gradient(
        135deg,
        #965cf8,
        #7444e9 65%,
        #d84fd6
    )
}

.ah-button.focus,
.ah-filter.focus,
.ah-pagebtn.focus,
.ah-all.focus,
.ah-lazybtn.focus{
    background:#fff;
    color:#090b14
}

.ah-shelf{
    margin-bottom:1.08em
}

.ah-shelf-title,
.ah-block-title,
.ah-eptitle{
    font-size:1.18em;
    font-weight:850;
    margin:0 0 .46em
}

.ah-row,
.ah-eprow,
.ah-shots{
    display:flex;
    gap:.62em;
    overflow-x:auto;
    overflow-y:hidden;
    padding:.18em .14em .56em;
    scroll-behavior:auto
}

.ah-wide{
    position:relative;
    flex:0 0 11.4em;
    height:6.3em;
    border-radius:.58em;
    overflow:hidden;
    background:#111628;
    border:1px solid rgba(255,255,255,.07)
}

.ah-wide img{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover
}

.ah-cardshade{
    position:absolute;
    inset:0;
    background:linear-gradient(
        0deg,
        rgba(5,7,16,.99),
        rgba(5,7,16,.17) 76%
    )
}

.ah-wide-copy{
    position:absolute;
    left:.5em;
    right:.5em;
    bottom:.4em
}

.ah-wide-title{
    font-size:.78em;
    font-weight:780;
    line-height:1.12;
    max-height:2.25em;
    overflow:hidden
}

.ah-smallmeta{
    font-size:.59em;
    color:#c9c6d3;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-badge{
    position:absolute;
    left:.38em;
    top:.35em;
    font-size:.56em;
    font-weight:850;
    padding:.18em .34em;
    border-radius:.32em;
    background:#7d49e9
}

.ah-progress{
    position:absolute;
    left:0;
    right:0;
    bottom:0;
    height:.17em;
    background:rgba(255,255,255,.11)
}

.ah-progress span{
    display:block;
    height:100%;
    background:linear-gradient(
        90deg,
        #8d59ff,
        #e85fd0
    )
}

.ah-wide.focus,
.ah-poster.focus,
.ah-ep.focus,
.ah-sch.focus{
    border-color:#dab8ff;
    outline:2px solid rgba(158,100,255,.36);
    z-index:4
}

.ah-head{
    padding:.42em 0 .8em
}

.ah-page-title{
    font-size:1.85em;
    font-weight:900
}

.ah-page-sub{
    color:#9996aa;
    font-size:.8em
}

.ah-catalog{
    display:flex;
    gap:.9em;
    align-items:flex-start
}

.ah-side{
    width:9.8em;
    min-width:9.8em;
    padding:.46em;
    border-radius:.65em;
    background:#0e1222
}

.ah-filter{
    width:100%;
    margin:.14em 0;
    font-size:.77em
}

.ah-filter.selected{
    background:rgba(132,79,239,.34)
}

.ah-main{
    flex:1;
    min-width:0
}

.ah-grid{
    display:grid;
    grid-template-columns:repeat(5,minmax(0,1fr));
    gap:.62em
}

.ah-poster{
    min-width:0;
    padding:.16em;
    border-radius:.6em
}

.ah-poster-media{
    height:11.8em;
    position:relative;
    border-radius:.48em;
    overflow:hidden;
    background:#14182a
}

.ah-poster-media img,
.ah-detail-poster img,
.ah-shot img{
    width:100%;
    height:100%;
    object-fit:cover
}

.ah-poster-title{
    font-size:.75em;
    font-weight:730;
    height:2.05em;
    overflow:hidden;
    margin:.38em .02em .08em
}

.ah-poster-meta{
    font-size:.59em;
    color:#8f8ca1;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-poster-score{
    position:absolute;
    right:.32em;
    bottom:.32em;
    font-size:.62em;
    padding:.16em .3em;
    background:rgba(5,7,15,.88);
    border-radius:.3em;
    color:#ffd76a
}

.ah-pages{
    display:flex;
    gap:.5em;
    margin-top:.9em
}

.ah-detail{
    position:relative;
    min-height:27em;
    border-radius:.82em;
    overflow:hidden;
    isolation:isolate;
    background:#0d1120;
    margin-bottom:.95em
}

.ah-detail-copywrap{
    display:flex;
    gap:.9em;
    padding:1.15em;
    align-items:center;
    min-height:26em;
    box-sizing:border-box
}

.ah-detail-poster{
    width:10.6em;
    min-width:10.6em;
    height:15.7em;
    border-radius:.62em;
    overflow:hidden;
    background:#15192b;
    border:1px solid rgba(255,255,255,.13)
}

.ah-detail-main{
    flex:1;
    min-width:0;
    padding:.68em .78em;
    border-radius:.62em;
    background:linear-gradient(
        90deg,
        rgba(4,6,15,.72),
        rgba(4,6,15,.24),
        transparent
    )
}

.ah-detail-title{
    font-size:2.15em;
    font-weight:900;
    line-height:1.05;
    text-shadow:0 2px 6px #000
}

.ah-aside{
    width:14.5em;
    min-width:14.5em;
    background:rgba(9,12,25,.82);
    border:1px solid rgba(255,255,255,.09);
    border-radius:.65em;
    padding:.68em
}

.ah-aside-title{
    font-weight:850;
    margin-bottom:.16em
}

.ah-info{
    display:flex;
    justify-content:space-between;
    gap:.45em;
    font-size:.72em;
    padding:.42em 0;
    border-bottom:1px solid rgba(255,255,255,.06)
}

.ah-info span:first-child{
    color:#aaa7b8
}

.ah-info span:last-child{
    text-align:right;
    font-weight:700;
    max-width:62%
}

.ah-studio{
    font-size:.75em;
    color:#cbc7d5;
    margin:.12em 0
}

.ah-longdesc{
    background:#101426;
    border:1px solid rgba(255,255,255,.06);
    border-radius:.62em;
    padding:.8em;
    line-height:1.48;
    color:#d5d2de;
    margin-bottom:.95em
}

.ah-ephead{
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom:.42em
}

.ah-epcount{
    font-size:.67em;
    color:#bbb7c8;
    background:rgba(255,255,255,.07);
    padding:.18em .42em;
    border-radius:99px;
    margin-left:.45em
}

.ah-ep{
    position:relative;
    flex:0 0 9.6em;
    height:5.45em;
    border-radius:.56em;
    overflow:hidden;
    background:#13172a;
    border:1px solid rgba(255,255,255,.08)
}

.ah-ep img{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover
}

.ah-epnum{
    position:absolute;
    left:.36em;
    top:.32em;
    font-size:.67em;
    font-weight:850;
    background:rgba(5,7,16,.88);
    padding:.18em .31em;
    border-radius:.28em
}

.ah-epcopy{
    position:absolute;
    left:.4em;
    right:.4em;
    bottom:.34em
}

.ah-epname{
    font-size:.67em;
    font-weight:760
}

.ah-epmeta{
    font-size:.55em;
    color:#c6c2d0;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-placeholder{
    padding:.75em;
    border-radius:.62em;
    background:#101426;
    color:#bbb7c8;
    display:flex;
    gap:.5em;
    align-items:center
}

.ah-spinner{
    width:1em;
    height:1em;
    border-radius:50%;
    border:2px solid rgba(187,125,255,.15);
    border-top-color:#c878ff;
    animation:ah-spin .9s linear infinite
}

.ah-shot{
    flex:0 0 14.5em;
    height:8.1em;
    border-radius:.56em;
    overflow:hidden;
    background:#14182a
}

.ah-schgrid{
    display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:.62em
}

.ah-sch{
    height:5.9em;
    position:relative;
    border-radius:.56em;
    overflow:hidden;
    background:#14182a;
    border:1px solid rgba(255,255,255,.07)
}

.ah-sch img{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    opacity:.72
}

.ah-schcopy{
    position:absolute;
    left:.46em;
    right:.46em;
    bottom:.38em;
    z-index:2
}

.ah-sch:after{
    content:'';
    position:absolute;
    inset:0;
    background:linear-gradient(
        0deg,
        rgba(5,7,16,.98),
        rgba(5,7,16,.08)
    )
}

.ah-schtitle{
    font-size:.72em;
    font-weight:760;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-empty{
    padding:1.4em;
    color:#aaa7bb
}

.ah-fallback{
    width:100%;
    height:100%;
    display:flex;
    align-items:center;
    justify-content:center;
    text-align:center;
    background:#15192b;
    color:#89869b;
    font-size:.7em;
    padding:.35em;
    box-sizing:border-box
}

.ah-loader{
    min-height:19em;
    display:flex;
    position:relative;
    flex-direction:column;
    justify-content:center;
    align-items:center;
    gap:.65em;
    color:#bbb7c8
}

.ah-loader-logo{
    width:4.2em;
    height:4.2em
}

.ah-loader-ring{
    position:absolute;
    width:5.4em;
    height:5.4em;
    border:2px solid rgba(180,110,255,.12);
    border-top-color:#cc76ff;
    border-radius:50%;
    animation:ah-spin 1s linear infinite
}

@keyframes ah-spin{
    to{
        transform:rotate(360deg)
    }
}

@media(max-width:1250px){
    .ah-grid{
        grid-template-columns:repeat(5,minmax(0,1fr))
    }

    .ah-aside{
        display:none
    }

    .ah-detail-title{
        font-size:1.95em
    }

    .ah-side{
        width:9.2em;
        min-width:9.2em
    }
}
</style>
    `);
}

/* ============================================================
 * IMAGES
 * ============================================================ */

function putImage(
    box,
    url,
    title,
    eager
){
    if(!url){
        box.append(
            '<div class="ah-fallback">'+
                esc(
                    title||
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
            decoding:'async'
        });

    if(!eager){
        img.attr(
            'loading',
            'lazy'
        );
    }

    img.on(
        'error',
        function(){
            box
                .empty()
                .append(
                    '<div class="ah-fallback">'+
                        esc(
                            title||
                            'AnimeHub'
                        )+
                    '</div>'
                );
        }
    );

    box.append(img);
}

function putBackground(
    box,
    url
){
    if(!url){
        return;
    }

    var img=
        $('<img class="ah-bg" alt="">')
        .attr({
            src:url,
            decoding:'async'
        });

    img.on(
        'error',
        function(){
            $(this)
                .remove();
        }
    );

    box.append(img);
}

/* ============================================================
 * FAST NAVIGATION
 * Use Lampa/Navigator; no all-selector geometry scan per keypress.
 * ============================================================ */

function safeNavigatorCan(direction){
    try{
        return (
            typeof Navigator!==
            'undefined'&&
            Navigator.canmove(
                direction
            )
        );
    }
    catch(e){
        return false;
    }
}

function safeNavigatorMove(direction){
    try{
        if(
            typeof Navigator!==
            'undefined'
        ){
            Navigator.move(
                direction
            );
        }
    }
    catch(e){}
}

function scrollFocused(
    view,
    node
){
    if(
        !view||
        !view[0]||
        !node
    ){
        return;
    }

    var parent=
        node.parentElement;

    if(
        parent&&
        parent.scrollWidth>
        parent.clientWidth+
        4
    ){
        var left=
            node.offsetLeft;

        var right=
            left+
            node.offsetWidth;

        var visibleLeft=
            parent.scrollLeft;

        var visibleRight=
            visibleLeft+
            parent.clientWidth;

        if(
            right>
            visibleRight-
            12
        ){
            parent.scrollLeft=
                right-
                parent.clientWidth+
                12;
        }
        else if(
            left<
            visibleLeft+
            12
        ){
            parent.scrollLeft=
                Math.max(
                    0,
                    left-
                    12
                );
        }
    }

    var top=0;
    var cur=node;

    while(
        cur&&
        cur!==
        view[0]
    ){
        top+=
            cur.offsetTop||
            0;

        cur=
            cur.offsetParent;
    }

    var bottom=
        top+
        (
            node.offsetHeight||
            0
        );

    var vtop=
        view[0]
            .scrollTop;

    var vbottom=
        vtop+
        view[0]
            .clientHeight;

    if(
        bottom>
        vbottom-
        18
    ){
        view[0]
            .scrollTop=
                bottom-
                view[0]
                    .clientHeight+
                18;
    }
    else if(
        top<
        vtop+
        10
    ){
        view[0]
            .scrollTop=
                Math.max(
                    0,
                    top-
                    10
                );
    }
}

function bindFocus(
    root,
    view,
    state
){
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
            state.last=
                this;

            scrollFocused(
                view,
                this
            );
        }
    );
}

function installController(
    view,
    root,
    state,
    back
){
    Lampa.Controller.add(
        'content',

        {
            toggle:function(){
                try{
                    Lampa.Controller.collectionSet(
                        root
                    );

                    Lampa.Controller.collectionFocus(
                        state.last||
                        root.find(
                            '.selector'
                        )[0]||
                        false,

                        root
                    );
                }
                catch(e){}
            },

            left:function(){
                if(
                    safeNavigatorCan(
                        'left'
                    )
                ){
                    safeNavigatorMove(
                        'left'
                    );
                }
                else{
                    Lampa.Controller.toggle(
                        'menu'
                    );
                }
            },

            right:function(){
                if(
                    safeNavigatorCan(
                        'right'
                    )
                ){
                    safeNavigatorMove(
                        'right'
                    );
                }
            },

            up:function(){
                if(
                    safeNavigatorCan(
                        'up'
                    )
                ){
                    safeNavigatorMove(
                        'up'
                    );
                }
                else{
                    Lampa.Controller.toggle(
                        'head'
                    );
                }
            },

            down:function(){
                if(
                    safeNavigatorCan(
                        'down'
                    )
                ){
                    safeNavigatorMove(
                        'down'
                    );
                }
            },

            enter:function(){
                var x=
                    root.find(
                        '.selector.focus'
                    )[0]||
                    state.last;

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

function focusFirst(
    root,
    state
){
    setTimeout(
        function(){
            var first=
                root.find(
                    '.selector'
                )[0];

            if(!first){
                return;
            }

            state.last=
                first;

            try{
                Lampa.Controller.collectionSet(
                    root
                );

                Lampa.Controller.collectionFocus(
                    first,
                    root
                );
            }
            catch(e){}
        },

        25
    );
}

/* ============================================================
 * ROUTES + TOP BAR
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

        ah_mode:
            mode||
            'all',

        ah_value:
            value||
            '',

        ah_title:
            title||
            'Каталог',

        ah_page:
            page||
            1
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

            var q=
                clean(
                    result&&
                    typeof result==='object'
                        ?result.value
                        :result
                );

            if(q){
                openCatalog(
                    'search',
                    q,
                    'Поиск: '+
                    q,
                    1
                );
            }
        }
    );
}

function showSelect(
    title,
    items,
    onSelect,
    onBack
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

    var settled=false;

    Lampa.Select.show({
        title:title,
        items:items,

        onSelect:function(item){
            settled=true;

            if(onSelect){
                onSelect(item);
            }
        },

        onBack:function(){
            if(settled){
                return;
            }

            if(onBack){
                onBack();
            }
            else{
                try{
                    Lampa.Controller.toggle(
                        'content'
                    );
                }
                catch(e){}
            }
        }
    });

    return true;
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
                            title:
                                g.title,

                            id:
                                g.id
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
    var items=[];

    var y=
        new Date()
            .getFullYear()+
        1;

    for(
        ;
        y>=1970;
        y--
    ){
        items.push({
            title:
                String(y),

            value:
                String(y)
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
        ['Спецвыпуски','special']
    ];

    showSelect(
        'Тип',

        types.map(
            function(x){
                return {
                    title:
                        x[0],

                    value:
                        x[1]
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
    homeAction
){
    var bar=
        $('<div class="ah-top"></div>');

    var brand=
        $('<div class="ah-brand"></div>')
        .append(
            toriiSvg(
                'ah-logo'
            ),

            '<span class="ah-name">'+
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
            .text(
                title
            );

        if(
            active===
            key
        ){
            item.addClass(
                'active'
            );
        }

        item.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                action();
            }
        );

        nav.append(
            item
        );
    }

    add(
        'home',
        'Главная',
        homeAction||
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
        a.source===
        'yummy'&&
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
                compactAnime(a)
        });

        return;
    }

    if(a.title){
        var net=
            new Lampa.Reguest();

        requestJson(
            net,

            workerUrl(
                'catalog',

                {
                    mode:'search',
                    value:a.title,
                    page:1,
                    limit:6
                }
            ),

            function(data){
                var items=
                    data.items||
                    [];

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

                if(best){
                    openDetail(
                        best
                    );
                }
                else{
                    notify(
                        'Старая запись не найдена'
                    );
                }

                try{
                    net.clear();
                }
                catch(e){}
            },

            function(){
                notify(
                    'Не удалось открыть запись'
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
    state
){
    var card=
        $('<div class="ah-wide selector"></div>');

    putImage(
        card,
        a.poster,
        a.title,
        false
    );

    card.append(
        '<div class="ah-cardshade"></div>'
    );

    if(
        a.status&&
        a.status.alias===
        'ongoing'
    ){
        card.append(
            '<div class="ah-badge">'+
                'ОНГОИНГ'+
            '</div>'
        );
    }

    var meta=[
        a.year||'',

        typeLabel(a),

        num(
            a.score,
            0
        )>0
            ?'★ '+
            score(
                a.score
            )
            :'',

        a.episodes&&
        a.episodes.aired
            ?intv(
                a.episodes.aired,
                0
            )+
            ' сер.'
            :''
    ]
    .filter(Boolean);

    if(
        state&&
        state.episode
    ){
        meta.unshift(
            'Серия '+
            state.episode
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
            '<div class="ah-smallmeta">'+
                esc(
                    meta.join(
                        ' • '
                    )
                )+
            '</div>'+
        '</div>'
    );

    if(
        state&&
        num(
            state.duration,
            0
        )>0&&
        num(
            state.position,
            0
        )>0&&
        !state.completed
    ){
        var p=
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
            '<div class="ah-progress">'+
                '<span style="width:'+
                    p+
                    '%"></span>'+
            '</div>'
        );
    }

    card.on(
        'hover:enter click',

        function(e){
            if(e){
                e.preventDefault();
            }

            openDetail(a);
        }
    );

    return card;
}

function posterCard(a){
    var card=
        $('<div class="ah-poster selector"></div>');

    var media=
        $('<div class="ah-poster-media"></div>');

    putImage(
        media,
        a.poster,
        a.title,
        false
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
                    score(
                        a.score
                    )
                )+
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
        '</div>',

        '<div class="ah-poster-meta">'+
            esc(
                [
                    a.year||'',
                    typeLabel(a)
                ]
                .filter(Boolean)
                .join(
                    ' • '
                )
            )+
        '</div>'
    );

    card.on(
        'hover:enter click',

        function(e){
            if(e){
                e.preventDefault();
            }

            openDetail(a);
        }
    );

    return card;
}

function shelf(
    root,
    title,
    items,
    stateMap
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

    var row=
        $('<div class="ah-row"></div>');

    items
        .slice(
            0,
            6
        )
        .forEach(
            function(a){
                row.append(
                    wideCard(
                        a,

                        stateMap&&
                        stateMap[
                            String(
                                a.id
                            )
                        ]
                    )
                );
            }
        );

    root.append(
        section.append(
            row
        )
    );
}

function continueShelf(root){
    var states=
        continueStates();

    if(!states.length){
        return;
    }

    var map={};

    var items=
        states.map(
            function(x){
                map[
                    String(
                        x.anime.id
                    )
                ]=
                    x;

                return x.anime;
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
 * YUMMYANIME VIDEO HELPERS
 * ============================================================ */

function videoData(video){
    var value=
        video&&
        video.data;

    if(!value){
        return {};
    }

    if(
        typeof value===
        'object'
    ){
        return value;
    }

    if(
        typeof value===
        'string'
    ){
        try{
            return JSON.parse(
                value
            )||
            {};
        }
        catch(e){
            return {};
        }
    }

    return {};
}

function normalizeVideoUrl(url){
    url=
        clean(url);

    if(!url){
        return '';
    }

    if(
        url.indexOf('//')===
        0
    ){
        return (
            'https:'+
            url
        );
    }

    if(
        /^http:\/\/(?:www\.)?kodik\./i
            .test(url)
    ){
        return (
            'https://'+
            url.slice(7)
        );
    }

    return url;
}

function videoSourceUrl(video){
    if(!video){
        return '';
    }

    var d=
        videoData(video);

    return normalizeVideoUrl(
        video.yani_stream_url||
        d.yani_stream_url||

        video.iframe_url||
        video.iframeUrl||

        video.url||

        video.player_url||
        video.playerUrl||

        video.link||

        d.iframe_url||
        d.iframeUrl||

        d.url||

        d.player_url||
        d.playerUrl||

        d.link
    );
}

function videoHost(url){
    try{
        return new URL(url)
            .hostname
            .replace(
                /^www\./,
                ''
            );
    }
    catch(e){
        return '';
    }
}

function episodeValue(
    video,
    index
){
    var raw=
        video&&
        (
            video.number!=null
                ?video.number
                :(
                    video.episode!=null
                        ?video.episode
                        :video.index
                )
        );

    if(
        raw===undefined||
        raw===null||
        raw===''
    ){
        raw=
            index+
            1;
    }

    var m=
        String(raw)
            .match(
                /\d+(?:[.,]\d+)?/
            );

    return m
        ?parseFloat(
            m[0]
                .replace(
                    ',',
                    '.'
                )
        )
        :String(raw);
}

function sourceKind(
    url,
    video
){
    var d=
        videoData(video);

    var value=
        (
            String(
                url||
                ''
            )+
            ' '+
            String(
                video&&
                video.player||
                ''
            )+
            ' '+
            String(
                d.player||
                ''
            )+
            ' '+
            String(
                d.source||
                ''
            )
        )
        .toLowerCase();

    if(
        /\.(m3u8|mpd|mp4|webm)(?:[?#].*)?$/i
            .test(url)
    ){
        return 'direct';
    }

    if(
        /iframecvh|cdnvideohub|(?:^|\s)cvh(?:\s|$)/i
            .test(value)
    ){
        return 'cvh';
    }

    if(
        /iframevk|vkvideo|vk\.com|video_ext\.php|(?:^|\s)vk(?:\s|$)/i
            .test(value)
    ){
        return 'vk';
    }

    if(
        /kodik/i
            .test(value)
    ){
        return 'kodik';
    }

    if(
        /aksor/i
            .test(value)
    ){
        return 'aksor';
    }

    if(
        /rutube/i
            .test(value)
    ){
        return 'rutube';
    }

    return 'unsupported';
}

function groupPart(v){
    return clean(v)
        .toLowerCase();
}

function voiceName(video){
    var d=
        videoData(video);

    return clean(
        d.dubbing||
        d.translation||
        d.voice||
        d.voice_name||
        video.dubbing||
        video.translation||
        video.voice||
        d.player||
        'Источник'
    )
    .replace(
        /^\ufeff/,
        ''
    );
}

function groupVideos(videos){
    var groups={};

    (
        videos||
        []
    )
    .forEach(
        function(
            video,
            index
        ){
            var url=
                videoSourceUrl(
                    video
                );

            if(!url){
                return;
            }

            video.iframe_url=
                url;

            video._ahEpisode=
                episodeValue(
                    video,
                    index
                );

            var d=
                videoData(
                    video
                );

            var voice=
                voiceName(
                    video
                );

            var host=
                videoHost(
                    url
                );

            var provider=
                clean(
                    d.player_id||
                    d.player||
                    d.source||
                    d.service||
                    host
                );

            var key=
                groupPart(
                    voice
                )+
                '|'+
                groupPart(
                    provider
                );

            if(!groups[key]){
                groups[key]={
                    key:key,
                    title:voice,

                    player:
                        clean(
                            d.player||
                            d.source||
                            d.service||
                            host
                        ),

                    kind:
                        sourceKind(
                            url,
                            video
                        ),

                    videos:[]
                };
            }

            groups[key]
                .videos
                .push(
                    video
                );
        }
    );

    return Object.keys(groups)
        .map(
            function(k){
                var g=
                    groups[k];

                g.videos.sort(
                    function(a,b){
                        return (
                            num(
                                a._ahEpisode,
                                99999
                            )-
                            num(
                                b._ahEpisode,
                                99999
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

                return g;
            }
        )
        .sort(
            function(a,b){
                var priority={
                    direct:6,
                    cvh:5,
                    vk:4,
                    kodik:3,
                    aksor:2,
                    rutube:1,
                    unsupported:0
                };

                return (
                    (
                        priority[
                            b.kind
                        ]||
                        0
                    )-
                    (
                        priority[
                            a.kind
                        ]||
                        0
                    )||
                    clean(
                        a.title
                    )
                    .localeCompare(
                        clean(
                            b.title
                        ),
                        'ru'
                    )
                );
            }
        );
}

function episodeNumbers(videos){
    var seen={};
    var out=[];

    (
        videos||
        []
    )
    .forEach(
        function(
            video,
            index
        ){
            var ep=
                episodeValue(
                    video,
                    index
                );

            var key=
                String(ep);

            if(!seen[key]){
                seen[key]=1;

                out.push(
                    ep
                );
            }
        }
    );

    return out.sort(
        function(a,b){
            return (
                num(
                    a,
                    99999
                )-
                num(
                    b,
                    99999
                )
            );
        }
    );
}

function findVideo(
    group,
    ep
){
    var found=null;

    (
        group&&
        group.videos||
        []
    )
    .some(
        function(video){
            if(
                String(
                    video._ahEpisode
                )===
                String(ep)||
                Math.abs(
                    num(
                        video._ahEpisode,
                        -999
                    )-
                    num(
                        ep,
                        -998
                    )
                )<
                0.0001
            ){
                found=
                    video;

                return true;
            }

            return false;
        }
    );

    return found;
}

function groupsForEpisode(
    videos,
    ep
){
    return groupVideos(
        videos
    )
    .filter(
        function(g){
            return !!findVideo(
                g,
                ep
            );
        }
    );
}

/* ============================================================
 * VIDEO REQUEST CACHE
 * ============================================================ */

function cacheVideos(
    id,
    videos
){
    id=
        String(id);

    if(videoCache[id]){
        videoOrder=
            videoOrder.filter(
                function(x){
                    return x!==id;
                }
            );
    }

    videoCache[id]={
        at:Date.now(),
        videos:videos
    };

    videoOrder.push(
        id
    );

    while(
        videoOrder.length>
        VIDEO_CACHE_MAX
    ){
        delete videoCache[
            videoOrder.shift()
        ];
    }
}

function loadVideos(
    a,
    ok,
    fail,
    showLoading
){
    var id=
        String(
            a&&
            a.id||
            ''
        );

    if(!id){
        if(fail){
            fail();
        }

        return;
    }

    var hit=
        videoCache[id];

    if(
        hit&&
        Date.now()-
        hit.at<
        180000
    ){
        setTimeout(
            function(){
                ok(
                    hit.videos
                );
            },
            0
        );

        return;
    }

    if(videoInflight[id]){
        videoInflight[id]
            .push({
                ok:ok,
                fail:fail
            });

        return;
    }

    videoInflight[id]=[
        {
            ok:ok,
            fail:fail
        }
    ];

    var net=
        new Lampa.Reguest();

    net.timeout(
        22000
    );

    if(
        showLoading!==
        false
    ){
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
                id:id
            }
        ),

        function(data){
            if(
                showLoading!==
                false
            ){
                try{
                    Lampa.Loading.stop();
                }
                catch(e){}
            }

            var videos=
                data.videos||
                [];

            var wait=
                videoInflight[id]||
                [];

            delete videoInflight[id];

            cacheVideos(
                id,
                videos
            );

            try{
                net.clear();
            }
            catch(e){}

            wait.forEach(
                function(x){
                    x.ok(
                        videos
                    );
                }
            );
        },

        function(error){
            if(
                showLoading!==
                false
            ){
                try{
                    Lampa.Loading.stop();
                }
                catch(e){}
            }

            var wait=
                videoInflight[id]||
                [];

            delete videoInflight[id];

            try{
                net.clear();
            }
            catch(e){}

            wait.forEach(
                function(x){
                    if(x.fail){
                        x.fail(
                            error
                        );
                    }
                }
            );
        }
    );
}

/* ============================================================
 * PLAYBACK UX
 * ============================================================ */

function restoreContent(){
    setTimeout(
        function(){
            try{
                Lampa.Controller.toggle(
                    'content'
                );
            }
            catch(e){}
        },
        0
    );
}

function currentOrFirstEpisode(
    anime,
    videos
){
    var eps=
        episodeNumbers(
            videos
        );

    if(!eps.length){
        return null;
    }

    var state=
        watchState(
            anime
        );

    var ep=
        num(
            state.episode,
            0
        );

    if(
        eps.indexOf(ep)<
        0
    ){
        ep=
            eps[0];
    }
    else if(
        state.completed
    ){
        var idx=
            eps.indexOf(
                ep
            );

        if(
            idx>=0&&
            idx<
            eps.length-
            1
        ){
            ep=
                eps[
                    idx+
                    1
                ];
        }
    }

    return ep;
}

function chooseSourceForEpisode(
    anime,
    videos,
    ep,
    alwaysAsk
){
    var groups=
        groupsForEpisode(
            videos,
            ep
        )
        .filter(
            function(g){
                return (
                    g.kind!==
                    'unsupported'
                );
            }
        );

    if(!groups.length){
        notify(
            'Для этой серии нет поддерживаемого источника'
        );

        restoreContent();

        return;
    }

    var state=
        watchState(
            anime
        );

    var preferred=null;

    if(state.providerKey){
        groups.some(
            function(g){
                if(
                    g.key===
                    state.providerKey
                ){
                    preferred=g;
                    return true;
                }

                return false;
            }
        );
    }

    if(
        !alwaysAsk&&
        preferred
    ){
        resolveAndPlay(
            anime,
            preferred,
            findVideo(
                preferred,
                ep
            )
        );

        return;
    }

    if(
        groups.length===
        1
    ){
        resolveAndPlay(
            anime,
            groups[0],

            findVideo(
                groups[0],
                ep
            )
        );

        return;
    }

    showSelect(
        'Озвучка / источник • Серия '+
        ep,

        groups.map(
            function(g){
                return {
                    title:
                        g.title,

                    subtitle:
                        String(
                            g.player||
                            g.kind||
                            ''
                        )
                        .toUpperCase(),

                    group:
                        g
                };
            }
        ),

        function(item){
            setTimeout(
                function(){
                    resolveAndPlay(
                        anime,
                        item.group,

                        findVideo(
                            item.group,
                            ep
                        )
                    );
                },

                0
            );
        },

        restoreContent
    );
}

function watchAnime(
    anime,
    videos,
    forcedEpisode
){
    function go(list){
        var eps=
            episodeNumbers(
                list
            );

        if(!eps.length){
            notify(
                'Видео для этого тайтла не найдено'
            );

            restoreContent();

            return;
        }

        var state=
            watchState(
                anime
            );

        var ep=
            forcedEpisode!=null
                ?forcedEpisode
                :currentOrFirstEpisode(
                    anime,
                    list
                );

        var isResume=
            forcedEpisode==null&&
            num(
                state.episode,
                0
            )>0;

        chooseSourceForEpisode(
            anime,
            list,
            ep,
            !isResume
        );
    }

    if(videos){
        go(
            videos
        );

        return;
    }

    loadVideos(
        anime,
        go,

        function(){
            notify(
                'Не удалось загрузить источники'
            );

            restoreContent();
        },

        true
    );
}

function changeSource(
    anime,
    videos
){
    function go(list){
        var ep=
            currentOrFirstEpisode(
                anime,
                list
            );

        if(
            ep==
            null
        ){
            notify(
                'Видео для этого тайтла не найдено'
            );

            restoreContent();

            return;
        }

        chooseSourceForEpisode(
            anime,
            list,
            ep,
            true
        );
    }

    if(videos){
        go(
            videos
        );
    }
    else{
        loadVideos(
            anime,
            go,

            function(){
                notify(
                    'Не удалось загрузить источники'
                );

                restoreContent();
            },

            true
        );
    }
}

function resolveAndPlay(
    anime,
    group,
    video
){
    if(!video){
        notify(
            'Видео не найдено'
        );

        restoreContent();

        return;
    }

    var url=
        videoSourceUrl(
            video
        );

    if(!url){
        notify(
            'У источника нет адреса'
        );

        restoreContent();

        return;
    }

    var data=
        videoData(
            video
        );

    var direct=
        video.yani_stream_url||
        data.yani_stream_url;

    if(direct){
        launchPlayer(
            anime,
            group,
            video,

            {
                url:
                    normalizeVideoUrl(
                        direct
                    ),

                quality:
                    video.yani_stream_quality||
                    data.yani_stream_quality||
                    'auto',

                qualities:
                    video.yani_stream_qualities||
                    data.yani_stream_qualities||
                    {
                        auto:
                            normalizeVideoUrl(
                                direct
                            )
                    },

                headers:
                    video.yani_stream_headers||
                    data.yani_stream_headers||
                    {}
            }
        );

        return;
    }

    try{
        Lampa.Loading.start();
    }
    catch(e){}

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
                    url,

                player:
                    group.kind||
                    group.player||
                    '',

                ua:
                    (
                        window.navigator&&
                        window.navigator.userAgent
                    )||
                    ''
            }
        ),

        function(result){
            try{
                Lampa.Loading.stop();
                net.clear();
            }
            catch(e){}

            if(
                !result.stream||
                !result.stream.url
            ){
                notify(
                    'Прямой поток не найден'
                );

                restoreContent();

                return;
            }

            video.yani_stream_url=
                result.stream.url;

            video.yani_stream_quality=
                result.stream.quality||
                '';

            video.yani_stream_qualities=
                result.stream.qualities||
                null;

            video.yani_stream_headers=
                result.stream.headers||
                null;

            launchPlayer(
                anime,
                group,
                video,
                result.stream
            );
        },

        function(error){
            try{
                Lampa.Loading.stop();
                net.clear();
            }
            catch(e){}

            notify(
                'Источник не открылся: '+
                clean(
                    error&&
                    error.message||
                    'ошибка'
                )
            );

            restoreContent();
        }
    );
}

function extension(url){
    var m=
        String(
            url||
            ''
        )
        .match(
            /\.(m3u8|mpd|mp4|webm)(?:[?#]|$)/i
        );

    return m
        ?m[1]
            .toLowerCase()
        :'';
}

function launchPlayer(
    anime,
    group,
    video,
    stream
){
    var url=
        stream.url;

    var ext=
        extension(
            url
        );

    var previous=
        watchState(
            anime
        );

    var same=
        Math.abs(
            num(
                previous.episode,
                0
            )-
            num(
                video._ahEpisode,
                0
            )
        )<
        0.0001;

    var resumeTime=
        same&&
        !previous.completed
            ?num(
                previous.position,
                0
            )
            :0;

    saveWatchState(
        anime,

        {
            episode:
                video._ahEpisode,

            videoId:
                video.video_id||
                video.id||
                '',

            providerKey:
                group.key,

            provider:
                group.kind,

            dubbing:
                group.title,

            position:
                resumeTime,

            duration:
                same
                    ?num(
                        previous.duration,
                        0
                    )
                    :0,

            completed:
                same
                    ?!!previous.completed
                    :false
        }
    );

    var item={
        title:
            (
                anime.title||
                'AnimeHub'
            )+
            ' • Серия '+
            video._ahEpisode+
            ' • '+
            group.title,

        url:
            url,

        time:
            resumeTime,

        isonline:
            true,

        quality:
            stream.qualities||
            {
                auto:
                    url
            },

        headers:
            stream.headers||
            {},

        poster:
            anime.poster||
            '',

        animehub_anime:
            compactAnime(
                anime
            ),

        animehub_episode:
            video._ahEpisode,

        animehub_provider_key:
            group.key,

        animehub_video_id:
            video.video_id||
            video.id||
            ''
    };

    if(ext){
        item.extension=
            ext;
    }

    if(
        ext===
        'mp4'
    ){
        item.mime=
            'video/mp4';
    }
    else if(
        ext===
        'm3u8'
    ){
        item.mime=
            'application/vnd.apple.mpegurl';
    }

    try{
        Lampa.Player.runas(
            'lampa'
        );

        Lampa.Player.play(
            item
        );

        if(
            Lampa.Player.playlist
        ){
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
            'Не удалось запустить Lampa Player'
        );

        restoreContent();
    }
}

/* ============================================================
 * PROGRESS TRACKER
 * ============================================================ */

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

        function(data){
            if(
                !data||
                !data.animehub_anime
            ){
                return;
            }

            var anime=
                data.animehub_anime;

            var episode=
                data.animehub_episode;

            var lastSave=0;
            var active=true;

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
                        e&&
                        e.current,
                        0
                    );

                var duration=
                    num(
                        e&&
                        e.duration,
                        0
                    );

                if(
                    current<=
                    0
                ){
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

    var focus={
        last:null
    };

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
                putBackground(
                    hero,
                    bg
                );
            }

            hero.append(
                '<div class="ah-shade"></div>'
            );

            var content=
                $('<div class="ah-hero-copy"></div>');

            content.append(
                '<div class="ah-kicker">'+
                    'Сейчас в центре внимания'+
                '</div>'+
                '<div class="ah-title">'+
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
                    '<div class="ah-original">'+
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
                    '<span class="ah-chip ah-score">'+
                        '★ '+
                        esc(
                            score(
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
                        typeLabel(
                            anime
                        )
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

            content.append(
                meta,

                '<div class="ah-description">'+
                    esc(
                        clip(
                            cleanDescription(
                                anime.description
                            ),
                            270
                        )||
                        'Откройте карточку для подробностей.'
                    )+
                '</div>'
            );

            var actions=
                $('<div class="ah-actions"></div>');

            $(
                '<div class="ah-button primary selector">'+
                    '▶ Смотреть'+
                '</div>'
            )
            .on(
                'hover:enter click',

                function(e){
                    if(e){
                        e.preventDefault();
                    }

                    watchAnime(
                        anime
                    );
                }
            )
            .appendTo(
                actions
            );

            $(
                '<div class="ah-button selector">'+
                    'ⓘ Подробнее'+
                '</div>'
            )
            .on(
                'hover:enter click',

                function(e){
                    if(e){
                        e.preventDefault();
                    }

                    openDetail(
                        anime
                    );
                }
            )
            .appendTo(
                actions
            );

            content.append(
                actions
            );

            hero.append(
                content
            );

            root.append(
                hero
            );
        }

        continueShelf(
            root
        );

        shelf(
            root,
            'Сейчас выходит',
            data.ongoing||
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

        bindFocus(
            root,
            view,
            focus
        );

        focusFirst(
            root,
            focus
        );
    }

    this.create=function(){
        alive=true;

        view.append(
            root
        );

        root.append(
            topbar(
                'home',
                function(){}
            ),

            loaderHtml(
                'Загрузка AnimeHub…'
            )
        );

        requestCached(
            net,
            'home',
            120000,
            workerUrl(
                'home'
            ),
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
                focus,

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

    var focus={
        last:null
    };

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

    function filter(
        side,
        key,
        label,
        action
    ){
        var button=
            $('<div class="ah-filter selector"></div>')
            .text(
                label
            );

        if(
            mode===
            key
        ){
            button.addClass(
                'selected'
            );
        }

        button.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                action();
            }
        );

        side.append(
            button
        );
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
                ),

                '<div class="ah-head">'+
                    '<div class="ah-page-title">'+
                        esc(
                            title
                        )+
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
            $('<div class="ah-catalog"></div>');

        var side=
            $('<div class="ah-side"></div>');

        filter(
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

        filter(
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

        filter(
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

        filter(
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

        filter(
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

        filter(
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

        filter(
            side,
            'genre',
            'Жанры',
            chooseGenre
        );

        filter(
            side,
            'year',
            'Годы',
            chooseYear
        );

        filter(
            side,
            'type',
            'Тип',
            chooseType
        );

        var main=
            $('<div class="ah-main"></div>');

        var grid=
            $('<div class="ah-grid"></div>');

        (
            data.items||
            []
        )
        .forEach(
            function(a){
                grid.append(
                    posterCard(
                        a
                    )
                );
            }
        );

        main.append(
            grid
        );

        var pages=
            $('<div class="ah-pages"></div>');

        if(
            page>
            1
        ){
            $(
                '<div class="ah-pagebtn selector">'+
                    '← '+
                    (
                        page-
                        1
                    )+
                '</div>'
            )
            .on(
                'hover:enter click',

                function(){
                    openCatalog(
                        mode,
                        value,
                        title,
                        page-
                        1
                    );
                }
            )
            .appendTo(
                pages
            );
        }

        if(data.hasNext){
            $(
                '<div class="ah-pagebtn selector">'+
                    (
                        page+
                        1
                    )+
                    ' →'+
                '</div>'
            )
            .on(
                'hover:enter click',

                function(){
                    openCatalog(
                        mode,
                        value,
                        title,
                        page+
                        1
                    );
                }
            )
            .appendTo(
                pages
            );
        }

        main.append(
            pages
        );

        root.append(
            layout.append(
                side,
                main
            )
        );

        bindFocus(
            root,
            view,
            focus
        );

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
                    focus.last=
                        first;

                    try{
                        Lampa.Controller.collectionSet(
                            root
                        );

                        Lampa.Controller.collectionFocus(
                            first,
                            root
                        );
                    }
                    catch(e){}
                }
            },

            25
        );
    }

    this.create=function(){
        alive=true;

        view.append(
            root
        );

        root.append(
            topbar(
                'catalog'
            ),

            loaderHtml(
                'Загрузка каталога…'
            )
        );

        requestCached(
            net,

            'cat:'+
            mode+
            ':'+
            value+
            ':'+
            page,

            90000,

            workerUrl(
                'catalog',

                {
                    mode:mode,
                    value:value,
                    page:page,
                    limit:10
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
                focus,

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

    var focus={
        last:null
    };

    var initial=
        object.ah_item||
        {};

    var anime=null;
    var videos=null;
    var episodeBox=null;
    var recommendationBox=null;
    var watchButton=null;
    var sourceButton=null;

    function infoRow(
        panel,
        label,
        value
    ){
        if(
            value===''||
            value===null||
            value===undefined
        ){
            return;
        }

        panel.append(
            '<div class="ah-info">'+
                '<span>'+
                    esc(
                        label
                    )+
                '</span>'+
                '<span>'+
                    esc(
                        value
                    )+
                '</span>'+
            '</div>'
        );
    }

    function infoPanel(a){
        var panel=
            $(
                '<div class="ah-aside">'+
                    '<div class="ah-aside-title">'+
                        'Информация'+
                    '</div>'+
                '</div>'
            );

        infoRow(
            panel,
            'Рейтинг',

            num(
                a.score,
                0
            )>0
                ?'★ '+
                score(
                    a.score
                )
                :'—'
        );

        if(
            a.studios&&
            a.studios.length
        ){
            infoRow(
                panel,
                'Студия',

                a.studios
                    .map(
                        function(x){
                            return x.title;
                        }
                    )
                    .join(
                        ', '
                    )
            );
        }

        if(
            a.creators&&
            a.creators.length
        ){
            infoRow(
                panel,
                'Режиссёр',

                a.creators
                    .map(
                        function(x){
                            return x.title;
                        }
                    )
                    .join(
                        ', '
                    )
            );
        }

        infoRow(
            panel,
            'Тип',
            typeLabel(a)
        );

        infoRow(
            panel,
            'Статус',

            statusLabel(
                a.status&&
                a.status.alias
            )
        );

        infoRow(
            panel,
            'Эпизоды',
            episodeCount(a)
        );

        if(a.duration){
            infoRow(
                panel,
                'Длительность',
                a.duration+
                ' мин.'
            );
        }

        if(
            a.age&&
            a.age.title
        ){
            infoRow(
                panel,
                'Возраст',
                a.age.title
            );
        }

        if(
            a.episodes&&
            a.episodes.nextDate
        ){
            infoRow(
                panel,
                'Следующая',

                formatDate(
                    a.episodes.nextDate,
                    true
                )
            );
        }

        return panel;
    }

    function refreshWatchButtons(){
        if(
            !anime||
            !watchButton
        ){
            return;
        }

        var state=
            watchState(
                anime
            );

        var ep=
            num(
                state.episode,
                0
            );

        watchButton.text(
            ep&&
            !state.completed
                ?(
                    '▶ Продолжить • серия '+
                    ep
                )
                :ep&&
                state.completed
                    ?'▶ Смотреть дальше'
                    :'▶ Смотреть'
        );

        if(sourceButton){
            sourceButton.text(
                ep
                    ?(
                        '🎧 Озвучка / источник • серия '+
                        ep
                    )
                    :'🎧 Озвучка / источник'
            );
        }
    }

    function screenshotForEpisode(
        ep,
        index
    ){
        var shots=
            anime.screenshots||
            [];

        var exact=null;

        shots.some(
            function(x){
                if(
                    Math.abs(
                        num(
                            x.episode,
                            0
                        )-
                        num(
                            ep,
                            0
                        )
                    )<
                    0.0001
                ){
                    exact=x;
                    return true;
                }

                return false;
            }
        );

        var pick=
            exact||
            (
                shots.length
                    ?shots[
                        index%
                        shots.length
                    ]
                    :null
            );

        return pick
            ?(
                pick.small||
                pick.full
            )
            :(
                anime.background||
                anime.poster||
                ''
            );
    }

    function renderEpisodes(list){
        videos=
            list||
            [];

        var eps=
            episodeNumbers(
                videos
            );

        if(!eps.length){
            episodeBox.html(
                '<div class="ah-placeholder">'+
                    'Видео пока не найдено.'+
                '</div>'
            );

            bindFocus(
                root,
                view,
                focus
            );

            return;
        }

        var state=
            watchState(
                anime
            );

        var current=
            num(
                state.episode,
                0
            );

        var index=
            eps.indexOf(
                current
            );

        var start=0;
        var max=8;

        if(
            eps.length>
            max&&
            index>=0
        ){
            start=
                Math.max(
                    0,

                    Math.min(
                        eps.length-
                        max,

                        index-
                        3
                    )
                );
        }

        var subset=
            eps.slice(
                start,
                start+
                max
            );

        var label=
            eps.length>
            max
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
                eps.length
                :String(
                    eps.length
                );

        var head=
            $(
                '<div class="ah-ephead">'+
                    '<div>'+
                        '<span class="ah-eptitle">'+
                            'Эпизоды'+
                        '</span>'+
                        '<span class="ah-epcount">'+
                            esc(
                                label
                            )+
                        '</span>'+
                    '</div>'+
                '</div>'
            );

        var all=
            $(
                '<div class="ah-all selector">'+
                    'Все серии ›'+
                '</div>'
            );

        all.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                showSelect(
                    'Эпизоды',

                    eps.map(
                        function(ep){
                            return {
                                title:
                                    'Серия '+
                                    ep,

                                episode:
                                    ep
                            };
                        }
                    ),

                    function(item){
                        setTimeout(
                            function(){
                                chooseSourceForEpisode(
                                    anime,
                                    videos,
                                    item.episode,
                                    true
                                );
                            },

                            0
                        );
                    }
                );
            }
        );

        head.append(
            all
        );

        var row=
            $('<div class="ah-eprow"></div>');

        subset.forEach(
            function(
                ep,
                j
            ){
                var groups=
                    groupsForEpisode(
                        videos,
                        ep
                    )
                    .filter(
                        function(g){
                            return (
                                g.kind!==
                                'unsupported'
                            );
                        }
                    );

                var card=
                    $('<div class="ah-ep selector"></div>');

                var image=
                    screenshotForEpisode(
                        ep,
                        start+
                        j
                    );

                if(image){
                    putImage(
                        card,
                        image,
                        'Серия '+
                        ep,
                        false
                    );
                }

                card.append(
                    '<div class="ah-cardshade"></div>'+
                    '<div class="ah-epnum">'+
                        esc(ep)+
                    '</div>'+
                    '<div class="ah-epcopy">'+
                        '<div class="ah-epname">'+
                            'Серия '+
                            esc(ep)+
                        '</div>'+
                        '<div class="ah-epmeta">'+
                            esc(
                                groups.length+
                                ' источн.'+
                                (
                                    groups[0]
                                        ?' • '+
                                        groups[0].title
                                        :''
                                )
                            )+
                        '</div>'+
                    '</div>'
                );

                if(
                    Math.abs(
                        current-
                        num(
                            ep,
                            0
                        )
                    )<
                    0.0001&&
                    num(
                        state.duration,
                        0
                    )>0&&
                    num(
                        state.position,
                        0
                    )>0
                ){
                    var p=
                        state.completed
                            ?100
                            :Math.max(
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
                        '<div class="ah-progress">'+
                            '<span style="width:'+
                                p+
                                '%"></span>'+
                        '</div>'
                    );
                }

                card.on(
                    'hover:enter click',

                    function(e){
                        if(e){
                            e.preventDefault();
                        }

                        chooseSourceForEpisode(
                            anime,
                            videos,
                            ep,
                            true
                        );
                    }
                );

                row.append(
                    card
                );
            }
        );

        episodeBox
            .empty()
            .append(
                head,
                row
            );

        bindFocus(
            root,
            view,
            focus
        );

        refreshWatchButtons();
    }

    function loadEpisodes(){
        if(videos){
            renderEpisodes(
                videos
            );

            return;
        }

        episodeBox.html(
            '<div class="ah-eptitle">'+
                'Эпизоды'+
            '</div>'+
            '<div class="ah-placeholder">'+
                '<div class="ah-spinner"></div>'+
                'Загружаем серии…'+
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
                            'Не удалось загрузить серии. '+
                            '<div class="ah-lazybtn selector">'+
                                'Повторить'+
                            '</div>'+
                        '</div>'
                    );

                    episodeBox.find(
                        '.ah-lazybtn'
                    )
                    .on(
                        'hover:enter click',
                        loadEpisodes
                    );

                    bindFocus(
                        root,
                        view,
                        focus
                    );
                }
            },

            false
        );
    }

    function loadRecommendations(){
        if(
            recommendationBox.data(
                'loaded'
            )
        ){
            return;
        }

        recommendationBox.data(
            'loaded',
            1
        );

        recommendationBox.html(
            '<div class="ah-placeholder">'+
                '<div class="ah-spinner"></div>'+
                'Загружаем похожие аниме…'+
            '</div>'
        );

        var req=
            new Lampa.Reguest();

        requestCached(
            req,

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

                recommendationBox.empty();

                if(
                    data.items&&
                    data.items.length
                ){
                    shelf(
                        recommendationBox,
                        'Похожие аниме',
                        data.items
                    );
                }
                else{
                    recommendationBox.append(
                        '<div class="ah-empty">'+
                            'Похожих аниме не найдено.'+
                        '</div>'
                    );
                }

                bindFocus(
                    root,
                    view,
                    focus
                );

                try{
                    req.clear();
                }
                catch(e){}
            },

            function(){
                recommendationBox.html(
                    '<div class="ah-empty">'+
                        'Не удалось загрузить похожие аниме.'+
                    '</div>'
                );

                try{
                    req.clear();
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

        saveRecent(
            a
        );

        root
            .empty()
            .append(
                topbar('')
            );

        var hero=
            $('<div class="ah-detail"></div>');

        var bg=
            a.background||
            a.posterHero||
            a.poster||
            '';

        if(bg){
            putBackground(
                hero,
                bg
            );
        }

        hero.append(
            '<div class="ah-shade"></div>'
        );

        var wrap=
            $('<div class="ah-detail-copywrap"></div>');

        var poster=
            $('<div class="ah-detail-poster"></div>');

        putImage(
            poster,
            a.posterDetail||
            a.poster,
            a.title,
            true
        );

        var main=
            $('<div class="ah-detail-main"></div>');

        main.append(
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
            main.append(
                '<div class="ah-original">'+
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
                '<span class="ah-chip ah-score">'+
                    '★ '+
                    esc(
                        score(
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
                '<span class="ah-chip">'+
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

        main.append(
            meta
        );

        if(
            a.studios&&
            a.studios.length
        ){
            main.append(
                '<div class="ah-studio">'+
                    'Студия: '+
                    esc(
                        a.studios
                            .map(
                                function(x){
                                    return x.title;
                                }
                            )
                            .join(
                                ', '
                            )
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
            6
        )
        .forEach(
            function(g){
                genres.append(
                    '<span class="ah-chip">'+
                        esc(
                            g.title
                        )+
                    '</span>'
                );
            }
        );

        main.append(
            genres
        );

        var description=
            cleanDescription(
                a.description||
                ''
            );

        main.append(
            '<div class="ah-description">'+
                esc(
                    description
                        ?clip(
                            description,
                            500
                        )
                        :'Описание пока отсутствует.'
                )+
            '</div>'
        );

        var actions=
            $('<div class="ah-actions"></div>');

        watchButton=
            $(
                '<div class="ah-button primary selector">'+
                    '▶ Смотреть'+
                '</div>'
            )
            .on(
                'hover:enter click',

                function(e){
                    if(e){
                        e.preventDefault();
                    }

                    watchAnime(
                        anime,
                        videos
                    );
                }
            );

        sourceButton=
            $(
                '<div class="ah-button selector">'+
                    '🎧 Озвучка / источник'+
                '</div>'
            )
            .on(
                'hover:enter click',

                function(e){
                    if(e){
                        e.preventDefault();
                    }

                    changeSource(
                        anime,
                        videos
                    );
                }
            );

        var fav=
            $('<div class="ah-button selector"></div>');

        function refreshFav(){
            fav.text(
                isFavorite(
                    anime
                )
                    ?'★ В избранном'
                    :'☆ В избранное'
            );
        }

        refreshFav();

        fav.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                notify(
                    toggleFavorite(
                        anime
                    )
                        ?'Добавлено в избранное'
                        :'Удалено из избранного'
                );

                refreshFav();
            }
        );

        actions.append(
            watchButton,
            sourceButton,
            fav
        );

        main.append(
            actions
        );

        wrap.append(
            poster,
            main,
            infoPanel(a)
        );

        hero.append(
            wrap
        );

        root.append(
            hero
        );

        episodeBox=
            $('<div class="ah-shelf"></div>');

        episodeBox.append(
            '<div class="ah-eptitle">'+
                'Эпизоды'+
            '</div>'+
            '<div class="ah-placeholder">'+
                '<span>'+
                    'Серии загружаются только когда нужны — быстрее для TV.'+
                '</span>'+
                '<div class="ah-lazybtn selector">'+
                    'Загрузить серии'+
                '</div>'+
            '</div>'
        );

        episodeBox.find(
            '.ah-lazybtn'
        )
        .on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                loadEpisodes();
            }
        );

        root.append(
            episodeBox
        );

        if(
            a.screenshots&&
            a.screenshots.length
        ){
            root.append(
                '<div class="ah-block-title">'+
                    'Кадры'+
                '</div>'
            );

            var shots=
                $('<div class="ah-shots"></div>');

            a.screenshots
                .slice(
                    0,
                    4
                )
                .forEach(
                    function(s){
                        var box=
                            $('<div class="ah-shot"></div>');

                        putImage(
                            box,
                            s.small||
                            s.full,
                            'Кадр',
                            false
                        );

                        shots.append(
                            box
                        );
                    }
                );

            root.append(
                shots
            );
        }

        if(
            description.length>
            500
        ){
            root.append(
                '<div class="ah-block-title">'+
                    'Описание'+
                '</div>'+
                '<div class="ah-longdesc">'+
                    esc(
                        description
                    )+
                '</div>'
            );
        }

        recommendationBox=
            $('<div class="ah-shelf"></div>');

        recommendationBox.append(
            '<div class="ah-block-title">'+
                'Похожие аниме'+
            '</div>'+
            '<div class="ah-placeholder">'+
                '<span>'+
                    'Не загружены автоматически.'+
                '</span>'+
                '<div class="ah-lazybtn selector">'+
                    'Показать похожие'+
                '</div>'+
            '</div>'
        );

        recommendationBox.find(
            '.ah-lazybtn'
        )
        .on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                loadRecommendations();
            }
        );

        root.append(
            recommendationBox
        );

        refreshWatchButtons();

        bindFocus(
            root,
            view,
            focus
        );

        setTimeout(
            function(){
                var first=
                    root.find(
                        '.ah-button.selector'
                    )[0]||
                    root.find(
                        '.selector'
                    )[0];

                if(first){
                    focus.last=
                        first;

                    try{
                        Lampa.Controller.collectionSet(
                            root
                        );

                        Lampa.Controller.collectionFocus(
                            first,
                            root
                        );
                    }
                    catch(e){}
                }
            },

            25
        );
    }

    this.create=function(){
        alive=true;

        view.append(
            root
        );

        root.append(
            topbar(''),

            loaderHtml(
                'Загрузка карточки…'
            )
        );

        requestCached(
            net,

            'detail:'+
            String(
                initial.id||
                ''
            ),

            480000,

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
                        'Не удалось загрузить карточку'+
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
            focus,

            function(){
                Lampa.Activity.backward();
            }
        );

        refreshWatchButtons();
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

    var focus={
        last:null
    };

    function render(data){
        if(!alive){
            return;
        }

        root
            .empty()
            .append(
                topbar(
                    'schedule'
                ),

                '<div class="ah-head">'+
                    '<div class="ah-page-title">'+
                        'Расписание'+
                    '</div>'+
                    '<div class="ah-page-sub">'+
                        'Ближайшие выходы серий'+
                    '</div>'+
                '</div>'
            );

        var grid=
            $('<div class="ah-schgrid"></div>');

        (
            data.items||
            []
        )
        .slice(
            0,
            20
        )
        .forEach(
            function(a){
                var card=
                    $('<div class="ah-sch selector"></div>');

                if(a.poster){
                    putImage(
                        card,
                        a.poster,
                        a.title,
                        false
                    );
                }

                card.append(
                    '<div class="ah-schcopy">'+
                        '<div class="ah-schtitle">'+
                            esc(
                                a.title
                            )+
                        '</div>'+
                        '<div class="ah-smallmeta">'+
                            esc(
                                formatDate(
                                    a.episodes&&
                                    a.episodes.nextDate,
                                    true
                                )
                            )+
                        '</div>'+
                    '</div>'
                );

                card.on(
                    'hover:enter click',

                    function(e){
                        if(e){
                            e.preventDefault();
                        }

                        openDetail(
                            a
                        );
                    }
                );

                grid.append(
                    card
                );
            }
        );

        root.append(
            grid
        );

        bindFocus(
            root,
            view,
            focus
        );

        focusFirst(
            root,
            focus
        );
    }

    this.create=function(){
        alive=true;

        view.append(
            root
        );

        root.append(
            topbar(
                'schedule'
            ),

            loaderHtml(
                'Загрузка расписания…'
            )
        );

        requestCached(
            net,
            'schedule',
            600000,
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
                focus,

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

    var focus={
        last:null
    };

    function render(){
        if(!alive){
            return;
        }

        var items=
            storedList(
                FAVORITES_KEY
            );

        root
            .empty()
            .append(
                topbar(
                    'favorites'
                ),

                '<div class="ah-head">'+
                    '<div class="ah-page-title">'+
                        'Избранное'+
                    '</div>'+
                    '<div class="ah-page-sub">'+
                        items.length+
                        ' тайтлов'+
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

            items
                .slice(
                    0,
                    20
                )
                .forEach(
                    function(a){
                        grid.append(
                            posterCard(
                                a
                            )
                        );
                    }
                );

            root.append(
                grid
            );
        }

        bindFocus(
            root,
            view,
            focus
        );

        focusFirst(
            root,
            focus
        );
    }

    this.create=function(){
        alive=true;

        view.append(
            root
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
                focus,

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
 * MENU + BOOT
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
        'hover:enter click',
        openHome
    );

    $('.menu .menu__list')
        .eq(0)
        .append(
            button
        );
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
            ' TV Fast загружен'
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
