(function(){
'use strict';

/*
 * AnimeHub V1.3.0 Native
 * YummyAnime catalogue + working AnimeHub resolver/player.
 *
 * Performance architecture:
 * - Lampa 3.x Maker Main -> native Line -> native Card on Home
 * - Lampa 3.x Maker Category for catalogue/favourites/schedule
 * - native Lampa request cache (IndexedDB) for catalogue metadata
 * - custom HTML kept only for the branded hero/detail UI
 * - videos/recommendations remain lazy
 * - standalone native Line used for episodes and recommendations
 */

var VERSION='1.3.0';
var NS='animehub_v130';

var HOME=NS+'_home';
var CATALOG=NS+'_catalog';
var DETAIL=NS+'_detail';
var SCHEDULE=NS+'_schedule';
var FAVORITES=NS+'_favorites';

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

/* ============================================================
 * BASICS
 * ============================================================ */

function notify(text){
    try{ Lampa.Noty.show(text); }
    catch(e){}
}

function clean(v){
    return String(v==null?'':v)
        .replace(/\u00a0/g,' ')
        .replace(/\s+/g,' ')
        .trim();
}

function cleanDescription(v){
    return clean(String(v==null?'':v)
        .replace(/<br\s*\/?\s*>/gi,' ')
        .replace(/<[^>]*>/g,' ')
        .replace(/&nbsp;|&#160;/gi,' ')
        .replace(/&amp;/gi,'&')
        .replace(/&quot;/gi,'"')
        .replace(/&#39;|&apos;/gi,"'")
        .replace(/&lt;/gi,'<')
        .replace(/&gt;/gi,'>'));
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
    if(!n||v.length<=n) return v;

    return v
        .slice(0,n)
        .replace(/\s+\S*$/,'')+
        '…';
}

function num(v,d){
    v=parseFloat(v);
    return isNaN(v)?(d||0):v;
}

function intv(v,d){
    v=parseInt(v,10);
    return isNaN(v)?(d||0):v;
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
        return String(
            count
        );
    }

    if(aired){
        return String(
            aired
        );
    }

    return '—';
}

function formatDate(
    ts,
    withTime
){
    ts=num(
        ts,
        0
    );

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

function requestJson(
    net,
    url,
    cacheMinutes,
    ok,
    fail
){
    var options={
        dataType:'text'
    };

    if(
        cacheMinutes>
        0
    ){
        options.cache={
            life:
                cacheMinutes
        };
    }

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

                        data:
                            data
                    });
                }

                return;
            }

            if(ok){
                ok(
                    data
                );
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
            Lampa.Manifest.app_digital,
            0
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
 * TORII / CSS
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
            '<linearGradient id="ah130g" x1="0" y1="0" x2="1" y2="1">'+
                '<stop offset="0" stop-color="#a970ff"/>'+
                '<stop offset="1" stop-color="#ed5fd4"/>'+
            '</linearGradient>'+
        '</defs>'+

        '<path fill="url(#ah130g)" d="'+
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

function injectStyle(){
    if(
        $('#animehub-v130-style')
            .length
    ){
        return;
    }

    $('head').append(`
<style id="animehub-v130-style">

.ah130-hero-line{
    padding:0 0 1.2em;
    box-sizing:border-box
}

.ah130-top{
    height:3.7em;
    display:flex;
    align-items:center;
    gap:.8em;
    padding:0 .35em;
    box-sizing:border-box
}

.ah130-brand{
    display:flex;
    align-items:center;
    gap:.42em;
    font-size:1.35em;
    font-weight:900;
    padding-right:.9em;
    border-right:1px solid rgba(255,255,255,.13)
}

.ah130-logo{
    width:1.8em;
    height:1.8em
}

.ah130-name{
    background:linear-gradient(90deg,#fff,#dc8cff);
    -webkit-background-clip:text;
    color:transparent
}

.ah130-nav{
    display:flex;
    gap:.15em
}

.ah130-navbtn{
    padding:.52em .66em;
    border-radius:.52em;
    white-space:nowrap
}

.ah130-navbtn.focus{
    background:#8754e9;
    color:#fff
}

.ah130-hero{
    height:24em;
    position:relative;
    overflow:hidden;
    border-radius:.85em;
    isolation:isolate;
    background:#111629
}

.ah130-bg{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    z-index:-5
}

.ah130-shade{
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

.ah130-hero-copy{
    position:absolute;
    left:3.1%;
    top:7%;
    bottom:7%;
    width:55%;
    display:flex;
    flex-direction:column;
    justify-content:center
}

.ah130-kicker{
    color:#df8cff;
    font-size:.7em;
    font-weight:800;
    letter-spacing:.09em;
    text-transform:uppercase;
    margin-bottom:.45em
}

.ah130-title{
    font-size:2.7em;
    font-weight:900;
    line-height:1.02;
    text-shadow:0 2px 6px #000
}

.ah130-original{
    color:#b9b5c6;
    margin:.2em 0 .5em
}

.ah130-meta{
    display:flex;
    flex-wrap:wrap;
    gap:.35em;
    margin:.32em 0
}

.ah130-chip{
    font-size:.74em;
    padding:.24em .49em;
    border-radius:999px;
    background:rgba(255,255,255,.09);
    border:1px solid rgba(255,255,255,.11)
}

.ah130-score{
    color:#ffd76a
}

.ah130-desc{
    font-size:.92em;
    line-height:1.46;
    color:#f5f3fa;
    max-width:46em;
    margin:.5em 0 .8em;
    text-shadow:0 2px 4px #000
}

.ah130-actions{
    display:flex;
    gap:.5em;
    flex-wrap:wrap
}

.ah130-btn,
.ah130-lazy{
    padding:.62em .84em;
    border-radius:.53em;
    background:rgba(255,255,255,.10);
    border:1px solid rgba(255,255,255,.12);
    font-weight:750
}

.ah130-btn.primary{
    background:linear-gradient(
        135deg,
        #965cf8,
        #7444e9 65%,
        #d84fd6
    )
}

.ah130-btn.focus,
.ah130-lazy.focus{
    background:#fff;
    color:#090b14
}

.ah130-detail-wrap{
    padding:0 1.65em 4em;
    color:#faf8ff;
    box-sizing:border-box
}

.ah130-detail-top{
    height:3.7em;
    display:flex;
    align-items:center;
    gap:.8em
}

.ah130-detail{
    position:relative;
    min-height:27em;
    border-radius:.85em;
    overflow:hidden;
    isolation:isolate;
    background:#0d1120;
    margin-bottom:1em
}

.ah130-detail-inner{
    display:flex;
    gap:.9em;
    padding:1.15em;
    align-items:center;
    min-height:26em;
    box-sizing:border-box
}

.ah130-poster{
    width:10.8em;
    min-width:10.8em;
    height:16em;
    border-radius:.62em;
    overflow:hidden;
    background:#15192b;
    border:1px solid rgba(255,255,255,.13)
}

.ah130-poster img,
.ah130-shot img{
    width:100%;
    height:100%;
    object-fit:cover
}

.ah130-detail-main{
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

.ah130-detail-title{
    font-size:2.15em;
    font-weight:900;
    line-height:1.05;
    text-shadow:0 2px 6px #000
}

.ah130-studio{
    font-size:.75em;
    color:#cbc7d5;
    margin:.12em 0
}

.ah130-aside{
    width:14.5em;
    min-width:14.5em;
    background:rgba(9,12,25,.84);
    border:1px solid rgba(255,255,255,.09);
    border-radius:.65em;
    padding:.68em
}

.ah130-aside-title{
    font-weight:850;
    margin-bottom:.16em
}

.ah130-info{
    display:flex;
    justify-content:space-between;
    gap:.45em;
    font-size:.72em;
    padding:.42em 0;
    border-bottom:1px solid rgba(255,255,255,.06)
}

.ah130-info span:first-child{
    color:#aaa7b8
}

.ah130-info span:last-child{
    text-align:right;
    font-weight:700;
    max-width:62%
}

.ah130-block{
    margin:1em 0
}

.ah130-block-title{
    font-size:1.18em;
    font-weight:850;
    margin:0 0 .46em
}

.ah130-placeholder{
    padding:.75em;
    border-radius:.62em;
    background:#101426;
    color:#bbb7c8;
    display:flex;
    gap:.55em;
    align-items:center;
    flex-wrap:wrap
}

.ah130-shots{
    display:flex;
    gap:.62em;
    overflow-x:auto;
    padding:.1em 0 .45em
}

.ah130-shots::-webkit-scrollbar{
    width:0;
    height:0
}

.ah130-shot{
    flex:0 0 14.5em;
    height:8.1em;
    border-radius:.56em;
    overflow:hidden;
    background:#14182a
}

.ah130-longdesc{
    background:#101426;
    border:1px solid rgba(255,255,255,.06);
    border-radius:.62em;
    padding:.8em;
    line-height:1.48;
    color:#d5d2de;
    margin-bottom:.95em
}

.ah130-loader{
    min-height:20em;
    display:flex;
    position:relative;
    flex-direction:column;
    justify-content:center;
    align-items:center;
    gap:.65em;
    color:#bbb7c8
}

.ah130-loader-logo{
    width:4.2em;
    height:4.2em
}

.ah130-loader-ring{
    position:absolute;
    width:5.4em;
    height:5.4em;
    border:2px solid rgba(180,110,255,.12);
    border-top-color:#cc76ff;
    border-radius:50%;
    animation:ah130-spin 1s linear infinite
}

@keyframes ah130-spin{
    to{
        transform:rotate(360deg)
    }
}

@media(max-width:1250px){
    .ah130-aside{
        display:none
    }

    .ah130-detail-title{
        font-size:1.95em
    }

    .ah130-hero-copy{
        width:62%
    }
}

</style>
    `);
}

function loaderHtml(text){
    return (
        '<div class="ah130-loader">'+
            '<div class="ah130-loader-ring"></div>'+
            toriiSvg(
                'ah130-loader-logo'
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

function imageElement(
    url,
    cls
){
    if(!url){
        return '';
    }

    return (
        '<img class="'+
        esc(
            cls||
            ''
        )+
        '" src="'+
        esc(
            url
        )+
        '" decoding="async" alt="">'
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

function setStored(
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

function sameAnime(
    a,
    b
){
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
            String(
                a.id
            )===
            String(
                b.id
            )
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
        clean(
            a.title
        )===
        clean(
            b.title
        )
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
                out.push(
                    x
                );
            }
        }
    );

    if(!found){
        out.unshift(
            compactAnime(
                a
            )
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
        compactAnime(
            a
        )
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
                out.push(
                    x
                );
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
            watchKey(
                a
            )
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
        watchKey(
            a
        );

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
        compactAnime(
            a
        );

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

    return Object.keys(
        store
    )
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
        12
    );
}

/* ============================================================
 * ROUTES / SELECTIONS
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
                onSelect(
                    item
                );
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

    requestJson(
        net,
        workerUrl(
            'genres'
        ),
        1440,

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

function catalogMenu(){
    showSelect(
        'AnimeHub',

        [
            {
                title:'Все аниме',
                mode:'all'
            },
            {
                title:'Онгоинги',
                mode:'ongoing'
            },
            {
                title:'Популярные',
                mode:'popular'
            },
            {
                title:'Топ-100',
                mode:'top'
            },
            {
                title:'Новинки',
                mode:'latest'
            },
            {
                title:'Анонсы',
                mode:'announcements'
            },
            {
                title:'Жанры',
                action:'genres'
            },
            {
                title:'Годы',
                action:'years'
            },
            {
                title:'Тип',
                action:'types'
            },
            {
                title:'Поиск',
                action:'search'
            },
            {
                title:'Расписание',
                action:'schedule'
            },
            {
                title:'Избранное',
                action:'favorites'
            }
        ],

        function(x){
            if(x.mode){
                openCatalog(
                    x.mode,
                    '',
                    x.title,
                    1
                );
            }
            else if(
                x.action===
                'genres'
            ){
                chooseGenre();
            }
            else if(
                x.action===
                'years'
            ){
                chooseYear();
            }
            else if(
                x.action===
                'types'
            ){
                chooseType();
            }
            else if(
                x.action===
                'search'
            ){
                openSearch();
            }
            else if(
                x.action===
                'schedule'
            ){
                openSchedule();
            }
            else if(
                x.action===
                'favorites'
            ){
                openFavorites();
            }
        }
    );
}

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
                compactAnime(
                    a
                )
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

            2,

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
 * NATIVE CARD DATA
 * ============================================================ */

function nativeCard(
    a,
    options
){
    options=
        options||
        {};

    var state=
        options.state||
        null;

    var wide=
        !!options.wide;

    var title=
        a.title||
        'Anime';

    if(
        state&&
        state.episode
    ){
        title+=
            ' • серия '+
            state.episode;
    }

    var card={
        id:
            'animehub_'+
            String(
                a.id||
                ''
            ),

        title:
            title,

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
                a.score,
                0
            ),

        poster:
            a.poster||
            '',

        source:
            'animehub',

        ahAnime:
            a,

        params:{
            style:{
                name:
                    wide
                        ?'wide'
                        :'default'
            },

            on:{
                'hover:enter':
                    function(){
                        if(options.enter){
                            options.enter(
                                a,
                                state
                            );
                        }
                        else{
                            openDetail(
                                a
                            );
                        }
                    }
            }
        }
    };

    var mask=
        cardMask();

    if(
        mask!==
        undefined
    ){
        card.params.module=
            mask;
    }

    if(wide){
        card.cover=
            a.background||
            a.posterHero||
            a.poster||
            '';

        card.overview=
            state&&
            state.episode
                ?(
                    'Продолжить • серия '+
                    state.episode
                )
                :(
                    [
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
                            :''
                    ]
                    .filter(Boolean)
                    .join(
                        ' • '
                    )
                );
    }

    return card;
}

function lineData(
    title,
    items,
    options
){
    options=
        options||
        {};

    var results=
        (
            items||
            []
        )
        .map(
            function(a){
                var st=
                    options.stateMap&&
                    options.stateMap[
                        String(
                            a.id
                        )
                    ];

                return nativeCard(
                    a,

                    {
                        wide:
                            !!options.wide,

                        state:
                            st,

                        enter:
                            options.enter
                    }
                );
            }
        );

    return {
        title:
            title,

        results:
            results,

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
                            function(){
                                options.more();
                            }
                    }
                    :{}
        }
    };
}

function filterCard(){
    var svg=
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450">'+
            '<defs>'+
                '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'+
                    '<stop stop-color="#7d49e9"/>'+
                    '<stop offset="1" stop-color="#e65ed1"/>'+
                '</linearGradient>'+
            '</defs>'+
            '<rect width="300" height="450" rx="28" fill="#111527"/>'+
            '<rect x="36" y="64" width="228" height="322" rx="26" fill="url(#g)" opacity=".24"/>'+
            '<path d="M64 110h172M82 170h136M101 230h98M120 290h60" stroke="#fff" stroke-width="18" stroke-linecap="round"/>'+
            '<circle cx="110" cy="110" r="20" fill="#fff"/>'+
            '<circle cx="176" cy="170" r="20" fill="#fff"/>'+
            '<circle cx="139" cy="230" r="20" fill="#fff"/>'+
            '<circle cx="158" cy="290" r="20" fill="#fff"/>'+
        '</svg>';

    var card={
        id:
            'animehub_filter',

        title:
            'Фильтры / поиск',

        poster:
            'data:image/svg+xml;charset=utf-8,'+
            encodeURIComponent(
                svg
            ),

        source:
            'animehub',

        params:{
            style:{
                name:'default'
            },

            on:{
                'hover:enter':
                    catalogMenu
            }
        }
    };

    var mask=
        cardMask();

    if(
        mask!==
        undefined
    ){
        card.params.module=
            mask;
    }

    return card;
}

/* ============================================================
 * MINI EMITTER + CUSTOM HERO LINE
 * ============================================================ */

function MiniEmit(){
    this.components=[];
}

MiniEmit.prototype.use=
function(module){
    if(
        module&&
        this.components.indexOf(
            module
        )<
        0
    ){
        this.components.push(
            module
        );
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

function HeroLine(data){
    MiniEmit.call(
        this
    );

    this.data=
        data;

    this.html=
        $('<div class="ah130-hero-line"></div>');

    this.last=
        null;
}

HeroLine.prototype=
    Object.create(
        MiniEmit.prototype
    );

HeroLine.prototype.constructor=
    HeroLine;

HeroLine.prototype.create=
function(){
    var self=
        this;

    var a=
        this.data.hero||
        {};

    var top=
        $('<div class="ah130-top"></div>');

    var brand=
        $('<div class="ah130-brand"></div>')
        .append(
            toriiSvg(
                'ah130-logo'
            ),

            '<span class="ah130-name">'+
                'AnimeHub'+
            '</span>'
        );

    var nav=
        $('<div class="ah130-nav"></div>');

    function navButton(
        title,
        action
    ){
        var b=
            $('<div class="ah130-navbtn selector"></div>')
            .text(
                title
            );

        b.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                action();
            }
        );

        nav.append(
            b
        );
    }

    navButton(
        'Главная',
        function(){}
    );

    navButton(
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

    navButton(
        'Поиск',
        openSearch
    );

    navButton(
        'Расписание',
        openSchedule
    );

    navButton(
        'Избранное',
        openFavorites
    );

    top.append(
        brand,
        nav
    );

    var hero=
        $('<div class="ah130-hero"></div>');

    var bg=
        a.background||
        a.posterHero||
        a.poster||
        '';

    if(bg){
        hero.append(
            imageElement(
                bg,
                'ah130-bg'
            )
        );
    }

    hero.append(
        '<div class="ah130-shade"></div>'
    );

    var copy=
        $('<div class="ah130-hero-copy"></div>');

    copy.append(
        '<div class="ah130-kicker">'+
            'AnimeHub • YummyAnime'+
        '</div>'+
        '<div class="ah130-title">'+
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
            '<div class="ah130-original">'+
                esc(
                    a.original
                )+
            '</div>'
        );
    }

    var meta=
        $('<div class="ah130-meta"></div>');

    if(
        num(
            a.score,
            0
        )>0
    ){
        meta.append(
            '<span class="ah130-chip ah130-score">'+
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
            '<span class="ah130-chip">'+
                esc(
                    a.year
                )+
            '</span>'
        );
    }

    meta.append(
        '<span class="ah130-chip">'+
            esc(
                typeLabel(
                    a
                )
            )+
        '</span>'
    );

    if(
        a.status&&
        a.status.alias
    ){
        meta.append(
            '<span class="ah130-chip">'+
                esc(
                    statusLabel(
                        a.status.alias
                    )
                )+
            '</span>'
        );
    }

    copy.append(
        meta
    );

    copy.append(
        '<div class="ah130-desc">'+
            esc(
                clip(
                    cleanDescription(
                        a.description
                    ),
                    285
                )||
                'Откройте карточку для подробностей.'
            )+
        '</div>'
    );

    var actions=
        $('<div class="ah130-actions"></div>');

    var watch=
        $('<div class="ah130-btn primary selector">▶ Смотреть</div>');

    var details=
        $('<div class="ah130-btn selector">ⓘ Подробнее</div>');

    var fav=
        $('<div class="ah130-btn selector"></div>');

    function refreshFav(){
        fav.text(
            isFavorite(a)
                ?'★ В избранном'
                :'☆ В избранное'
        );
    }

    refreshFav();

    watch.on(
        'hover:enter click',

        function(e){
            if(e){
                e.preventDefault();
            }

            watchAnime(
                a
            );
        }
    );

    details.on(
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

            refreshFav();
        }
    );

    actions.append(
        watch,
        details,
        fav
    );

    copy.append(
        actions
    );

    hero.append(
        copy
    );

    this.html.append(
        top,
        hero
    );

    this.html
        .find(
            '.selector'
        )
        .on(
            'hover:focus',

            function(){
                self.last=
                    this;
            }
        );
};

HeroLine.prototype.toggle=
function(){
    var self=
        this;

    this.emit(
        'active'
    );

    var controller={
        link:
            this,

        toggle:
            function(){
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

        left:
            function(){
                if(
                    Navigator.canmove(
                        'left'
                    )
                ){
                    Navigator.move(
                        'left'
                    );
                }
                else{
                    self.emit(
                        'left'
                    );
                }
            },

        right:
            function(){
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

        up:
            function(){
                if(
                    Navigator.canmove(
                        'up'
                    )
                ){
                    Navigator.move(
                        'up'
                    );
                }
                else{
                    self.emit(
                        'up'
                    );
                }
            },

        down:
            function(){
                if(
                    Navigator.canmove(
                        'down'
                    )
                ){
                    Navigator.move(
                        'down'
                    );
                }
                else{
                    self.emit(
                        'down'
                    );
                }
            },

        back:
            function(){
                self.emit(
                    'back'
                );
            }
    };

    Lampa.Controller.add(
        'animehub_hero',
        controller
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
 * HOME - NATIVE MAIN / LINE / CARD
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
            var self=
                this;

            requestJson(
                net,
                workerUrl(
                    'home'
                ),
                2,

                function(data){
                    var lines=[];

                    if(data.hero){
                        lines.push(
                            heroLineData(
                                data.hero
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
                                            openDetail(
                                                a
                                            );
                                        }
                                }
                            )
                        );
                    }

                    if(
                        data.ongoing&&
                        data.ongoing.length
                    ){
                        lines.push(
                            lineData(
                                'Сейчас выходит',
                                data.ongoing,

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
                        data.latest&&
                        data.latest.length
                    ){
                        lines.push(
                            lineData(
                                'Новинки',
                                data.latest,

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
                        data.top&&
                        data.top.length
                    ){
                        lines.push(
                            lineData(
                                'Лучшее',
                                data.top,

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
 * CATALOGUE - NATIVE CATEGORY
 * ============================================================ */

function catalogResults(
    data,
    includeFilter
){
    var out=[];

    if(includeFilter){
        out.push(
            filterCard()
        );
    }

    (
        data.items||
        []
    )
    .forEach(
        function(a){
            out.push(
                nativeCard(
                    a
                )
            );
        }
    );

    return out;
}

function CatalogComponent(object){
    object.page=
        intv(
            object.ah_page||
            object.page,
            1
        );

    object.params=
        object.params||
        {};

    object.params.items={
        mapping:'grid',
        cols:5,
        limit_view:5,
        limit_collection:30
    };

    var net=
        new Lampa.Reguest();

    var comp=
        Lampa.Maker.make(
            'Category',
            object
        );

    var mode=
        object.ah_mode||
        'all';

    var value=
        object.ah_value||
        '';

    function loadPage(
        page,
        done,
        fail
    ){
        requestJson(
            net,

            workerUrl(
                'catalog',

                {
                    mode:mode,
                    value:value,
                    page:page,
                    limit:10
                }
            ),

            3,

            function(data){
                if(
                    !data.hasNext
                ){
                    comp.total_pages=
                        page;
                }

                done({
                    results:
                        catalogResults(
                            data,
                            page===
                            1
                        ),

                    page:
                        page,

                    total_pages:
                        data.hasNext
                            ?9999
                            :page,

                    total_results:
                        data.hasNext
                            ?999999
                            :(
                                (
                                    page-
                                    1
                                )*
                                10+
                                (
                                    data.items||
                                    []
                                ).length
                            )
                });
            },

            fail
        );
    }

    comp.use({
        onCreate:function(){
            var self=
                this;

            loadPage(
                self.object.page,

                function(data){
                    self.build(
                        data
                    );
                },

                function(){
                    self.empty(
                        true
                    );

                    notify(
                        'Не удалось загрузить каталог'
                    );
                }
            );
        },

        onNext:function(
            done,
            fail
        ){
            loadPage(
                this.object.page,
                done,
                fail
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
 * FAVORITES / SCHEDULE - NATIVE CATEGORY
 * ============================================================ */

function FavoritesComponent(object){
    object.page=
        1;

    object.params=
        object.params||
        {};

    object.params.items={
        mapping:'grid',
        cols:5,
        limit_view:5,
        limit_collection:30
    };

    var comp=
        Lampa.Maker.make(
            'Category',
            object
        );

    comp.use({
        onCreate:function(){
            var list=
                storedList(
                    FAVORITES_KEY
                );

            var results=[
                filterCard()
            ];

            list
                .slice(
                    0,
                    50
                )
                .forEach(
                    function(a){
                        results.push(
                            nativeCard(
                                a
                            )
                        );
                    }
                );

            this.build({
                results:
                    results,

                page:1,
                total_pages:1,

                total_results:
                    list.length
            });
        }
    });

    return comp;
}

function ScheduleComponent(object){
    object.page=
        1;

    object.params=
        object.params||
        {};

    object.params.items={
        mapping:'grid',
        cols:5,
        limit_view:5,
        limit_collection:30
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

            requestJson(
                net,
                workerUrl(
                    'schedule'
                ),
                10,

                function(data){
                    var results=[
                        filterCard()
                    ];

                    (
                        data.items||
                        []
                    )
                    .forEach(
                        function(a){
                            results.push(
                                nativeCard(
                                    a
                                )
                            );
                        }
                    );

                    self.build({
                        results:
                            results,

                        page:1,
                        total_pages:1,

                        total_results:
                            results.length
                    });
                },

                function(){
                    self.empty(
                        true
                    );

                    notify(
                        'Не удалось загрузить расписание'
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
        clean(
            url
        );

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
            .test(
                url
            )
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
        videoData(
            video
        );

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
        return new URL(
            url
        )
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
        String(
            raw
        )
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
        :String(
            raw
        );
}

function sourceKind(
    url,
    video
){
    var d=
        videoData(
            video
        );

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
            .test(
                url
            )
    ){
        return 'direct';
    }

    if(
        /iframecvh|cdnvideohub|(?:^|\s)cvh(?:\s|$)/i
            .test(
                value
            )
    ){
        return 'cvh';
    }

    if(
        /iframevk|vkvideo|vk\.com|video_ext\.php|(?:^|\s)vk(?:\s|$)/i
            .test(
                value
            )
    ){
        return 'vk';
    }

    if(
        /kodik/i
            .test(
                value
            )
    ){
        return 'kodik';
    }

    if(
        /aksor/i
            .test(
                value
            )
    ){
        return 'aksor';
    }

    if(
        /rutube/i
            .test(
                value
            )
    ){
        return 'rutube';
    }

    return 'unsupported';
}

function voiceName(video){
    var d=
        videoData(
            video
        );

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

function groupPart(v){
    return clean(
        v
    )
    .toLowerCase();
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

            if(
                !groups[key]
            ){
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

    var priority={
        direct:6,
        cvh:5,
        vk:4,
        kodik:3,
        aksor:2,
        rutube:1,
        unsupported:0
    };

    return Object.keys(
        groups
    )
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
                String(
                    ep
                );

            if(
                !seen[key]
            ){
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
                String(
                    ep
                )||
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

function cacheVideos(
    id,
    videos
){
    id=
        String(
            id
        );

    if(
        videoCache[id]
    ){
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

    if(
        videoInflight[id]
    ){
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

        0,

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
 * PLAYBACK
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

    if(
        !eps.length
    ){
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
        eps.indexOf(
            ep
        )<
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
        );

    if(
        !groups.length
    ){
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

    if(
        state.providerKey
    ){
        groups.some(
            function(g){
                if(
                    g.key===
                    state.providerKey
                ){
                    preferred=
                        g;

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

        if(
            !eps.length
        ){
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
            )>
            0;

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

        0,

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

    window[key]=
        true;

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
                if(active){
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
 * DETAIL - CUSTOM HERO + LAMPA SCROLL + NATIVE LINES
 * ============================================================ */

function detailNav(){
    var top=
        $('<div class="ah130-detail-top"></div>');

    var brand=
        $('<div class="ah130-brand"></div>')
        .append(
            toriiSvg(
                'ah130-logo'
            ),

            '<span class="ah130-name">'+
                'AnimeHub'+
            '</span>'
        );

    var nav=
        $('<div class="ah130-nav"></div>');

    function add(
        title,
        action
    ){
        var b=
            $('<div class="ah130-navbtn selector"></div>')
            .text(
                title
            );

        b.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                action();
            }
        );

        nav.append(
            b
        );
    }

    add(
        'Главная',
        openHome
    );

    add(
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
        'Поиск',
        openSearch
    );

    add(
        'Расписание',
        openSchedule
    );

    add(
        'Избранное',
        openFavorites
    );

    top.append(
        brand,
        nav
    );

    return top;
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
        $('<div class="ah130-detail-wrap"></div>');

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

    var selectedRangeStart=null;

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
                    last=
                        this;

                    try{
                        scroll.update(
                            this
                        );
                    }
                    catch(e){}
                }
            );
    }

    function startController(){
        Lampa.Controller.add(
            'content',

            {
                link:
                    this,

                toggle:
                    function(){
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

                left:
                    function(){
                        if(
                            Navigator.canmove(
                                'left'
                            )
                        ){
                            Navigator.move(
                                'left'
                            );
                        }
                        else{
                            Lampa.Controller.toggle(
                                'menu'
                            );
                        }
                    },

                right:
                    function(){
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

                up:
                    function(){
                        if(
                            Navigator.canmove(
                                'up'
                            )
                        ){
                            Navigator.move(
                                'up'
                            );
                        }
                        else{
                            Lampa.Controller.toggle(
                                'head'
                            );
                        }
                    },

                down:
                    function(){
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

                back:
                    function(){
                        Lampa.Activity.backward();
                    }
            }
        );

        Lampa.Controller.toggle(
            'content'
        );
    }

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
            '<div class="ah130-info">'+
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
        var p=
            $(
                '<div class="ah130-aside">'+
                    '<div class="ah130-aside-title">'+
                        'Информация'+
                    '</div>'+
                '</div>'
            );

        infoRow(
            p,
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
                p,
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
                p,
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
            p,
            'Тип',
            typeLabel(
                a
            )
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
            episodeCount(
                a
            )
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

    function refreshMainButtons(
        watchBtn,
        sourceBtn
    ){
        var state=
            watchState(
                anime
            );

        var ep=
            num(
                state.episode,
                0
            );

        watchBtn.text(
            ep&&
            !state.completed
                ?(
                    '▶ Продолжить • серия '+
                    ep
                )
                :(
                    ep&&
                    state.completed
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
    }

    function screenshotFor(
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
                    exact=
                        x;

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

    function destroyEpisodeLine(){
        if(episodeLine){
            try{
                episodeLine.destroy();
            }
            catch(e){}

            episodeLine=
                null;
        }
    }

    function destroyRecommendLine(){
        if(recommendLine){
            try{
                recommendLine.destroy();
            }
            catch(e){}

            recommendLine=
                null;
        }
    }

    function episodeRangeItems(eps){
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
            selectedRangeStart!=
            null
        ){
            var s=
                Math.max(
                    0,

                    Math.min(
                        intv(
                            selectedRangeStart,
                            0
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
                ).episode,
                0
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
            start:
                start,

            items:
                eps.slice(
                    start,
                    start+
                    max
                )
        };
    }

    function chooseRange(eps){
        var size=40;
        var items=[];

        for(
            var s=0;
            s<eps.length;
            s+=size
        ){
            var end=
                Math.min(
                    eps.length,
                    s+
                    size
                );

            items.push({
                title:
                    'Серии '+
                    (
                        s+
                        1
                    )+
                    '–'+
                    end,

                start:
                    s
            });
        }

        showSelect(
            'Диапазон серий',
            items,

            function(x){
                selectedRangeStart=
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

        destroyEpisodeLine();

        episodeBlock.empty();

        episodeBlock.append(
            '<div class="ah130-block-title">'+
                'Эпизоды'+
            '</div>'
        );

        if(
            !eps.length
        ){
            episodeBlock.append(
                '<div class="ah130-placeholder">'+
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
            var rangeBtn=
                $('<div class="ah130-lazy selector">Диапазон серий</div>');

            rangeBtn.on(
                'hover:enter click',

                function(e){
                    if(e){
                        e.preventDefault();
                    }

                    chooseRange(
                        eps
                    );
                }
            );

            episodeBlock.append(
                $(
                    '<div class="ah130-placeholder">'+
                        '<span>'+
                            'Всего серий: '+
                            eps.length+
                        '</span>'+
                    '</div>'
                )
                .append(
                    rangeBtn
                )
            );
        }

        var range=
            episodeRangeItems(
                eps
            );

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
                        screenshotFor(
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

                        original:'',
                        year:null,
                        score:0,

                        poster:
                            poster,

                        background:
                            poster,

                        posterHero:
                            poster,

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
            renderEpisodes(
                videos
            );

            return;
        }

        episodeBlock.html(
            '<div class="ah130-block-title">'+
                'Эпизоды'+
            '</div>'+
            '<div class="ah130-placeholder">'+
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
                if(!alive){
                    return;
                }

                episodeBlock.html(
                    '<div class="ah130-block-title">'+
                        'Эпизоды'+
                    '</div>'
                );

                var retry=
                    $('<div class="ah130-lazy selector">Повторить загрузку серий</div>');

                retry.on(
                    'hover:enter click',
                    loadEpisodes
                );

                episodeBlock.append(
                    $(
                        '<div class="ah130-placeholder">'+
                            'Не удалось загрузить серии.'+
                        '</div>'
                    )
                    .append(
                        retry
                    )
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
            '<div class="ah130-block-title">'+
                'Похожие аниме'+
            '</div>'+
            '<div class="ah130-placeholder">'+
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

            function(data){
                if(!alive){
                    return;
                }

                recommendBlock
                    .empty()
                    .append(
                        '<div class="ah130-block-title">'+
                            'Похожие аниме'+
                        '</div>'
                    );

                var items=
                    data.items||
                    [];

                if(
                    !items.length
                ){
                    recommendBlock.append(
                        '<div class="ah130-placeholder">'+
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
                    '<div class="ah130-block-title">'+
                        'Похожие аниме'+
                    '</div>'+
                    '<div class="ah130-placeholder">'+
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
        anime=
            a;

        videos=
            null;

        saveRecent(
            a
        );

        root
            .empty()
            .append(
                detailNav()
            );

        var hero=
            $('<div class="ah130-detail"></div>');

        var bg=
            a.background||
            a.posterHero||
            a.poster||
            '';

        if(bg){
            hero.append(
                imageElement(
                    bg,
                    'ah130-bg'
                )
            );
        }

        hero.append(
            '<div class="ah130-shade"></div>'
        );

        var inner=
            $('<div class="ah130-detail-inner"></div>');

        var poster=
            $('<div class="ah130-poster"></div>');

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
            $('<div class="ah130-detail-main"></div>');

        main.append(
            '<div class="ah130-kicker">'+
                'AnimeHub • YummyAnime'+
            '</div>'+
            '<div class="ah130-detail-title">'+
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
                '<div class="ah130-original">'+
                    esc(
                        a.original
                    )+
                '</div>'
            );
        }

        var meta=
            $('<div class="ah130-meta"></div>');

        if(
            num(
                a.score,
                0
            )>0
        ){
            meta.append(
                '<span class="ah130-chip ah130-score">'+
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
                '<span class="ah130-chip">'+
                    esc(
                        a.year
                    )+
                '</span>'
            );
        }

        meta.append(
            '<span class="ah130-chip">'+
                esc(
                    typeLabel(
                        a
                    )
                )+
            '</span>'
        );

        if(
            a.status&&
            a.status.alias
        ){
            meta.append(
                '<span class="ah130-chip">'+
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
                '<span class="ah130-chip">'+
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
                '<div class="ah130-studio">'+
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
            $('<div class="ah130-meta"></div>');

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
                    '<span class="ah130-chip">'+
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
            '<div class="ah130-desc">'+
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
            $('<div class="ah130-actions"></div>');

        var watchBtn=
            $('<div class="ah130-btn primary selector">▶ Смотреть</div>');

        var sourceBtn=
            $('<div class="ah130-btn selector">🎧 Озвучка / источник</div>');

        var favBtn=
            $('<div class="ah130-btn selector"></div>');

        function refreshFav(){
            favBtn.text(
                isFavorite(
                    anime
                )
                    ?'★ В избранном'
                    :'☆ В избранное'
            );
        }

        refreshFav();

        refreshMainButtons(
            watchBtn,
            sourceBtn
        );

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

        favBtn.on(
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
            watchBtn,
            sourceBtn,
            favBtn
        );

        main.append(
            actions
        );

        inner.append(
            poster,
            main,
            infoPanel(
                a
            )
        );

        hero.append(
            inner
        );

        root.append(
            hero
        );

        episodeBlock=
            $('<div class="ah130-block"></div>');

        var loadEp=
            $('<div class="ah130-lazy selector">Загрузить серии</div>');

        loadEp.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                loadEpisodes();
            }
        );

        episodeBlock.append(
            '<div class="ah130-block-title">'+
                'Эпизоды'+
            '</div>',

            $(
                '<div class="ah130-placeholder">'+
                    '<span>'+
                        'Не загружаем видео автоматически — быстрее для TV.'+
                    '</span>'+
                '</div>'
            )
            .append(
                loadEp
            )
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
                    '<div class="ah130-block">'+
                        '<div class="ah130-block-title">'+
                            'Кадры'+
                        '</div>'+
                    '</div>'
                );

            var row=
                $('<div class="ah130-shots"></div>');

            a.screenshots
                .slice(
                    0,
                    4
                )
                .forEach(
                    function(s){
                        var box=
                            $('<div class="ah130-shot"></div>');

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

                        row.append(
                            box
                        );
                    }
                );

            shots.append(
                row
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
                '<div class="ah130-block">'+
                    '<div class="ah130-block-title">'+
                        'Описание'+
                    '</div>'+
                    '<div class="ah130-longdesc">'+
                        esc(
                            description
                        )+
                    '</div>'+
                '</div>'
            );
        }

        recommendBlock=
            $('<div class="ah130-block"></div>');

        var recBtn=
            $('<div class="ah130-lazy selector">Показать похожие</div>');

        recBtn.on(
            'hover:enter click',

            function(e){
                if(e){
                    e.preventDefault();
                }

                loadRecommendations();
            }
        );

        recommendBlock.append(
            '<div class="ah130-block-title">'+
                'Похожие аниме'+
            '</div>',

            $(
                '<div class="ah130-placeholder">'+
                    '<span>'+
                        'Загружаются только по запросу.'+
                    '</span>'+
                '</div>'
            )
            .append(
                recBtn
            )
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

        scroll.append(
            root
        );

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

            function(data){
                if(alive){
                    render(
                        data.anime
                    );
                }
            },

            function(){
                root.html(
                    '<div class="ah130-placeholder">'+
                        'Не удалось загрузить карточку.'+
                    '</div>'
                );
            }
        );

        return scroll.render();
    };

    this.start=function(){
        if(
            Lampa.Activity.active().activity!==
            this.activity
        ){
            return;
        }

        startController.call(
            this
        );
    };

    this.pause=
        function(){};

    this.stop=
        function(){};

    this.render=
        function(){
            return scroll.render();
        };

    this.destroy=
        function(){
            alive=false;

            try{
                net.clear();
            }
            catch(e){}

            destroyEpisodeLine();
            destroyRecommendLine();

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
    ]=
        true;

    if(
        !nativeReady()
    ){
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

        addMenuButton();

        notify(
            'AnimeHub V'+
            VERSION+
            ' Native загружен'
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

if(
    window.appready
){
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
