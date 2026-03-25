/**
 * GHL Tracker Script — Custom JS injected inside GoHighLevel
 *
 * Purpose: Tracks page sessions (which pages GHL users visit, for how long)
 * and sends them to the tracker-ingest edge function which enriches with geo data.
 *
 * NOTE: This script is now hosted directly by the Vite frontend at `/bundle-v3.js`.
 *
 * --- INSTALLATION INSTRUCTIONS ---
 * Do NOT paste this entire script into GoHighLevel anymore.
 * Instead, copy the following HTML tag and paste it into GoHighLevel's
 * Settings -> Business Profile -> Custom JS/CSS:
 *
 * <script src="https://YOUR_DOMAIN/bundle-v3.js"></script>
 *
 * This ensures all sub-accounts automatically receive the latest script updates.
 * ---------------------------------
 */
(function () {
  // ===== SUPABASE =====
  var SUPABASE_URL = "https://xrcurxegylqjrbmfihte.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyY3VyeGVneWxxanJibWZpaHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzOTI1NzgsImV4cCI6MjA4OTk2ODU3OH0.P47Jj6Q-7HPmafQ-aI0K-1mYUcqFS7LnxLAOqQLLYAI";
  var INGEST_URL = SUPABASE_URL + "/functions/v1/tracker-ingest";
  var HEARTBEAT_URL = SUPABASE_URL + "/functions/v1/tracker-heartbeat";
  var HEARTBEAT_SECONDS = 15;
  var presenceTick = 0;

  // ===== HELPERS =====
  function nowIso(){ return new Date().toISOString(); }
  function nowMs(){ return Date.now(); }

  function pageKey(){
    return ((window.location.pathname||"")+(window.location.search||"")).trim();
  }

  function getLocationId(){
    try{
      var parts = window.location.pathname.split("/").filter(Boolean);
      var idx = parts.indexOf("location");
      if(idx !== -1 && parts[idx+1]) return parts[idx+1];
    }catch(e){}
    return null;
  }

  // ===== CLIENT METADATA =====
  function getClientMeta(){
    var meta = {};
    try{ meta.client_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){}
    try{ meta.client_locale = navigator.language || navigator.userLanguage || null; }catch(e){}
    try{ meta.user_agent = navigator.userAgent || null; }catch(e){}
    try{
      meta.screen_width = window.screen ? window.screen.width : null;
      meta.screen_height = window.screen ? window.screen.height : null;
    }catch(e){}
    return meta;
  }

  // ===== COOKIE + JWT =====
  function getCookie(name){
    try{
      var cookies = (document.cookie||"").split("; ");
      for(var i=0;i<cookies.length;i++){
        var kv = cookies[i].split("=");
        if(kv[0]===name) return kv[1];
      }
    }catch(e){}
    return null;
  }

  function decodeJwt(token){
    try{
      if(!token) return null;
      var parts = token.split(".");
      if(parts.length<2) return null;
      var b64 = parts[1].replace(/-/g,"+").replace(/_/g,"/");
      var pad = b64.length%4;
      if(pad) b64 += "===".slice(0,4-pad);
      return JSON.parse(atob(b64));
    }catch(e){
      return null;
    }
  }

  function extractUserId(payload){
    try{
      if(!payload) return null;
      if(payload.primaryUser && payload.primaryUser.id) return payload.primaryUser.id;
      if(payload.user && payload.user.id) return payload.user.id;
      if(payload.locationUser && payload.locationUser.id) return payload.locationUser.id;
      if(payload.impersonatedUser && payload.impersonatedUser.id) return payload.impersonatedUser.id;
      if(payload.primaryUserId) return payload.primaryUserId;
      if(payload.userId) return payload.userId;
      if(payload.authClassId) return payload.authClassId;
    }catch(e){}
    return null;
  }

  function getRealUserId(){
    var token = getCookie("m_a") || getCookie("m_s") || getCookie("m_l");
    var payload = decodeJwt(token);
    return extractUserId(payload);
  }

  function postToIngest(row){
    return fetch(INGEST_URL,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":SUPABASE_ANON_KEY,
        "Authorization":"Bearer "+SUPABASE_ANON_KEY
      },
      body:JSON.stringify(row),
      keepalive:true
    }).then(function(res){
      if(!res.ok){
        console.warn('[Dashboard Tracker] Ingest returned HTTP '+res.status+' for path: '+(row.page_path||'unknown'));
      }
    }).catch(function(err){
      console.warn('[Dashboard Tracker] Ingest failed:', err && err.message || err);
    });
  }

  // ===== PRESENCE =====
  function sendPresence(){
    if(!current) return;
    fetch(HEARTBEAT_URL,{
      method:"POST",
      headers:{"Content-Type":"application/json","apikey":SUPABASE_ANON_KEY,"Authorization":"Bearer "+SUPABASE_ANON_KEY},
      body:JSON.stringify({user_id:current.user_id,location_id:current.location_id,page_path:current.page_path}),
      keepalive:true
    }).catch(function(){});
  }

  function clearPresence(userId, locationId){
    if(!userId || !locationId) return;
    // Use sendBeacon for reliable delivery during page unload.
    // fetch() with DELETE is silently killed by browsers during beforeunload.
    // sendBeacon only supports POST, so we use action:"offline" to signal removal.
    var payload = JSON.stringify({user_id:userId,location_id:locationId,action:"offline"});
    if(navigator.sendBeacon){
      navigator.sendBeacon(HEARTBEAT_URL+"?apikey="+SUPABASE_ANON_KEY, new Blob([payload],{type:"application/json"}));
    } else {
      fetch(HEARTBEAT_URL,{
        method:"POST",
        headers:{"Content-Type":"application/json","apikey":SUPABASE_ANON_KEY,"Authorization":"Bearer "+SUPABASE_ANON_KEY},
        body:payload,
        keepalive:true
      }).catch(function(){});
    }
  }

  // ===== SESSION =====
  var current=null;
  var hbTimer=null;
  var lastRoute=null;
  var clientMeta = getClientMeta();

  function startSession(){
    var path = pageKey();
    if(!path) return;
    var userId = getRealUserId();
    var locationId = getLocationId();
    if(!userId || !locationId) return;
    lastRoute = path;
    current={
      user_id:userId,
      location_id:locationId,
      page_path:path,
      started_at:nowIso(),
      ended_at:nowIso(),
      duration_seconds:0,
      heartbeats:0,
      details:{},
      // Client metadata
      client_timezone: clientMeta.client_timezone || null,
      client_locale: clientMeta.client_locale || null,
      user_agent: clientMeta.user_agent || null,
      screen_width: clientMeta.screen_width || null,
      screen_height: clientMeta.screen_height || null
    };
    current.__start_ms = nowMs();
    sendPresence(); // Immediately mark as online
    if(hbTimer) clearInterval(hbTimer);
    hbTimer=setInterval(function(){
      if(!current) return;
      if(document.visibilityState!=="visible") return;
      current.heartbeats+=1;
      current.ended_at=nowIso();
      // Send presence every 30s (every 2nd tick of 15s)
      presenceTick+=1;
      if(presenceTick%2===0) sendPresence();
    },HEARTBEAT_SECONDS*1000);
  }

  function stopSession(reason){
    if(!current) return;
    if(hbTimer){ clearInterval(hbTimer); hbTimer=null; }
    var endMs=nowMs();
    var dur=Math.round((endMs-current.__start_ms)/1000);
    if(dur<0) dur=0;
    current.duration_seconds=dur;
    current.ended_at=nowIso();
    current.details.end_reason=reason||"unknown";
    delete current.__start_ms;
    var uid = current.user_id;
    var lid = current.location_id;
    postToIngest(current);
    current=null;
    // Signal offline immediately so dashboard updates in real-time
    if(reason==="beforeunload"||reason==="visibility_hidden"){
      clearPresence(uid, lid);
    }
  }

  function hookHistory(){
    try{
      var push=history.pushState;
      var replace=history.replaceState;
      function routeChanged(){
        var newPath=pageKey();
        if(!newPath) return;
        if(!current){ startSession(); return; }
        if(newPath!==lastRoute){ stopSession("route_change"); startSession(); }
      }
      history.pushState=function(){ push.apply(history,arguments); setTimeout(routeChanged,0); };
      history.replaceState=function(){ replace.apply(history,arguments); setTimeout(routeChanged,0); };
      window.addEventListener("popstate",function(){ setTimeout(routeChanged,0); });
    }catch(e){}
  }

  window.addEventListener("beforeunload",function(){ stopSession("beforeunload"); });
  document.addEventListener("visibilitychange",function(){
    if(document.visibilityState==="hidden") stopSession("visibility_hidden");
    else if(document.visibilityState==="visible"){ if(!current) startSession(); }
  });
  hookHistory();
  startSession();
})();
