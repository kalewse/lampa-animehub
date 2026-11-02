(function(){
'use strict';

/*
 * AnimeHub V1.1.0 Lite
 * YummyAnime-first
 * LG WebOS performance-oriented
 */

var VERSION='1.1.0';
var NS='animehub_v110';

var HOME=NS+'_home';
var CATALOG=NS+'_catalog';
var DETAIL=NS+'_detail';
var SCHEDULE=NS+'_schedule';
var FAVORITES=NS+'_favorites';

var FAVORITES_KEY='animehub_v010_favorites';
var RECENT_KEY='animehub_v010_recent';
var WATCH_KEY='animehub_v020_watch';

var WORKER=
    'https://animehub-lampa.kalewse69.workers.dev/';

var cache={};
var cacheOrder=[];
var CACHE_MAX=36;

var videoCache={};
var videoOrder=[];
var VIDEO_CACHE_MAX=6;

var videoInflight={};
var genresCache=null;


/* ============================================================
 * BASICS
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

function desc(v){
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

function clip(v,l){
    v=clean(v);

    return !l||
        v.length<=l
        ?v
        :v
            .slice(0,l)
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
    v=parseInt(
        v,
        10
    );

    return isNaN(v)
        ?(d||0)
        :v;
}

function score(v){
    v=num(v);

    return v
        ?v
            .toFixed(2)
            .replace(/0$/,'')
            .replace(/\.0$/,'')
        :'—';
}

function status(v){
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

function epCount(a){
    var e=
        a&&
        a.episodes||
        {};

    var x=
        intv(
            e.aired
        );

    var y=
        intv(
            e.count
        );

    if(
        y&&
        x&&
        x<y
    ){
        return (
            x+
            ' / '+
            y
        );
    }

    if(y){
        return String(y);
    }

    if(x){
        return String(x);
    }

    return '—';
}

function formatDate(
    ts,
    time
){
    ts=num(ts);

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

        if(time){
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
    p
){
    var q=[];

    var base=
        WORKER.replace(
            /\/?$/,
            '/'
        );

    p=p||{};

    Object.keys(p)
        .forEach(
            function(k){
                var v=
                    p[k];

                if(
                    v!==undefined&&
                    v!==null&&
                    String(v)!==''
                ){
                    q.push(
                        encodeURIComponent(k)+
                        '='+
                        encodeURIComponent(
                            String(v)
                        )
                    );
                }
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

        function(r){
            var d=
                parseJson(r);

            if(
                !d||
                d.ok===false
            ){
                if(fail){
                    fail({
                        message:
                            d&&
                            d.error||
                            'Ошибка AnimeHub Worker',

                        data:d
                    });
                }

                return;
            }

            ok(d);
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
    var h=
        cache[key];

    if(
        h&&
        Date.now()-
        h.at<
        age
    ){
        setTimeout(
            function(){
                ok(
                    h.data
                );
            },
            0
        );

        return;
    }

    requestJson(
        net,
        url,

        function(d){
            remember(
                key,
                d
            );

            ok(d);
        },

        fail
    );
}


/* ============================================================
 * TORII
 * ============================================================ */

function torii(cls){
    return (
        '<svg class="'+
        esc(cls||'')+
        '" viewBox="0 0 96 96" '+
        'xmlns="http://www.w3.org/2000/svg">'+

        '<defs>'+
            '<linearGradient id="aht" x1="0" y1="0" x2="1" y2="1">'+
                '<stop offset="0" stop-color="#a970ff"/>'+
                '<stop offset="1" stop-color="#ed5fd4"/>'+
            '</linearGradient>'+
        '</defs>'+

        '<path fill="url(#aht)" d="'+
            'M13 20h70l-3.4 10.5c-20.9 4.1-42.3 4.1-63.2 0L13 20z'+
            'm8 17h54v8H21v-8z'+
            'm8 11h9v29h-9V48z'+
            'm29 0h9v29h-9V48z'+
            'm-34 29h19v7H24v-7z'+
            'm29 0h19v7H53v-7z'+
        '"/>'+
        '</svg>'
    );
}

function loader(t){
    return (
        '<div class="ah-loader">'+
            '<div class="ah-loader-ring"></div>'+
            torii(
                'ah-loader-logo'
            )+
            '<div>'+
                esc(
                    t||
                    'Загрузка…'
                )+
            '</div>'+
        '</div>'
    );
}


/* ============================================================
 * LOCAL STORAGE
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

function compact(a){
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

function same(a,b){
    return (
        !!a&&
        !!b&&
        (
            (
                a.source==='yummy'&&
                b.source==='yummy'&&
                String(a.id)===
                String(b.id)
            )||
            (
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
            )
        )
    );
}

function isFav(a){
    return storedList(
        FAVORITES_KEY
    )
    .some(
        function(x){
            return same(
                x,
                a
            );
        }
    );
}

function toggleFav(a){
    var l=
        storedList(
            FAVORITES_KEY
        );

    var found=false;
    var out=[];

    l.forEach(
        function(x){
            if(
                same(
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
            compact(a)
        );
    }

    setStored(
        FAVORITES_KEY,
        out
    );

    return !found;
}

function recent(a){
    if(
        !a||
        !a.id
    ){
        return;
    }

    var out=[
        compact(a)
    ];

    storedList(
        RECENT_KEY
    )
    .forEach(
        function(x){
            if(
                out.length<
                18&&
                !same(
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
            a&&a.id||
            ''
        )
    );
}

function watch(a){
    return (
        watchStore()[
            watchKey(a)
        ]||
        {}
    );
}

function saveWatch(
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

    var k=
        watchKey(a);

    var v=
        store[k]||
        {};

    Object.keys(
        patch||
        {}
    )
    .forEach(
        function(x){
            v[x]=
                patch[x];
        }
    );

    v.source=
        'yummy';

    v.anime=
        compact(a);

    v.updatedAt=
        Date.now();

    store[k]=v;

    setStored(
        WATCH_KEY,
        store
    );
}

function continueStates(){
    var s=
        watchStore();

    return Object.keys(s)
        .map(
            function(k){
                return s[k];
            }
        )
        .filter(
            function(x){
                return (
                    x&&
                    x.source===
                    'yummy'&&
                    x.anime&&
                    intv(
                        x.episode
                    )>0
                );
            }
        )
        .sort(
            function(a,b){
                return (
                    num(
                        b.updatedAt
                    )-
                    num(
                        a.updatedAt
                    )
                );
            }
        )
        .slice(
            0,
            7
        );
}


/* ============================================================
 * STYLE
 * ============================================================ */

function style(){
    if(
        $('#animehub-v110-style')
            .length
    ){
        return;
    }

    $('head').append(`
<style id="animehub-v110-style">
:root{
    --ah:#080a15;
    --panel:#12162a;
    --text:#faf8ff;
    --muted:#aaa7bb;
    --purple:#8c58f8;
    --pink:#e65ed1
}

.ah-view{
    height:calc(100vh - 6.1em);
    overflow-y:auto;
    overflow-x:hidden;
    color:var(--text);
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
    padding:0 1.8em 4em;
    box-sizing:border-box;
    min-height:100%
}

.ah-top{
    height:4.25em;
    display:flex;
    align-items:center;
    gap:.9em
}

.ah-brand{
    display:flex;
    align-items:center;
    gap:.45em;
    font-size:1.45em;
    font-weight:900;
    padding-right:1em;
    border-right:1px solid rgba(255,255,255,.13)
}

.ah-logo{
    width:1.9em;
    height:1.9em
}

.ah-name{
    background:linear-gradient(90deg,#fff,#dc8cff);
    -webkit-background-clip:text;
    color:transparent
}

.ah-nav{
    display:flex;
    gap:.18em
}

.ah-navbtn{
    padding:.55em .72em;
    border-radius:.55em;
    white-space:nowrap
}

.ah-navbtn.active{
    background:rgba(131,75,235,.24)
}

.ah-navbtn.focus{
    background:#8a56ec;
    color:#fff
}

.ah-hero{
    height:39vh;
    min-height:21em;
    max-height:28em;
    position:relative;
    overflow:hidden;
    border-radius:.85em;
    margin-bottom:1.25em;
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
            rgba(4,6,15,.94) 30%,
            rgba(4,6,15,.69) 53%,
            rgba(4,6,15,.20) 78%,
            rgba(4,6,15,.06) 100%
        ),
        linear-gradient(
            0deg,
            rgba(4,6,15,.85),
            transparent 60%
        )
}

.ah-hero-copy{
    position:absolute;
    left:3.2%;
    top:8%;
    bottom:8%;
    width:53%;
    display:flex;
    flex-direction:column;
    justify-content:center
}

.ah-kicker{
    color:#df8cff;
    font-size:.72em;
    font-weight:800;
    letter-spacing:.09em;
    text-transform:uppercase;
    margin-bottom:.5em
}

.ah-title{
    font-size:2.75em;
    font-weight:900;
    line-height:1.02;
    text-shadow:0 2px 6px #000
}

.ah-original{
    color:#b9b5c6;
    margin:.22em 0 .55em
}

.ah-meta{
    display:flex;
    flex-wrap:wrap;
    gap:.38em;
    margin:.35em 0
}

.ah-chip{
    font-size:.76em;
    padding:.26em .52em;
    border-radius:999px;
    background:rgba(255,255,255,.095);
    border:1px solid rgba(255,255,255,.11)
}

.ah-score{
    color:#ffd76a
}

.ah-description{
    font-size:.94em;
    line-height:1.48;
    color:#f5f3fa;
    max-width:46em;
    margin:.55em 0 .9em;
    text-shadow:0 2px 4px #000
}

.ah-actions{
    display:flex;
    gap:.55em
}

.ah-button,
.ah-filter,
.ah-pagebtn,
.ah-all{
    padding:.64em .9em;
    border-radius:.55em;
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
.ah-all.focus{
    background:#fff;
    color:#090b14;
    transform:scale(1.025)
}

.ah-shelf{
    margin-bottom:1.15em
}

.ah-shelf-title,
.ah-block-title,
.ah-eptitle{
    font-size:1.22em;
    font-weight:850;
    margin:0 0 .5em
}

.ah-row,
.ah-eprow,
.ah-shots{
    display:flex;
    gap:.68em;
    overflow-x:auto;
    overflow-y:hidden;
    padding:.2em .15em .6em
}

.ah-wide{
    position:relative;
    flex:0 0 14.3em;
    height:6.55em;
    border-radius:.62em;
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
        rgba(5,7,16,.98),
        rgba(5,7,16,.08) 80%
    )
}

.ah-wide-copy{
    position:absolute;
    left:.55em;
    right:.55em;
    bottom:.45em
}

.ah-wide-title{
    font-weight:780;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-smallmeta{
    font-size:.65em;
    color:#c9c6d3;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-badge{
    position:absolute;
    left:.42em;
    top:.38em;
    font-size:.60em;
    font-weight:850;
    padding:.2em .38em;
    border-radius:.35em;
    background:#7d49e9
}

.ah-progress{
    position:absolute;
    left:0;
    right:0;
    bottom:0;
    height:.18em;
    background:rgba(255,255,255,.11)
}

.ah-progress span{
    display:block;
    height:100%;
    background:linear-gradient(90deg,#8d59ff,#e85fd0)
}

.ah-wide.focus,
.ah-poster.focus,
.ah-ep.focus,
.ah-sch.focus{
    border-color:#dab8ff;
    outline:2px solid rgba(158,100,255,.36);
    transform:scale(1.03);
    z-index:4
}

.ah-head{
    padding:.45em 0 .85em
}

.ah-page-title{
    font-size:1.9em;
    font-weight:900
}

.ah-page-sub{
    color:#9996aa;
    font-size:.82em
}

.ah-catalog{
    display:flex;
    gap:1em;
    align-items:flex-start
}

.ah-side{
    width:10.5em;
    min-width:10.5em;
    padding:.5em;
    border-radius:.7em;
    background:#0e1222
}

.ah-filter{
    width:100%;
    margin:.17em 0;
    font-size:.80em
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
    grid-template-columns:repeat(6,minmax(0,1fr));
    gap:.7em
}

.ah-poster{
    min-width:0;
    padding:.2em;
    border-radius:.64em
}

.ah-poster-media{
    height:12.5em;
    position:relative;
    border-radius:.52em;
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
    font-size:.78em;
    font-weight:730;
    height:2.15em;
    overflow:hidden;
    margin:.42em .02em .10em
}

.ah-poster-meta{
    font-size:.62em;
    color:#8f8ca1;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-poster-score{
    position:absolute;
    right:.35em;
    bottom:.35em;
    font-size:.65em;
    padding:.18em .32em;
    background:rgba(5,7,15,.88);
    border-radius:.32em;
    color:#ffd76a
}

.ah-pages{
    display:flex;
    gap:.55em;
    margin-top:1em
}

.ah-detail{
    position:relative;
    min-height:28em;
    border-radius:.85em;
    overflow:hidden;
    isolation:isolate;
    background:#0d1120;
    margin-bottom:1em
}

.ah-detail-copywrap{
    display:flex;
    gap:1em;
    padding:1.25em;
    align-items:center;
    min-height:27em;
    box-sizing:border-box
}

.ah-detail-poster{
    width:11.2em;
    min-width:11.2em;
    height:16.6em;
    border-radius:.65em;
    overflow:hidden;
    background:#15192b;
    border:1px solid rgba(255,255,255,.13)
}

.ah-detail-main{
    flex:1;
    min-width:0;
    padding:.75em .85em;
    border-radius:.65em;
    background:linear-gradient(
        90deg,
        rgba(4,6,15,.70),
        rgba(4,6,15,.25),
        transparent
    )
}

.ah-detail-title{
    font-size:2.25em;
    font-weight:900;
    line-height:1.05;
    text-shadow:0 2px 6px #000
}

.ah-aside{
    width:15.2em;
    min-width:15.2em;
    background:rgba(9,12,25,.82);
    border:1px solid rgba(255,255,255,.09);
    border-radius:.7em;
    padding:.75em
}

.ah-aside-title{
    font-weight:850;
    margin-bottom:.2em
}

.ah-info{
    display:flex;
    justify-content:space-between;
    gap:.5em;
    font-size:.76em;
    padding:.46em 0;
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
    font-size:.78em;
    color:#cbc7d5;
    margin:.15em 0
}

.ah-longdesc{
    background:#101426;
    border:1px solid rgba(255,255,255,.06);
    border-radius:.65em;
    padding:.85em;
    line-height:1.5;
    color:#d5d2de;
    margin-bottom:1em
}

.ah-ephead{
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom:.45em
}

.ah-epcount{
    font-size:.7em;
    color:#bbb7c8;
    background:rgba(255,255,255,.07);
    padding:.2em .45em;
    border-radius:99px;
    margin-left:.5em
}

.ah-ep{
    position:relative;
    flex:0 0 10.2em;
    height:5.85em;
    border-radius:.6em;
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
    left:.4em;
    top:.35em;
    font-size:.7em;
    font-weight:850;
    background:rgba(5,7,16,.88);
    padding:.2em .34em;
    border-radius:.3em
}

.ah-epcopy{
    position:absolute;
    left:.45em;
    right:.45em;
    bottom:.38em
}

.ah-epname{
    font-size:.7em;
    font-weight:760
}

.ah-epmeta{
    font-size:.58em;
    color:#c6c2d0;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-placeholder{
    padding:.8em;
    border-radius:.65em;
    background:#101426;
    color:#bbb7c8;
    display:flex;
    gap:.55em;
    align-items:center
}

.ah-spinner{
    width:1.1em;
    height:1.1em;
    border-radius:50%;
    border:2px solid rgba(187,125,255,.15);
    border-top-color:#c878ff;
    animation:spin .9s linear infinite
}

.ah-shot{
    flex:0 0 15.5em;
    height:8.7em;
    border-radius:.6em;
    overflow:hidden;
    background:#14182a
}

.ah-schgrid{
    display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:.7em
}

.ah-sch{
    height:6.2em;
    position:relative;
    border-radius:.6em;
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
    left:.5em;
    right:.5em;
    bottom:.42em;
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
    font-size:.76em;
    font-weight:760;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis
}

.ah-empty{
    padding:1.5em;
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
    font-size:.75em;
    padding:.4em;
    box-sizing:border-box
}

.ah-loader{
    min-height:20em;
    display:flex;
    position:relative;
    flex-direction:column;
    justify-content:center;
    align-items:center;
    gap:.7em;
    color:#bbb7c8
}

.ah-loader-logo{
    width:4.5em;
    height:4.5em
}

.ah-loader-ring{
    position:absolute;
    width:5.8em;
    height:5.8em;
    border:2px solid rgba(180,110,255,.12);
    border-top-color:#cc76ff;
    border-radius:50%;
    animation:spin 1s linear infinite
}

@keyframes spin{
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
        font-size:2em
    }

    .ah-side{
        width:9.6em;
        min-width:9.6em
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
 * NAVIGATION
 * ============================================================ */

function selectors(root){
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

function reveal(
    view,
    el
){
    if(
        !view||
        !view[0]||
        !el
    ){
        return;
    }

    var c=
        view[0];

    var r=
        el.getBoundingClientRect();

    var v=
        c.getBoundingClientRect();

    if(
        r.bottom>
        v.bottom-
        20
    ){
        c.scrollTop+=
            r.bottom-
            v.bottom+
            20;
    }
    else if(
        r.top<
        v.top+
        10
    ){
        c.scrollTop-=
            v.top+
            10-
            r.top;
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
                r.right>
                pr.right-
                12
            ){
                p.scrollLeft+=
                    r.right-
                    pr.right+
                    12;
            }
            else if(
                r.left<
                pr.left+
                12
            ){
                p.scrollLeft-=
                    pr.left+
                    12-
                    r.left;
            }

            break;
        }

        p=
            p.parentElement;
    }
}

function navFor(
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

        reveal(
            view,
            el
        );
    }

    function move(dir){
        var all=
            selectors(root);

        var cur=
            last||
            root.find(
                '.selector.focus'
            )[0]||
            all[0];

        if(!cur){
            return;
        }

        var cr=
            cur.getBoundingClientRect();

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

        all.forEach(
            function(x){
                if(x===cur){
                    return;
                }

                var r=
                    x.getBoundingClientRect();

                var dx=
                    r.left+
                    r.width/
                    2-
                    cx;

                var dy=
                    r.top+
                    r.height/
                    2-
                    cy;

                if(
                    dir==='left'&&
                    dx>=-3
                ){
                    return;
                }

                if(
                    dir==='right'&&
                    dx<=3
                ){
                    return;
                }

                if(
                    dir==='up'&&
                    dy>=-3
                ){
                    return;
                }

                if(
                    dir==='down'&&
                    dy<=3
                ){
                    return;
                }

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

                var sc=
                    main+
                    cross*
                    2;

                if(sc<bestScore){
                    bestScore=sc;
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

                reveal(
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

function controller(
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
 * ROUTES / MENU BAR
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

        function(r){
            try{
                Lampa.Controller.toggle(
                    'content'
                );
            }
            catch(e){}

            var q=
                clean(
                    r&&
                    typeof r==='object'
                        ?r.value
                        :r
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

function selectBox(
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

        onSelect:function(x){
            settled=true;

            if(onSelect){
                onSelect(x);
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

function loadGenres(cb){
    if(genresCache){
        cb(
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

        function(d){
            genresCache=
                d.genres||
                [];

            cb(
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
        function(g){
            selectBox(
                'Жанры',

                g.map(
                    function(x){
                        return {
                            title:x.title,
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

function chooseYear(){
    var a=[];

    var y=
        new Date()
            .getFullYear()+
        1;

    for(
        ;
        y>=1970;
        y--
    ){
        a.push({
            title:String(y),
            value:String(y)
        });
    }

    selectBox(
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

function chooseType(){
    selectBox(
        'Тип',

        [
            ['TV-сериалы','tv'],
            ['Фильмы','movie'],
            ['OVA','ova'],
            ['ONA','ona'],
            ['Спецвыпуски','special']
        ]
        .map(
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
    homeAction
){
    var bar=
        $('<div class="ah-top"></div>');

    var brand=
        $('<div class="ah-brand"></div>')
        .append(
            torii(
                'ah-logo'
            ),

            '<span class="ah-name">'+
                'AnimeHub'+
            '</span>'
        );

    var nav=
        $('<div class="ah-nav"></div>');

    function add(
        k,
        t,
        a
    ){
        var b=
            $('<div class="ah-navbtn selector"></div>')
            .text(t);

        if(active===k){
            b.addClass(
                'active'
            );
        }

        b.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                a();
            }
        );

        nav.append(b);
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
 * OPEN DETAIL
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
                compact(a)
        });

        return;
    }

    /*
     * Legacy V0.3 favourite:
     * resolve old Shikimori item by title once opened.
     */
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

            function(d){
                var items=
                    d.items||
                    [];

                var best=
                    items[0];

                if(a.year){
                    items.some(
                        function(x){
                            if(
                                intv(
                                    x.year
                                )===
                                intv(
                                    a.year
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
                    openDetail(best);
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
    var c=
        $('<div class="ah-wide selector"></div>');

    var bg=
        a.background||
        a.posterHero||
        a.poster||
        '';

    if(bg){
        putImage(
            c,
            bg,
            a.title,
            false
        );
    }

    c.append(
        '<div class="ah-cardshade"></div>'
    );

    if(
        a.status&&
        a.status.alias===
        'ongoing'
    ){
        c.append(
            '<div class="ah-badge">'+
                'ОНГОИНГ'+
            '</div>'
        );
    }

    var m=[
        a.year||'',
        typeLabel(a),

        num(
            a.score
        )>0
            ?'★ '+
            score(
                a.score
            )
            :'',

        a.episodes&&
        a.episodes.aired
            ?intv(
                a.episodes.aired
            )+
            ' сер.'
            :''
    ]
    .filter(Boolean);

    if(
        state&&
        state.episode
    ){
        m.unshift(
            'Серия '+
            state.episode
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
            '<div class="ah-smallmeta">'+
                esc(
                    m.join(
                        ' • '
                    )
                )+
            '</div>'+
        '</div>'
    );

    if(
        state&&
        num(
            state.duration
        )>0&&
        num(
            state.position
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
                            state.position
                        )/
                        num(
                            state.duration,
                            1
                        )*
                        100
                    )
                )
            );

        c.append(
            '<div class="ah-progress">'+
                '<span style="width:'+
                    p+
                    '%"></span>'+
            '</div>'
        );
    }

    c.on(
        'hover:enter click',

        function(e){
            if(e){
                e.preventDefault();
            }

            openDetail(a);
        }
    );

    return c;
}

function posterCard(a){
    var c=
        $('<div class="ah-poster selector"></div>');

    var m=
        $('<div class="ah-poster-media"></div>');

    putImage(
        m,
        a.poster,
        a.title,
        false
    );

    if(
        num(
            a.score
        )>0
    ){
        m.append(
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
                    typeLabel(a)
                ]
                .filter(Boolean)
                .join(' • ')
            )+
        '</div>'
    );

    c.on(
        'hover:enter click',

        function(e){
            if(e){
                e.preventDefault();
            }

            openDetail(a);
        }
    );

    return c;
}

function shelf(
    root,
    title,
    items,
    map
){
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

    var row=
        $('<div class="ah-row"></div>');

    items
        .slice(
            0,
            7
        )
        .forEach(
            function(a){
                row.append(
                    wideCard(
                        a,

                        map&&
                        map[
                            String(a.id)
                        ]
                    )
                );
            }
        );

    root.append(
        s.append(row)
    );
}

function continueShelf(root){
    var states=
        continueStates();

    if(!states.length){
        return;
    }

    var m={};

    var items=
        states.map(
            function(x){
                m[
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
        m
    );
}


/* ============================================================
 * RAW YUMMYANIME VIDEO HELPERS
 *
 * Keep the API record itself intact.
 * This mirrors how the official plugin groups the records.
 * ============================================================ */

function videoData(video){
    var v=
        video&&
        video.data;

    if(!v){
        return {};
    }

    if(
        typeof v==='object'
    ){
        return v;
    }

    if(
        typeof v==='string'
    ){
        try{
            return JSON.parse(v)||
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
    v,
    index
){
    var x=
        v&&
        (
            v.number!=null
                ?v.number
                :(
                    v.episode!=null
                        ?v.episode
                        :v.index
                )
        );

    if(
        x===undefined||
        x===null||
        x===''
    ){
        x=
            index+
            1;
    }

    var m=
        String(x)
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
        :String(x);
}

function groupPart(v){
    return clean(v)
        .toLowerCase();
}

function voicePart(v){
    return groupPart(v)
        .replace(
            /^\ufeff/,
            ''
        )
        .replace(
            /^(озвучка|дубляж|dub|dubbing)\s+/,
            ''
        );
}

function sourceKind(
    url,
    group
){
    var d=
        videoData(group);

    var v=
        (
            String(
                url||
                ''
            )+
            ' '+
            String(
                group&&
                group.player||
                ''
            )+
            ' '+
            String(
                d.player||
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
            .test(v)
    ){
        return 'cvh';
    }

    if(
        /iframevk|vkvideo|vk\.com|video_ext\.php|(?:^|\s)vk(?:\s|$)/i
            .test(v)
    ){
        return 'vk';
    }

    if(
        /kodik/i
            .test(v)
    ){
        return 'kodik';
    }

    if(
        /aksor/i
            .test(v)
    ){
        return 'aksor';
    }

    if(
        /rutube/i
            .test(v)
    ){
        return 'rutube';
    }

    return 'unsupported';
}

function groupVideos(videos){
    var groups={};

    (
        videos||
        []
    )
    .forEach(
        function(v,index){
            var url=
                videoSourceUrl(v);

            if(!url){
                return;
            }

            /*
             * One normalized URL field is useful,
             * but we do not replace the original object.
             */
            v.iframe_url=
                url;

            v._ahEpisode=
                episodeValue(
                    v,
                    index
                );

            var d=
                videoData(v);

            var title=
                d.dubbing||
                d.translation||
                d.voice||
                d.player||
                'Источник';

            var host=
                videoHost(url);

            var provider=
                d.player_id||
                d.player||
                d.source||
                d.service||
                host;

            var key=
                voicePart(title)+
                '|'+
                groupPart(provider);

            if(!groups[key]){
                groups[key]={
                    key:key,
                    title:title,

                    player:
                        d.player||
                        d.source||
                        d.service||
                        host,

                    source:
                        host,

                    videos:[]
                };
            }

            groups[key]
                .videos
                .push(v);
        }
    );

    return Object.keys(groups)
        .map(
            function(k){
                var g=
                    groups[k];

                g.videos.sort(
                    function(a,b){
                        var x=
                            num(
                                a._ahEpisode,
                                99999
                            );

                        var y=
                            num(
                                b._ahEpisode,
                                99999
                            );

                        return (
                            x-
                            y||
                            intv(
                                a.index
                            )-
                            intv(
                                b.index
                            )
                        );
                    }
                );

                g.kind=
                    sourceKind(
                        videoSourceUrl(
                            g.videos[0]
                        ),
                        g.videos[0]
                    );

                return g;
            }
        )
        .sort(
            function(a,b){
                var p={
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
                        p[b.kind]||
                        0
                    )-
                    (
                        p[a.kind]||
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
        function(v,index){
            var x=
                episodeValue(
                    v,
                    index
                );

            var k=
                String(x);

            if(!seen[k]){
                seen[k]=1;
                out.push(x);
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
        function(v){
            if(
                String(
                    v._ahEpisode
                )===
                String(ep)||
                Math.abs(
                    num(
                        v._ahEpisode,
                        -999
                    )-
                    num(
                        ep,
                        -998
                    )
                )<
                .0001
            ){
                found=v;
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
    return groupVideos(videos)
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
 *
 * One request per title at a time.
 * This prevents the detail episode rail and Watch button from
 * starting duplicate large /videos requests.
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

    videoOrder.push(id);

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

    var c=
        videoCache[id];

    if(
        c&&
        Date.now()-
        c.at<
        120000
    ){
        setTimeout(
            function(){
                ok(
                    c.videos
                );
            },
            0
        );

        return;
    }

    /*
     * Another part of the detail page already requested videos.
     * Attach to that same request.
     */
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

    if(showLoading!==false){
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

        function(d){
            if(showLoading!==false){
                try{
                    Lampa.Loading.stop();
                }
                catch(e){}
            }

            var videos=
                d.videos||
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
                    x.ok(videos);
                }
            );
        },

        function(e){
            if(showLoading!==false){
                try{
                    Lampa.Loading.stop();
                }
                catch(x){}
            }

            var wait=
                videoInflight[id]||
                [];

            delete videoInflight[id];

            try{
                net.clear();
            }
            catch(x){}

            wait.forEach(
                function(x){
                    if(x.fail){
                        x.fail(e);
                    }
                }
            );
        }
    );
}


/* ============================================================
 * PLAYBACK
 *
 * Simplified deliberately:
 *
 * Watch:
 *   resume episode or first episode
 *
 * Inline episode:
 *   play that episode
 *
 * If that episode has multiple voices:
 *   show ONE voice picker
 *
 * No extra episode/quality picker chain.
 * Lampa receives the quality map itself.
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

function playEpisode(
    anime,
    videos,
    ep
){
    var groups=
        groupsForEpisode(
            videos,
            ep
        );

    if(!groups.length){
        notify(
            'Для этой серии нет источника'
        );

        restoreContent();
        return;
    }

    var state=
        watch(anime);

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

    /*
     * One source, or previously used source:
     * play directly. No Select window needed.
     */
    if(
        groups.length===1||
        preferred
    ){
        var group=
            preferred||
            groups[0];

        resolveAndPlay(
            anime,
            group,
            findVideo(
                group,
                ep
            )
        );

        return;
    }

    selectBox(
        'Озвучка • Серия '+
        ep,

        groups.map(
            function(g){
                return {
                    title:
                        g.title+
                        (
                            g.player&&
                            g.player!==g.title
                                ?' · '+
                                g.player
                                :''
                        ),

                    subtitle:
                        g.kind
                            .toUpperCase(),

                    group:g
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
    forcedEp
){
    function go(list){
        var eps=
            episodeNumbers(list);

        if(!eps.length){
            notify(
                'Видео для этого тайтла не найдено'
            );

            restoreContent();
            return;
        }

        var st=
            watch(anime);

        var ep=
            forcedEp!=null
                ?forcedEp
                :num(
                    st.episode,
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
            st.completed&&
            forcedEp==null
        ){
            var ix=
                eps.indexOf(ep);

            if(
                ix>=0&&
                ix<
                eps.length-
                1
            ){
                ep=
                    eps[
                        ix+
                        1
                    ];
            }
        }

        playEpisode(
            anime,
            list,
            ep
        );
    }

    try{
        Lampa.Loading.start();
    }
    catch(e){}

    if(videos){
        try{
            Lampa.Loading.stop();
        }
        catch(e){}

        go(videos);
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
        videoSourceUrl(video);

    if(!url){
        notify(
            'У источника нет адреса'
        );

        restoreContent();
        return;
    }

    var data=
        videoData(video);

    /*
     * The API/plugin may already have a resolved stream.
     * Never resolve an already-direct stream again.
     */
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
                url:url,

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

        function(d){
            try{
                Lampa.Loading.stop();
                net.clear();
            }
            catch(e){}

            if(
                !d.stream||
                !d.stream.url
            ){
                notify(
                    'Прямой поток не найден'
                );

                restoreContent();
                return;
            }

            /*
             * Store resolved fields ON the original video object,
             * matching the official YummyAnime approach.
             */
            video.yani_stream_url=
                d.stream.url;

            video.yani_stream_quality=
                d.stream.quality||
                '';

            video.yani_stream_qualities=
                d.stream.qualities||
                null;

            video.yani_stream_headers=
                d.stream.headers||
                null;

            launchPlayer(
                anime,
                group,
                video,
                d.stream
            );
        },

        function(e){
            try{
                Lampa.Loading.stop();
                net.clear();
            }
            catch(x){}

            notify(
                'Источник не открылся: '+
                clean(
                    e&&
                    e.message||
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
        extension(url);

    var old=
        watch(anime);

    var same=
        Math.abs(
            num(
                old.episode
            )-
            num(
                video._ahEpisode
            )
        )<
        .0001;

    var time=
        same&&
        !old.completed
            ?num(
                old.position
            )
            :0;

    saveWatch(
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
                time,

            duration:
                same
                    ?num(
                        old.duration
                    )
                    :0,

            completed:
                same
                    ?!!old.completed
                    :false
        }
    );

    /*
     * Match Lampa/YummyAnime's native direct item shape:
     * - URL
     * - resume time
     * - isonline
     * - quality map
     * - optional headers
     */
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
            time,

        isonline:
            true,

        quality:
            stream.qualities||
            {
                auto:url
            },

        headers:
            stream.headers||
            {},

        poster:
            anime.poster||
            ''
    };

    if(ext){
        item.extension=
            ext;
    }

    if(ext==='mp4'){
        item.mime=
            'video/mp4';
    }
    else if(ext==='m3u8'){
        item.mime=
            'application/vnd.apple.mpegurl';
    }

    item.animehub_anime=
        compact(anime);

    item.animehub_episode=
        video._ahEpisode;

    item.animehub_provider_key=
        group.key;

    item.animehub_video_id=
        video.video_id||
        video.id||
        '';

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

function installTracker(){
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

            var a=
                data.animehub_anime;

            var ep=
                data.animehub_episode;

            var last=0;
            var active=true;

            function tick(e){
                if(
                    !active||
                    Date.now()-
                    last<
                    10000
                ){
                    return;
                }

                last=
                    Date.now();

                var cur=
                    num(
                        e&&
                        e.current
                    );

                var dur=
                    num(
                        e&&
                        e.duration
                    );

                if(cur>0){
                    saveWatch(
                        a,
                        {
                            episode:
                                ep,

                            videoId:
                                data.animehub_video_id||
                                '',

                            providerKey:
                                data.animehub_provider_key||
                                '',

                            position:
                                cur,

                            duration:
                                dur,

                            completed:
                                dur>0&&
                                cur>=
                                dur-
                                25
                        }
                    );
                }
            }

            function ended(){
                if(active){
                    saveWatch(
                        a,
                        {
                            episode:
                                ep,

                            position:0,
                            duration:0,
                            completed:true
                        }
                    );
                }
            }

            function destroy(){
                active=false;

                try{
                    Lampa.PlayerVideo.listener.remove(
                        'timeupdate',
                        tick
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
                tick
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

    function render(d){
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

        var a=
            d.hero;

        if(a){
            var h=
                $('<div class="ah-hero"></div>');

            var bg=
                a.background||
                a.posterHero||
                a.poster||
                '';

            if(bg){
                putBackground(
                    h,
                    bg
                );
            }

            h.append(
                '<div class="ah-shade"></div>'
            );

            var c=
                $('<div class="ah-hero-copy"></div>');

            c.append(
                '<div class="ah-kicker">'+
                    'Сейчас в центре внимания'+
                '</div>'+
                '<div class="ah-title">'+
                    esc(
                        a.title||
                        'AnimeHub'
                    )+
                '</div>'
            );

            if(
                a.original&&
                a.original!==
                a.title
            ){
                c.append(
                    '<div class="ah-original">'+
                        esc(
                            a.original
                        )+
                    '</div>'
                );
            }

            var m=
                $('<div class="ah-meta"></div>');

            if(
                num(
                    a.score
                )>0
            ){
                m.append(
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
                m.append(
                    '<span class="ah-chip">'+
                        esc(
                            a.year
                        )+
                    '</span>'
                );
            }

            m.append(
                '<span class="ah-chip">'+
                    esc(
                        typeLabel(a)
                    )+
                '</span>'
            );

            if(
                a.episodes&&
                a.episodes.aired
            ){
                m.append(
                    '<span class="ah-chip">'+
                        esc(
                            epCount(a)
                        )+
                        ' сер.'+
                    '</span>'
                );
            }

            c.append(
                m,

                '<div class="ah-description">'+
                    esc(
                        clip(
                            desc(
                                a.description
                            ),
                            285
                        )||
                        'Откройте карточку для подробностей.'
                    )+
                '</div>'
            );

            var acts=
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

                    watchAnime(a);
                }
            )
            .appendTo(acts);

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

                    openDetail(a);
                }
            )
            .appendTo(acts);

            c.append(acts);
            h.append(c);
            root.append(h);
        }

        /*
         * Maximum:
         * Continue + 3 rails.
         * 7 cards each.
         */
        continueShelf(root);

        shelf(
            root,
            'Сейчас выходит',
            d.ongoing||
            []
        );

        shelf(
            root,
            'Новинки',
            d.latest||
            []
        );

        shelf(
            root,
            'Лучшее',
            d.top||
            []
        );

        nav.bind();

        setTimeout(
            function(){
                var f=
                    root.find(
                        '.ah-button.selector'
                    )[0]||
                    root.find(
                        '.selector'
                    )[0];

                if(f){
                    nav.focus(f);
                }
            },
            30
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

            loader(
                'Загрузка AnimeHub…'
            )
        );

        nav=
            navFor(
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
            controller(
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
        'all';

    var value=
        o.ah_value||
        '';

    var title=
        o.ah_title||
        'Каталог';

    var page=
        intv(
            o.ah_page,
            1
        );

    function filter(
        side,
        key,
        label,
        action
    ){
        var b=
            $('<div class="ah-filter selector"></div>')
            .text(label);

        if(mode===key){
            b.addClass(
                'selected'
            );
        }

        b.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                action();
            }
        );

        side.append(b);
    }

    function render(d){
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

        var lay=
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
            d.items||
            []
        )
        .forEach(
            function(a){
                grid.append(
                    posterCard(a)
                );
            }
        );

        main.append(grid);

        var pages=
            $('<div class="ah-pages"></div>');

        if(page>1){
            $(
                '<div class="ah-pagebtn selector">'+
                    '← '+
                    (page-1)+
                '</div>'
            )
            .on(
                'hover:enter click',

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

        if(d.hasNext){
            $(
                '<div class="ah-pagebtn selector">'+
                    (page+1)+
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
                        page+1
                    );
                }
            )
            .appendTo(pages);
        }

        main.append(pages);

        root.append(
            lay.append(
                side,
                main
            )
        );

        nav.bind();

        setTimeout(
            function(){
                var f=
                    grid.find(
                        '.selector'
                    )[0]||
                    side.find(
                        '.selector'
                    )[0];

                if(f){
                    nav.focus(f);
                }
            },
            25
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

        root.append(
            topbar(
                'catalog'
            ),

            loader(
                'Загрузка каталога…'
            )
        );

        nav=
            navFor(
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
                    limit:12
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
            controller(
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
    var videos=null;
    var epBox=null;
    var watchBtn=null;
    var recs=null;
    var timers=[];

    function row(
        panel,
        k,
        v
    ){
        if(
            v!==''&&
            v!==null&&
            v!==undefined
        ){
            panel.append(
                '<div class="ah-info">'+
                    '<span>'+
                        esc(k)+
                    '</span>'+
                    '<span>'+
                        esc(v)+
                    '</span>'+
                '</div>'
            );
        }
    }

    function aside(a){
        var p=
            $(
                '<div class="ah-aside">'+
                    '<div class="ah-aside-title">'+
                        'Информация'+
                    '</div>'+
                '</div>'
            );

        row(
            p,
            'Рейтинг',

            num(
                a.score
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
            row(
                p,
                'Студия',

                a.studios
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
                p,
                'Режиссёр',

                a.creators
                    .map(
                        function(x){
                            return x.title;
                        }
                    )
                    .join(', ')
            );
        }

        row(
            p,
            'Тип',
            typeLabel(a)
        );

        row(
            p,
            'Статус',

            status(
                a.status&&
                a.status.alias
            )
        );

        row(
            p,
            'Эпизоды',
            epCount(a)
        );

        if(a.duration){
            row(
                p,
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
                p,
                'Возраст',
                a.age.title
            );
        }

        if(
            a.episodes&&
            a.episodes.nextDate
        ){
            row(
                p,
                'Следующая',

                formatDate(
                    a.episodes.nextDate,
                    true
                )
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

        var st=
            watch(anime);

        var ep=
            num(
                st.episode
            );

        watchBtn.text(
            ep&&
            !st.completed
                ?(
                    '▶ Продолжить • серия '+
                    ep
                )
                :ep&&
                st.completed
                    ?'▶ Смотреть дальше'
                    :'▶ Смотреть'
        );
    }

    function shotFor(
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
                            x.episode
                        )-
                        num(ep)
                    )<
                    .0001
                ){
                    exact=x;
                    return true;
                }

                return false;
            }
        );

        var p=
            exact||
            (
                shots.length
                    ?shots[
                        index%
                        shots.length
                    ]
                    :null
            );

        return p
            ?(
                p.small||
                p.full
            )
            :(
                anime.background||
                anime.posterHero||
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
            epBox.html(
                '<div class="ah-placeholder">'+
                    'Видео пока не найдено.'+
                '</div>'
            );

            return;
        }

        var st=
            watch(anime);

        var current=
            num(
                st.episode
            );

        var idx=
            eps.indexOf(
                current
            );

        var start=0;
        var max=8;

        if(
            eps.length>max&&
            idx>=0
        ){
            start=
                Math.max(
                    0,

                    Math.min(
                        eps.length-
                        max,

                        idx-
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

        var head=
            $(
                '<div class="ah-ephead">'+
                    '<div>'+
                        '<span class="ah-eptitle">'+
                            'Эпизоды'+
                        '</span>'+
                        '<span class="ah-epcount">'+
                            esc(
                                eps.length>max
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
                                    :eps.length
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

                selectBox(
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

                    function(x){
                        setTimeout(
                            function(){
                                playEpisode(
                                    anime,
                                    videos,
                                    x.episode
                                );
                            },
                            0
                        );
                    }
                );
            }
        );

        head.append(all);

        var line=
            $('<div class="ah-eprow"></div>');

        subset.forEach(
            function(ep,j){
                var gs=
                    groupsForEpisode(
                        videos,
                        ep
                    );

                var c=
                    $('<div class="ah-ep selector"></div>');

                var im=
                    shotFor(
                        ep,
                        start+
                        j
                    );

                if(im){
                    putImage(
                        c,
                        im,
                        'Серия '+
                        ep,
                        false
                    );
                }

                c.append(
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
                                gs.length+
                                ' источн.'+
                                (
                                    gs[0]
                                        ?' • '+
                                        gs[0].title
                                        :''
                                )
                            )+
                        '</div>'+
                    '</div>'
                );

                if(
                    Math.abs(
                        current-
                        num(ep)
                    )<
                    .0001&&
                    num(
                        st.duration
                    )>0&&
                    num(
                        st.position
                    )>0
                ){
                    var p=
                        st.completed
                            ?100
                            :Math.max(
                                0,

                                Math.min(
                                    100,

                                    Math.round(
                                        num(
                                            st.position
                                        )/
                                        num(
                                            st.duration,
                                            1
                                        )*
                                        100
                                    )
                                )
                            );

                    c.append(
                        '<div class="ah-progress">'+
                            '<span style="width:'+
                                p+
                                '%"></span>'+
                        '</div>'
                    );
                }

                c.on(
                    'hover:enter click',

                    function(e){
                        if(e){
                            e.preventDefault();
                        }

                        playEpisode(
                            anime,
                            videos,
                            ep
                        );
                    }
                );

                line.append(c);
            }
        );

        epBox
            .empty()
            .append(
                head,
                line
            );

        nav.bind();

        refreshWatch();
    }

    function loadRecs(){
        var r=
            new Lampa.Reguest();

        requestCached(
            r,

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

            function(d){
                if(!alive){
                    return;
                }

                if(
                    d.items&&
                    d.items.length
                ){
                    recs.empty();

                    shelf(
                        recs,
                        'Похожие аниме',
                        d.items
                    );

                    nav.bind();
                }

                try{
                    r.clear();
                }
                catch(e){}
            },

            function(){
                try{
                    r.clear();
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

        recent(a);

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
                a.score
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
                        status(
                            a.status.alias
                        )
                    )+
                '</span>'
            );
        }

        main.append(meta);

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
        .slice(
            0,
            6
        )
        .forEach(
            function(g){
                gm.append(
                    '<span class="ah-chip">'+
                        esc(
                            g.title
                        )+
                    '</span>'
                );
            }
        );

        main.append(gm);

        var text=
            desc(
                a.description||
                ''
            );

        main.append(
            '<div class="ah-description">'+
                esc(
                    text
                        ?clip(
                            text,
                            520
                        )
                        :'Описание пока отсутствует.'
                )+
            '</div>'
        );

        var actions=
            $('<div class="ah-actions"></div>');

        watchBtn=
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

        var fav=
            $('<div class="ah-button selector"></div>');

        function rf(){
            fav.text(
                isFav(anime)
                    ?'★ В избранном'
                    :'☆ В избранное'
            );
        }

        rf();

        fav.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                notify(
                    toggleFav(anime)
                        ?'Добавлено в избранное'
                        :'Удалено из избранного'
                );

                rf();
            }
        );

        actions.append(
            watchBtn,
            fav
        );

        main.append(actions);

        wrap.append(
            poster,
            main,
            aside(a)
        );

        hero.append(wrap);

        root.append(hero);

        epBox=
            $('<div class="ah-shelf"></div>');

        root.append(epBox);

        /*
         * Only 4 screenshots now.
         */
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
                    function(x){
                        var b=
                            $('<div class="ah-shot"></div>');

                        putImage(
                            b,
                            x.full||
                            x.small,
                            'Кадр',
                            false
                        );

                        shots.append(b);
                    }
                );

            root.append(shots);
        }

        if(
            text.length>
            520
        ){
            root.append(
                '<div class="ah-block-title">'+
                    'Описание'+
                '</div>'+
                '<div class="ah-longdesc">'+
                    esc(text)+
                '</div>'
            );
        }

        recs=
            $('<div></div>');

        root.append(recs);

        refreshWatch();
        nav.bind();

        setTimeout(
            function(){
                var f=
                    root.find(
                        '.ah-button.selector'
                    )[0]||
                    root.find(
                        '.selector'
                    )[0];

                if(f){
                    nav.focus(f);
                }
            },
            20
        );

        /*
         * Do not hit /videos at the same moment
         * the detail artwork is being decoded.
         */
        timers.push(
            setTimeout(
                function(){
                    if(!alive){
                        return;
                    }

                    epBox.html(
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

                        function(v){
                            if(alive){
                                renderEpisodes(v);
                            }
                        },

                        function(){
                            if(alive){
                                epBox.html(
                                    '<div class="ah-placeholder">'+
                                        'Не удалось загрузить серии.'+
                                    '</div>'
                                );
                            }
                        },

                        false
                    );
                },
                300
            )
        );

        /*
         * Recommendations are intentionally delayed.
         * They are not allowed to compete with the hero/videos
         * during the initial TV render.
         */
        timers.push(
            setTimeout(
                function(){
                    if(alive){
                        loadRecs();
                    }
                },
                1400
            )
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

        root.append(
            topbar(''),

            loader(
                'Загрузка карточки…'
            )
        );

        nav=
            navFor(
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

            480000,

            workerUrl(
                'anime',
                {
                    id:
                        initial.id
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

        controller(
            view,
            root,
            nav,

            function(){
                Lampa.Activity.backward();
            }
        );

        refreshWatch();
    };

    this.pause=function(){};
    this.stop=function(){};

    this.render=function(){
        return view;
    };

    this.destroy=function(){
        alive=false;

        timers.forEach(
            clearTimeout
        );

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

    function render(d){
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
            d.items||
            []
        )
        .slice(
            0,
            20
        )
        .forEach(
            function(a){
                var c=
                    $('<div class="ah-sch selector"></div>');

                var bg=
                    a.posterHero||
                    a.poster||
                    '';

                if(bg){
                    putImage(
                        c,
                        bg,
                        a.title,
                        false
                    );
                }

                c.append(
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

                c.on(
                    'hover:enter click',

                    function(e){
                        if(e){
                            e.preventDefault();
                        }

                        openDetail(a);
                    }
                );

                grid.append(c);
            }
        );

        root.append(grid);

        nav.bind();

        setTimeout(
            function(){
                var f=
                    grid.find(
                        '.selector'
                    )[0];

                if(f){
                    nav.focus(f);
                }
            },
            20
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

        root.append(
            topbar(
                'schedule'
            ),

            loader(
                'Загрузка расписания…'
            )
        );

        nav=
            navFor(
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
            controller(
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
                    24
                )
                .forEach(
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
                var f=
                    root.find(
                        '.selector'
                    )[0];

                if(f){
                    nav.focus(f);
                }
            },
            20
        );
    }

    this.create=function(){
        alive=true;

        view.append(root);

        nav=
            navFor(
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

            controller(
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
 * BOOT
 * ============================================================ */

function menu(){
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
                    torii('')+
                '</div>'+
                '<div class="menu__text">'+
                    'AnimeHub'+
                '</div>'+
            '</li>'
        );

    b.on(
        'hover:enter click',
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
        style();

        installTracker();

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

        menu();

        notify(
            'AnimeHub V'+
            VERSION+
            ' Lite загружен'
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
