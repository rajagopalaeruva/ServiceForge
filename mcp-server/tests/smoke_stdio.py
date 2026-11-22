"""Manual smoke test: real stdio MCP session against a fake backend on port 18080 (never 8080)."""
import asyncio, json, os, sys, threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

T = datetime.now().strftime("%Y-%m-%d")
DATA = {
 "/api/technicians": [{"id": 1, "name": "Jordan Reyes", "region": "North"}],
 "/api/technicians/1/jobs": [{"id": 2, "technicianId": 1, "customerName": "N", "status": "SCHEDULED", "startTime": T+"T14:00:00", "endTime": T+"T15:30:00"}],
 "/api/parts": [{"id": 2, "name": "Air filter", "available": 25}],
 "/api/jobs/2/reservations": [],
}
class H(BaseHTTPRequestHandler):
    def do_GET(s):
        b = DATA.get(s.path); s.send_response(200 if b is not None else 404); s.send_header("Content-Type","application/json"); s.end_headers()
        s.wfile.write(json.dumps(b if b is not None else {"message":"nope"}).encode())
    def log_message(*a): pass
srv = HTTPServer(("127.0.0.1", 18080), H); threading.Thread(target=srv.serve_forever, daemon=True).start()

async def main():
    p = StdioServerParameters(command=sys.executable, args=["-m", "serviceforge_mcp.server"],
        env={**os.environ, "SERVICEFORGE_BASE_URL": "http://127.0.0.1:18080", "PYTHONPATH": "src"})
    async with stdio_client(p) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            print("tools:", [t.name for t in (await s.list_tools()).tools])
            print("resources:", [str(x.uri) for x in (await s.list_resources()).resources])
            print("prompts:", [x.name for x in (await s.list_prompts()).prompts])
            a = await s.call_tool("get_technician_availability", {"technicianId": 1, "windowStart": T+"T13:00:00", "windowEnd": T+"T13:30:00"})
            print("avail:", a.isError, a.content[0].text[:160])
            e = await s.call_tool("get_part_stock", {"sku": "CMP-CLUTCH"})
            print("err:", e.isError, e.content[0].text)
            q = await s.call_tool("reserve_part_for_job", {"jobId": 2, "sku": "AIR-FILTER", "quantity": 0})
            print("bad qty:", q.isError, q.content[0].text[:120])
            br = await s.read_resource("serviceforge://session/dispatch-brief")
            print("brief bytes:", len(br.contents[0].text), br.contents[0].text[:200])
            pr = await s.get_prompt("prep-job-dispatch", {"jobId": "2"})
            print("prompt ok:", pr.messages[0].content.text[:60])
asyncio.run(main())
