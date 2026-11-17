'use strict';
const $=id=>document.getElementById(id), FILES='abcdefgh';
const pieceName={p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'};
const pieceSVG=(type,color)=>'<svg class="piece '+(color==='b'?'black':'white')+'" viewBox="0 0 64 64" aria-hidden="true"><use href="#piece-'+type+'"/></svg>';
const uciOf=m=>m.from+m.to+(m.promotion||'');
let game=new Chess(), rootFen=game.fen(), timeline=[], keys=[positionKey(game)], cursor=0, flipped=false, selection=null, preview=null, claimed=null, pendingPromotion=null;
let rows=[], best=null, depth=0, nodesPerSecond=0, busy=false, generation=0, active=null, searchTimer=null, engineModule=null, modulePromise=null, mainChain=Promise.resolve(), workerUnavailable=false;
let drag=null, suppressClickUntil=0, toastTimer=null;
function positionKey(g){return g.fen().split(' ').slice(0,4).join(' ')}
function repetitions(){const key=positionKey(game);return keys.slice(0,cursor+1).filter(k=>k===key).length}
function terminal(){
 if(game.isCheckmate())return {text:'Checkmate · '+(game.turn()==='w'?'Black':'White')+' wins',winner:game.turn()==='w'?'b':'w'};
 if(game.isStalemate())return {text:'Draw · stalemate'};
 if(game.isInsufficientMaterial())return {text:'Draw · insufficient mating material'};
 if(claimed)return {text:'Draw · '+claimed};
 if(repetitions()>=5)return {text:'Draw · fivefold repetition'};
 if(+game.fen().split(' ')[4]>=150)return {text:'Draw · 75-move rule'};
 return null;
}
function showToast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,2600)}
function legalUci(g,text){if(!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text||''))return null;return g.moves({verbose:true}).find(m=>uciOf(m)===text)||null}
function playUci(g,text){const m=legalUci(g,text);return m?g.move({from:m.from,to:m.to,promotion:m.promotion}):null}
function displayGame(){if(!preview)return game;const p=new Chess(preview.fen);for(let i=0;i<preview.step;i++){if(!playUci(p,preview.moves[i]))break}return p}
function squarePoint(s){let x=FILES.indexOf(s[0]),y=8-Number(s[1]);if(flipped){x=7-x;y=7-y}return{x:x*100+50,y:y*100+50}}
function arrowFor(move){
 $('arrow-path').replaceChildren();if(!move)return;
 const a=squarePoint(move.from),b=squarePoint(move.to),d=Math.hypot(b.x-a.x,b.y-a.y),end={x:b.x-(b.x-a.x)/d*16,y:b.y-(b.y-a.y)/d*16};
 const ns='http://www.w3.org/2000/svg',line=document.createElementNS(ns,'line');
 for(const [k,v] of Object.entries({x1:a.x,y1:a.y,x2:end.x,y2:end.y,stroke:'#5cda75','stroke-width':13,'stroke-linecap':'round','marker-end':'url(#arrowhead)',opacity:'.86'}))line.setAttribute(k,v);
 $('arrow-path').append(line);
}
function renderBoard(){
 const g=displayGame(), frag=document.createDocumentFragment(), legal=selection&&!preview?g.moves({square:selection,verbose:true}):[];
 let lastMove=null;if(preview&&preview.step>0){const u=preview.moves[preview.step-1];lastMove={from:u.slice(0,2),to:u.slice(2,4)}}else if(!preview&&cursor>0)lastMove=timeline[cursor-1];
 for(let row=0;row<8;row++)for(let col=0;col<8;col++){
  const f=flipped?7-col:col,r=flipped?row+1:8-row,square=FILES[f]+r,p=g.get(square),btn=document.createElement('button');
  btn.type='button';btn.className='sq'+((f+r)%2===1?' dark':'');btn.dataset.square=square;
  btn.setAttribute('aria-label',square+(p?', '+(p.color==='w'?'White ':'Black ')+pieceName[p.type]:', empty'));
  if(lastMove&&(lastMove.from===square||lastMove.to===square))btn.classList.add('last');
  if(selection===square)btn.classList.add('selected');
  if(p&&p.type==='k'&&p.color===g.turn()&&g.isCheck())btn.classList.add('check');
  if(legal.some(m=>m.to===square)){btn.classList.add('legal');if(p)btn.classList.add('capture')}
  if(p)btn.innerHTML=pieceSVG(p.type,p.color);
  if(col===0){const t=document.createElement('span');t.className='coord rank';t.textContent=r;btn.append(t)}
  if(row===7){const t=document.createElement('span');t.className='coord file';t.textContent=FILES[f];btn.append(t)}
  frag.append(btn);
 }
 $('board').replaceChildren(frag);
 $('preview-badge').hidden=!preview;
 if(preview){$('preview-badge').textContent='Preview · game unchanged';arrowFor(legalUci(g,preview.moves[preview.step]))}else arrowFor(best&&legalUci(game,best.moves[0]));
 for(const [id,color] of [['top-player',flipped?'w':'b'],['bottom-player',flipped?'b':'w']]){
  const el=$(id);el.classList.toggle('active',g.turn()===color&&!terminal());el.querySelector('.player-label').textContent=color==='w'?'White':'Black';el.querySelector('.player-piece').textContent=color==='w'?'♙':'♟';el.querySelector('.player-meta').textContent=g.turn()===color?(preview?'Preview · to move':'Your move'):'Controlled by you';
 }
}
function renderHistory(){
 const container=$('history');container.replaceChildren();
 if(!timeline.length){const empty=document.createElement('div');empty.className='history-empty';empty.textContent='Make a move. Explore an idea.';container.append(empty)}
 let row=null;for(let i=0;i<timeline.length;i++){
  const m=timeline[i];if(!row||m.color==='w'){row=document.createElement('div');row.className='history-row';const num=document.createElement('span');num.className='history-num';num.textContent=m.number+'.';row.append(num);if(m.color==='b')row.append(document.createElement('span'));container.append(row)}
  const b=document.createElement('button');b.className='history-move'+(i===cursor-1?' current':'')+(i>=cursor?' future':'');b.textContent=m.san;b.dataset.ply=i+1;b.setAttribute('aria-label','Go to '+m.number+(m.color==='w'?'. ':'... ')+m.san);row.append(b);
 }
 const current=container.querySelector('.current');if(current)container.scrollTop=Math.max(0,current.offsetTop-container.offsetTop-container.clientHeight/2);
 $('history-count').textContent=cursor?cursor+' '+(cursor===1?'ply':'plies')+' played':'Starting position';
 for(const id of ['undo','first'])$(id).disabled=cursor===0;
 for(const id of ['redo','last'])$(id).disabled=cursor===timeline.length;
}
function renderStatus(){
 const end=terminal();$('game-status').textContent=end?end.text:(game.turn()==='w'?'White':'Black')+' to move'+(game.isCheck()?' · check':'');
 $('claim-draw').hidden=!!end||!(game.isThreefoldRepetition()||+game.fen().split(' ')[4]>=100);
}
function scoreText(score){if(!score)return '—';if(score.type==='mate')return(score.value>=0?'+M':'−M')+Math.abs(score.value);return(score.value>=0?'+':'−')+(Math.abs(score.value)/100).toFixed(2)}
function scoreNumber(score){if(!score)return 0;return score.type==='mate'?(score.value>=0?10000:-10000):score.value}
function notationTokens(fen,moves){
 const p=new Chess(fen),out=[];for(const u of moves){const number=+p.fen().split(' ')[5],color=p.turn(),m=playUci(p,u);if(!m)break;out.push({san:m.san,number,color,uci:u})}return out;
}
function renderPV(){
 const line=preview||best;$('pv').replaceChildren();
 if(!line){const span=document.createElement('span');span.style.color='var(--muted)';span.textContent=terminal()?'This position has no continuation.':'A suggested line will appear here.';$('pv').append(span)}
 else{const tokens=notationTokens(line.fen,line.moves);tokens.forEach((t,i)=>{if(t.color==='w'||i===0){const n=document.createElement('span');n.className='move-number';n.textContent=t.number+(t.color==='w'?'.':'…');$('pv').append(n)}const b=document.createElement('button');b.textContent=t.san;b.className=preview&&i===preview.step-1?'current':'';b.title='Preview through '+t.san;b.onclick=()=>openPreview(line,i+1);$('pv').append(b,document.createTextNode(' '))})}
 $('preview-controls').hidden=!preview;
 if(preview){$('preview-progress').textContent=preview.step+' / '+preview.moves.length+' plies';$('preview-back').disabled=preview.step===0;$('preview-next').disabled=preview.step>=preview.moves.length}
}
function renderAnalysis(){
 const end=terminal();$('best-move').textContent=end?(end.winner?'Mate':'Draw'):best?best.san:'—';
 const score=end?(end.winner?{type:'mate',value:end.winner==='w'?0:-0.001}:{type:'cp',value:0}):best&&best.score;
 $('best-score').textContent=end&&end.winner?(end.winner==='w'?'+M0':'−M0'):scoreText(score);
 $('depth').textContent='Depth '+(depth||'—');$('engine-speed').textContent=nodesPerSecond?Math.round(nodesPerSecond/1000).toLocaleString()+'k n/s':'';
 $('activity').classList.toggle('busy',busy);
 $('activity-text').textContent=end?'Position complete':!$('analysis-toggle').checked?'Analysis paused':!engineModule?'Preparing engine…':busy?'Analyzing…':best?'Analysis complete':'Ready to analyze';
 const value=end&&end.winner?(end.winner==='w'?10000:-10000):scoreNumber(score),white=end&&!end.winner?50:score?Math.max(1,Math.min(99,50+50*Math.tanh(value/650))):50;
 $('eval-white').style.height=white+'%';$('eval-caption').style.color=white<12?'#f0f0de':'#293026';$('eval-caption').textContent=end&&end.winner?(end.winner==='w'?'+M0':'−M0'):!score?'0.0':score.type==='mate'?scoreText(score):(value>=0?'+':'−')+(Math.abs(value)/100).toFixed(1);$('eval-rail').setAttribute('aria-label','White evaluation: '+$('best-score').textContent);
 $('play-best').disabled=!best||!!end||!legalUci(game,best.moves[0]);
 const candidates=$('candidate-list');candidates.replaceChildren();const seen=new Set();
 rows.forEach((line,i)=>{if(!line||seen.has(line.moves[0]))return;seen.add(line.moves[0]);const b=document.createElement('button');b.className='candidate'+(preview&&preview.moves[0]===line.moves[0]?' active':'');b.title='Preview '+line.san+' without changing the game';b.innerHTML='<span class="candidate-rank">'+(i+1)+'</span><span class="candidate-move"></span><span class="candidate-detail">d'+line.depth+'</span><span class="candidate-score"></span>';b.querySelector('.candidate-move').textContent=line.san;b.querySelector('.candidate-score').textContent=scoreText(line.score);b.onclick=()=>openPreview(line,1);candidates.append(b)});
 if(!seen.size){const e=document.createElement('div');e.className='empty';e.textContent=end?'No moves to analyze.':$('analysis-toggle').checked?'The engine is finding its next ideas.':'Turn analysis on to see candidate moves.';candidates.append(e)}
 renderPV();if(!preview)arrowFor(best&&legalUci(game,best.moves[0]));
}
function renderAll(){renderBoard();renderHistory();renderStatus();renderAnalysis()}
function closePreview(){preview=null;selection=null;renderBoard();renderAnalysis()}
function openPreview(line,step=1){preview={fen:line.fen,moves:line.moves.slice(),step:Math.min(step,line.moves.length),score:line.score,san:line.san,depth:line.depth};selection=null;renderBoard();renderAnalysis()}
function stepPreview(delta){if(!preview)return;preview.step=Math.max(0,Math.min(preview.moves.length,preview.step+delta));renderBoard();renderPV()}
function changed(){selection=null;preview=null;claimed=null;cancelAnalysis();rows=[];best=null;depth=0;nodesPerSecond=0;renderAll();scheduleAnalysis()}
function commit(from,to,promotion){
 if(preview||terminal())return false;const legal=game.moves({verbose:true}).filter(m=>m.from===from&&m.to===to&&(!promotion||m.promotion===promotion));if(!legal.length)return false;
 if(legal.some(m=>m.promotion)&&!promotion){pendingPromotion={from,to};$('promotion-options').replaceChildren();for(const p of ['q','r','b','n']){const b=document.createElement('button');b.className='promotion-choice';b.setAttribute('aria-label','Promote to '+pieceName[p]);b.innerHTML=pieceSVG(p,game.turn());b.onclick=()=>{const pending=pendingPromotion;$('promotion-dialog').close();if(pending)commit(pending.from,pending.to,p)};$('promotion-options').append(b)}$('promotion-dialog').showModal();return false}
 const number=+game.fen().split(' ')[5],m=game.move({from,to,promotion});timeline.length=cursor;keys.length=cursor+1;timeline.push({from:m.from,to:m.to,promotion:m.promotion,san:m.san,color:m.color,number,uci:uciOf(m)});cursor++;keys.push(positionKey(game));changed();return true;
}
function clickSquare(square){if(preview){showToast('Choose “Back to game” to play a move.');return}if(terminal())return;const p=game.get(square);if(selection){if(square===selection){selection=null;renderBoard();return}if(commit(selection,square))return;if(pendingPromotion)return}selection=p&&p.color===game.turn()?square:null;renderBoard()}
function jumpTo(target){target=Math.max(0,Math.min(timeline.length,target));if(target===cursor&&!claimed){closePreview();return}if(target<cursor){while(cursor>target){game.undo();cursor--}}else while(cursor<target){const m=timeline[cursor];game.move({from:m.from,to:m.to,promotion:m.promotion});cursor++}changed()}
function loadPosition(fen){const p=new Chess(fen);game=p;rootFen=p.fen();timeline=[];cursor=0;keys=[positionKey(p)];changed()}
function cancelAnalysis(){generation++;clearTimeout(searchTimer);searchTimer=null;busy=false;if(active){const old=active;active=null;if(old.worker)old.worker.terminate();else if(old.send){try{old.send('stop')}catch{}}if(old.resolveDone)old.resolveDone()}}
function scheduleAnalysis(immediate=false){if(!$('analysis-toggle').checked||terminal())return;busy=true;renderAnalysis();const gen=generation;searchTimer=setTimeout(()=>runAnalysis(gen),immediate?0:160)}
async function prepareModule(){
 if(engineModule)return engineModule;if(modulePromise)return modulePromise;
 modulePromise=(async()=>{
  if(typeof WebAssembly==='undefined')throw new Error('This browser does not support WebAssembly. Open this folder in a modern Chrome or Firefox browser.');
  const parts=globalThis.STOCKFISH_WASM_PARTS;
  const expectedParts=6,expectedBytes=99169054;
  if(!Array.isArray(parts)||parts.length!==expectedParts||Array.from({length:expectedParts},(_,i)=>parts[i]).some(part=>typeof part!=='string'||!part.length))throw new Error('A Stockfish engine part is missing. Keep index.html and the complete assets folder together.');
  const size=parts.reduce((total,part)=>total+part.length*3/4-(part.endsWith('==')?2:part.endsWith('=')?1:0),0);
  if(size!==expectedBytes)throw new Error('A Stockfish engine part is incomplete. Restore all stockfish-part files in the assets folder.');
  const bytes=new Uint8Array(size),chunk=1048576;let offset=0;
  for(const encoded of parts){
   for(let start=0;start<encoded.length;start+=chunk){
    const text=atob(encoded.slice(start,start+chunk));
    for(let i=0;i<text.length;i++)bytes[offset++]=text.charCodeAt(i);
    if(start%(chunk*8)===0)await new Promise(resolve=>setTimeout(resolve,0));
   }
  }
  engineModule=await WebAssembly.compile(bytes);return engineModule;
 })();
 try{return await modulePromise}catch(error){modulePromise=null;throw error}
}
async function bootStockfish(source,compiled,onLine){
 const stub={currentScript:{src:''}};
 new Function('document','onmessage',source)(stub,undefined);
 const factory=stub.currentScript._exports;if(typeof factory!=='function')throw new Error('Could not initialize embedded Stockfish.');
 let rejectInstantiation;
 const failed=new Promise((_,reject)=>rejectInstantiation=reject);
 const engine=await Promise.race([factory({listener:onLine,print:onLine,printErr:line=>onLine('info string '+line),locateFile(){throw new Error('External engine assets are disabled.');},instantiateWasm(imports,receive){WebAssembly.instantiate(compiled,imports).then(instance=>receive(instance,compiled)).catch(rejectInstantiation);return {};}}),failed]);
 return {send(command){return engine.ccall('command',null,['string'],[command],{async:/^go\b/.test(command)})}};
}
const workerBootstrap=`'use strict';const bootStockfish=${bootStockfish.toString()};let engine;self.onmessage=async function(event){try{if(event.data.type==='init'){engine=await bootStockfish(event.data.source,event.data.module,line=>queueMicrotask(()=>postMessage({type:'line',line})));postMessage({type:'ready'});}else if(event.data.type==='command'&&engine){Promise.resolve(engine.send(event.data.command)).catch(e=>postMessage({type:'error',message:String(e)}));}}catch(e){postMessage({type:'error',message:String(e)});}};`;
let workerURL=null;
function engineFailure(e,gen){if(gen!==generation)return;cancelAnalysis();$('engine-error').hidden=false;$('engine-error').textContent=String(e.message||e)+' Use Analyze again to retry.';renderAnalysis();$('activity-text').textContent='Engine needs attention'}
async function runAnalysis(gen){
 if(gen!==generation||!$('analysis-toggle').checked||terminal())return;
 try{
  const compiled=await prepareModule();if(gen!==generation||!$('analysis-toggle').checked)return;
  $('engine-error').hidden=true;const source=globalThis.STOCKFISH_LOADER;if(typeof source!=='string')throw new Error('The Stockfish loader is missing. Restore assets/stockfish-loader.js.');
  const job={gen,fen:game.fen(),turn:game.turn(),position:'position fen '+rootFen+(cursor?' moves '+timeline.slice(0,cursor).map(m=>m.uci).join(' '):''),started:false};
  const onLine=line=>{if(job.gen===generation)receiveLine(String(line),job)};
  if(!workerUnavailable&&typeof Worker!=='undefined'){
   try{if(!workerURL)workerURL=URL.createObjectURL(new Blob([workerBootstrap],{type:'application/javascript'}));const worker=new Worker(workerURL);job.worker=worker;job.send=command=>worker.postMessage({type:'command',command});active=job;worker.onmessage=event=>{if(gen!==generation)return;const d=event.data;if(d.type==='ready')job.send('uci');else if(d.type==='line')onLine(d.line);else if(d.type==='error'){worker.terminate();workerUnavailable=true;active=null;runAnalysis(gen)}};worker.onerror=event=>{event.preventDefault();if(gen!==generation)return;worker.terminate();workerUnavailable=true;active=null;runAnalysis(gen)};worker.postMessage({type:'init',source,module:compiled});return}catch{workerUnavailable=true}
  }
  $('engine-sub').textContent='Full NNUE · cooperative compatibility mode';
  mainChain=mainChain.catch(()=>{}).then(async()=>{if(gen!==generation)return;const bridge=await bootStockfish(source,compiled,line=>queueMicrotask(()=>onLine(line)));if(gen!==generation)return;job.send=bridge.send;active=job;const done=new Promise(resolve=>job.resolveDone=resolve);job.send('uci');await done;});mainChain.catch(e=>engineFailure(e,gen));
 }catch(e){engineFailure(e,gen)}
}
function receiveLine(line,job){
 if(job.gen!==generation)return;
 if(line==='uciok'){job.send('setoption name Hash value 64');job.send('setoption name MultiPV value 3');job.send('setoption name UCI_AnalyseMode value true');job.send('isready');return}
 if(line==='readyok'&&!job.started){job.started=true;job.send(job.position);const [kind,value]=$('budget').value.split(':');const command=$('infinite').checked?'go infinite':kind==='time'?'go movetime '+value:'go depth '+value;Promise.resolve(job.send(command)).catch(e=>engineFailure(e,job.gen));return}
 if(line.startsWith('info ')&&/\bpv\s/.test(line)){
  const depthMatch=line.match(/\bdepth (\d+)/),scoreMatch=line.match(/\bscore (cp|mate) (-?\d+)/),pvMatch=line.match(/\bpv (.+)$/);if(!depthMatch||!scoreMatch||!pvMatch)return;
  const index=+(line.match(/\bmultipv (\d+)/)||[0,1])[1]-1;if(index<0||index>2)return;const d=+depthMatch[1];if(rows[index]&&rows[index].depth>d)return;
  const tokens=notationTokens(job.fen,pvMatch[1].trim().split(/\s+/));if(!tokens.length)return;
  const sign=job.turn==='w'?1:-1,entry={fen:job.fen,moves:tokens.map(t=>t.uci),san:tokens[0].san,score:{type:scoreMatch[1],value:+scoreMatch[2]*sign},depth:d};rows[index]=entry;
  if(index===0){best=entry;depth=d}const speed=line.match(/\bnps (\d+)/);if(speed)nodesPerSecond=+speed[1];renderAnalysis();return;
 }
 if(line.startsWith('bestmove ')){
  const move=line.split(/\s+/)[1],legal=legalUci(game,move);
  if(legal&&(!best||best.moves[0]!==move)){const found=rows.find(r=>r&&r.moves[0]===move);best=found||{fen:job.fen,moves:[move],san:legal.san,score:null,depth};rows[0]=best}
  busy=false;if(job.resolveDone)job.resolveDone();renderAnalysis();
 }
}
function restartAnalysis(){cancelAnalysis();rows=[];best=null;depth=0;nodesPerSecond=0;preview=null;renderBoard();renderAnalysis();scheduleAnalysis(true)}
$('board').addEventListener('click',event=>{if(event.detail!==0&&Date.now()<suppressClickUntil)return;const sq=event.target.closest('[data-square]');if(sq)clickSquare(sq.dataset.square)});
$('board').addEventListener('pointerdown',event=>{suppressClickUntil=0;if(event.button!==0||preview||terminal()||pendingPromotion)return;const sq=event.target.closest('[data-square]');if(!sq)return;const piece=game.get(sq.dataset.square);if(!piece||piece.color!==game.turn())return;drag={from:sq.dataset.square,startX:event.clientX,startY:event.clientY,pointerId:event.pointerId,started:false,origin:sq,width:sq.getBoundingClientRect().width};});
$('board').addEventListener('pointermove',event=>{if(!drag||drag.pointerId!==event.pointerId)return;if(!drag.started&&Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>6){drag.started=true;selection=drag.from;renderBoard();drag.origin=$('board').querySelector('[data-square="'+drag.from+'"]');drag.origin.classList.add('drag-origin');const p=game.get(drag.from);drag.ghost=document.createElement('div');drag.ghost.className='drag-ghost';drag.ghost.style.width=drag.width+'px';drag.ghost.style.height=drag.width+'px';drag.ghost.innerHTML=pieceSVG(p.type,p.color);document.body.append(drag.ghost);$('board').setPointerCapture(event.pointerId)}if(drag.started){event.preventDefault();drag.ghost.style.left=event.clientX+'px';drag.ghost.style.top=event.clientY+'px'}});
function endDrag(event,cancel=false){if(!drag||event.pointerId!==drag.pointerId)return;const d=drag;drag=null;if(!d.started)return;suppressClickUntil=Date.now()+400;d.ghost.remove();d.origin.classList.remove('drag-origin');try{$('board').releasePointerCapture(event.pointerId)}catch{}const target=!cancel&&document.elementFromPoint(event.clientX,event.clientY),square=target&&target.closest('[data-square]');if(square&&$('board').contains(square)&&commit(d.from,square.dataset.square))return;selection=null;renderBoard()}
$('board').addEventListener('pointerup',event=>endDrag(event));$('board').addEventListener('pointercancel',event=>endDrag(event,true));window.addEventListener('pointerup',event=>{if(drag&&drag.started)endDrag(event)});
$('history').addEventListener('click',event=>{const b=event.target.closest('[data-ply]');if(b)jumpTo(+b.dataset.ply)});
$('undo').onclick=()=>jumpTo(cursor-1);$('redo').onclick=()=>jumpTo(cursor+1);$('first').onclick=()=>jumpTo(0);$('last').onclick=()=>jumpTo(timeline.length);
$('flip').onclick=()=>{flipped=!flipped;renderBoard()};
$('reset').onclick=()=>{if(timeline.length||rootFen!==new Chess().fen())$('reset-dialog').showModal();else loadPosition(new Chess().fen())};$('cancel-reset').onclick=()=>$('reset-dialog').close();$('confirm-reset').onclick=()=>{$('reset-dialog').close();loadPosition(new Chess().fen())};
$('play-best').onclick=()=>{if(!best)return;const m=legalUci(game,best.moves[0]);if(m){preview=null;commit(m.from,m.to,m.promotion)}};
$('analysis-toggle').onchange=()=>{if($('analysis-toggle').checked)restartAnalysis();else{cancelAnalysis();renderAnalysis()}};
$('analyze-again').onclick=()=>{if(!$('analysis-toggle').checked)$('analysis-toggle').checked=true;restartAnalysis()};$('budget').onchange=()=>{if($('analysis-toggle').checked)restartAnalysis()};$('infinite').onchange=()=>{$('budget').disabled=$('infinite').checked;if($('analysis-toggle').checked)restartAnalysis()};
$('close-preview').onclick=closePreview;$('preview-back').onclick=()=>stepPreview(-1);$('preview-next').onclick=()=>stepPreview(1);
$('cancel-promotion').onclick=()=>$('promotion-dialog').close();$('promotion-dialog').addEventListener('close',()=>{pendingPromotion=null;selection=null;renderBoard()});
$('claim-draw').onclick=()=>{if(game.isThreefoldRepetition())claimed='threefold repetition';else if(+game.fen().split(' ')[4]>=100)claimed='50-move rule';if(claimed){cancelAnalysis();preview=null;rows=[];best=null;depth=0;renderAll()}};
$('load-position').onclick=()=>{$('fen-input').value=game.fen();$('fen-error').textContent='';$('fen-dialog').showModal();$('fen-input').select()};$('cancel-fen').onclick=()=>$('fen-dialog').close();$('fen-form').onsubmit=event=>{event.preventDefault();try{loadPosition($('fen-input').value.trim());$('fen-dialog').close()}catch(e){$('fen-error').textContent=e.message||'Please enter a valid FEN.'}};
async function copyText(text){try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text)}else throw Error();showToast('Copied to clipboard')}catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.left='-9999px';document.body.append(area);area.select();let ok=false;try{ok=document.execCommand('copy')}catch{}area.remove();showToast(ok?'Copied to clipboard':'Clipboard unavailable in this browser.')}}
$('copy-fen').onclick=()=>copyText(game.fen());$('copy-pgn').onclick=()=>copyText(game.pgn());
$('about-button').onclick=()=>{$('licenses').textContent=$('license-text').textContent;$('about-dialog').showModal()};$('close-about').onclick=()=>$('about-dialog').close();$('download-source').onclick=()=>{const t=atob($('stockfish-source').textContent.trim()),b=Uint8Array.from(t,c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([b],{type:'application/gzip'})),a=document.createElement('a');a.href=url;a.download='stockfish.js-v19.0.1-source.tar.gz';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)};
document.addEventListener('keydown',event=>{if(event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,select,textarea')||document.querySelector('dialog[open]'))return;if(event.key==='Escape'){closePreview();return}if(event.key==='ArrowLeft'){event.preventDefault();preview?stepPreview(-1):jumpTo(cursor-1)}if(event.key==='ArrowRight'){event.preventDefault();preview?stepPreview(1):jumpTo(cursor+1)}if(event.key==='Home'){event.preventDefault();jumpTo(0)}if(event.key==='End'){event.preventDefault();jumpTo(timeline.length)}if(event.key.toLowerCase()==='f'){$('flip').click()}});
window.addEventListener('pagehide',()=>{cancelAnalysis();if(workerURL)URL.revokeObjectURL(workerURL)});
renderAll();requestAnimationFrame(()=>scheduleAnalysis(true));
