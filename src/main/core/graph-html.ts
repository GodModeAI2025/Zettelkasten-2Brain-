/**
 * Erzeugt einen vollstaendig eigenstaendigen HTML-Viewer fuer den Wissensgraphen.
 * Kein CDN, kein externer Code, kein Netzwerk — der Graph + die gerenderten
 * Seiteninhalte werden als JSON eingebettet und von einem kleinen Vanilla-JS-
 * Canvas-Force-Graph dargestellt (Farbe = Community, Groesse = PageRank,
 * Klick = Detailpanel mit Body + Backlinks). Funktioniert offline via file://.
 */

export interface GraphHtmlNode {
  id: string;
  label: string;
  group: string;
  community: number;
  pagerank: number;
  degree: number;
}

export interface GraphHtmlEdge {
  source: string;
  target: string;
  weight: number;
}

export interface GraphHtmlBundle {
  title: string;
  generatedAt: string;
  nodes: GraphHtmlNode[];
  edges: GraphHtmlEdge[];
  /** id -> bereits zu HTML gerenderter Seiten-Body. */
  bodies: Record<string, string>;
  /** Ziel-id -> verlinkende Quell-ids. */
  backlinks: Record<string, string[]>;
}

const VIEWER_CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1115;color:#e6e8eb}
#app{display:flex;height:100vh}
#left{position:relative;flex:1;min-width:0}
#graph{display:block;width:100%;height:100%}
#topbar{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:10px;align-items:center;z-index:5;pointer-events:none}
#topbar h1{font-size:14px;font-weight:600;margin:0;opacity:.8;pointer-events:auto}
#search{pointer-events:auto;margin-left:auto;background:#1b1f27;border:1px solid #2c313c;color:#e6e8eb;border-radius:6px;padding:6px 10px;font-size:13px;width:220px}
#panel{width:0;overflow:hidden;background:#151820;border-left:1px solid #232838;transition:width .15s ease}
#panel.open{width:420px}
#panel-inner{padding:20px 22px;height:100vh;overflow:auto}
#panel h2{margin:0 0 4px;font-size:18px}
#panel .meta{font-size:12px;opacity:.6;margin-bottom:14px}
#panel .body{font-size:14px;line-height:1.6}
#panel .body h1,#panel .body h2,#panel .body h3{line-height:1.3}
#panel .body a{color:#6ea8ff}
#panel .backlinks{margin-top:22px;border-top:1px solid #232838;padding-top:14px}
#panel .backlinks h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;opacity:.6}
#panel .backlinks a,#panel .body a.wikilink{color:#6ea8ff;cursor:pointer;text-decoration:none}
#panel .backlinks a:hover,.wikilink:hover{text-decoration:underline}
#panel .close{float:right;cursor:pointer;opacity:.5;font-size:20px;line-height:1}
.hint{position:absolute;bottom:10px;left:12px;font-size:11px;opacity:.4}
`;

// Vanilla-JS-Viewer: bewusst OHNE Template-Literals/Backticks, damit er sicher
// in das aeussere Template eingebettet werden kann.
const VIEWER_JS = `
(function(){
  var B = window.BUNDLE;
  var canvas = document.getElementById('graph');
  var ctx = canvas.getContext('2d');
  var panel = document.getElementById('panel');
  var nodes = B.nodes.map(function(n){return {id:n.id,label:n.label,community:n.community,pr:n.pagerank,deg:n.degree,x:0,y:0,vx:0,vy:0};});
  var byId = {}; nodes.forEach(function(n){byId[n.id]=n;});
  // Alias-Lookup fuer interne Links (label + id, kleingeschrieben).
  var alias = {};
  nodes.forEach(function(n){ alias[n.label.toLowerCase()]=n; alias[n.id.toLowerCase()]=n; var s=n.id.split('/').pop(); if(s) alias[s.replace(/-/g,' ').toLowerCase()]=n; });
  var edges = B.edges.map(function(e){return {s:byId[e.source],t:byId[e.target],w:e.weight};}).filter(function(e){return e.s&&e.t;});

  var W=0,H=0,DPR=window.devicePixelRatio||1;
  function resize(){W=canvas.clientWidth;H=canvas.clientHeight;canvas.width=W*DPR;canvas.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);}
  window.addEventListener('resize',function(){resize();draw();});

  // Initiale Platzierung im Kreis.
  var R=Math.min(W,H)/2||300;
  nodes.forEach(function(n,i){var a=i/nodes.length*Math.PI*2;n.x=Math.cos(a)*R*0.6;n.y=Math.sin(a)*R*0.6;});

  function radius(n){return 4+Math.sqrt(Math.max(0,n.pr))*46;}
  function color(n){var h=(n.community*47)%360;return 'hsl('+h+',62%,58%)';}

  // Force-Simulation (Repulsion + Federn + Gravitation).
  var alpha=1.0;
  function step(){
    var i,j,a,b,dx,dy,d2,d,f;
    for(i=0;i<nodes.length;i++){a=nodes[i];
      for(j=i+1;j<nodes.length;j++){b=nodes[j];dx=a.x-b.x;dy=a.y-b.y;d2=dx*dx+dy*dy+0.01;d=Math.sqrt(d2);
        f=2600/d2;var ux=dx/d,uy=dy/d;a.vx+=ux*f;a.vy+=uy*f;b.vx-=ux*f;b.vy-=uy*f;}}
    for(i=0;i<edges.length;i++){a=edges[i].s;b=edges[i].t;dx=b.x-a.x;dy=b.y-a.y;d=Math.sqrt(dx*dx+dy*dy)+0.01;
      f=(d-90)*0.018*(0.4+edges[i].w);var ux=dx/d,uy=dy/d;a.vx+=ux*f;a.vy+=uy*f;b.vx-=ux*f;b.vy-=uy*f;}
    for(i=0;i<nodes.length;i++){a=nodes[i];a.vx+=-a.x*0.004;a.vy+=-a.y*0.004;
      a.x+=a.vx*alpha;a.y+=a.vy*alpha;a.vx*=0.85;a.vy*=0.85;}
    if(alpha>0.05)alpha*=0.992;
  }

  var tx=0,ty=0,scale=1,sel=null,q='';
  function fit(){var minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;nodes.forEach(function(n){if(n.x<minx)minx=n.x;if(n.y<miny)miny=n.y;if(n.x>maxx)maxx=n.x;if(n.y>maxy)maxy=n.y;});
    var gw=(maxx-minx)||1,gh=(maxy-miny)||1;scale=Math.min(W/(gw+120),H/(gh+120),2);tx=W/2-(minx+maxx)/2*scale;ty=H/2-(miny+maxy)/2*scale;}

  function draw(){
    ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(tx,ty);ctx.scale(scale,scale);
    ctx.lineWidth=0.6/scale;
    for(var i=0;i<edges.length;i++){var e=edges[i];ctx.strokeStyle='rgba(150,160,180,'+(0.10+e.w*0.25)+')';ctx.beginPath();ctx.moveTo(e.s.x,e.s.y);ctx.lineTo(e.t.x,e.t.y);ctx.stroke();}
    for(var k=0;k<nodes.length;k++){var n=nodes[k];var r=radius(n);
      var match=q&&n.label.toLowerCase().indexOf(q)>=0;
      var dim=q&&!match;ctx.globalAlpha=dim?0.15:1;
      ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);ctx.fillStyle=color(n);ctx.fill();
      if(n===sel||match){ctx.lineWidth=2/scale;ctx.strokeStyle='#fff';ctx.stroke();}
      if(scale*r>9||n===sel||match){ctx.globalAlpha=dim?0.2:0.9;ctx.fillStyle='#e6e8eb';ctx.font=(11/scale)+'px sans-serif';ctx.textAlign='center';ctx.fillText(n.label,n.x,n.y-r-2/scale);}
    }
    ctx.globalAlpha=1;ctx.restore();
  }

  function frame(){step();draw();requestAnimationFrame(frame);}

  function screenToWorld(px,py){return {x:(px-tx)/scale,y:(py-ty)/scale};}
  function pick(px,py){var w=screenToWorld(px,py),best=null,bd=1e9;for(var i=0;i<nodes.length;i++){var n=nodes[i];var dx=n.x-w.x,dy=n.y-w.y,d=Math.sqrt(dx*dx+dy*dy);var r=radius(n)+4;if(d<r&&d<bd){bd=d;best=n;}}return best;}

  function openNode(n){sel=n;panel.classList.add('open');
    var bl=(B.backlinks[n.id]||[]).map(function(id){var t=byId[id];var lbl=t?t.label:id;return '<a data-go="'+encodeURIComponent(id)+'">'+lbl+'</a>';}).join('<br>');
    document.getElementById('panel-inner').innerHTML='<span class="close" id="cl">&times;</span><h2>'+escapeHtml(n.label)+'</h2><div class="meta">'+escapeHtml(n.id)+' &middot; '+(B.backlinks[n.id]?B.backlinks[n.id].length:0)+' Backlinks</div><div class="body">'+(B.bodies[n.id]||'<em>kein Inhalt</em>')+'</div><div class="backlinks"><h3>Backlinks</h3>'+(bl||'<span style="opacity:.5">keine</span>')+'</div>';
    document.getElementById('cl').onclick=function(){panel.classList.remove('open');sel=null;};
  }
  function escapeHtml(s){return s.replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

  var dragging=false,lastX=0,lastY=0,moved=false;
  canvas.addEventListener('mousedown',function(e){dragging=true;moved=false;lastX=e.clientX;lastY=e.clientY;});
  window.addEventListener('mousemove',function(e){if(!dragging)return;var dx=e.clientX-lastX,dy=e.clientY-lastY;if(Math.abs(dx)+Math.abs(dy)>3)moved=true;tx+=dx;ty+=dy;lastX=e.clientX;lastY=e.clientY;});
  window.addEventListener('mouseup',function(e){dragging=false;});
  canvas.addEventListener('click',function(e){if(moved)return;var rect=canvas.getBoundingClientRect();var n=pick(e.clientX-rect.left,e.clientY-rect.top);if(n)openNode(n);});
  canvas.addEventListener('wheel',function(e){e.preventDefault();var rect=canvas.getBoundingClientRect();var mx=e.clientX-rect.left,my=e.clientY-rect.top;var f=e.deltaY<0?1.1:0.9;var w=screenToWorld(mx,my);scale*=f;tx=mx-w.x*scale;ty=my-w.y*scale;},{passive:false});

  document.getElementById('panel-inner').addEventListener('click',function(e){
    var go=e.target.getAttribute&&e.target.getAttribute('data-go');
    var wl=e.target.getAttribute&&e.target.getAttribute('data-wiki-target');
    var id=null;
    if(go)id=decodeURIComponent(go);
    else if(wl){var t=alias[decodeURIComponent(wl).toLowerCase()];if(t)id=t.id;}
    if(id&&byId[id]){e.preventDefault();openNode(byId[id]);}
  });

  document.getElementById('search').addEventListener('input',function(e){q=e.target.value.trim().toLowerCase();});

  resize();fit();frame();
})();
`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

export function renderGraphHtml(bundle: GraphHtmlBundle): string {
  // `<` escapen, damit eingebettetes JSON kein </script> oder Tag aufbricht.
  const data = JSON.stringify(bundle).replace(/</g, '\\u003c');
  return [
    '<!DOCTYPE html>',
    '<html lang="de"><head><meta charset="utf-8">',
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${escapeHtml(bundle.title)}</title>`,
    `<style>${VIEWER_CSS}</style>`,
    '</head><body>',
    '<div id="app">',
    '<div id="left">',
    '<canvas id="graph"></canvas>',
    `<div id="topbar"><h1>${escapeHtml(bundle.title)}</h1><input id="search" placeholder="Suchen..." /></div>`,
    '<div class="hint">Ziehen = verschieben &middot; Scrollen = zoomen &middot; Klick = Details</div>',
    '</div>',
    '<div id="panel"><div id="panel-inner"></div></div>',
    '</div>',
    `<script>window.BUNDLE=${data};</script>`,
    `<script>${VIEWER_JS}</script>`,
    '</body></html>',
  ].join('\n');
}
