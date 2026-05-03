window._embedMode = window.location.pathname.indexOf('/embed/') === 0;
if(window._embedMode) {
  document.addEventListener('DOMContentLoaded', function() {
    var app = document.querySelector('.app');
    if(app) app.style.display = 'none';
    // Hide all overlays too
    var els = document.querySelectorAll('.search-overlay,.bubble-modal-overlay,.boost-modal-overlay,.bugreport-overlay');
    for(var i=0;i<els.length;i++) els[i].classList.remove('open');

    var embed = document.createElement('div');
    embed.style.cssText = 'position:fixed;inset:0;background:#141314;display:flex;flex-direction:column;font-family:Inter,sans-serif;';

    // Header
    var h = document.createElement('div');
    h.style.cssText = 'padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);';
    h.innerHTML = '<div style="display:flex;align-items:center;gap:10px"><img id="emb-img" src="" width="28" height="28" style="border-radius:6px"><div><span id="emb-sym" style="font-weight:700;color:#fff;font-size:15px"></span><span id="emb-chain" style="font-size:11px;color:rgba(255,255,255,0.4);margin-left:6px;text-transform:uppercase"></span></div></div><div style="text-align:right"><div id="emb-price" style="font-weight:700;color:#fff;font-size:16px"></div><div id="emb-chg" style="font-size:12px"></div></div>';
    embed.appendChild(h);

    // Chart
    var c = document.createElement('div');
    c.id = 'emb-chart';
    c.style.cssText = 'flex:1;min-height:0;position:relative;';
    // Watermark inside chart
    var wm = document.createElement('div');
    wm.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;pointer-events:none;opacity:0.06;font-family:Inter,sans-serif;font-size:42px;font-weight:800;color:#fff;letter-spacing:4px;white-space:nowrap;user-select:none;';
    wm.textContent = 'memescope.io';
    c.appendChild(wm);
    embed.appendChild(c);

    // Footer
    var f = document.createElement('div');
    f.style.cssText = 'padding:6px 16px;text-align:center;border-top:1px solid var(--border);';
    f.innerHTML = '<a href="'+location.origin+'" target="_blank" style="color:rgba(255,255,255,0.3);text-decoration:none;font-size:11px">Powered by memescope.io</a>';
    embed.appendChild(f);
    document.body.appendChild(embed);

    var parts = location.pathname.split('/').filter(function(p){return p.length>0;});
    if(parts.length>=3) {
      var chain=parts[1], ca=parts[2];
      fetch('https://api.dexscreener.com/latest/dex/tokens/'+ca).then(function(r){return r.json();}).then(function(d){
        if(!d.pairs||!d.pairs.length) return;
        var p=d.pairs[0], pc=p.priceChange||{};
        document.getElementById('emb-sym').textContent=p.baseToken?p.baseToken.symbol.toUpperCase():'???';
        document.getElementById('emb-chain').textContent=chain;
        if(p.info&&p.info.imageUrl) document.getElementById('emb-img').src=p.info.imageUrl;
        var pr=p.priceUsd?parseFloat(p.priceUsd):0;
        var pf=function(v){if(v>=1)return'$'+v.toFixed(2);if(v>=0.01)return'$'+v.toFixed(4);if(v>=0.0001)return'$'+v.toFixed(6);return'$'+v.toExponential(2);};
        document.getElementById('emb-price').textContent=pf(pr);
        var ch24=pc.h24?parseFloat(pc.h24):0;
        var chEl=document.getElementById('emb-chg');
        chEl.textContent=(ch24>=0?'+':'')+ch24.toFixed(1)+'% (24h)';
        chEl.style.color=ch24>=0?'#22C55E':'#EF4444';

        var s=document.createElement('script');
        s.src='https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js';
        s.onload=function(){
          var chartEl=document.getElementById('emb-chart');
          var chart=LightweightCharts.createChart(chartEl,{
            layout:{background:{type:'solid',color:'#141314'},textColor:'rgba(255,255,255,0.5)',fontSize:11},
            grid:{vertLines:{color:'rgba(255,255,255,0.03)'},horzLines:{color:'rgba(255,255,255,0.03)'}},
            timeScale:{timeVisible:true,secondsVisible:false,borderColor:'rgba(230,220,210,0.08)'},
            rightPriceScale:{borderColor:'rgba(230,220,210,0.08)'},
            crosshair:{mode:0}
          });
          var series=chart.addCandlestickSeries({upColor:'#22C55E',downColor:'#EF4444',borderUpColor:'#22C55E',borderDownColor:'#EF4444',wickUpColor:'#22C55E',wickDownColor:'#EF4444'});
          var net=chain==='eth'?'ethereum':chain;
          var pool=p.pairAddress||'';
          fetch('https://api.geckoterminal.com/api/v2/networks/'+net+'/pools/'+pool+'/ohlcv/minute?aggregate=5&limit=200&currency=usd')
            .then(function(r){return r.json();})
            .then(function(o){
              if(o.data&&o.data.attributes&&o.data.attributes.ohlcv_list){
                var bars=o.data.attributes.ohlcv_list.map(function(b){return{time:b[0],open:b[1],high:b[2],low:b[3],close:b[4]};}).sort(function(a,b){return a.time-b.time;});
                series.setData(bars);
                chart.timeScale().fitContent();
              }
            }).catch(function(){});
          window.addEventListener('resize',function(){chart.applyOptions({width:chartEl.clientWidth});});
        };
        document.head.appendChild(s);
      }).catch(function(){});
    }
  });
}
