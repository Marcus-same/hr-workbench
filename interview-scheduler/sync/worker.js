const MAX_DAYS = 32 * 86400000;
const RESP_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
function isAuthorized(request, token) {
  return typeof token === "string" && token.length >= 24 &&
    request.headers.get("Authorization") === "Bearer " + token;
}
function toMs(value) {
  if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(value)) return NaN;
  return Date.parse(value);
}
function validWindow(from, to) {
  return Number.isFinite(from) && Number.isFinite(to) &&
    from < to && to - from <= MAX_DAYS;
}
const validPerson = s => s === "li" || s === "zhang";
function json(data, status = 200, origin = "") {
  const headers = { ...RESP_HEADERS, "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Vary": "Origin" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "https://marcus-same.github.io").replace(/\/$/, "");
    const corsOrigin = origin === allowed ? origin : "";
    if (request.method === "OPTIONS") {
      if (origin && !corsOrigin) return json({error:"Origin not allowed"}, 403);
      return new Response(null, {status: 204, headers: {
        "Access-Control-Allow-Origin": corsOrigin || allowed, "Vary": "Origin",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Max-Age": "600"
      }});
    }
    const url = new URL(request.url), path = url.pathname;
    if (request.method === "GET" && path === "/api/health") return json({ok:true, service:"interview-scheduler-sync"},200,corsOrigin);
    if (!env.DB) return json({error:"Database not configured"},503,corsOrigin);
    try {
      if (request.method === "GET" && path === "/api/events") {
        if (!isAuthorized(request,env.VIEW_TOKEN)) return json({error:"Unauthorized"},401,corsOrigin);
        const from=toMs(url.searchParams.get("from")),to=toMs(url.searchParams.get("to"));
        if (!validWindow(from,to)) return json({error:"Invalid time window"},400,corsOrigin);
        const [wx,manual] = await Promise.all([
          env.DB.prepare("SELECT event_id AS id, interviewer AS person, start_ms AS start, end_ms AS end FROM remote_busy WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms").bind(to,from).all(),
          env.DB.prepare("SELECT id, interviewer AS person, start_ms AS start, end_ms AS end, note AS candidate FROM manual_bookings WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms").bind(to,from).all()
        ]);
        return json({ok:true, syncedAt:new Date().toISOString(), bookings:[
          ...wx.results.map(x=>({...x,source:"wecom",candidate:"企业微信日程（忙碌）"})),
          ...manual.results.map(x=>({...x,source:"site"}))
        ]},200,corsOrigin);
      }
      if (request.method === "POST" && path === "/api/sync") {
        if (!isAuthorized(request,env.SYNC_TOKEN)) return json({error:"Unauthorized"},401,corsOrigin);
        const raw=await request.json(), from=toMs(raw.from),to=toMs(raw.to),list=raw.events;
        if (!validWindow(from,to) || !Array.isArray(list) || list.length>300)
          return json({error:"Invalid snapshot; max 300 events, max 32 days"},400,corsOrigin);
        const seen = new Set(), values=[];
        for (const event of list) {
          const a=toMs(event.start), b=toMs(event.end), id=event.id;
          if (!validPerson(event.person) || typeof id!=="string" || id.length<1 || id.length>150 ||
            !Number.isFinite(a)||!Number.isFinite(b)||a>=b||b<=from||a>=to ||
            seen.has(id)) return json({error:"Invalid event or duplicate event ID"},400,corsOrigin);
          seen.add(id);
          values.push({id,person:event.person,a,b});
        }
        const statements=[env.DB.prepare(
          "DELETE FROM remote_busy WHERE start_ms < ? AND end_ms > ?").bind(to,from)];
        const now=Date.now();
        for (const e of values) statements.push(env.DB.prepare(
          "INSERT INTO remote_busy (event_id,interviewer,start_ms,end_ms,updated_ms) VALUES (?,?,?,?,?)"
        ).bind(e.id,e.person,e.a,e.b,now));
        await env.DB.batch(statements);
        return json({ok:true,imported:values.length,syncedAt:new Date(now).toISOString()},200,corsOrigin);
      }
      if (request.method === "POST" && path === "/api/bookings") {
        if (!isAuthorized(request,env.WRITE_TOKEN)) return json({error:"Unauthorized"},401,corsOrigin);
        const b=await request.json(),a=toMs(b.start),end=toMs(b.end);
        if (!validPerson(b.person)||!Number.isFinite(a)||!Number.isFinite(end)||end<=a ||
          end-a>4*3600000||typeof b.candidate!=="string"||b.candidate.length>100)
          return json({error:"Invalid booking"},400,corsOrigin);
        const id=crypto.randomUUID();
        const result=await env.DB.prepare(
          "INSERT INTO manual_bookings (id,interviewer,start_ms,end_ms,note,created_ms) " +
          "SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM remote_busy WHERE interviewer=? AND start_ms<? AND end_ms>?) " +
          "AND NOT EXISTS (SELECT 1 FROM manual_bookings WHERE interviewer=? AND start_ms<? AND end_ms>?)"
        ).bind(id,b.person,a,end,b.candidate,Date.now(),b.person,end,a,b.person,end,a).run();
        if (result.meta?.changes!==1) return json({error:"该面试官的时段已被占用"},409,corsOrigin);
        return json({ok:true,id},201,corsOrigin);
      }
      if (request.method === "DELETE" && path.startsWith("/api/bookings/")) {
        if (!isAuthorized(request,env.WRITE_TOKEN)) return json({error:"Unauthorized"},401,corsOrigin);
        const id=decodeURIComponent(path.slice("/api/bookings/".length));
        if (!/^[a-f0-9-]{36}$/.test(id)) return json({error:"Invalid ID"},400,corsOrigin);
        const result=await env.DB.prepare("DELETE FROM manual_bookings WHERE id=?").bind(id).run();
        return json({ok:true,deleted:result.meta?.changes||0},200,corsOrigin);
      }
      return json({error:"Not found"},404,corsOrigin);
    } catch (e) {
      console.error("scheduler worker failed", e?.message || "unknown");
      return json({error:"同步服务暂时不可用"},500,corsOrigin);
    }
  }
};