(function(){
'use strict';

/*
 * AnimeHub V1.4.1 Native Catalogue
 *
 * Performance first:
 * - Native Lampa Maker Main/Line/Card/Category
 * - 20 anime per catalogue page
 * - page replacement instead of infinite append
 * - Lampa request cache
 * - video/recommendations lazy
 * - native genre/collection catalogues
 * - combined filters + sorting
 *
 * V1.4.1:
 * - Fix genre labels
 * - Defensive client genre normalisation
 * - New /genres cache schema key so LG/Lampa does not reuse
 *   the older cached blank-title genre response
 */

var VERSION='1.4.1';
var NS='animehub_v141';

var HOME=NS+'_home';
var CATALOG=NS+'_catalog';
var DETAIL=NS+'_detail';
var SCHEDULE=NS+'_schedule';
var FAVORITES=NS+'_favorites';
var GENRES=NS+'_genres';
var COLLECTIONS=NS+'_collections';
var COLLECTION=NS+'_collection';

var FAVORITES_KEY='animehub_v010_favorites';
var RECENT_KEY='animehub_v010_recent';
var WATCH_KEY='animehub_v020_watch';

var WORKER='https://animehub-lampa.kalewse69.workers.dev/';

var VIDEO_CACHE_MAX=5;

var videoCache={};
var videoOrder=[];
var videoInflight={};

var genresCache=null;
var CARD_MASK=null;

var GENRE_CACHE_SCHEMA='141';


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

    return (
        !l||
        v.length<=l
    )
        ?v
        :v
            .slice(0,l)
            .replace(/\s+\S*$/,'')+
            '…';
}

function num(v,d){
    v=parseFloat(v);

    return isNaN(v)
        ?(
            d||
            0
        )
        :v;
}

function intv(v,d){
    v=parseInt(
        v,
        10
    );

    return isNaN(v)
        ?(
            d||
            0
        )
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

function formatDate(ts,time){
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

function clone(o){
    var r={};

    Object.keys(
        o||
        {}
    )
    .forEach(
        function(k){
            if(
                o[k]!==undefined&&
                o[k]!==null&&
                o[k]!==''
            ){
                r[k]=o[k];
            }
        }
    );

    return r;
}

function workerUrl(path,p){
    var q=[];

    var base=
        WORKER.replace(
            /\/?$/,
            '/'
        );

    Object.keys(
        p||
        {}
    )
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

function requestJson(
    net,
    url,
    minutes,
    ok,
    fail
){
    var options={
        dataType:'text'
    };

    if(
        minutes>
        0
    ){
        options.cache={
            life:minutes
        };
    }

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

            if(ok){
                ok(d);
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

        options
    );
}

function nativeReady(){
    return !!(
        Lampa.Maker&&
        Lampa.Manifest&&
        intv(
            Lampa.Manifest.app_digital
        )>=
        300
    );
}

function cardMask(){
    if(
        CARD_MASK!==
        null
    ){
        return CARD_MASK;
    }

    try{
        CARD_MASK=
            Lampa.Maker
            .module(
                'Card'
            )
            .only(
                'Card',
                'Ratting',
                'Release',
                'Style'
            );
    }
    catch(e){
        CARD_MASK=
            undefined;
    }

    return CARD_MASK;
}


/* ============================================================
 * GENRE NORMALISATION / CACHE FIX
 * ============================================================ */

function genreRequestUrl(){
    /*
     * Lampa's native request cache is URL based.
     *
     * Previous AnimeHub versions may already have cached /genres
     * with correct IDs but blank labels.
     *
     * Using ?schema=141 gives Lampa a fresh cache key while still
     * retaining the fast 24-hour cache afterwards.
     */
    return workerUrl(
        'genres',
        {
            schema:
                GENRE_CACHE_SCHEMA
        }
    );
}

function genreClientTitle(g){
    if(!g){
        return '';
    }

    if(
        typeof g===
        'string'
    ){
        return clean(g);
    }

    return clean(
        g.title||
        g.name||
        g.label||
        g.alias||
        g.slug||
        ''
    );
}

function genreClientId(g){
    if(!g){
        return '';
    }

    if(
        typeof g===
        'string'
    ){
        return clean(g);
    }

    var value=
        g.value;

    if(
        value===undefined||
        value===null||
        value===''
    ){
        value=
            g.id;
    }

    if(
        value===undefined||
        value===null||
        value===''
    ){
        value=
            g.href;
    }

    if(
        value===undefined||
        value===null||
        value===''
    ){
        value=
            g.alias;
    }

    if(
        value===undefined||
        value===null||
        value===''
    ){
        value=
            g.slug;
    }

    return (
        value===undefined||
        value===null
    )
        ?''
        :String(value);
}

function normalizeClientGenres(data){
    var raw=
        data&&
        data.genres;

    if(
        !Array.isArray(raw)
    ){
        raw=[];
    }

    var seen={};
    var out=[];

    raw.forEach(
        function(g){
            var id=
                genreClientId(g);

            var title=
                genreClientTitle(g);

            /*
             * Do not render anonymous cards.
             * A genre must have both a usable identifier and label.
             */
            if(
                !id||
                !title
            ){
                return;
            }

            var key=
                String(id);

            if(
                seen[key]
            ){
                return;
            }

            seen[key]=true;

            out.push({
                id:key,

                title:
                    title,

                alias:
                    clean(
                        g&&
                        g.alias||
                        ''
                    ),

                description:
                    clean(
                        g&&
                        (
                            g.description||
                            g.desc||
                            g.about||
                            g.text||
                            ''
                        )
                    )
            });
        }
    );

    return out;
}


/* ============================================================
 * TORII / STYLE
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
            '<linearGradient id="ah141g" x1="0" y1="0" x2="1" y2="1">'+
                '<stop offset="0" stop-color="#a970ff"/>'+
                '<stop offset="1" stop-color="#ed5fd4"/>'+
            '</linearGradient>'+
        '</defs>'+

        '<path fill="url(#ah141g)" d="'+
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

function imageElement(url,cls){
    return url
        ?(
            '<img class="'+
            esc(
                cls||
                ''
            )+
            '" src="'+
            esc(url)+
            '" decoding="async" alt="">'
        )
        :'';
}

function loaderHtml(t){
    return (
        '<div class="ah140-loader">'+
            '<div class="ah140-loader-ring"></div>'+
            toriiSvg(
                'ah140-loader-logo'
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

function injectStyle(){
    if(
        $('#animehub-v141-style')
            .length
    ){
        return;
    }

    $('head').append(`
<style id="animehub-v141-style">

.ah140-hero-line{
    padding:0 0 1.2em;
    box-sizing:border-box
}

.ah140-top,
.ah140-detail-top{
    height:3.7em;
    display:flex;
    align-items:center;
    gap:.7em
}

.ah140-brand{
    display:flex;
    align-items:center;
    gap:.4em;
    font-size:1.32em;
    font-weight:900;
    padding-right:.8em;
    border-right:1px solid rgba(255,255,255,.13);
    white-space:nowrap
}

.ah140-logo{
    width:1.8em;
    height:1.8em
}

.ah140-name{
    background:linear-gradient(90deg,#fff,#dc8cff);
    -webkit-background-clip:text;
    color:transparent
}

.ah140-nav{
    display:flex;
    gap:.08em;
    overflow:hidden
}

.ah140-navbtn{
    padding:.5em .54em;
    border-radius:.5em;
    white-space:nowrap;
    font-size:.86em
}

.ah140-navbtn.focus{
    background:#8754e9;
    color:#fff
}

.ah140-hero{
    height:24em;
    position:relative;
    overflow:hidden;
    border-radius:.85em;
    isolation:isolate;
    background:#111629
}

.ah140-bg{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    z-index:-5
}

.ah140-shade{
    position:absolute;
    inset:0;
    z-index:-4;
    background:
        linear-gradient(
            90deg,
            rgba(4,6,15,.995) 0%,
            rgba(4,6,15,.95) 30%,
            rgba(4,6,15,.67) 55%,
            rgba(4,6,15,.18) 80%,
            rgba(4,6,15,.05) 100%
        ),
        linear-gradient(
            0deg,
            rgba(4,6,15,.88),
            transparent 62%
        )
}

.ah140-hero-copy{
    position:absolute;
    left:3.1%;
    top:7%;
    bottom:7%;
    width:55%;
    display:flex;
    flex-direction:column;
    justify-content:center
}

.ah140-kicker{
    color:#df8cff;
    font-size:.7em;
    font-weight:800;
    letter-spacing:.09em;
    text-transform:uppercase;
    margin-bottom:.45em
}

.ah140-title{
    font-size:2.7em;
    font-weight:900;
    line-height:1.02;
    text-shadow:0 2px 6px #000
}

.ah140-original{
    color:#b9b5c6;
    margin:.2em 0 .5em
}

.ah140-meta{
    display:flex;
    flex-wrap:wrap;
    gap:.35em;
    margin:.32em 0
}

.ah140-chip{
    font-size:.74em;
    padding:.24em .49em;
    border-radius:999px;
    background:rgba(255,255,255,.09);
    border:1px solid rgba(255,255,255,.11)
}

.ah140-score{
    color:#ffd76a
}

.ah140-desc{
    font-size:.92em;
    line-height:1.46;
    color:#f5f3fa;
    max-width:46em;
    margin:.5em 0 .8em;
    text-shadow:0 2px 4px #000
}

.ah140-actions{
    display:flex;
    gap:.5em;
    flex-wrap:wrap
}

.ah140-btn,
.ah140-lazy{
    padding:.62em .84em;
    border-radius:.53em;
    background:rgba(255,255,255,.10);
    border:1px solid rgba(255,255,255,.12);
    font-weight:750
}

.ah140-btn.primary{
    background:linear-gradient(
        135deg,
        #965cf8,
        #7444e9 65%,
        #d84fd6
    )
}

.ah140-btn.focus,
.ah140-lazy.focus{
    background:#fff;
    color:#090b14
}

.ah140-detail-wrap{
    padding:0 1.65em 4em;
    color:#faf8ff;
    box-sizing:border-box
}

.ah140-detail{
    position:relative;
    min-height:27em;
    border-radius:.85em;
    overflow:hidden;
    isolation:isolate;
    background:#0d1120;
    margin-bottom:1em
}

.ah140-detail-inner{
    display:flex;
    gap:.9em;
    padding:1.15em;
    align-items:center;
    min-height:26em;
    box-sizing:border-box
}

.ah140-poster{
    width:10.8em;
    min-width:10.8em;
    height:16em;
    border-radius:.62em;
    overflow:hidden;
    background:#15192b;
    border:1px solid rgba(255,255,255,.13)
}

.ah140-poster img,
.ah140-shot img{
    width:100%;
    height:100%;
    object-fit:cover
}

.ah140-detail-main{
    flex:1;
    min-width:0;
    padding:.68em .78em;
    border-radius:.62em;
    background:
        linear-gradient(
            90deg,
            rgba(4,6,15,.76),
            rgba(4,6,15,.26),
            transparent
        )
}

.ah140-detail-title{
    font-size:2.15em;
    font-weight:900;
    line-height:1.05;
    text-shadow:0 2px 6px #000
}

.ah140-studio{
    font-size:.75em;
    color:#cbc7d5;
    margin:.12em 0
}

.ah140-aside{
    width:14.5em;
    min-width:14.5em;
    background:rgba(9,12,25,.84);
    border:1px solid rgba(255,255,255,.09);
    border-radius:.65em;
    padding:.68em
}

.ah140-aside-title{
    font-weight:850;
    margin-bottom:.16em
}

.ah140-info{
    display:flex;
    justify-content:space-between;
    gap:.45em;
    font-size:.72em;
    padding:.42em 0;
    border-bottom:1px solid rgba(255,255,255,.06)
}

.ah140-info span:first-child{
    color:#aaa7b8
}

.ah140-info span:last-child{
    text-align:right;
    font-weight:700;
    max-width:62%
}

.ah140-block{
    margin:1em 0
}

.ah140-block-title{
    font-size:1.18em;
    font-weight:850;
    margin:0 0 .46em
}

.ah140-placeholder{
    padding:.75em;
    border-radius:.62em;
    background:#101426;
    color:#bbb7c8;
    display:flex;
    gap:.55em;
    align-items:center;
    flex-wrap:wrap
}

.ah140-shots{
    display:flex;
    gap:.62em;
    overflow-x:auto;
    padding:.1em 0 .45em
}

.ah140-shots::-webkit-scrollbar{
    width:0;
    height:0
}

.ah140-shot{
    flex:0 0 14.5em;
    height:8.1em;
    border-radius:.56em;
    overflow:hidden;
    background:#14182a
}

.ah140-longdesc{
    background:#101426;
    border:1px solid rgba(255,255,255,.06);
    border-radius:.62em;
    padding:.8em;
    line-height:1.48;
    color:#d5d2de;
    margin-bottom:.95em
}

.ah140-loader{
    min-height:20em;
    display:flex;
    position:relative;
    flex-direction:column;
    justify-content:center;
    align-items:center;
    gap:.65em;
    color:#bbb7c8
}

.ah140-loader-logo{
    width:4.2em;
    height:4.2em
}

.ah140-loader-ring{
    position:absolute;
    width:5.4em;
    height:5.4em;
    border:2px solid rgba(180,110,255,.12);
    border-top-color:#cc76ff;
    border-radius:50%;
    animation:ah140-spin 1s linear infinite
}

@keyframes ah140-spin{
    to{
        transform:rotate(360deg)
    }
}

@media(max-width:1250px){
    .ah140-aside{
        display:none
    }

    .ah140-detail-title{
        font-size:1.95em
    }

    .ah140-hero-copy{
        width:62%
    }

    .ah140-navbtn{
        font-size:.79em;
        padding:.48em .42em
    }
}

</style>
    `);
}


/* ============================================================
 * STORAGE
 * ============================================================ */

function stored(key,def){
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

function setStored(key,v){
    try{
        Lampa.Storage.set(
            key,
            v
        );
    }
    catch(e){}
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
                49
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
                20&&
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
            v[x]=patch[x];
        }
    );

    v.source='yummy';
    v.anime=compactAnime(a);
    v.updatedAt=Date.now();

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
                    num(
                        x.episode
                    )>
                    0
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
            12
        );
}


/* ============================================================
 * ROUTES
 * ============================================================ */

function replaceActivity(o){
    try{
        if(
            Lampa.Activity.replace
        ){
            Lampa.Activity.replace(o);
            return;
        }
    }
    catch(e){}

    Lampa.Activity.push(o);
}

function openHome(){
    Lampa.Activity.push({
        url:'animehub',
        title:'AnimeHub',
        component:HOME,
        page:1
    });
}

function defaultCatalogState(){
    return {
        sort:'top',
        sort_forward:true,
        from_year:1900
    };
}

function baselineYear(st){
    return (
        intv(
            st&&
            st.from_year
        )===
        1900&&
        !st.to_year
    );
}

function legacyState(mode,value){
    var st=
        defaultCatalogState();

    mode=
        mode||
        'all';

    if(mode==='ongoing'){
        st.status='ongoing';
        st.sort='rating';
        st.sort_forward=false;
        delete st.from_year;
    }
    else if(mode==='popular'){
        st.sort='views';
        st.sort_forward=false;
        delete st.from_year;
    }
    else if(mode==='latest'){
        st.sort='year';
        st.sort_forward=false;
        delete st.from_year;
    }
    else if(mode==='announcements'){
        st.status='announcement';
        st.sort='year';
        st.sort_forward=false;
        delete st.from_year;
    }
    else if(mode==='genre'){
        st.genres=value;
    }
    else if(mode==='year'){
        st.from_year=
            intv(value);

        st.to_year=
            intv(value);

        st.sort='rating';
        st.sort_forward=false;
    }
    else if(mode==='type'){
        st.types=value;
        st.sort='rating';
        st.sort_forward=false;
    }
    else if(mode==='search'){
        st.q=value;
    }

    return st;
}

function stateFromObject(o){
    if(
        o&&
        o.ah_state
    ){
        return clone(
            o.ah_state
        );
    }

    return legacyState(
        o&&
        o.ah_mode,
        o&&
        o.ah_value
    );
}

function catalogTitle(state){
    var bits=[];

    if(state.q){
        bits.push(
            'Поиск: '+
            state.q
        );
    }

    if(state.genres_title){
        bits.push(
            state.genres_title
        );
    }

    if(state.types){
        bits.push(
            String(
                state.types
            )
            .toUpperCase()
        );
    }

    if(state.status){
        bits.push(
            statusLabel(
                state.status
            )
        );
    }

    if(
        !baselineYear(state)&&
        state.from_year&&
        state.to_year&&
        String(
            state.from_year
        )===
        String(
            state.to_year
        )
    ){
        bits.push(
            String(
                state.from_year
            )
        );
    }
    else if(
        !baselineYear(state)&&
        state.from_year&&
        !state.to_year
    ){
        bits.push(
            'с '+
            state.from_year
        );
    }

    if(state.season){
        bits.push(
            ({
                winter:'Зима',
                spring:'Весна',
                summer:'Лето',
                autumn:'Осень',
                fall:'Осень'
            })[
                state.season
            ]||
            state.season
        );
    }

    return bits.length
        ?bits.join(' • ')
        :'Каталог';
}

function openCatalogState(
    state,
    page,
    replace
){
    state=
        clone(
            state||
            defaultCatalogState()
        );

    var o={
        url:'animehub/catalog',
        title:catalogTitle(state),
        component:CATALOG,
        page:1,

        ah_state:
            state,

        ah_page:
            Math.max(
                1,
                intv(
                    page,
                    1
                )
            )
    };

    replace
        ?replaceActivity(o)
        :Lampa.Activity.push(o);
}

function openCatalog(
    mode,
    value,
    title,
    page
){
    openCatalogState(
        legacyState(
            mode,
            value
        ),

        page||
        1,

        false
    );
}

function openSchedule(){
    Lampa.Activity.push({
        url:'animehub/schedule',
        title:'AnimeHub • Расписание',
        component:SCHEDULE,
        page:1
    });
}

function openFavorites(){
    Lampa.Activity.push({
        url:'animehub/favorites',
        title:'AnimeHub • Избранное',
        component:FAVORITES,
        page:1
    });
}

function openGenres(){
    Lampa.Activity.push({
        url:'animehub/genres',
        title:'AnimeHub • Жанры',
        component:GENRES,
        page:1
    });
}

function openCollections(
    page,
    replace
){
    var o={
        url:'animehub/collections',
        title:'AnimeHub • Коллекции',
        component:COLLECTIONS,
        page:1,

        ah_page:
            Math.max(
                1,
                intv(
                    page,
                    1
                )
            )
    };

    replace
        ?replaceActivity(o)
        :Lampa.Activity.push(o);
}

function openCollection(
    c,
    page,
    replace
){
    var o={
        url:
            'animehub/collection/'+
            encodeURIComponent(
                c.id
            ),

        title:
            c.title||
            'Коллекция',

        component:
            COLLECTION,

        page:1,

        ah_collection:
            c,

        ah_page:
            Math.max(
                1,
                intv(
                    page,
                    1
                )
            )
    };

    replace
        ?replaceActivity(o)
        :Lampa.Activity.push(o);
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
                var st=
                    defaultCatalogState();

                st.q=q;

                openCatalogState(
                    st,
                    1,
                    false
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

function after(fn){
    setTimeout(
        fn,
        0
    );
}


/* ============================================================
 * GENRES CACHE LOADER - V1.4.1 FIX
 * ============================================================ */

function loadGenres(cb){
    if(genresCache){
        cb(
            genresCache
        );

        return;
    }

    var net=
        new Lampa.Reguest();

    requestJson(
        net,

        genreRequestUrl(),

        1440,

        function(d){
            genresCache=
                normalizeClientGenres(
                    d
                );

            if(
                !genresCache.length
            ){
                notify(
                    'Жанры не найдены'
                );
            }

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


/* ============================================================
 * SORT / FILTERS
 * ============================================================ */

var SORTS=[
    {
        title:'🏆 Формула ТОПа',
        sort:'top',
        forward:true
    },
    {
        title:'🆕 Новые',
        sort:'year',
        forward:false
    },
    {
        title:'⭐ Рейтинг',
        sort:'rating',
        forward:false
    },
    {
        title:'👥 Количество оценок',
        sort:'rating_counters',
        forward:false
    },
    {
        title:'👁 Просмотры',
        sort:'views',
        forward:false
    },
    {
        title:'🔤 Название A–Z',
        sort:'title',
        forward:true
    },
    {
        title:'🎲 Случайно',
        sort:'random',
        forward:false
    }
];

function sortName(st){
    var x=
        SORTS.filter(
            function(a){
                return (
                    a.sort===
                    st.sort&&
                    a.forward===
                    !!st.sort_forward
                );
            }
        )[0];

    return x
        ?x.title.replace(
            /^[^ ]+\s/,
            ''
        )
        :'Формула ТОПа';
}

function chooseSort(state){
    showSelect(
        'Сортировка',

        SORTS.map(
            function(x){
                return {
                    title:x.title,
                    sort:x.sort,
                    forward:x.forward
                };
            }
        ),

        function(x){
            var st=
                clone(state);

            st.sort=
                x.sort;

            st.sort_forward=
                x.forward;

            openCatalogState(
                st,
                1,
                true
            );
        }
    );
}

function exactYearMenu(
    draft,
    back
){
    var y=
        new Date()
        .getFullYear()+
        1;

    var items=[];

    for(
        ;
        y>=1970;
        y--
    ){
        items.push({
            title:String(y),
            year:y
        });
    }

    showSelect(
        'Точный год',
        items,

        function(x){
            draft.from_year=
                x.year;

            draft.to_year=
                x.year;

            after(back);
        },

        back
    );
}

function yearFilterMenu(
    draft,
    back
){
    var y=
        new Date()
        .getFullYear();

    showSelect(
        'Период выхода',

        [
            {
                title:'Все годы',
                kind:'all'
            },
            {
                title:String(y),
                from:y,
                to:y
            },
            {
                title:'Последние 3 года',
                from:y-2,
                to:y
            },
            {
                title:'Последние 5 лет',
                from:y-4,
                to:y
            },
            {
                title:'С 2020 года',
                from:2020
            },
            {
                title:'С 2010 года',
                from:2010
            },
            {
                title:'Выбрать точный год…',
                kind:'exact'
            }
        ],

        function(x){
            if(
                x.kind===
                'exact'
            ){
                after(
                    function(){
                        exactYearMenu(
                            draft,
                            back
                        );
                    }
                );

                return;
            }

            delete draft.from_year;
            delete draft.to_year;

            if(
                x.kind!==
                'all'
            ){
                draft.from_year=
                    x.from;

                if(x.to){
                    draft.to_year=
                        x.to;
                }
            }

            after(back);
        },

        back
    );
}

function genreFilterMenu(
    draft,
    back
){
    loadGenres(
        function(gs){
            var items=[
                {
                    title:'Все жанры',
                    clear:true
                }
            ]
            .concat(
                gs.map(
                    function(g){
                        return {
                            title:
                                genreClientTitle(g),

                            id:
                                genreClientId(g)
                        };
                    }
                )
            );

            showSelect(
                'Жанр',
                items,

                function(x){
                    delete draft.genres;
                    delete draft.genres_title;

                    if(!x.clear){
                        draft.genres=
                            x.id;

                        draft.genres_title=
                            x.title;
                    }

                    after(back);
                },

                back
            );
        }
    );
}

function typeFilterMenu(
    draft,
    back
){
    showSelect(
        'Тип',

        [
            ['Все',''],
            ['TV-сериал','tv'],
            ['Фильм','movie'],
            ['Короткометражный','shortfilm'],
            ['OVA','ova'],
            ['ONA','ona'],
            ['Спецвыпуск','special'],
            ['Короткий сериал','shorttv']
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
            if(x.value){
                draft.types=
                    x.value;
            }
            else{
                delete draft.types;
            }

            after(back);
        },

        back
    );
}

function statusFilterMenu(
    draft,
    back
){
    showSelect(
        'Статус',

        [
            ['Все',''],
            ['Онгоинг','ongoing'],
            ['Завершено','released'],
            ['Анонс','announcement']
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
            if(x.value){
                draft.status=
                    x.value;
            }
            else{
                delete draft.status;
            }

            after(back);
        },

        back
    );
}

function seasonFilterMenu(
    draft,
    back
){
    showSelect(
        'Сезон',

        [
            ['Все',''],
            ['❄ Зима','winter'],
            ['🌸 Весна','spring'],
            ['☀ Лето','summer'],
            ['🍂 Осень','autumn']
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
            if(x.value){
                draft.season=
                    x.value;
            }
            else{
                delete draft.season;
            }

            after(back);
        },

        back
    );
}

function filterMenu(state){
    var draft=
        clone(state);

    function menu(){
        var genre=
            draft.genres_title||
            draft.genres||
            'Все';

        var type=
            draft.types
                ?String(
                    draft.types
                )
                .toUpperCase()
                :'Все';

        var status=
            draft.status
                ?statusLabel(
                    draft.status
                )
                :'Все';

        var year=
            baselineYear(draft)
                ?'Все'
                :(
                    draft.from_year
                        ?(
                            draft.to_year&&
                            draft.to_year!==
                            draft.from_year
                                ?draft.from_year+
                                '–'+
                                draft.to_year
                                :(
                                    draft.to_year
                                        ?String(
                                            draft.from_year
                                        )
                                        :'с '+
                                        draft.from_year
                                )
                        )
                        :'Все'
                );

        var season=
            ({
                winter:'Зима',
                spring:'Весна',
                summer:'Лето',
                autumn:'Осень'
            })[
                draft.season
            ]||
            'Все';

        showSelect(
            'Фильтры',

            [
                {
                    title:
                        '🎭 Жанр: '+
                        genre,

                    key:'genre'
                },
                {
                    title:
                        '🎬 Тип: '+
                        type,

                    key:'type'
                },
                {
                    title:
                        '📡 Статус: '+
                        status,

                    key:'status'
                },
                {
                    title:
                        '📅 Год: '+
                        year,

                    key:'year'
                },
                {
                    title:
                        '🌦 Сезон: '+
                        season,

                    key:'season'
                },
                {
                    title:'✓ Применить',
                    key:'apply'
                },
                {
                    title:'↺ Сбросить фильтры',
                    key:'reset'
                }
            ],

            function(x){
                if(x.key==='genre'){
                    after(
                        function(){
                            genreFilterMenu(
                                draft,
                                menu
                            );
                        }
                    );
                }
                else if(x.key==='type'){
                    after(
                        function(){
                            typeFilterMenu(
                                draft,
                                menu
                            );
                        }
                    );
                }
                else if(x.key==='status'){
                    after(
                        function(){
                            statusFilterMenu(
                                draft,
                                menu
                            );
                        }
                    );
                }
                else if(x.key==='year'){
                    after(
                        function(){
                            yearFilterMenu(
                                draft,
                                menu
                            );
                        }
                    );
                }
                else if(x.key==='season'){
                    after(
                        function(){
                            seasonFilterMenu(
                                draft,
                                menu
                            );
                        }
                    );
                }
                else if(x.key==='reset'){
                    var keep={
                        sort:
                            draft.sort||
                            'top',

                        sort_forward:
                            draft.sort_forward===
                            undefined
                                ?true
                                :draft.sort_forward
                    };

                    if(draft.q){
                        keep.q=
                            draft.q;
                    }

                    draft=keep;

                    after(menu);
                }
                else if(x.key==='apply'){
                    openCatalogState(
                        draft,
                        1,
                        true
                    );
                }
            }
        );
    }

    menu();
}

function pageJump(
    current,
    callback
){
    if(
        !Lampa.Input||
        !Lampa.Input.edit
    ){
        return;
    }

    Lampa.Input.edit(
        {
            title:
                'Перейти на страницу',

            value:
                String(current),

            free:true,
            nosave:true
        },

        function(r){
            var v=
                intv(
                    r&&
                    typeof r==='object'
                        ?r.value
                        :r,

                    0
                );

            if(v>0){
                callback(v);
            }
        }
    );
}

function filterSummary(st){
    var a=[];

    if(st.genres_title){
        a.push(
            st.genres_title
        );
    }
    else if(st.genres){
        a.push(
            'Жанр'
        );
    }

    if(st.types){
        a.push(
            String(
                st.types
            )
            .toUpperCase()
        );
    }

    if(st.status){
        a.push(
            statusLabel(
                st.status
            )
        );
    }

    if(
        st.from_year&&
        !baselineYear(st)
    ){
        a.push(
            st.to_year&&
            st.to_year!==
            st.from_year
                ?st.from_year+
                '–'+
                st.to_year
                :(
                    st.to_year
                        ?String(
                            st.from_year
                        )
                        :'с '+
                        st.from_year
                )
        );
    }

    if(st.season){
        a.push(
            ({
                winter:'Зима',
                spring:'Весна',
                summer:'Лето',
                autumn:'Осень'
            })[
                st.season
            ]||
            st.season
        );
    }

    return a.length
        ?a.join(' • ')
        :'Нет фильтров';
}


/* ============================================================
 * NATIVE ACTION / ANIME CARDS
 * ============================================================ */

function iconSvg(kind,title){
    var paths={
        home:
            '<path d="M4 11 12 4l8 7v9h-6v-6h-4v6H4z"/>',

        filter:
            '<path d="M4 5h16M7 12h10M10 19h4"/>',

        sort:
            '<path d="M8 5v14m0 0-4-4m4 4 4-4M16 19V5m0 0-4 4m4-4 4 4"/>',

        genre:
            '<path d="M4 6h16M4 12h16M4 18h16"/>'+
            '<circle cx="9" cy="6" r="2"/>'+
            '<circle cx="15" cy="12" r="2"/>'+
            '<circle cx="8" cy="18" r="2"/>',

        collection:
            '<path d="M4 6.5 12 3l8 3.5-8 3.5-8-3.5Z"/>'+
            '<path d="m4 11 8 3.5 8-3.5M4 15.5 12 19l8-3.5"/>',

        search:
            '<circle cx="10" cy="10" r="6"/>'+
            '<path d="m15 15 5 5"/>',

        prev:
            '<path d="m15 5-7 7 7 7"/>',

        next:
            '<path d="m9 5 7 7-7 7"/>',

        page:
            '<rect x="5" y="4" width="14" height="16" rx="2"/>'+
            '<path d="M8 9h8M8 13h8M8 17h5"/>'
    };

    var p=
        paths[kind]||
        paths.page;

    var svg=
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">'+
            '<defs>'+
                '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'+
                    '<stop stop-color="#8b5cf6"/>'+
                    '<stop offset="1" stop-color="#e65ed1"/>'+
                '</linearGradient>'+
            '</defs>'+
            '<rect width="300" height="450" rx="28" fill="#111527"/>'+
            '<circle cx="150" cy="170" r="94" fill="url(#g)" opacity=".22"/>'+
            '<g transform="translate(78 98) scale(6)" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+
                p+
            '</g>'+
            '<text x="150" y="330" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="26" font-weight="700">'+
                esc(title).slice(0,18)+
            '</text>'+
        '</svg>';

    return (
        'data:image/svg+xml;charset=utf-8,'+
        encodeURIComponent(svg)
    );
}

function actionCard(
    title,
    overview,
    kind,
    fn
){
    var c={
        id:
            NS+
            '_action_'+
            kind+
            '_'+
            title,

        title:title,

        overview:
            overview||
            '',

        poster:
            iconSvg(
                kind,
                title
            ),

        source:'animehub',

        params:{
            style:{
                name:'default'
            },

            on:{
                'hover:enter':
                    fn
            }
        }
    };

    var m=
        cardMask();

    if(
        m!==
        undefined
    ){
        c.params.module=
            m;
    }

    return c;
}

function nativeCard(
    a,
    options
){
    options=
        options||
        {};

    var st=
        options.state||
        null;

    var title=
        a.title||
        'Anime';

    if(
        st&&
        st.episode
    ){
        title+=
            ' • серия '+
            st.episode;
    }

    var c={
        id:
            'animehub_'+
            String(
                a.id||
                ''
            ),

        title:title,

        original_title:
            a.original||
            '',

        release_date:
            a.year
                ?String(
                    a.year
                )+
                '-01-01'
                :'',

        vote_average:
            num(
                a.score
            ),

        poster:
            a.poster||
            '',

        source:'animehub',

        ahAnime:a,

        params:{
            style:{
                name:
                    options.wide
                        ?'wide'
                        :'default'
            },

            on:{
                'hover:enter':
                    function(){
                        options.enter
                            ?options.enter(
                                a,
                                st
                            )
                            :openDetail(a);
                    }
            }
        }
    };

    if(options.wide){
        c.cover=
            a.background||
            a.posterHero||
            a.poster||
            '';

        c.overview=
            st&&
            st.episode
                ?(
                    'Продолжить • серия '+
                    st.episode
                )
                :[
                    a.year||'',
                    typeLabel(a),

                    num(
                        a.score
                    )>0
                        ?'★ '+
                        score(
                            a.score
                        )
                        :''
                ]
                .filter(Boolean)
                .join(' • ');
    }

    var m=
        cardMask();

    if(
        m!==
        undefined
    ){
        c.params.module=
            m;
    }

    return c;
}

function lineData(
    title,
    items,
    options
){
    options=
        options||
        {};

    return {
        title:title,

        results:
            (
                items||
                []
            )
            .map(
                function(a){
                    return nativeCard(
                        a,

                        {
                            wide:
                                !!options.wide,

                            state:
                                options.stateMap&&
                                options.stateMap[
                                    String(a.id)
                                ],

                            enter:
                                options.enter
                        }
                    );
                }
            ),

        total_pages:
            options.more
                ?2
                :1,

        params:{
            items:{
                mapping:'line',
                align_left:false,
                view:
                    options.view||
                    6
            },

            emit:
                options.more
                    ?{
                        onMore:
                            options.more
                    }
                    :{}
        }
    };
}


/* ============================================================
 * GENRE ARTWORK - V1.4.1 FIX
 * ============================================================ */

function genrePoster(
    title,
    index
){
    var colors=[
        ['#ff6878','#825ed8'],
        ['#50c5b7','#256ca9'],
        ['#f0a45d','#d34d74'],
        ['#8b79ed','#4c60b8']
    ][
        index%
        4
    ];

    title=
        clean(title);

    var display=
        title.length>18
            ?title.slice(
                0,
                17
            )+
            '…'
            :title;

    var mark=
        title
        .charAt(0)
        .toUpperCase();

    var fontSize=
        display.length>14
            ?24
            :(
                display.length>10
                    ?27
                    :31
            );

    var svg=
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">'+

            '<defs>'+
                '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'+
                    '<stop stop-color="'+
                        colors[0]+
                    '"/>'+
                    '<stop offset="1" stop-color="'+
                        colors[1]+
                    '"/>'+
                '</linearGradient>'+
            '</defs>'+

            '<rect width="300" height="450" rx="28" fill="url(#g)"/>'+

            '<circle cx="255" cy="70" r="120" fill="#fff" opacity=".09"/>'+
            '<circle cx="255" cy="70" r="72" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="3"/>'+

            '<text x="28" y="205" '+
                'fill="#fff" fill-opacity=".24" '+
                'font-family="sans-serif" font-size="118" font-weight="800">'+
                esc(mark)+
            '</text>'+

            '<rect x="20" y="292" width="260" height="118" rx="18" fill="#070914" opacity=".25"/>'+

            '<text x="150" y="350" '+
                'text-anchor="middle" '+
                'fill="#fff" '+
                'font-family="sans-serif" '+
                'font-size="'+
                    fontSize+
                '" '+
                'font-weight="800">'+
                esc(display)+
            '</text>'+

            '<path d="m242 382 22 0m-8-8 8 8-8 8" '+
                'fill="none" stroke="#fff" stroke-width="5" '+
                'stroke-linecap="round" stroke-linejoin="round"/>'+

        '</svg>';

    return (
        'data:image/svg+xml;charset=utf-8,'+
        encodeURIComponent(svg)
    );
}

function collectionCard(c){
    var fake={
        id:
            'collection_'+
            c.id,

        title:
            c.title,

        poster:
            c.poster||
            c.previews&&
            c.previews[0]||
            '',

        score:0,
        year:null,

        type:{
            name:
                c.count
                    ?c.count+
                    ' аниме'
                    :'Коллекция'
        },

        source:'collection'
    };

    return nativeCard(
        fake,

        {
            wide:true,

            enter:
                function(){
                    openCollection(
                        c,
                        1,
                        false
                    );
                }
        }
    );
}

function navActions(state){
    return [
        actionCard(
            'Главная',
            'AnimeHub',
            'home',
            openHome
        ),

        actionCard(
            'Фильтры',
            filterSummary(state),
            'filter',

            function(){
                filterMenu(state);
            }
        ),

        actionCard(
            'Сортировка',
            sortName(state),
            'sort',

            function(){
                chooseSort(state);
            }
        ),

        actionCard(
            'Жанры',
            'Все жанры',
            'genre',
            openGenres
        ),

        actionCard(
            'Коллекции',
            'Подборки',
            'collection',

            function(){
                openCollections(
                    1,
                    false
                );
            }
        ),

        actionCard(
            'Поиск',
            'По названию',
            'search',
            openSearch
        )
    ];
}


/* ============================================================
 * OPEN DETAIL
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

            component:DETAIL,

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
                    q:a.title,
                    page:1,
                    limit:6,
                    sort:'top',
                    sort_forward:true
                }
            ),

            2,

            function(d){
                var best=
                    (
                        d.items||
                        []
                    )[0];

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
 * GENERIC NATIVE CATEGORY
 * ============================================================ */

function categoryComponent(
    object,
    options
){
    object.page=1;

    object.params=
        object.params||
        {};

    object.params.items={
        mapping:'grid',

        cols:
            options.cols||
            5,

        limit_view:
            options.limit_view||
            5,

        limit_collection:
            options.limit_collection||
            35
    };

    var net=
        new Lampa.Reguest();

    var comp=
        Lampa.Maker.make(
            'Category',
            object
        );

    comp.use({
        onCreate:function(){
            var self=
                this;

            options.load(
                net,

                function(data){
                    var cards=
                        options.cards(
                            data
                        );

                    self.build({
                        results:cards,
                        page:1,
                        total_pages:1,

                        total_results:
                            options.total
                                ?options.total(
                                    data
                                )
                                :cards.length,

                        title:
                            options.title||
                            object.title||
                            ''
                    });
                },

                function(){
                    self.empty(
                        true
                    );

                    notify(
                        options.error||
                        'Не удалось загрузить'
                    );
                }
            );
        },

        onDestroy:function(){
            try{
                net.clear();
            }
            catch(e){}
        }
    });

    return comp;
}


/* ============================================================
 * FIXED-PAGE CATALOGUE
 * ============================================================ */

function catalogParams(
    st,
    page
){
    var p={
        page:page,
        limit:20,

        sort:
            st.sort||
            'top',

        sort_forward:
            st.sort_forward===
            undefined
                ?true
                :st.sort_forward
    };

    [
        'q',
        'genres',
        'types',
        'status',
        'from_year',
        'to_year',
        'season'
    ]
    .forEach(
        function(k){
            if(
                st[k]!==undefined&&
                st[k]!==null&&
                st[k]!==''
            ){
                p[k]=st[k];
            }
        }
    );

    return p;
}

function CatalogComponent(object){
    var state=
        stateFromObject(
            object
        );

    var page=
        Math.max(
            1,
            intv(
                object.ah_page,
                1
            )
        );

    return categoryComponent(
        object,

        {
            cols:5,

            load:function(
                net,
                ok,
                fail
            ){
                requestJson(
                    net,

                    workerUrl(
                        'catalog',

                        catalogParams(
                            state,
                            page
                        )
                    ),

                    4,
                    ok,
                    fail
                );
            },

            cards:function(data){
                var cards=
                    navActions(
                        state
                    );

                (
                    data.items||
                    []
                )
                .forEach(
                    function(a){
                        cards.push(
                            nativeCard(a)
                        );
                    }
                );

                if(page>1){
                    cards.push(
                        actionCard(
                            '← Пред.',

                            'Страница '+
                            (
                                page-
                                1
                            ),

                            'prev',

                            function(){
                                openCatalogState(
                                    state,
                                    page-
                                    1,
                                    true
                                );
                            }
                        )
                    );
                }

                cards.push(
                    actionCard(
                        'Страница '+
                        page,

                        'Перейти к странице',

                        'page',

                        function(){
                            pageJump(
                                page,

                                function(v){
                                    openCatalogState(
                                        state,
                                        v,
                                        true
                                    );
                                }
                            );
                        }
                    )
                );

                if(data.hasNext){
                    cards.push(
                        actionCard(
                            'След. →',

                            'Страница '+
                            (
                                page+
                                1
                            ),

                            'next',

                            function(){
                                openCatalogState(
                                    state,
                                    page+
                                    1,
                                    true
                                );
                            }
                        )
                    );
                }

                return cards;
            },

            title:
                catalogTitle(
                    state
                ),

            error:
                'Не удалось загрузить каталог'
        }
    );
}


/* ============================================================
 * GENRES - V1.4.1 FIXED
 * ============================================================ */

function GenresComponent(object){
    return categoryComponent(
        object,

        {
            cols:5,

            load:function(
                net,
                ok,
                fail
            ){
                /*
                 * IMPORTANT:
                 * use genreRequestUrl() rather than plain /genres.
                 * This bypasses the stale blank-label cache from
                 * previous AnimeHub versions.
                 */
                requestJson(
                    net,

                    genreRequestUrl(),

                    1440,

                    function(data){
                        var genres=
                            normalizeClientGenres(
                                data
                            );

                        genresCache=
                            genres;

                        ok({
                            ok:true,
                            genres:genres
                        });
                    },

                    fail
                );
            },

            cards:function(data){
                var cards=[
                    actionCard(
                        'Главная',
                        'AnimeHub',
                        'home',
                        openHome
                    ),

                    actionCard(
                        'Каталог',
                        'Все аниме',
                        'filter',

                        function(){
                            openCatalogState(
                                defaultCatalogState(),
                                1,
                                false
                            );
                        }
                    ),

                    actionCard(
                        'Коллекции',
                        'Подборки',
                        'collection',

                        function(){
                            openCollections(
                                1,
                                false
                            );
                        }
                    ),

                    actionCard(
                        'Поиск',
                        'По названию',
                        'search',
                        openSearch
                    )
                ];

                (
                    data.genres||
                    []
                )
                .forEach(
                    function(
                        g,
                        index
                    ){
                        var title=
                            genreClientTitle(
                                g
                            );

                        var id=
                            genreClientId(
                                g
                            );

                        /*
                         * Never create anonymous/blank cards.
                         */
                        if(
                            !title||
                            !id
                        ){
                            return;
                        }

                        var poster=
                            genrePoster(
                                title,
                                index
                            );

                        var c={
                            id:
                                'genre_'+
                                id,

                            title:
                                title,

                            original_title:
                                '',

                            overview:
                                g.description||
                                (
                                    'Аниме жанра «'+
                                    title+
                                    '»'
                                ),

                            poster:
                                poster,

                            img:
                                poster,

                            source:
                                'animehub',

                            params:{
                                style:{
                                    name:'default'
                                },

                                on:{
                                    'hover:enter':
                                        function(){
                                            var st=
                                                defaultCatalogState();

                                            st.genres=
                                                id;

                                            st.genres_title=
                                                title;

                                            openCatalogState(
                                                st,
                                                1,
                                                false
                                            );
                                        }
                                }
                            }
                        };

                        var m=
                            cardMask();

                        if(
                            m!==
                            undefined
                        ){
                            c.params.module=
                                m;
                        }

                        cards.push(c);
                    }
                );

                return cards;
            },

            title:'Жанры',

            error:
                'Не удалось загрузить жанры'
        }
    );
}


/* ============================================================
 * COLLECTIONS
 * ============================================================ */

function CollectionsComponent(object){
    var page=
        Math.max(
            1,
            intv(
                object.ah_page,
                1
            )
        );

    return categoryComponent(
        object,

        {
            cols:4,
            limit_collection:30,

            load:function(
                net,
                ok,
                fail
            ){
                requestJson(
                    net,

                    workerUrl(
                        'collections',

                        {
                            page:page,
                            limit:20
                        }
                    ),

                    10,
                    ok,
                    fail
                );
            },

            cards:function(data){
                var cards=[
                    actionCard(
                        'Главная',
                        'AnimeHub',
                        'home',
                        openHome
                    ),

                    actionCard(
                        'Каталог',
                        'Все аниме',
                        'filter',

                        function(){
                            openCatalogState(
                                defaultCatalogState(),
                                1,
                                false
                            );
                        }
                    ),

                    actionCard(
                        'Жанры',
                        'Все жанры',
                        'genre',
                        openGenres
                    )
                ];

                (
                    data.items||
                    []
                )
                .forEach(
                    function(c){
                        cards.push(
                            collectionCard(c)
                        );
                    }
                );

                if(page>1){
                    cards.push(
                        actionCard(
                            '← Пред.',

                            'Страница '+
                            (
                                page-
                                1
                            ),

                            'prev',

                            function(){
                                openCollections(
                                    page-
                                    1,
                                    true
                                );
                            }
                        )
                    );
                }

                cards.push(
                    actionCard(
                        'Страница '+
                        page,

                        'Перейти к странице',

                        'page',

                        function(){
                            pageJump(
                                page,

                                function(v){
                                    openCollections(
                                        v,
                                        true
                                    );
                                }
                            );
                        }
                    )
                );

                if(data.hasNext){
                    cards.push(
                        actionCard(
                            'След. →',

                            'Страница '+
                            (
                                page+
                                1
                            ),

                            'next',

                            function(){
                                openCollections(
                                    page+
                                    1,
                                    true
                                );
                            }
                        )
                    );
                }

                return cards;
            },

            title:'Коллекции',

            error:
                'Не удалось загрузить коллекции'
        }
    );
}

function CollectionComponent(object){
    var c=
        object.ah_collection||
        {};

    var page=
        Math.max(
            1,
            intv(
                object.ah_page,
                1
            )
        );

    return categoryComponent(
        object,

        {
            cols:5,

            load:function(
                net,
                ok,
                fail
            ){
                requestJson(
                    net,

                    workerUrl(
                        'collection',

                        {
                            id:c.id,
                            page:page,
                            limit:20
                        }
                    ),

                    10,
                    ok,
                    fail
                );
            },

            cards:function(data){
                if(
                    data.collection&&
                    data.collection.id
                ){
                    c=
                        data.collection;
                }

                var cards=[
                    actionCard(
                        'Главная',
                        'AnimeHub',
                        'home',
                        openHome
                    ),

                    actionCard(
                        'Коллекции',
                        'Все подборки',
                        'collection',

                        function(){
                            openCollections(
                                1,
                                false
                            );
                        }
                    ),

                    actionCard(
                        'Каталог',
                        'Все аниме',
                        'filter',

                        function(){
                            openCatalogState(
                                defaultCatalogState(),
                                1,
                                false
                            );
                        }
                    )
                ];

                (
                    data.items||
                    []
                )
                .forEach(
                    function(a){
                        cards.push(
                            nativeCard(a)
                        );
                    }
                );

                if(page>1){
                    cards.push(
                        actionCard(
                            '← Пред.',

                            'Страница '+
                            (
                                page-
                                1
                            ),

                            'prev',

                            function(){
                                openCollection(
                                    c,
                                    page-
                                    1,
                                    true
                                );
                            }
                        )
                    );
                }

                cards.push(
                    actionCard(
                        'Страница '+
                        page,

                        'Перейти к странице',

                        'page',

                        function(){
                            pageJump(
                                page,

                                function(v){
                                    openCollection(
                                        c,
                                        v,
                                        true
                                    );
                                }
                            );
                        }
                    )
                );

                if(data.hasNext){
                    cards.push(
                        actionCard(
                            'След. →',

                            'Страница '+
                            (
                                page+
                                1
                            ),

                            'next',

                            function(){
                                openCollection(
                                    c,
                                    page+
                                    1,
                                    true
                                );
                            }
                        )
                    );
                }

                return cards;
            },

            title:
                c.title||
                'Коллекция',

            error:
                'Не удалось загрузить коллекцию'
        }
    );
}


/* ============================================================
 * FAVOURITES / SCHEDULE
 * ============================================================ */

function FavoritesComponent(object){
    return categoryComponent(
        object,

        {
            cols:5,

            load:function(
                net,
                ok
            ){
                ok({
                    items:
                        storedList(
                            FAVORITES_KEY
                        )
                });
            },

            cards:function(data){
                var cards=[
                    actionCard(
                        'Главная',
                        'AnimeHub',
                        'home',
                        openHome
                    ),

                    actionCard(
                        'Каталог',
                        'Все аниме',
                        'filter',

                        function(){
                            openCatalogState(
                                defaultCatalogState(),
                                1,
                                false
                            );
                        }
                    ),

                    actionCard(
                        'Жанры',
                        'Все жанры',
                        'genre',
                        openGenres
                    ),

                    actionCard(
                        'Коллекции',
                        'Подборки',
                        'collection',

                        function(){
                            openCollections(
                                1,
                                false
                            );
                        }
                    )
                ];

                (
                    data.items||
                    []
                )
                .slice(
                    0,
                    50
                )
                .forEach(
                    function(a){
                        cards.push(
                            nativeCard(a)
                        );
                    }
                );

                return cards;
            },

            title:'Избранное'
        }
    );
}

function ScheduleComponent(object){
    return categoryComponent(
        object,

        {
            cols:5,

            load:function(
                net,
                ok,
                fail
            ){
                requestJson(
                    net,

                    workerUrl(
                        'schedule'
                    ),

                    10,
                    ok,
                    fail
                );
            },

            cards:function(data){
                var cards=[
                    actionCard(
                        'Главная',
                        'AnimeHub',
                        'home',
                        openHome
                    ),

                    actionCard(
                        'Каталог',
                        'Все аниме',
                        'filter',

                        function(){
                            openCatalogState(
                                defaultCatalogState(),
                                1,
                                false
                            );
                        }
                    )
                ];

                (
                    data.items||
                    []
                )
                .forEach(
                    function(a){
                        cards.push(
                            nativeCard(a)
                        );
                    }
                );

                return cards;
            },

            title:'Расписание',

            error:
                'Не удалось загрузить расписание'
        }
    );
}


/* ============================================================
 * HOME HERO / NAVIGATION
 * ============================================================ */

function MiniEmit(){
    this.components=[];
}

MiniEmit.prototype.use=
function(m){
    if(
        m&&
        this.components.indexOf(m)<
        0
    ){
        this.components.push(m);
    }
};

MiniEmit.prototype.emit=
function(event){
    var args=
        Array.prototype.slice.call(
            arguments,
            1
        );

    var name=
        event.charAt(0)
        .toUpperCase()+
        event.slice(1);

    var only=null;

    this.components.forEach(
        function(c){
            if(
                typeof c[
                    'only'+
                    name
                ]===
                'function'
            ){
                only=
                    c[
                        'only'+
                        name
                    ];
            }
        }
    );

    if(only){
        return only.apply(
            this,
            args
        );
    }

    var self=
        this;

    this.components.forEach(
        function(c){
            if(
                typeof c[
                    'on'+
                    name
                ]===
                'function'
            ){
                c[
                    'on'+
                    name
                ]
                .apply(
                    self,
                    args
                );
            }
        }
    );
};

function topNav(active){
    var top=
        $('<div class="ah140-top"></div>');

    var brand=
        $('<div class="ah140-brand"></div>')
        .append(
            toriiSvg(
                'ah140-logo'
            ),

            '<span class="ah140-name">'+
                'AnimeHub'+
            '</span>'
        );

    var nav=
        $('<div class="ah140-nav"></div>');

    function add(
        key,
        title,
        fn
    ){
        var b=
            $('<div class="ah140-navbtn selector"></div>')
            .text(
                title
            );

        if(
            active===
            key
        ){
            b.css(
                'background',
                'rgba(131,75,235,.22)'
            );
        }

        b.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                fn();
            }
        );

        nav.append(b);
    }

    add(
        'home',
        'Главная',

        function(){
            if(
                active!==
                'home'
            ){
                openHome();
            }
        }
    );

    add(
        'catalog',
        'Каталог',

        function(){
            openCatalogState(
                defaultCatalogState(),
                1,
                false
            );
        }
    );

    add(
        'genres',
        'Жанры',
        openGenres
    );

    add(
        'collections',
        'Коллекции',

        function(){
            openCollections(
                1,
                false
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

    return top.append(
        brand,
        nav
    );
}

function HeroLine(data){
    MiniEmit.call(this);

    this.data=data;

    this.html=
        $('<div class="ah140-hero-line"></div>');

    this.last=null;
}

HeroLine.prototype=
    Object.create(
        MiniEmit.prototype
    );

HeroLine.prototype.constructor=
    HeroLine;

HeroLine.prototype.create=
function(){
    var self=this;

    var a=
        this.data.hero||
        {};

    this.html.append(
        topNav(
            'home'
        )
    );

    var hero=
        $('<div class="ah140-hero"></div>');

    var bg=
        a.background||
        a.posterHero||
        a.poster||
        '';

    if(bg){
        hero.append(
            imageElement(
                bg,
                'ah140-bg'
            )
        );
    }

    hero.append(
        '<div class="ah140-shade"></div>'
    );

    var copy=
        $('<div class="ah140-hero-copy"></div>');

    copy.append(
        '<div class="ah140-kicker">'+
            'AnimeHub • YummyAnime'+
        '</div>'+
        '<div class="ah140-title">'+
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
        copy.append(
            '<div class="ah140-original">'+
                esc(
                    a.original
                )+
            '</div>'
        );
    }

    var meta=
        $('<div class="ah140-meta"></div>');

    if(
        num(
            a.score
        )>
        0
    ){
        meta.append(
            '<span class="ah140-chip ah140-score">'+
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
            '<span class="ah140-chip">'+
                esc(
                    a.year
                )+
            '</span>'
        );
    }

    meta.append(
        '<span class="ah140-chip">'+
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
            '<span class="ah140-chip">'+
                esc(
                    statusLabel(
                        a.status.alias
                    )
                )+
            '</span>'
        );
    }

    copy.append(
        meta,

        '<div class="ah140-desc">'+
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
        $('<div class="ah140-actions"></div>');

    var watch=
        $('<div class="ah140-btn primary selector">▶ Смотреть</div>');

    var details=
        $('<div class="ah140-btn selector">ⓘ Подробнее</div>');

    var fav=
        $('<div class="ah140-btn selector"></div>');

    function rf(){
        fav.text(
            isFavorite(a)
                ?'★ В избранном'
                :'☆ В избранное'
        );
    }

    rf();

    watch.on(
        'hover:enter click',

        function(e){
            if(e){
                e.preventDefault();
            }

            watchAnime(a);
        }
    );

    details.on(
        'hover:enter click',

        function(e){
            if(e){
                e.preventDefault();
            }

            openDetail(a);
        }
    );

    fav.on(
        'hover:enter click',

        function(e){
            if(e){
                e.preventDefault();
            }

            notify(
                toggleFavorite(a)
                    ?'Добавлено в избранное'
                    :'Удалено из избранного'
            );

            rf();
        }
    );

    acts.append(
        watch,
        details,
        fav
    );

    copy.append(acts);
    hero.append(copy);

    this.html.append(hero);

    this.html
        .find(
            '.selector'
        )
        .on(
            'hover:focus',

            function(){
                self.last=this;
            }
        );
};

HeroLine.prototype.toggle=
function(){
    var self=this;

    this.emit(
        'active'
    );

    Lampa.Controller.add(
        'animehub_hero',

        {
            link:this,

            toggle:function(){
                Lampa.Controller.collectionSet(
                    self.html[0]
                );

                Lampa.Controller.collectionFocus(
                    self.last||
                    self.html.find(
                        '.selector'
                    )[0]||
                    false,

                    self.html[0]
                );

                self.emit(
                    'toggle'
                );
            },

            left:function(){
                Navigator.canmove(
                    'left'
                )
                    ?Navigator.move(
                        'left'
                    )
                    :self.emit(
                        'left'
                    );
            },

            right:function(){
                if(
                    Navigator.canmove(
                        'right'
                    )
                ){
                    Navigator.move(
                        'right'
                    );
                }
            },

            up:function(){
                Navigator.canmove(
                    'up'
                )
                    ?Navigator.move(
                        'up'
                    )
                    :self.emit(
                        'up'
                    );
            },

            down:function(){
                Navigator.canmove(
                    'down'
                )
                    ?Navigator.move(
                        'down'
                    )
                    :self.emit(
                        'down'
                    );
            },

            back:function(){
                self.emit(
                    'back'
                );
            }
        }
    );

    Lampa.Controller.toggle(
        'animehub_hero'
    );
};

HeroLine.prototype.render=
function(js){
    return js
        ?this.html[0]
        :this.html;
};

HeroLine.prototype.destroy=
function(){
    this.html.remove();
    this.components=[];
};

function heroLineData(hero){
    return {
        title:'',
        hero:hero,
        results:[],
        ahHero:true,

        params:{
            createInstance:
                function(data){
                    return new HeroLine(
                        data
                    );
                }
        }
    };
}


/* ============================================================
 * HOME
 * ============================================================ */

function HomeComponent(object){
    var net=
        new Lampa.Reguest();

    var comp=
        Lampa.Maker.make(
            'Main',
            object
        );

    comp.use({
        onCreate:function(){
            var self=this;

            requestJson(
                net,

                workerUrl(
                    'home'
                ),

                2,

                function(d){
                    var lines=[];

                    if(d.hero){
                        lines.push(
                            heroLineData(
                                d.hero
                            )
                        );
                    }

                    var states=
                        continueStates();

                    if(states.length){
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

                        lines.push(
                            lineData(
                                'Продолжаем смотреть',
                                items,

                                {
                                    wide:true,
                                    stateMap:map,
                                    view:5,

                                    enter:
                                        function(a){
                                            openDetail(a);
                                        }
                                }
                            )
                        );
                    }

                    if(
                        d.ongoing&&
                        d.ongoing.length
                    ){
                        lines.push(
                            lineData(
                                'Сейчас выходит',
                                d.ongoing,

                                {
                                    view:6,

                                    more:
                                        function(){
                                            openCatalog(
                                                'ongoing',
                                                '',
                                                'Онгоинги',
                                                1
                                            );
                                        }
                                }
                            )
                        );
                    }

                    if(
                        d.latest&&
                        d.latest.length
                    ){
                        lines.push(
                            lineData(
                                'Новинки',
                                d.latest,

                                {
                                    view:6,

                                    more:
                                        function(){
                                            openCatalog(
                                                'latest',
                                                '',
                                                'Новинки',
                                                1
                                            );
                                        }
                                }
                            )
                        );
                    }

                    if(
                        d.top&&
                        d.top.length
                    ){
                        lines.push(
                            lineData(
                                'Лучшее',
                                d.top,

                                {
                                    view:6,

                                    more:
                                        function(){
                                            openCatalog(
                                                'top',
                                                '',
                                                'Топ-100',
                                                1
                                            );
                                        }
                                }
                            )
                        );
                    }

                    self.build(
                        lines
                    );
                },

                function(){
                    self.empty(
                        true
                    );

                    notify(
                        'Не удалось загрузить AnimeHub'
                    );
                }
            );
        },

        onDestroy:function(){
            try{
                net.clear();
            }
            catch(e){}
        }
    });

    return comp;
}


/* ============================================================
 * VIDEO HELPERS
 * ============================================================ */

function videoData(v){
    var d=
        v&&
        v.data;

    if(!d){
        return {};
    }

    if(
        typeof d===
        'object'
    ){
        return d;
    }

    if(
        typeof d===
        'string'
    ){
        try{
            return JSON.parse(d)||{};
        }
        catch(e){}
    }

    return {};
}

function normalizeVideoUrl(u){
    u=clean(u);

    if(!u){
        return '';
    }

    if(
        u.indexOf('//')===
        0
    ){
        return 'https:'+u;
    }

    if(
        /^http:\/\/(?:www\.)?kodik\./i
            .test(u)
    ){
        return (
            'https://'+
            u.slice(7)
        );
    }

    return u;
}

function videoSourceUrl(v){
    if(!v){
        return '';
    }

    var d=
        videoData(v);

    return normalizeVideoUrl(
        v.yani_stream_url||
        d.yani_stream_url||

        v.iframe_url||
        v.iframeUrl||

        v.url||

        v.player_url||
        v.playerUrl||

        v.link||

        d.iframe_url||
        d.iframeUrl||

        d.url||

        d.player_url||
        d.playerUrl||

        d.link
    );
}

function videoHost(u){
    try{
        return new URL(u)
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

function sourceKind(
    url,
    v
){
    var d=
        videoData(v);

    var x=
        (
            String(
                url||
                ''
            )+
            ' '+
            String(
                v&&
                v.player||
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
            .test(x)
    ){
        return 'cvh';
    }

    if(
        /iframevk|vkvideo|vk\.com|video_ext\.php|(?:^|\s)vk(?:\s|$)/i
            .test(x)
    ){
        return 'vk';
    }

    if(
        /kodik/i
            .test(x)
    ){
        return 'kodik';
    }

    if(
        /aksor/i
            .test(x)
    ){
        return 'aksor';
    }

    if(
        /rutube/i
            .test(x)
    ){
        return 'rutube';
    }

    return 'unsupported';
}

function voiceName(v){
    var d=
        videoData(v);

    return clean(
        d.dubbing||
        d.translation||
        d.voice||
        d.voice_name||

        v.dubbing||
        v.translation||
        v.voice||

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
            v,
            index
        ){
            var url=
                videoSourceUrl(v);

            if(!url){
                return;
            }

            v.iframe_url=
                url;

            v._ahEpisode=
                episodeValue(
                    v,
                    index
                );

            var d=
                videoData(v);

            var voice=
                voiceName(v);

            var host=
                videoHost(url);

            var provider=
                clean(
                    d.player_id||
                    d.player||
                    d.source||
                    d.service||
                    host
                );

            var key=
                voice.toLowerCase()+
                '|'+
                provider.toLowerCase();

            if(!groups[key]){
                groups[key]={
                    key:key,

                    title:
                        voice,

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
                            v
                        ),

                    videos:[]
                };
            }

            groups[key]
                .videos
                .push(v);
        }
    );

    var priority={
        direct:6,
        cvh:5,
        vk:4,
        kodik:3,
        aksor:2,
        rutube:1,
        unsupported:0
    };

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
                                a.index
                            )-
                            intv(
                                b.index
                            )
                        );
                    }
                );

                return g;
            }
        )
        .sort(
            function(a,b){
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
            v,
            index
        ){
            var ep=
                episodeValue(
                    v,
                    index
                );

            var k=
                String(ep);

            if(!seen[k]){
                seen[k]=1;
                out.push(ep);
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
    g,
    ep
){
    var found=null;

    (
        g&&
        g.videos||
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
                return (
                    !!findVideo(
                        g,
                        ep
                    )&&
                    g.kind!==
                    'unsupported'
                );
            }
        );
}


/* ============================================================
 * VIDEO CACHE
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
    show
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
        after(
            function(){
                ok(
                    hit.videos
                );
            }
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

    if(show!==false){
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

        0,

        function(d){
            if(show!==false){
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
            if(show!==false){
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
 * ============================================================ */

function restoreContent(){
    after(
        function(){
            try{
                Lampa.Controller.toggle(
                    'content'
                );
            }
            catch(e){}
        }
    );
}

function currentOrFirstEpisode(
    a,
    videos
){
    var eps=
        episodeNumbers(
            videos
        );

    if(!eps.length){
        return null;
    }

    var st=
        watchState(a);

    var ep=
        num(
            st.episode
        );

    if(
        eps.indexOf(ep)<
        0
    ){
        ep=
            eps[0];
    }
    else if(st.completed){
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

    return ep;
}

function chooseSourceForEpisode(
    a,
    videos,
    ep,
    alwaysAsk
){
    var groups=
        groupsForEpisode(
            videos,
            ep
        );

    if(!groups.length){
        notify(
            'Для этой серии нет поддерживаемого источника'
        );

        restoreContent();
        return;
    }

    var st=
        watchState(a);

    var preferred=null;

    if(st.providerKey){
        groups.some(
            function(g){
                if(
                    g.key===
                    st.providerKey
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
            a,
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
            a,
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
                    title:g.title,

                    subtitle:
                        String(
                            g.player||
                            g.kind||
                            ''
                        )
                        .toUpperCase(),

                    group:g
                };
            }
        ),

        function(item){
            after(
                function(){
                    resolveAndPlay(
                        a,
                        item.group,

                        findVideo(
                            item.group,
                            ep
                        )
                    );
                }
            );
        },

        restoreContent
    );
}

function watchAnime(
    a,
    videos,
    forced
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
            watchState(a);

        var ep=
            forced!=null
                ?forced
                :currentOrFirstEpisode(
                    a,
                    list
                );

        var resume=
            forced==null&&
            num(
                st.episode
            )>
            0;

        chooseSourceForEpisode(
            a,
            list,
            ep,
            !resume
        );
    }

    videos
        ?go(videos)
        :loadVideos(
            a,
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
    a,
    videos
){
    function go(list){
        var ep=
            currentOrFirstEpisode(
                a,
                list
            );

        if(ep==null){
            notify(
                'Видео для этого тайтла не найдено'
            );

            restoreContent();
            return;
        }

        chooseSourceForEpisode(
            a,
            list,
            ep,
            true
        );
    }

    videos
        ?go(videos)
        :loadVideos(
            a,
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

function resolveAndPlay(
    a,
    g,
    v
){
    if(!v){
        notify(
            'Видео не найдено'
        );

        restoreContent();
        return;
    }

    var url=
        videoSourceUrl(v);

    if(!url){
        notify(
            'У источника нет адреса'
        );

        restoreContent();
        return;
    }

    var d=
        videoData(v);

    var direct=
        v.yani_stream_url||
        d.yani_stream_url;

    if(direct){
        launchPlayer(
            a,
            g,
            v,

            {
                url:
                    normalizeVideoUrl(
                        direct
                    ),

                quality:
                    v.yani_stream_quality||
                    d.yani_stream_quality||
                    'auto',

                qualities:
                    v.yani_stream_qualities||
                    d.yani_stream_qualities||
                    {
                        auto:
                            normalizeVideoUrl(
                                direct
                            )
                    },

                headers:
                    v.yani_stream_headers||
                    d.yani_stream_headers||
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
                    g.kind||
                    g.player||
                    '',

                ua:
                    window.navigator&&
                    window.navigator.userAgent||
                    ''
            }
        ),

        0,

        function(r){
            try{
                Lampa.Loading.stop();
                net.clear();
            }
            catch(e){}

            if(
                !r.stream||
                !r.stream.url
            ){
                notify(
                    'Прямой поток не найден'
                );

                restoreContent();
                return;
            }

            v.yani_stream_url=
                r.stream.url;

            v.yani_stream_quality=
                r.stream.quality||
                '';

            v.yani_stream_qualities=
                r.stream.qualities||
                null;

            v.yani_stream_headers=
                r.stream.headers||
                null;

            launchPlayer(
                a,
                g,
                v,
                r.stream
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
    a,
    g,
    v,
    stream
){
    var url=
        stream.url;

    var ext=
        extension(url);

    var old=
        watchState(a);

    var same=
        Math.abs(
            num(
                old.episode
            )-
            num(
                v._ahEpisode
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

    saveWatchState(
        a,

        {
            episode:
                v._ahEpisode,

            videoId:
                v.video_id||
                v.id||
                '',

            providerKey:
                g.key,

            provider:
                g.kind,

            dubbing:
                g.title,

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

    var item={
        title:
            (
                a.title||
                'AnimeHub'
            )+
            ' • Серия '+
            v._ahEpisode+
            ' • '+
            g.title,

        url:url,
        time:time,
        isonline:true,

        quality:
            stream.qualities||
            {
                auto:url
            },

        headers:
            stream.headers||
            {},

        poster:
            a.poster||
            '',

        animehub_anime:
            compactAnime(a),

        animehub_episode:
            v._ahEpisode,

        animehub_provider_key:
            g.key,

        animehub_video_id:
            v.video_id||
            v.id||
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
                [
                    item
                ]
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
                    saveWatchState(
                        a,

                        {
                            episode:ep,

                            videoId:
                                data.animehub_video_id||
                                '',

                            providerKey:
                                data.animehub_provider_key||
                                '',

                            position:cur,
                            duration:dur,

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
                    saveWatchState(
                        a,

                        {
                            episode:ep,
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
 * DETAIL
 * ============================================================ */

function detailNav(){
    return topNav('');
}

function DetailComponent(object){
    var net=
        new Lampa.Reguest();

    var scroll=
        new Lampa.Scroll({
            mask:true,
            over:true,
            step:250
        });

    var root=
        $('<div class="ah140-detail-wrap"></div>');

    var initial=
        object.ah_item||
        {};

    var anime=null;
    var videos=null;
    var last=null;

    var episodeBlock=null;
    var recommendBlock=null;

    var episodeLine=null;
    var recommendLine=null;

    var rangeStart=null;

    var alive=false;


    function bindFocus(){
        root
            .off(
                'hover:focus.'+
                NS
            )
            .on(
                'hover:focus.'+
                NS,

                '.selector',

                function(){
                    last=this;

                    try{
                        scroll.update(this);
                    }
                    catch(e){}
                }
            );
    }


    function startController(){
        Lampa.Controller.add(
            'content',

            {
                link:this,

                toggle:function(){
                    try{
                        scroll.restorePosition();

                        Lampa.Controller.collectionSet(
                            scroll.render(
                                true
                            )
                        );

                        Lampa.Controller.collectionFocus(
                            last||
                            root.find(
                                '.selector'
                            )[0]||
                            false,

                            scroll.render(
                                true
                            )
                        );
                    }
                    catch(e){}
                },

                left:function(){
                    Navigator.canmove(
                        'left'
                    )
                        ?Navigator.move(
                            'left'
                        )
                        :Lampa.Controller.toggle(
                            'menu'
                        );
                },

                right:function(){
                    if(
                        Navigator.canmove(
                            'right'
                        )
                    ){
                        Navigator.move(
                            'right'
                        );
                    }
                },

                up:function(){
                    Navigator.canmove(
                        'up'
                    )
                        ?Navigator.move(
                            'up'
                        )
                        :Lampa.Controller.toggle(
                            'head'
                        );
                },

                down:function(){
                    if(
                        Navigator.canmove(
                            'down'
                        )
                    ){
                        Navigator.move(
                            'down'
                        );
                    }
                },

                back:function(){
                    Lampa.Activity.backward();
                }
            }
        );

        Lampa.Controller.toggle(
            'content'
        );
    }


    function infoRow(
        p,
        k,
        v
    ){
        if(
            v!==''&&
            v!==null&&
            v!==undefined
        ){
            p.append(
                '<div class="ah140-info">'+
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


    function infoPanel(a){
        var p=
            $(
                '<div class="ah140-aside">'+
                    '<div class="ah140-aside-title">'+
                        'Информация'+
                    '</div>'+
                '</div>'
            );

        infoRow(
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
            infoRow(
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
            infoRow(
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

        infoRow(
            p,
            'Тип',
            typeLabel(a)
        );

        infoRow(
            p,
            'Статус',

            statusLabel(
                a.status&&
                a.status.alias
            )
        );

        infoRow(
            p,
            'Эпизоды',
            episodeCount(a)
        );

        if(a.duration){
            infoRow(
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
            infoRow(
                p,
                'Возраст',
                a.age.title
            );
        }

        if(
            a.episodes&&
            a.episodes.nextDate
        ){
            infoRow(
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


    function destroyLine(which){
        if(which){
            try{
                which.destroy();
            }
            catch(e){}
        }
    }


    function rangeItems(eps){
        var max=40;

        if(
            eps.length<=
            max
        ){
            return {
                start:0,
                items:eps
            };
        }

        if(
            rangeStart!=
            null
        ){
            var s=
                Math.max(
                    0,

                    Math.min(
                        intv(
                            rangeStart
                        ),

                        eps.length-
                        max
                    )
                );

            return {
                start:s,

                items:
                    eps.slice(
                        s,
                        s+
                        max
                    )
            };
        }

        var current=
            num(
                watchState(
                    anime
                ).episode
            );

        var idx=
            eps.indexOf(
                current
            );

        var start=
            idx>=0
                ?Math.max(
                    0,

                    Math.min(
                        eps.length-
                        max,

                        idx-
                        8
                    )
                )
                :0;

        return {
            start:start,

            items:
                eps.slice(
                    start,
                    start+
                    max
                )
        };
    }


    function chooseRange(eps){
        var items=[];

        for(
            var s=0;
            s<eps.length;
            s+=40
        ){
            items.push({
                title:
                    'Серии '+
                    (
                        s+
                        1
                    )+
                    '–'+
                    Math.min(
                        eps.length,
                        s+
                        40
                    ),

                start:s
            });
        }

        showSelect(
            'Диапазон серий',
            items,

            function(x){
                rangeStart=
                    x.start;

                renderEpisodes(
                    videos
                );
            }
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

        destroyLine(
            episodeLine
        );

        episodeLine=null;

        episodeBlock
            .empty()
            .append(
                '<div class="ah140-block-title">'+
                    'Эпизоды'+
                '</div>'
            );

        if(!eps.length){
            episodeBlock.append(
                '<div class="ah140-placeholder">'+
                    'Видео пока не найдено.'+
                '</div>'
            );

            bindFocus();
            return;
        }

        if(
            eps.length>
            40
        ){
            var rb=
                $('<div class="ah140-lazy selector">Диапазон серий</div>');

            rb.on(
                'hover:enter click',

                function(e){
                    if(e){
                        e.preventDefault();
                    }

                    chooseRange(eps);
                }
            );

            episodeBlock.append(
                $(
                    '<div class="ah140-placeholder">'+
                        '<span>'+
                            'Всего серий: '+
                            eps.length+
                        '</span>'+
                    '</div>'
                )
                .append(rb)
            );
        }

        var range=
            rangeItems(eps);

        var cards=
            range.items.map(
                function(
                    ep,
                    index
                ){
                    var groups=
                        groupsForEpisode(
                            videos,
                            ep
                        );

                    var poster=
                        shotFor(
                            ep,
                            range.start+
                            index
                        );

                    var fake={
                        id:
                            String(
                                anime.id
                            )+
                            '_ep_'+
                            ep,

                        title:
                            'Серия '+
                            ep,

                        poster:poster,
                        background:poster,
                        posterHero:poster,

                        type:{
                            name:
                                groups.length+
                                ' источн.'
                        }
                    };

                    return nativeCard(
                        fake,

                        {
                            wide:true,

                            enter:
                                function(){
                                    chooseSourceForEpisode(
                                        anime,
                                        videos,
                                        ep,
                                        true
                                    );
                                }
                        }
                    );
                }
            );

        var data={
            title:'',
            results:cards,
            total_pages:1,

            params:{
                items:{
                    mapping:'line',
                    align_left:false,
                    view:6
                }
            }
        };

        episodeLine=
            Lampa.Maker.make(
                'Line',
                data
            );

        episodeLine.create();

        episodeBlock.append(
            episodeLine.render()
        );

        try{
            episodeLine.visible();
        }
        catch(e){}

        bindFocus();

        try{
            Lampa.Controller.collectionSet(
                scroll.render(
                    true
                )
            );
        }
        catch(e){}
    }


    function loadEpisodes(){
        if(videos){
            renderEpisodes(videos);
            return;
        }

        episodeBlock.html(
            '<div class="ah140-block-title">'+
                'Эпизоды'+
            '</div>'+
            '<div class="ah140-placeholder">'+
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
                if(!alive){
                    return;
                }

                episodeBlock.html(
                    '<div class="ah140-block-title">'+
                        'Эпизоды'+
                    '</div>'
                );

                var retry=
                    $('<div class="ah140-lazy selector">Повторить загрузку серий</div>');

                retry.on(
                    'hover:enter click',
                    loadEpisodes
                );

                episodeBlock.append(
                    $(
                        '<div class="ah140-placeholder">'+
                            'Не удалось загрузить серии.'+
                        '</div>'
                    )
                    .append(retry)
                );

                bindFocus();
            },

            false
        );
    }


    function loadRecommendations(){
        if(recommendLine){
            return;
        }

        recommendBlock.html(
            '<div class="ah140-block-title">'+
                'Похожие аниме'+
            '</div>'+
            '<div class="ah140-placeholder">'+
                'Загружаем…'+
            '</div>'
        );

        var req=
            new Lampa.Reguest();

        requestJson(
            req,

            workerUrl(
                'recommendations',

                {
                    id:
                        anime.id
                }
            ),

            20,

            function(d){
                if(!alive){
                    return;
                }

                recommendBlock
                    .empty()
                    .append(
                        '<div class="ah140-block-title">'+
                            'Похожие аниме'+
                        '</div>'
                    );

                var items=
                    d.items||
                    [];

                if(!items.length){
                    recommendBlock.append(
                        '<div class="ah140-placeholder">'+
                            'Похожих аниме не найдено.'+
                        '</div>'
                    );

                    return;
                }

                recommendLine=
                    Lampa.Maker.make(
                        'Line',

                        lineData(
                            '',
                            items,

                            {
                                view:6
                            }
                        )
                    );

                recommendLine.create();

                recommendBlock.append(
                    recommendLine.render()
                );

                try{
                    recommendLine.visible();
                }
                catch(e){}

                bindFocus();

                try{
                    Lampa.Controller.collectionSet(
                        scroll.render(
                            true
                        )
                    );
                }
                catch(e){}

                try{
                    req.clear();
                }
                catch(e){}
            },

            function(){
                recommendBlock.html(
                    '<div class="ah140-block-title">'+
                        'Похожие аниме'+
                    '</div>'+
                    '<div class="ah140-placeholder">'+
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
        anime=a;
        videos=null;

        saveRecent(a);

        root
            .empty()
            .append(
                detailNav()
            );

        var hero=
            $('<div class="ah140-detail"></div>');

        var bg=
            a.background||
            a.posterHero||
            a.poster||
            '';

        if(bg){
            hero.append(
                imageElement(
                    bg,
                    'ah140-bg'
                )
            );
        }

        hero.append(
            '<div class="ah140-shade"></div>'
        );

        var inner=
            $('<div class="ah140-detail-inner"></div>');

        var poster=
            $('<div class="ah140-poster"></div>');

        if(
            a.posterDetail||
            a.poster
        ){
            poster.append(
                imageElement(
                    a.posterDetail||
                    a.poster,
                    ''
                )
            );
        }

        var main=
            $('<div class="ah140-detail-main"></div>');

        main.append(
            '<div class="ah140-kicker">'+
                'AnimeHub • YummyAnime'+
            '</div>'+
            '<div class="ah140-detail-title">'+
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
                '<div class="ah140-original">'+
                    esc(
                        a.original
                    )+
                '</div>'
            );
        }

        var meta=
            $('<div class="ah140-meta"></div>');

        if(
            num(
                a.score
            )>
            0
        ){
            meta.append(
                '<span class="ah140-chip ah140-score">'+
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
                '<span class="ah140-chip">'+
                    esc(
                        a.year
                    )+
                '</span>'
            );
        }

        meta.append(
            '<span class="ah140-chip">'+
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
                '<span class="ah140-chip">'+
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
                '<span class="ah140-chip">'+
                    esc(
                        a.age.title
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
                '<div class="ah140-studio">'+
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
            $('<div class="ah140-meta"></div>');

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
                    '<span class="ah140-chip">'+
                        esc(
                            g.title
                        )+
                    '</span>'
                );
            }
        );

        main.append(genres);

        var text=
            desc(
                a.description||
                ''
            );

        main.append(
            '<div class="ah140-desc">'+
                esc(
                    text
                        ?clip(
                            text,
                            500
                        )
                        :'Описание пока отсутствует.'
                )+
            '</div>'
        );

        var acts=
            $('<div class="ah140-actions"></div>');

        var watchBtn=
            $('<div class="ah140-btn primary selector"></div>');

        var sourceBtn=
            $('<div class="ah140-btn selector"></div>');

        var fav=
            $('<div class="ah140-btn selector"></div>');

        function refresh(){
            var st=
                watchState(
                    anime
                );

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
                    :(
                        ep&&
                        st.completed
                            ?'▶ Смотреть дальше'
                            :'▶ Смотреть'
                    )
            );

            sourceBtn.text(
                ep
                    ?(
                        '🎧 Озвучка / источник • серия '+
                        ep
                    )
                    :'🎧 Озвучка / источник'
            );

            fav.text(
                isFavorite(
                    anime
                )
                    ?'★ В избранном'
                    :'☆ В избранное'
            );
        }

        refresh();

        watchBtn.on(
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

        sourceBtn.on(
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

                refresh();
            }
        );

        acts.append(
            watchBtn,
            sourceBtn,
            fav
        );

        main.append(acts);

        inner.append(
            poster,
            main,
            infoPanel(a)
        );

        hero.append(inner);
        root.append(hero);

        episodeBlock=
            $('<div class="ah140-block"></div>');

        var load=
            $('<div class="ah140-lazy selector">Загрузить серии</div>');

        load.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                loadEpisodes();
            }
        );

        episodeBlock.append(
            '<div class="ah140-block-title">'+
                'Эпизоды'+
            '</div>',

            $(
                '<div class="ah140-placeholder">'+
                    '<span>'+
                        'Не загружаем видео автоматически — быстрее для TV.'+
                    '</span>'+
                '</div>'
            )
            .append(load)
        );

        root.append(
            episodeBlock
        );

        if(
            a.screenshots&&
            a.screenshots.length
        ){
            var shots=
                $(
                    '<div class="ah140-block">'+
                        '<div class="ah140-block-title">'+
                            'Кадры'+
                        '</div>'+
                    '</div>'
                );

            var row=
                $('<div class="ah140-shots"></div>');

            a.screenshots
                .slice(
                    0,
                    4
                )
                .forEach(
                    function(s){
                        var box=
                            $('<div class="ah140-shot"></div>');

                        if(
                            s.small||
                            s.full
                        ){
                            box.append(
                                imageElement(
                                    s.small||
                                    s.full,
                                    ''
                                )
                            );
                        }

                        row.append(box);
                    }
                );

            shots.append(row);
            root.append(shots);
        }

        if(
            text.length>
            500
        ){
            root.append(
                '<div class="ah140-block">'+
                    '<div class="ah140-block-title">'+
                        'Описание'+
                    '</div>'+
                    '<div class="ah140-longdesc">'+
                        esc(text)+
                    '</div>'+
                '</div>'
            );
        }

        recommendBlock=
            $('<div class="ah140-block"></div>');

        var rec=
            $('<div class="ah140-lazy selector">Показать похожие</div>');

        rec.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                loadRecommendations();
            }
        );

        recommendBlock.append(
            '<div class="ah140-block-title">'+
                'Похожие аниме'+
            '</div>',

            $(
                '<div class="ah140-placeholder">'+
                    '<span>'+
                        'Загружаются только по запросу.'+
                    '</span>'+
                '</div>'
            )
            .append(rec)
        );

        root.append(
            recommendBlock
        );

        bindFocus();

        last=
            watchBtn[0]||
            root.find(
                '.selector'
            )[0]||
            null;

        try{
            Lampa.Controller.collectionSet(
                scroll.render(
                    true
                )
            );
        }
        catch(e){}
    }


    this.create=function(){
        alive=true;

        scroll.minus();

        scroll.append(root);

        root.html(
            loaderHtml(
                'Загрузка карточки…'
            )
        );

        requestJson(
            net,

            workerUrl(
                'anime',

                {
                    id:
                        initial.id
                }
            ),

            8,

            function(d){
                if(alive){
                    render(
                        d.anime
                    );
                }
            },

            function(){
                root.html(
                    '<div class="ah140-placeholder">'+
                        'Не удалось загрузить карточку.'+
                    '</div>'
                );
            }
        );

        return scroll.render();
    };


    this.start=function(){
        if(
            Lampa.Activity.active().activity===
            this.activity
        ){
            startController.call(
                this
            );
        }
    };


    this.pause=function(){};
    this.stop=function(){};


    this.render=function(){
        return scroll.render();
    };


    this.destroy=function(){
        alive=false;

        try{
            net.clear();
        }
        catch(e){}

        destroyLine(
            episodeLine
        );

        destroyLine(
            recommendLine
        );

        try{
            scroll.destroy();
        }
        catch(e){}

        root.remove();
    };
}


/* ============================================================
 * MENU / BOOT
 * ============================================================ */

function addMenuButton(){
    if(
        window[
            NS+
            '_menu'
        ]
    ){
        return;
    }

    window[
        NS+
        '_menu'
    ]=
        true;

    if(
        Lampa.Menu&&
        typeof Lampa.Menu.addButton===
        'function'
    ){
        try{
            Lampa.Menu.addButton(
                toriiSvg(''),
                'AnimeHub',
                openHome
            );

            return;
        }
        catch(e){}
    }

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
    ]=
        true;

    if(!nativeReady()){
        notify(
            'AnimeHub V'+
            VERSION+
            ' требует Lampa 3.0+'
        );

        return;
    }

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

        Lampa.Component.add(
            GENRES,
            GenresComponent
        );

        Lampa.Component.add(
            COLLECTIONS,
            CollectionsComponent
        );

        Lampa.Component.add(
            COLLECTION,
            CollectionComponent
        );

        addMenuButton();

        notify(
            'AnimeHub V'+
            VERSION+
            ' Genre Fix загружен'
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
                e.type===
                'ready'
            ){
                init();
            }
        }
    );
}

})();
